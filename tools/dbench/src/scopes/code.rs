//! GET /v1/runs/code (story 23, code.lake_repo): a run's code as a git bundle of its own repository's branch heads and
//! `story-*` tags, without the commits the caller says it has.
//!
//! `run=` names a run the node lists (the same check as every run route); `have=` is a comma-separated list of commits
//! the caller holds. A have that is not a commit of the run's repository is ignored, so a caller can always send every
//! tip it holds. 200 with the bundle; 204 when nothing is new; 404 for a run the node does not list, or one whose work
//! folder (`work_dir.txt`) is gone or has no repository (`E-CODE-NO-REPO`).
//!
//! The repository is `<work dir>/workspace`, the agent's own: the harness commits each story's end in it and tags it
//! `story-NN`. git runs with bench-lake's `git_command` (no user or system configuration) and writes the bundle to its
//! standard output, so nothing is written on the node.

use anyhow::{bail, Context, Result};
use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::collect::WORK_DIR_FILE;
use crate::scopes::listing::{err, run_of};
use crate::server::Shared;

pub const E_CODE_NO_REPO: &str = "E-CODE-NO-REPO";
/// The agent's repository inside a run's work folder.
pub const WORKSPACE_DIR: &str = "workspace";
/// Branches and the tags the harness puts on each story's last commit.
const STORY_TAGS: &str = "--tags=story-*";
const BUNDLE_MIME: &str = "application/x-git-bundle";
const HAVE_SEPARATOR: char = ',';
/// A have is a commit name in full or abbreviated: hexadecimal, 4 to 40 characters (git's own bounds).
const MIN_HAVE_LEN: usize = 4;
const MAX_HAVE_LEN: usize = 40;
/// git's message when every ref's commits are excluded by the haves.
const EMPTY_BUNDLE: &str = "Refusing to create empty bundle";
const HOME_PREFIX: &str = "~/";

#[derive(Deserialize)]
pub struct CodeQuery {
    pub run: Option<String>,
    pub have: Option<String>,
}

pub fn routes() -> Router<Arc<Shared>> {
    Router::new().route("/v1/runs/code", get(run_code))
}

/// The run's repository: `<work dir>/workspace` when work_dir.txt names a work folder that holds one.
pub fn run_repo(run_dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(run_dir.join(WORK_DIR_FILE)).ok()?;
    let named = text.trim();
    if named.is_empty() {
        return None;
    }
    let work = match named.strip_prefix(HOME_PREFIX) {
        Some(rest) => PathBuf::from(std::env::var_os("HOME")?).join(rest),
        None => PathBuf::from(named),
    };
    let repo = work.join(WORKSPACE_DIR);
    repo.join(".git").exists().then_some(repo)
}

fn is_have(h: &str) -> bool {
    (MIN_HAVE_LEN..=MAX_HAVE_LEN).contains(&h.len()) && h.bytes().all(|b| b.is_ascii_hexdigit())
}

fn git(repo: &Path) -> std::process::Command {
    let mut c = bench_lake::code::git_command();
    c.arg("-C").arg(repo);
    c
}

/// The bundle of the repository's branches and story tags without what the haves reach; None when that is nothing.
pub fn bundle_of(repo: &Path, haves: &[String]) -> Result<Option<Vec<u8>>> {
    let known: Vec<&String> = haves
        .iter()
        .filter(|h| is_have(h))
        .filter(|h| {
            git(repo)
                .args(["cat-file", "-e", &format!("{h}^{{commit}}")])
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .collect();
    let mut cmd = git(repo);
    cmd.args(["bundle", "create", "--quiet", "-", "--branches", STORY_TAGS]);
    for h in known {
        cmd.arg(format!("^{h}"));
    }
    let out = cmd.output().context("run git bundle create")?;
    if out.status.success() {
        return Ok(Some(out.stdout));
    }
    let message = String::from_utf8_lossy(&out.stderr);
    if message.contains(EMPTY_BUNDLE) {
        return Ok(None);
    }
    bail!("git bundle create: {}", message.trim())
}

async fn run_code(State(st): State<Arc<Shared>>, Query(q): Query<CodeQuery>) -> Response {
    let rel = match run_of(&st, q.run.as_deref()) {
        Ok(rel) => rel,
        Err((status, msg)) => return err(status, msg),
    };
    let Some(repo) = run_repo(&st.cfg.repo.join(&rel)) else {
        return err(
            StatusCode::NOT_FOUND,
            format!("{E_CODE_NO_REPO}: run {rel} has no repository on this node"),
        );
    };
    let haves: Vec<String> = q
        .have
        .unwrap_or_default()
        .split(HAVE_SEPARATOR)
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|h| !h.is_empty())
        .collect();
    match tokio::task::spawn_blocking(move || bundle_of(&repo, &haves)).await {
        Ok(Ok(Some(bytes))) => ([(header::CONTENT_TYPE, BUNDLE_MIME)], Body::from(bytes)).into_response(),
        Ok(Ok(None)) => StatusCode::NO_CONTENT.into_response(),
        Ok(Err(e)) => err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}")),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_have_is_four_to_forty_hexadecimal_characters() {
        assert!(is_have("abcd") && is_have(&"f".repeat(40)) && is_have("0123456789"));
        assert!(!is_have("abc") && !is_have(&"f".repeat(41)) && !is_have("not-a-commit") && !is_have(""));
    }
}
