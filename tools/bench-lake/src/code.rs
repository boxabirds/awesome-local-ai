//! A run's code (story 23, code.readers): the lake's code repository and the names of a run's refs in it, and a
//! working copy of a run's code at a story, checked out from that repository (lakelib.code.workspace).
//! This is the only module that creates or removes anything, and the only one that starts a process (git).
//!
//! `<state>/code.git` is one bare repository beside the lake's roots. A copy of a run has its branches under
//! `refs/runs/<node>/<run>/heads/` and each story's last commit under `refs/runs/<node>/<run>/story/NN`; the node
//! of a reference run is `reference`. dbench fills it (`code-import` from the old bundles, then the collector).

use crate::absent::{Absent, Error, Item, Reason, Refused, RefusedReason};
use crate::layout::{is_run_id, is_valid_part, Lake, RunRef, REFERENCE_LABEL};
use crate::records::story_dir;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

/// The old carrier of a run's code, still in older run folders; `runs` reports whether a copy holds one.
pub const BUNDLE_FILE: &str = "workspace.bundle";
/// The lake's code repository, beside the `collected` and `reference` roots.
pub const CODE_REPO: &str = "code.git";
/// The node segment of a reference run's refs.
pub const REFERENCE_NODE: &str = REFERENCE_LABEL;
pub const RUNS_REFS: &str = "refs/runs";
pub const HEADS: &str = "heads";
pub const STORY: &str = "story";
/// Where the story's commit is put in the working copy, so that it is the only ref there.
const LOCAL_REF: &str = "refs/lake/story";
const NULL_DEVICE: &str = "/dev/null";

/// The node segment of a copy's refs: its node folder, or `reference`.
pub fn node_of(run: &RunRef) -> &str {
    run.node.as_deref().unwrap_or(REFERENCE_NODE)
}

/// A refs path is made only from a node name under the lake's part rule and a run id the lake accepts, so a name can
/// never reach outside `refs/runs/` or another run's refs (`..`, a slash in a node name, a cut-short id).
pub fn check_names(node: &str, run: &str) -> Result<(), String> {
    if !is_valid_part(node) {
        return Err(format!("not a node name: {node:?}"));
    }
    if !is_run_id(run) {
        return Err(format!("not a run id: {run:?}"));
    }
    Ok(())
}

pub fn run_prefix(node: &str, run: &str) -> String {
    format!("{RUNS_REFS}/{node}/{run}")
}

pub fn head_ref(node: &str, run: &str, branch: &str) -> String {
    format!("{}/{HEADS}/{branch}", run_prefix(node, run))
}

/// The story number in two digits, as the story folders.
pub fn story_ref(node: &str, run: &str, story: u32) -> String {
    format!("{}/{STORY}/{story:02}", run_prefix(node, run))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    pub path: PathBuf,
    pub commit: String,
}

/// A git command that sees nothing of the caller's configuration: a cleared environment, no system or global
/// configuration, no prompts, English messages. Only `PATH` is passed on, so that git is found.
pub fn git_command() -> Command {
    let mut c = Command::new("git");
    c.env_clear()
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", NULL_DEVICE)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C");
    if let Some(path) = std::env::var_os("PATH") {
        c.env("PATH", path);
    }
    c
}

/// The path with links resolved as far as it exists, `..` and `.` removed; the rest of the path is kept as it is.
fn resolve(path: &Path) -> io::Result<PathBuf> {
    let absolute = std::path::absolute(path)?;
    let mut resolved = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => resolved.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                resolved.pop();
            }
            Component::Normal(name) => {
                resolved.push(name);
                if let Ok(real) = fs::canonicalize(&resolved) {
                    resolved = real;
                }
            }
        }
    }
    Ok(resolved)
}

fn run_failure(run: &RunRef, story: i64, reason: RefusedReason, message: Option<String>) -> Error {
    Error::Refused(Refused { run: run.id.clone(), node: run.node.clone(), item: Item::Workspace(story), reason, message })
}

fn workspace_absent(run: &RunRef, story: i64, reason: Reason) -> Error {
    Error::Absent(Absent::for_run(run, Item::Workspace(story), reason))
}

/// Makes the folder empty again, or removes it when this call made it.
fn clean_up(dest: &Path, made_by_us: bool) {
    if made_by_us {
        let _ = fs::remove_dir_all(dest);
        return;
    }
    if let Ok(entries) = fs::read_dir(dest) {
        for e in entries.flatten() {
            let p = e.path();
            let _ = if e.file_type().map(|t| t.is_dir()).unwrap_or(false) { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
        }
    }
}

fn message_of(output: &std::process::Output) -> String {
    let text = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if text.is_empty() {
        format!("git exited with {}", output.status)
    } else {
        text
    }
}

impl Lake {
    /// `<state>/code.git`: beside the `collected` root.
    pub fn code_repo(&self) -> PathBuf {
        self.collected.parent().unwrap_or(Path::new("")).join(CODE_REPO)
    }

    /// The commit of the copy's story ref, if the lake's code repository has one.
    fn story_commit(&self, run: &RunRef, story: i64) -> Option<String> {
        let node = node_of(run);
        check_names(node, &run.id).ok()?;
        let reference = story_ref(node, &run.id, u32::try_from(story).ok()?);
        let out = git_command()
            .arg("--git-dir")
            .arg(self.code_repo())
            .args(["rev-parse", "--verify", "--quiet", "--end-of-options", &format!("{reference}^{{commit}}")])
            .output()
            .ok()?;
        let commit = String::from_utf8_lossy(&out.stdout).trim().to_string();
        (out.status.success() && !commit.is_empty()).then_some(commit)
    }

    pub fn workspace(&self, run: &RunRef, story: i64, dest: &Path) -> Result<Workspace, Error> {
        story_dir(story).map_err(|d| workspace_absent(run, story, Reason::BadName(d.to_string())))?;
        // The destination: outside both roots, and empty or not there.
        let target = resolve(dest).map_err(|e| run_failure(run, story, RefusedReason::GitClone, Some(e.to_string())))?;
        for root in [&self.collected, &self.reference] {
            if let Ok(root) = resolve(root) {
                if target.starts_with(&root) {
                    return Err(run_failure(run, story, RefusedReason::DestInsideRoot, None));
                }
            }
        }
        let made_by_us = match fs::symlink_metadata(&target) {
            Err(_) => true,
            Ok(m) if m.is_dir() => {
                let empty = fs::read_dir(&target).map(|mut d| d.next().is_none()).unwrap_or(false);
                if !empty {
                    return Err(run_failure(run, story, RefusedReason::DestNotEmpty, None));
                }
                false
            }
            Ok(_) => return Err(run_failure(run, story, RefusedReason::DestNotEmpty, None)),
        };
        // The story's commit, from the lake's code repository.
        let commit = self
            .story_commit(run, story)
            .ok_or_else(|| Error::Absent(Absent::for_run(run, Item::Code, Reason::NoRef)))?;
        let code = std::path::absolute(self.code_repo())
            .map_err(|e| run_failure(run, story, RefusedReason::GitClone, Some(e.to_string())))?;
        // git: a new repository holding the story's commit and its history only, then the checkout.
        let init = git_command()
            .args(["init", "--quiet", "--template="])
            .arg(&target)
            .output()
            .map_err(|e| run_failure(run, story, RefusedReason::GitClone, Some(e.to_string())))?;
        if !init.status.success() {
            clean_up(&target, made_by_us);
            return Err(run_failure(run, story, RefusedReason::GitClone, Some(message_of(&init))));
        }
        let fetch = git_command()
            .arg("-C")
            .arg(&target)
            .args(["-c", "core.hooksPath=/dev/null", "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "--"])
            .arg(&code)
            .arg(format!("+{}:{LOCAL_REF}", story_ref(node_of(run), &run.id, story as u32)))
            .output()
            .map_err(|e| run_failure(run, story, RefusedReason::GitClone, Some(e.to_string())))?;
        if !fetch.status.success() {
            clean_up(&target, made_by_us);
            return Err(run_failure(run, story, RefusedReason::GitClone, Some(message_of(&fetch))));
        }
        let checkout = git_command()
            .arg("-C")
            .arg(&target)
            .args(["-c", "core.hooksPath=/dev/null", "checkout", "--quiet", "--detach", &commit])
            .output()
            .map_err(|e| run_failure(run, story, RefusedReason::GitCheckout, Some(e.to_string())))?;
        if !checkout.status.success() {
            clean_up(&target, made_by_us);
            return Err(run_failure(run, story, RefusedReason::GitCheckout, Some(message_of(&checkout))));
        }
        Ok(Workspace { path: dest.to_path_buf(), commit })
    }
}
