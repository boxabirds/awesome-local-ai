//! Story 24 end to end, with the real binaries: two `dbench serve` nodes and the `dbench-collector` daemon.
//!
//! * W-1 (collect.by_changes): after its first look, a quiet network costs the collector almost nothing per pass (bytes
//!   fetched, warehouse loads, disk read), then a story log that grows on one node is in the lake within a pass, and the
//!   lake equals what a full look of the same nodes gives.
//! * W-2 (collect.full_look_fallback): one node with the change feed and one without. After a restart of the collector
//!   the first is read only through its feed, the second with a full look every pass and a log line saying why, and both
//!   nodes' runs are complete in the lake.
//!
//! Each node sits behind a small reverse proxy in this test that counts the bytes it returns and logs each request. For
//! W-2 the proxy answers `/v1/changes` with 404 and no body, as the router of a node from the release before this story
//! does for a route it does not have.
//!
//! The quiet window is `DBENCH_W1_QUIET_S` seconds (default `QUIET_DEFAULT_S`); the PRD's figures are for 15 minutes
//! (`QUIET_PRD_S`), and the disk threshold is scaled to the window. Run with `--nocapture` to see the measured figures.

use axum::body::{Body, Bytes};
use axum::extract::{Request, State};
use axum::response::Response;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const COMBINATION: &str = "kat/1/tiny/linux/box/fake-pi";
const INSTALL_ID: &str = "e2e-install";
const REF_INSTALL_ID: &str = "e2e-ref";
const RUN: &str = "combinations/kat/1/tiny/linux/box/fake-pi/benchmarks/vidi/e2e-r1";
const REF_BASE: &str = "benchmarks/reference/vidi/opus-5.5";
const REF_RUN: &str = "benchmarks/reference/vidi/opus-5.5/v2-r1";
const EVENTS: &str = "stories/01/agent-events.jsonl";
const PI_EVENTS: &str =
    include_str!("../../../benchmarks/spec-bench/harness/fixtures/pi-smoke-events.jsonl");
const RUN_JSON: &str = include_str!("fixtures/scopes_listing/run.json");
const METRICS: &str = include_str!("fixtures/scopes_listing/metrics-story1-done.json");
const FINISHED: &str = include_str!("fixtures/scopes_listing/run-status-finished.json");
const STARTED: &str = include_str!("fixtures/scopes_listing/run-status-started.json");
const QUIET_ENV: &str = "DBENCH_W1_QUIET_S";
const QUIET_DEFAULT_S: u64 = 30;
const QUIET_PRD_S: u64 = 900;
/// The PRD's proposals: under 64 KiB fetched per pass from all nodes, under 100 MiB read from disk in 15 minutes.
const MAX_BYTES_PER_PASS: u64 = 64 * 1024;
const MAX_DISK_READ_PRD: u64 = 100 * 1024 * 1024;
const POLL_MS: &str = "1000";
const GRACE_MS: &str = "1000";
const POLL: Duration = Duration::from_millis(100);
/// Past the node's 2 s settle margin, so runs written before the collector starts are behind its first head.
const AGED: Duration = Duration::from_millis(2_500);
const PASS_WAIT: Duration = Duration::from_secs(60);
const PASS_PREFIX: &str = "dbench collect: pass ";
/// Phases a pass with nothing to load shows on its line; anything else (`pass.db_open`, `candidates.*`) is a load.
const QUIET_PHASES: [&str; 4] = [
    "pass.nodes",
    "pass.free_space",
    "pass.archived",
    "unaccounted",
];
const STOP_DEADLINE: Duration = Duration::from_secs(5);
const RESTART_PASSES: usize = 3;
const NOT_FOUND: u16 = 404;

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// `DBENCH_E2E_COLLECTOR` runs these tests against another collector binary: an older build, to see them fail where the
/// change feed is missing.
const COLLECTOR_ENV: &str = "DBENCH_E2E_COLLECTOR";

fn collector_bin() -> PathBuf {
    std::env::var_os(COLLECTOR_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_BIN_EXE_dbench-collector")))
}

fn scratch(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!(
        "dbench-e2e-{tag}-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::SeqCst)
    ));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

fn stop(child: &mut Child) {
    // SAFETY: kill(2) on our own child's pid.
    unsafe { libc::kill(child.id() as i32, libc::SIGTERM) };
    let start = Instant::now();
    while matches!(child.try_wait(), Ok(None)) && start.elapsed() < STOP_DEADLINE {
        std::thread::sleep(POLL);
    }
    let _ = child.kill();
    let _ = child.wait();
}

// ------------------------------------------------------------------------------------------------ a node

struct Node {
    name: String,
    root: PathBuf,
    child: Child,
    url: String,
    token: String,
}

impl Drop for Node {
    fn drop(&mut self) {
        stop(&mut self.child);
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl Node {
    /// A real `dbench serve` over a checkout holding its own run and its copy of the shared reference run.
    fn start(name: &str, finalize: &str, status: &str) -> Node {
        let root = scratch(name);
        let repo = root.join("repo");
        let comb = repo.join("combinations").join(COMBINATION);
        std::fs::create_dir_all(&comb).unwrap();
        std::fs::write(
            comb.join("config.sh"),
            format!("INSTALL_ID=\"{INSTALL_ID}\"\n"),
        )
        .unwrap();
        let share = root.join("userhome/.local/share");
        for (id, env) in [
            (INSTALL_ID, format!("COMBINATION=\"{COMBINATION}\"\n")),
            (REF_INSTALL_ID, format!("RUN_BASE=\"{REF_BASE}\"\n")),
        ] {
            std::fs::create_dir_all(share.join(id)).unwrap();
            std::fs::write(
                share.join(id).join("install.env"),
                format!("INSTALL_ID=\"{id}\"\n{env}"),
            )
            .unwrap();
        }
        for run in [RUN, REF_RUN] {
            let d = repo.join(run);
            std::fs::create_dir_all(d.join("stories/01")).unwrap();
            std::fs::write(d.join("run.json"), RUN_JSON).unwrap();
            std::fs::write(
                d.join("work_dir.txt"),
                root.join("work").display().to_string(),
            )
            .unwrap();
            std::fs::write(d.join("metrics.json"), METRICS).unwrap();
            std::fs::write(d.join("run-status.json"), status).unwrap();
            std::fs::write(
                d.join(EVENTS),
                PI_EVENTS
                    .lines()
                    .take(4)
                    .map(|l| format!("{l}\n"))
                    .collect::<String>(),
            )
            .unwrap();
        }
        std::fs::write(repo.join(REF_RUN).join("finalize.json"), finalize).unwrap();
        let home = root.join("dbench-home");
        let mut child = Command::new(env!("CARGO_BIN_EXE_dbench"))
            .args([
                "serve",
                "--bind",
                "127.0.0.1:0",
                "--no-pull",
                "--allow-unreleased",
            ])
            .arg("--repo")
            .arg(&repo)
            .arg("--home")
            .arg(&home)
            .arg("--share-dir")
            .arg(&share)
            .env("HOME", root.join("userhome"))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn dbench serve");
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let addr = line
            .trim()
            .strip_prefix(dbench::server::LISTENING_PREFIX)
            .unwrap_or_else(|| panic!("{line:?}"))
            .to_string();
        let token = std::fs::read_to_string(home.join("token"))
            .unwrap()
            .trim()
            .to_string();
        Node {
            name: name.into(),
            root,
            child,
            url: format!("http://{addr}"),
            token,
        }
    }

    fn run_file(&self, run: &str, name: &str) -> PathBuf {
        self.root.join("repo").join(run).join(name)
    }
}

// ------------------------------------------------------------------------------------------------ the proxy

#[derive(Default)]
struct Seen {
    /// Each request's path and query, and the bytes of its answer's body.
    requests: Vec<(String, u64)>,
}

struct ProxyState {
    upstream: String,
    hide_feed: bool,
    seen: Arc<Mutex<Seen>>,
    http: reqwest::Client,
}

struct Proxy {
    url: String,
    seen: Arc<Mutex<Seen>>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl Proxy {
    fn bytes(&self) -> u64 {
        self.seen
            .lock()
            .unwrap()
            .requests
            .iter()
            .map(|(_, b)| b)
            .sum()
    }
    fn paths(&self) -> Vec<String> {
        self.seen
            .lock()
            .unwrap()
            .requests
            .iter()
            .map(|(p, _)| p.clone())
            .collect()
    }
    fn mark(&self) -> usize {
        self.seen.lock().unwrap().requests.len()
    }
    fn since(&self, mark: usize) -> Vec<String> {
        self.paths().split_off(mark)
    }
}

async fn forward(State(st): State<Arc<ProxyState>>, req: Request) -> Response {
    let path = req
        .uri()
        .path_and_query()
        .map(|p| p.to_string())
        .unwrap_or_default();
    if st.hide_feed && req.uri().path() == "/v1/changes" {
        st.seen.lock().unwrap().requests.push((path, 0));
        return Response::builder()
            .status(NOT_FOUND)
            .body(Body::empty())
            .unwrap();
    }
    let (parts, body) = req.into_parts();
    let body: Bytes = axum::body::to_bytes(body, usize::MAX).await.unwrap();
    let mut out = st
        .http
        .request(parts.method, format!("{}{path}", st.upstream))
        .body(body);
    for (k, v) in parts.headers.iter() {
        if k != "host" && k != "content-length" {
            out = out.header(k, v);
        }
    }
    let resp = out.send().await.unwrap();
    let mut builder = Response::builder().status(resp.status().as_u16());
    for (k, v) in resp.headers() {
        if k != "content-length" && k != "transfer-encoding" && k != "connection" {
            builder = builder.header(k, v);
        }
    }
    let bytes = resp.bytes().await.unwrap();
    st.seen
        .lock()
        .unwrap()
        .requests
        .push((path, bytes.len() as u64));
    builder.body(Body::from(bytes)).unwrap()
}

async fn proxy(node: &Node, hide_feed: bool) -> Proxy {
    let seen = Arc::new(Mutex::new(Seen::default()));
    let state = Arc::new(ProxyState {
        upstream: node.url.clone(),
        hide_feed,
        seen: seen.clone(),
        http: reqwest::Client::new(),
    });
    let app = axum::Router::new().fallback(forward).with_state(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Proxy {
        url: format!("http://{addr}"),
        seen,
        server,
    }
}

// ------------------------------------------------------------------------------------------------ the collector

struct Collector {
    child: Child,
    lines: Arc<Mutex<Vec<String>>>,
}

impl Drop for Collector {
    fn drop(&mut self) {
        stop(&mut self.child);
    }
}

struct Lake {
    state: PathBuf,
    host: PathBuf,
    config: PathBuf,
}

impl Drop for Lake {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.state);
    }
}

impl Lake {
    fn new(nodes: &[(&Node, &Proxy)]) -> Lake {
        let state = scratch("lake");
        let host = state.join("host");
        std::fs::create_dir_all(host.join("benchmarks/vidi")).unwrap();
        std::fs::write(
            host.join("benchmarks/vidi/bench.json"),
            r#"{"name": "vidi", "pack_ref": "kat-v1"}"#,
        )
        .unwrap();
        let config = state.join("nodes.toml");
        let text: String = nodes
            .iter()
            .map(|(n, p)| {
                format!(
                    "[nodes.{}]\nurl = \"{}\"\ntoken = \"{}\"\n\n",
                    n.name, p.url, n.token
                )
            })
            .collect();
        std::fs::write(&config, text).unwrap();
        Lake {
            state,
            host,
            config,
        }
    }
    fn store(&self) -> PathBuf {
        self.state.join("collected")
    }
    fn args(&self, store: &Path) -> Vec<String> {
        let s = |p: &Path| p.display().to_string();
        vec![
            "--config".into(),
            s(&self.config),
            "--store".into(),
            s(store),
            "--reference".into(),
            s(&store.parent().unwrap().join("reference")),
            "--db".into(),
            s(&store.parent().unwrap().join("insights/conversations.db")),
            "--repo".into(),
            s(&self.host),
            "--api".into(),
            "none".into(),
            "--scopes".into(),
            "--running-poll-ms".into(),
            POLL_MS.into(),
            "--free-space-margin-gib".into(),
            "0".into(),
            // A node without the feed is read the old way, complete only after the grace: short, so W-2 sees it.
            "--settle-grace-ms".into(),
            GRACE_MS.into(),
        ]
    }
    fn start(&self) -> Collector {
        let mut child = Command::new(collector_bin())
            .args(self.args(&self.store()))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn dbench-collector");
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let err = child.stderr.take().unwrap();
        std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                sink.lock().unwrap().push(line);
            }
        });
        Collector { child, lines }
    }
    /// One full look into a fresh store (no point there), with the one-shot form of the same program.
    fn full_look_into(&self, store: &Path) {
        let out = Command::new(collector_bin())
            .args(self.args(store))
            .arg("--once")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    fn run_dir(&self, store: &Path, node: &str, run: &str) -> PathBuf {
        dbench::collector::dest_dir(store, &store.parent().unwrap().join("reference"), node, run)
            .unwrap()
    }
    fn lake_file(&self, store: &Path, node: &str, run: &str, name: &str) -> PathBuf {
        self.run_dir(store, node, run).join(name)
    }
}

impl Collector {
    fn passes(&self) -> usize {
        self.lines
            .lock()
            .unwrap()
            .iter()
            .filter(|l| l.starts_with(PASS_PREFIX))
            .count()
    }
    fn pass_lines(&self) -> Vec<String> {
        self.lines
            .lock()
            .unwrap()
            .iter()
            .filter(|l| l.starts_with(PASS_PREFIX))
            .cloned()
            .collect()
    }
    fn lines(&self) -> Vec<String> {
        self.lines.lock().unwrap().clone()
    }
    async fn wait_passes(&self, n: usize) {
        let start = Instant::now();
        while self.passes() < n {
            assert!(
                start.elapsed() < PASS_WAIT,
                "only {} passes of {n}: {:#?}",
                self.passes(),
                self.lines()
            );
            tokio::time::sleep(POLL).await;
        }
    }
}

/// The phases a pass line names: "pass 0.1 s: pass.nodes 0.1 s (1x); pass.free_space 0.0 s (1x) | idle ...".
fn phases(line: &str) -> Vec<String> {
    let after = line.strip_prefix(PASS_PREFIX).unwrap_or(line);
    let body = after.split_once(": ").map(|x| x.1).unwrap_or("");
    let body = body.split(" | ").next().unwrap_or("");
    body.split("; ")
        .filter_map(|p| p.split_whitespace().next())
        .map(String::from)
        .collect()
}

/// Bytes the process has read from disk so far.
fn disk_read(pid: u32) -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut ri: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
        // SAFETY: the buffer is a rusage_info_v2, the flavour asked for.
        let rc = unsafe {
            libc::proc_pid_rusage(
                pid as i32,
                libc::RUSAGE_INFO_V2,
                &mut ri as *mut _ as *mut libc::rusage_info_t,
            )
        };
        assert_eq!(rc, 0, "proc_pid_rusage");
        ri.ri_diskio_bytesread
    }
    #[cfg(not(target_os = "macos"))]
    {
        let io = std::fs::read_to_string(format!("/proc/{pid}/io")).unwrap();
        io.lines()
            .find_map(|l| l.strip_prefix("read_bytes: "))
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }
}

fn files_of(dir: &Path) -> std::collections::BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut std::collections::BTreeMap<String, Vec<u8>>) {
        for e in std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out);
            } else if p.file_name().unwrap() != dbench::collector::COLLECTION_FILE {
                out.insert(
                    p.strip_prefix(base).unwrap().display().to_string(),
                    std::fs::read(&p).unwrap(),
                );
            }
        }
    }
    let mut out = std::collections::BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

// ------------------------------------------------------------------------------------------------ W-1

#[tokio::test(flavor = "multi_thread")]
async fn w1_a_quiet_network_costs_almost_nothing_and_a_growing_run_arrives_within_a_pass() {
    let quiet_s: u64 = std::env::var(QUIET_ENV)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(QUIET_DEFAULT_S);
    // Two nodes, each with its own run and its own copy of the reference run, the copies differing as quintus's and
    // the laptop's do.
    let a = Node::start("laptop", r#"{"score": "70/75"}"#, STARTED);
    let b = Node::start(
        "quintus",
        r#"{"score": "70/75", "rescored": true}"#,
        FINISHED,
    );
    let (pa, pb) = (proxy(&a, false).await, proxy(&b, false).await);
    let lake = Lake::new(&[(&a, &pa), (&b, &pb)]);
    tokio::time::sleep(AGED).await;
    let c = lake.start();
    c.wait_passes(2).await;
    // Quiet.
    let (bytes0, passes0, read0) = (pa.bytes() + pb.bytes(), c.passes(), disk_read(c.child.id()));
    tokio::time::sleep(Duration::from_secs(quiet_s)).await;
    let (bytes1, passes1, read1) = (pa.bytes() + pb.bytes(), c.passes(), disk_read(c.child.id()));
    let passes = (passes1 - passes0) as u64;
    assert!(passes > 0);
    let per_pass = (bytes1 - bytes0) / passes;
    let read = read1 - read0;
    let read_limit = MAX_DISK_READ_PRD * quiet_s / QUIET_PRD_S;
    let loads: Vec<String> = c.pass_lines()[passes0..passes1]
        .iter()
        .filter(|l| {
            phases(l)
                .iter()
                .any(|p| !QUIET_PHASES.contains(&p.as_str()))
        })
        .cloned()
        .collect();
    eprintln!(
        "W-1 quiet {quiet_s} s: {passes} passes, {per_pass} bytes fetched per pass (limit {MAX_BYTES_PER_PASS}), \
         {} warehouse loads, {read} bytes read from disk (limit {read_limit}, scaled from 100 MiB in 15 min)",
        loads.len()
    );
    assert!(per_pass < MAX_BYTES_PER_PASS, "{per_pass} bytes a pass");
    assert!(
        loads.is_empty(),
        "a quiet pass loaded the warehouse: {loads:#?}"
    );
    assert!(read < read_limit, "{read} bytes read");
    // A story log grows on one node: its new lines are in the lake within a pass of the settle margin.
    let more: String = PI_EVENTS
        .lines()
        .skip(4)
        .map(|l| format!("{l}\n"))
        .collect();
    let mut log = std::fs::read_to_string(a.run_file(RUN, EVENTS)).unwrap();
    log.push_str(&more);
    std::fs::write(a.run_file(RUN, EVENTS), &log).unwrap();
    let held = lake.lake_file(&lake.store(), "laptop", RUN, EVENTS);
    let start = Instant::now();
    while std::fs::read_to_string(&held).unwrap_or_default() != log {
        assert!(
            start.elapsed() < PASS_WAIT,
            "the grown log never reached the lake"
        );
        tokio::time::sleep(POLL).await;
    }
    eprintln!(
        "W-1 the grown log was in the lake {:.1} s after the write",
        start.elapsed().as_secs_f64()
    );
    // The lake equals one full look of the same nodes.
    drop(c);
    let fresh = lake.state.join("fresh/collected");
    std::fs::create_dir_all(&fresh).unwrap();
    lake.full_look_into(&fresh);
    // Each node's own run. The shared reference run has one lake folder that either node's copy fills, whichever wrote
    // last, under either kind of look (TC-25 covers it settling).
    for (node, run) in [("laptop", RUN), ("quintus", RUN)] {
        let by_changes = files_of(&lake.run_dir(&lake.store(), node, run));
        let full = files_of(&lake.run_dir(&fresh, node, run));
        assert!(!full.is_empty());
        assert!(
            by_changes == full,
            "{node} {run}: {:?} against {:?}",
            by_changes.keys(),
            full.keys()
        );
    }
}

// ------------------------------------------------------------------------------------------------ W-2

#[tokio::test(flavor = "multi_thread")]
async fn w2_after_a_restart_the_new_node_is_read_by_its_feed_and_the_old_one_by_a_full_look_each_pass(
) {
    let new = Node::start("thing2", r#"{"score": "1/2"}"#, FINISHED);
    let old = Node::start("gruntus", r#"{"score": "2/2"}"#, FINISHED);
    let (pn, po) = (proxy(&new, false).await, proxy(&old, true).await);
    let lake = Lake::new(&[(&new, &pn), (&old, &po)]);
    tokio::time::sleep(AGED).await;
    {
        let c = lake.start();
        c.wait_passes(2).await;
    }
    let state = lake.state.clone();
    assert!(
        dbench::collector::read_point(&state, "thing2").is_some(),
        "a point for the node with the feed"
    );
    assert!(
        dbench::collector::read_point(&state, "gruntus").is_none(),
        "none for the node without"
    );
    // Restart.
    let (mark_new, mark_old) = (pn.mark(), po.mark());
    let c = lake.start();
    c.wait_passes(RESTART_PASSES).await;
    let passes = c.passes();
    let new_seen = pn.since(mark_new);
    let old_seen = po.since(mark_old);
    assert!(
        new_seen.iter().all(|p| p != "/v1/runs"),
        "the new node had a full look after the restart: {new_seen:#?}"
    );
    assert!(
        new_seen
            .iter()
            .any(|p| p.starts_with("/v1/changes?after=thing2")
                || p.starts_with("/v1/changes?after=")),
        "{new_seen:#?}"
    );
    let old_lists = old_seen.iter().filter(|p| p.as_str() == "/v1/runs").count();
    assert!(
        old_lists >= passes,
        "{old_lists} full looks of the old node in {passes} passes"
    );
    let said = c
        .lines()
        .iter()
        .filter(|l| l.contains("full look: gruntus: node software has no /v1/changes"))
        .count();
    assert!(
        said >= passes,
        "{said} log lines in {passes} passes: {:#?}",
        c.lines()
    );
    for (node, run) in [("thing2", RUN), ("gruntus", RUN)] {
        let dir = lake.run_dir(&lake.store(), node, run);
        assert!(
            dbench::collector::load_collection(&dir).is_some_and(|c| c.complete),
            "{node} {run} not complete: {:#?}",
            dbench::collector::load_collection(&dir)
        );
    }
}
