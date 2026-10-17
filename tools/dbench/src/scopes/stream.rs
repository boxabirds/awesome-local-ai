//! GET /v1/runs/events (docs/design/dbench-scopes/api.md, "Events"): the lines of a run's event streams as the harness
//! wrote them, a page at a time, behind a stateless cursor.
//!
//! **Cursor** `TS:N`: `TS` is the time text of the last event delivered exactly as the file spells it, and `N` is how many
//! events of the file's prefix up to and including that event carry exactly that text. To resume, a reader skips the
//! events of the prefix, counting those whose time text is `TS`, and stops after the `N`th. The cursor is a function of
//! the file's prefix only, so any server can answer it, and a restart loses nothing.
//!
//! **Speed**: counting from byte 0 on every page would read a 100 MB log a hundred times over. The server therefore
//! remembers, per (file, TS, N), the byte offset just after that event (`HINTS`). The memory is only a shortcut: a
//! hint is used only if the file is the same one (inode), is not shorter than the offset, and the line ending at the
//! offset still has time text `TS`; otherwise the file is read from byte 0. A hint is stored only for a prefix whose
//! times strictly increase from one time text to the next (equal texts are then contiguous, so a run length is the
//! count). A file that breaks that (a lower time, two spellings of one time, a line without a time) takes the exact path,
//! which counts every time text of the prefix in a map. Both paths give the same cursor, and the same events, by
//! construction; tests/scopes_stream.rs holds them to it.
//!
//! **What is returned**: only complete lines (ending in a newline) that are JSON objects, in file order. A last line
//! without its newline waits until it is finished. A complete line that is not a JSON object (blank, torn, an array) is
//! skipped and never counted.

use axum::body::Body;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;
use std::collections::HashMap;
use std::fmt;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::os::unix::fs::{FileExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

use crate::collect::{self, Source};
use crate::scopes::finality;
use crate::server::{Shared, E_BAD_RUN_ID, E_OUTSIDE_RUN, E_RUN_NOT_FOUND};

pub const E_BAD_CURSOR: &str = "E-BAD-CURSOR";
pub const E_BAD_STREAM: &str = "E-BAD-STREAM";

/// Events in a page when the caller names no limit.
pub const DEFAULT_LIMIT: usize = 1000;
/// The most events one page holds, whatever the caller asks.
pub const MAX_LIMIT: usize = 10_000;
/// Read-ahead for the file reader.
const READ_BUF_BYTES: usize = 256 * 1024;
/// Positions remembered at most; the table is emptied when it is full (a shortcut, never a record).
const HINTS_MAX: usize = 4096;
/// The longest story number accepted (the harness numbers stories in two digits).
const STORY_DIGITS_MAX: usize = 9;
const AGENT_NAME: &str = "agent";
const CONDITIONS_NAME: &str = "conditions";
const EGRESS_NAME: &str = "egress";
const AGENT_TIME_KEY: &str = "_rx";
const CONDITIONS_TIME_KEY: &str = "t";
const EGRESS_TIME_KEY: &str = "t";

// ---- cursor ----

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Cursor {
    /// The time text of the last event delivered, as written in the file ("" for an event with no time).
    pub ts: String,
    /// How many events of the delivered prefix carry exactly this time text (at least 1).
    pub n: u64,
}

impl Cursor {
    /// `TS:N`. `TS` may hold only what a JSON number is written with; `N` is a positive decimal number.
    pub fn parse(s: &str) -> Option<Cursor> {
        let (ts, n) = s.rsplit_once(':')?;
        let ts_ok = ts
            .bytes()
            .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'+' | b'e' | b'E'));
        let n_ok = !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit());
        if !ts_ok || !n_ok {
            return None;
        }
        let n: u64 = n.parse().ok()?;
        (n > 0).then(|| Cursor {
            ts: ts.to_string(),
            n,
        })
    }
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}:{}", self.ts, self.n)
    }
}

// ---- one line ----

/// The line without its newline, if it is a JSON object. Nothing else is an event.
fn event_of(raw: &[u8]) -> Option<&str> {
    let line = std::str::from_utf8(raw.strip_suffix(b"\n")?).ok()?;
    if !line.trim_start().starts_with('{') {
        return None;
    }
    serde_json::from_str::<serde::de::IgnoredAny>(line).ok()?;
    Some(line)
}

/// The text of the number under top-level key `key` in a line known to be one JSON object, exactly as written. The
/// last one wins when the key repeats (as a parse would have it). None when the key is absent or holds no number.
pub fn time_text<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let b = line.as_bytes();
    let mut i = skip_ws(b, 0);
    if b.get(i) != Some(&b'{') {
        return None;
    }
    i += 1;
    let mut found = None;
    loop {
        i = skip_ws(b, i);
        match b.get(i)? {
            b'}' => return found,
            b',' => i += 1,
            b'"' => {
                let key_end = skip_string(b, i)?;
                let is_key = &line[i + 1..key_end - 1] == key;
                i = skip_ws(b, key_end);
                if b.get(i) != Some(&b':') {
                    return None;
                }
                i = skip_ws(b, i + 1);
                let end = skip_value(b, i)?;
                if is_key {
                    let text = &line[i..end];
                    found = matches!(b[i], b'-' | b'0'..=b'9').then_some(text);
                }
                i = end;
            }
            _ => return None,
        }
    }
}

fn skip_ws(b: &[u8], mut i: usize) -> usize {
    while b.get(i).is_some_and(|c| c.is_ascii_whitespace()) {
        i += 1;
    }
    i
}

/// Index just past the string that opens at `i`.
fn skip_string(b: &[u8], i: usize) -> Option<usize> {
    let mut j = i + 1;
    loop {
        match b.get(j)? {
            b'\\' => j += 2,
            b'"' => return Some(j + 1),
            _ => j += 1,
        }
    }
}

/// Index just past the value that starts at `i`.
fn skip_value(b: &[u8], i: usize) -> Option<usize> {
    match b.get(i)? {
        b'"' => skip_string(b, i),
        b'{' | b'[' => {
            let mut depth = 0usize;
            let mut j = i;
            while let Some(c) = b.get(j) {
                match c {
                    b'"' => {
                        j = skip_string(b, j)?;
                        continue;
                    }
                    b'{' | b'[' => depth += 1,
                    b'}' | b']' => {
                        depth -= 1;
                        if depth == 0 {
                            return Some(j + 1);
                        }
                    }
                    _ => {}
                }
                j += 1;
            }
            None
        }
        _ => {
            let mut j = i;
            while b
                .get(j)
                .is_some_and(|c| !matches!(c, b',' | b'}' | b']') && !c.is_ascii_whitespace())
            {
                j += 1;
            }
            Some(j)
        }
    }
}

// ---- remembered positions ----

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct HintKey {
    path: PathBuf,
    cursor: Cursor,
}

#[derive(Debug, Clone)]
struct Hint {
    ino: u64,
    /// Byte offset just after the event the cursor names.
    offset: u64,
    /// Where that event's line starts.
    line_start: u64,
}

static HINTS: LazyLock<Mutex<HashMap<HintKey, Hint>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Forget every remembered position. The next page of every cursor then starts from byte 0.
pub fn forget_hints() {
    HINTS.lock().unwrap_or_else(|e| e.into_inner()).clear();
}

fn remember(path: &Path, cursor: &Cursor, hint: Hint) {
    let mut map = HINTS.lock().unwrap_or_else(|e| e.into_inner());
    if map.len() >= HINTS_MAX {
        map.clear();
    }
    map.insert(
        HintKey {
            path: path.to_path_buf(),
            cursor: cursor.clone(),
        },
        hint,
    );
}

/// The remembered position of `cursor`, if the file is still the one it was taken from.
fn recall(
    path: &Path,
    key: &str,
    cursor: &Cursor,
    file: &File,
    ino: u64,
    len: u64,
) -> Option<Hint> {
    let hint = HINTS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&HintKey {
            path: path.to_path_buf(),
            cursor: cursor.clone(),
        })
        .cloned()?;
    if hint.ino != ino || hint.offset > len || hint.line_start >= hint.offset {
        return None;
    }
    let mut last = vec![0u8; usize::try_from(hint.offset - hint.line_start).ok()?];
    file.read_exact_at(&mut last, hint.line_start).ok()?;
    let line = event_of(&last)?;
    (time_text(line, key)? == cursor.ts).then_some(hint)
}

// ---- paging ----

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Page {
    /// The lines as the file holds them, newline removed.
    pub lines: Vec<String>,
    /// Where to resume. None only when nothing has ever been delivered and no cursor was given.
    pub next: Option<Cursor>,
}

/// Up to `limit` events of the file at `path` after `after` (the start when None), in file order. A missing file is an
/// empty page. `time_key` names the number whose text the cursor carries.
pub fn read_page(
    path: &Path,
    time_key: &'static str,
    after: Option<&Cursor>,
    limit: usize,
) -> std::io::Result<Page> {
    let empty = Page {
        lines: vec![],
        next: after.cloned(),
    };
    if limit == 0 {
        return Ok(empty);
    }
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(empty),
        Err(e) => return Err(e),
    };
    if let Some(page) = fast(path, file.try_clone()?, time_key, after, limit)? {
        return Ok(page);
    }
    exact(file, time_key, after, limit)
}

/// The monotone path: resumes from a remembered offset or skips from byte 0, with a run length for the count. Gives up
/// (None) at the first line that is not strictly later than the one before, or has no time.
fn fast(
    path: &Path,
    mut file: File,
    key: &str,
    after: Option<&Cursor>,
    limit: usize,
) -> std::io::Result<Option<Page>> {
    let meta = file.metadata()?;
    let (ino, len) = (meta.ino(), meta.len());
    let (mut offset, mut run_ts, mut run_n, mut prev) = (0u64, None::<String>, 0u64, None::<f64>);
    let mut skipping = after.cloned();
    if let Some(c) = after {
        if let (Some(h), Ok(t)) = (recall(path, key, c, &file, ino, len), c.ts.parse::<f64>()) {
            (offset, run_ts, run_n, prev, skipping) =
                (h.offset, Some(c.ts.clone()), c.n, Some(t), None);
        }
    }
    file.seek(SeekFrom::Start(offset))?;
    let mut reader = BufReader::with_capacity(READ_BUF_BYTES, file);
    let (mut buf, mut lines) = (Vec::new(), Vec::new());
    let mut last = (0u64, 0u64);
    loop {
        buf.clear();
        let n = reader.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        let line_start = offset;
        offset += n as u64;
        let Some(line) = event_of(&buf) else { continue };
        let Some(text) = time_text(line, key) else {
            return Ok(None);
        };
        let Ok(t) = text.parse::<f64>() else {
            return Ok(None);
        };
        if run_ts.as_deref() == Some(text) {
            run_n += 1;
        } else {
            if prev.is_some_and(|p| t <= p) {
                return Ok(None);
            }
            run_ts = Some(text.to_string());
            run_n = 1;
        }
        prev = Some(t);
        if let Some(c) = &skipping {
            if c.ts == text && c.n == run_n {
                skipping = None;
            }
            continue;
        }
        lines.push(line.to_string());
        last = (line_start, offset);
        if lines.len() == limit {
            break;
        }
    }
    if skipping.is_some() {
        // the cursor is ahead of this file
        return Ok(Some(Page {
            lines: vec![],
            next: after.cloned(),
        }));
    }
    let next = match (lines.is_empty(), run_ts) {
        (false, Some(ts)) => {
            let cursor = Cursor { ts, n: run_n };
            remember(
                path,
                &cursor,
                Hint {
                    ino,
                    offset: last.1,
                    line_start: last.0,
                },
            );
            Some(cursor)
        }
        _ => after.cloned(),
    };
    Ok(Some(Page { lines, next }))
}

/// The reference path: from byte 0, counting every time text of the prefix.
fn exact(mut file: File, key: &str, after: Option<&Cursor>, limit: usize) -> std::io::Result<Page> {
    file.seek(SeekFrom::Start(0))?;
    let mut reader = BufReader::with_capacity(READ_BUF_BYTES, file);
    let (mut buf, mut lines) = (Vec::new(), Vec::new());
    let mut counts: HashMap<String, u64> = HashMap::new();
    let mut skipping = after.cloned();
    let mut last_text = String::new();
    loop {
        buf.clear();
        if reader.read_until(b'\n', &mut buf)? == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        let Some(line) = event_of(&buf) else { continue };
        let text = time_text(line, key).unwrap_or("");
        let count = match counts.get_mut(text) {
            Some(c) => {
                *c += 1;
                *c
            }
            None => {
                counts.insert(text.to_string(), 1);
                1
            }
        };
        if let Some(c) = &skipping {
            if c.ts == text && c.n == count {
                skipping = None;
            }
            continue;
        }
        lines.push(line.to_string());
        last_text.clear();
        last_text.push_str(text);
        if lines.len() == limit {
            break;
        }
    }
    if skipping.is_some() || lines.is_empty() {
        return Ok(Page {
            lines: vec![],
            next: after.cloned(),
        });
    }
    let n = counts[&last_text];
    Ok(Page {
        lines,
        next: Some(Cursor { ts: last_text, n }),
    })
}

/// The body of a response: the events laid out one per line, exactly as the file holds them.
pub fn events_body(page: &Page, is_final: bool) -> String {
    let events = if page.lines.is_empty() {
        "[]".to_string()
    } else {
        format!("[\n{}\n]", page.lines.join(",\n"))
    };
    let next = page
        .next
        .as_ref()
        .map_or("null".to_string(), |c| format!("\"{c}\""));
    format!("{{\"events\":{events},\"next\":{next},\"final\":{is_final}}}")
}

// ---- the route ----

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Stream {
    Agent,
    Conditions,
    Egress,
}

impl Stream {
    fn parse(s: &str) -> Option<Stream> {
        match s {
            AGENT_NAME => Some(Stream::Agent),
            CONDITIONS_NAME => Some(Stream::Conditions),
            EGRESS_NAME => Some(Stream::Egress),
            _ => None,
        }
    }

    fn time_key(self) -> &'static str {
        match self {
            Stream::Agent => AGENT_TIME_KEY,
            Stream::Conditions => CONDITIONS_TIME_KEY,
            Stream::Egress => EGRESS_TIME_KEY,
        }
    }

    /// The allow-listed name of the file, relative to the run directory.
    fn file_name(self, story: Option<&str>) -> String {
        match (self, story) {
            (Stream::Agent, Some(s)) => format!("stories/{s}/{}", collect::EVENTS_FILE),
            (Stream::Conditions, Some(s)) => format!("stories/{s}/{}", collect::CONDITIONS_FILE),
            _ => collect::EGRESS_NAME.to_string(),
        }
    }
}

#[derive(Deserialize)]
struct EventsQuery {
    run: String,
    stream: Option<String>,
    story: Option<String>,
    after: Option<String>,
    limit: Option<u64>,
}

fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

/// Whether the stream is final (api.md, "Final, and resumption"): the story's status in metrics.json, the run's
/// run-status.json and the state of the run's newest job, decided by `finality::stream_final`. `egress` is run level.
fn final_for(st: &Shared, run: &str, story: Option<&str>, stream: &str) -> bool {
    let job_label = st.jobs_by_run().remove(run).map(|(_, label)| label);
    let story_number = if stream == EGRESS_NAME { None } else { story.and_then(finality::story_number) };
    finality::stream_final(&st.cfg.repo.join(run), job_label.as_deref(), story_number)
}

enum Located {
    Absent,
    Outside,
    File(PathBuf),
}

/// Where the stream's file is, by the safety rules of `/v1/runs/file`: a link is never followed and a path that leaves
/// the run directory is refused.
fn locate(st: &Shared, run: &str, name: &str) -> Located {
    let Some(file_name) = collect::parse_name(name) else {
        return Located::Absent;
    };
    let run_dir = st.cfg.repo.join(run);
    let Some(path) = collect::resolve(&run_dir, &st.cfg.bench_home, &file_name) else {
        return Located::Absent;
    };
    let Ok(meta) = std::fs::symlink_metadata(&path) else {
        return Located::Absent;
    };
    let in_run_dir = file_name.source() == Source::RunDir;
    let escapes = meta.file_type().is_symlink()
        || (in_run_dir
            && (collect::has_link_below(&run_dir, &path)
                || !collect::is_inside_run(&run_dir, &path)));
    if escapes {
        Located::Outside
    } else if meta.is_file() {
        Located::File(path)
    } else {
        Located::Absent
    }
}

async fn events(State(st): State<Arc<Shared>>, Query(q): Query<EventsQuery>) -> Response {
    // the run, as /v1/runs/files names it
    if !crate::ids::valid_run_dir(&q.run) {
        return err(
            StatusCode::BAD_REQUEST,
            format!("{E_BAD_RUN_ID}: not a run directory path: {:?}", q.run),
        );
    }
    if collect::is_run_dir(&st.cfg.repo, &q.run).is_none() {
        return err(
            StatusCode::NOT_FOUND,
            format!("{E_RUN_NOT_FOUND}: no run {} on this node", q.run),
        );
    }
    let Some(stream) = q.stream.as_deref().and_then(Stream::parse) else {
        return err(
            StatusCode::BAD_REQUEST,
            format!(
                "{E_BAD_STREAM}: stream= is one of {AGENT_NAME}, {CONDITIONS_NAME}, {EGRESS_NAME}"
            ),
        );
    };
    let story = q.story.as_deref();
    match (stream, story) {
        (Stream::Egress, Some(_)) => {
            return err(
                StatusCode::BAD_REQUEST,
                format!("{E_BAD_STREAM}: {EGRESS_NAME} is a stream of the run; no story="),
            )
        }
        (Stream::Agent | Stream::Conditions, None) => {
            return err(
                StatusCode::BAD_REQUEST,
                format!("{E_BAD_STREAM}: this stream needs story=NN"),
            )
        }
        (_, Some(s))
            if s.is_empty()
                || s.len() > STORY_DIGITS_MAX
                || !s.bytes().all(|b| b.is_ascii_digit()) =>
        {
            return err(
                StatusCode::BAD_REQUEST,
                format!("{E_BAD_STREAM}: story= is the story's number, digits only"),
            )
        }
        _ => {}
    }
    let after = match q.after.as_deref().map(|a| (a, Cursor::parse(a))) {
        None => None,
        Some((_, Some(c))) => Some(c),
        Some((a, None)) => {
            return err(
                StatusCode::BAD_REQUEST,
                format!("{E_BAD_CURSOR}: after= is TS:N, got {a:?}"),
            )
        }
    };
    let limit = usize::try_from(q.limit.unwrap_or(DEFAULT_LIMIT as u64))
        .unwrap_or(MAX_LIMIT)
        .min(MAX_LIMIT);
    let name = stream.file_name(story);
    let page = match locate(&st, &q.run, &name) {
        Located::Outside => {
            return err(
                StatusCode::NOT_FOUND,
                format!("{E_OUTSIDE_RUN}: {name} is not a file of this run"),
            )
        }
        Located::Absent => Page {
            lines: vec![],
            next: after.clone(),
        },
        Located::File(path) => {
            let key = stream.time_key();
            match tokio::task::spawn_blocking(move || read_page(&path, key, after.as_ref(), limit))
                .await
            {
                Ok(Ok(p)) => p,
                Ok(Err(e)) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
                Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
            }
        }
    };
    let is_final = final_for(&st, &q.run, story, q.stream.as_deref().unwrap_or(""));
    Response::builder()
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(events_body(&page, is_final)))
        .unwrap_or_else(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "response"))
}

pub fn routes() -> Router<Arc<Shared>> {
    Router::new().route("/v1/runs/events", get(events))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_text_is_taken_from_the_top_level_only() {
        let line = r#"{"a":{"_rx":9},"s":"\"_rx\":7","_rx":4.250,"b":[{"_rx":8}]}"#;
        assert_eq!(time_text(line, "_rx"), Some("4.250"));
        assert_eq!(time_text(r#"{"_rx":"7"}"#, "_rx"), None);
        assert_eq!(time_text(r#"{"x":1}"#, "_rx"), None);
        assert_eq!(
            time_text(r#" { "_rx" : 1e9 , "x" : null } "#, "_rx"),
            Some("1e9")
        );
        assert_eq!(time_text(r#"{"_rx":1,"_rx":2.0}"#, "_rx"), Some("2.0"));
    }

    #[test]
    fn cursor_round_trips() {
        for s in ["1791500200.530:3", "1e9:1", "-0.5:12", ":4"] {
            assert_eq!(Cursor::parse(s).unwrap().to_string(), s);
        }
        for s in ["", "1.5", "1.5:0", "1.5:+1", "a:1", "1:1:1", "1.5: 1"] {
            assert!(Cursor::parse(s).is_none(), "{s}");
        }
    }

    #[test]
    fn only_complete_json_objects_are_events() {
        assert!(event_of(b"{\"a\":1}\n").is_some());
        assert!(event_of(b"{\"a\":1}").is_none());
        assert!(event_of(b"[1]\n").is_none());
        assert!(event_of(b"{\"a\":\n").is_none());
        assert!(event_of(b"\n").is_none());
    }
}
