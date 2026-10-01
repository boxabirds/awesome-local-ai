//! Which harness a job runs: the latest release, not whatever main has.
//!
//! A release is a tag `harness-v<YYYY.MM.DD>.<n>` that `dbench harness-release` puts on a commit of
//! main only when every check passes (release.rs). Before a job starts, the node finds the newest
//! such tag on origin/main and materialises it once under `<home>/releases/<tag>/`: the paths the
//! release itself calls the harness (`harness` in its checks.toml), taken from the tag with
//! `git archive`, plus a manifest saying which tag and commit it is. The directory has no `.git`
//! and is read-only, so nothing can be committed into it or changed in it by accident. The job
//! runs `<release>/benchmarks/spec-bench/harness/run.sh` with `SPEC_BENCH_RESULTS_ROOT` naming
//! the node's checkout, which stays on main: results are written, committed and pushed there.
//!
//! A job keeps the release it first started on (`Job::harness`): a restart never changes harness
//! mid-run. If its directory is gone it is made again from the tag; if the tag no longer names
//! that commit, the job fails.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::ffi::OsStr;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::process::Command;

use crate::cli::ServerConfig;
use crate::job::SPEC_BENCH_ENTRY;
use crate::release::{CHECKS_FILE, MAIN_BRANCH, REMOTE, TAG_PREFIX};
use crate::runner::GIT_PULL_TIMEOUT;

/// Under the server's home: one directory per materialised release, named by its tag.
pub const RELEASES_DIR: &str = "releases";
/// At the root of a materialised release: `{"tag", "commit", "commit_short"}`. The harness reads
/// it (benchmarks/spec-bench/harness/roots.py RELEASE_FILE) to record what it is: it has no git.
pub const MANIFEST_FILE: &str = "RELEASE.json";
/// Set for a released harness: the checkout where it writes, commits and pushes results
/// (benchmarks/spec-bench/harness/roots.py ENV).
pub const RESULTS_ROOT_ENV: &str = "SPEC_BENCH_RESULTS_ROOT";
/// The harness file that reads RESULTS_ROOT_ENV. A release without it is from before the harness could
/// run apart from its results: it would ignore the variable and take its own directory for the results
/// root. Such a release is refused.
pub const RESULTS_ROOT_SUPPORT: &str = "benchmarks/spec-bench/harness/roots.py";
/// Release directories kept once no job needs them: the newest few, so going back one is quick.
pub const KEEP_RELEASES: usize = 3;
/// A release being made, before it is renamed into place: `.<tag>.partial`.
const PARTIAL_SUFFIX: &str = ".partial";
/// The tag's files on their way from git to the directory: `.<tag>.tar`.
const ARCHIVE_SUFFIX: &str = ".tar";
const WRITE_BITS: u32 = 0o222;
const OWNER_WRITE: u32 = 0o200;
/// How to make the first release, said wherever a job is refused for want of one.
pub const HOW_TO_RELEASE: &str = "cut one with `dbench harness-release` in a checkout of main \
     (it tags only when every check passes), or start this node with --allow-unreleased to run \
     main's harness as it is";

/// The harness a job runs, chosen when it first starts and kept for its restarts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Harness {
    /// A release: its tag and the commit the tag names.
    Release { tag: String, commit: String },
    /// The checkout's own harness, whatever main has: only with `--allow-unreleased`, and only
    /// when there is no release.
    Unreleased,
}

impl Harness {
    /// For a status line: `release harness-v2026.10.01.2 (0123abcd)`.
    pub fn describe(&self) -> String {
        match self {
            Harness::Release { tag, commit } => {
                format!(
                    "release {tag} ({})",
                    &commit[..commit.len().min(SHORT_COMMIT_CHARS)]
                )
            }
            Harness::Unreleased => "UNRELEASED: the checkout's own harness, as main has it".into(),
        }
    }
}

/// Characters of a commit shown where git itself isn't asked for its short form.
const SHORT_COMMIT_CHARS: usize = 8;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub tag: String,
    pub commit: String,
    pub commit_short: String,
}

/// `harness-v2026.10.01.12` -> (2026, 10, 1, 12). Digits only in every part: anything else is
/// not a release tag.
pub fn tag_version(tag: &str) -> Option<(u32, u32, u32, u32)> {
    let mut parts = tag.strip_prefix(TAG_PREFIX)?.split('.');
    let mut next = || {
        let p = parts.next()?;
        (!p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
            .then(|| p.parse::<u32>().ok())
            .flatten()
    };
    let version = (next()?, next()?, next()?, next()?);
    parts.next().is_none().then_some(version)
}

/// The newest release among these tags, by name (date, then that day's number): never by when
/// the tag was made.
pub fn newest<'a>(tags: impl IntoIterator<Item = &'a str>) -> Option<&'a str> {
    tags.into_iter()
        .filter_map(|t| Some((tag_version(t)?, t)))
        .max()
        .map(|(_, t)| t)
}

/// Of the release directories present, those to remove: all but the newest `keep` and the ones
/// a job still needs.
pub fn to_prune(present: &[String], needed: &BTreeSet<String>, keep: usize) -> Vec<String> {
    let mut known: Vec<(_, &String)> = present
        .iter()
        .filter_map(|t| Some((tag_version(t)?, t)))
        .collect();
    known.sort();
    known
        .into_iter()
        .rev()
        .skip(keep)
        .map(|(_, t)| t.clone())
        .filter(|t| !needed.contains(t))
        .collect()
}

/// The paths a release calls the harness: `harness = [...]` in its checks.toml. Other keys are the
/// release command's business (and may be newer than this binary), so they are not read here.
pub fn harness_paths(checks_toml: &str) -> Result<Vec<String>, String> {
    #[derive(Deserialize)]
    struct Content {
        #[serde(default)]
        harness: Vec<String>,
    }
    let content: Content = toml::from_str(checks_toml).map_err(|e| e.to_string())?;
    if content.harness.is_empty() {
        return Err("it has no `harness` list".into());
    }
    if let Some(bad) = content
        .harness
        .iter()
        .find(|p| !crate::release::inside_repo(p))
    {
        return Err(format!(
            "harness path {bad:?} is not a path inside the repo"
        ));
    }
    Ok(content.harness)
}

/// Run git in the checkout; its trimmed stdout, or what went wrong in one line.
async fn git(cfg: &ServerConfig, args: &[&OsStr]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(&cfg.repo)
        .args(args)
        .env("PATH", cfg.child_path())
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let shown: Vec<String> = args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let shown = shown.join(" ");
    match tokio::time::timeout(GIT_PULL_TIMEOUT, cmd.output()).await {
        Err(_) => Err(format!(
            "git {shown}: timed out after {}s",
            GIT_PULL_TIMEOUT.as_secs()
        )),
        Ok(Err(e)) => Err(format!("could not run git: {e}")),
        Ok(Ok(out)) if !out.status.success() => Err(format!(
            "git {shown}: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        )),
        Ok(Ok(out)) => Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()),
    }
}

fn strs<'a>(args: &'a [&'a str]) -> Vec<&'a OsStr> {
    args.iter().map(OsStr::new).collect()
}

fn remote_main() -> String {
    format!("refs/remotes/{REMOTE}/{MAIN_BRANCH}")
}

/// Fetch main and every tag from the remote. A tag made on a commit the checkout already has
/// (a release of yesterday's main) comes with no new commits, so `git pull` alone can miss it.
pub async fn fetch(cfg: &ServerConfig) -> Result<(), String> {
    let refspec = format!("+refs/heads/{MAIN_BRANCH}:{}", remote_main());
    git(
        cfg,
        &strs(&["fetch", "--quiet", "--tags", REMOTE, &refspec]),
    )
    .await
    .map(|_| ())
}

/// The commit a release tag names, in full.
pub async fn tag_commit(cfg: &ServerConfig, tag: &str) -> Result<String, String> {
    let spec = format!("refs/tags/{tag}^{{commit}}");
    git(cfg, &strs(&["rev-parse", "--verify", "--quiet", &spec])).await
}

/// The newest release on origin/main as the checkout knows it: (tag, commit). None when there
/// is none; an error when git can't say.
pub async fn latest_release(cfg: &ServerConfig) -> Result<Option<(String, String)>, String> {
    let pattern = format!("{TAG_PREFIX}*");
    let main = remote_main();
    let listed = git(cfg, &strs(&["tag", "--list", &pattern, "--merged", &main])).await?;
    let Some(tag) = newest(listed.lines().map(str::trim)) else {
        return Ok(None);
    };
    let commit = tag_commit(cfg, tag).await?;
    Ok(Some((tag.to_string(), commit)))
}

pub fn release_dir(cfg: &ServerConfig, tag: &str) -> PathBuf {
    cfg.releases_dir.join(tag)
}

fn read_manifest(dir: &Path) -> Option<Manifest> {
    serde_json::from_slice(&std::fs::read(dir.join(MANIFEST_FILE)).ok()?).ok()
}

/// Take the write bits off a tree (or with `writable`, give the owner's back, so it can be removed).
/// Symlinks are left alone: their targets are not ours to change.
fn set_tree_writable(path: &Path, writable: bool) -> std::io::Result<()> {
    let meta = std::fs::symlink_metadata(path)?;
    if meta.is_symlink() {
        return Ok(());
    }
    let mode = meta.permissions().mode();
    let new = if writable {
        mode | OWNER_WRITE
    } else {
        mode & !WRITE_BITS
    };
    if writable && new != mode {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(new))?;
    }
    if meta.is_dir() {
        for entry in std::fs::read_dir(path)? {
            set_tree_writable(&entry?.path(), writable)?;
        }
    }
    if !writable && new != mode {
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(new))?;
    }
    Ok(())
}

/// Remove a tree that may be read-only. Fine if it isn't there.
fn remove_tree(path: &Path) -> std::io::Result<()> {
    if std::fs::symlink_metadata(path).is_err() {
        return Ok(());
    }
    set_tree_writable(path, true)?;
    if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

/// What `materialise` found or did.
#[derive(Debug, PartialEq, Eq)]
pub enum Materialised {
    /// The directory was already there, of this commit.
    Present,
    /// Made now from the tag.
    Made,
}

/// Make sure `<home>/releases/<tag>/` holds the harness of `commit`, which the tag names.
/// An existing directory of another commit is an error (a release tag must not move), as is a
/// release that doesn't say what its harness is or has no entry point.
pub async fn materialise(
    cfg: &ServerConfig,
    tag: &str,
    commit: &str,
) -> Result<Materialised, String> {
    let dir = release_dir(cfg, tag);
    if let Some(found) = read_manifest(&dir) {
        if found.commit == commit && found.tag == tag {
            return Ok(Materialised::Present);
        }
        return Err(format!(
            "{} is release {} of commit {}, not {tag} of {commit}: a release tag must not move \
             (remove the directory if it is wrong)",
            dir.display(),
            found.tag,
            found.commit
        ));
    }
    let io = |what: &str, e: std::io::Error| format!("{what}: {e}");
    let checks_at = format!("{commit}:{CHECKS_FILE}");
    let checks = git(cfg, &strs(&["show", &checks_at]))
        .await
        .map_err(|e| format!("release {tag} has no readable {CHECKS_FILE}: {e}"))?;
    let paths = harness_paths(&checks).map_err(|e| {
        format!(
            "release {tag} doesn't say what the harness is ({CHECKS_FILE}: {e}); \
             it can't be run, so cut a release that does"
        )
    })?;
    std::fs::create_dir_all(&cfg.releases_dir)
        .map_err(|e| io(&format!("create {}", cfg.releases_dir.display()), e))?;
    let partial = cfg.releases_dir.join(format!(".{tag}{PARTIAL_SUFFIX}"));
    let archive = cfg.releases_dir.join(format!(".{tag}{ARCHIVE_SUFFIX}"));
    for stale in [&partial, &archive, &dir] {
        remove_tree(stale).map_err(|e| io(&format!("remove {}", stale.display()), e))?;
    }
    std::fs::create_dir(&partial).map_err(|e| io(&format!("create {}", partial.display()), e))?;

    let mut args: Vec<&OsStr> = strs(&["archive", "--format=tar", "--output"]);
    args.push(archive.as_os_str());
    args.push(OsStr::new(commit));
    args.push(OsStr::new("--"));
    args.extend(paths.iter().map(OsStr::new));
    git(cfg, &args).await?;
    let untar = Command::new("tar")
        .arg("-xf")
        .arg(&archive)
        .arg("-C")
        .arg(&partial)
        .env("PATH", cfg.child_path())
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output()
        .await
        .map_err(|e| io("could not run tar", e))?;
    if !untar.status.success() {
        return Err(format!(
            "unpacking release {tag}: {}",
            String::from_utf8_lossy(&untar.stderr).trim()
        ));
    }
    std::fs::remove_file(&archive).map_err(|e| io(&format!("remove {}", archive.display()), e))?;
    let lacks = [SPEC_BENCH_ENTRY, RESULTS_ROOT_SUPPORT]
        .into_iter()
        .find(|f| !partial.join(f).is_file());
    if let Some(file) = lacks {
        let _ = remove_tree(&partial);
        let why = if file == RESULTS_ROOT_SUPPORT {
            "its harness can't be told where results go, and would keep them in its own directory"
        } else {
            "it has no entry point"
        };
        return Err(format!(
            "release {tag} has no {file} among its harness paths ({}): {why}; cut a newer release",
            paths.join(", ")
        ));
    }
    let manifest = Manifest {
        tag: tag.to_string(),
        commit: commit.to_string(),
        commit_short: git(cfg, &strs(&["rev-parse", "--short", commit])).await?,
    };
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    std::fs::write(partial.join(MANIFEST_FILE), bytes)
        .map_err(|e| io(&format!("write {MANIFEST_FILE}"), e))?;
    // Read-only below the top first, the rename, then the top: a directory may be renamed
    // within its parent whatever its own mode, and nothing sees a half-made release by its name.
    for entry in std::fs::read_dir(&partial).map_err(|e| io("read the new release", e))? {
        let entry = entry.map_err(|e| io("read the new release", e))?;
        set_tree_writable(&entry.path(), false).map_err(|e| io("make the release read-only", e))?;
    }
    std::fs::rename(&partial, &dir).map_err(|e| io(&format!("rename to {}", dir.display()), e))?;
    set_tree_writable(&dir, false).map_err(|e| io("make the release read-only", e))?;
    Ok(Materialised::Made)
}

/// Remove release directories no job needs beyond the newest KEEP_RELEASES, and anything left
/// half-made. Returns the tags removed. Entries that are not dbench's (no release name, not a
/// leftover of making one) are left alone.
pub fn prune(cfg: &ServerConfig, needed: &BTreeSet<String>) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(&cfg.releases_dir) else {
        return Vec::new();
    };
    let names: Vec<String> = entries
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    for leftover in names.iter().filter(|n| is_leftover(n)) {
        let _ = remove_tree(&cfg.releases_dir.join(leftover));
    }
    let mut removed = Vec::new();
    for tag in to_prune(&names, needed, KEEP_RELEASES) {
        match remove_tree(&cfg.releases_dir.join(&tag)) {
            Ok(()) => removed.push(tag),
            Err(e) => eprintln!("dbench: pruning release {tag}: {e}"),
        }
    }
    removed
}

/// `.<tag>.partial` or `.<tag>.tar`: what an interrupted `materialise` leaves.
fn is_leftover(name: &str) -> bool {
    let Some(rest) = name.strip_prefix('.') else {
        return false;
    };
    [PARTIAL_SUFFIX, ARCHIVE_SUFFIX].iter().any(|suffix| {
        rest.strip_suffix(suffix)
            .is_some_and(|t| tag_version(t).is_some())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tags(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn releases_order_by_date_then_number_as_numbers() {
        let two = tag_version("harness-v2026.10.01.2").unwrap();
        let ten = tag_version("harness-v2026.10.01.10").unwrap();
        let next_day = tag_version("harness-v2026.10.02.1").unwrap();
        assert!(two < ten && ten < next_day);
        assert_eq!(ten, (2026, 10, 1, 10));
        // As text ".10" sorts before ".2"; the newest is by number, whatever order they come in.
        for order in [
            [
                "harness-v2026.10.01.2",
                "harness-v2026.10.01.10",
                "harness-v2026.10.02.1",
            ],
            [
                "harness-v2026.10.02.1",
                "harness-v2026.10.01.10",
                "harness-v2026.10.01.2",
            ],
        ] {
            assert_eq!(newest(order), Some("harness-v2026.10.02.1"));
        }
        assert_eq!(
            newest(["harness-v2026.10.01.2", "harness-v2026.10.01.10"]),
            Some("harness-v2026.10.01.10")
        );
        assert_eq!(
            newest(["harness-v2026.12.01.1", "harness-v2027.01.01.1"]),
            Some("harness-v2027.01.01.1")
        );
    }

    #[test]
    fn only_well_formed_release_tags_count() {
        for bad in [
            "harness-v2026.10.01",
            "harness-v2026.10.01.",
            "harness-v2026.10.01.x",
            "harness-v2026.10.01.2-rc",
            "harness-v2026.10.01.2.1",
            "harness-v2026.10.01.+2",
            "v2026.10.01.3",
            "vidi-harness-v1",
            "",
        ] {
            assert_eq!(tag_version(bad), None, "{bad}");
        }
        assert_eq!(newest(["vidi-harness-v1", "harness-v2026.10.01.x"]), None);
        assert_eq!(newest(Vec::<&str>::new()), None);
    }

    #[test]
    fn pruning_keeps_the_newest_and_whatever_a_job_needs() {
        let present = tags(&[
            "harness-v2026.10.01.1",
            "harness-v2026.10.01.2",
            "harness-v2026.10.01.10",
            "harness-v2026.10.02.1",
            "notes",
            ".harness-v2026.10.03.1.partial",
        ]);
        let none = BTreeSet::new();
        assert_eq!(
            to_prune(&present, &none, 2),
            ["harness-v2026.10.01.2", "harness-v2026.10.01.1"]
        );
        let needed: BTreeSet<String> = ["harness-v2026.10.01.1".to_string()].into();
        assert_eq!(to_prune(&present, &needed, 2), ["harness-v2026.10.01.2"]);
        assert!(to_prune(&present, &none, present.len()).is_empty());
        assert_eq!(to_prune(&present, &needed, 0).len(), 3);
    }

    #[test]
    fn leftovers_of_making_a_release_are_recognised_and_nothing_else() {
        assert!(is_leftover(".harness-v2026.10.03.1.partial"));
        assert!(is_leftover(".harness-v2026.10.03.1.tar"));
        for other in [
            "harness-v2026.10.03.1",
            ".notes.partial",
            "notes",
            ".DS_Store",
        ] {
            assert!(!is_leftover(other), "{other}");
        }
    }

    #[test]
    fn a_release_names_its_harness_paths() {
        let text = "paths = [\"a/**\"]\nharness = [\"benchmarks/spec-bench\", \"benchmarks/perf\"]\n\
                    future_key = 1\n[[check]]\nname = \"x\"\ndir = \".\"\ncommand = [\"true\"]\nnew_field = 2\n";
        assert_eq!(
            harness_paths(text).unwrap(),
            ["benchmarks/spec-bench", "benchmarks/perf"]
        );
        assert!(harness_paths("paths = [\"a/**\"]\n")
            .unwrap_err()
            .contains("no `harness` list"));
        assert!(harness_paths("harness = []\n").is_err());
        for outside in ["../x", "/etc", ""] {
            assert!(
                harness_paths(&format!("harness = [{outside:?}]\n")).is_err(),
                "{outside}"
            );
        }
    }

    #[test]
    fn a_job_says_which_harness_it_ran_in_few_words() {
        let release = Harness::Release {
            tag: "harness-v2026.10.01.2".into(),
            commit: "0123456789abcdef0123456789abcdef01234567".into(),
        };
        assert_eq!(
            release.describe(),
            "release harness-v2026.10.01.2 (01234567)"
        );
        assert!(Harness::Unreleased.describe().starts_with("UNRELEASED"));
        // Stored with the job; a job from before this field reads as not started on any.
        let json = serde_json::to_value(&release).unwrap();
        assert_eq!(json["kind"], "release");
        assert_eq!(
            serde_json::to_value(Harness::Unreleased).unwrap()["kind"],
            "unreleased"
        );
    }
}
