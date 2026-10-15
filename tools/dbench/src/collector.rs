//! `dbench collect`: the host's loop. Each pass lists every node's runs, pulls the bytes of their
//! collectable files it doesn't hold yet into the lake (`<store>/<node>/<run path>/`; a reference
//! model's run goes to `<reference>/<pack>/<stack>/<run>/`), records what it holds in collection.json
//! beside them, and ingests the stories whose inputs changed. The local file's length is the cursor
//! for a log that grows; a large file is pulled into a dot-partial file and renamed into place when
//! complete. A crash between a write and the record is healed on the next pass.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::cli::CollectArgs;
use crate::client::{Api, Chunk, Ctx, RunRef};
use crate::collect::{check_window, fnv1a64, Class, FileEntry, FileKind, Manifest, RunStatus};
use crate::ids::{valid_id, valid_run_dir};
/// A reference model's run id begins like this; its files go to the reference folder.
use crate::ingest::db::REFERENCE_RUN_PREFIX;
use crate::timefmt::now_secs;

pub const COLLECTION_FILE: &str = "collection.json";
/// A file is fetched again from 0 at most this many times in one pass (a node rewriting it under us).
pub const MAX_REFETCHES_PER_PASS: u32 = 2;
/// Run states (run-status.json) after which nothing more is written.
const SETTLED_STATES: [&str; 3] = ["finished", "failed", "stopped"];
/// Job states after which the harness is gone.
const TERMINAL_JOB_STATES: [&str; 3] = ["done", "failed", "cancelled"];
const NO_API: &str = "none";
/// `benchmarks/reference/<pack>/<stack>/<run>`: the three segments after the prefix.
const REFERENCE_SEGMENTS: usize = 3;
/// A combination run's directory ends `benchmarks/<pack>/<run>`: this many segments from the end.
const BENCHMARKS_FROM_END: usize = 3;
/// `combinations/<...>/benchmarks/<pack>/<run>` has at least this many segments.
const MIN_COMBINATION_RUN_SEGMENTS: usize = 5;
const COMBINATIONS_TOP: &str = "combinations";
const BENCHMARKS_SEGMENT: &str = "benchmarks";
/// Stable codes the collector's reports start with.
pub const E_NODE_UNREACHABLE: &str = "E-NODE-UNREACHABLE";
pub const E_NODE_OLD: &str = "E-NODE-OLD";
pub const E_NOT_A_RUN_PATH: &str = "E-NOT-A-RUN-PATH";
pub const E_REFERENCE_DEST: &str = "E-REFERENCE-DEST";
pub const E_BLOB_SHORT: &str = "E-BLOB-SHORT";
pub const E_REFETCH_LIMIT: &str = "E-REFETCH-LIMIT";
/// Bytes in a gibibyte, for the free-space margin.
pub const BYTES_PER_GIB: u64 = 1024 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Cadence {
    pub running_poll: Duration,
    pub finished_recheck: Duration,
    pub settle_grace: Duration,
}

/// A large file part-way through its transfer: what the lake holds of it and the identity of the node file it started
/// from. A pass resumes it only while the node file still has that size and mtime.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Partial {
    pub bytes: u64,
    pub node_size: u64,
    pub node_mtime: f64,
}

/// What the lake holds of one file.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Collected {
    pub bytes: u64,
    pub node_size: u64,
    pub node_mtime: f64,
    pub at_eof: bool,
    pub pulled_at: u64,
    #[serde(default)]
    pub refetches: u32,
    /// Set while a blob is being pulled; a note written before blobs existed has none.
    #[serde(default)]
    pub partial: Option<Partial>,
}

/// collection.json: facts about what was collected, never a fault or a reason.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct Collection {
    pub node: String,
    pub run: String,
    pub job: Option<String>,
    pub run_status: Option<RunStatus>,
    pub job_state: Option<String>,
    pub complete: bool,
    pub first_collected_at: u64,
    pub collected_at: u64,
    pub settled_at: Option<u64>,
    #[serde(default)]
    pub files: BTreeMap<String, Collected>,
    /// Files the node holds below a tree rule whose names the rules refuse: a count, not a fault.
    #[serde(default)]
    pub unlisted: u64,
    pub dbench_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Skip,
    Append { from: u64 },
    Refetch,
    Whole,
    /// A blob: from this offset of its partial file (0 for a fresh start).
    Blob { resume_from: u64 },
}

/// The dot-partial file a blob is pulled into, beside its final name: `a/b/.c.bin.partial` for `a/b/c.bin`.
pub fn partial_name(name: &str) -> String {
    match name.rsplit_once('/') {
        Some((dir, file)) => format!("{dir}/.{file}.partial"),
        None => format!(".{name}.partial"),
    }
}

fn partial_path(dest: &Path) -> PathBuf {
    let file = dest.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    dest.with_file_name(format!(".{file}{}", crate::collect::PARTIAL_SUFFIX))
}

/// What to do about each file the node lists, from what the lake holds (the local length first,
/// the record second).
pub fn plan(manifest: &Manifest, local: &Collection, local_len: impl Fn(&str) -> u64) -> Vec<(FileEntry, Action)> {
    manifest
        .files
        .iter()
        .map(|f| {
            let len = local_len(&f.name);
            let rec = local.files.get(&f.name);
            let action = match f.kind {
                FileKind::Whole => match rec {
                    Some(r) if r.node_size == f.size && r.node_mtime == f.mtime && len == f.size => Action::Skip,
                    _ => Action::Whole,
                },
                FileKind::Append => {
                    if len > f.size {
                        Action::Refetch
                    } else if len == f.size {
                        Action::Skip
                    } else {
                        Action::Append { from: len }
                    }
                }
                FileKind::Blob => match rec {
                    Some(r) if r.partial.is_none() && r.at_eof && r.node_size == f.size && r.node_mtime == f.mtime && len == f.size => Action::Skip,
                    Some(r) => match &r.partial {
                        Some(p) if p.node_size == f.size && p.node_mtime == f.mtime && local_len(&partial_name(&f.name)) >= p.bytes => Action::Blob { resume_from: p.bytes },
                        _ => Action::Blob { resume_from: 0 },
                    },
                    None => Action::Blob { resume_from: 0 },
                },
            };
            (f.clone(), action)
        })
        .collect()
}

/// The run is over on the node: its status is final and its job, if any, has ended.
pub fn settled(m: &Manifest) -> bool {
    let status_final = m.run_status.as_ref().is_some_and(|s| SETTLED_STATES.contains(&s.state.as_str()));
    let job_over = m.job_state.as_deref().is_none_or(|s| TERMINAL_JOB_STATES.contains(&s));
    status_final && job_over
}

/// Whether a run's lake record says every listed file is held to its end and nothing changed since.
pub fn all_at_eof(m: &Manifest, local: &Collection) -> bool {
    m.files
        .iter()
        .all(|f| local.files.get(&f.name).is_some_and(|r| r.at_eof && r.partial.is_none() && r.node_size == f.size && r.node_mtime == f.mtime))
}

/// Whether a run is looked at this pass: always, unless its collection is complete and was checked recently.
pub fn due(c: Option<&Collection>, now: u64, cadence: &Cadence) -> bool {
    match c {
        Some(c) if c.complete => now.saturating_sub(c.collected_at) >= cadence.finished_recheck.as_secs(),
        _ => true,
    }
}

/// Whether a repo-relative path is a run: `combinations/<...>/benchmarks/<pack>/<run>` or
/// `benchmarks/reference/<pack>/<stack>/<run>`, every segment a valid id. `a/b` and `../x` are not.
pub fn is_run_path(run: &str) -> bool {
    if !valid_run_dir(run) {
        return false;
    }
    let segs: Vec<&str> = run.split('/').collect();
    if let Some(rest) = run.strip_prefix(REFERENCE_RUN_PREFIX) {
        return rest.split('/').count() == REFERENCE_SEGMENTS;
    }
    segs.len() >= MIN_COMBINATION_RUN_SEGMENTS && segs[0] == COMBINATIONS_TOP && segs[segs.len() - BENCHMARKS_FROM_END] == BENCHMARKS_SEGMENT
}

/// `<store>/<node>/<run path>`; None for a run path the node should not have sent.
pub fn store_dir(store: &Path, node: &str, run: &str) -> Option<PathBuf> {
    if !is_run_path(run) || !valid_id(node) {
        return None;
    }
    Some(store.join(node).join(run))
}

/// Where a run's files go: `<reference>/<pack>/<stack>/<run>` for a reference model's run (the node is not in the path,
/// because a run name is unique and the note records the node), `<store>/<node>/<run path>` for any other.
pub fn dest_dir(store: &Path, reference: &Path, node: &str, run: &str) -> Option<PathBuf> {
    match run.strip_prefix(REFERENCE_RUN_PREFIX) {
        Some(rest) if is_run_path(run) => {
            let parts: Vec<&str> = rest.split('/').collect();
            Some(reference.join(parts[0]).join(parts[1]).join(parts[2]))
        }
        Some(_) => None,
        None => store_dir(store, node, run),
    }
}

/// Which classes of file a run's destination takes: a reference model's run takes its records only, so the lake never
/// holds its uncompacted transcript.
pub fn classes_for(run: &str) -> &'static [Class] {
    if run.starts_with(REFERENCE_RUN_PREFIX) {
        &[Class::Record]
    } else {
        &[Class::Record, Class::Raw]
    }
}

pub fn load_collection(dir: &Path) -> Option<Collection> {
    let bytes = std::fs::read(dir.join(COLLECTION_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn save_collection(dir: &Path, c: &Collection) -> Result<()> {
    crate::store::create_private_dir_all(dir)?;
    crate::store::write_atomic_private(&dir.join(COLLECTION_FILE), &serde_json::to_vec_pretty(c)?)
}

fn local_len(path: &Path) -> u64 {
    std::fs::metadata(path).map_or(0, |m| m.len())
}

fn tail_hash(path: &Path, from: u64) -> Result<String> {
    use std::io::{Read, Seek, SeekFrom};
    let (start, end) = check_window(from);
    let mut f = std::fs::File::open(path)?;
    f.seek(SeekFrom::Start(start))?;
    let mut buf = vec![0u8; (end - start) as usize];
    f.read_exact(&mut buf)?;
    Ok(format!("{:016x}", fnv1a64(&buf)))
}

/// The outcome of pulling one file this pass.
#[derive(Debug, Clone, PartialEq)]
pub struct Pulled {
    /// What the lake holds of the file now.
    pub bytes: u64,
    /// What this pull transferred.
    pub pulled: u64,
    pub at_eof: bool,
    pub refetches: u32,
    pub meta: crate::collect::ChunkMeta,
}

/// Pull one file into `dest`: an append-only file from its local length with the prefix check,
/// refetched from 0 when the node says the prefix differs; a whole file replaced atomically.
pub async fn pull_file(api: &Api, run: &RunRef, entry: &FileEntry, action: Action, dest: &Path) -> Result<Pulled> {
    if let Some(dir) = dest.parent() {
        crate::store::create_private_dir_all(dir)?;
    }
    let mut refetches = 0;
    let mut from = match action {
        Action::Append { from } => from,
        Action::Refetch | Action::Whole => 0,
        Action::Skip | Action::Blob { .. } => local_len(dest),
    };
    if matches!(action, Action::Refetch) {
        refetches += 1;
    }
    if matches!(action, Action::Whole) {
        let chunk = api.file_chunk(run, &entry.name, 0, None, None).await?;
        let Some(meta) = chunk.meta.filter(|_| chunk.status.is_success()) else {
            anyhow::bail!("{}: {} {}", entry.name, chunk.status, chunk.error.unwrap_or_default());
        };
        crate::store::write_atomic_private(dest, &chunk.bytes)?;
        return Ok(Pulled { bytes: chunk.bytes.len() as u64, pulled: chunk.bytes.len() as u64, at_eof: meta.eof, refetches, meta });
    }
    let mut pulled = 0;
    let meta = loop {
        let check = if from > 0 { Some(tail_hash(dest, from)?) } else { None };
        let Chunk { status, meta, bytes, error } = api.file_chunk(run, &entry.name, from, check.as_deref(), None).await?;
        if status == reqwest::StatusCode::CONFLICT {
            refetches += 1;
            if refetches > MAX_REFETCHES_PER_PASS {
                anyhow::bail!("{}: {E_REFETCH_LIMIT}: the node's file keeps changing under the read", entry.name);
            }
            crate::store::open_private(dest, false, true)?;
            from = 0;
            continue;
        }
        let Some(meta) = meta.filter(|_| status.is_success()) else {
            anyhow::bail!("{}: {} {}", entry.name, status, error.unwrap_or_default());
        };
        if from == 0 && local_len(dest) > 0 {
            crate::store::open_private(dest, false, true)?;
        }
        let mut f = crate::store::open_private(dest, true, false)?;
        f.write_all(&bytes)?;
        f.sync_data()?;
        from += bytes.len() as u64;
        pulled += bytes.len() as u64;
        // Nothing more came: the node's file ends here (eof), or nothing to wait for and the next pass tries again.
        if meta.eof || bytes.is_empty() {
            break meta;
        }
    };
    Ok(Pulled { bytes: from, pulled, at_eof: meta.eof, refetches, meta })
}

/// Pull a large file into a dot-partial file beside `dest` and rename it into place once its length equals the size the
/// node reported at the end: the final name never holds a half-written file. `resume` is the identity recorded for a
/// partial left by an earlier pass; it is used only when the node's file still has that size and mtime. `progress` is
/// told after every chunk what the partial holds, so the caller can record it and a crash resumes from there.
pub async fn pull_blob(
    api: &Api,
    run: &RunRef,
    entry: &FileEntry,
    dest: &Path,
    resume: Option<&Partial>,
    progress: &mut (dyn FnMut(&Partial) -> Result<()> + Send),
) -> Result<Pulled> {
    if let Some(dir) = dest.parent() {
        crate::store::create_private_dir_all(dir)?;
    }
    let part = partial_path(dest);
    let mut refetches = 0;
    let mut pulled = 0u64;
    let mut from = 0u64;
    let mut mtime_held: Option<f64> = None;
    if let Some(p) = resume.filter(|p| p.node_size == entry.size && p.node_mtime == entry.mtime && local_len(&part) >= p.bytes) {
        let f = std::fs::OpenOptions::new().write(true).open(&part)?;
        f.set_len(p.bytes)?;
        from = p.bytes;
        mtime_held = Some(p.node_mtime);
    } else {
        let _ = std::fs::remove_file(&part);
    }
    loop {
        let chunk = api.file_chunk(run, &entry.name, from, None, mtime_held.filter(|_| from > 0)).await?;
        let discard = |why: &str, refetches: &mut u32| -> Result<()> {
            let _ = std::fs::remove_file(&part);
            *refetches += 1;
            if *refetches > MAX_REFETCHES_PER_PASS {
                anyhow::bail!("{}: {E_REFETCH_LIMIT}: the node's file keeps changing under the read ({why})", entry.name);
            }
            Ok(())
        };
        if chunk.status == reqwest::StatusCode::CONFLICT {
            discard("E-BLOB-CHANGED", &mut refetches)?;
            from = 0;
            mtime_held = None;
            continue;
        }
        let Chunk { status, meta, bytes, error } = chunk;
        let Some(meta) = meta.filter(|_| status.is_success()) else {
            anyhow::bail!("{}: {} {}", entry.name, status, error.unwrap_or_default());
        };
        if from == 0 {
            crate::store::open_private(&part, false, true)?;
            mtime_held = Some(meta.mtime);
        }
        let mut f = crate::store::open_private(&part, true, false)?;
        f.write_all(&bytes)?;
        f.sync_data()?;
        from += bytes.len() as u64;
        pulled += bytes.len() as u64;
        progress(&Partial { bytes: from, node_size: meta.size, node_mtime: meta.mtime })?;
        if meta.eof || bytes.is_empty() {
            if from != meta.size {
                discard(E_BLOB_SHORT, &mut refetches)?;
                from = 0;
                mtime_held = None;
                continue;
            }
            std::fs::rename(&part, dest).with_context(|| format!("rename to {}", dest.display()))?;
            return Ok(Pulled { bytes: from, pulled, at_eof: true, refetches, meta });
        }
    }
}

/// What one pass did for one run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct RunSummary {
    pub run: String,
    pub pulled_files: usize,
    pub pulled_bytes: u64,
    pub complete: bool,
    pub changed: bool,
}

/// Collect one run of one node into `dir`; the record it leaves says what it holds. Only the classes of file in
/// `classes` are taken (a reference model's run takes its records only).
pub async fn collect_run(api: &Api, node: &str, run: &str, dir: &Path, classes: &[Class], cadence: &Cadence, now: u64) -> Result<RunSummary> {
    let mut local = load_collection(dir).unwrap_or_else(|| Collection {
        node: node.to_string(),
        run: run.to_string(),
        first_collected_at: now,
        dbench_version: crate::VERSION.to_string(),
        ..Default::default()
    });
    let mut summary = RunSummary { run: run.to_string(), ..Default::default() };
    if !due(Some(&local), now, cadence) {
        summary.complete = local.complete;
        return Ok(summary);
    }
    let run_ref = RunRef::Path(run.to_string());
    let mut manifest = api.files(&run_ref).await?;
    manifest.files.retain(|f| crate::collect::parse_name(&f.name).is_some_and(|n| classes.contains(&n.class())));
    let was_complete = local.complete;
    for (entry, action) in plan(&manifest, &local, |name| local_len(&dir.join(name))) {
        let dest = dir.join(&entry.name);
        let pulled = match action {
            Action::Skip => {
                if let Some(r) = local.files.get_mut(&entry.name) {
                    r.node_size = entry.size;
                    r.node_mtime = entry.mtime;
                    r.at_eof = r.bytes >= entry.size;
                }
                continue;
            }
            Action::Blob { resume_from } => {
                let resume = local.files.get(&entry.name).and_then(|r| r.partial.clone()).filter(|p| p.bytes == resume_from);
                let name = entry.name.clone();
                let mut record = |p: &Partial| -> Result<()> {
                    local.files.entry(name.clone()).or_default().partial = Some(p.clone());
                    save_collection(dir, &local)
                };
                pull_blob(api, &run_ref, &entry, &dest, resume.as_ref(), &mut record).await?
            }
            other => pull_file(api, &run_ref, &entry, other, &dest).await?,
        };
        summary.pulled_files += 1;
        summary.pulled_bytes += pulled.pulled;
        summary.changed = true;
        let rec = local.files.entry(entry.name.clone()).or_default();
        *rec = Collected {
            bytes: pulled.bytes,
            node_size: pulled.meta.size,
            node_mtime: pulled.meta.mtime,
            at_eof: pulled.at_eof,
            pulled_at: now,
            refetches: rec.refetches + pulled.refetches,
            partial: None,
        };
    }
    local.node = node.to_string();
    local.job = manifest.job.clone();
    local.run_status = manifest.run_status.clone();
    local.job_state = manifest.job_state.clone();
    local.unlisted = manifest.unlisted;
    local.collected_at = now;
    local.dbench_version = crate::VERSION.to_string();
    // A run is complete only when a look after the grace finds nothing to pull: a pass that pulled anything starts it over.
    if settled(&manifest) && all_at_eof(&manifest, &local) && summary.pulled_files == 0 {
        match local.settled_at {
            None => local.settled_at = Some(now),
            Some(at) if now.saturating_sub(at) >= cadence.settle_grace.as_secs() => local.complete = true,
            Some(_) => {}
        }
    } else {
        local.settled_at = None;
        local.complete = false;
    }
    summary.complete = local.complete;
    summary.changed |= local.complete != was_complete;
    save_collection(dir, &local)?;
    Ok(summary)
}

/// What one pass did for one node.
#[derive(Debug, Clone, Default, Serialize)]
pub struct NodeSummary {
    pub node: String,
    pub reachable: bool,
    pub runs: Vec<RunSummary>,
    pub problems: Vec<String>,
}

/// Whether a pass pulls this run: never an archived one, even when asked for by name; otherwise every run, or only the
/// ones asked for. A reference model's run is wanted too: its records go to the reference folder.
pub fn wanted(run: &str, only_runs: &[String], archived: &BTreeSet<String>) -> bool {
    !archived.contains(run) && (only_runs.is_empty() || only_runs.iter().any(|r| r == run))
}

/// The archived runs, from the same published tree the ingest reads. None known (no repo, or it can't be read) means
/// none skipped: the ingest still leaves them out, reading the tree itself.
fn archived_runs(cfg: &Config) -> BTreeSet<String> {
    let Some(repo) = cfg.repo.as_ref() else { return BTreeSet::new() };
    let published: Box<dyn crate::ingest::inputs::Published> = if cfg.worktree {
        Box::new(crate::ingest::inputs::TreeSource { root: repo.clone() })
    } else {
        Box::new(crate::ingest::inputs::GitSource::new(repo, "origin/main"))
    };
    published.archived().unwrap_or_else(|e| {
        eprintln!("dbench collect: the archived runs can't be read: {e:#}");
        BTreeSet::new()
    })
}

/// Where a pass puts what it pulls: the lake for a node's runs, the reference folder for a reference model's.
#[derive(Debug, Clone, Copy)]
pub struct Lake<'a> {
    pub store: &'a Path,
    pub reference: &'a Path,
}

pub async fn collect_node(ctx: &Ctx, node: &str, lake: Lake<'_>, only_runs: &[String], archived: &BTreeSet<String>, cadence: &Cadence, now: u64) -> NodeSummary {
    let mut out = NodeSummary { node: node.to_string(), ..Default::default() };
    let api = match ctx.api(node) {
        Ok(a) => a,
        Err(e) => {
            out.problems.push(format!("{E_NODE_UNREACHABLE}: {e:#}"));
            return out;
        }
    };
    let runs = match api.runs().await {
        Ok(r) => r,
        Err(e) => {
            out.problems.push(if e.to_string().contains("404") { format!("{E_NODE_OLD}: needs the new dbench (no /v1/runs)") } else { format!("{E_NODE_UNREACHABLE}: unreachable: {e:#}") });
            return out;
        }
    };
    out.reachable = true;
    for r in runs {
        if !wanted(&r.run, only_runs, archived) {
            continue;
        }
        let Some(dir) = dest_dir(lake.store, lake.reference, node, &r.run) else {
            let code = if r.run.starts_with(REFERENCE_RUN_PREFIX) { E_REFERENCE_DEST } else { E_NOT_A_RUN_PATH };
            out.problems.push(format!("{code}: {}: not a run path", r.run));
            continue;
        };
        match collect_run(&api, node, &r.run, &dir, classes_for(&r.run), cadence, now).await {
            Ok(s) => out.runs.push(s),
            Err(e) => out.problems.push(format!("{}: {e:#}", r.run)),
        }
    }
    out
}

/// The free bytes of the disk that holds `path`.
pub fn free_bytes(path: &Path) -> std::io::Result<u64> {
    use std::os::unix::ffi::OsStrExt;
    let c = std::ffi::CString::new(path.as_os_str().as_bytes()).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    // SAFETY: an all-zero statvfs is a valid value to pass for the call to fill in.
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `c` is a NUL-terminated path that outlives the call, and `s` is a statvfs the call writes into.
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok((s.f_bavail as u64).saturating_mul(s.f_frsize as u64))
}

/// What the pass does about disk space: pull, or hold with a line that says why. Taken once, before any file is pulled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpaceDecision {
    Pull,
    Hold(String),
}

/// `free < margin` holds; exactly at the margin pulls. A reading that cannot be taken holds, and never guesses.
pub fn space_decision(free: std::io::Result<u64>, margin_gib: u64) -> SpaceDecision {
    let margin = margin_gib.saturating_mul(BYTES_PER_GIB);
    match free {
        Ok(f) if f >= margin => SpaceDecision::Pull,
        Ok(f) => SpaceDecision::Hold(format!("holding: {f} bytes free on the lake's disk, below the margin of {margin} bytes ({margin_gib} GiB)")),
        Err(e) => SpaceDecision::Hold(format!("holding: could not read the lake's free space ({e})")),
    }
}

/// One pass over the nodes, then the ingest of what changed.
pub async fn pass(ctx: &Ctx, cfg: &Config, cadence: &Cadence, fetch: bool, now: u64) -> Result<Vec<NodeSummary>> {
    crate::store::create_private_dir_all(&cfg.store)?;
    if let SpaceDecision::Hold(line) = space_decision((cfg.free_bytes)(&cfg.store), cfg.free_space_margin_gib) {
        eprintln!("dbench collect: {line}");
        return Ok(Vec::new());
    }
    let names: Vec<String> = if cfg.nodes.is_empty() { ctx.nodes.keys().cloned().collect() } else { cfg.nodes.clone() };
    let archived = archived_runs(cfg);
    let lake = Lake { store: &cfg.store, reference: &cfg.reference };
    let futs = names.iter().map(|n| collect_node(ctx, n, lake, &cfg.runs, &archived, cadence, now));
    let summaries = futures_util::future::join_all(futs).await;
    for s in &summaries {
        for p in &s.problems {
            eprintln!("dbench collect: {}: {p}", s.node);
        }
    }
    if let Some(repo) = cfg.repo.as_ref().filter(|_| !cfg.no_ingest) {
        let changed = summaries.iter().any(|s| s.runs.iter().any(|r| r.changed));
        if changed || fetch {
            let store = cfg.store.clone();
            let db_path = cfg.db.clone();
            let repo = repo.clone();
            let worktree = cfg.worktree;
            let summary = tokio::task::spawn_blocking(move || -> Result<crate::ingest::inputs::Summary> {
                let published: Box<dyn crate::ingest::inputs::Published> = if worktree {
                    Box::new(crate::ingest::inputs::TreeSource { root: repo })
                } else {
                    let g = crate::ingest::inputs::GitSource::new(&repo, "origin/main");
                    if fetch {
                        g.fetch()?;
                    }
                    Box::new(g)
                };
                if let Some(dir) = db_path.parent() {
                    std::fs::create_dir_all(dir)?;
                }
                let mut db = crate::ingest::db::Db::open(&db_path)?;
                crate::ingest::inputs::run(&mut db, published.as_ref(), &store, &Default::default(), now as f64)
            })
            .await??;
            if summary.ingested > 0 {
                eprintln!("dbench collect: ingested {} story runs, {} requests placed ({:.1} s)", summary.ingested, summary.requests, summary.seconds);
            }
            // The analytics layer is derived from the warehouse; its failure never stops collection.
            let warehouse = cfg.db.clone();
            let ingested = summary.ingested;
            match tokio::task::spawn_blocking(move || crate::analytics::after_ingest(&warehouse, ingested, now as f64)).await {
                Ok(Some(line)) => eprintln!("dbench collect: {line}"),
                Ok(None) => {}
                Err(e) => eprintln!("dbench collect: analytics: {e}"),
            }
        }
    }
    Ok(summaries)
}

/// The reads of the free bytes of a path; the one place a pass takes the reading, so a test can set it.
pub type FreeBytes = fn(&Path) -> std::io::Result<u64>;

/// The resolved settings of a collect command.
#[derive(Debug, Clone)]
pub struct Config {
    pub store: PathBuf,
    /// Where a reference model's runs go: `<reference>/<pack>/<stack>/<run>`.
    pub reference: PathBuf,
    pub db: PathBuf,
    pub repo: Option<PathBuf>,
    pub worktree: bool,
    pub api: Option<String>,
    pub nodes: Vec<String>,
    pub runs: Vec<String>,
    pub no_ingest: bool,
    /// The lake's disk must have at least this many GiB free for a pass to pull anything.
    pub free_space_margin_gib: u64,
    pub free_bytes: FreeBytes,
}

impl Default for Config {
    fn default() -> Config {
        Config {
            store: PathBuf::new(),
            reference: PathBuf::new(),
            db: PathBuf::new(),
            repo: None,
            worktree: false,
            api: None,
            nodes: Vec::new(),
            runs: Vec::new(),
            no_ingest: false,
            free_space_margin_gib: crate::cli::DEFAULT_FREE_SPACE_MARGIN_GIB,
            free_bytes,
        }
    }
}

pub fn resolve(ctx: &Ctx, args: &CollectArgs) -> Result<Config> {
    let store = args.store.clone().or_else(|| ctx.collect.store.clone()).context("--store, or [collect] store in nodes.toml: where the lake is")?;
    let db = args.db.clone().or_else(|| ctx.collect.db.clone()).context("--db, or [collect] db in nodes.toml: the conversation database")?;
    let repo = args.repo.clone().or_else(|| ctx.collect.repo.clone());
    anyhow::ensure!(repo.is_some() || args.no_ingest, "--repo, or [collect] repo in nodes.toml: the repository whose origin/main holds the records (or --no-ingest)");
    let api = args.api.clone().or_else(|| ctx.collect.api.clone()).unwrap_or_else(|| crate::cli::DEFAULT_API_BIND.to_string());
    let reference = args
        .reference
        .clone()
        .or_else(|| ctx.collect.reference.clone())
        .unwrap_or_else(|| store.parent().unwrap_or(Path::new("")).join(crate::cli::DEFAULT_REFERENCE_DIR));
    Ok(Config {
        store,
        reference,
        db,
        repo,
        worktree: args.worktree,
        api: (api != NO_API).then_some(api),
        nodes: args.nodes.clone(),
        runs: args.runs.clone(),
        no_ingest: args.no_ingest,
        free_space_margin_gib: args.free_space_margin_gib,
        free_bytes,
    })
}

pub async fn cmd_collect(ctx: &Ctx, args: &CollectArgs) -> Result<()> {
    if args.list_rules {
        print!("{}", crate::collect::list_rules());
        return Ok(());
    }
    let cfg = resolve(ctx, args)?;
    let cadence = Cadence {
        running_poll: Duration::from_millis(args.running_poll_ms),
        finished_recheck: Duration::from_millis(args.finished_recheck_ms),
        settle_grace: Duration::from_millis(args.settle_grace_ms),
    };
    crate::store::create_private_dir_all(&cfg.store)?;
    if args.once {
        let summaries = pass(ctx, &cfg, &cadence, true, now_secs()).await?;
        if ctx.json {
            println!("{}", serde_json::to_string_pretty(&summaries)?);
        } else {
            for s in &summaries {
                let pulled: u64 = s.runs.iter().map(|r| r.pulled_bytes).sum();
                println!(
                    "{:<12} {} runs, {} complete, {} bytes pulled{}",
                    s.node,
                    s.runs.len(),
                    s.runs.iter().filter(|r| r.complete).count(),
                    pulled,
                    if s.reachable { "" } else { " (unreachable)" }
                );
            }
        }
        return Ok(());
    }
    if let Some(bind) = cfg.api.clone() {
        let db = cfg.db.clone();
        tokio::spawn(async move {
            if let Err(e) = crate::conversation_api::serve(&bind, db).await {
                eprintln!("dbench collect: conversation API: {e:#}");
            }
        });
    }
    let fetch_every = Duration::from_millis(args.fetch_every_ms);
    let mut last_fetch: Option<std::time::Instant> = None;
    loop {
        let fetch = last_fetch.is_none_or(|t| t.elapsed() >= fetch_every);
        if let Err(e) = pass(ctx, &cfg, &cadence, fetch, now_secs()).await {
            eprintln!("dbench collect: {e:#}");
        }
        if fetch {
            last_fetch = Some(std::time::Instant::now());
        }
        tokio::time::sleep(cadence.running_poll).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::collect::{FileEntry, FileKind};

    #[test]
    fn an_archived_run_is_never_pulled_even_when_asked_for_and_only_runs_still_narrows() {
        let old = "combinations/a/benchmarks/vidi/canvas-01";
        let new = "combinations/a/benchmarks/vidi/v2-r1";
        let archived = std::collections::BTreeSet::from([old.to_string()]);
        assert!(!wanted(old, &[], &archived));
        assert!(wanted(new, &[], &archived));
        assert!(!wanted(old, &[old.to_string()], &archived));
        assert!(wanted(new, &[new.to_string()], &archived));
        assert!(!wanted(new, &["combinations/b/benchmarks/vidi/v2-r1".to_string()], &archived));
    }

    fn manifest(files: &[(&str, FileKind, u64, f64)], state: Option<&str>, job_state: Option<&str>) -> Manifest {
        Manifest {
            run: "combinations/a/b/benchmarks/p/r1".into(),
            job: job_state.map(|_| "j".into()),
            run_status: state.map(|s| RunStatus { state: s.into(), at: None }),
            job_state: job_state.map(String::from),
            files: files.iter().map(|(n, k, s, m)| FileEntry { name: n.to_string(), kind: *k, size: *s, mtime: *m }).collect(),
            unlisted: 0,
        }
    }

    fn cadence() -> Cadence {
        Cadence { running_poll: Duration::from_secs(10), finished_recheck: Duration::from_secs(3600), settle_grace: Duration::from_secs(60) }
    }

    #[test]
    fn plan_skips_unchanged_pulls_growth_refetches_a_shrunk_file_and_rewrites_whole_files() {
        let m = manifest(
            &[("server.log", FileKind::Append, 100, 1.0), ("stories/01/agent-events.jsonl", FileKind::Append, 50, 2.0), ("progress.json", FileKind::Whole, 10, 3.0), ("proxy.log", FileKind::Append, 7, 4.0)],
            Some("started"),
            Some("running"),
        );
        let mut local = Collection::default();
        local.files.insert("progress.json".into(), Collected { bytes: 10, node_size: 10, node_mtime: 3.0, at_eof: true, pulled_at: 1, refetches: 0, partial: None });
        let len = |name: &str| match name {
            "server.log" => 100,
            "stories/01/agent-events.jsonl" => 80,
            "progress.json" => 10,
            _ => 0,
        };
        let got: Vec<(String, Action)> = plan(&m, &local, len).into_iter().map(|(f, a)| (f.name, a)).collect();
        assert_eq!(
            got,
            [
                ("server.log".to_string(), Action::Skip),
                ("stories/01/agent-events.jsonl".to_string(), Action::Refetch),
                ("progress.json".to_string(), Action::Skip),
                ("proxy.log".to_string(), Action::Append { from: 0 }),
            ]
        );
        // The whole file changed on the node: fetched again.
        local.files.get_mut("progress.json").unwrap().node_mtime = 2.5;
        assert_eq!(plan(&m, &local, len)[2].1, Action::Whole);
        // An append-only file that grew: from the local length.
        let grown = |name: &str| if name == "server.log" { 60 } else { len(name) };
        assert_eq!(plan(&m, &local, grown)[0].1, Action::Append { from: 60 });
    }

    #[test]
    fn settled_needs_a_final_run_status_and_a_terminal_or_absent_job() {
        assert!(settled(&manifest(&[], Some("finished"), None)));
        assert!(settled(&manifest(&[], Some("failed"), Some("done"))));
        assert!(settled(&manifest(&[], Some("stopped"), Some("cancelled"))));
        assert!(!settled(&manifest(&[], Some("finished"), Some("running"))));
        assert!(!settled(&manifest(&[], Some("started"), None)));
        assert!(!settled(&manifest(&[], None, Some("done"))));
    }

    #[test]
    fn complete_only_after_every_file_is_at_eof_and_due_follows_the_cadence() {
        let m = manifest(&[("server.log", FileKind::Append, 100, 1.0)], Some("finished"), None);
        let mut local = Collection::default();
        assert!(!all_at_eof(&m, &local));
        local.files.insert("server.log".into(), Collected { bytes: 100, node_size: 100, node_mtime: 1.0, at_eof: true, pulled_at: 1, refetches: 0, partial: None });
        assert!(all_at_eof(&m, &local));
        local.files.get_mut("server.log").unwrap().node_mtime = 2.0;
        assert!(!all_at_eof(&m, &local));
        let c = cadence();
        assert!(due(None, 1000, &c));
        local.complete = false;
        local.collected_at = 999;
        assert!(due(Some(&local), 1000, &c));
        local.complete = true;
        assert!(!due(Some(&local), 1000, &c));
        assert!(due(Some(&local), 999 + 3600, &c));
    }

    #[test]
    fn store_dir_rejects_a_run_path_the_node_should_not_have_sent() {
        let store = Path::new("/lake");
        assert_eq!(store_dir(store, "node-a", "combinations/a/benchmarks/p/r1"), Some(PathBuf::from("/lake/node-a/combinations/a/benchmarks/p/r1")));
        assert!(store_dir(store, "node-a", "../etc").is_none());
        assert!(store_dir(store, "node-a", "/etc").is_none());
        assert!(store_dir(store, "../x", "combinations/a/benchmarks/p/r1").is_none());
    }

    fn config(repo: Option<PathBuf>, worktree: bool) -> Config {
        Config { store: PathBuf::from("/lake"), db: PathBuf::from("/db"), repo, worktree, api: None, nodes: vec![], runs: vec![], no_ingest: false, ..Default::default() }
    }

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dbench-collector-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"])
            .args(args)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    const ARCHIVED_COMBINATION_RUN: &str = "combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/canvas-01";
    const ARCHIVED_REFERENCE_RUN: &str = "benchmarks/reference/vidi/opus-5.5/run-2";
    const KEPT_RUN: &str = "combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/v2-r1";

    fn mark_archived(root: &Path) {
        for run in [ARCHIVED_COMBINATION_RUN, ARCHIVED_REFERENCE_RUN] {
            std::fs::create_dir_all(root.join(run)).unwrap();
            std::fs::write(root.join(run).join(crate::ingest::inputs::ARCHIVED_MARKER), "{}").unwrap();
        }
        std::fs::create_dir_all(root.join(KEPT_RUN)).unwrap();
        std::fs::write(root.join(KEPT_RUN).join("run.json"), "{}").unwrap();
    }

    #[test]
    fn the_archived_runs_come_from_the_working_tree_or_from_origin_main_and_none_known_means_none_skipped() {
        let both = BTreeSet::from([ARCHIVED_COMBINATION_RUN.to_string(), ARCHIVED_REFERENCE_RUN.to_string()]);
        // No repository configured: nothing is known, nothing is skipped.
        assert_eq!(archived_runs(&config(None, false)), BTreeSet::new());
        // The working tree (--worktree), combinations and reference runs alike.
        let tree = scratch("archived-tree");
        mark_archived(&tree);
        assert_eq!(archived_runs(&config(Some(tree.clone()), true)), both);
        // origin/main of a git repository: only what is committed there counts, and the working tree's own marker does not.
        let remote = scratch("archived-remote");
        let work = scratch("archived-work");
        git(&remote, &["init", "--bare", "-q"]);
        git(&work, &["init", "-q"]);
        git(&work, &["remote", "add", "origin", remote.to_str().unwrap()]);
        mark_archived(&work);
        git(&work, &["add", "-A"]);
        git(&work, &["commit", "-q", "-m", "archive two runs"]);
        git(&work, &["push", "-q", "origin", "HEAD:main"]);
        let unpushed = work.join(KEPT_RUN).join(crate::ingest::inputs::ARCHIVED_MARKER);
        std::fs::write(&unpushed, "{}").unwrap();
        assert_eq!(archived_runs(&config(Some(work.clone()), false)), both);
        assert_eq!(archived_runs(&config(Some(work.clone()), true)), BTreeSet::from([ARCHIVED_COMBINATION_RUN.to_string(), ARCHIVED_REFERENCE_RUN.to_string(), KEPT_RUN.to_string()]));
        // A directory that is not a repository cannot be read: none known (the message goes to stderr), none skipped.
        let plain = scratch("archived-plain");
        assert_eq!(archived_runs(&config(Some(plain.clone()), false)), BTreeSet::new());
        for d in [tree, remote, work, plain] {
            std::fs::remove_dir_all(d).unwrap();
        }
    }

    fn collect_args(extra: &[&str]) -> CollectArgs {
        let mut argv = vec!["dbench", "collect"];
        argv.extend(extra);
        match <crate::cli::Cli as clap::Parser>::try_parse_from(argv).unwrap().cmd {
            crate::cli::Cmd::Collect(a) => a,
            other => panic!("{other:?}"),
        }
    }

    fn ctx_with(collect: crate::client::CollectEntry) -> Ctx {
        Ctx { nodes: BTreeMap::new(), collect, json: false }
    }

    #[test]
    fn collect_settings_come_from_the_command_line_then_nodes_toml_and_the_records_repo_is_required_to_ingest() {
        let file = crate::client::CollectEntry { store: Some("/f/lake".into()), db: Some("/f/db".into()), repo: Some("/f/repo".into()), api: Some("127.0.0.1:9".into()), reference: None };
        let c = resolve(&ctx_with(file.clone()), &collect_args(&[])).unwrap();
        assert_eq!((c.store, c.db, c.repo, c.api), ("/f/lake".into(), "/f/db".into(), Some("/f/repo".into()), Some("127.0.0.1:9".to_string())));
        // The command line wins over the file, and "none" turns the API off.
        let c = resolve(&ctx_with(file), &collect_args(&["--store", "/c/lake", "--db", "/c/db", "--repo", "/c/repo", "--api", "none", "--node", "n1", "--run", "r1", "--worktree"])).unwrap();
        assert_eq!((c.store, c.db, c.repo, c.api, c.nodes, c.runs, c.worktree, c.no_ingest), ("/c/lake".into(), "/c/db".into(), Some("/c/repo".into()), None, vec!["n1".to_string()], vec!["r1".to_string()], true, false));
        // The API defaults to the built-in address.
        let only_paths = crate::client::CollectEntry { store: Some("/f/lake".into()), db: Some("/f/db".into()), repo: Some("/f/repo".into()), api: None, reference: None };
        assert_eq!(resolve(&ctx_with(only_paths), &collect_args(&[])).unwrap().api.as_deref(), Some(crate::cli::DEFAULT_API_BIND));
        // Without a repository there is nothing to ingest from, unless ingest is off.
        let no_repo = crate::client::CollectEntry { store: Some("/f/lake".into()), db: Some("/f/db".into()), repo: None, api: None, reference: None };
        let err = resolve(&ctx_with(no_repo.clone()), &collect_args(&[])).unwrap_err().to_string();
        assert!(err.contains("--repo") && err.contains("--no-ingest"), "{err}");
        assert!(resolve(&ctx_with(no_repo), &collect_args(&["--no-ingest"])).unwrap().no_ingest);
        // The lake and the database are required in either case.
        let err = resolve(&ctx_with(Default::default()), &collect_args(&["--no-ingest"])).unwrap_err().to_string();
        assert!(err.contains("--store"), "{err}");
        let only_store = crate::client::CollectEntry { store: Some("/f/lake".into()), ..Default::default() };
        let err = resolve(&ctx_with(only_store), &collect_args(&["--no-ingest"])).unwrap_err().to_string();
        assert!(err.contains("--db"), "{err}");
    }

    #[test]
    fn collection_json_round_trips_and_has_no_error_field() {
        let mut c = Collection { node: "n".into(), run: "r".into(), complete: true, first_collected_at: 1, collected_at: 2, settled_at: Some(2), dbench_version: "v".into(), ..Default::default() };
        c.files.insert("server.log".into(), Collected { bytes: 3, node_size: 3, node_mtime: 1.5, at_eof: true, pulled_at: 2, refetches: 1, partial: None });
        let text = serde_json::to_string_pretty(&c).unwrap();
        assert!(!text.contains("error") && !text.contains("reason") && !text.contains("problem"), "{text}");
        assert_eq!(serde_json::from_str::<Collection>(&text).unwrap(), c);
    }

    // ---- story 5: the lake takes the full record ----

    use crate::client::NodeEntry;
    use crate::collect::{RunListing, COLLECT_CHUNK_BYTES, HDR_EOF, HDR_FROM, HDR_MTIME, HDR_SIZE};
    use axum::{
        body::Body,
        extract::{Query, State},
        http::StatusCode,
        response::{IntoResponse, Response},
        routing::get,
        Json, Router,
    };
    use std::sync::{Arc, Mutex};

    /// A node that serves what a test gives it, over HTTP, with the faults a real node can have: a size that is too big
    /// (a lying or racing server), a file rewritten between two requests, an old node with no /v1/runs. It is a double of
    /// the transport only: the collector's own code is what runs against it.
    struct FakeFile {
        data: Vec<u8>,
        mtime: f64,
        kind: FileKind,
    }

    #[derive(Default)]
    struct FakeNode {
        files: BTreeMap<String, FakeFile>,
        state: Option<&'static str>,
        job_state: Option<&'static str>,
        runs: Vec<String>,
        runs_status: Option<u16>,
        lie: usize,
        bump: bool,
        requests: Vec<(String, u64, Option<String>)>,
        rewrite: Option<(usize, String, Vec<u8>)>,
    }

    type Fake = Arc<Mutex<FakeNode>>;

    async fn fake_runs(State(n): State<Fake>) -> Response {
        let n = n.lock().unwrap();
        if let Some(code) = n.runs_status {
            return (StatusCode::from_u16(code).unwrap(), "no such route").into_response();
        }
        let listing: Vec<RunListing> = n.runs.iter().map(|r| RunListing { run: r.clone(), job: None, run_status: None, job_state: None }).collect();
        Json(listing).into_response()
    }

    async fn fake_files(State(n): State<Fake>, Query(q): Query<BTreeMap<String, String>>) -> Response {
        let n = n.lock().unwrap();
        let files = n.files.iter().map(|(name, f)| FileEntry { name: name.clone(), kind: f.kind, size: f.data.len() as u64, mtime: f.mtime }).collect();
        Json(Manifest {
            run: q.get("run").cloned().unwrap_or_default(),
            job: None,
            run_status: n.state.map(|s| RunStatus { state: s.into(), at: None }),
            job_state: n.job_state.map(String::from),
            files,
            unlisted: 0,
        })
        .into_response()
    }

    async fn fake_file(State(n): State<Fake>, Query(q): Query<BTreeMap<String, String>>) -> Response {
        let mut n = n.lock().unwrap();
        let name = q.get("name").cloned().unwrap_or_default();
        let from: u64 = q.get("from").and_then(|f| f.parse().ok()).unwrap_or(0);
        let held = q.get("mtime").cloned();
        n.requests.push((name.clone(), from, held.clone()));
        let count = n.requests.len();
        if n.bump {
            for f in n.files.values_mut() {
                f.mtime += 1.0;
            }
        }
        if let Some((after, which, bytes)) = n.rewrite.clone() {
            if count > after {
                let f = n.files.get_mut(&which).unwrap();
                f.data = bytes;
                f.mtime += 1.0;
                n.rewrite = None;
            }
        }
        let lying = count <= n.lie;
        let Some(f) = n.files.get(&name) else {
            return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such file"}))).into_response();
        };
        let size = f.data.len() as u64;
        if f.kind == FileKind::Blob && (from > size || (from > 0 && held.as_deref() != Some(format!("{:.3}", f.mtime).as_str()))) {
            return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "E-BLOB-CHANGED", "size": size}))).into_response();
        }
        let end = (from + COLLECT_CHUNK_BYTES).min(size);
        let body = f.data[from as usize..end as usize].to_vec();
        let reported = if lying { size + 10 } else { size };
        axum::http::Response::builder()
            .header(HDR_FROM, from.to_string())
            .header(HDR_SIZE, reported.to_string())
            .header(HDR_MTIME, format!("{:.3}", f.mtime))
            .header(HDR_EOF, if end >= size { "1" } else { "0" })
            .body(Body::from(body))
            .unwrap()
    }

    /// The node on a free port: its address, a client for it and the shared state a test reads and changes.
    async fn serve_fake(node: FakeNode) -> (String, Api, Fake) {
        let shared: Fake = Arc::new(Mutex::new(node));
        let app = Router::new()
            .route("/v1/runs", get(fake_runs))
            .route("/v1/runs/files", get(fake_files))
            .route("/v1/runs/file", get(fake_file))
            .with_state(shared.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let api = Api::new(&NodeEntry { url: url.clone(), token: None }).unwrap();
        (url, api, shared)
    }

    /// Bytes that differ from place to place, so a wrong offset shows.
    fn pattern(len: usize, seed: u8) -> Vec<u8> {
        (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed).wrapping_add((i >> 8) as u8)).collect()
    }

    fn blob(data: Vec<u8>) -> FakeFile {
        FakeFile { data, mtime: 1_790_000_000.5, kind: FileKind::Blob }
    }

    fn whole(data: &[u8]) -> FakeFile {
        FakeFile { data: data.to_vec(), mtime: 1_790_000_000.5, kind: FileKind::Whole }
    }

    fn one_file(name: &str, f: FakeFile) -> FakeNode {
        FakeNode { files: BTreeMap::from([(name.to_string(), f)]), ..Default::default() }
    }

    fn entry_of(n: &Fake, name: &str) -> FileEntry {
        let n = n.lock().unwrap();
        let f = &n.files[name];
        FileEntry { name: name.into(), kind: f.kind, size: f.data.len() as u64, mtime: f.mtime }
    }

    fn requests(n: &Fake) -> Vec<(u64, Option<String>)> {
        n.lock().unwrap().requests.iter().map(|(_, from, held)| (*from, held.clone())).collect()
    }

    fn no_progress() -> impl FnMut(&Partial) -> Result<()> {
        |_| Ok(())
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dbench-collector-s5-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    const BUNDLE: &str = "workspace.bundle";
    fn run_ref() -> RunRef {
        RunRef::Path("combinations/a/benchmarks/p/r1".into())
    }

    // ---- lake.transfer.blob_files ----

    #[tokio::test]
    async fn a_blob_of_exactly_one_chunk_arrives_in_one_request_with_eof() {
        // TC-24
        let data = pattern(COLLECT_CHUNK_BYTES as usize, 1);
        let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
        let dir = scratch_dir("exact");
        let dest = dir.join(BUNDLE);
        let pulled = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
        assert_eq!(requests(&node).len(), 1);
        assert!(pulled.at_eof && pulled.bytes == data.len() as u64 && pulled.refetches == 0);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        assert!(!partial_path(&dest).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_blob_of_one_chunk_and_one_byte_arrives_in_two_requests() {
        // TC-25
        let data = pattern(COLLECT_CHUNK_BYTES as usize + 1, 2);
        let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
        let dir = scratch_dir("plus-one");
        let dest = dir.join(BUNDLE);
        pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
        // The second request names the identity the first carried.
        assert_eq!(requests(&node), [(0, None), (COLLECT_CHUNK_BYTES, Some("1790000000.500".to_string()))]);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_blob_of_zero_bytes_is_a_zero_byte_file_with_no_partial_left() {
        // TC-23 (the collector's half)
        let (_, api, node) = serve_fake(one_file(BUNDLE, blob(Vec::new()))).await;
        let dir = scratch_dir("zero");
        let dest = dir.join(BUNDLE);
        let pulled = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
        assert_eq!((pulled.bytes, pulled.at_eof), (0, true));
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), 0);
        assert!(!partial_path(&dest).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn the_final_name_appears_only_after_the_last_chunk_while_the_partial_holds_what_was_pulled() {
        // TC-17, TC-16 (three requests for ten MiB)
        let data = pattern(10 * 1024 * 1024, 3);
        let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
        let dir = scratch_dir("atomic");
        let dest = dir.join(BUNDLE);
        let part = partial_path(&dest);
        let mut seen: Vec<u64> = Vec::new();
        let mut progress = |p: &Partial| -> Result<()> {
            assert!(!dest.exists(), "the final name must not exist before the last chunk");
            assert_eq!(std::fs::metadata(&part).unwrap().len(), p.bytes, "the partial holds exactly what is recorded");
            assert_eq!((p.node_size, p.node_mtime), (data.len() as u64, 1_790_000_000.5));
            seen.push(p.bytes);
            Ok(())
        };
        pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut progress).await.unwrap();
        assert_eq!(requests(&node).len(), 3);
        assert_eq!(seen, [COLLECT_CHUNK_BYTES, 2 * COLLECT_CHUNK_BYTES, data.len() as u64]);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        assert!(!part.exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_pass_killed_after_two_chunks_is_resumed_from_the_partial_and_ends_equal() {
        // TC-18
        let data = pattern(10 * 1024 * 1024, 4);
        let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
        let dir = scratch_dir("resume");
        let dest = dir.join(BUNDLE);
        // What the killed pass left: two chunks in the partial, and the record of them.
        let two = 2 * COLLECT_CHUNK_BYTES;
        std::fs::write(partial_path(&dest), &data[..two as usize]).unwrap();
        let resume = Partial { bytes: two, node_size: data.len() as u64, node_mtime: 1_790_000_000.5 };
        pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, Some(&resume), &mut no_progress()).await.unwrap();
        assert_eq!(requests(&node), [(two, Some("1790000000.500".to_string()))], "one request, from the partial's length");
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        // A partial longer than the record (the kill came after a chunk but before the note) is cut back to the record.
        let _ = std::fs::remove_file(&dest);
        std::fs::write(partial_path(&dest), &data[..(two + 17) as usize]).unwrap();
        pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, Some(&resume), &mut no_progress()).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_partial_of_a_file_the_node_has_since_rewritten_is_discarded_and_the_file_fetched_from_the_start() {
        // TC-19 (the record no longer matches the manifest)
        let data = pattern(3 * 1024 * 1024, 5);
        let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
        let dir = scratch_dir("stale-partial");
        let dest = dir.join(BUNDLE);
        std::fs::write(partial_path(&dest), pattern(1000, 99)).unwrap();
        let stale = Partial { bytes: 1000, node_size: data.len() as u64, node_mtime: 1_790_000_000.4 };
        pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, Some(&stale), &mut no_progress()).await.unwrap();
        assert_eq!(requests(&node), [(0, None)]);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_file_rewritten_between_two_chunks_is_refused_with_a_conflict_and_the_copy_ends_equal_to_the_new_file() {
        // TC-19
        let old = pattern(6 * 1024 * 1024, 6);
        let new = pattern(5 * 1024 * 1024 + 123, 7);
        let mut fake = one_file(BUNDLE, blob(old));
        fake.rewrite = Some((1, BUNDLE.to_string(), new.clone()));
        let (_, api, node) = serve_fake(fake).await;
        let dir = scratch_dir("rewrite");
        let dest = dir.join(BUNDLE);
        let entry = entry_of(&node, BUNDLE);
        let pulled = pull_blob(&api, &run_ref(), &entry, &dest, None, &mut no_progress()).await.unwrap();
        assert_eq!(pulled.refetches, 1, "one refetch from 0");
        assert_eq!(std::fs::read(&dest).unwrap(), new);
        assert!(!partial_path(&dest).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_node_that_reports_more_bytes_than_it_sends_makes_the_collector_discard_the_partial_and_fetch_again() {
        // TC-22
        let data = pattern(100, 8);
        let mut fake = one_file(BUNDLE, blob(data.clone()));
        fake.lie = 1;
        let (_, api, node) = serve_fake(fake).await;
        let dir = scratch_dir("short-once");
        let dest = dir.join(BUNDLE);
        let pulled = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
        assert_eq!(pulled.refetches, 1);
        assert_eq!(requests(&node).len(), 2);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        assert!(!partial_path(&dest).exists());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_node_that_keeps_reporting_a_wrong_size_fails_with_both_codes_and_leaves_no_file_under_the_real_name() {
        // TC-22, TC-21
        let mut fake = one_file(BUNDLE, blob(pattern(100, 9)));
        fake.lie = 1000;
        let (_, api, node) = serve_fake(fake).await;
        let dir = scratch_dir("short-always");
        let dest = dir.join(BUNDLE);
        let err = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap_err().to_string();
        assert!(err.contains(E_REFETCH_LIMIT) && err.contains(E_BLOB_SHORT), "{err}");
        assert!(!dest.exists() && !partial_path(&dest).exists());
        assert_eq!(requests(&node).len(), (MAX_REFETCHES_PER_PASS + 1) as usize);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_blob_whose_node_file_changes_on_every_request_fails_and_the_lake_keeps_its_last_complete_copy() {
        // TC-21: the file is rewritten at every request, so every resume is refused.
        let last_good = pattern(50, 10);
        let dir = scratch_dir("limit");
        let dest = dir.join(BUNDLE);
        std::fs::write(&dest, &last_good).unwrap();
        let mut fake = one_file(BUNDLE, blob(pattern(5 * 1024 * 1024, 11)));
        fake.bump = true;
        let (_, api, node) = serve_fake(fake).await;
        let err = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap_err().to_string();
        assert!(err.contains(E_REFETCH_LIMIT), "{err}");
        assert_eq!(std::fs::read(&dest).unwrap(), last_good, "the complete copy is untouched");
        assert!(!partial_path(&dest).exists(), "no partial of a file that keeps changing is left behind");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_collection_note_written_before_blobs_existed_loads_with_no_partial() {
        // TC-28
        let old = r#"{"node":"n","run":"r","job":null,"run_status":null,"job_state":null,"complete":false,"first_collected_at":1,"collected_at":2,"settled_at":null,
            "files":{"server.log":{"bytes":3,"node_size":3,"node_mtime":1.5,"at_eof":true,"pulled_at":2}},"dbench_version":"v"}"#;
        let c: Collection = serde_json::from_str(old).unwrap();
        assert_eq!(c.files["server.log"].partial, None);
        assert_eq!(c.files["server.log"].refetches, 0);
        assert_eq!(c.unlisted, 0);
    }

    #[test]
    fn plan_skips_a_blob_the_lake_holds_resumes_a_matching_partial_and_starts_over_otherwise() {
        let blob_entry = |size: u64, mtime: f64| Manifest {
            run: "r".into(),
            job: None,
            run_status: None,
            job_state: None,
            files: vec![FileEntry { name: "workspace.bundle".into(), kind: FileKind::Blob, size, mtime }],
            unlisted: 0,
        };
        let held = |size: u64, mtime: f64| Collected { bytes: size, node_size: size, node_mtime: mtime, at_eof: true, pulled_at: 1, refetches: 0, partial: None };
        let action = |m: &Manifest, c: &Collection, final_len: u64, partial_len: u64| {
            plan(m, c, |n| if n == "workspace.bundle" { final_len } else if n == partial_name("workspace.bundle") { partial_len } else { 0 })[0].1
        };
        let mut local = Collection::default();
        // Nothing held: from the start.
        assert_eq!(action(&blob_entry(100, 2.0), &local, 0, 0), Action::Blob { resume_from: 0 });
        // Held, node unchanged: skipped. Node rewrote it (mtime or size): fetched again.
        local.files.insert("workspace.bundle".into(), held(100, 2.0));
        assert_eq!(action(&blob_entry(100, 2.0), &local, 100, 0), Action::Skip);
        assert_eq!(action(&blob_entry(100, 3.0), &local, 100, 0), Action::Blob { resume_from: 0 });
        assert_eq!(action(&blob_entry(120, 2.0), &local, 100, 0), Action::Blob { resume_from: 0 });
        // A zero-byte blob held is skipped too.
        let mut zero = Collection::default();
        zero.files.insert("workspace.bundle".into(), held(0, 2.0));
        assert_eq!(action(&blob_entry(0, 2.0), &zero, 0, 0), Action::Skip);
        // A partial whose recorded identity is the manifest's resumes from its recorded length, if the partial file holds that much.
        let mut part = Collection::default();
        part.files.insert("workspace.bundle".into(), Collected { bytes: 40, node_size: 100, node_mtime: 2.0, at_eof: false, pulled_at: 1, refetches: 0, partial: Some(Partial { bytes: 40, node_size: 100, node_mtime: 2.0 }) });
        assert_eq!(action(&blob_entry(100, 2.0), &part, 0, 40), Action::Blob { resume_from: 40 });
        assert_eq!(action(&blob_entry(100, 2.0), &part, 0, 55), Action::Blob { resume_from: 40 }, "longer is cut back to the record");
        assert_eq!(action(&blob_entry(100, 2.0), &part, 0, 39), Action::Blob { resume_from: 0 }, "shorter than recorded: start over");
        assert_eq!(action(&blob_entry(100, 4.0), &part, 0, 40), Action::Blob { resume_from: 0 }, "the node file changed");
        assert_eq!(action(&blob_entry(101, 2.0), &part, 0, 40), Action::Blob { resume_from: 0 });
    }

    #[test]
    fn the_partial_file_sits_beside_the_final_name_and_starts_with_a_dot() {
        assert_eq!(partial_name("workspace.bundle"), ".workspace.bundle.partial");
        assert_eq!(partial_name("a/b/c.bin"), "a/b/.c.bin.partial");
        assert_eq!(partial_path(Path::new("/lake/n/r/stories/01/accept.json")), PathBuf::from("/lake/n/r/stories/01/.accept.json.partial"));
        // The collected rules never accept it, and the not-collected list names it.
        assert!(crate::collect::parse_name(&partial_name("stories/01/accept.json")).is_none());
        assert!(matches!(crate::collect::classify(&partial_name("stories/01/accept.json")), crate::collect::Classification::NotCollected(..)));
    }

    // ---- lake.reference.collect_into_reference ----

    #[test]
    fn a_reference_run_goes_to_the_reference_folder_by_pack_stack_and_run_and_any_other_run_to_the_lake() {
        // TC-59, TC-60
        let (store, reference) = (Path::new("/lake"), Path::new("/ref"));
        assert_eq!(dest_dir(store, reference, "node-a", "benchmarks/reference/vidi/opus-5.5/v2-r1"), Some(PathBuf::from("/ref/vidi/opus-5.5/v2-r1")));
        assert_eq!(
            dest_dir(store, reference, "node-a", "combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/v2-r1"),
            Some(PathBuf::from("/lake/node-a/combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/v2-r1"))
        );
        // Boundary: dots and dashes in the stack name, and a pack other than vidi.
        assert_eq!(dest_dir(store, reference, "n", "benchmarks/reference/todoodle/sonnet-5.5-x.y/run-3"), Some(PathBuf::from("/ref/todoodle/sonnet-5.5-x.y/run-3")));
    }

    #[test]
    fn a_reference_run_id_of_the_wrong_shape_has_no_destination() {
        // TC-61
        let (store, reference) = (Path::new("/lake"), Path::new("/ref"));
        for bad in [
            "benchmarks/reference/vidi/opus-5.5",
            "benchmarks/reference/vidi",
            "benchmarks/reference/",
            "benchmarks/reference/vidi/opus-5.5/v2-r1/extra",
            "benchmarks/reference/vidi/../v2-r1",
            "benchmarks/reference/../x/y",
            "benchmarks/reference/vidi/opus 5.5/v2-r1",
            "benchmarks/reference/vidi/opus-5.5/v2-r1/",
        ] {
            assert_eq!(dest_dir(store, reference, "n", bad), None, "{bad}");
        }
    }

    #[test]
    fn a_reference_run_is_wanted_an_archived_one_is_not_and_the_run_narrowing_works_as_before() {
        // TC-62
        let reference = "benchmarks/reference/vidi/opus-5.5/v2-r1";
        let none = BTreeSet::new();
        assert!(wanted(reference, &[], &none));
        assert!(wanted(reference, &[reference.to_string()], &none));
        assert!(!wanted(reference, &["benchmarks/reference/vidi/opus-5.5/v2-r2".to_string()], &none));
        let archived = BTreeSet::from([reference.to_string()]);
        assert!(!wanted(reference, &[], &archived));
        assert!(!wanted(reference, &[reference.to_string()], &archived));
        assert!(wanted("combinations/a/benchmarks/vidi/v2-r1", &[], &archived));
    }

    #[test]
    fn a_reference_run_takes_its_records_only_and_any_other_run_takes_both_classes() {
        assert_eq!(classes_for("benchmarks/reference/vidi/opus-5.5/v2-r1"), &[Class::Record]);
        assert_eq!(classes_for("combinations/a/benchmarks/p/r1"), &[Class::Record, Class::Raw]);
    }

    fn node_with_run_files(run: &str) -> FakeNode {
        let mut files = BTreeMap::new();
        files.insert("run.json".to_string(), whole(b"{}"));
        files.insert("metrics.json".to_string(), whole(b"{\"stories\":{}}"));
        files.insert("workspace.bundle".to_string(), blob(pattern(5000, 12)));
        files.insert("stories/01/agent-events.compact.jsonl.gz".to_string(), blob(pattern(3000, 13)));
        files.insert("stories/01/agent-events.jsonl".to_string(), FakeFile { data: pattern(2000, 14), mtime: 1_790_000_000.5, kind: FileKind::Append });
        files.insert("server.log".to_string(), FakeFile { data: pattern(500, 15), mtime: 1_790_000_000.5, kind: FileKind::Append });
        FakeNode { files, state: Some("finished"), runs: vec![run.to_string()], ..Default::default() }
    }

    fn cadence_with_grace(grace_secs: u64) -> Cadence {
        Cadence { running_poll: Duration::from_secs(10), finished_recheck: Duration::from_secs(3600), settle_grace: Duration::from_secs(grace_secs) }
    }

    #[tokio::test]
    async fn the_note_of_a_reference_run_holds_the_full_id_and_the_node_and_a_second_node_updates_it_in_the_one_folder() {
        // TC-66, TC-68, TC-63 (records in, raw out)
        let run = "benchmarks/reference/vidi/opus-5.5/v2-r1";
        let (_, api, _) = serve_fake(node_with_run_files(run)).await;
        let root = scratch_dir("reference-note");
        let (store, reference) = (root.join("lake"), root.join("reference"));
        let dir = dest_dir(&store, &reference, "node-a", run).unwrap();
        collect_run(&api, "node-a", run, &dir, classes_for(run), &cadence_with_grace(0), 100).await.unwrap();
        let note = load_collection(&dir).unwrap();
        assert_eq!((note.run.as_str(), note.node.as_str()), (run, "node-a"));
        let mut held: Vec<&str> = note.files.keys().map(String::as_str).collect();
        held.sort_unstable();
        assert_eq!(held, ["metrics.json", "run.json", "stories/01/agent-events.compact.jsonl.gz", "workspace.bundle"], "records only");
        assert!(!dir.join("stories/01/agent-events.jsonl").exists() && !dir.join("server.log").exists());
        assert!(!store.join("node-a").exists(), "nothing of a reference run under the lake's node folders");
        // The same run seen on a second node: the same folder, the note now names the second node.
        let (_, api_b, _) = serve_fake(node_with_run_files(run)).await;
        let dir_b = dest_dir(&store, &reference, "node-b", run).unwrap();
        assert_eq!(dir, dir_b);
        collect_run(&api_b, "node-b", run, &dir_b, classes_for(run), &cadence_with_grace(0), 200).await.unwrap();
        let note = load_collection(&dir).unwrap();
        assert_eq!((note.run.as_str(), note.node.as_str(), note.first_collected_at), (run, "node-b", 100));
        std::fs::remove_dir_all(root).unwrap();
    }

    // ---- lake.collect.completeness ----

    async fn pass_once(api: &Api, run: &str, dir: &Path, grace: u64, now: u64) -> RunSummary {
        collect_run(api, "n", run, dir, classes_for(run), &cadence_with_grace(grace), now).await.unwrap()
    }

    const COMBINATION_RUN: &str = "combinations/a/benchmarks/p/r1";

    #[tokio::test]
    async fn a_run_with_no_note_becomes_collecting_and_the_first_time_is_set() {
        // TC-69
        let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let dir = scratch_dir("first-pass");
        let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 100).await;
        let note = load_collection(&dir).unwrap();
        assert_eq!((note.first_collected_at, note.collected_at, note.complete), (100, 100, false));
        assert!(s.changed && s.pulled_files == 6, "{s:?}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_running_run_is_never_complete_however_long_it_waits() {
        // TC-70
        let mut node = node_with_run_files(COMBINATION_RUN);
        node.state = Some("started");
        let (_, api, _) = serve_fake(node).await;
        let dir = scratch_dir("running");
        for now in [100, 200, 100_000] {
            pass_once(&api, COMBINATION_RUN, &dir, 0, now).await;
            let note = load_collection(&dir).unwrap();
            assert!(!note.complete && note.settled_at.is_none(), "now {now}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_settled_run_with_every_file_held_waits_out_the_grace_then_completes_and_a_later_look_changes_nothing() {
        // TC-71, TC-73, TC-74 and the boundary: grace elapsed by one second less, and exactly.
        let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let dir = scratch_dir("settle");
        pass_once(&api, COMBINATION_RUN, &dir, 60, 100).await;
        let note = load_collection(&dir).unwrap();
        assert_eq!((note.settled_at, note.complete), (None, false), "a pass that pulled files has not yet seen the run held");
        // Everything is held now: this pass sees it settled.
        pass_once(&api, COMBINATION_RUN, &dir, 60, 110).await;
        let note = load_collection(&dir).unwrap();
        assert_eq!((note.settled_at, note.complete), (Some(110), false));
        pass_once(&api, COMBINATION_RUN, &dir, 60, 169).await;
        assert!(!load_collection(&dir).unwrap().complete, "one second short of the grace");
        pass_once(&api, COMBINATION_RUN, &dir, 60, 170).await;
        assert!(load_collection(&dir).unwrap().complete, "exactly the grace");
        // A look within the hour changes nothing and pulls nothing; an hourly look finds nothing and keeps it complete.
        let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 200).await;
        assert!(s.complete && !s.changed && s.pulled_files == 0);
        let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 170 + 3600).await;
        assert!(s.complete && !s.changed && s.pulled_files == 0, "{s:?}");
        assert!(load_collection(&dir).unwrap().complete);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_grace_of_zero_completes_on_the_pass_that_sees_it_settled_twice_and_a_grace_of_one_second_needs_one_second() {
        let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let dir = scratch_dir("grace-boundary");
        pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
        pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
        assert!(load_collection(&dir).unwrap().settled_at.is_some());
        assert!(!load_collection(&dir).unwrap().complete, "the pass that first sees it settled only starts the grace");
        pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
        assert!(load_collection(&dir).unwrap().complete, "zero seconds elapsed, zero grace");
        std::fs::remove_dir_all(&dir).unwrap();
        let dir = scratch_dir("grace-one");
        pass_once(&api, COMBINATION_RUN, &dir, 1, 100).await;
        pass_once(&api, COMBINATION_RUN, &dir, 1, 100).await;
        pass_once(&api, COMBINATION_RUN, &dir, 1, 100).await;
        assert!(!load_collection(&dir).unwrap().complete, "zero seconds elapsed against a one second grace");
        pass_once(&api, COMBINATION_RUN, &dir, 1, 101).await;
        assert!(load_collection(&dir).unwrap().complete, "one second elapsed");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_file_that_changes_on_the_node_after_the_run_settled_clears_the_settling() {
        // TC-72
        let (_, api, node) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let dir = scratch_dir("changed-in-grace");
        pass_once(&api, COMBINATION_RUN, &dir, 60, 100).await;
        pass_once(&api, COMBINATION_RUN, &dir, 60, 110).await;
        assert_eq!(load_collection(&dir).unwrap().settled_at, Some(110));
        {
            let mut n = node.lock().unwrap();
            let f = n.files.get_mut("run.json").unwrap();
            f.data = b"{\"changed\":true}".to_vec();
            f.mtime += 5.0;
        }
        let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 120).await;
        let note = load_collection(&dir).unwrap();
        assert!(s.changed && note.settled_at.is_none() && !note.complete, "{note:?}");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn an_outstanding_partial_blocks_completeness() {
        // TC-76
        let manifest = Manifest {
            run: "r".into(),
            job: None,
            run_status: Some(RunStatus { state: "finished".into(), at: None }),
            job_state: None,
            files: vec![FileEntry { name: "workspace.bundle".into(), kind: FileKind::Blob, size: 100, mtime: 2.0 }],
            unlisted: 0,
        };
        let mut local = Collection::default();
        let mut rec = Collected { bytes: 100, node_size: 100, node_mtime: 2.0, at_eof: true, pulled_at: 1, refetches: 0, partial: None };
        local.files.insert("workspace.bundle".into(), rec.clone());
        assert!(all_at_eof(&manifest, &local));
        rec.partial = Some(Partial { bytes: 40, node_size: 100, node_mtime: 2.0 });
        local.files.insert("workspace.bundle".into(), rec);
        assert!(!all_at_eof(&manifest, &local), "a partial outstanding");
    }

    #[tokio::test]
    async fn an_old_node_with_no_runs_route_is_reported_with_its_code_and_an_unreachable_one_with_its() {
        // TC-79, TC-78 (the unit half)
        let (url, _, _) = serve_fake(FakeNode { runs_status: Some(404), ..Default::default() }).await;
        let ctx = Ctx { nodes: BTreeMap::from([("old".to_string(), NodeEntry { url, token: None })]), collect: Default::default(), json: false };
        let root = scratch_dir("old-node");
        let none = BTreeSet::new();
        let old = collect_node(&ctx, "old", Lake { store: &root, reference: &root }, &[], &none, &cadence_with_grace(0), 1).await;
        assert!(!old.reachable && old.problems.len() == 1 && old.problems[0].starts_with(E_NODE_OLD), "{:?}", old.problems);
        let ctx = Ctx { nodes: BTreeMap::from([("gone".to_string(), NodeEntry { url: "http://127.0.0.1:1".into(), token: None })]), collect: Default::default(), json: false };
        let gone = collect_node(&ctx, "gone", Lake { store: &root, reference: &root }, &[], &none, &cadence_with_grace(0), 1).await;
        assert!(!gone.reachable && gone.problems[0].starts_with(E_NODE_UNREACHABLE), "{:?}", gone.problems);
        assert!(std::fs::read_dir(&root).unwrap().next().is_none(), "the lake is left as it was");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_run_a_node_sends_that_is_not_a_run_path_is_reported_and_skipped() {
        // TC-82 (collect_node side), TC-61
        let root = Path::new("/lake");
        assert_eq!(dest_dir(root, root, "n", "a/b"), None);
        assert_eq!(dest_dir(root, root, "n", "benchmarks/reference/vidi/opus-5.5"), None);
    }

    #[test]
    fn collection_json_has_no_error_reason_or_problem_field_even_with_blobs_and_unlisted_files() {
        // TC-80
        let mut c = Collection { node: "n".into(), run: "r".into(), unlisted: 3, ..Default::default() };
        c.files.insert("workspace.bundle".into(), Collected { bytes: 3, node_size: 9, node_mtime: 1.5, at_eof: false, pulled_at: 2, refetches: 1, partial: Some(Partial { bytes: 3, node_size: 9, node_mtime: 1.5 }) });
        let text = serde_json::to_string_pretty(&c).unwrap();
        for word in ["error", "reason", "problem", "fault"] {
            assert!(!text.contains(word), "{word}: {text}");
        }
        assert_eq!(serde_json::from_str::<Collection>(&text).unwrap(), c);
    }

    // ---- lake.layout.run_id_kept ----

    fn golden_ids() -> Vec<String> {
        include_str!("../tests/fixtures/run-ids.txt").lines().filter(|l| !l.starts_with('#') && !l.is_empty()).map(String::from).collect()
    }

    #[test]
    fn every_run_id_that_exists_today_has_its_expected_folder() {
        // TC-81, TC-85 (an id with -opencode is left as it is)
        let ids = golden_ids();
        assert_eq!(ids.len(), 71);
        let (store, reference) = (Path::new("/lake"), Path::new("/ref"));
        let mut opencode = 0;
        for id in &ids {
            let dir = dest_dir(store, reference, "node-a", id).unwrap_or_else(|| panic!("{id}"));
            match id.strip_prefix(REFERENCE_RUN_PREFIX) {
                Some(rest) => assert_eq!(dir, reference.join(rest), "{id}"),
                None => {
                    assert_eq!(dir, store.join("node-a").join(id), "{id}");
                    assert_eq!(store_dir(store, "node-a", id), Some(dir.clone()), "{id}");
                }
            }
            if id.contains("-opencode") {
                opencode += 1;
                assert!(dir.to_str().unwrap().contains("-opencode"), "{id}");
            }
        }
        assert!(opencode >= 1, "the set holds an OpenCode id");
    }

    #[test]
    fn a_path_that_is_not_a_run_has_no_folder_and_nothing_is_written() {
        // TC-82, TC-83, TC-86
        let store = Path::new("/lake");
        for bad in ["a/b", "../x", "x", "", "combinations/a/benchmarks/p", "combinations/a/b/c/d", "combinations/a/benchmarks/p/r 1", "combinations/a/benchmarks/p/r1/", "/combinations/a/benchmarks/p/r1", "combinations/a/benchmarks/p/../r1"] {
            assert_eq!(store_dir(store, "node-a", bad), None, "{bad:?}");
            assert_eq!(dest_dir(store, store, "node-a", bad), None, "{bad:?}");
        }
        assert_eq!(store_dir(store, "a/b", "combinations/a/benchmarks/p/r1"), None);
        assert_eq!(store_dir(store, "", "combinations/a/benchmarks/p/r1"), None);
        assert_eq!(store_dir(store, "..", "combinations/a/benchmarks/p/r1"), None);
    }

    #[test]
    fn the_longest_id_today_and_the_longest_the_rules_allow_have_folders_and_one_character_more_does_not() {
        // TC-82 boundary
        let store = Path::new("/lake");
        let longest = golden_ids().into_iter().max_by_key(|i| i.len()).unwrap();
        assert!(store_dir(store, "n", &longest).is_some());
        // 512 characters: segments of valid-id size filling the limit exactly.
        let head = "combinations/".to_string();
        let tail = "/benchmarks/p/r1";
        let filler = 512 - head.len() - tail.len();
        let seg = "s".repeat(crate::ids::MAX_ID_LEN);
        let mut mid = String::new();
        while mid.len() + 1 + seg.len() <= filler {
            mid.push_str(&seg);
            mid.push('/');
        }
        let rest = filler.saturating_sub(mid.len());
        mid.push_str(&"t".repeat(rest));
        let id = format!("{head}{mid}{tail}");
        assert_eq!(id.len(), 512, "{}", id.len());
        assert!(store_dir(store, "n", &id).is_some());
        assert!(store_dir(store, "n", &format!("{id}x")).is_none());
    }

    #[tokio::test]
    async fn the_note_of_a_combination_run_holds_its_id_and_the_lake_folder_is_store_node_id() {
        // TC-84
        let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let root = scratch_dir("layout");
        let dir = store_dir(&root, "n", COMBINATION_RUN).unwrap();
        pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
        assert_eq!(load_collection(&dir).unwrap().run, COMBINATION_RUN);
        assert!(root.join("n").join(COMBINATION_RUN).join("collection.json").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    // ---- lake.collect.space_guard (the decision) ----

    const ONE_GIB: u64 = BYTES_PER_GIB;

    #[test]
    fn free_space_far_above_the_margin_or_just_above_it_or_exactly_at_it_pulls() {
        // TC-90, TC-91, TC-92
        let margin = crate::cli::DEFAULT_FREE_SPACE_MARGIN_GIB;
        assert_eq!(space_decision(Ok(100 * margin * ONE_GIB), margin), SpaceDecision::Pull);
        assert_eq!(space_decision(Ok(margin * ONE_GIB + 1), margin), SpaceDecision::Pull);
        assert_eq!(space_decision(Ok(margin * ONE_GIB), margin), SpaceDecision::Pull);
    }

    #[test]
    fn one_byte_below_the_margin_holds_with_one_line_that_names_the_free_space_and_the_margin() {
        // TC-93
        let margin = crate::cli::DEFAULT_FREE_SPACE_MARGIN_GIB;
        let free = margin * ONE_GIB - 1;
        match space_decision(Ok(free), margin) {
            SpaceDecision::Hold(line) => {
                assert!(line.contains(&free.to_string()) && line.contains(&(margin * ONE_GIB).to_string()), "{line}");
                assert!(!line.contains('\n'), "one line");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn free_space_that_cannot_be_read_holds_and_says_so_without_a_guessed_value() {
        // TC-94
        match space_decision(Err(std::io::Error::other("no such device")), 10) {
            SpaceDecision::Hold(line) => assert!(line.contains("could not read") && line.contains("no such device") && !line.contains("bytes free"), "{line}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_margin_is_a_setting_with_a_proposed_default_of_ten_gib() {
        // TC-98
        assert_eq!(space_decision(Ok(5 * ONE_GIB), 4), SpaceDecision::Pull);
        assert!(matches!(space_decision(Ok(5 * ONE_GIB), 6), SpaceDecision::Hold(_)));
        assert_eq!(crate::cli::DEFAULT_FREE_SPACE_MARGIN_GIB, 10);
        assert_eq!(collect_args(&[]).free_space_margin_gib, 10);
        assert_eq!(collect_args(&["--free-space-margin-gib", "3"]).free_space_margin_gib, 3);
        assert_eq!(Config::default().free_space_margin_gib, 10);
    }

    #[test]
    fn the_free_bytes_of_a_real_folder_are_read_and_of_a_missing_one_are_an_error() {
        let dir = scratch_dir("free");
        assert!(free_bytes(&dir).unwrap() > 0);
        assert!(free_bytes(&dir.join("not-there")).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[tokio::test]
    async fn a_pass_that_holds_for_space_contacts_no_node_and_creates_no_file() {
        // TC-93 (the pass half)
        let (url, _, node) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let root = scratch_dir("hold");
        let ctx = Ctx { nodes: BTreeMap::from([("n".to_string(), NodeEntry { url, token: None })]), collect: Default::default(), json: false };
        let cfg = Config { store: root.join("lake"), reference: root.join("reference"), no_ingest: true, free_bytes: |_| Ok(0), ..Default::default() };
        let summaries = pass(&ctx, &cfg, &cadence_with_grace(0), false, 100).await.unwrap();
        assert!(summaries.is_empty());
        assert!(node.lock().unwrap().requests.is_empty());
        assert_eq!(std::fs::read_dir(root.join("lake")).unwrap().count(), 0, "nothing in the lake");
        // With the space back, the same pass pulls.
        let cfg = Config { free_bytes: |_| Ok(u64::MAX), ..cfg };
        let summaries = pass(&ctx, &cfg, &cadence_with_grace(0), false, 101).await.unwrap();
        assert_eq!(summaries[0].runs.len(), 1);
        assert!(root.join("lake/n").join(COMBINATION_RUN).join("collection.json").is_file());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn the_collection_notes_and_the_lake_are_created_readable_by_the_owner_alone() {
        // TC-55 (the collector's half; the integration test checks a whole pass)
        use std::os::unix::fs::PermissionsExt;
        let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
        let root = scratch_dir("modes");
        let dir = root.join("lake/n").join(COMBINATION_RUN);
        pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
        let mut seen = 0;
        let mut stack = vec![root.join("lake")];
        while let Some(d) = stack.pop() {
            assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700, "{}", d.display());
            for e in std::fs::read_dir(&d).unwrap() {
                let p = e.unwrap().path();
                if p.is_dir() {
                    stack.push(p);
                } else {
                    assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600, "{}", p.display());
                    seen += 1;
                }
            }
        }
        assert!(seen >= 6);
        std::fs::remove_dir_all(root).unwrap();
    }
}
