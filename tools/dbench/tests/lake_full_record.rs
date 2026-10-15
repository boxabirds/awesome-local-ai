//! Story 5, integration and end-to-end: the real `dbench serve` node server and the real collector, over HTTP and a real
//! file system. A finished run is built from the file names the harness writes (tests/fixtures/run-file-names.txt), with
//! generated content of the same shapes and sizes: the held-out files of a real run never enter this repository.

use dbench::client::{Api, Ctx, NodeEntry, RunRef};
use dbench::collect::{self, FileEntry, COLLECT_CHUNK_BYTES};
use dbench::collector::{self, Cadence, Collected, Collection, Config, Partial};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, Instant};

const COMBINATION: &str = "test/combo/fake";
const PACK: &str = "vidipack";
const RUN: &str = "combinations/test/combo/fake/benchmarks/vidipack/v2-r1";
const REFERENCE_INSTALL: &str = "ref-install";
const REFERENCE_BASE: &str = "benchmarks/reference/vidi/opus-5.5";
const REFERENCE_RUN: &str = "benchmarks/reference/vidi/opus-5.5/v2-r1";
const NODE_NAME: &str = "node-t";
const STORIES: [&str; 3] = ["01", "02", "03"];
const MIB: usize = 1024 * 1024;
const CHUNK: usize = COLLECT_CHUNK_BYTES as usize;
const SHOTS_PER_STORY: usize = 100;
const DEADLINE: Duration = Duration::from_secs(30);
const SERVER_STOP_DEADLINE: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(50);

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Env {
    root: PathBuf,
    repo: PathBuf,
    home: PathBuf,
    user_home: PathBuf,
}

impl Drop for Env {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn setup() -> Env {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-lake-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let repo = root.join("repo");
    let combo = repo.join("combinations").join(COMBINATION);
    std::fs::create_dir_all(&combo).unwrap();
    std::fs::write(combo.join("config.sh"), "INSTALL_ID=\"fake-install\"\n").unwrap();
    let user_home = root.join("userhome");
    let install = user_home.join(".local/share").join(REFERENCE_INSTALL);
    std::fs::create_dir_all(&install).unwrap();
    std::fs::write(install.join("install.env"), format!("INSTALL_ID=\"{REFERENCE_INSTALL}\"\nRUN_BASE=\"{REFERENCE_BASE}\"\n")).unwrap();
    Env { home: root.join("dbench-home"), repo, user_home, root }
}

struct Server {
    child: Child,
    _stdout: BufReader<ChildStdout>,
    base: String,
    token: String,
    http: reqwest::Client,
}

impl Drop for Server {
    fn drop(&mut self) {
        // SAFETY: kill(2) on our own child's pid.
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) };
        let start = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && start.elapsed() < SERVER_STOP_DEADLINE {
            std::thread::sleep(POLL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start(env: &Env) -> Server {
    let mut child = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(["serve", "--bind", "127.0.0.1:0", "--allow-unreleased", "--no-pull"])
        .arg("--repo")
        .arg(&env.repo)
        .arg("--home")
        .arg(&env.home)
        .arg("--share-dir")
        .arg(env.user_home.join(".local/share"))
        .env("HOME", &env.user_home)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn dbench");
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    let addr = line.trim().strip_prefix(dbench::server::LISTENING_PREFIX).unwrap_or_else(|| panic!("{line:?}")).to_string();
    let token = std::fs::read_to_string(env.home.join("token")).unwrap().trim().to_string();
    Server { child, _stdout: stdout, base: format!("http://{addr}"), token, http: reqwest::Client::new() }
}

impl Server {
    fn entry(&self) -> NodeEntry {
        NodeEntry { url: self.base.clone(), token: Some(self.token.clone()) }
    }

    fn api(&self) -> Api {
        Api::new(&self.entry()).unwrap()
    }

    /// A GET: status, the x-dbench-* headers without their prefix, body.
    async fn get_raw(&self, path: &str) -> (u16, BTreeMap<String, String>, Vec<u8>) {
        let r = self.http.get(format!("{}{path}", self.base)).bearer_auth(&self.token).send().await.unwrap();
        let status = r.status().as_u16();
        let headers = r.headers().iter().filter_map(|(k, v)| Some((k.as_str().strip_prefix("x-dbench-")?.to_string(), v.to_str().unwrap().to_string()))).collect();
        (status, headers, r.bytes().await.unwrap().to_vec())
    }

    async fn get_json(&self, path: &str) -> Value {
        let (status, _, body) = self.get_raw(path).await;
        assert_eq!(status, 200, "{path}: {}", String::from_utf8_lossy(&body));
        serde_json::from_slice(&body).unwrap()
    }

    /// One file of one run: `name` percent-encoded as the client does.
    fn file_url(run: &str, name: &str, extra: &str) -> String {
        format!("/v1/runs/file?run={}&name={}{extra}", dbench::client::urlencode(run), dbench::client::urlencode(name))
    }
}

/// The error text a refused request carries (the node answers {"error": "..."}).
fn error_of(body: &[u8]) -> String {
    serde_json::from_slice::<Value>(body).ok().and_then(|v| v["error"].as_str().map(String::from)).unwrap_or_else(|| String::from_utf8_lossy(body).into_owned())
}

/// Bytes that differ from place to place, so a wrong offset shows.
fn pattern(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed).wrapping_add((i >> 8) as u8).wrapping_add((i >> 16) as u8)).collect()
}

fn write(dir: &Path, name: &str, body: &[u8]) {
    let p = dir.join(name);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

/// How big the large members of a finished run are.
struct Sizes {
    bundle: usize,
    compact: usize,
}

const SMALL: Sizes = Sizes { bundle: 300 * 1024, compact: 120 * 1024 };

/// Every file name a finished run has on the fixed list of the design, the held-out files among them, with generated
/// content. Returns the names a collector must hold afterwards (record and raw class).
fn make_finished_run(dir: &Path, sizes: &Sizes) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut put = |dir: &Path, name: &str, body: Vec<u8>| {
        write(dir, name, &body);
        names.push(name.to_string());
    };
    put(dir, "run.json", br#"{"install_id": "fake-install"}"#.to_vec());
    put(dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T00:00:00Z"}"#.to_vec());
    put(dir, "metrics.json", br#"{"stories": {"1": {"title": "One"}}}"#.to_vec());
    put(dir, "finalize.json", pattern(2_000, 1));
    put(dir, "summary.md", pattern(1_500, 2));
    put(dir, "summary-detail.md", pattern(1_800, 3));
    put(dir, "server-health.json", pattern(300, 4));
    put(dir, "run-history.jsonl", pattern(900, 5));
    put(dir, "interventions.md", pattern(100, 6));
    put(dir, "flow-counts.json", pattern(200, 7));
    put(dir, "workspace-git-log.txt", pattern(5_000, 8));
    put(dir, "workspace.bundle", pattern(sizes.bundle, 9));
    put(dir, "heldout-detail.json", pattern(30_000, 10));
    put(dir, "AUDIT.md", pattern(4_000, 11));
    put(dir, "audit.jsonl", pattern(6_000, 12));
    put(dir, "publish-refused.json", pattern(150, 13));
    put(dir, "server.log", pattern(2_500, 14));
    put(dir, "rescore/vidi-v2.0-pre2/rescore.json", pattern(700, 15));
    put(dir, "rescore/vidi-v2.0-pre2/per-story.md", pattern(500, 16));
    put(dir, "rescore/vidi-v2.0-pre2/metrics.json", pattern(400, 17));
    put(dir, "rescore/vidi-v2.0-pre2/stories/01/accept-summary.json", pattern(250, 18));
    put(dir, "superseded/old-run/stories/01/accept.json", pattern(300, 19));
    put(dir, "base/accept-summary.json", pattern(120, 20));
    for (i, story) in STORIES.iter().enumerate() {
        let seed = 40 + i as u8;
        let s = |f: &str| format!("stories/{story}/{f}");
        put(dir, &s("prompt.md"), pattern(3_000, seed));
        put(dir, &s("base-commit"), b"0123456789abcdef0123456789abcdef01234567\n".to_vec());
        put(dir, &s("gate.json"), pattern(350, seed + 1));
        put(dir, &s("accept-summary.json"), pattern(280, seed + 2));
        put(dir, &s("accept.json"), pattern(9_000, seed + 3));
        put(dir, &s("accept-report.json"), pattern(40_000, seed + 4));
        put(dir, &s("accept-final.json"), pattern(8_000, seed + 5));
        put(dir, &s("accept-final-summary.json"), pattern(260, seed + 6));
        put(dir, &s("agent-events.compact.jsonl.gz"), pattern(sizes.compact, seed + 7));
        put(dir, &s("agent-events.jsonl"), pattern(20_000, seed + 8));
        put(dir, &s("conditions.jsonl"), pattern(3_000, seed + 9));
        put(dir, &s("artifacts/app-start.log"), pattern(900, seed + 10));
        put(dir, &s("artifacts/.last-run.json"), pattern(90, seed + 11));
        put(dir, &s("artifacts/test-one-chromium/test-failed-1.png"), pattern(15_000, seed + 12));
        put(dir, &s("pre-suite-fix/fix.json"), pattern(160, seed + 13));
        put(dir, &s("scoring-2/accept.json"), pattern(700, seed + 14));
        put(dir, &s("scoring-2/artifacts/shot.png"), pattern(3_000, seed + 15));
        for n in 0..SHOTS_PER_STORY / STORIES.len() + 1 {
            put(dir, &s(&format!("screenshots/shot-{n:03}.png")), pattern(600, seed.wrapping_add(n as u8)));
        }
    }
    names
}

/// What a run directory holds that the collector must leave alone.
fn add_left_out(dir: &Path) -> Vec<&'static str> {
    write(dir, "workspace/src/app.ts", b"export const x = 1;\n");
    write(dir, "workspace/node_modules/dep/index.js", b"module.exports = 1;\n");
    write(dir, "control/skip-story.json", b"{}");
    write(dir, "current_story", b"3\n");
    write(dir, "work_dir.txt", b"/home/x/.w/abc123/workspace\n");
    write(dir, ".gitignore", b"workspace/\n");
    write(dir, ".run-status.json.4242.tmp", b"half");
    write(dir, "stories/01/artifacts/.shot.png.partial", b"half");
    vec!["workspace/src/app.ts", "workspace/node_modules/dep/index.js", "control/skip-story.json", "current_story", "work_dir.txt", ".gitignore", ".run-status.json.4242.tmp", "stories/01/artifacts/.shot.png.partial"]
}

fn run_dir(env: &Env) -> PathBuf {
    env.repo.join(RUN)
}

fn reference_dir(env: &Env) -> PathBuf {
    env.repo.join(REFERENCE_RUN)
}

fn cadence(grace_ms: u64) -> Cadence {
    Cadence { running_poll: Duration::from_millis(1), finished_recheck: Duration::from_secs(3600), settle_grace: Duration::from_millis(grace_ms) }
}

fn ctx_of(servers: &[(&str, &Server)]) -> Ctx {
    Ctx { nodes: servers.iter().map(|(n, s)| (n.to_string(), s.entry())).collect(), collect: Default::default(), json: false }
}

fn lake(env: &Env) -> PathBuf {
    env.root.join("lake")
}

fn config(env: &Env) -> Config {
    Config { store: lake(env), reference: env.root.join("reference"), db: env.root.join("insights/conversations.db"), no_ingest: true, free_bytes: |_| Ok(u64::MAX), ..Default::default() }
}

/// One collector pass at `now`; the settle grace is zero so completeness needs only the passes themselves.
async fn pass(env: &Env, srv: &Server, now: u64) -> Vec<collector::NodeSummary> {
    collector::pass(&ctx_of(&[(NODE_NAME, srv)]), &config(env), &cadence(0), false, now).await.unwrap()
}

fn lake_run(env: &Env) -> PathBuf {
    lake(env).join(NODE_NAME).join(RUN)
}

fn note(dir: &Path) -> Collection {
    collector::load_collection(dir).unwrap_or_else(|| panic!("no collection.json in {}", dir.display()))
}

/// Every regular file below `dir`: its name relative to `dir` and its bytes.
fn files_below(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    let mut stack = vec![dir.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
            let p = e.path();
            if e.file_type().unwrap().is_dir() {
                stack.push(p);
            } else if e.file_type().unwrap().is_file() {
                out.insert(p.strip_prefix(dir).unwrap().to_string_lossy().into_owned(), std::fs::read(&p).unwrap());
            }
        }
    }
    out
}

fn names_below(dir: &Path) -> BTreeSet<String> {
    files_below(dir).into_keys().filter(|n| n != "collection.json").collect()
}

fn set_mtime(path: &Path, secs_after_now: u64) {
    let f = std::fs::OpenOptions::new().write(true).open(path).unwrap();
    f.set_modified(std::time::SystemTime::now() + Duration::from_secs(secs_after_now)).unwrap();
}

async fn wait_until(what: &str, f: impl Fn() -> bool) {
    let start = Instant::now();
    while !f() {
        assert!(start.elapsed() < DEADLINE, "timed out waiting for {what}");
        tokio::time::sleep(POLL).await;
    }
}

fn entry_for(dir: &Path, name: &str, kind: collect::FileKind) -> FileEntry {
    let m = std::fs::metadata(dir.join(name)).unwrap();
    FileEntry { name: name.into(), kind, size: m.len(), mtime: collect::mtime_secs(&m) }
}

fn no_progress() -> impl FnMut(&Partial) -> anyhow::Result<()> {
    |_| Ok(())
}

// ---- lake.allowlist.full_record: the manifest of a real finished run (TC-12 to TC-14) ----

#[tokio::test(flavor = "multi_thread")]
async fn the_manifest_of_a_real_run_lists_the_full_record() {
    // TC-12
    let env = setup();
    let record = make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let m = srv.get_json(&format!("/v1/runs/files?run={RUN}")).await;
    let listed: BTreeSet<String> = m["files"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap().to_string()).collect();
    for want in &record {
        assert!(listed.contains(want), "{want} is not offered; the manifest has {} names", listed.len());
    }
    for want in [
        "finalize.json", "summary.md", "server-health.json", "workspace.bundle", "workspace-git-log.txt", "run-history.jsonl",
        "rescore/vidi-v2.0-pre2/rescore.json", "stories/01/prompt.md", "stories/01/accept.json", "stories/01/accept-summary.json",
        "stories/01/accept-report.json", "stories/01/accept-final.json", "stories/01/agent-events.compact.jsonl.gz",
        "stories/01/artifacts/app-start.log", "stories/01/screenshots/shot-000.png", "AUDIT.md", "audit.jsonl", "heldout-detail.json", "summary-detail.md",
    ] {
        assert!(listed.contains(want), "{want}");
    }
    // Size and mtime from the file system, and the same list as the function the server calls.
    let by_function = collect::manifest(&run_dir(&env), &env.user_home.join(".vidi-bench"));
    assert_eq!(by_function.len(), listed.len());
    for f in m["files"].as_array().unwrap() {
        let name = f["name"].as_str().unwrap();
        assert_eq!(f["size"].as_u64().unwrap(), std::fs::metadata(run_dir(&env).join(name)).unwrap().len(), "{name}");
        assert!(f["mtime"].as_f64().unwrap() > 0.0);
    }
    // Kinds: the large ones are blobs.
    let kind = |n: &str| m["files"].as_array().unwrap().iter().find(|f| f["name"] == n).unwrap()["kind"].as_str().unwrap().to_string();
    assert_eq!((kind("workspace.bundle"), kind("run.json"), kind("server.log")), ("blob".into(), "whole".into(), "append".into()));
}

#[tokio::test(flavor = "multi_thread")]
async fn the_manifest_leaves_out_the_working_tree_the_control_files_and_every_temporary() {
    // TC-13
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let left_out = add_left_out(&run_dir(&env));
    let srv = start(&env);
    let m = srv.get_json(&format!("/v1/runs/files?run={RUN}")).await;
    let listed: BTreeSet<&str> = m["files"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap()).collect();
    for name in left_out {
        assert!(!listed.contains(name), "{name} must not be listed");
    }
    assert!(!listed.iter().any(|n| n.starts_with("workspace/") || n.starts_with("control/") || n.contains(".tmp") || n.ends_with(".partial")));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_name_outside_the_alphabet_is_counted_not_listed_and_does_not_delay_completeness_and_a_hundred_screenshots_all_list() {
    // TC-14
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    write(&run_dir(&env), "stories/01/artifacts/has space.png", b"x");
    let srv = start(&env);
    let m = srv.get_json(&format!("/v1/runs/files?run={RUN}")).await;
    assert_eq!(m["unlisted"], 1, "{}", m["unlisted"]);
    let listed: Vec<&str> = m["files"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap()).collect();
    assert!(!listed.iter().any(|n| n.contains("has space")));
    let shots = listed.iter().filter(|n| n.starts_with("stories/01/screenshots/")).count();
    assert_eq!(shots, SHOTS_PER_STORY / STORIES.len() + 1);
    let all_shots = listed.iter().filter(|n| n.contains("/screenshots/")).count();
    assert!(all_shots >= SHOTS_PER_STORY, "{all_shots}");
    // Completeness is not delayed by it.
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    let n = note(&lake_run(&env));
    assert!(n.complete, "{n:?}");
    assert_eq!(n.unlisted, 1);
    assert!(!lake_run(&env).join("stories/01/artifacts/has space.png").exists());
}

// ---- lake.transfer.blob_files over the real server (TC-15 to TC-21, TC-23, TC-26) ----

/// A node directory with one blob in it, to pull by hand.
fn one_blob_env(name: &str, data: &[u8]) -> (Env, PathBuf) {
    let env = setup();
    let dir = run_dir(&env);
    write(&dir, "run.json", b"{}");
    write(&dir, name, data);
    (env, dir)
}

#[tokio::test(flavor = "multi_thread")]
async fn a_blob_of_a_hundred_kilobytes_arrives_in_one_request_byte_for_byte() {
    // TC-15
    let data = pattern(100 * 1024, 21);
    let (env, _) = one_blob_env("heldout-detail.json", &data);
    let srv = start(&env);
    let (status, h, body) = srv.get_raw(&Server::file_url(RUN, "heldout-detail.json", "&from=0")).await;
    assert_eq!((status, h["eof"].as_str(), h["size"].as_str()), (200, "1", data.len().to_string().as_str()));
    assert_eq!(body, data);
    // And through the collector.
    let dest = env.root.join("out/heldout-detail.json");
    let entry = entry_for(&run_dir(&env), "heldout-detail.json", collect::FileKind::Blob);
    let pulled = collector::pull_blob(&srv.api(), &RunRef::Path(RUN.into()), &entry, &dest, None, &mut no_progress()).await.unwrap();
    assert_eq!(pulled.pulled, data.len() as u64);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_ten_megabyte_bundle_arrives_in_three_requests_and_leaves_no_partial() {
    // TC-16, TC-17
    let data = pattern(10 * MIB, 22);
    let (env, _) = one_blob_env("workspace.bundle", &data);
    let srv = start(&env);
    // By hand, the way the client asks: the second and third requests name the mtime the first carried.
    let (s1, h1, b1) = srv.get_raw(&Server::file_url(RUN, "workspace.bundle", "&from=0")).await;
    assert_eq!((s1, h1["eof"].as_str(), b1.len()), (200, "0", CHUNK));
    let mtime = h1["mtime"].clone();
    let (s2, h2, b2) = srv.get_raw(&Server::file_url(RUN, "workspace.bundle", &format!("&from={CHUNK}&mtime={mtime}"))).await;
    assert_eq!((s2, h2["eof"].as_str(), b2.len()), (200, "0", CHUNK));
    let (s3, h3, b3) = srv.get_raw(&Server::file_url(RUN, "workspace.bundle", &format!("&from={}&mtime={mtime}", 2 * CHUNK))).await;
    assert_eq!((s3, h3["eof"].as_str(), b3.len()), (200, "1", 2 * MIB));
    assert_eq!([b1, b2, b3].concat(), data);
    // Through the collector: the final name appears only after the last chunk, the partial exists before.
    let dest = env.root.join("out/workspace.bundle");
    let part = env.root.join("out/.workspace.bundle.partial");
    let entry = entry_for(&run_dir(&env), "workspace.bundle", collect::FileKind::Blob);
    let mut chunks = 0;
    let mut progress = |p: &Partial| -> anyhow::Result<()> {
        chunks += 1;
        assert!(!dest.exists(), "the final name must not exist before the last chunk");
        assert_eq!(std::fs::metadata(&part).unwrap().len(), p.bytes);
        Ok(())
    };
    collector::pull_blob(&srv.api(), &RunRef::Path(RUN.into()), &entry, &dest, None, &mut progress).await.unwrap();
    assert_eq!(chunks, 3);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!part.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pass_killed_after_two_chunks_is_resumed_from_the_partial_over_the_real_server() {
    // TC-18
    let data = pattern(10 * MIB, 23);
    let (env, _) = one_blob_env("workspace.bundle", &data);
    let srv = start(&env);
    let dest = env.root.join("out/workspace.bundle");
    let part = env.root.join("out/.workspace.bundle.partial");
    let entry = entry_for(&run_dir(&env), "workspace.bundle", collect::FileKind::Blob);
    let mut recorded: Option<Partial> = None;
    let mut seen = 0;
    let mut killed_after_two = |p: &Partial| -> anyhow::Result<()> {
        recorded = Some(p.clone());
        seen += 1;
        if seen == 2 {
            anyhow::bail!("killed");
        }
        Ok(())
    };
    let api = srv.api();
    let run = RunRef::Path(RUN.into());
    assert!(collector::pull_blob(&api, &run, &entry, &dest, None, &mut killed_after_two).await.is_err());
    let left = recorded.unwrap();
    assert_eq!(left.bytes, 2 * COLLECT_CHUNK_BYTES);
    assert_eq!(std::fs::metadata(&part).unwrap().len(), left.bytes);
    assert!(!dest.exists());
    // The next pass starts where the partial ends.
    let pulled = collector::pull_blob(&api, &run, &entry, &dest, Some(&left), &mut no_progress()).await.unwrap();
    assert_eq!(pulled.pulled, (data.len() - 2 * CHUNK) as u64, "only the rest is transferred");
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!part.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_file_rewritten_between_two_chunks_gives_a_conflict_and_the_copy_ends_equal_to_the_new_file() {
    // TC-19
    let old = pattern(9 * MIB, 24);
    let new = pattern(7 * MIB + 99, 25);
    let (env, dir) = one_blob_env("workspace.bundle", &old);
    let srv = start(&env);
    let dest = env.root.join("out/workspace.bundle");
    let entry = entry_for(&dir, "workspace.bundle", collect::FileKind::Blob);
    let node_file = dir.join("workspace.bundle");
    let mut rewritten = false;
    let mut rewrite_after_first_chunk = |_: &Partial| -> anyhow::Result<()> {
        if !rewritten {
            rewritten = true;
            std::fs::write(&node_file, &new)?;
            set_mtime(&node_file, 100);
        }
        Ok(())
    };
    let pulled = collector::pull_blob(&srv.api(), &RunRef::Path(RUN.into()), &entry, &dest, None, &mut rewrite_after_first_chunk).await.unwrap();
    assert_eq!(pulled.refetches, 1);
    assert_eq!(std::fs::read(&dest).unwrap(), new);
    assert!(!env.root.join("out/.workspace.bundle.partial").exists());
    // The server's answer to a stale read, by hand.
    let (status, _, body) = srv.get_raw(&Server::file_url(RUN, "workspace.bundle", &format!("&from={CHUNK}&mtime=1.000"))).await;
    assert_eq!(status, 409);
    assert!(error_of(&body).contains("E-BLOB-CHANGED"), "{}", error_of(&body));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_complete_blob_whose_node_mtime_changed_is_fetched_again_and_replaced_whole() {
    // TC-20
    let first = pattern(5 * MIB, 26);
    let second = pattern(5 * MIB + 7, 27);
    let env = setup();
    let dir = run_dir(&env);
    make_finished_run(&dir, &Sizes { bundle: first.len(), compact: 1_000 });
    write(&dir, "workspace.bundle", &first);
    let srv = start(&env);
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    let held = lake_run(&env).join("workspace.bundle");
    assert_eq!(std::fs::read(&held).unwrap(), first);
    assert!(note(&lake_run(&env)).complete);
    // The node rewrites it (a re-score replacing the bundle). The recheck is set to zero so the look is due.
    write(&dir, "workspace.bundle", &second);
    set_mtime(&dir.join("workspace.bundle"), 500);
    let cad = Cadence { finished_recheck: Duration::ZERO, ..cadence(0) };
    let s = collector::pass(&ctx_of(&[(NODE_NAME, &srv)]), &config(&env), &cad, false, 400).await.unwrap();
    assert_eq!(s[0].runs[0].pulled_files, 1, "{:?}", s[0].runs[0]);
    assert_eq!(std::fs::read(&held).unwrap(), second);
    assert!(!lake_run(&env).join(".workspace.bundle.partial").exists());
    assert!(!note(&lake_run(&env)).complete, "a changed file starts the settling over");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_blob_that_changes_on_every_request_fails_with_the_limit_and_the_lake_keeps_its_last_complete_copy() {
    // TC-21
    let (env, dir) = one_blob_env("workspace.bundle", &pattern(9 * MIB, 28));
    let srv = start(&env);
    let dest = env.root.join("out/workspace.bundle");
    let last_good = pattern(77, 29);
    write(&env.root, "out/workspace.bundle", &last_good);
    let entry = entry_for(&dir, "workspace.bundle", collect::FileKind::Blob);
    let node_file = dir.join("workspace.bundle");
    let mut n = 0u64;
    let mut rewrite_every_chunk = |_: &Partial| -> anyhow::Result<()> {
        n += 1;
        std::fs::write(&node_file, pattern(9 * MIB, 30 + n as u8))?;
        set_mtime(&node_file, 10 * n);
        Ok(())
    };
    let err = collector::pull_blob(&srv.api(), &RunRef::Path(RUN.into()), &entry, &dest, None, &mut rewrite_every_chunk).await.unwrap_err().to_string();
    assert!(err.contains(collector::E_REFETCH_LIMIT), "{err}");
    assert_eq!(std::fs::read(&dest).unwrap(), last_good);
    assert!(!env.root.join("out/.workspace.bundle.partial").exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_whole_file_over_one_chunk_is_refused_with_its_code_and_a_zero_byte_blob_is_collected_as_an_empty_file() {
    // TC-26, TC-23
    let env = setup();
    let dir = run_dir(&env);
    write(&dir, "run.json", b"{}");
    write(&dir, "run-history.jsonl", &vec![b'a'; CHUNK + 1]);
    write(&dir, "heldout-detail.json", b"");
    let srv = start(&env);
    let (status, _, body) = srv.get_raw(&Server::file_url(RUN, "run-history.jsonl", "")).await;
    assert_eq!(status, 413);
    assert!(error_of(&body).contains("E-WHOLE-TOO-LARGE"), "{}", error_of(&body));
    // At exactly one chunk a whole file is served.
    write(&dir, "run-history.jsonl", &vec![b'a'; CHUNK]);
    assert_eq!(srv.get_raw(&Server::file_url(RUN, "run-history.jsonl", "")).await.0, 200);
    let (status, h, body) = srv.get_raw(&Server::file_url(RUN, "heldout-detail.json", "")).await;
    assert_eq!((status, h["eof"].as_str(), body.len()), (200, "1", 0));
    for now in [100, 200] {
        pass(&env, &srv, now).await;
    }
    let held = lake_run(&env).join("heldout-detail.json");
    assert!(held.is_file() && std::fs::metadata(&held).unwrap().len() == 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_large_members_of_a_run_arrive_whole_at_twenty_and_fifty_megabytes() {
    // The sizes the design names: a bundle up to 20 MB (publicise.BUNDLE_LIMIT) and a compact log up to 50 MB.
    let env = setup();
    let dir = run_dir(&env);
    let bundle = pattern(20 * MIB, 31);
    let compact = pattern(50 * MIB, 32);
    write(&dir, "run.json", b"{}");
    write(&dir, "workspace.bundle", &bundle);
    write(&dir, "stories/01/agent-events.compact.jsonl.gz", &compact);
    let srv = start(&env);
    pass(&env, &srv, 100).await;
    assert!(std::fs::read(lake_run(&env).join("workspace.bundle")).unwrap() == bundle);
    assert!(std::fs::read(lake_run(&env).join("stories/01/agent-events.compact.jsonl.gz")).unwrap() == compact);
}

// ---- lake.allowlist.not_collected over the real server (TC-31) ----

#[tokio::test(flavor = "multi_thread")]
async fn the_node_neither_lists_nor_serves_a_name_that_is_left_out_and_none_reaches_the_lake() {
    // TC-31, and acceptance criterion 6
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let left_out = add_left_out(&run_dir(&env));
    let srv = start(&env);
    for name in &left_out {
        let (status, _, body) = srv.get_raw(&Server::file_url(RUN, name, "")).await;
        assert_eq!(status, 404, "{name}");
        assert!(error_of(&body).contains("E-NAME-NOT-ALLOWED"), "{name}: {}", error_of(&body));
    }
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    let held = names_below(&lake_run(&env));
    for name in &left_out {
        assert!(!held.contains(*name), "{name} reached the lake");
    }
    assert!(!held.iter().any(|n| n.starts_with("workspace/") || n.starts_with("control/")));
    assert!(!lake_run(&env).join("workspace").exists(), "the agent's working tree is not in the lake");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_with_only_left_out_files_besides_its_marker_has_a_manifest_of_that_marker_alone() {
    // TC-31 boundary
    let env = setup();
    let dir = run_dir(&env);
    write(&dir, "run.json", b"{}");
    add_left_out(&dir);
    let srv = start(&env);
    let m = srv.get_json(&format!("/v1/runs/files?run={RUN}")).await;
    let listed: Vec<&str> = m["files"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap()).collect();
    assert_eq!(listed, ["run.json"]);
}

// ---- lake.serve.held_out_allowlist (TC-47 to TC-51, TC-55, TC-57, TC-58) ----

#[tokio::test(flavor = "multi_thread")]
async fn held_out_detail_and_the_trees_are_collected_byte_for_byte() {
    // TC-47, TC-48
    let env = setup();
    let record = make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    for name in &record {
        let held = lake_run(&env).join(name);
        assert!(held.is_file(), "{name} is not in the lake");
        assert_eq!(std::fs::read(&held).unwrap(), std::fs::read(run_dir(&env).join(name)).unwrap(), "{name}");
    }
    for name in ["stories/01/accept.json", "stories/02/accept-report.json", "stories/03/accept-final.json", "heldout-detail.json", "summary-detail.md", "AUDIT.md", "audit.jsonl"] {
        assert!(record.contains(&name.to_string()), "{name}");
    }
    for tree in ["artifacts", "screenshots", "pre-suite-fix", "scoring-2"] {
        let count = names_below(&lake_run(&env)).iter().filter(|n| n.contains(&format!("/{tree}/"))).count();
        assert!(count > 0, "{tree} is not in the lake");
    }
    assert!(note(&lake_run(&env)).complete);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_request_for_a_name_outside_the_list_is_refused_with_its_code() {
    // TC-49
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    for name in ["token", "../x", "workspace/a", "/etc/passwd", "../../token", "stories/01/../../run.json", "stories/01/other.json"] {
        let (status, _, body) = srv.get_raw(&Server::file_url(RUN, name, "")).await;
        assert_eq!(status, 404, "{name}");
        assert!(error_of(&body).contains("E-NAME-NOT-ALLOWED"), "{name}: {}", error_of(&body));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_link_inside_a_tree_is_neither_listed_nor_served_and_a_linked_folder_is_not_followed() {
    // TC-50, TC-51, and the boundary: a link to a file inside the same run directory is refused too
    let env = setup();
    let dir = run_dir(&env);
    make_finished_run(&dir, &SMALL);
    let outside = env.root.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("inner.png"), b"outside").unwrap();
    std::os::unix::fs::symlink("/etc/hosts", dir.join("stories/01/artifacts/link.txt")).unwrap();
    std::os::unix::fs::symlink(dir.join("run.json"), dir.join("stories/01/artifacts/alias.json")).unwrap();
    std::fs::remove_dir_all(dir.join("stories/02/artifacts")).unwrap();
    std::os::unix::fs::symlink(&outside, dir.join("stories/02/artifacts")).unwrap();
    let srv = start(&env);
    let m = srv.get_json(&format!("/v1/runs/files?run={RUN}")).await;
    let listed: Vec<&str> = m["files"].as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap()).collect();
    assert!(!listed.iter().any(|n| n.ends_with("link.txt") || n.ends_with("alias.json") || n.starts_with("stories/02/artifacts/")), "{listed:?}");
    for name in ["stories/01/artifacts/link.txt", "stories/01/artifacts/alias.json", "stories/02/artifacts/inner.png"] {
        let (status, _, body) = srv.get_raw(&Server::file_url(RUN, name, "")).await;
        assert_eq!(status, 404, "{name}");
        assert!(error_of(&body).contains("E-OUTSIDE-RUN"), "{name}: {}", error_of(&body));
    }
    // A plain file next to them is served.
    assert_eq!(srv.get_raw(&Server::file_url(RUN, "stories/01/artifacts/app-start.log", "")).await.0, 200);
    // Nothing of it reaches the lake.
    for now in [100, 200] {
        pass(&env, &srv, now).await;
    }
    let held = names_below(&lake_run(&env));
    assert!(!held.iter().any(|n| n.ends_with("link.txt") || n.ends_with("alias.json") || n.ends_with("inner.png")));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_run_the_node_does_not_have_and_a_run_that_is_no_path_are_refused_with_their_codes() {
    // TC-57, TC-58
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let (status, _, body) = srv.get_raw(&Server::file_url("combinations/test/combo/fake/benchmarks/vidipack/nope", "run.json", "")).await;
    assert_eq!(status, 404);
    assert!(error_of(&body).contains("E-RUN-NOT-FOUND"), "{}", error_of(&body));
    for bad in ["../x", "/etc", "a//b", "combinations/../x"] {
        let (status, _, body) = srv.get_raw(&Server::file_url(bad, "run.json", "")).await;
        assert_eq!(status, 400, "{bad}");
        assert!(error_of(&body).contains("E-BAD-RUN-ID"), "{bad}: {}", error_of(&body));
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn every_file_and_folder_the_collector_creates_is_readable_by_the_owner_alone() {
    // TC-55
    use std::os::unix::fs::PermissionsExt;
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    let (mut dirs, mut files) = (0, 0);
    let mut stack = vec![lake(&env)];
    while let Some(d) = stack.pop() {
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700, "{}", d.display());
        dirs += 1;
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else {
                assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600, "{}", p.display());
                files += 1;
            }
        }
    }
    assert!(dirs > 10 && files > 100, "{dirs} folders, {files} files");
}

// ---- lake.reference.collect_into_reference (TC-63 to TC-65, TC-67) ----

fn make_reference_run(dir: &Path) {
    write(dir, "run.json", br#"{"install_id": "ref-install"}"#);
    write(dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T00:00:00Z"}"#);
    write(dir, "metrics.json", br#"{"stories": {}}"#);
    write(dir, "finalize.json", &pattern(1_500, 60));
    write(dir, "workspace.bundle", &pattern(200_000, 61));
    write(dir, "summary.md", &pattern(900, 62));
    for story in ["01", "02"] {
        write(dir, &format!("stories/{story}/prompt.md"), &pattern(2_000, 63));
        write(dir, &format!("stories/{story}/gate.json"), &pattern(300, 64));
        write(dir, &format!("stories/{story}/accept-summary.json"), &pattern(280, 65));
        write(dir, &format!("stories/{story}/agent-events.compact.jsonl.gz"), &pattern(50_000, 66));
        // The Claude Code transcript and the machine readings, on the allow-list but not for this class of run.
        write(dir, &format!("stories/{story}/agent-events.jsonl"), &pattern(90_000, 67));
        write(dir, &format!("stories/{story}/conditions.jsonl"), &pattern(4_000, 68));
    }
    write(dir, "server.log", &pattern(1_000, 69));
    write(dir, "proxy.log", &pattern(1_000, 70));
    write(dir, "requests.jsonl", &pattern(1_000, 71));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_reference_run_lands_under_reference_with_its_records_and_compact_logs_and_no_raw_stream() {
    // TC-63, TC-64, TC-65
    let env = setup();
    make_reference_run(&reference_dir(&env));
    let srv = start(&env);
    let m = srv.get_json(&format!("/v1/runs/files?run={REFERENCE_RUN}")).await;
    assert!(m["files"].as_array().unwrap().iter().any(|f| f["name"] == "stories/01/agent-events.jsonl"), "the raw stream is on the allow-list");
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    let held = env.root.join("reference/vidi/opus-5.5/v2-r1");
    let names = names_below(&held);
    for want in ["run.json", "metrics.json", "finalize.json", "workspace.bundle", "summary.md", "stories/01/prompt.md", "stories/01/gate.json", "stories/01/accept-summary.json", "stories/01/agent-events.compact.jsonl.gz", "stories/02/agent-events.compact.jsonl.gz"] {
        assert!(names.contains(want), "{want}");
    }
    for never in ["stories/01/agent-events.jsonl", "stories/01/conditions.jsonl", "server.log", "proxy.log", "requests.jsonl", "egress.jsonl"] {
        assert!(!names.contains(never), "{never} must not be in the reference folder");
    }
    let n = note(&held);
    assert_eq!((n.run.as_str(), n.node.as_str(), n.complete), (REFERENCE_RUN, NODE_NAME, true));
    assert!(!lake(&env).join(NODE_NAME).join(REFERENCE_RUN).exists(), "nothing of it under the lake's node folders");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_reference_run_still_running_is_collected_as_it_grows_and_completes_only_after_it_settles() {
    // TC-63 boundary
    let env = setup();
    let dir = reference_dir(&env);
    make_reference_run(&dir);
    write(&dir, "run-status.json", br#"{"state": "started", "reason": "", "at": "2026-10-15T00:00:00Z"}"#);
    let srv = start(&env);
    let held = env.root.join("reference/vidi/opus-5.5/v2-r1");
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    assert!(held.join("metrics.json").is_file() && !note(&held).complete);
    write(&dir, "metrics.json", br#"{"stories": {"1": {}}}"#);
    set_mtime(&dir.join("metrics.json"), 50);
    pass(&env, &srv, 400).await;
    assert_eq!(std::fs::read(held.join("metrics.json")).unwrap(), br#"{"stories": {"1": {}}}"#);
    write(&dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T01:00:00Z"}"#);
    set_mtime(&dir.join("run-status.json"), 60);
    for now in [500, 600, 700] {
        pass(&env, &srv, now).await;
    }
    assert!(note(&held).complete);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pass_with_the_ingest_on_collects_a_reference_run_and_leaves_the_ingest_input_free_of_it() {
    // TC-67 (what this story controls: the ingest reads the lake, and the reference run is not in it; story 6 changes how the
    // warehouse treats reference runs, on the owner's decision of 11 Oct 2026)
    let env = setup();
    make_reference_run(&reference_dir(&env));
    make_finished_run(&run_dir(&env), &SMALL);
    write(&env.repo, "benchmarks/placeholder.txt", b"x"); // the ingest reads the published tree at --repo
    let srv = start(&env);
    let cfg = Config { no_ingest: false, repo: Some(env.repo.clone()), worktree: true, ..config(&env) };
    for now in [100, 200, 300] {
        collector::pass(&ctx_of(&[(NODE_NAME, &srv)]), &cfg, &cadence(0), false, now).await.unwrap();
    }
    assert!(env.root.join("reference/vidi/opus-5.5/v2-r1/run.json").is_file());
    let ingest_input = names_below(&lake(&env));
    assert!(!ingest_input.iter().any(|n| n.contains("reference")), "the lake holds no reference run");
    assert!(env.root.join("insights/conversations.db").is_file(), "the ingest ran");
}

// ---- lake.collect.completeness (TC-75, TC-77, TC-78) ----

#[tokio::test(flavor = "multi_thread")]
async fn a_rescore_that_arrives_after_the_run_is_complete_is_collected_and_the_run_completes_again() {
    // TC-75
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let cad = Cadence { finished_recheck: Duration::ZERO, ..cadence(0) };
    let ctx = ctx_of(&[(NODE_NAME, &srv)]);
    for now in [100, 200, 300] {
        collector::pass(&ctx, &config(&env), &cad, false, now).await.unwrap();
    }
    assert!(note(&lake_run(&env)).complete);
    write(&run_dir(&env), "rescore/vidi-v2.0-pre3/rescore.json", &pattern(800, 80));
    let s = collector::pass(&ctx, &config(&env), &cad, false, 400).await.unwrap();
    assert_eq!(s[0].runs[0].pulled_files, 1);
    assert!(!note(&lake_run(&env)).complete, "complete false after a new file");
    assert_eq!(std::fs::read(lake_run(&env).join("rescore/vidi-v2.0-pre3/rescore.json")).unwrap(), pattern(800, 80));
    for now in [500, 600] {
        collector::pass(&ctx, &config(&env), &cad, false, now).await.unwrap();
    }
    assert!(note(&lake_run(&env)).complete, "complete again after the grace");
}

/// What a crashed pass can leave of one blob, to start a pass from: the partial file and the note.
struct CrashState {
    partial_bytes: usize,
    note_says: Option<usize>,
}

async fn crash_then_heal(state: CrashState) {
    let env = setup();
    let data = pattern(10 * MIB, 90);
    let dir = run_dir(&env);
    write(&dir, "run.json", b"{}");
    write(&dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T00:00:00Z"}"#);
    write(&dir, "workspace.bundle", &data);
    let srv = start(&env);
    // The state a crash leaves, built by hand: a partial file of `partial_bytes`, a note that records `note_says` of them.
    let held = lake_run(&env);
    std::fs::create_dir_all(&held).unwrap();
    let m = std::fs::metadata(dir.join("workspace.bundle")).unwrap();
    std::fs::write(held.join(".workspace.bundle.partial"), &data[..state.partial_bytes]).unwrap();
    if let Some(recorded) = state.note_says {
        let mut c = Collection { node: NODE_NAME.into(), run: RUN.into(), first_collected_at: 1, collected_at: 1, ..Default::default() };
        c.files.insert(
            "workspace.bundle".into(),
            Collected { bytes: 0, node_size: m.len(), node_mtime: collect::mtime_secs(&m), at_eof: false, pulled_at: 1, refetches: 0, partial: Some(Partial { bytes: recorded as u64, node_size: m.len(), node_mtime: collect::mtime_secs(&m) }) },
        );
        collector::save_collection(&held, &c).unwrap();
    }
    for now in [100, 200, 300, 400] {
        pass(&env, &srv, now).await;
    }
    assert_eq!(std::fs::read(held.join("workspace.bundle")).unwrap(), data, "ends equal to the node");
    assert!(!held.join(".workspace.bundle.partial").exists());
    assert!(note(&held).complete);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_crash_between_a_chunk_and_the_note_is_healed_in_every_state_it_can_leave() {
    // TC-77: the partial and the note agree; the partial is longer than the note (the chunk landed, the note did not);
    // the partial exists and the note has no record of it; the note records a partial that is gone.
    crash_then_heal(CrashState { partial_bytes: 2 * CHUNK, note_says: Some(2 * CHUNK) }).await;
    crash_then_heal(CrashState { partial_bytes: 2 * CHUNK + 4096, note_says: Some(2 * CHUNK) }).await;
    crash_then_heal(CrashState { partial_bytes: 2 * CHUNK, note_says: None }).await;
    crash_then_heal(CrashState { partial_bytes: 0, note_says: Some(2 * CHUNK) }).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_crash_in_the_middle_of_a_whole_file_and_of_an_append_log_is_healed_by_size_and_prefix() {
    // TC-77: a Whole file by comparing size and mtime, an Append file by the node's prefix check.
    let env = setup();
    let dir = run_dir(&env);
    make_finished_run(&dir, &SMALL);
    let srv = start(&env);
    for now in [100, 200] {
        pass(&env, &srv, now).await;
    }
    let held = lake_run(&env);
    // A torn whole file in the lake (the note says it is held), and an append log that holds a prefix of another file.
    std::fs::write(held.join("finalize.json"), b"torn").unwrap();
    std::fs::write(held.join("stories/01/agent-events.jsonl"), b"not the node's bytes at all").unwrap();
    let cad = Cadence { finished_recheck: Duration::ZERO, ..cadence(0) };
    // Neither is seen as changed by the manifest alone; clear the note's record of both, as a crash before the note did.
    let mut c = note(&held);
    c.files.remove("finalize.json");
    c.files.remove("stories/01/agent-events.jsonl");
    c.complete = false;
    collector::save_collection(&held, &c).unwrap();
    for now in [300, 400, 500] {
        collector::pass(&ctx_of(&[(NODE_NAME, &srv)]), &config(&env), &cad, false, now).await.unwrap();
    }
    assert_eq!(std::fs::read(held.join("finalize.json")).unwrap(), std::fs::read(dir.join("finalize.json")).unwrap());
    assert_eq!(std::fs::read(held.join("stories/01/agent-events.jsonl")).unwrap(), std::fs::read(dir.join("stories/01/agent-events.jsonl")).unwrap());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_node_that_is_down_is_reported_with_its_code_the_lake_is_untouched_and_another_node_is_still_collected() {
    // TC-78
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let env_b = setup();
    make_finished_run(&run_dir(&env_b), &SMALL);
    let srv_b = start(&env_b);
    let cfg = config(&env);
    let ctx = ctx_of(&[("node-a", &srv), ("node-b", &srv_b)]);
    for now in [100, 200, 300] {
        collector::pass(&ctx, &cfg, &cadence(0), false, now).await.unwrap();
    }
    let before_a = files_below(&lake(&env).join("node-a"));
    assert!(!before_a.is_empty());
    // node-a goes away: its run changes nowhere, node-b's does.
    drop(srv);
    write(&run_dir(&env_b), "rescore/vidi-v2.0-pre4/rescore.json", &pattern(500, 91));
    let cad = Cadence { finished_recheck: Duration::ZERO, ..cadence(0) };
    let summaries = collector::pass(&ctx, &cfg, &cad, false, 400).await.unwrap();
    let a = summaries.iter().find(|s| s.node == "node-a").unwrap();
    let b = summaries.iter().find(|s| s.node == "node-b").unwrap();
    assert!(!a.reachable && a.problems[0].starts_with(collector::E_NODE_UNREACHABLE), "{:?}", a.problems);
    assert!(b.reachable && b.runs[0].pulled_files == 1);
    assert_eq!(files_below(&lake(&env).join("node-a")), before_a, "the lake of the node that went away is byte for byte what it was");
}

// ---- workflows (TC-87, TC-88, TC-89) ----

#[tokio::test(flavor = "multi_thread")]
async fn w1_a_finished_run_is_collected_whole_and_marked_complete_only_after_everything_is_held() {
    // TC-87
    let env = setup();
    let record = make_finished_run(&run_dir(&env), &SMALL);
    add_left_out(&run_dir(&env));
    let srv = start(&env);
    let held = lake_run(&env);
    // First pass: everything pulled, nothing yet complete.
    let s = pass(&env, &srv, 100).await;
    assert!(s[0].runs[0].pulled_files >= record.len(), "{:?}", s[0].runs[0]);
    assert!(!note(&held).complete, "complete only after a further look finds no change");
    // Second pass: settled, grace 0. Third: complete.
    pass(&env, &srv, 200).await;
    assert!(!note(&held).complete);
    pass(&env, &srv, 300).await;
    let n = note(&held);
    assert!(n.complete && n.files.values().all(|f| f.at_eof && f.partial.is_none()), "{n:?}");
    // Criterion 1: the record, byte for byte, the re-score folders, the bundle, prompts, held-out results, compact logs, audits.
    for name in &record {
        assert_eq!(std::fs::read(held.join(name)).unwrap(), std::fs::read(run_dir(&env).join(name)).unwrap(), "{name}");
    }
    assert!(held.join("rescore/vidi-v2.0-pre2/rescore.json").is_file() && held.join("workspace.bundle").is_file());
    // Criterion 5 and 6: a file outside the list is refused; the agent's working tree is not in the lake.
    assert_eq!(srv.get_raw(&Server::file_url(RUN, "workspace/src/app.ts", "")).await.0, 404);
    assert!(!held.join("workspace").exists());
    // Negative: one file rewritten between the passes, and the run is not complete until collected again and the grace has passed again.
    write(&run_dir(&env), "finalize.json", &pattern(2_050, 99));
    set_mtime(&run_dir(&env).join("finalize.json"), 30);
    let cad = Cadence { finished_recheck: Duration::ZERO, ..cadence(0) };
    let ctx = ctx_of(&[(NODE_NAME, &srv)]);
    collector::pass(&ctx, &config(&env), &cad, false, 400).await.unwrap();
    assert!(!note(&held).complete);
    collector::pass(&ctx, &config(&env), &cad, false, 500).await.unwrap();
    assert!(!note(&held).complete, "settled again, the grace starts");
    collector::pass(&ctx, &config(&env), &cad, false, 600).await.unwrap();
    assert!(note(&held).complete);
    assert_eq!(std::fs::read(held.join("finalize.json")).unwrap(), pattern(2_050, 99));
}

#[tokio::test(flavor = "multi_thread")]
async fn w1_a_run_that_settled_with_no_stories_is_complete_with_its_records_alone() {
    // TC-87 boundary
    let env = setup();
    let dir = run_dir(&env);
    write(&dir, "run.json", b"{}");
    write(&dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T00:00:00Z"}"#);
    let srv = start(&env);
    for now in [100, 200, 300] {
        pass(&env, &srv, now).await;
    }
    let n = note(&lake_run(&env));
    assert!(n.complete && n.files.len() == 2, "{n:?}");
}

#[tokio::test(flavor = "multi_thread")]
async fn w2_a_reference_run_and_a_combination_run_collected_in_one_pass_land_where_they_belong() {
    // TC-88
    let env = setup();
    make_reference_run(&reference_dir(&env));
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let summaries = pass(&env, &srv, 100).await;
    let mut runs: Vec<&str> = summaries[0].runs.iter().map(|r| r.run.as_str()).collect();
    runs.sort_unstable();
    assert_eq!(runs, [REFERENCE_RUN, RUN]);
    for now in [200, 300] {
        pass(&env, &srv, now).await;
    }
    let reference = env.root.join("reference/vidi/opus-5.5/v2-r1");
    assert!(note(&reference).complete && note(&lake_run(&env)).complete);
    assert!(lake_run(&env).join("stories/01/agent-events.jsonl").is_file(), "a combination run keeps its raw streams");
    assert!(!reference.join("stories/01/agent-events.jsonl").exists(), "a reference run does not");
}

#[tokio::test(flavor = "multi_thread")]
async fn w3_a_pass_aborted_in_the_middle_of_a_bundle_and_a_rescore_rewrite_still_end_equal_to_the_node() {
    // TC-89: the pass is a task dropped mid-transfer, twice, then a rewrite on the node, then passes until complete.
    let env = setup();
    let dir = run_dir(&env);
    let bundle = pattern(24 * MIB, 95);
    write(&dir, "run.json", b"{}");
    write(&dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T00:00:00Z"}"#);
    write(&dir, "workspace.bundle", &bundle);
    write(&dir, "rescore/vidi-v2.0-pre2/rescore.json", &pattern(900, 96));
    let srv = start(&env);
    let held = lake_run(&env);
    let part = held.join(".workspace.bundle.partial");
    for kill in 0..2 {
        let (ctx, cfg) = (ctx_of(&[(NODE_NAME, &srv)]), config(&env));
        let task = tokio::spawn(async move { collector::pass(&ctx, &cfg, &cadence(0), false, 100 + kill).await });
        wait_until("a partial of at least one chunk", || std::fs::metadata(&part).map_or(false, |m| m.len() >= COLLECT_CHUNK_BYTES) || task.is_finished()).await;
        task.abort();
        let _ = task.await;
        if part.exists() {
            assert!(!held.join("workspace.bundle").exists(), "never half-written under the real name");
        }
        assert!(!note(&held).complete, "never complete while a bundle is half held");
    }
    // A re-score replaces a file on the node while the collector is catching up.
    write(&dir, "rescore/vidi-v2.0-pre2/rescore.json", &pattern(950, 97));
    set_mtime(&dir.join("rescore/vidi-v2.0-pre2/rescore.json"), 40);
    for now in [200, 300, 400, 500] {
        pass(&env, &srv, now).await;
    }
    assert_eq!(std::fs::read(held.join("workspace.bundle")).unwrap(), bundle);
    assert_eq!(std::fs::read(held.join("rescore/vidi-v2.0-pre2/rescore.json")).unwrap(), pattern(950, 97));
    assert!(!part.exists() && note(&held).complete);
}

// ---- lake.collect.space_guard (TC-95 to TC-97, TC-99) ----

/// The lake's disk, as a pass reads it, set by the test (a fn pointer cannot capture).
static READING: AtomicU64 = AtomicU64::new(u64::MAX);

fn reading(_: &Path) -> std::io::Result<u64> {
    Ok(READING.load(Ordering::SeqCst))
}

#[tokio::test(flavor = "multi_thread")]
async fn w4_a_shortage_then_recovery_in_one_run_of_passes_holds_once_then_pulls() {
    // TC-99. The reading is changed between two passes of the same collect::pass.
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let cfg = Config { free_bytes: reading, ..config(&env) };
    let ctx = ctx_of(&[(NODE_NAME, &srv)]);
    READING.store(1, Ordering::SeqCst);
    let first = collector::pass(&ctx, &cfg, &cadence(0), false, 100).await.unwrap();
    assert!(first.is_empty());
    assert_eq!(std::fs::read_dir(lake(&env)).unwrap().count(), 0, "nothing pulled during the shortage");
    READING.store(u64::MAX, Ordering::SeqCst);
    let second = collector::pass(&ctx, &cfg, &cadence(0), false, 200).await.unwrap();
    assert_eq!(second[0].runs.len(), 1);
    assert!(lake_run(&env).join("run.json").is_file());
}

fn dbench_cli(config: &Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_dbench")).arg("--config").arg(config).args(args).output().unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_pass_below_the_margin_reports_the_shortage_once_however_many_nodes_and_runs_it_would_have_pulled() {
    // TC-95
    let env = setup();
    make_finished_run(&run_dir(&env), &SMALL);
    let srv = start(&env);
    let env_b = setup();
    make_finished_run(&run_dir(&env_b), &SMALL);
    let srv_b = start(&env_b);
    write(&env.repo, "benchmarks/placeholder.txt", b"x");
    let config = env.root.join("nodes.toml");
    std::fs::write(
        &config,
        format!(
            "[nodes.node-a]\nurl = \"{}\"\ntoken = \"{}\"\n\n[nodes.node-b]\nurl = \"{}\"\ntoken = \"{}\"\n\n[collect]\nstore = \"{}\"\ndb = \"{}\"\nrepo = \"{}\"\n",
            srv.base, srv.token, srv_b.base, srv_b.token, lake(&env).display(), env.root.join("insights/conversations.db").display(), env.repo.display()
        ),
    )
    .unwrap();
    // A margin no disk has.
    let out = dbench_cli(&config, &["collect", "--once", "--no-ingest", "--free-space-margin-gib", "1000000000000"]);
    assert!(out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    let lines: Vec<&str> = stderr.lines().filter(|l| l.contains("holding")).collect();
    assert_eq!(lines.len(), 1, "{stderr}");
    assert!(lines[0].contains("below the margin"), "{}", lines[0]);
    assert_eq!(std::fs::read_dir(lake(&env)).unwrap().count(), 0);
    // The same command with a margin of zero pulls both nodes and reports nothing of the kind.
    let out = dbench_cli(&config, &["collect", "--once", "--no-ingest", "--free-space-margin-gib", "0"]);
    assert!(out.status.success());
    assert!(!String::from_utf8_lossy(&out.stderr).contains("holding"));
    assert!(lake(&env).join("node-a").join(RUN).join("run.json").is_file() && lake(&env).join("node-b").join(RUN).join("run.json").is_file());
}

/// A small disk image mounted for a test, on macOS: the real file system TC-96 and TC-97 need. None where it cannot be made.
struct SmallVolume {
    image: PathBuf,
    mount: PathBuf,
}

impl SmallVolume {
    const SIZE_MIB: u64 = 40;

    fn create(root: &Path) -> Option<SmallVolume> {
        let image = root.join("small.dmg");
        let mount = root.join("small-mount");
        std::fs::create_dir_all(&mount).ok()?;
        let made = Command::new("hdiutil").args(["create", "-size", &format!("{}m", Self::SIZE_MIB), "-fs", "APFS", "-volname", "dbench-small", "-ov"]).arg(&image).output().ok()?;
        if !made.status.success() {
            return None;
        }
        let attached = Command::new("hdiutil").args(["attach", "-nobrowse", "-mountpoint"]).arg(&mount).arg(&image).output().ok()?;
        attached.status.success().then_some(SmallVolume { image, mount })
    }
}

impl Drop for SmallVolume {
    fn drop(&mut self) {
        let _ = Command::new("hdiutil").args(["detach", "-force"]).arg(&self.mount).output();
        let _ = std::fs::remove_file(&self.image);
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_shortage_on_a_real_small_disk_pulls_nothing_and_a_partial_resumes_when_space_returns() {
    // TC-96, TC-97: a real small file system. Skipped, with its reason, where one cannot be made.
    let env = setup();
    let Some(volume) = SmallVolume::create(&env.root) else {
        eprintln!("skipped: no hdiutil to make a small disk");
        return;
    };
    let data = pattern(10 * MIB, 98);
    let dir = run_dir(&env);
    write(&dir, "run.json", b"{}");
    write(&dir, "run-status.json", br#"{"state": "finished", "reason": "", "at": "2026-10-15T00:00:00Z"}"#);
    write(&dir, "workspace.bundle", &data);
    let srv = start(&env);
    let store = volume.mount.join("lake");
    let cfg = |margin_gib: u64| Config { store: store.clone(), reference: volume.mount.join("reference"), free_space_margin_gib: margin_gib, free_bytes: collector::free_bytes, ..config(&env) };
    let ctx = ctx_of(&[(NODE_NAME, &srv)]);
    let free = collector::free_bytes(&volume.mount).unwrap();
    assert!(free < collector::BYTES_PER_GIB, "the small disk has {free} bytes free");
    // TC-96: the margin is one GiB, the disk has less: nothing pulled, and the lake is what it was.
    let held = store.join(NODE_NAME).join(RUN);
    let summaries = collector::pass(&ctx, &cfg(1), &cadence(0), false, 100).await.unwrap();
    assert!(summaries.is_empty() && !held.exists());
    // TC-97: with room, a pass dies after one chunk of the bundle (a partial is left); the shortage returns; the partial is
    // untouched; then it resumes and the lake equals one collected without the shortage.
    let entry = entry_for(&dir, "workspace.bundle", collect::FileKind::Blob);
    let dest = held.join("workspace.bundle");
    let mut recorded: Option<Partial> = None;
    let mut one_chunk = |p: &Partial| -> anyhow::Result<()> {
        recorded = Some(p.clone());
        anyhow::bail!("killed after one chunk")
    };
    assert!(collector::pull_blob(&srv.api(), &RunRef::Path(RUN.into()), &entry, &dest, None, &mut one_chunk).await.is_err());
    let part = held.join(".workspace.bundle.partial");
    let part_before = std::fs::read(&part).unwrap();
    assert_eq!(part_before.len(), CHUNK);
    let mut c = Collection { node: NODE_NAME.into(), run: RUN.into(), first_collected_at: 1, collected_at: 1, ..Default::default() };
    let left = recorded.unwrap();
    c.files.insert("workspace.bundle".into(), Collected { bytes: 0, node_size: left.node_size, node_mtime: left.node_mtime, at_eof: false, pulled_at: 1, refetches: 0, partial: Some(left) });
    collector::save_collection(&held, &c).unwrap();
    let summaries = collector::pass(&ctx, &cfg(1), &cadence(0), false, 200).await.unwrap();
    assert!(summaries.is_empty());
    assert_eq!(std::fs::read(&part).unwrap(), part_before, "a partial keeps its state exactly during a shortage");
    for now in [300, 400, 500] {
        collector::pass(&ctx, &cfg(0), &cadence(0), false, now).await.unwrap();
    }
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!part.exists() && note(&held).complete);
}
