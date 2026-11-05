//! Where a story's inputs come from: the published record and compact log from the lake (each run's
//! preferred copy, `LakeSource`, or a plain directory tree laid out like the repository for tests), and the
//! machine-only files from the lake (`<store>/<node>/<run path>/`, as `dbench collect` lays them
//! out). `candidates` is every story with a log in either; `inputs_for` gathers one story's inputs
//! and the digest that says whether they changed since it was last ingested.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};

use super::{EventsLog, StoryInputs, EVENTS_COMPACT, EVENTS_FULL, EVENTS_NONE};
use crate::profile::Profile;
use crate::collect::{CONDITIONS_FILE, EVENTS_FILE, PROXY_LOG, SERVER_LOG, STORIES_DIR};

pub const COMPACT_LOG: &str = "agent-events.compact.jsonl.gz";
pub const METRICS_FILE: &str = "metrics.json";
pub const RUN_FILE: &str = "run.json";
pub const RUN_STATUS_FILE: &str = "run-status.json";
pub const COLLECTION_FILE: &str = "collection.json";
pub const EGRESS_FILE: &str = "egress.jsonl";
pub const PROGRESS_FILE: &str = "progress.json";
/// Re-scores keep copies of a run's files under this directory; they are not conversations.
const RESCORE_DIR: &str = "/rescore/";
/// Logs recorded before the combinations were renamed: their run dir on the machine says -opencode.
const RENAMED_FROM: &str = "-opencode/";
const RENAMED_TO: &str = "-pi/";
/// Where published records and compact logs are read from. Not `benchmarks/reference`: the reference models (Claude
/// Opus, Sonnet) are the quality yardstick and their conversations are not kept in the warehouse.
const PUBLISHED_ROOTS: [&str; 1] = ["combinations"];

/// A run directory under one of the published roots. The lake is pulled from the machines and holds whatever they
/// ran, the reference models included, so it is filtered by the same rule as the published tree: without this, the
/// purge at the start of an ingest is undone by the same pass (4 Oct 2026; 86 story runs of Claude's conversations
/// were in the warehouse, and served from it to the benchmarker).
fn under_published_root(rel: &str) -> bool {
    PUBLISHED_ROOTS.iter().any(|root| rel.starts_with(&format!("{root}/")))
}
/// The operator's decisions about runs (story 23, annotations.store): the lake's annotation store, beside the collected
/// folder (`<state>/annotations`, `store` being `<state>/collected`), read through bench-lake's library. A store that
/// cannot be read is an error: no pass runs as if nothing were archived or invalid.
pub fn decisions(store: &Path) -> Result<bench_lake::annotations::State> {
    let state = store.parent().unwrap_or(Path::new(""));
    bench_lake::annotations::Store::in_state_dir(state).state().map_err(|e| anyhow::anyhow!("{e}"))
}

/// The runs the decisions archive (superseded, or not a benchmark result: owner, 4 Oct 2026): kept out of the lake's
/// pulls, the warehouse and the analytics file, and never a baseline.
pub fn archived_of(decided: &bench_lake::annotations::State) -> BTreeSet<String> {
    decided.runs.iter().filter(|(_, r)| r.archived.is_some()).map(|(id, _)| id.clone()).collect()
}
/// Where the reference models' runs are, relative to the repository.
const REFERENCE_ROOT: &str = "benchmarks/reference";
/// The held-out results a verdict reads, and the summaries that stand in for them where the detail is not kept.
const ACCEPT_FILE: &str = "accept.json";
const ACCEPT_SUMMARY_FILE: &str = "accept-summary.json";
/// The harness took as baselines only the reference runs named `run-N` (its glob was `*/run-*`).
const REFERENCE_BASELINE_PREFIX: &str = "run-";

fn parse_json_or_none(bytes: Option<Vec<u8>>) -> Option<Value> {
    bytes.and_then(|b| serde_json::from_slice(&b).ok())
}

/// A held-out result: the detail where it is kept, else its summary.
fn accept_of(read: &dyn Fn(&str) -> Result<Option<Vec<u8>>>, dir: &str) -> Result<Option<Value>> {
    let sep = if dir.is_empty() { "" } else { "/" };
    if let Some(v) = parse_json_or_none(read(&format!("{dir}{sep}{ACCEPT_FILE}"))?) {
        return Ok(Some(v));
    }
    Ok(parse_json_or_none(read(&format!("{dir}{sep}{ACCEPT_SUMMARY_FILE}"))?))
}

/// Every run of `pack` with its records, as the verdict reads them: the published combination runs and the reference
/// runs named `run-N`.
pub fn verdict_runs(published: &dyn Published, archived: &BTreeSet<String>, pack: &str) -> Result<Vec<super::verdict::RunRecords>> {
    let mut out = Vec::new();
    let ids = published.paths()?;
    // An archived run's records left the published tree, so the harness never saw it as a baseline.
    let marker = format!("/benchmarks/{pack}/");
    // A run is exactly one level under its pack (the harness's glob was `benchmarks/<pack>/*/metrics.json`): a re-score's
    // copy of the records under the run (rescore/, rescore-spoiled/) is not another run.
    let one_level_under_pack = |r: &str| r.split_once(&marker).is_some_and(|(_, run)| !run.is_empty() && !run.contains('/'));
    let runs: BTreeSet<&str> = ids.keys().filter_map(|p| p.strip_suffix(&format!("/{METRICS_FILE}"))).filter(|r| one_level_under_pack(r)).collect();
    for run in runs.into_iter().filter(|r| !archived.contains(*r)) {
        let read = |name: &str| published.read(&format!("{run}/{name}"));
        out.push(records_of(run, false, &read)?);
    }
    for (run, dir) in published.reference_runs()? {
        let in_pack = run.starts_with(&format!("{REFERENCE_ROOT}/{pack}/"));
        let named = run.rsplit('/').next().is_some_and(|last| last.starts_with(REFERENCE_BASELINE_PREFIX));
        if !in_pack || !named || archived.contains(&run) {
            continue;
        }
        let read = |name: &str| -> Result<Option<Vec<u8>>> {
            match std::fs::read(dir.join(name)) {
                Ok(b) => Ok(Some(b)),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
                Err(e) => Err(anyhow::Error::new(e).context(format!("read {}", dir.join(name).display()))),
            }
        };
        out.push(records_of(&run, true, &read)?);
    }
    Ok(out)
}

fn records_of(run: &str, reference: bool, read: &dyn Fn(&str) -> Result<Option<Vec<u8>>>) -> Result<super::verdict::RunRecords> {
    let metrics = parse_json_or_none(read(METRICS_FILE)?).unwrap_or(Value::Object(Default::default()));
    let mut story_accepts = BTreeMap::new();
    if let Some(stories) = metrics.get("stories").and_then(Value::as_object) {
        for key in stories.keys() {
            let Ok(n) = key.parse::<i64>() else { continue };
            if let Some(a) = accept_of(read, &format!("{STORIES_DIR}/{n:02}"))? {
                story_accepts.insert(n, a);
            }
        }
    }
    let run_accept = accept_of(read, "")?;
    Ok(super::verdict::RunRecords { id: run.to_string(), reference, metrics, run_accept, story_accepts })
}

/// The published side: a path's bytes, and the blob id that names its content.
pub trait Published {
    /// Every published path under the roots, with the id of its content.
    fn paths(&self) -> Result<BTreeMap<String, String>>;
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>>;
    /// The reference models' runs (`benchmarks/reference/<pack>/<model>/<run>` -> their folder): not ingested, but
    /// baselines for the verdict on a story ended early. None by default.
    fn reference_runs(&self) -> Result<BTreeMap<String, PathBuf>> {
        Ok(BTreeMap::new())
    }
    /// What this source is (for the database's meta).
    fn describe(&self) -> String;
}

/// A directory tree with the same layout (a checkout, or a test's fixture); a file's id is its size and mtime.
pub struct TreeSource {
    pub root: PathBuf,
}

impl Published for TreeSource {
    fn paths(&self) -> Result<BTreeMap<String, String>> {
        let mut out = BTreeMap::new();
        for root in PUBLISHED_ROOTS {
            walk(&self.root, &self.root.join(root), &mut out)?;
        }
        Ok(out)
    }

    fn read(&self, path: &str) -> Result<Option<Vec<u8>>> {
        match std::fs::read(self.root.join(path)) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn reference_runs(&self) -> Result<BTreeMap<String, PathBuf>> {
        let mut out = BTreeMap::new();
        let mut files = BTreeMap::new();
        walk(&self.root, &self.root.join(REFERENCE_ROOT), &mut files)?;
        for path in files.keys() {
            if let Some(run) = path.strip_suffix(&format!("/{METRICS_FILE}")) {
                out.insert(run.to_string(), self.root.join(run));
            }
        }
        Ok(out)
    }

    fn describe(&self) -> String {
        format!("tree {}", self.root.display())
    }
}

/// The lake: each combination run's preferred copy (bench-lake's ranking, the one every reader uses), its record files
/// only (the collector's allow-list, class Record, without the workspace bundle), read as files; a file's id is the
/// sha256 of its content. No git.
pub struct LakeSource {
    lake: bench_lake::Lake,
    store: PathBuf,
    files: std::cell::RefCell<Option<BTreeMap<String, (PathBuf, String)>>>,
}

/// The workspace bundle is a Record in the collector's allow-list but not a record the ingest reads.
const NOT_A_PUBLISHED_RECORD: &str = "workspace.bundle";

impl LakeSource {
    /// `store` is the collected lake (`<state>/collected`), `reference` the reference models' folder.
    pub fn new(store: &Path, reference: &Path) -> Self {
        LakeSource { lake: bench_lake::Lake::new(store, reference), store: store.to_path_buf(), files: std::cell::RefCell::new(None) }
    }

    fn files(&self) -> Result<BTreeMap<String, (PathBuf, String)>> {
        if let Some(f) = self.files.borrow().as_ref() {
            return Ok(f.clone());
        }
        let d = self.lake.discover();
        let ids: BTreeSet<&str> = d.runs.iter().filter(|r| r.kind == bench_lake::Kind::Combination).map(|r| r.id.as_str()).collect();
        let mut out = BTreeMap::new();
        for id in ids {
            let Some(run) = self.lake.preferred(&d, id) else { continue };
            let mut names = BTreeMap::new();
            walk(&run.dir, &run.dir, &mut names)?;
            for name in names.into_keys() {
                let is_record = crate::collect::parse_name(&name).is_some_and(|f| f.class() == crate::collect::Class::Record);
                if !is_record || name == NOT_A_PUBLISHED_RECORD {
                    continue;
                }
                let path = run.dir.join(&name);
                let sha = content_id(&path)?;
                out.insert(format!("{id}/{name}"), (path, sha));
            }
        }
        *self.files.borrow_mut() = Some(out.clone());
        Ok(out)
    }
}

/// What says a file is unchanged without reading it: its size, modification time (to the nanosecond) and inode.
type FileStamp = (u64, i64, i64, u64);

/// The sha256 of a file's content, read only when its stamp differs from the last time this process named it: the
/// collector ingests on every pass that pulled something, and reading every record of every run to name it was about
/// 1.1 GiB a pass (A-049). The cache is the process's, so it outlives each ingest's `LakeSource`.
fn content_id(path: &Path) -> Result<String> {
    use std::os::unix::fs::MetadataExt;
    static CACHE: std::sync::OnceLock<std::sync::Mutex<HashMap<PathBuf, (FileStamp, String)>>> = std::sync::OnceLock::new();
    let meta = std::fs::metadata(path).with_context(|| format!("read {}", path.display()))?;
    let stamp: FileStamp = (meta.len(), meta.mtime(), meta.mtime_nsec(), meta.ino());
    let cache = CACHE.get_or_init(Default::default);
    if let Some((s, sha)) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(path) {
        if *s == stamp {
            return Ok(sha.clone());
        }
    }
    let bytes = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    let sha = bench_lake::sha256_hex(&bytes);
    cache.lock().unwrap_or_else(|e| e.into_inner()).insert(path.to_path_buf(), (stamp, sha.clone()));
    Ok(sha)
}

impl Published for LakeSource {
    fn paths(&self) -> Result<BTreeMap<String, String>> {
        Ok(self.files()?.into_iter().map(|(k, (_, id))| (k, id)).collect())
    }

    fn read(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let files = self.files()?;
        let Some((file, _)) = files.get(path) else { return Ok(None) };
        Ok(Some(std::fs::read(file).with_context(|| format!("read {}", file.display()))?))
    }

    fn reference_runs(&self) -> Result<BTreeMap<String, PathBuf>> {
        let d = self.lake.discover();
        Ok(d.runs.iter().filter(|r| r.kind == bench_lake::Kind::Reference).map(|r| (r.id.clone(), r.dir.clone())).collect())
    }

    fn describe(&self) -> String {
        format!("lake {}", self.store.display())
    }
}

fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) -> Result<()> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Ok(()) };
    for e in entries.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_dir() {
            walk(root, &p, out)?;
        } else if let Ok(rel) = p.strip_prefix(root) {
            out.insert(rel.to_string_lossy().replace('\\', "/"), stamp_of(&p));
        }
    }
    Ok(())
}

/// A file's size and mtime, as a change signal.
pub fn stamp_of(path: &Path) -> String {
    match std::fs::metadata(path) {
        Ok(m) => {
            let mtime = m.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0.0, |d| d.as_secs_f64());
            format!("{}:{mtime:.3}", m.len())
        }
        Err(_) => "missing".into(),
    }
}

/// `collection.json` as the collector writes it beside a run's files in the lake.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct LakeRecord {
    #[serde(default)]
    pub node: Option<String>,
    #[serde(default)]
    pub complete: bool,
    #[serde(default)]
    pub collected_at: Option<f64>,
    /// What the lake holds of each file (`bytes` is what matters here: the node that ran the run has the files).
    #[serde(default)]
    pub files: BTreeMap<String, LakeFile>,
}

#[derive(Debug, Clone, Deserialize, Default)]
pub struct LakeFile {
    #[serde(default)]
    pub bytes: u64,
}

impl LakeRecord {
    /// How much of the run this node's copy holds: every checkout has every run directory (the published files
    /// come through git), but only the node that ran it has the machine-only files.
    pub fn held_bytes(&self) -> u64 {
        self.files.values().map(|f| f.bytes).sum()
    }
}

/// One run's directory in the lake.
#[derive(Debug, Clone)]
pub struct LakeRun {
    pub node: String,
    pub dir: PathBuf,
    pub record: LakeRecord,
}

/// Every run the lake holds, by its repo-relative path. Every node's checkout has every run directory, so a run
/// is in the lake once per node; the copy that counts is the one with the most bytes (the node that ran it),
/// and only then the newest.
pub fn lake_runs(store: &Path) -> Result<BTreeMap<String, LakeRun>> {
    let mut out: BTreeMap<String, LakeRun> = BTreeMap::new();
    let Ok(nodes) = std::fs::read_dir(store) else { return Ok(out) };
    for node in nodes.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
        let name = node.file_name().to_string_lossy().to_string();
        let mut found = Vec::new();
        find_lake_runs(&node.path(), &mut found);
        for dir in found {
            let rel = dir.strip_prefix(node.path()).unwrap_or(&dir).to_string_lossy().replace('\\', "/");
            let record: LakeRecord = std::fs::read(dir.join(COLLECTION_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
            let better = out.get(&rel).is_none_or(|prev| {
                (record.held_bytes(), record.collected_at.unwrap_or(0.0)) > (prev.record.held_bytes(), prev.record.collected_at.unwrap_or(0.0))
            });
            if better {
                out.insert(rel, LakeRun { node: name.clone(), dir, record });
            }
        }
    }
    Ok(out)
}

fn find_lake_runs(dir: &Path, out: &mut Vec<PathBuf>) {
    if dir.join(COLLECTION_FILE).is_file() || dir.join(SERVER_LOG).is_file() || dir.join(STORIES_DIR).is_dir() {
        out.push(dir.to_path_buf());
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()) {
        find_lake_runs(&e.path(), out);
    }
}

/// A story's full log in the lake, if the run is there and the story has one.
fn lake_story_log(lake: &LakeRun, story: i64) -> Option<PathBuf> {
    let p = lake.dir.join(STORIES_DIR).join(format!("{story:02}")).join(EVENTS_FILE);
    p.is_file().then_some(p)
}

/// Every story run id with a log anywhere: published (the compact log in git) or in the lake (the
/// full log), the lake's path mapped to its published name where the combination was renamed.
/// The archived runs (`archived`, from the decisions) are never candidates.
pub fn candidates(published: &dyn Published, archived: &BTreeSet<String>, lake: &BTreeMap<String, LakeRun>) -> Result<BTreeSet<String>> {
    candidates_profiled(published, archived, lake, &mut Profile::default())
}

/// `candidates`, charging where its time went to `prof`.
pub fn candidates_profiled(published: &dyn Published, archived: &BTreeSet<String>, lake: &BTreeMap<String, LakeRun>, prof: &mut Profile) -> Result<BTreeSet<String>> {
    let is_archived = |story: &str| super::split_story_rel(story).is_some_and(|(run, _)| archived.contains(run));
    let mut out = BTreeSet::new();
    let first_paths = prof.time("candidates.published_paths", || published.paths())?;
    prof.time("candidates.compact_scan", || {
        for path in first_paths.keys() {
            if path.contains(RESCORE_DIR) {
                continue;
            }
            if let Some(dir) = path.strip_suffix(&format!("/{COMPACT_LOG}")).filter(|d| !is_archived(d)) {
                out.insert(dir.to_string());
            }
        }
    });
    let published_paths = prof.time("candidates.published_paths", || published.paths())?;
    // A run under `-opencode/` is a pi run recorded before the rename only if nothing is published under that name: a real
    // OpenCode run publishes its records under its own.
    let renamed = |run: &str| -> String {
        let has_own = published_paths.keys().any(|p| p.starts_with(&format!("{run}/")));
        if has_own { run.to_string() } else { run.replace(RENAMED_FROM, RENAMED_TO) }
    };
    prof.time("candidates.lake_scan", || {
    for (run, lr) in lake {
        if !under_published_root(run) || run.contains(RESCORE_DIR) || archived.contains(run) || archived.contains(&renamed(run)) {
            continue;
        }
        let Ok(stories) = std::fs::read_dir(lr.dir.join(STORIES_DIR)) else { continue };
        for s in stories.filter_map(|e| e.ok()) {
            let name = s.file_name().to_string_lossy().to_string();
            if s.path().join(EVENTS_FILE).is_file() && name.chars().all(|c| c.is_ascii_digit()) {
                let rel = format!("{run}/{STORIES_DIR}/{name}");
                let published_name = format!("{}/{STORIES_DIR}/{name}", renamed(run));
                out.insert(if out.contains(&published_name) { published_name } else { rel });
            }
        }
    }
    });
    Ok(out)
}

fn gunzip(bytes: &[u8]) -> Result<String> {
    let mut out = String::new();
    flate2::read::GzDecoder::new(bytes).read_to_string(&mut out).context("gunzip")?;
    Ok(out)
}

/// The text of a file, lossily (a log may hold bytes that aren't UTF-8); only its complete lines
/// when `complete_lines_only` (a file still being appended to ends mid-line).
/// The two phases a text file's time is charged to: reading its bytes, and turning them into a string.
#[derive(Clone, Copy)]
pub struct TextPhases {
    pub read: &'static str,
    pub decode: &'static str,
}

pub const LAKE_EVENTS_TEXT: TextPhases = TextPhases { read: "inputs_for.read_lake", decode: "inputs_for.decode_lake" };
pub const CONDITIONS_TEXT: TextPhases = TextPhases { read: "inputs_for.read_conditions", decode: "inputs_for.decode_conditions" };
pub const SERVER_LOG_TEXT: TextPhases = TextPhases { read: "run.read_server_log", decode: "run.decode_server_log" };

pub fn read_text(path: &Path, complete_lines_only: bool, prof: &mut Profile, phases: TextPhases) -> Result<Option<String>> {
    let started = std::time::Instant::now();
    let read = std::fs::read(path);
    let size = read.as_ref().map_or(0, |b| b.len() as u64);
    prof.record(phases.read, started.elapsed().as_secs_f64(), size);
    let bytes = match read {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let started = std::time::Instant::now();
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if complete_lines_only && !text.ends_with('\n') {
        match text.rfind('\n') {
            Some(i) => text.truncate(i + 1),
            None => text.clear(),
        }
    }
    prof.record(phases.decode, started.elapsed().as_secs_f64(), size);
    Ok(Some(text))
}

/// How much of a log file is read into memory at a time.
const LOG_READ_BUF_BYTES: usize = 256 * 1024;

/// Each line of a story's log, as `str::lines` gives them from the text `read_text` would make (decoded lossily, only
/// its complete lines for a file still being appended to), handed to `f` a line at a time so the log is never held
/// whole. Returns the length of that text: the bytes consumed. A file gone by now is no lines.
pub fn for_each_line(log: &EventsLog, prof: &mut Profile, mut f: impl FnMut(&str)) -> Result<u64> {
    let (path, complete_lines_only) = match log {
        EventsLog::None => return Ok(0),
        EventsLog::Text(text) => {
            text.lines().for_each(&mut f);
            return Ok(text.len() as u64);
        }
        EventsLog::File { path, complete_lines_only } => (path, *complete_lines_only),
    };
    let started = std::time::Instant::now();
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            prof.record(LAKE_EVENTS_TEXT.read, started.elapsed().as_secs_f64(), 0);
            return Ok(0);
        }
        Err(e) => return Err(e.into()),
    };
    let mut reader = std::io::BufReader::with_capacity(LOG_READ_BUF_BYTES, file);
    let (mut buf, mut read_s, mut decode_s, mut bytes, mut consumed) = (Vec::new(), started.elapsed().as_secs_f64(), 0.0, 0u64, 0u64);
    loop {
        buf.clear();
        let t = std::time::Instant::now();
        let n = reader.read_until(b'\n', &mut buf)?;
        read_s += t.elapsed().as_secs_f64();
        if n == 0 {
            break;
        }
        bytes += n as u64;
        let ended = buf.last() == Some(&b'\n');
        if !ended && complete_lines_only {
            break;
        }
        let t = std::time::Instant::now();
        let text = String::from_utf8_lossy(&buf);
        decode_s += t.elapsed().as_secs_f64();
        consumed += text.len() as u64;
        let line = match text.strip_suffix('\n') {
            Some(l) => l.strip_suffix('\r').unwrap_or(l),
            None => &text,
        };
        f(line);
    }
    prof.record(LAKE_EVENTS_TEXT.read, read_s, bytes);
    prof.record(LAKE_EVENTS_TEXT.decode, decode_s, bytes);
    Ok(consumed)
}

/// The published record of a run: metrics.json, run.json, run-status.json (each `{}` when absent).
#[derive(Debug, Clone, Default)]
pub struct RunRecord {
    pub metrics: Value,
    pub run_json: Value,
    pub status_json: Value,
    pub ids: String,
}

pub fn run_record(published: &dyn Published, ids: &BTreeMap<String, String>, run_dir: &str) -> Result<RunRecord> {
    let mut rec = RunRecord::default();
    let mut id_parts = Vec::new();
    for (name, slot) in [(METRICS_FILE, &mut rec.metrics), (RUN_FILE, &mut rec.run_json), (RUN_STATUS_FILE, &mut rec.status_json)] {
        let path = format!("{run_dir}/{name}");
        id_parts.push(format!("{name}={}", ids.get(&path).map_or("", String::as_str)));
        if let Some(bytes) = published.read(&path)? {
            *slot = serde_json::from_slice(&bytes).unwrap_or(Value::Object(Default::default()));
        } else {
            *slot = Value::Object(Default::default());
        }
    }
    rec.ids = id_parts.join(";");
    Ok(rec)
}

/// Gather one story's inputs: the full log from the lake when the run is there and the story has
/// one, else the compact log from git; the record from git; the lake's conditions and flags.
/// Where a story's texts are to be read from, once it is known to have changed.
#[derive(Debug, Clone, Default)]
pub struct Sources {
    /// The full log in the lake, read to its last complete line while the run is not complete.
    lake_log: Option<PathBuf>,
    /// The compact log in git, when the lake has no full log.
    compact: Option<String>,
    /// The machine readings in the lake.
    conditions: Option<PathBuf>,
    lake_complete: bool,
}

/// A story's inputs without their texts: what they are, where they are and their digest, from file stamps and git ids
/// alone. Deciding that a story is unchanged reads nothing (30 Oct 2026: reading every story's log first cost 25 GB a
/// pass and a 2 GB peak, to learn nothing had changed). `load_texts` reads them for a story that has.
pub fn plan_inputs(ids: &BTreeMap<String, String>, lake: Option<&LakeRun>, rel: &str, record: &RunRecord, prof: &mut Profile) -> Result<(StoryInputs, Sources)> {
    let (run_dir, story) = super::split_story_rel(rel).with_context(|| format!("not a story run id: {rel}"))?;
    let mut inp = StoryInputs { rel: rel.to_string(), run_dir: run_dir.to_string(), story, ..Default::default() };
    let mut src = Sources { lake_complete: lake.is_some_and(|l| l.record.complete), ..Default::default() };
    let mut digest = vec![format!("record:{}", record.ids)];
    let compact_path = format!("{rel}/{COMPACT_LOG}");
    let lake_log = prof.time("inputs_for.lake_lookup", || lake.and_then(|l| lake_story_log(l, story)));
    // The published log is read only for a story the lake has no full log of.
    if let Some(p) = lake_log {
        inp.events_source = EVENTS_FULL.into();
        inp.events_path = Some(p.display().to_string());
        let stamp = prof.time("inputs_for.stat", || (std::fs::metadata(&p).map_or(0, |m| m.len() as i64), stamp_of(&p)));
        inp.events_bytes = stamp.0;
        digest.push(format!("full:{}", stamp.1));
        src.lake_log = Some(p);
    } else if let Some(id) = ids.get(&compact_path) {
        inp.events_source = EVENTS_COMPACT.into();
        inp.events_path = Some(compact_path.clone());
        digest.push(format!("compact:{id}"));
        src.compact = Some(compact_path);
    } else {
        inp.events_source = EVENTS_NONE.into();
    }
    if let Some(l) = lake {
        let cond = l.dir.join(STORIES_DIR).join(format!("{story:02}")).join(CONDITIONS_FILE);
        if prof.time("inputs_for.stat", || cond.is_file()) {
            digest.push(format!("conditions:{}", prof.time("inputs_for.stat", || stamp_of(&cond))));
            src.conditions = Some(cond);
        }
        prof.time("inputs_for.stat", || {
            inp.has_server_log = l.dir.join(SERVER_LOG).is_file();
            inp.has_proxy_log = l.dir.join(PROXY_LOG).is_file();
            inp.has_egress = l.dir.join(EGRESS_FILE).is_file();
            inp.has_progress = l.dir.join(PROGRESS_FILE).is_file();
        });
        inp.node = Some(l.node.clone());
        inp.collected_at = l.record.collected_at;
        inp.complete = l.record.complete;
        if inp.has_server_log {
            digest.push(format!("server:{}", prof.time("inputs_for.stat", || stamp_of(&l.dir.join(SERVER_LOG)))));
        }
    } else {
        // Nothing to wait for from a machine: a published story is as complete as it will be.
        inp.complete = true;
    }
    inp.rec = record.metrics.get("stories").and_then(|s| s.get(story.to_string())).cloned().unwrap_or(Value::Object(Default::default()));
    inp.run_json = record.run_json.clone();
    inp.status_json = record.status_json.clone();
    digest.push(format!("complete:{}", inp.complete));
    inp.inputs_digest = format!("{:016x}", crate::collect::fnv1a64(digest.join("|").as_bytes()));
    Ok((inp, src))
}

/// Read a planned story's texts: its log (full from the lake, else compact from git) and its machine readings.
pub fn load_texts(published: &dyn Published, inp: &mut StoryInputs, src: &Sources, prof: &mut Profile) -> Result<()> {
    if let Some(p) = &src.lake_log {
        inp.events = EventsLog::File { path: p.clone(), complete_lines_only: !src.lake_complete };
    } else if let Some(path) = &src.compact {
        let read = prof.time("inputs_for.git_read", || published.read(path))?;
        prof.add_bytes("inputs_for.git_read", read.as_ref().map_or(0, |b| b.len() as u64));
        match read {
            Some(bytes) => {
                let started = std::time::Instant::now();
                let text = gunzip(&bytes)?;
                prof.record("inputs_for.gunzip", started.elapsed().as_secs_f64(), text.len() as u64);
                inp.events = EventsLog::Text(text);
                inp.events_bytes = bytes.len() as i64;
            }
            // Listed in git but gone when read: as if there were no log.
            None => {
                inp.events_source = EVENTS_NONE.into();
                inp.events_path = None;
            }
        }
    }
    if let Some(cond) = &src.conditions {
        inp.conditions_text = read_text(cond, !src.lake_complete, prof, CONDITIONS_TEXT)?;
    }
    Ok(())
}

/// A story's inputs, texts and all.
pub fn inputs_for(published: &dyn Published, ids: &BTreeMap<String, String>, lake: Option<&LakeRun>, rel: &str, record: &RunRecord, prof: &mut Profile) -> Result<StoryInputs> {
    let (mut inp, src) = plan_inputs(ids, lake, rel, record, prof)?;
    load_texts(published, &mut inp, &src, prof)?;
    Ok(inp)
}

/// Which stories to ingest.
#[derive(Debug, Clone, Default)]
pub struct Selection {
    /// Ingest every candidate, changed or not.
    pub all: bool,
    /// Only these story run ids (or every story of a run dir given).
    pub only: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Summary {
    pub candidates: usize,
    pub ingested: usize,
    pub unchanged: usize,
    pub requests: usize,
    pub runs: usize,
    pub seconds: f64,
    pub profile: crate::profile::Profile,
}

/// Ingest what changed (or everything): each candidate story, then each run's requests.
pub fn run(db: &mut super::db::Db, published: &dyn Published, store: &Path, sel: &Selection, now: f64) -> Result<Summary> {
    let started = std::time::Instant::now();
    let mut prof = Profile::default();
    let decided = prof.time("decisions", || decisions(store))?;
    let archived = archived_of(&decided);
    // A full ingest only (no runs named): the purges scan whole tables, and a pass that names the runs it changed
    // runs after a full one has already applied every decision (A-049).
    if sel.only.is_empty() {
        prof.time("purge_reference", || db.purge_reference())?;          // anything an earlier version ingested
        prof.time("purge_archived", || db.purge_runs(&archived))?; // and any run archived since it was ingested
    }
    let ids = prof.time("published_paths", || published.paths())?;
    let lake = prof.time("lake_scan", || lake_runs(store))?;
    let mut by_run: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for rel in candidates_profiled(published, &archived, &lake, &mut prof)? {
        if !sel.only.is_empty() && !sel.only.iter().any(|o| rel == *o || rel.starts_with(&format!("{o}/"))) {
            continue;
        }
        if let Some((run_dir, _)) = super::split_story_rel(&rel) {
            by_run.entry(run_dir.to_string()).or_default().push(rel.clone());
        }
    }
    let mut summary = Summary { candidates: by_run.values().map(Vec::len).sum(), runs: by_run.len(), ..Default::default() };
    for (run_dir, stories) in &by_run {
        let Some(parts) = super::run_parts(run_dir) else { continue };
        let record = prof.time("run_record", || run_record(published, &ids, run_dir))?;
        let lr = lake.get(run_dir);
        let mut calls = Vec::new();
        let mut complete = HashMap::new();
        let mut unchanged_sks = Vec::new();
        let mut changed = false;
        for rel in stories {
            let (mut inp, src) = plan_inputs(&ids, lr, rel, &record, &mut prof)?;
            // The digest holds every input, the run's completeness included, so an equal one means nothing changed,
            // complete or not: a run that never completes (its node gone, the run stopped) is not redone every pass.
            let (sk, same) = prof.time("digest_check", || -> Result<_> {
                let sk = db.story_sk(rel)?;
                let same = match sk {
                    Some(sk) => db.collection_digest(sk)?.filter(|(d, _)| *d == inp.inputs_digest).map(|(_, c)| c),
                    None => None,
                };
                Ok((sk, same))
            })?;
            if let (Some(was_complete), false) = (same, sel.all) {
                summary.unchanged += 1;
                if let Some(sk) = sk {
                    unchanged_sks.push(sk);
                    complete.insert(sk, was_complete);
                }
                continue;
            }
            load_texts(published, &mut inp, &src, &mut prof)?;
            let out = super::ingest_story_profiled(db, &parts, &inp, now, &mut prof)?;
            complete.insert(out.sk, inp.complete);
            calls.push(out.calls);
            summary.ingested += 1;
            changed = true;
        }
        if changed || sel.all {
            // The run's requests are placed among all its stories' calls; an unchanged story's come from the database.
            for sk in unchanged_sks {
                calls.push(prof.time("calls_from_db", || story_calls_from_db(db, sk))?);
            }
            let server_log = match lr {
                Some(l) => read_text(&l.dir.join(SERVER_LOG), !l.record.complete, &mut prof, SERVER_LOG_TEXT)?,
                None => None,
            };
            summary.requests += super::ingest_run_requests_profiled(db, run_dir, server_log.as_deref(), &calls, &complete, &mut prof)?;
        }
    }
    prof.time("verdicts", || update_verdicts(db, published, &archived))?;
    // Every row, every pass: a decision made after a story was ingested changes none of its inputs, so it would never
    // reach that row through the story's digest.
    prof.time("decisions_apply", || db.apply_decisions(&decided))?;
    prof.time("set_meta", || -> Result<()> {
        db.set_meta("built_at", &format!("{now:.3}"))?;
        db.set_meta("source", &published.describe())?;
        db.set_meta("ingest_version", &super::INGEST_VERSION.to_string())
    })?;
    summary.profile = prof;
    summary.seconds = started.elapsed().as_secs_f64();
    Ok(summary)
}

/// The verdict on every story the operator ended early that the warehouse holds, worked out again from every run's
/// records (story 23, ingest.verdict), and stored in place of the last pass's.
pub fn update_verdicts(db: &mut super::db::Db, published: &dyn Published, archived: &BTreeSet<String>) -> Result<usize> {
    use super::verdict::{baselines, ended_at, ended_early, verdict};
    let mut rows = Vec::new();
    let packs: BTreeSet<String> = published
        .paths()?
        .keys()
        .filter_map(|p| p.split_once("/benchmarks/").and_then(|(_, rest)| rest.split('/').next()).map(String::from))
        .collect();
    for pack in packs {
        let runs = verdict_runs(published, archived, &pack)?;
        for r in runs.iter().filter(|r| !r.reference) {
            let Some(stories) = r.metrics.get("stories").and_then(Value::as_object) else { continue };
            for (key, rec) in stories.iter().filter(|(_, rec)| ended_early(rec)) {
                let Ok(story) = key.parse::<i64>() else { continue };
                let Some(sk) = db.story_sk(&format!("{}/{STORIES_DIR}/{story:02}", r.id))? else { continue };
                let Some(end) = ended_at(rec) else { continue };
                let base = baselines(&runs, story, &r.id, end);
                rows.push((sk, verdict(rec, story, &base), base.len()));
            }
        }
    }
    db.replace_verdicts(&rows)?;
    Ok(rows.len())
}

/// A story's calls as the database has them (for placing requests without re-reading its log).
fn story_calls_from_db(db: &super::db::Db, sk: i64) -> Result<super::StoryCalls> {
    let (t_from, t_to): (Option<f64>, Option<f64>) = db.conn.query_row("select started, finished from stories where sk = ?1", [sk], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let mut q = db.conn.prepare("select idx, sent, first, rx, in_tok, cache_tok, out_tok from calls where sk = ?1 and sent is not null order by idx")?;
    let calls = q
        .query_map([sk], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                super::Call { sent: r.get(1)?, first: r.get(2)?, end: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0), fresh: r.get::<_, Option<i64>>(4)?.unwrap_or(0), cached: r.get::<_, Option<i64>>(5)?.unwrap_or(0), out: r.get(6)?, id: None },
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(super::StoryCalls { sk, t_from: t_from.unwrap_or(0.0), t_to: t_to.unwrap_or(f64::MAX), calls })
}

/// `--schema`: the schema as text, for SCHEMA.md.
pub fn write_schema(mut out: impl Write) -> Result<()> {
    out.write_all(super::db::SCHEMA.as_bytes())?;
    Ok(())
}

/// A line-oriented reader over a file, for tests of the partial-last-line rule.
pub fn complete_lines(reader: impl BufRead) -> Vec<String> {
    let mut out = Vec::new();
    let mut buf = String::new();
    let mut r = reader;
    loop {
        buf.clear();
        match r.read_line(&mut buf) {
            Ok(0) => break,
            Ok(_) if buf.ends_with('\n') => out.push(buf.trim_end_matches('\n').to_string()),
            Ok(_) => break,
            Err(_) => break,
        }
    }
    out
}
