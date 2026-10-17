//! The scope collector: `dbench collect --scopes`. The same lake as the old pass, filled through the scope API
//! (docs/design/dbench-scopes/api.md) instead of by whole-file ranges.
//!
//! * An **event stream** (`agent`, `conditions`, `egress`) is read by cursor: `GET /v1/runs/events` after the cursor of the
//!   last event the lake holds, until a page comes back empty. Each event is written as the node sent it, one per line, so
//!   the lake's file is the node's file made of its complete event lines. The cursor is not kept in the node's keeping and
//!   not trusted from memory alone: it is a function of the lake's own file (`stream::scan_file`), and the note's copy of
//!   it is a shortcut that is used only while the file still has the length the note recorded.
//! * The **files** of the story and run scopes are listed by `GET /v1/runs/scopes` and pulled by `GET /v1/runs/scope-file`
//!   with the old pull code (`collector::pull_planned`): one implementation of range, prefix check and blob.
//! * A run is **complete** when the node says the run is final, every stream was read to its end after that, every file is
//!   held to its end, and a look after the grace found nothing new. The grace covers the node working out `final` after it
//!   reads a stream: the route works the flag out first, so a stream that says final has no unread line, and the second look
//!   is the guard for a node that does not.
//!
//! What is deliberately different from the old pass, each pinned by a test: a last line without its newline, and a complete
//! line that is not a JSON object, never reach the lake (the node's route never returns them).

use anyhow::{bail, ensure, Context, Result};
use serde::Deserialize;
use serde_json::value::RawValue;
use serde_json::Value;
use std::io::Write;
use std::path::Path;

use crate::client::{Api, RunRef};
use crate::collect::{self, Class, FileEntry, Manifest, RunStatus};
use crate::collector::{self, Cadence, Collected, Collection, RunSummary};
use crate::scopes::stream;

/// The collector refuses a node's answer that breaks the contract: an event with a line break in it, a cursor that does not
/// move after events were delivered.
pub const E_BAD_EVENTS: &str = "E-BAD-EVENTS";
/// Events asked for in one request: the most a node gives.
pub const PAGE_EVENTS: usize = stream::MAX_LIMIT;
/// Pages one stream gets in one pass. A stream that is still not at its end goes on in the next pass, so one busy stream
/// cannot hold a pass over every other node and run.
pub const MAX_PAGES_PER_STREAM_PASS: usize = 64;
/// The story folders are numbered with two digits.
const STORY_DIGITS: usize = 2;
const STREAM_AGENT: &str = "agent";
const STREAM_CONDITIONS: &str = "conditions";
const STREAM_EGRESS: &str = "egress";

// ---- what the node says ----

#[derive(Debug, Clone, Deserialize)]
pub struct ListedFile {
    pub name: String,
    pub size: u64,
    pub mtime: f64,
    #[serde(rename = "final")]
    pub final_: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListedStream {
    pub stream: String,
    #[serde(rename = "final")]
    pub final_: bool,
    #[serde(default)]
    pub first_ts: Value,
    #[serde(default)]
    pub last_ts: Value,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ListedStory {
    pub n: u32,
    pub state: String,
    #[serde(rename = "final")]
    pub final_: bool,
    #[serde(default)]
    pub files: Vec<ListedFile>,
    #[serde(default)]
    pub streams: Vec<ListedStream>,
}

/// `GET /v1/runs/scopes`.
#[derive(Debug, Clone, Deserialize)]
pub struct Listing {
    pub run: String,
    pub job: Option<String>,
    pub run_state: String,
    pub job_state: Option<String>,
    #[serde(rename = "final")]
    pub final_: bool,
    #[serde(default)]
    pub files: Vec<ListedFile>,
    #[serde(default)]
    pub streams: Vec<ListedStream>,
    #[serde(default)]
    pub stories: Vec<ListedStory>,
}

/// One stream to read: where its file is in the lake and what the node says of it.
#[derive(Debug, Clone)]
pub struct StreamTarget {
    pub stream: &'static str,
    /// The two-digit story folder; None for the run's `egress`.
    pub story: Option<String>,
    /// The run-relative name of the file, on the node and in the lake.
    pub name: String,
    pub node: ListedStream,
}

fn stream_name(s: &str) -> Option<&'static str> {
    [STREAM_AGENT, STREAM_CONDITIONS, STREAM_EGRESS].into_iter().find(|n| *n == s)
}

impl Listing {
    /// The files of every scope the classes allow, as the old pull code takes them. A name the rules do not know is left
    /// out (the node should not have listed it).
    pub fn manifest(&self, classes: &[Class]) -> Manifest {
        let all = self.files.iter().chain(self.stories.iter().flat_map(|s| s.files.iter()));
        let files = all
            .filter_map(|f| {
                let name = collect::parse_name(&f.name).filter(|n| classes.contains(&n.class()))?;
                Some(FileEntry { name: f.name.clone(), kind: name.kind(), size: f.size, mtime: f.mtime })
            })
            .collect();
        Manifest { run: self.run.clone(), job: self.job.clone(), run_status: self.run_status(), job_state: self.job_state.clone(), files, unlisted: 0 }
    }

    /// The run's state as the note records it: None when the node could not tell.
    pub fn run_status(&self) -> Option<RunStatus> {
        (self.run_state != "unknown").then(|| RunStatus { state: self.run_state.clone(), at: None })
    }

    /// The streams the classes allow, the run's first and then each story's, in listing order.
    pub fn stream_targets(&self, classes: &[Class]) -> Vec<StreamTarget> {
        let run_level = self.streams.iter().map(|s| (None, s));
        let story_level = self.stories.iter().flat_map(|st| st.streams.iter().map(move |s| (Some(format!("{:0width$}", st.n, width = STORY_DIGITS)), s)));
        run_level
            .chain(story_level)
            .filter_map(|(story, s)| {
                let stream = stream_name(&s.stream)?;
                let name = stream::file_name_of(stream, story.as_deref())?;
                collect::parse_name(&name).filter(|n| classes.contains(&n.class()))?;
                Some(StreamTarget { stream, story, name, node: s.clone() })
            })
            .collect()
    }
}

/// `GET /v1/runs/events`: the events with the text the node sent for each, the cursor after them, and the flag.
#[derive(Debug, Clone, PartialEq)]
pub struct EventsPage {
    pub events: Vec<String>,
    pub next: Option<String>,
    pub final_: bool,
}

#[derive(Deserialize)]
struct EventsWire {
    events: Vec<Box<RawValue>>,
    next: Option<String>,
    #[serde(rename = "final")]
    final_: bool,
}

impl EventsPage {
    pub fn parse(body: &str) -> Result<EventsPage> {
        let wire: EventsWire = serde_json::from_str(body).context("the events answer is not the contract's shape")?;
        let events: Vec<String> = wire.events.iter().map(|e| e.get().to_string()).collect();
        if let Some(bad) = events.iter().find(|e| e.contains('\n') || e.contains('\r')) {
            bail!("{E_BAD_EVENTS}: an event holds a line break: {:?}", bad.chars().take(60).collect::<String>());
        }
        Ok(EventsPage { events, next: wire.next, final_: wire.final_ })
    }
}

// ---- one stream ----

/// What reading one stream did.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamPull {
    /// The length of the lake's file now.
    pub bytes: u64,
    pub pulled_bytes: u64,
    pub events: u64,
    /// The node's flag at the empty page that ended the read (false if the read stopped for another reason).
    pub final_: bool,
    /// The read reached an empty page: nothing the node has is unread.
    pub drained: bool,
    /// The lake's copy was not a prefix of the node's file and was replaced by a fresh read.
    pub replaced: bool,
    pub cursor: Option<String>,
}

/// Whether the lake's copy of a stream cannot be the start of the node's file: the first event differs, or the lake has
/// gone further than the node's last event. (The node's file is the authority, as it is for the old pass.)
fn lake_is_not_a_prefix(lake: &(Value, Value), node: &ListedStream) -> bool {
    let first_differs = !lake.0.is_null() && !node.first_ts.is_null() && lake.0 != node.first_ts;
    let lake_ahead = match (lake.1.as_f64(), node.last_ts.as_f64()) {
        (Some(l), Some(n)) => l > n,
        _ => false,
    };
    first_differs || lake_ahead
}

/// Bring the lake's file for `target` up to the node's, by cursor, `page_events` at a time. `known` is what the note
/// recorded for it: the file's record and its cursor.
pub async fn pull_stream(api: &Api, run: &str, target: &StreamTarget, dest: &Path, known: Option<(&Collected, &str)>, page_events: usize) -> Result<StreamPull> {
    let key = stream::time_key_of(target.stream).context("a stream with no time key")?;
    if let Some(dir) = dest.parent() {
        crate::store::create_private_dir_all(dir)?;
    }
    let len = std::fs::metadata(dest).map_or(0, |m| m.len());
    // The cursor the lake's own file gives. A torn last line (a crash between the write and the note) is cut off: the next
    // page brings that event whole.
    let trusted = known.and_then(|(rec, cursor)| (rec.bytes == len && len > 0).then(|| cursor.to_string()));
    let (mut cursor, mut held) = match trusted {
        Some(c) => (Some(c), len),
        None => {
            let scan = stream::scan_file(dest, key)?;
            if scan.whole_lines_len < len {
                crate::store::open_private(dest, true, false)?.set_len(scan.whole_lines_len)?;
            }
            (scan.cursor.map(|c| c.to_string()), scan.whole_lines_len)
        }
    };
    let mut replaced = false;
    let mut target_path = dest.to_path_buf();
    if held > 0 {
        let bounds = match std::fs::File::open(dest) {
            Ok(f) => crate::scopes::listing::time_bounds(f, key),
            Err(_) => (Value::Null, Value::Null),
        };
        if lake_is_not_a_prefix(&bounds, &target.node) {
            replaced = true;
            target_path = collector::partial_path(dest);
            let _ = std::fs::remove_file(&target_path);
            (cursor, held) = (None, 0);
        }
    }
    let (mut pulled, mut events, mut pages) = (0u64, 0u64, 0usize);
    let (mut final_, mut drained) = (false, false);
    while pages < MAX_PAGES_PER_STREAM_PASS {
        pages += 1;
        let page = api.run_events(run, target.stream, target.story.as_deref(), cursor.as_deref(), page_events).await?;
        if page.events.is_empty() {
            (final_, drained) = (page.final_, true);
            break;
        }
        ensure!(page.next.is_some() && page.next != cursor, "{E_BAD_EVENTS}: {} events came and the cursor did not move", page.events.len());
        let mut f = crate::store::open_private(&target_path, true, false)?;
        let mut text = String::new();
        for e in &page.events {
            text.push_str(e);
            text.push('\n');
        }
        f.write_all(text.as_bytes())?;
        f.sync_data()?;
        pulled += text.len() as u64;
        events += page.events.len() as u64;
        held += text.len() as u64;
        cursor = page.next;
    }
    if replaced {
        if held > 0 {
            std::fs::rename(&target_path, dest).with_context(|| format!("rename to {}", dest.display()))?;
        } else {
            let _ = std::fs::remove_file(dest);
        }
    }
    Ok(StreamPull { bytes: held, pulled_bytes: pulled, events, final_, drained, replaced, cursor })
}

// ---- one run ----

/// Collect one run of one node into `dir` through the scope routes; the note it leaves says what the lake holds. Only the
/// classes in `classes` are taken (a reference model's run takes its records only).
pub async fn collect_run(api: &Api, node: &str, run: &str, dir: &Path, classes: &[Class], cadence: &Cadence, now: u64) -> Result<RunSummary> {
    let mut local = collector::load_collection(dir).unwrap_or_else(|| Collection {
        node: node.to_string(),
        run: run.to_string(),
        first_collected_at: now,
        dbench_version: crate::VERSION.to_string(),
        ..Default::default()
    });
    let mut summary = RunSummary { run: run.to_string(), ..Default::default() };
    if !collector::due(Some(&local), now, cadence) {
        summary.complete = local.complete;
        return Ok(summary);
    }
    let listing = api.scopes(run).await?;
    let was_complete = local.complete;
    let manifest = listing.manifest(classes);
    collector::pull_planned(api, &RunRef::Scope(run.to_string()), dir, &manifest, &mut local, now, &mut summary).await?;
    let mut streams_held = true;
    for target in listing.stream_targets(classes) {
        let known = local.files.get(&target.name).cloned();
        let kept = local.cursors.get(&target.name).cloned();
        let p = pull_stream(api, run, &target, &dir.join(&target.name), known.as_ref().zip(kept.as_deref()), PAGE_EVENTS).await?;
        if p.events > 0 || p.replaced {
            summary.pulled_files += 1;
            summary.pulled_bytes += p.pulled_bytes;
            summary.changed = true;
        }
        streams_held &= p.final_ && p.drained;
        local.files.insert(
            target.name.clone(),
            Collected {
                bytes: p.bytes,
                node_size: p.bytes,
                node_mtime: 0.0,
                at_eof: p.final_ && p.drained,
                pulled_at: if p.events > 0 { now } else { known.as_ref().map_or(now, |k| k.pulled_at) },
                refetches: known.as_ref().map_or(0, |k| k.refetches) + u32::from(p.replaced),
                partial: None,
            },
        );
        match p.cursor {
            Some(c) => local.cursors.insert(target.name.clone(), c),
            None => local.cursors.remove(&target.name),
        };
    }
    local.node = node.to_string();
    local.job = listing.job.clone();
    local.run_status = listing.run_status();
    local.job_state = listing.job_state.clone();
    local.collected_at = now;
    local.dbench_version = crate::VERSION.to_string();
    let held = listing.final_ && streams_held && collector::all_at_eof(&manifest, &local);
    collector::settle(&mut local, held, summary.pulled_files, cadence, now);
    summary.complete = local.complete;
    summary.changed |= local.complete != was_complete;
    collector::save_collection(dir, &local)?;
    Ok(summary)
}
