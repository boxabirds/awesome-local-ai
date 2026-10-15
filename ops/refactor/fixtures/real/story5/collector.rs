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
    todo!()
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
    todo!()
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
    todo!()
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
    todo!()
}

/// What one pass did for one node.
#[derive(Debug, Clone, Default, Serialize)]
pub struct NodeSummary {
    pub node: String,
    pub reachable: bool,
    pub runs: Vec<RunSummary>,
    pub problems: Vec<String>,
}

/// Whether a pass pulls this run: never a reference model's (the warehouse holds none of their conversations, and
/// neither should the lake) and never an archived one, even when asked for by name; otherwise every run, or only the
/// ones asked for.
pub fn wanted(run: &str, only_runs: &[String], archived: &BTreeSet<String>) -> bool {
    todo!()
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
    fn a_reference_models_run_is_never_pulled_so_the_lake_holds_no_claude_transcript() {
        // The warehouse holds none of them (ingest), and since 4 Oct 2026 neither does the lake: the raw pulls were
        // Claude's conversations sitting on disk under state/collected (owner, 3 Oct: not in our data).
        let none = std::collections::BTreeSet::new();
        assert!(!wanted("benchmarks/reference/vidi/opus-5.5/v2-r1", &[], &none));
        assert!(!wanted("benchmarks/reference/vidi/sonnet-5.5/v2-r4", &[], &none));
        // named explicitly: still not pulled
        assert!(!wanted("benchmarks/reference/vidi/opus-5.5/v2-r1", &["benchmarks/reference/vidi/opus-5.5/v2-r1".to_string()], &none));
        assert!(wanted("combinations/a/benchmarks/vidi/v2-r1", &[], &none));
    }

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

    fn config(repo: Option<PathBuf>, worktree: bool) -> Config {
        Config { store: PathBuf::from("/lake"), db: PathBuf::from("/db"), repo, worktree, api: None, nodes: vec![], runs: vec![], no_ingest: false }
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
        let file = crate::client::CollectEntry { store: Some("/f/lake".into()), db: Some("/f/db".into()), repo: Some("/f/repo".into()), api: Some("127.0.0.1:9".into()) };
        let c = resolve(&ctx_with(file.clone()), &collect_args(&[])).unwrap();
        assert_eq!((c.store, c.db, c.repo, c.api), ("/f/lake".into(), "/f/db".into(), Some("/f/repo".into()), Some("127.0.0.1:9".to_string())));
        // The command line wins over the file, and "none" turns the API off.
        let c = resolve(&ctx_with(file), &collect_args(&["--store", "/c/lake", "--db", "/c/db", "--repo", "/c/repo", "--api", "none", "--node", "n1", "--run", "r1", "--worktree"])).unwrap();
        assert_eq!((c.store, c.db, c.repo, c.api, c.nodes, c.runs, c.worktree, c.no_ingest), ("/c/lake".into(), "/c/db".into(), Some("/c/repo".into()), None, vec!["n1".to_string()], vec!["r1".to_string()], true, false));
        // The API defaults to the built-in address.
        let only_paths = crate::client::CollectEntry { store: Some("/f/lake".into()), db: Some("/f/db".into()), repo: Some("/f/repo".into()), api: None };
        assert_eq!(resolve(&ctx_with(only_paths), &collect_args(&[])).unwrap().api.as_deref(), Some(crate::cli::DEFAULT_API_BIND));
        // Without a repository there is nothing to ingest from, unless ingest is off.
        let no_repo = crate::client::CollectEntry { store: Some("/f/lake".into()), db: Some("/f/db".into()), repo: None, api: None };
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
        c.files.insert("server.log".into(), Collected { bytes: 3, node_size: 3, node_mtime: 1.5, at_eof: true, pulled_at: 2, refetches: 1 });
        let text = serde_json::to_string_pretty(&c).unwrap();
        assert!(!text.contains("error") && !text.contains("reason") && !text.contains("problem"), "{text}");
        assert_eq!(serde_json::from_str::<Collection>(&text).unwrap(), c);
    }
}
