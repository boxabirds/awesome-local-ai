//! A working copy of a run's code at a story, from its bundle (lakelib.code.workspace).
//! This is the only module that creates or removes anything, and the only one that starts a process (git).

use crate::absent::{Absent, Error, Item, Reason, Refused, RefusedReason};
use crate::layout::{Lake, RunRef};
use crate::records::{story_dir, Record};
use crate::{open_regular, FileProblem};
use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

pub const BUNDLE_FILE: &str = "workspace.bundle";
pub const COMMIT_LEN: usize = 40;
pub const DETAIL_NO_COMMIT: &str = "no commit for story";
pub const DETAIL_BAD_COMMIT: &str = "commit is not 40 hexadecimal characters";
pub const DETAIL_COMMIT_NOT_IN_BUNDLE: &str = "commit not in bundle";
const NULL_DEVICE: &str = "/dev/null";

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

fn is_hex_commit(commit: &str) -> bool {
    commit.len() == COMMIT_LEN && commit.bytes().all(|b| b.is_ascii_hexdigit())
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
        // The bundle, then the commit.
        let bundle = std::path::absolute(run.dir.join(BUNDLE_FILE)).map_err(|e| {
            Error::Absent(crate::absent_for(run, Item::Bundle, FileProblem::Unreadable(e)))
        })?;
        match open_regular(&run.dir, Path::new(BUNDLE_FILE)) {
            Ok(_) => {}
            Err(p) => return Err(Error::Absent(crate::absent_for(run, Item::Bundle, p))),
        }
        let metrics = self.value(run, &Record::Metrics).map_err(|mut a| {
            a.item = Item::Workspace(story);
            Error::Absent(a)
        })?;
        let commit = metrics
            .get("stories")
            .and_then(|s| s.get(story.to_string()))
            .and_then(|s| s.get("commit"))
            .and_then(|c| c.as_str())
            .ok_or_else(|| workspace_absent(run, story, Reason::Malformed(DETAIL_NO_COMMIT.to_string())))?
            .to_string();
        if !is_hex_commit(&commit) {
            return Err(workspace_absent(run, story, Reason::Malformed(DETAIL_BAD_COMMIT.to_string())));
        }
        // git: the clone, a check that the commit is in it, the checkout.
        let clone = git_command()
            .args(["-c", "core.hooksPath=/dev/null", "clone", "--quiet", "--no-checkout", "--template=", "--"])
            .arg(&bundle)
            .arg(&target)
            .output()
            .map_err(|e| run_failure(run, story, RefusedReason::GitClone, Some(e.to_string())))?;
        if !clone.status.success() {
            clean_up(&target, made_by_us);
            return Err(run_failure(run, story, RefusedReason::GitClone, Some(message_of(&clone))));
        }
        let mut probe_spec = OsString::from(&commit);
        probe_spec.push("^{commit}");
        let probe = git_command().arg("-C").arg(&target).args(["cat-file", "-e"]).arg(&probe_spec).output();
        if !probe.map(|o| o.status.success()).unwrap_or(false) {
            clean_up(&target, made_by_us);
            return Err(workspace_absent(run, story, Reason::Malformed(DETAIL_COMMIT_NOT_IN_BUNDLE.to_string())));
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
