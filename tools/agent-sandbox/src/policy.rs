//! The policy: one description of what a sandboxed command may touch, which each enforcer
//! (seatbelt.rs, bwrap.rs) turns into its own form. Everything not named here is denied.
//!
//! - `own_dir`: read and write. The run's directory (workspace/, tmp/, agent-home/ inside it).
//! - `read_only`: read and execute. The toolchain, given with --ro or found by toolchain.rs.
//! - the directories above those: existence only (stat), so that path resolution works while
//!   nothing beside them can be listed or read.

use anyhow::{bail, Context, Result};
use std::path::{Path, PathBuf};

use crate::paths::{normalise, strict_ancestors, symlinks_on, within};

/// The run's own temp directory, inside own_dir: the harness points TMPDIR here.
pub const OWN_TMP: &str = "tmp";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadOnly {
    pub path: PathBuf,
    pub is_dir: bool,
}

/// A symlink on the way to an allowed path, kept so the path still resolves as it was written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub at: PathBuf,
    pub target: PathBuf,
}

/// Where own_dir may not be shown inside the sandbox: these are the system's own places.
const RESERVED_TOP_LEVEL: &[&str] = &[
    "usr", "bin", "sbin", "lib", "lib32", "lib64", "libx32", "etc", "proc", "dev", "tmp", "var", "run", "sys",
];

#[derive(Debug, Clone)]
pub struct Policy {
    pub own_dir: PathBuf,
    /// Where own_dir appears inside the sandbox: its own path, unless the caller asked for another
    /// (Linux can bind it anywhere; macOS cannot remap a path).
    pub own_at: PathBuf,
    /// Resolved host paths inside own_dir that stay read-only (the spec): a mount on Linux, a
    /// later deny on macOS, so no file mode and no `chmod` can open them.
    pub own_ro: Vec<PathBuf>,
    /// Where the command starts, relative to own_dir.
    pub workdir: Option<PathBuf>,
    /// Resolved, sorted, none inside another, none inside own_dir.
    pub read_only: Vec<ReadOnly>,
    pub links: Vec<Link>,
    /// Asked for but absent on this machine: not allowed, so they can't appear later and be read.
    pub missing: Vec<PathBuf>,
}

impl Policy {
    /// `home` is the real user's home: neither own_dir nor a read-only path may open it as a whole.
    pub fn new(own_dir: &Path, ro: &[PathBuf], home: Option<&Path>) -> Result<Policy> {
        let home = match home {
            Some(h) => normalise(h)?,
            None => None,
        };
        let own = normalise(own_dir)?
            .with_context(|| format!("--own-dir {} does not exist", own_dir.display()))?;
        if !own.is_dir() {
            bail!("--own-dir {} is not a directory", own.display());
        }
        if own.parent().is_none() || home.as_deref().is_some_and(|h| within(h, &own)) {
            bail!(
                "--own-dir {} would make the home directory or the whole machine writable",
                own.display()
            );
        }
        let mut links = links_to(own_dir);
        let mut read_only: Vec<ReadOnly> = Vec::new();
        let mut missing = Vec::new();
        for asked in ro {
            let Some(path) = normalise(asked)? else {
                missing.push(asked.clone());
                continue;
            };
            if within(&path, &own) {
                continue;
            }
            if within(&own, &path) {
                bail!(
                    "--ro {} contains --own-dir: it would show the runs beside this one",
                    path.display()
                );
            }
            if home.as_deref().is_some_and(|h| within(h, &path)) {
                bail!(
                    "--ro {} contains the home directory: name the tool's own directory instead",
                    path.display()
                );
            }
            links.extend(links_to(asked));
            read_only.push(ReadOnly {
                is_dir: path.is_dir(),
                path,
            });
        }
        read_only.sort_by(|a, b| a.path.cmp(&b.path));
        read_only.dedup();
        let outer: Vec<PathBuf> = read_only.iter().map(|r| r.path.clone()).collect();
        read_only.retain(|r| !outer.iter().any(|o| o != &r.path && within(&r.path, o)));
        links.sort_by(|a, b| a.at.cmp(&b.at));
        links.dedup();
        missing.sort();
        missing.dedup();
        Ok(Policy {
            own_at: own.clone(),
            own_ro: Vec::new(),
            workdir: None,
            own_dir: own,
            read_only,
            links,
            missing,
        })
    }

    /// Show own_dir at `at` inside the sandbox (an absolute path of its own, not a system place).
    pub fn shown_at(mut self, at: &Path) -> Result<Policy> {
        if !at.is_absolute() || at.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            bail!("--own-at {} must be an absolute path without ..", at.display());
        }
        let top = at.components().nth(1).and_then(|c| c.as_os_str().to_str());
        if top.is_none() || top.is_some_and(|t| RESERVED_TOP_LEVEL.contains(&t)) {
            bail!("--own-at {} is where the system lives inside the sandbox; pick a place of its own", at.display());
        }
        self.own_at = at.to_path_buf();
        Ok(self)
    }

    /// Keep these paths inside own_dir (relative) read-only. Each must exist and, resolved, stay inside.
    pub fn read_only_inside(mut self, rel: &[PathBuf]) -> Result<Policy> {
        for r in rel {
            let host = self.inside_own_dir(r, "--own-ro")?;
            self.own_ro.push(host);
        }
        self.own_ro.sort();
        self.own_ro.dedup();
        Ok(self)
    }

    /// Start the command in this directory of own_dir (relative).
    pub fn starting_in(mut self, rel: &Path) -> Result<Policy> {
        let host = self.inside_own_dir(rel, "--workdir")?;
        if !host.is_dir() {
            bail!("--workdir {} is not a directory", rel.display());
        }
        self.workdir = Some(rel.to_path_buf());
        Ok(self)
    }

    fn inside_own_dir(&self, rel: &Path, flag: &str) -> Result<PathBuf> {
        if rel.is_absolute() || rel.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            bail!("{flag} {} must be relative to --own-dir, without ..", rel.display());
        }
        let joined = self.own_dir.join(rel);
        let host = normalise(&joined)?
            .with_context(|| format!("{flag} {} does not exist in --own-dir", rel.display()))?;
        if !within(&host, &self.own_dir) {
            bail!("{flag} {} leads out of --own-dir", rel.display());
        }
        Ok(host)
    }

    /// A host path under own_dir as the command sees it.
    pub fn seen_at(&self, host: &Path) -> PathBuf {
        match host.strip_prefix(&self.own_dir) {
            Ok(rel) => self.own_at.join(rel),
            Err(_) => host.to_path_buf(),
        }
    }

    pub fn own_tmp(&self) -> PathBuf {
        self.own_dir.join(OWN_TMP)
    }

    /// True when the path is already readable as part of own_dir or a read-only tree.
    pub fn readable(&self, path: &Path) -> bool {
        within(path, &self.own_dir) || self.read_only.iter().any(|r| within(path, &r.path))
    }

    /// Directories that may be stat-ed and nothing more: the ancestors of own_dir, of each
    /// read-only path and of each link. Sorted, without duplicates, without the root.
    pub fn metadata_only(&self) -> Vec<PathBuf> {
        let mut out: Vec<PathBuf> = std::iter::once(&self.own_dir)
            .chain(self.read_only.iter().map(|r| &r.path))
            .chain(self.links.iter().map(|l| &l.at))
            .flat_map(|p| strict_ancestors(p))
            .filter(|a| !self.readable(a))
            .collect();
        out.sort();
        out.dedup();
        out
    }
}

fn links_to(path: &Path) -> Vec<Link> {
    symlinks_on(path)
        .into_iter()
        .map(|(at, target)| Link { at, target })
        .collect()
}
