//! GET /v1/runs/scopes (docs/design/dbench-scopes/api.md, "Listing"): what a run has produced so far, in three scopes,
//! each with its `final` flag. Names come from `collect::manifest_listing`, the one allow-list; nothing is added here.

use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Arc;

use crate::collect::{self, FileEntry, CONDITIONS_FILE, EGRESS_NAME, EVENTS_FILE, STORIES_DIR};
use crate::scopes::finality::{self, Assessment, StoryView};
use crate::server::{self, Shared, E_BAD_RUN_ID};

/// Stream names as the listing and the events route call them.
pub const STREAM_AGENT: &str = "agent";
pub const STREAM_CONDITIONS: &str = "conditions";
pub const STREAM_EGRESS: &str = "egress";
/// The key that holds an event's time in each stream's lines.
pub const AGENT_TIME_KEY: &str = "_rx";
pub const CONDITIONS_TIME_KEY: &str = "t";
pub const EGRESS_TIME_KEY: &str = "t";

/// How much of a log is read at a time when looking for its first or last line.
const BLOCK_BYTES: u64 = 64 * 1024;
/// The longest first or last line looked for. A line longer than this has no bound reported.
const MAX_LINE_SEARCH_BYTES: u64 = 64 * 1024 * 1024;
/// How many complete lines from the end are tried for a time before the bound is reported as null.
const TAIL_LINES_TRIED: usize = 8;

pub fn routes() -> Router<Arc<Shared>> {
    Router::new().route("/v1/runs/scopes", get(scopes))
}

#[derive(Deserialize)]
struct ScopesQuery {
    run: Option<String>,
}

pub(crate) fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

/// The run named in `run=`, checked by the same function `/v1/runs/files` uses.
pub(crate) fn run_of(st: &Shared, run: Option<&str>) -> Result<String, (StatusCode, String)> {
    let Some(run) = run else {
        return Err((StatusCode::BAD_REQUEST, format!("{E_BAD_RUN_ID}: run= names the run directory")));
    };
    server::named_run(st, run)
}

/// The story a listed name belongs to: `stories/NN/...` is story NN's, anything else is the run's.
pub(crate) fn story_of_name(name: &str) -> Option<u32> {
    let mut segs = name.split('/');
    if segs.next() != Some(STORIES_DIR) {
        return None;
    }
    let n = segs.next().and_then(finality::story_number)?;
    // `stories/NN` alone is a folder, not a file of the story.
    segs.next().map(|_| n)
}

/// Which stream a listed name is, if it is one: the run's `egress.jsonl`, or a story's `agent-events.jsonl` or
/// `conditions.jsonl`.
fn stream_of_name(name: &str) -> Option<(&'static str, &'static str)> {
    if name == EGRESS_NAME {
        return Some((STREAM_EGRESS, EGRESS_TIME_KEY));
    }
    story_of_name(name)?;
    let leaf = name.rsplit('/').next()?;
    let depth = name.split('/').count();
    // Only the file directly in the story folder: `stories/NN/<leaf>`.
    match (depth, leaf) {
        (3, EVENTS_FILE) => Some((STREAM_AGENT, AGENT_TIME_KEY)),
        (3, CONDITIONS_FILE) => Some((STREAM_CONDITIONS, CONDITIONS_TIME_KEY)),
        _ => None,
    }
}

fn file_json(f: &FileEntry, final_: bool) -> Value {
    json!({ "name": f.name, "size": f.size, "mtime": f.mtime, "final": final_ })
}

async fn scopes(State(st): State<Arc<Shared>>, Query(q): Query<ScopesQuery>) -> Response {
    let rel = match run_of(&st, q.run.as_deref()) {
        Ok(rel) => rel,
        Err((status, msg)) => return err(status, msg),
    };
    let job = st.jobs_by_run().remove(&rel);
    Json(build(&st, &rel, job)).into_response()
}

/// The listing of one run. `job` is the newest job for the run: (id, state label).
pub(crate) fn build(st: &Shared, rel: &str, job: Option<(String, String)>) -> Value {
    let run_dir = st.cfg.repo.join(rel);
    let (job_id, job_label) = job.unzip();
    let a = Assessment::read(&run_dir, job_label.as_deref());
    let listing = collect::manifest_listing(&run_dir, &st.cfg.bench_home);

    let mut run_files: Vec<Value> = Vec::new();
    let mut run_streams: Vec<Value> = Vec::new();
    let mut story_files: BTreeMap<u32, Vec<Value>> = BTreeMap::new();
    let mut story_streams: BTreeMap<u32, Vec<Value>> = BTreeMap::new();
    for f in &listing.files {
        let story = story_of_name(&f.name);
        let view = story.map(|n| a.story(n));
        let final_ = view.map_or(a.run_final, |v| v.final_);
        match stream_of_name(&f.name) {
            Some((stream, key)) => {
                let (first_ts, last_ts) = bounds_of(&run_dir, &st.cfg.bench_home, &f.name, key);
                let entry = json!({
                    "stream": stream,
                    "final": finality::stream_is_final(a.run_final, view),
                    "first_ts": first_ts,
                    "last_ts": last_ts,
                });
                match story {
                    Some(n) => story_streams.entry(n).or_default().push(entry),
                    None => run_streams.push(entry),
                }
            }
            None => match story {
                Some(n) => story_files.entry(n).or_default().push(file_json(f, final_)),
                None => run_files.push(file_json(f, final_)),
            },
        }
    }

    let stories: Vec<Value> = a
        .stories
        .keys()
        .copied()
        .chain(story_files.keys().copied())
        .chain(story_streams.keys().copied())
        .collect::<std::collections::BTreeSet<u32>>()
        .into_iter()
        .map(|n| {
            let StoryView { state, final_ } = a.story(n);
            json!({
                "n": n,
                "state": state.label(),
                "final": final_,
                "files": story_files.remove(&n).unwrap_or_default(),
                "streams": story_streams.remove(&n).unwrap_or_default(),
            })
        })
        .collect();

    json!({
        "run": rel,
        "job": job_id,
        "run_state": a.run_state.label(),
        "job_state": job_label,
        "final": a.run_final,
        "files": run_files,
        "streams": run_streams,
        "stories": stories,
    })
}

/// First and last event time of a stream, read from the head and the tail of its file only. Null for a bound the log
/// cannot give (empty, no complete line, no time in it, or a link).
fn bounds_of(run_dir: &Path, bench_home: &Path, name: &str, key: &str) -> (Value, Value) {
    let Some(file_name) = collect::parse_name(name) else {
        return (Value::Null, Value::Null);
    };
    let Some(path) = collect::resolve(run_dir, bench_home, &file_name) else {
        return (Value::Null, Value::Null);
    };
    // The same link rules as the file route: nothing is opened that the route would refuse.
    if file_name.source() == collect::Source::RunDir
        && (collect::has_link_below(run_dir, &path) || !collect::is_inside_run(run_dir, &path))
    {
        return (Value::Null, Value::Null);
    }
    match std::fs::File::open(&path) {
        Ok(f) => time_bounds(f, key),
        Err(_) => (Value::Null, Value::Null),
    }
}

fn time_of(line: &[u8], key: &str) -> Option<Value> {
    let v: Value = serde_json::from_slice(line).ok()?;
    let t = v.get(key)?;
    (t.is_number() || t.is_string()).then(|| t.clone())
}

/// The first line's time and the last complete line's time of a log. A last line without its newline is not an event
/// yet and is skipped.
pub(crate) fn time_bounds(mut f: std::fs::File, key: &str) -> (Value, Value) {
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return (Value::Null, Value::Null);
    };
    (first_time(&mut f, len, key).unwrap_or(Value::Null), last_time(&mut f, len, key).unwrap_or(Value::Null))
}

fn first_time(f: &mut std::fs::File, len: u64, key: &str) -> Option<Value> {
    f.seek(SeekFrom::Start(0)).ok()?;
    let mut buf: Vec<u8> = Vec::new();
    let mut block = vec![0u8; BLOCK_BYTES as usize];
    while (buf.len() as u64) < len.min(MAX_LINE_SEARCH_BYTES) {
        let n = f.read(&mut block).ok()?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&block[..n]);
        if let Some(end) = buf.iter().position(|&b| b == b'\n') {
            return time_of(&buf[..end], key);
        }
    }
    None
}

fn last_time(f: &mut std::fs::File, len: u64, key: &str) -> Option<Value> {
    let mut buf: Vec<u8> = Vec::new();
    let mut start = len;
    // Read blocks backwards until enough complete lines are in hand, the start of the file is reached, or the search cap.
    loop {
        let complete = buf.iter().rposition(|&b| b == b'\n').map_or(0, |end| buf[..end].iter().filter(|&&b| b == b'\n').count());
        if start == 0 || complete > TAIL_LINES_TRIED || (len - start) >= MAX_LINE_SEARCH_BYTES {
            break;
        }
        let take = BLOCK_BYTES.min(start);
        start -= take;
        f.seek(SeekFrom::Start(start)).ok()?;
        let mut block = vec![0u8; take as usize];
        f.read_exact(&mut block).ok()?;
        block.extend_from_slice(&buf);
        buf = block;
    }
    let end = buf.iter().rposition(|&b| b == b'\n')?;
    let mut lines: Vec<&[u8]> = buf[..end].split(|&b| b == b'\n').collect();
    // Unless the whole file is in hand, the first line of the window may be cut.
    if start > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    lines.iter().rev().take(TAIL_LINES_TRIED).find_map(|l| time_of(l, key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Block-size multiples used to put a line across read boundaries.
    const LONG_LINE_BYTES: usize = 3 * 64 * 1024 + 17;

    fn bounds(content: &[u8]) -> (Value, Value) {
        let path = std::env::temp_dir().join(format!("dbench-bounds-{}-{}", std::process::id(), content.len()));
        std::fs::File::create(&path).unwrap().write_all(content).unwrap();
        let out = time_bounds(std::fs::File::open(&path).unwrap(), "t");
        std::fs::remove_file(&path).unwrap();
        out
    }

    fn num(x: f64) -> Value {
        serde_json::json!(x)
    }

    #[test]
    fn lines_longer_than_a_block_give_their_times() {
        let pad = "x".repeat(LONG_LINE_BYTES);
        let text = format!("{{\"t\":1.5,\"p\":\"{pad}\"}}\n{{\"t\":2.5,\"p\":\"{pad}\"}}\n{{\"t\":3.5,\"p\":\"{pad}\"}}\n");
        assert_eq!(bounds(text.as_bytes()), (num(1.5), num(3.5)));
    }

    #[test]
    fn a_log_with_no_complete_line_has_null_bounds() {
        assert_eq!(bounds(b""), (Value::Null, Value::Null));
        assert_eq!(bounds(b"{\"t\":1.5"), (Value::Null, Value::Null));
    }

    #[test]
    fn one_complete_line_is_both_bounds_and_a_trailing_partial_is_ignored() {
        assert_eq!(bounds(b"{\"t\":1.5}\n{\"t\":2"), (num(1.5), num(1.5)));
    }

    #[test]
    fn a_last_line_that_is_not_json_or_has_no_time_falls_back_to_the_one_before() {
        assert_eq!(bounds(b"{\"t\":1.5}\n{\"t\":2.5}\nnot json\n{\"x\":1}\n"), (num(1.5), num(2.5)));
    }

    #[test]
    fn story_and_stream_names_are_told_apart() {
        assert_eq!(story_of_name("stories/01/gate.json"), Some(1));
        assert_eq!(story_of_name("stories/12/artifacts/a/b.png"), Some(12));
        assert_eq!(story_of_name("metrics.json"), None);
        assert_eq!(story_of_name("rescore/v1/stories/01/x"), None);
        assert_eq!(stream_of_name("egress.jsonl"), Some((STREAM_EGRESS, "t")));
        assert_eq!(stream_of_name("stories/01/agent-events.jsonl"), Some((STREAM_AGENT, "_rx")));
        assert_eq!(stream_of_name("stories/01/conditions.jsonl"), Some((STREAM_CONDITIONS, "t")));
        assert_eq!(stream_of_name("stories/01/artifacts/agent-events.jsonl"), None);
        assert_eq!(stream_of_name("server.log"), None);
    }
}
