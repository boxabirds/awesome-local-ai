//! The change feed (story 24, node.changes_feed): what changed on this node after a cursor, so the collector reads a node
//! incrementally instead of describing every run on every pass.
//!
//! `GET /v1/changes?after=<cursor|head>&limit=<n>` lists the files of this node's own runs (`collect::list_runs`, with the
//! allow-list of `collect::manifest_listing`) whose change time (ctime) is after the cursor and at or before the horizon,
//! and the runs whose job changed state in that range, ordered by (change time, key), at most `limit`, with the cursor to
//! ask from next and whether more remain. Only metadata is read: no file is opened.
//!
//! * **Change time** is ctime, which a write, a rename into place and a copy that keeps the mtime all move, so a file
//!   replaced by one carrying an older mtime is still listed.
//! * **The horizon** is the node's now minus `SETTLE_MARGIN_NS`: a write landing at the moment of a look falls after it,
//!   so it is listed by the next look, never skipped.
//! * **A cursor** is `<node_id>.<ns>` (everything changed up to and including `ns` was listed) or `<node_id>.<ns>.<key>`
//!   (everything up to and including that item, mid-page). It is refused (409 `E-CURSOR-REFUSED`) when it names another
//!   node or a time after the node's now (the clock moved back, or the node was restored).
//! * `after=head` lists nothing and returns the horizon: the point a full look starts from.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

use crate::collect;
use crate::scopes::finality;

/// Writes newer than this are left for the next look, so a write at the moment of a look is never skipped.
pub const SETTLE_MARGIN_NS: i64 = 2_000_000_000;
/// Items per page when the request names no limit, and the most a request may ask for.
pub const LIMIT_DEFAULT: usize = 2_000;
pub const LIMIT_MAX: usize = 5_000;
/// `after=head`: no changes, only the cursor a full look starts from.
pub const HEAD: &str = "head";
/// The node's id, made once under its home: a cursor from another node (or a node rebuilt from scratch) is refused.
pub const NODE_ID_FILE: &str = "node-id";
pub const E_CURSOR_REFUSED: &str = "E-CURSOR-REFUSED";
pub const E_BAD_CURSOR: &str = "E-BAD-CURSOR";
pub const E_BAD_LIMIT: &str = "E-BAD-LIMIT";
/// What separates a cursor's parts. A node id never holds it; a key may (only the first two separate).
pub const CURSOR_SEP: char = '.';
const NS_PER_MS: i64 = 1_000_000;
/// Test-only override of the node's clock, in ms (the design's `DBENCH_CHANGES_NOW_MS`).
pub const NOW_ENV: &str = "DBENCH_CHANGES_NOW_MS";

/// A place in the feed's order: everything at or before it has been listed. `key` None means every item at `ns`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Position {
    pub ns: i64,
    pub key: Option<String>,
}

/// A file of a run that changed.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Change {
    pub run: String,
    pub file: String,
    pub size: u64,
    pub changed_ms: i64,
}

/// A run whose job changed state.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RunState {
    pub run: String,
    pub job: Option<String>,
    pub job_state: Option<String>,
    #[serde(rename = "final")]
    pub final_: bool,
    pub changed_ms: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ChangesPage {
    pub node_id: String,
    pub changes: Vec<Change>,
    pub runs: Vec<RunState>,
    pub next: String,
    pub more: bool,
}

/// One entry of the feed, before paging.
#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    File(Change),
    Run(RunState),
}

/// The newest job for a run: its id, state label, and when that state was reached (ns).
#[derive(Debug, Clone, PartialEq)]
pub struct JobMark {
    pub id: String,
    pub label: String,
    pub changed_ns: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CursorError {
    /// Not a cursor: 400.
    Bad(String),
    /// A cursor, but not one this node can continue from: 409.
    Refused(String),
}

/// Every item of the node's own runs, with its change time (ns) and key, unordered: each allow-listed file (key
/// `<run>/<file>`) and each run with a job (key `<run>/`, which no file's key can equal). A run's `final_` is left false
/// here and worked out by `changes_after` only for the runs a page lists, so no file is opened for the others.
pub fn items(
    repo: &Path,
    share_dir: &Path,
    bench_home: &Path,
    jobs: &HashMap<String, JobMark>,
) -> Vec<(i64, String, Item)> {
    let mut out = Vec::new();
    for run in collect::list_runs(repo, share_dir) {
        let (files, _) = collect::listed_files(&repo.join(&run), bench_home);
        for f in files {
            let key = format!("{run}/{}", f.entry.name);
            let change = Change {
                run: run.clone(),
                file: f.entry.name,
                size: f.entry.size,
                changed_ms: ms(f.changed_ns),
            };
            out.push((f.changed_ns, key, Item::File(change)));
        }
        if let Some(job) = jobs.get(&run) {
            let state = RunState {
                run: run.clone(),
                job: Some(job.id.clone()),
                job_state: Some(job.label.clone()),
                final_: false,
                changed_ms: ms(job.changed_ns),
            };
            out.push((job.changed_ns, format!("{run}/"), Item::Run(state)));
        }
    }
    out
}

/// Whether the item at (`ns`, `key`) comes after `pos` in the feed's order.
fn is_after(ns: i64, key: &str, pos: &Position) -> bool {
    ns > pos.ns || (ns == pos.ns && pos.key.as_deref().is_some_and(|k| key > k))
}

/// The page of `items` after `after`, at or before `horizon_ns`, ordered by (ns, key), at most `limit`.
pub fn page(
    items: Vec<(i64, String, Item)>,
    node_id: &str,
    after: &Position,
    horizon_ns: i64,
    limit: usize,
) -> ChangesPage {
    let mut due: Vec<(i64, String, Item)> = items
        .into_iter()
        .filter(|(ns, key, _)| *ns <= horizon_ns && is_after(*ns, key, after))
        .collect();
    due.sort_by(|a, b| (a.0, &a.1).cmp(&(b.0, &b.1)));
    let more = due.len() > limit;
    due.truncate(limit);
    let next = match due.last() {
        Some((ns, key, _)) if more => Position {
            ns: *ns,
            key: Some(key.clone()),
        },
        _ => Position {
            ns: horizon_ns,
            key: None,
        },
    };
    let (mut changes, mut runs) = (Vec::new(), Vec::new());
    for (_, _, item) in due {
        match item {
            Item::File(c) => changes.push(c),
            Item::Run(r) => runs.push(r),
        }
    }
    ChangesPage {
        node_id: node_id.to_string(),
        changes,
        runs,
        next: cursor_text(node_id, &next),
        more,
    }
}

/// The page of this node's changes after `after`.
#[allow(clippy::too_many_arguments)]
pub fn changes_after(
    repo: &Path,
    share_dir: &Path,
    bench_home: &Path,
    jobs: &HashMap<String, JobMark>,
    node_id: &str,
    after: &Position,
    horizon_ns: i64,
    limit: usize,
) -> ChangesPage {
    let mut out = page(
        items(repo, share_dir, bench_home, jobs),
        node_id,
        after,
        horizon_ns,
        limit,
    );
    for r in &mut out.runs {
        r.final_ = finality::Assessment::read(&repo.join(&r.run), r.job_state.as_deref()).run_final;
    }
    out
}

/// `after=head`: nothing listed, `next` the horizon.
pub fn head(node_id: &str, horizon_ns: i64) -> ChangesPage {
    page(
        Vec::new(),
        node_id,
        &Position {
            ns: horizon_ns,
            key: None,
        },
        horizon_ns,
        LIMIT_DEFAULT,
    )
}

/// The horizon for a look made at `now_ns`.
pub fn horizon(now_ns: i64) -> i64 {
    now_ns - SETTLE_MARGIN_NS
}

pub fn cursor_text(node_id: &str, pos: &Position) -> String {
    match &pos.key {
        None => format!("{node_id}{CURSOR_SEP}{}", pos.ns),
        Some(key) => format!("{node_id}{CURSOR_SEP}{}{CURSOR_SEP}{key}", pos.ns),
    }
}

/// A cursor this node can continue from, or why not.
pub fn parse_cursor(text: &str, node_id: &str, now_ns: i64) -> Result<Position, CursorError> {
    let mut parts = text.splitn(3, CURSOR_SEP);
    let (Some(id), Some(ns)) = (parts.next(), parts.next()) else {
        return Err(CursorError::Bad(format!(
            "{E_BAD_CURSOR}: not <node>.<time>[.<key>]: {text:?}"
        )));
    };
    let key = parts.next().map(String::from);
    let ns: i64 = ns
        .parse()
        .map_err(|_| CursorError::Bad(format!("{E_BAD_CURSOR}: time is not a number: {text:?}")))?;
    if id.is_empty() || key.as_deref() == Some("") {
        return Err(CursorError::Bad(format!(
            "{E_BAD_CURSOR}: empty part: {text:?}"
        )));
    }
    if id != node_id {
        return Err(CursorError::Refused(format!(
            "{E_CURSOR_REFUSED}: the cursor is from node {id}, this is {node_id}"
        )));
    }
    if ns > now_ns {
        return Err(CursorError::Refused(format!(
            "{E_CURSOR_REFUSED}: the cursor's time is after this node's clock (moved back, or the node was restored)"
        )));
    }
    Ok(Position { ns, key })
}

/// This node's id, made once under `home` (`NODE_ID_FILE`) and read after: hex, so it never holds `CURSOR_SEP`.
pub fn node_id(home: &Path) -> std::io::Result<String> {
    let path = home.join(NODE_ID_FILE);
    if let Ok(text) = std::fs::read_to_string(&path) {
        let id = text.trim();
        if !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(id.to_string());
        }
    }
    let seed = format!("{}-{}-{}", std::process::id(), home.display(), now_ns());
    let id = format!("{:016x}", collect::fnv1a64(seed.as_bytes()));
    std::fs::create_dir_all(home)?;
    let tmp = home.join(format!(".{NODE_ID_FILE}.partial"));
    std::fs::write(&tmp, &id)?;
    std::fs::rename(&tmp, &path)?;
    Ok(id)
}

/// The node's clock, ns since the epoch. `DBENCH_CHANGES_NOW_MS` sets it, for the tests of a clock that moved back.
pub fn now_ns() -> i64 {
    if let Some(ms) = std::env::var(NOW_ENV)
        .ok()
        .and_then(|v| v.parse::<i64>().ok())
    {
        return ms.saturating_mul(NS_PER_MS);
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| i64::try_from(d.as_nanos()).unwrap_or(i64::MAX))
}

/// Change time in ms, as the page reports it.
pub fn ms(ns: i64) -> i64 {
    ns.div_euclid(NS_PER_MS)
}

#[cfg(test)]
#[path = "changes_test.rs"]
mod tests;
