//! `dbench collect`: the host's loop. Each pass lists every node's runs, pulls the bytes of their
//! collectable files it doesn't hold yet into the lake (`<store>/<node>/<run path>/`), records what
//! it holds in collection.json beside them, and ingests the stories whose inputs changed. The
//! local file's length is the cursor: a crash between an append and the record is healed on the
//! next pass by the node's prefix check.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::cli::CollectArgs;
use crate::client::{Api, Chunk, Ctx, RunRef};
use crate::collect::{check_window, fnv1a64, FileEntry, FileKind, Manifest, RunStatus};
use crate::ids::valid_run_dir;
use crate::timefmt::now_secs;

pub const COLLECTION_FILE: &str = "collection.json";
/// A file is fetched again from 0 at most this many times in one pass (a node rewriting it under us).
pub const MAX_REFETCHES_PER_PASS: u32 = 2;
/// Run states (run-status.json) after which nothing more is written.
const SETTLED_STATES: [&str; 3] = ["finished", "failed", "stopped"];
/// Job states after which the harness is gone.
const TERMINAL_JOB_STATES: [&str; 3] = ["done", "failed", "cancelled"];
const NO_API: &str = "none";

#[derive(Debug, Clone)]
pub struct Cadence {
    pub running_poll: Duration,
    pub finished_recheck: Duration,
    pub settle_grace: Duration,
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
    pub dbench_version: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Skip,
    Append { from: u64 },
    Refetch,
    Whole,
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
    m.files.iter().all(|f| local.files.get(&f.name).is_some_and(|r| r.at_eof && r.node_size == f.size && r.node_mtime == f.mtime))
}

/// Whether a run is looked at this pass: always, unless its collection is complete and was checked recently.
pub fn due(c: Option<&Collection>, now: u64, cadence: &Cadence) -> bool {
    match c {
        Some(c) if c.complete => now.saturating_sub(c.collected_at) >= cadence.finished_recheck.as_secs(),
        _ => true,
    }
}

/// `<store>/<node>/<run path>`; None for a run path the node should not have sent.
pub fn store_dir(store: &Path, node: &str, run: &str) -> Option<PathBuf> {
    if !valid_run_dir(run) || !crate::ids::valid_id(node) {
        return None;
    }
    Some(store.join(node).join(run))
}

pub fn load_collection(dir: &Path) -> Option<Collection> {
    let bytes = std::fs::read(dir.join(COLLECTION_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn save_collection(dir: &Path, c: &Collection) -> Result<()> {
    std::fs::create_dir_all(dir)?;
    crate::store::write_atomic(&dir.join(COLLECTION_FILE), &serde_json::to_vec_pretty(c)?)
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
        std::fs::create_dir_all(dir)?;
    }
    let mut refetches = 0;
    let mut from = match action {
        Action::Append { from } => from,
        Action::Refetch | Action::Whole => 0,
        Action::Skip => local_len(dest),
    };
    if matches!(action, Action::Refetch) {
        refetches += 1;
    }
    if matches!(action, Action::Whole) {
        let chunk = api.file_chunk(run, &entry.name, 0, None).await?;
        let Some(meta) = chunk.meta.filter(|_| chunk.status.is_success()) else {
            anyhow::bail!("{}: {} {}", entry.name, chunk.status, chunk.error.unwrap_or_default());
        };
        crate::store::write_atomic(dest, &chunk.bytes)?;
        return Ok(Pulled { bytes: chunk.bytes.len() as u64, pulled: chunk.bytes.len() as u64, at_eof: meta.eof, refetches, meta });
    }
    let mut pulled = 0;
    let meta = loop {
        let check = if from > 0 { Some(tail_hash(dest, from)?) } else { None };
        let Chunk { status, meta, bytes, error } = api.file_chunk(run, &entry.name, from, check.as_deref()).await?;
        if status == reqwest::StatusCode::CONFLICT {
            refetches += 1;
            if refetches > MAX_REFETCHES_PER_PASS {
                anyhow::bail!("{}: the node's file keeps changing under the read", entry.name);
            }
            std::fs::write(dest, b"")?;
            from = 0;
            continue;
        }
        let Some(meta) = meta.filter(|_| status.is_success()) else {
            anyhow::bail!("{}: {} {}", entry.name, status, error.unwrap_or_default());
        };
        if from == 0 && local_len(dest) > 0 {
            std::fs::write(dest, b"")?;
        }
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(dest)?;
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

/// What one pass did for one run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct RunSummary {
    pub run: String,
    pub pulled_files: usize,
    pub pulled_bytes: u64,
    pub complete: bool,
    pub changed: bool,
}

/// Collect one run of one node into the lake; the record it leaves says what it holds.
pub async fn collect_run(api: &Api, node: &str, run: &str, store: &Path, cadence: &Cadence, now: u64) -> Result<RunSummary> {
    let dir = store_dir(store, node, run).with_context(|| format!("{node}: not a run path: {run:?}"))?;
    let mut local = load_collection(&dir).unwrap_or_else(|| Collection {
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
    let manifest = api.files(&run_ref).await?;
    let was_complete = local.complete;
    for (entry, action) in plan(&manifest, &local, |name| local_len(&dir.join(name))) {
        if action == Action::Skip {
            if let Some(r) = local.files.get_mut(&entry.name) {
                r.node_size = entry.size;
                r.node_mtime = entry.mtime;
                r.at_eof = r.bytes >= entry.size;
            }
            continue;
        }
        let pulled = pull_file(api, &run_ref, &entry, action, &dir.join(&entry.name)).await?;
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
        };
    }
    local.job = manifest.job.clone();
    local.run_status = manifest.run_status.clone();
    local.job_state = manifest.job_state.clone();
    local.collected_at = now;
    local.dbench_version = crate::VERSION.to_string();
    if settled(&manifest) && all_at_eof(&manifest, &local) {
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
    save_collection(&dir, &local)?;
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
/// ones asked for.
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

pub async fn collect_node(ctx: &Ctx, node: &str, store: &Path, only_runs: &[String], archived: &BTreeSet<String>, cadence: &Cadence, now: u64) -> NodeSummary {
    let mut out = NodeSummary { node: node.to_string(), ..Default::default() };
    let api = match ctx.api(node) {
        Ok(a) => a,
        Err(e) => {
            out.problems.push(format!("{e:#}"));
            return out;
        }
    };
    let runs = match api.runs().await {
        Ok(r) => r,
        Err(e) => {
            out.problems.push(if e.to_string().contains("404") { "needs the new dbench (no /v1/runs)".into() } else { format!("unreachable: {e:#}") });
            return out;
        }
    };
    out.reachable = true;
    for r in runs {
        if !wanted(&r.run, only_runs, archived) {
            continue;
        }
        match collect_run(&api, node, &r.run, store, cadence, now).await {
            Ok(s) => out.runs.push(s),
            Err(e) => out.problems.push(format!("{}: {e:#}", r.run)),
        }
    }
    out
}

/// One pass over the nodes, then the ingest of what changed.
pub async fn pass(ctx: &Ctx, cfg: &Config, cadence: &Cadence, fetch: bool, now: u64) -> Result<Vec<NodeSummary>> {
    let names: Vec<String> = if cfg.nodes.is_empty() { ctx.nodes.keys().cloned().collect() } else { cfg.nodes.clone() };
    let archived = archived_runs(cfg);
    let futs = names.iter().map(|n| collect_node(ctx, n, &cfg.store, &cfg.runs, &archived, cadence, now));
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
            if summary.ingested > 0 || summary.requests > 0 {
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

/// The resolved settings of a collect command.
#[derive(Debug, Clone)]
pub struct Config {
    pub store: PathBuf,
    pub db: PathBuf,
    pub repo: Option<PathBuf>,
    pub worktree: bool,
    pub api: Option<String>,
    pub nodes: Vec<String>,
    pub runs: Vec<String>,
    pub no_ingest: bool,
}

pub fn resolve(ctx: &Ctx, args: &CollectArgs) -> Result<Config> {
    let store = args.store.clone().or_else(|| ctx.collect.store.clone()).context("--store, or [collect] store in nodes.toml: where the lake is")?;
    let db = args.db.clone().or_else(|| ctx.collect.db.clone()).context("--db, or [collect] db in nodes.toml: the conversation database")?;
    let repo = args.repo.clone().or_else(|| ctx.collect.repo.clone());
    anyhow::ensure!(repo.is_some() || args.no_ingest, "--repo, or [collect] repo in nodes.toml: the repository whose origin/main holds the records (or --no-ingest)");
    let api = args.api.clone().or_else(|| ctx.collect.api.clone()).unwrap_or_else(|| crate::cli::DEFAULT_API_BIND.to_string());
    Ok(Config {
        store,
        db,
        repo,
        worktree: args.worktree,
        api: (api != NO_API).then_some(api),
        nodes: args.nodes.clone(),
        runs: args.runs.clone(),
        no_ingest: args.no_ingest,
    })
}

pub async fn cmd_collect(ctx: &Ctx, args: &CollectArgs) -> Result<()> {
    let cfg = resolve(ctx, args)?;
    let cadence = Cadence {
        running_poll: Duration::from_millis(args.running_poll_ms),
        finished_recheck: Duration::from_millis(args.finished_recheck_ms),
        settle_grace: Duration::from_millis(args.settle_grace_ms),
    };
    std::fs::create_dir_all(&cfg.store)?;
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
        local.files.insert("progress.json".into(), Collected { bytes: 10, node_size: 10, node_mtime: 3.0, at_eof: true, pulled_at: 1, refetches: 0 });
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
        local.files.insert("server.log".into(), Collected { bytes: 100, node_size: 100, node_mtime: 1.0, at_eof: true, pulled_at: 1, refetches: 0 });
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

    #[test]
    fn collection_json_round_trips_and_has_no_error_field() {
        let mut c = Collection { node: "n".into(), run: "r".into(), complete: true, first_collected_at: 1, collected_at: 2, settled_at: Some(2), dbench_version: "v".into(), ..Default::default() };
        c.files.insert("server.log".into(), Collected { bytes: 3, node_size: 3, node_mtime: 1.5, at_eof: true, pulled_at: 2, refetches: 1 });
        let text = serde_json::to_string_pretty(&c).unwrap();
        assert!(!text.contains("error") && !text.contains("reason") && !text.contains("problem"), "{text}");
        assert_eq!(serde_json::from_str::<Collection>(&text).unwrap(), c);
    }
}
