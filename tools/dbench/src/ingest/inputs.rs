//! Where a story's inputs come from: the published record and compact log from git (origin/main,
//! read without touching the working copy, or a plain directory tree for tests), and the
//! machine-only files from the lake (`<store>/<node>/<run path>/`, as `dbench collect` lays them
//! out). `candidates` is every story with a log in either; `inputs_for` gathers one story's inputs
//! and the digest that says whether they changed since it was last ingested.

use anyhow::{Context, Result};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};

use super::{StoryInputs, EVENTS_COMPACT, EVENTS_FULL, EVENTS_NONE};
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

/// The published side: a path's bytes, and the blob id that names its content.
pub trait Published {
    /// Every published path under the roots, with the id of its content.
    fn paths(&self) -> Result<BTreeMap<String, String>>;
    fn read(&self, path: &str) -> Result<Option<Vec<u8>>>;
    /// What this source is (for the database's meta).
    fn describe(&self) -> String;
}

/// origin/main (or any rev) of a git repository, read with `git ls-tree` and `git cat-file`.
pub struct GitSource {
    pub repo: PathBuf,
    pub rev: String,
    ids: std::cell::RefCell<Option<BTreeMap<String, String>>>,
}

impl GitSource {
    pub fn new(repo: &Path, rev: &str) -> Self {
        GitSource { repo: repo.to_path_buf(), rev: rev.to_string(), ids: std::cell::RefCell::new(None) }
    }

    fn git(&self, args: &[&str]) -> Result<Vec<u8>> {
        let out = std::process::Command::new("git").arg("-C").arg(&self.repo).args(args).output().context("run git")?;
        anyhow::ensure!(out.status.success(), "git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim());
        Ok(out.stdout)
    }

    pub fn fetch(&self) -> Result<()> {
        if let Some((remote, _)) = self.rev.split_once('/') {
            self.git(&["fetch", "--quiet", remote, "main"])?;
        }
        Ok(())
    }

    fn ids(&self) -> Result<BTreeMap<String, String>> {
        if let Some(ids) = self.ids.borrow().as_ref() {
            return Ok(ids.clone());
        }
        let mut args = vec!["ls-tree", "-r", "-z", self.rev.as_str(), "--"];
        args.extend(PUBLISHED_ROOTS);
        let out = self.git(&args)?;
        let mut ids = BTreeMap::new();
        for entry in out.split(|&b| b == 0).filter(|e| !e.is_empty()) {
            let line = String::from_utf8_lossy(entry);
            let (meta, path) = match line.split_once('\t') {
                Some(x) => x,
                None => continue,
            };
            let id = meta.split_whitespace().nth(2).unwrap_or("");
            ids.insert(path.to_string(), id.to_string());
        }
        *self.ids.borrow_mut() = Some(ids.clone());
        Ok(ids)
    }
}

impl Published for GitSource {
    fn paths(&self) -> Result<BTreeMap<String, String>> {
        self.ids()
    }

    fn read(&self, path: &str) -> Result<Option<Vec<u8>>> {
        let ids = self.ids()?;
        let Some(id) = ids.get(path) else { return Ok(None) };
        Ok(Some(self.git(&["cat-file", "blob", id])?))
    }

    fn describe(&self) -> String {
        format!("git {} {}", self.repo.display(), self.rev)
    }
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

    fn describe(&self) -> String {
        format!("tree {}", self.root.display())
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
pub fn candidates(published: &dyn Published, lake: &BTreeMap<String, LakeRun>) -> Result<BTreeSet<String>> {
    let mut out = BTreeSet::new();
    for path in published.paths()?.keys() {
        if path.contains(RESCORE_DIR) {
            continue;
        }
        if let Some(dir) = path.strip_suffix(&format!("/{COMPACT_LOG}")) {
            out.insert(dir.to_string());
        }
    }
    for (run, lr) in lake {
        if run.contains(RESCORE_DIR) {
            continue;
        }
        let Ok(stories) = std::fs::read_dir(lr.dir.join(STORIES_DIR)) else { continue };
        for s in stories.filter_map(|e| e.ok()) {
            let name = s.file_name().to_string_lossy().to_string();
            if s.path().join(EVENTS_FILE).is_file() && name.chars().all(|c| c.is_ascii_digit()) {
                let rel = format!("{run}/{STORIES_DIR}/{name}");
                let published_name = rel.replace(RENAMED_FROM, RENAMED_TO);
                out.insert(if out.contains(&published_name) { published_name } else { rel });
            }
        }
    }
    Ok(out)
}

fn gunzip(bytes: &[u8]) -> Result<String> {
    let mut out = String::new();
    flate2::read::GzDecoder::new(bytes).read_to_string(&mut out).context("gunzip")?;
    Ok(out)
}

/// The text of a file, lossily (a log may hold bytes that aren't UTF-8); only its complete lines
/// when `complete_lines_only` (a file still being appended to ends mid-line).
pub fn read_text(path: &Path, complete_lines_only: bool) -> Result<Option<String>> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if complete_lines_only && !text.ends_with('\n') {
        match text.rfind('\n') {
            Some(i) => text.truncate(i + 1),
            None => text.clear(),
        }
    }
    Ok(Some(text))
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
pub fn inputs_for(published: &dyn Published, ids: &BTreeMap<String, String>, lake: Option<&LakeRun>, rel: &str, record: &RunRecord) -> Result<StoryInputs> {
    let (run_dir, story) = super::split_story_rel(rel).with_context(|| format!("not a story run id: {rel}"))?;
    let mut inp = StoryInputs { rel: rel.to_string(), run_dir: run_dir.to_string(), story, ..Default::default() };
    let mut digest = vec![format!("record:{}", record.ids)];
    let compact_path = format!("{rel}/{COMPACT_LOG}");
    let lake_log = lake.and_then(|l| lake_story_log(l, story));
    let lake_complete = lake.is_some_and(|l| l.record.complete);
    if let Some(p) = &lake_log {
        inp.events_text = read_text(p, !lake_complete)?;
        inp.events_source = EVENTS_FULL.into();
        inp.events_path = Some(p.display().to_string());
        inp.events_bytes = std::fs::metadata(p).map_or(0, |m| m.len() as i64);
        digest.push(format!("full:{}", stamp_of(p)));
    } else if let Some(bytes) = published.read(&compact_path)? {
        inp.events_text = Some(gunzip(&bytes)?);
        inp.events_source = EVENTS_COMPACT.into();
        inp.events_path = Some(compact_path.clone());
        inp.events_bytes = bytes.len() as i64;
        digest.push(format!("compact:{}", ids.get(&compact_path).map_or("", String::as_str)));
    } else {
        inp.events_source = EVENTS_NONE.into();
    }
    if let Some(l) = lake {
        let cond = l.dir.join(STORIES_DIR).join(format!("{story:02}")).join(CONDITIONS_FILE);
        if cond.is_file() {
            inp.conditions_text = read_text(&cond, !lake_complete)?;
            digest.push(format!("conditions:{}", stamp_of(&cond)));
        }
        inp.has_server_log = l.dir.join(SERVER_LOG).is_file();
        inp.has_proxy_log = l.dir.join(PROXY_LOG).is_file();
        inp.has_egress = l.dir.join(EGRESS_FILE).is_file();
        inp.has_progress = l.dir.join(PROGRESS_FILE).is_file();
        inp.node = Some(l.node.clone());
        inp.collected_at = l.record.collected_at;
        inp.complete = l.record.complete;
        if inp.has_server_log {
            digest.push(format!("server:{}", stamp_of(&l.dir.join(SERVER_LOG))));
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
}

/// Ingest what changed (or everything): each candidate story, then each run's requests.
pub fn run(db: &mut super::db::Db, published: &dyn Published, store: &Path, sel: &Selection, now: f64) -> Result<Summary> {
    let started = std::time::Instant::now();
    db.purge_reference()?;          // anything an earlier version ingested
    let ids = published.paths()?;
    let lake = lake_runs(store)?;
    let mut by_run: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for rel in candidates(published, &lake)? {
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
        let record = run_record(published, &ids, run_dir)?;
        let lr = lake.get(run_dir);
        let mut calls = Vec::new();
        let mut complete = HashMap::new();
        let mut changed = false;
        for rel in stories {
            let inp = inputs_for(published, &ids, lr, rel, &record)?;
            let sk = db.story_sk(rel)?;
            let same = match sk {
                Some(sk) => db.collection_digest(sk)?.is_some_and(|(d, c)| d == inp.inputs_digest && c),
                None => false,
            };
            if same && !sel.all {
                summary.unchanged += 1;
                if let Some(sk) = sk {
                    calls.push(story_calls_from_db(db, sk)?);
                    complete.insert(sk, true);
                }
                continue;
            }
            let out = super::ingest_story(db, &parts, &inp, now)?;
            complete.insert(out.sk, inp.complete);
            calls.push(out.calls);
            summary.ingested += 1;
            changed = true;
        }
        if changed || sel.all {
            let server_log = match lr {
                Some(l) => read_text(&l.dir.join(SERVER_LOG), !l.record.complete)?,
                None => None,
            };
            summary.requests += super::ingest_run_requests(db, run_dir, server_log.as_deref(), &calls, &complete)?;
        }
    }
    db.set_meta("built_at", &format!("{now:.3}"))?;
    db.set_meta("source", &published.describe())?;
    db.set_meta("ingest_version", &super::INGEST_VERSION.to_string())?;
    summary.seconds = started.elapsed().as_secs_f64();
    Ok(summary)
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
