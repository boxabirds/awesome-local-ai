//! Test support for the scope API backtest (tests/scopes_backtest.rs): a REPLAY NODE.
//!
//! A replay node is a temporary node directory that the real dbench router serves, built from a run of the real lake
//! (`~/expts/awesome-local-ai-bench-private/state/collected`, read-only) as the node stood at a time T:
//!
//! * `stories/NN/agent-events.jsonl` (key `_rx`), `stories/NN/conditions.jsonl` and `egress.jsonl` (key `t`) hold the
//!   longest PREFIX of the lake file whose lines all carry a time <= T. The replay file is always a byte prefix of the
//!   lake file, so it can only grow or shrink at its end, like a log being written. Variants cut inside a line.
//! * a story's other files exist only once the story ended (closing status and `finished` <= T); a story that started
//!   has its streams; a story that has not started has nothing, not even a folder.
//! * `metrics.json` mid-run versions do NOT exist in the lake (only the final one). They are SYNTHESIZED here: the
//!   stories that ended by T, with their real status and times, taken from the final metrics.json (or, for runs of a node that
//!   has no metrics.json, from progress.json). At or after the run's end the real metrics.json is copied.
//! * `run-status.json` and the job are scenario data (see `Scenario`): `started` and a running job before the run's end,
//!   the real final state and a terminal job at or after it.
//!
//! Everything is a copy; the lake is only ever read.

#![allow(dead_code, clippy::too_many_arguments, clippy::type_complexity)]

use dbench::cli::ServerConfig;
use dbench::job::{AgentClient, Job, JobSpec, JobState};
use dbench::server::{router, Inner, Shared};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap, VecDeque};
use std::fs::File;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const TOKEN: &str = "test-token";
pub const INSTALL_ID: &str = "fake-install";
pub const COMBINATION: &str = "test/combo/fake";
pub const PACK: &str = "fakepack";
pub const NOW: u64 = 1_792_000_000;
pub const SERVE_POLL: Duration = Duration::from_millis(50);
pub const MAX_RESTARTS: u32 = 2;
pub const HTTP_OK: u16 = 200;
pub const FINAL_HEADER: &str = "x-dbench-final";
pub const MAX_LIMIT: usize = 10_000;

/// Relative to $HOME.
pub const LAKE_SUBDIR: &str = "expts/awesome-local-ai-bench-private/state/collected";
const LAKE_WALK_MAX_DEPTH: usize = 16;
const COLLECTION_FILE: &str = "collection.json";

/// A log is cut to its first LINE_CAP lines (in a COPY: the lake is never touched) unless its run is a designated big run.
/// 2000 lines is about 1 MB of agent events; the full logs total 25 GB.
pub const LINE_CAP: usize = 2000;
/// Files copied into a replay: bounded in size and count so that a run's screenshots do not dominate the runtime. The
/// listing must still show every one of the copied files whose name is on the allow-list.
const STORY_FILE_MAX_BYTES: u64 = 512 * 1024;
const FILES_PER_STORY_MAX: usize = 24;
const RUN_FILE_MAX_BYTES: u64 = 1024 * 1024;
const RUN_FILES_MAX: usize = 60;
const READ_BUFFER_BYTES: usize = 1 << 20;
/// The gap before the first story at which "before the run starts" is replayed.
pub const BEFORE_START_SECONDS: f64 = 5.0;
pub const AFTER_END_SECONDS: f64 = 1.0;

static COUNTER: AtomicU32 = AtomicU32::new(0);

pub fn lake_dir() -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os("HOME")?).join(LAKE_SUBDIR);
    dir.is_dir().then_some(dir)
}

// ---------------------------------------------------------------- small utilities

/// xorshift64*: deterministic, so a failing case is reproducible from the run label.
pub struct Rng(u64);
impl Rng {
    pub fn seeded(text: &str, salt: u64) -> Rng {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325 ^ salt;
        for b in text.bytes() {
            h ^= u64::from(b);
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
        Rng(h | 1)
    }
    pub fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    /// Uniform in lo..=hi.
    pub fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next() % ((hi - lo + 1) as u64)) as usize
    }
}

pub fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

/// "2026-10-07T18:54:52Z" as epoch seconds.
pub fn epoch_of_iso(s: &str) -> Option<f64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' {
        return None;
    }
    let num = |a: usize, z: usize| s.get(a..z)?.parse::<i64>().ok();
    let (y, m, d) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    let (hh, mm, ss) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
    // days from civil (Howard Hinnant)
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86_400 + hh * 3600 + mm * 60 + ss) as f64)
}

// ---------------------------------------------------------------- the line index of a log

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Kind {
    Agent,
    Conditions,
    Egress,
}
impl Kind {
    pub fn stream(self) -> &'static str {
        match self {
            Kind::Agent => "agent",
            Kind::Conditions => "conditions",
            Kind::Egress => "egress",
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Kind::Agent => "_rx",
            _ => "t",
        }
    }
}

#[derive(Deserialize)]
struct RxProbe {
    #[serde(default)]
    _rx: Option<Value>,
}
#[derive(Deserialize)]
struct TProbe {
    #[serde(default)]
    t: Option<Value>,
}

/// (is a JSON object, time of the line)
fn probe(line: &[u8], kind: Kind) -> (bool, Option<f64>) {
    if line.first() != Some(&b'{') {
        return (false, None);
    }
    match kind {
        Kind::Agent => serde_json::from_slice::<RxProbe>(line)
            .map(|p| (true, p._rx.and_then(|v| v.as_f64())))
            .unwrap_or((false, None)),
        _ => serde_json::from_slice::<TProbe>(line)
            .map(|p| (true, p.t.and_then(|v| v.as_f64())))
            .unwrap_or((false, None)),
    }
}

/// The time text of a line exactly as written, when the line starts `{"<key>":<number>`; None otherwise. This is the
/// independent oracle for the cursor (the server's own extraction is what is being tested).
pub fn time_text(line: &[u8], kind: Kind) -> Option<String> {
    let head = format!("{{\"{}\":", kind.key());
    let rest = line.strip_prefix(head.as_bytes())?;
    let rest = std::str::from_utf8(rest).ok()?.trim_start_matches(' ');
    let end = rest.find([',', '}', ' ']).unwrap_or(rest.len());
    let text = &rest[..end];
    (!text.is_empty() && text.parse::<f64>().is_ok()).then(|| text.to_string())
}

/// The complete lines of the lake file (or its first `cap`), with the byte offset where each ends (after its newline).
pub struct Index {
    pub ends: Vec<u64>,
    pub ts: Vec<Option<f64>>,
    pub ok: Vec<bool>,
    /// Length of the file the replay finally holds: the capped prefix, else the whole lake file (a partial last line too).
    pub full_len: u64,
    pub capped: bool,
}

impl Index {
    pub fn build(path: &Path, kind: Kind, cap: Option<usize>) -> Index {
        let file = File::open(path).unwrap_or_else(|e| panic!("open {}: {e}", path.display()));
        let file_len = file.metadata().unwrap().len();
        let mut r = BufReader::with_capacity(READ_BUFFER_BYTES, file);
        let (mut ends, mut ts, mut ok) = (Vec::new(), Vec::new(), Vec::new());
        let (mut off, mut buf) = (0u64, Vec::new());
        loop {
            if cap.is_some_and(|c| ends.len() >= c) {
                break;
            }
            buf.clear();
            let n = r.read_until(b'\n', &mut buf).unwrap();
            if n == 0 || *buf.last().unwrap() != b'\n' {
                break;
            }
            off += n as u64;
            let (is_obj, t) = probe(&buf[..n - 1], kind);
            ends.push(off);
            ts.push(t);
            ok.push(is_obj);
        }
        let capped = cap.is_some_and(|c| ends.len() >= c) && off < file_len;
        Index {
            ends,
            ts,
            ok,
            full_len: if capped { off } else { file_len },
            capped,
        }
    }

    pub fn line_start(&self, i: usize) -> u64 {
        if i == 0 {
            0
        } else {
            self.ends[i - 1]
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Variant {
    /// Whole lines only.
    Clean,
    /// The lines <= T whole, then half of the next line (a line being written).
    HalfNext,
    /// The last line <= T cut in half.
    HalfLast,
    /// The last line <= T complete except for its newline.
    NoNewline,
}

pub struct StreamSrc {
    pub path: PathBuf,
    pub kind: Kind,
    pub idx: Index,
}

impl StreamSrc {
    pub fn build(path: PathBuf, kind: Kind, cap: Option<usize>) -> StreamSrc {
        let idx = Index::build(&path, kind, cap);
        StreamSrc { path, kind, idx }
    }

    pub fn first_ts(&self) -> Option<f64> {
        self.idx.ts.iter().flatten().copied().next()
    }
    pub fn last_ts(&self) -> Option<f64> {
        self.idx.ts.iter().flatten().copied().last()
    }

    /// How many leading lines carry a time <= t (the longest prefix: a later line that goes back in time is not included).
    pub fn lines_by(&self, t: f64) -> usize {
        self.idx
            .ts
            .iter()
            .position(|x| x.is_some_and(|v| v > t))
            .unwrap_or(self.idx.ts.len())
    }

    /// Length in bytes of the replay file at time t.
    pub fn cut_len(&self, t: f64, v: Variant) -> u64 {
        let i = self.lines_by(t);
        let n = self.idx.ends.len();
        let clean = self.idx.line_start(i);
        match v {
            Variant::Clean => {
                if i == n {
                    self.idx.full_len
                } else {
                    clean
                }
            }
            Variant::HalfNext => {
                if i < n {
                    clean + (self.idx.ends[i] - clean) / 2
                } else {
                    self.idx.full_len
                }
            }
            Variant::HalfLast => {
                if i >= 1 {
                    let s = self.idx.line_start(i - 1);
                    s + (self.idx.ends[i - 1] - s) / 2
                } else {
                    0
                }
            }
            Variant::NoNewline => {
                if i >= 1 {
                    self.idx.ends[i - 1] - 1
                } else {
                    0
                }
            }
        }
    }

    /// The byte ranges (without the newline) of the lines the route must return for a replay file of `len` bytes:
    /// the complete lines that are JSON objects, in order.
    pub fn expected(&self, len: u64) -> Vec<(usize, usize)> {
        let complete = self.idx.ends.partition_point(|e| *e <= len);
        (0..complete)
            .filter(|i| self.idx.ok[*i])
            .map(|i| (self.idx.line_start(i) as usize, self.idx.ends[i] as usize - 1))
            .collect()
    }
}

// ---------------------------------------------------------------- the lake run

const CLOSING: [&str; 2] = ["DONE", "PARTIAL"];

pub struct StoryModel {
    pub n: u32,
    pub started: Option<f64>,
    pub finished: Option<f64>,
    pub status: Option<String>,
    pub agent: Option<StreamSrc>,
    pub cond: Option<StreamSrc>,
    /// (name relative to the story folder, source path)
    pub files: Vec<(String, PathBuf)>,
}

impl StoryModel {
    pub fn closing(&self) -> bool {
        self.status.as_deref().is_some_and(|s| CLOSING.contains(&s))
    }
    /// The earliest sign of the story: its start or its first event.
    pub fn first_ts(&self) -> Option<f64> {
        [
            self.started,
            self.agent.as_ref().and_then(|s| s.first_ts()),
            self.cond.as_ref().and_then(|s| s.first_ts()),
        ]
        .into_iter()
        .flatten()
        .fold(None, |a: Option<f64>, x| Some(a.map_or(x, |y| y.min(x))))
    }
    pub fn dir_name(&self) -> String {
        format!("{:02}", self.n)
    }
}

pub struct LakeRun {
    pub label: String,
    pub node: String,
    pub src: PathBuf,
    /// finished, failed, stopped, started, or none (no run-status.json anywhere)
    pub real_state: String,
    pub status_at: Option<String>,
    pub stories: BTreeMap<u32, StoryModel>,
    pub egress: Option<StreamSrc>,
    pub run_files: Vec<(String, PathBuf)>,
    pub has_real_metrics: bool,
    pub run_json: Option<PathBuf>,
    pub first_start: f64,
    /// When the run ended: the latest of the recorded story ends, the status time and the last event.
    pub end: f64,
    pub big: bool,
}

fn files_under(root: &Path, skip: &dyn Fn(&str) -> bool, max_bytes: u64, max_files: usize) -> Vec<(String, PathBuf)> {
    fn walk(dir: &Path, rel: &str, skip: &dyn Fn(&str) -> bool, max_bytes: u64, out: &mut Vec<(String, PathBuf)>) {
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let name = e.file_name().to_string_lossy().to_string();
            let r = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            if skip(&r) {
                continue;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                walk(&e.path(), &r, skip, max_bytes, out);
            } else if ft.is_file() && e.metadata().is_ok_and(|m| m.len() <= max_bytes) {
                out.push((r, e.path()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, "", skip, max_bytes, &mut out);
    // Small files first, then by name: a bounded sample that keeps every record file.
    out.sort_by_key(|(r, p)| (p.metadata().map(|m| m.len()).unwrap_or(0) > STORY_FILE_MAX_BYTES / 8, r.clone()));
    out.truncate(max_files);
    out
}

fn story_entry(map: &mut BTreeMap<u32, StoryModel>, n: u32) -> &mut StoryModel {
    map.entry(n).or_insert_with(|| StoryModel { n, started: None, finished: None, status: None, agent: None, cond: None, files: vec![] })
}

impl LakeRun {
    pub fn load(src: &Path, lake: &Path, big: bool) -> LakeRun {
        let rel = src.strip_prefix(lake).unwrap();
        let comps: Vec<String> = rel.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect();
        let node = comps[0].clone();
        let run_id = comps.last().unwrap().clone();
        let combo = comps.iter().position(|c| c == "benchmarks").map(|i| comps[i - 1].clone()).unwrap_or_default();
        let label = format!("{node}:{combo}/{run_id}");
        let metrics = read_json(&src.join("metrics.json"));
        let progress = read_json(&src.join("progress.json"));
        let collection = read_json(&src.join(COLLECTION_FILE));
        let status_file = read_json(&src.join("run-status.json"));
        let status = status_file
            .as_ref()
            .or_else(|| collection.as_ref().and_then(|c| c.get("run_status")))
            .and_then(|s| s.get("state").and_then(|x| x.as_str()).map(|st| (st.to_string(), s.get("at").and_then(|x| x.as_str()).map(String::from))));
        let (real_state, status_at) = match status {
            Some((s, at)) => (s, at),
            None => ("none".to_string(), None),
        };
        let cap_of = |n: u32| (!(big && BIG_UNCAPPED_STORIES.contains(&n))).then_some(LINE_CAP);
        let mut stories: BTreeMap<u32, StoryModel> = BTreeMap::new();
        if let Some(m) = metrics.as_ref().and_then(|m| m.get("stories")).and_then(|s| s.as_object()) {
            for (id, s) in m {
                if let Ok(n) = id.parse::<u32>() {
                    let st = story_entry(&mut stories, n);
                    st.started = s.get("started").and_then(|x| x.as_f64());
                    st.finished = s.get("finished").and_then(|x| x.as_f64());
                    st.status = s.get("status").and_then(|x| x.as_str()).map(String::from);
                }
            }
        } else if let Some(p) = progress.as_ref().and_then(|p| p.get("stories")).and_then(|s| s.as_array()) {
            for s in p {
                if let Some(n) = s.get("id").and_then(|x| x.as_u64()) {
                    let st = story_entry(&mut stories, n as u32);
                    st.started = s.get("started_at").and_then(|x| x.as_f64());
                    st.finished = s.get("ended_at").and_then(|x| x.as_f64());
                    st.status = s.get("status").and_then(|x| x.as_str()).map(String::from);
                }
            }
        }
        // progress.json also names stories metrics.json does not (pending ones): they exist in the final listing.
        if let Some(p) = progress.as_ref().and_then(|p| p.get("stories")).and_then(|s| s.as_array()) {
            for s in p {
                if let Some(n) = s.get("id").and_then(|x| x.as_u64()) {
                    story_entry(&mut stories, n as u32);
                }
            }
        }
        if let Ok(rd) = std::fs::read_dir(src.join("stories")) {
            for e in rd.filter_map(|e| e.ok()) {
                let Some(n) = e.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
                if !e.file_type().is_ok_and(|t| t.is_dir()) {
                    continue;
                }
                let sd = e.path();
                let st = story_entry(&mut stories, n);
                if sd.join("agent-events.jsonl").is_file() {
                    st.agent = Some(StreamSrc::build(sd.join("agent-events.jsonl"), Kind::Agent, cap_of(n)));
                }
                if sd.join("conditions.jsonl").is_file() {
                    st.cond = Some(StreamSrc::build(sd.join("conditions.jsonl"), Kind::Conditions, Some(LINE_CAP)));
                }
                st.files = files_under(
                    &sd,
                    &|r: &str| r.starts_with("agent-events") || r == "conditions.jsonl",
                    STORY_FILE_MAX_BYTES,
                    FILES_PER_STORY_MAX,
                );
            }
        }
        let egress = src
            .join("egress.jsonl")
            .is_file()
            .then(|| StreamSrc::build(src.join("egress.jsonl"), Kind::Egress, Some(LINE_CAP)));
        let run_files = files_under(
            src,
            &|r: &str| {
                r.starts_with("stories")
                    || r.starts_with("workspace/")
                    || r == "workspace"
                    || ["egress.jsonl", "run.json", "run-status.json", "metrics.json", COLLECTION_FILE].contains(&r)
            },
            RUN_FILE_MAX_BYTES,
            RUN_FILES_MAX,
        );
        let mut first_start = f64::MAX;
        let mut end = 0f64;
        for s in stories.values() {
            if let Some(f) = s.first_ts() {
                first_start = first_start.min(f);
            }
            for t in [s.started, s.finished, s.agent.as_ref().and_then(|a| a.last_ts()), s.cond.as_ref().and_then(|a| a.last_ts())].into_iter().flatten() {
                end = end.max(t);
            }
        }
        if let Some(e) = &egress {
            if let Some(t) = e.last_ts() {
                end = end.max(t);
            }
            if let Some(t) = e.first_ts() {
                first_start = first_start.min(t);
            }
        }
        if let Some(t) = status_at.as_deref().and_then(epoch_of_iso) {
            end = end.max(t);
        }
        if first_start == f64::MAX {
            first_start = end;
        }
        LakeRun {
            label,
            node,
            src: src.to_path_buf(),
            real_state,
            status_at,
            stories,
            egress,
            run_files,
            has_real_metrics: metrics.is_some(),
            run_json: src.join("run.json").is_file().then(|| src.join("run.json")),
            first_start,
            end,
            big,
        }
    }

    /// Whether the run has any raw event log to replay.
    pub fn has_streams(&self) -> bool {
        self.egress.is_some() || self.stories.values().any(|s| s.agent.is_some() || s.cond.is_some())
    }

    /// The run states: never settled means `started` or none.
    pub fn never_settled(&self) -> bool {
        matches!(self.real_state.as_str(), "started" | "none")
    }
    pub fn closing_state(&self) -> bool {
        matches!(self.real_state.as_str(), "finished" | "failed" | "stopped")
    }
    pub fn terminal_job_label(&self) -> &'static str {
        match self.real_state.as_str() {
            "finished" => "done",
            "stopped" => "cancelled",
            _ => "failed",
        }
    }
}

/// The lake's run directories: every folder that holds a collection.json.
pub fn lake_runs(lake: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > LAKE_WALK_MAX_DEPTH {
            return;
        }
        if dir.join(COLLECTION_FILE).is_file() {
            out.push(dir.to_path_buf());
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            if e.file_type().is_ok_and(|t| t.is_dir()) {
                walk(&e.path(), depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(lake, 0, &mut out);
    out
}

// ---------------------------------------------------------------- the node

pub struct Node {
    pub root: PathBuf,
    pub shared: Arc<Shared>,
    pub base: String,
    pub http: reqwest::Client,
    pub requests: Arc<std::sync::atomic::AtomicUsize>,
    /// The path of every request the real router received, from any client, in order.
    pub paths: Arc<Mutex<Vec<String>>>,
}

impl Drop for Node {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

pub struct Reply {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub body: Vec<u8>,
}
impl Reply {
    pub fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| panic!("not json ({e}): {}", String::from_utf8_lossy(&self.body[..self.body.len().min(300)])))
    }
    pub fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).and_then(|v| v.to_str().ok()).map(String::from)
    }
}

pub struct Page {
    pub lines: Vec<String>,
    pub next: Option<String>,
    pub final_: bool,
}

pub fn job_state(label: &str) -> JobState {
    match label {
        "queued" => JobState::Queued,
        "running" => JobState::Running { pid: 1, pgid: 1, attempt: 1, started_at: NOW, boot_time: None },
        "done" => JobState::Done { exit_code: 0 },
        "failed" => JobState::Failed { reason: "test".into(), exit_code: None },
        "cancelled" => JobState::Cancelled,
        other => panic!("no job state {other}"),
    }
}

impl Node {
    /// `base_tmp` is where the node lives (a per-test folder under the temp dir).
    pub async fn start() -> Node {
        let root = std::env::temp_dir().join(format!("dbench-backtest-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&root);
        let (repo, home, share) = (root.join("repo"), root.join("home"), root.join("share"));
        std::fs::create_dir_all(repo.join("combinations").join(COMBINATION).join("benchmarks").join(PACK)).unwrap();
        std::fs::create_dir_all(home.join("jobs")).unwrap();
        std::fs::create_dir_all(share.join(INSTALL_ID)).unwrap();
        std::fs::write(
            share.join(INSTALL_ID).join("install.env"),
            format!("INSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\n"),
        )
        .unwrap();
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".into(),
            repo: repo.canonicalize().unwrap(),
            jobs_dir: home.join("jobs"),
            releases_dir: home.join("releases"),
            home,
            share_dir: share,
            bench_home: root.join("bench-home"),
            path_prepend: vec![],
            max_restarts: MAX_RESTARTS,
            pull: false,
            allow_unreleased: true,
            restart_backoff: SERVE_POLL,
            unfit_backoff: SERVE_POLL,
            cancel_grace: SERVE_POLL,
            tree_poll: SERVE_POLL,
        };
        let shared = Arc::new(Shared {
            cfg,
            token: TOKEN.into(),
            boot_time: None,
            inner: Mutex::new(Inner { jobs: HashMap::new(), queue: VecDeque::new(), current: None, hold: None }),
            wake: tokio::sync::Notify::new(),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let paths: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let seen = paths.clone();
        let app = router(shared.clone()).layer(axum::middleware::from_fn(move |req: axum::extract::Request, next: axum::middleware::Next| {
            let seen = seen.clone();
            async move {
                seen.lock().unwrap().push(req.uri().path().to_string());
                next.run(req).await
            }
        }));
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Node {
            root,
            shared,
            base: format!("http://{addr}"),
            http: reqwest::Client::new(),
            requests: Arc::new(Default::default()),
            paths,
        }
    }

    pub fn run_rel(&self, run_id: &str) -> String {
        format!("combinations/{COMBINATION}/benchmarks/{PACK}/{run_id}")
    }
    pub fn run_dir(&self, run_id: &str) -> PathBuf {
        self.shared.cfg.repo.join(self.run_rel(run_id))
    }

    /// Replace the jobs of the node: (id, state label, seq); a higher seq is newer.
    pub fn set_jobs(&self, run_id: &str, jobs: &[(String, &str, u64)]) {
        let mut g = self.shared.lock();
        g.jobs.clear();
        for (id, label, seq) in jobs {
            let spec = JobSpec {
                install_id: INSTALL_ID.into(),
                combination: None,
                pack: PACK.into(),
                scope: None,
                stories: None,
                run_id: run_id.into(),
                client: AgentClient::Pi,
                record: false,
                server_env: Default::default(),
                from_run: None,
                from_story: None,
            };
            let mut job = Job::new(id.clone(), spec, NOW + seq);
            job.seq = *seq;
            job.state = job_state(label);
            g.jobs.insert(id.clone(), job);
        }
    }

    pub async fn get(&self, path: &str, query: &[(&str, &str)]) -> Reply {
        self.requests.fetch_add(1, Ordering::Relaxed);
        let resp = self.http.get(format!("{}{path}", self.base)).query(query).bearer_auth(TOKEN).send().await.unwrap();
        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let body = resp.bytes().await.unwrap().to_vec();
        Reply { status, headers, body }
    }

    pub async fn scopes(&self, run_id: &str) -> Result<Value, String> {
        let r = self.get("/v1/runs/scopes", &[("run", &self.run_rel(run_id))]).await;
        if r.status != HTTP_OK {
            return Err(format!("scopes: status {} {}", r.status, String::from_utf8_lossy(&r.body)));
        }
        Ok(r.json())
    }

    /// One page of /v1/runs/events. The lines are cut out of the body as the route lays them out (one event per line),
    /// so they are the bytes of the file, not a re-serialisation.
    pub async fn events(&self, run_id: &str, kind: Kind, story: Option<u32>, after: Option<&str>, limit: usize) -> Result<Page, String> {
        let rel = self.run_rel(run_id);
        let story_s = story.map(|n| format!("{n:02}"));
        let limit_s = limit.to_string();
        let mut q: Vec<(&str, &str)> = vec![("run", &rel), ("stream", kind.stream()), ("limit", &limit_s)];
        if let Some(s) = &story_s {
            q.push(("story", s));
        }
        if let Some(a) = after {
            q.push(("after", a));
        }
        let r = self.get("/v1/runs/events", &q).await;
        let body = String::from_utf8_lossy(&r.body).to_string();
        if r.status != HTTP_OK {
            return Err(format!("events {} story {story:?} after {after:?} limit {limit}: status {} {}", kind.stream(), r.status, &body[..body.len().min(300)]));
        }
        parse_events_body(&body)
    }
}

pub fn parse_events_body(body: &str) -> Result<Page, String> {
    const HEAD: &str = "{\"events\":[\n";
    const TAIL_MARK: &str = "\n],\"next\"";
    if body.starts_with(HEAD) {
        let end = body.rfind(TAIL_MARK).ok_or("no tail in events body")?;
        let lines: Vec<String> = body[HEAD.len()..end].split(",\n").map(String::from).collect();
        let tail: Value = serde_json::from_str(&format!("{{\"events\":[]{}", &body[end + 2..])).map_err(|e| format!("tail: {e}"))?;
        Ok(Page {
            lines,
            next: tail["next"].as_str().map(String::from),
            final_: tail["final"].as_bool().ok_or("no final")?,
        })
    } else {
        let v: Value = serde_json::from_str(body).map_err(|e| format!("body: {e}"))?;
        if !v["events"].as_array().is_some_and(|a| a.is_empty()) {
            return Err(format!("unexpected body layout: {}", &body[..body.len().min(200)]));
        }
        Ok(Page {
            lines: vec![],
            next: v["next"].as_str().map(String::from),
            final_: v["final"].as_bool().ok_or("no final")?,
        })
    }
}

// ---------------------------------------------------------------- the replay

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scenario {
    /// run-status started and a running job before the end; the real final state and a terminal job at or after it.
    Normal,
    /// The harness crashed: run-status.json is missing the whole time; the job ends terminal.
    Crash,
    /// The harness crashed after writing `started`; the job ends terminal.
    CrashStarted,
    /// At or after the end: the real final run-status, a terminal old job, and a NEW running job (a resumed run).
    Resumed,
}

/// What the replay node holds at one moment, and what the API must say about it.
pub struct Moment {
    pub t: f64,
    pub at_end: bool,
    pub run_status_state: Option<String>,
    pub job_id: Option<String>,
    pub job_label: Option<&'static str>,
    pub expect_final: bool,
    pub started: BTreeSet<u32>,
    pub ended: BTreeSet<u32>,
    pub streams: Vec<StreamState>,
}

pub struct StreamState {
    pub kind: Kind,
    pub story: Option<u32>,
    pub src: &'static StreamSrc,
    pub path: PathBuf,
    pub len: u64,
}

pub struct Replay {
    pub run: &'static LakeRun,
    pub run_id: String,
    pub dir: PathBuf,
    story_files: BTreeSet<u32>,
    run_files: bool,
    /// For a collector simulation: a log never gets shorter.
    pub monotone: bool,
    floor: HashMap<PathBuf, u64>,
}

fn copy_file(src: &Path, dst: &Path) {
    if let Some(p) = dst.parent() {
        std::fs::create_dir_all(p).unwrap();
    }
    std::fs::copy(src, dst).unwrap_or_else(|e| panic!("copy {} -> {}: {e}", src.display(), dst.display()));
}

/// Make `dst` the first `len` bytes of `src`: truncate, or append the missing bytes.
fn sync_prefix(src: &Path, dst: &Path, len: u64) {
    let cur = dst.metadata().map(|m| m.len()).ok();
    match cur {
        Some(c) if c == len => {}
        Some(c) if c > len => {
            std::fs::OpenOptions::new().write(true).open(dst).unwrap().set_len(len).unwrap();
        }
        _ => {
            let c = cur.unwrap_or(0);
            let mut s = File::open(src).unwrap();
            s.seek(SeekFrom::Start(c)).unwrap();
            let mut d = std::fs::OpenOptions::new().create(true).append(true).open(dst).unwrap();
            std::io::copy(&mut s.take(len - c), &mut d).unwrap();
        }
    }
}

impl Replay {
    pub fn new(node: &Node, run: &'static LakeRun, run_id: &str) -> Replay {
        let dir = node.run_dir(run_id);
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        match &run.run_json {
            Some(p) => copy_file(p, &dir.join("run.json")),
            None => std::fs::write(dir.join("run.json"), "{}").unwrap(),
        }
        Replay { run, run_id: run_id.into(), dir, story_files: BTreeSet::new(), run_files: false, monotone: false, floor: HashMap::new() }
    }

    fn len_for(&mut self, path: &Path, want: u64) -> u64 {
        if !self.monotone {
            return want;
        }
        let f = self.floor.entry(path.to_path_buf()).or_insert(0);
        *f = (*f).max(want);
        *f
    }

    fn put_stream(&mut self, src: &'static StreamSrc, dst: PathBuf, t: f64, v: Variant, at_end: bool, story: Option<u32>, out: &mut Vec<StreamState>) {
        let want = src.cut_len(t, v);
        let len = self.len_for(&dst, want);
        if len > 0 || (at_end && v == Variant::Clean) {
            if let Some(p) = dst.parent() {
                std::fs::create_dir_all(p).unwrap();
            }
            sync_prefix(&src.path, &dst, len);
            out.push(StreamState { kind: src.kind, story, src, path: dst, len });
        } else if dst.exists() {
            std::fs::remove_file(&dst).unwrap();
        }
    }

    fn clear_dir_except(dir: &Path, keep: &[&str]) {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.filter_map(|e| e.ok()) {
                if keep.contains(&e.file_name().to_string_lossy().as_ref()) {
                    continue;
                }
                let p = e.path();
                if e.file_type().is_ok_and(|t| t.is_dir()) {
                    std::fs::remove_dir_all(&p).unwrap();
                } else {
                    std::fs::remove_file(&p).unwrap();
                }
            }
        }
    }

    /// Bring the node directory and the jobs to the state at time `t`. `variant` cuts inside a line (`Clean` at or after
    /// the end is the whole file, partial last line included).
    pub fn apply(&mut self, node: &Node, t: f64, variant: Variant, scenario: Scenario) -> Moment {
        let run = self.run;
        let at_end = t >= run.end;
        let mut streams = Vec::new();
        let mut started = BTreeSet::new();
        let mut ended = BTreeSet::new();

        // A cut inside a line only exists in a log still being written: a log of an ended story (or of the ended run) is whole.
        let live_variant = |closed: bool| if closed { Variant::Clean } else { variant };
        if let Some(e) = &run.egress {
            let dst = self.dir.join("egress.jsonl");
            self.put_stream(e, dst, t, live_variant(at_end), at_end, None, &mut streams);
        }
        let mut synth = serde_json::Map::new();
        for st in run.stories.values() {
            let sdir = self.dir.join("stories").join(st.dir_name());
            let has_sign = at_end || st.first_ts().is_some_and(|f| f <= t);
            let is_ended = st.closing() && (at_end || st.finished.is_some_and(|f| f <= t));
            if !has_sign && !is_ended {
                if sdir.exists() {
                    std::fs::remove_dir_all(&sdir).unwrap();
                }
                self.story_files.remove(&st.n);
                continue;
            }
            started.insert(st.n);
            std::fs::create_dir_all(&sdir).unwrap();
            if let Some(a) = &st.agent {
                self.put_stream(a, sdir.join("agent-events.jsonl"), t, live_variant(is_ended || at_end), at_end, Some(st.n), &mut streams);
            }
            if let Some(c) = &st.cond {
                self.put_stream(c, sdir.join("conditions.jsonl"), t, live_variant(is_ended || at_end), at_end, Some(st.n), &mut streams);
            }
            let files_now = is_ended || at_end;
            if files_now && !self.story_files.contains(&st.n) {
                for (rel, src) in &st.files {
                    copy_file(src, &sdir.join(rel));
                }
                self.story_files.insert(st.n);
            } else if !files_now && self.story_files.contains(&st.n) {
                Replay::clear_dir_except(&sdir, &["agent-events.jsonl", "conditions.jsonl"]);
                self.story_files.remove(&st.n);
            }
            if is_ended {
                ended.insert(st.n);
                let mut m = serde_json::Map::new();
                m.insert("title".into(), "synthesized from the final record".into());
                if let Some(s) = st.started {
                    m.insert("started".into(), s.into());
                }
                if let Some(f) = st.finished {
                    m.insert("finished".into(), f.into());
                }
                m.insert("status".into(), st.status.clone().unwrap().into());
                synth.insert(st.n.to_string(), Value::Object(m));
            }
        }
        // run-scope files
        if at_end && !self.run_files {
            for (rel, src) in &run.run_files {
                copy_file(src, &self.dir.join(rel));
            }
            self.run_files = true;
        } else if !at_end && self.run_files {
            Replay::clear_dir_except(&self.dir, &["run.json", "stories", "egress.jsonl"]);
            self.run_files = false;
        }
        // metrics.json
        let metrics_path = self.dir.join("metrics.json");
        if at_end && run.has_real_metrics {
            copy_file(&run.src.join("metrics.json"), &metrics_path);
        } else if !synth.is_empty() || at_end {
            let body = serde_json::json!({ "stories": Value::Object(synth) });
            std::fs::write(&metrics_path, serde_json::to_vec(&body).unwrap()).unwrap();
        } else if metrics_path.exists() {
            std::fs::remove_file(&metrics_path).unwrap();
        }
        // run-status.json and the jobs
        let real_status = (run.real_state != "none").then(|| {
            let mut m = serde_json::json!({ "state": run.real_state, "reason": "" });
            if let Some(at) = &run.status_at {
                m["at"] = at.clone().into();
            }
            m
        });
        let started_status = serde_json::json!({ "state": "started", "reason": "" });
        let status: Option<Value> = match scenario {
            Scenario::Normal | Scenario::Resumed => {
                if at_end {
                    real_status
                } else {
                    Some(started_status)
                }
            }
            Scenario::Crash => None,
            Scenario::CrashStarted => Some(started_status),
        };
        let status_path = self.dir.join("run-status.json");
        match &status {
            Some(v) => std::fs::write(&status_path, serde_json::to_vec(v).unwrap()).unwrap(),
            None => {
                let _ = std::fs::remove_file(&status_path);
            }
        }
        let terminal = run.terminal_job_label();
        let job_id = "job-1".to_string();
        let (jobs, newest): (Vec<(String, &str, u64)>, (String, &'static str)) = match (scenario, at_end) {
            (Scenario::Resumed, true) => (
                vec![(job_id.clone(), terminal, 1), ("job-1-again1".to_string(), "running", 2)],
                ("job-1-again1".to_string(), "running"),
            ),
            (_, true) => (vec![(job_id.clone(), terminal, 1)], (job_id.clone(), terminal)),
            (_, false) => (vec![(job_id.clone(), "running", 1)], (job_id.clone(), "running")),
        };
        node.set_jobs(&self.run_id, &jobs);
        let state = status.as_ref().and_then(|v| v["state"].as_str()).map(String::from);
        let closing = state.as_deref().is_some_and(|s| matches!(s, "finished" | "failed" | "stopped"));
        let live = matches!(newest.1, "queued" | "running");
        let term = matches!(newest.1, "done" | "failed" | "cancelled");
        Moment {
            t,
            at_end,
            run_status_state: state,
            job_id: Some(newest.0),
            job_label: Some(newest.1),
            expect_final: !live && (closing || term),
            started,
            ended,
            streams,
        }
    }
}

// ---------------------------------------------------------------- the times to replay

/// The (T, variant) pairs replayed for a run: before the first story, inside stories (at quantiles of the event times,
/// exactly on a line's time so that ties straddle the cut, and between lines), exactly at story ends, at the end, and
/// after it; cuts inside a line for one story. `max` bounds the count (the first and the last two are always kept).
pub fn pick_times(run: &LakeRun, max: usize) -> Vec<(f64, Variant)> {
    let mut rng = Rng::seeded(&run.label, 7);
    let mut out: Vec<(f64, Variant)> = vec![(run.first_start - BEFORE_START_SECONDS, Variant::Clean)];
    let with_streams: Vec<&StoryModel> = run.stories.values().filter(|s| s.agent.as_ref().is_some_and(|a| !a.idx.ts.is_empty())).collect();
    let chosen: Vec<&StoryModel> = match with_streams.len() {
        0 => vec![],
        1 => vec![with_streams[0]],
        2 => vec![with_streams[0], with_streams[1]],
        n => vec![with_streams[0], with_streams[n / 2], with_streams[n - 1]],
    };
    for (k, st) in chosen.iter().enumerate() {
        let a = st.agent.as_ref().unwrap();
        let times: Vec<f64> = a.idx.ts.iter().flatten().copied().collect();
        if times.is_empty() {
            continue;
        }
        for q in [0.25f64, 0.5, 0.75] {
            let i = ((times.len() - 1) as f64 * q) as usize;
            out.push((times[i], Variant::Clean));
            if k == chosen.len() / 2 && q == 0.5 {
                // a cut inside a line, three ways, in the middle story
                out.push((times[i], Variant::HalfNext));
                out.push((times[i], Variant::HalfLast));
                out.push((times[i], Variant::NoNewline));
            }
        }
        // between two lines
        let i = rng.range(0, times.len().saturating_sub(2));
        if times.len() > 1 {
            out.push(((times[i] + times[i + 1]) / 2.0, Variant::Clean));
        }
        if let Some(f) = st.finished {
            out.push((f, Variant::Clean));
        }
        if let Some(c) = &st.cond {
            let ct: Vec<f64> = c.idx.ts.iter().flatten().copied().collect();
            if !ct.is_empty() && k == 0 {
                out.push((ct[ct.len() / 2], Variant::Clean));
            }
        }
    }
    if let Some(e) = &run.egress {
        let et: Vec<f64> = e.idx.ts.iter().flatten().copied().collect();
        if !et.is_empty() {
            out.push((et[et.len() / 2], Variant::Clean));
        }
    }
    // story ends of stories that have no events, too
    for st in run.stories.values().filter(|s| s.closing()).take(2) {
        if let Some(f) = st.finished {
            out.push((f, Variant::Clean));
        }
    }
    out.push((run.end, Variant::Clean));
    out.push((run.end + AFTER_END_SECONDS, Variant::Clean));
    out.retain(|(t, _)| t.is_finite());
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then((a.1 as u8).cmp(&(b.1 as u8))));
    out.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
    if out.len() > max {
        // thin the middle evenly; keep the first and the last two
        let keep_tail = 2;
        let body_len = out.len() - keep_tail;
        let body_keep = max - keep_tail;
        let mut thin: Vec<(f64, Variant)> = (0..body_keep).map(|k| out[k * body_len / body_keep]).collect();
        thin.extend_from_slice(&out[body_len..]);
        thin.dedup_by(|a, b| a.0 == b.0 && a.1 == b.1);
        out = thin;
    }
    out
}

// ---------------------------------------------------------------- the run set

/// Per node, how many finished runs with raw logs are sampled; one node has no raw log at all in the lake.
pub const FINISHED_PER_NODE: usize = 6;
/// The run set covers at least this many nodes (the lake holds this many).
pub const MIN_NODES: usize = 4;
pub const FINISHED_NO_LOG_PER_NODE: usize = 2;
/// In the big run, the agent logs of these stories (190k, 305k and 108k lines) are replayed UNCAPPED; all else is capped.
pub const BIG_UNCAPPED_STORIES: [u32; 3] = [3, 4, 5];
/// A run whose logs are replayed UNCAPPED (it holds logs of more than 100,000 lines).
pub const BIG_RUN_MARK: &str = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1";

/// The runs the backtest uses: every run that did not finish cleanly (failed, stopped, started, no status) and a spread
/// of finished runs on every node; the big run is always in.
pub fn select_runs(lake: &Path) -> Vec<LakeRun> {
    let all = lake_runs(lake);
    let mut odd: Vec<LakeRun> = Vec::new();
    let mut finished_logs: BTreeMap<String, Vec<LakeRun>> = BTreeMap::new();
    let mut finished_nologs: BTreeMap<String, Vec<LakeRun>> = BTreeMap::new();
    // The same combination and run id can be on several nodes; the first copy found is the big run, the others are ordinary.
    let mut big_taken = false;
    for dir in all {
        let big = !big_taken && dir.to_string_lossy().ends_with(BIG_RUN_MARK);
        let rs = LakeRun::load_state_only(&dir, lake);
        let has_raw = dir.join("stories").is_dir() && std::fs::read_dir(dir.join("stories")).map(|rd| rd.filter_map(|e| e.ok()).any(|e| e.path().join("agent-events.jsonl").is_file())).unwrap_or(false);
        if rs != "finished" {
            odd.push(LakeRun::load(&dir, lake, false));
            continue;
        }
        let node = dir.strip_prefix(lake).unwrap().components().next().unwrap().as_os_str().to_string_lossy().to_string();
        if big {
            big_taken = true;
            odd.push(LakeRun::load(&dir, lake, true));
        } else if has_raw {
            finished_logs.entry(node).or_default().push(LakeRun::load_lazy(dir));
        } else {
            finished_nologs.entry(node).or_default().push(LakeRun::load_lazy(dir));
        }
    }
    let mut out = odd;
    for (map, per) in [(finished_logs, FINISHED_PER_NODE), (finished_nologs, FINISHED_NO_LOG_PER_NODE)] {
        for (_node, runs) in map {
            let n = runs.len();
            let step = (n / per).max(1);
            for (i, r) in runs.into_iter().enumerate() {
                if i % step == 0 && i / step < per {
                    out.push(LakeRun::load(&r.src, lake, false));
                }
            }
        }
    }
    out
}

impl LakeRun {
    /// Only the recorded state of a run directory, without indexing anything.
    pub fn load_state_only(dir: &Path, _lake: &Path) -> String {
        let status = read_json(&dir.join("run-status.json")).or_else(|| read_json(&dir.join(COLLECTION_FILE)).and_then(|c| c.get("run_status").cloned()));
        status.and_then(|s| s.get("state").and_then(|x| x.as_str()).map(String::from)).unwrap_or_else(|| "none".to_string())
    }

    /// A placeholder that only remembers the directory (so a selection can be made before indexing).
    fn load_lazy(dir: PathBuf) -> LakeRun {
        LakeRun {
            label: String::new(),
            node: String::new(),
            src: dir,
            real_state: String::new(),
            status_at: None,
            stories: BTreeMap::new(),
            egress: None,
            run_files: vec![],
            has_real_metrics: false,
            run_json: None,
            first_start: 0.0,
            end: 0.0,
            big: false,
        }
    }
}

/// Write `lines` (as returned by the route) to a byte buffer, one per line, the way the file holds them.
pub fn join_lines(lines: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    for l in lines {
        out.write_all(l.as_bytes()).unwrap();
        out.push(b'\n');
    }
    out
}

