//! Story 24: the collector reads each node incrementally through its change feed (collect.by_changes, TC-19 to TC-31),
//! falls back to a full look when it has no usable point (collect.full_look_fallback, TC-32 to TC-37), and keeps its
//! point safe when it cannot be written (collect.point_store, TC-38).
//!
//! Each node is the real node router in process, with a layer that logs every request and can make some fail; each pass
//! is the real per-node pass (`collector::collect_node_with`, through the scope routes, as the live collector runs).

use axum::extract::Request;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use dbench::cli::ServerConfig;
use dbench::client::{Ctx, NodeEntry};
use dbench::collector::{self, Cadence, Lake, NodeSummary, Point};
use dbench::server::{router, Inner, Shared};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKEN: &str = "test-token";
const COMBINATION: &str = "kat/1/tiny/linux/box/fake-pi";
const INSTALL_ID: &str = "ch-install";
const REF_INSTALL_ID: &str = "ch-ref";
const PACK: &str = "benchmarks/chpack";
const RUN_A: &str = "combinations/kat/1/tiny/linux/box/fake-pi/benchmarks/chpack/run-a";
const RUN_B: &str = "combinations/kat/1/tiny/linux/box/fake-pi/benchmarks/chpack/run-b";
const RUN_C: &str = "combinations/kat/1/tiny/linux/box/fake-pi/benchmarks/chpack/run-c";
const REF_BASE: &str = "benchmarks/reference/vidi/opus-5.5";
const REF_RUN: &str = "benchmarks/reference/vidi/opus-5.5/v2-r1";
const POLL: Duration = Duration::from_millis(50);
/// Past the node's settle margin (2 s): a change made before this wait is at or before the next look's horizon.
const SETTLE: Duration = Duration::from_millis(2_300);
/// Past the settle margin and the job store's whole-second stamps.
const SETTLE_JOB: Duration = Duration::from_millis(3_500);
const FEED: &str = "/v1/changes";
const LIST: &str = "/v1/runs";
const SCOPES: &str = "/v1/runs/scopes";
const CODE: &str = "/v1/runs/code";
const SHARED_PASSES: u64 = 15;
const MANY_FILES: usize = 5_000;
const FEED_PAGES_FOR_MANY: usize = 3;
// Recorded run-status.json files, as the harness writes them.
const STARTED: &str = include_str!("fixtures/scopes_listing/run-status-started.json");
const FINISHED: &str = include_str!("fixtures/scopes_listing/run-status-finished.json");

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// What a node's layer records and injects.
#[derive(Default)]
struct Rig {
    log: Mutex<Vec<String>>,
    /// Requests whose query names this run answer 500.
    fail_run: Mutex<Option<String>>,
    /// Every request but the change feed answers 503: the node dropped part-way through a look.
    dropped: AtomicBool,
    /// The code route answers 500 (the node's git failed).
    fail_code: AtomicBool,
    /// Called once, on the first list of runs (`GET /v1/runs`): a write made during a full look.
    on_list: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

struct Node {
    name: String,
    root: PathBuf,
    shared: Arc<Shared>,
    base: String,
    rig: Arc<Rig>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for Node {
    fn drop(&mut self) {
        self.server.abort();
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

async fn layer(rig: Arc<Rig>, req: Request, next: Next) -> Response {
    let uri = req.uri().clone();
    let entry = match uri.query() {
        Some(q) => format!("{}?{}", uri.path(), q),
        None => uri.path().to_string(),
    };
    rig.log.lock().unwrap().push(entry.clone());
    if uri.path() == LIST {
        if let Some(hook) = rig.on_list.lock().unwrap().take() {
            hook();
        }
    }
    if rig.dropped.load(Ordering::SeqCst) && uri.path() != FEED {
        return (axum::http::StatusCode::SERVICE_UNAVAILABLE, "dropped").into_response();
    }
    if rig.fail_code.load(Ordering::SeqCst) && uri.path() == CODE {
        return (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "git upload-pack failed",
        )
            .into_response();
    }
    if let Some(run) = rig.fail_run.lock().unwrap().as_deref() {
        if uri.path() != FEED && entry.contains(&enc(run)) {
            return (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "failed").into_response();
        }
    }
    next.run(req).await
}

impl Node {
    async fn start(name: &str) -> Node {
        let root = std::env::temp_dir().join(format!(
            "dbench-collector-changes-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&root);
        let (repo, home, share) = (root.join("repo"), root.join("home"), root.join("share"));
        let comb = repo.join("combinations").join(COMBINATION);
        std::fs::create_dir_all(&comb).unwrap();
        std::fs::write(
            comb.join("config.sh"),
            format!("INSTALL_ID=\"{INSTALL_ID}\"\n"),
        )
        .unwrap();
        std::fs::create_dir_all(repo.join(PACK).join("harness")).unwrap();
        std::fs::write(
            repo.join(PACK).join("harness/run.sh"),
            "#!/bin/sh\nexit 0\n",
        )
        .unwrap();
        std::fs::create_dir_all(home.join("jobs")).unwrap();
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
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".into(),
            repo: repo.canonicalize().unwrap(),
            jobs_dir: home.join("jobs"),
            releases_dir: home.join("releases"),
            home,
            share_dir: share,
            bench_home: root.join("bench-home"),
            path_prepend: vec![],
            max_restarts: 0,
            pull: false,
            allow_unreleased: true,
            restart_backoff: POLL,
            unfit_backoff: POLL,
            cancel_grace: POLL,
            tree_poll: POLL,
        };
        let shared = Arc::new(Shared {
            cfg,
            token: TOKEN.into(),
            boot_time: None,
            inner: Mutex::new(Inner {
                jobs: HashMap::new(),
                queue: VecDeque::new(),
                current: None,
                hold: None,
            }),
            wake: tokio::sync::Notify::new(),
        });
        let rig = Arc::new(Rig::default());
        let r = rig.clone();
        let app = router(shared.clone()).layer(axum::middleware::from_fn(
            move |req: Request, next: Next| layer(r.clone(), req, next),
        ));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        // With the caller's address, which the hold route records.
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap()
        });
        Node {
            name: name.into(),
            root,
            shared,
            base: format!("http://{addr}"),
            rig,
            server,
        }
    }

    fn dir(&self, run: &str) -> PathBuf {
        self.shared.cfg.repo.join(run)
    }

    /// A run this node ran: run.json, work_dir.txt (a work folder with no repository: no code to pull), its status.
    fn make_run(&self, run: &str) {
        let d = self.dir(run);
        std::fs::create_dir_all(d.join("stories/01")).unwrap();
        std::fs::write(
            d.join("run.json"),
            format!("{{\"run\": \"{run}\", \"node\": \"{}\"}}", self.name),
        )
        .unwrap();
        std::fs::write(
            d.join("work_dir.txt"),
            self.root.join("work").display().to_string(),
        )
        .unwrap();
        std::fs::write(d.join("metrics.json"), "{\"stories\": {}}").unwrap();
        std::fs::write(d.join("run-status.json"), STARTED).unwrap();
    }

    /// Give the run a repository in its work folder: one commit on main, tagged story-01.
    fn give_code(&self, run: &str) -> String {
        let work = PathBuf::from(
            std::fs::read_to_string(self.dir(run).join("work_dir.txt"))
                .unwrap()
                .trim(),
        );
        let ws = work.join("workspace");
        std::fs::create_dir_all(&ws).unwrap();
        let git = |args: &[&str]| {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(&ws)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {args:?}: {}",
                String::from_utf8_lossy(&out.stderr)
            );
            String::from_utf8(out.stdout).unwrap()
        };
        git(&["init", "-q", "-b", "main"]);
        std::fs::write(ws.join("a.ts"), "1").unwrap();
        git(&["add", "-A"]);
        git(&[
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "commit",
            "-qm",
            "story 1",
        ]);
        git(&["tag", "story-01"]);
        git(&["rev-parse", "HEAD"]).trim().to_string()
    }

    fn write(&self, run: &str, name: &str, text: &str) {
        let p = self.dir(run).join(name);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.rig.log.lock().unwrap())
    }

    fn node_id(&self) -> String {
        dbench::changes::node_id(&self.shared.cfg.home).unwrap()
    }

    async fn call(&self, method: reqwest::Method, path: &str, body: serde_json::Value) -> u16 {
        reqwest::Client::new()
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(TOKEN)
            .json(&body)
            .send()
            .await
            .unwrap()
            .status()
            .as_u16()
    }
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect()
}

struct LakeDirs {
    state: PathBuf,
}

impl Drop for LakeDirs {
    fn drop(&mut self) {
        let points = self.state.join(collector::POINTS_DIR);
        if points.exists() {
            let _ = std::fs::set_permissions(
                &points,
                std::os::unix::fs::PermissionsExt::from_mode(0o755),
            );
        }
        let _ = std::fs::remove_dir_all(&self.state);
    }
}

impl LakeDirs {
    fn new() -> LakeDirs {
        let state = std::env::temp_dir().join(format!(
            "dbench-collector-changes-lake-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&state);
        std::fs::create_dir_all(state.join("collected")).unwrap();
        LakeDirs { state }
    }
    fn store(&self) -> PathBuf {
        self.state.join("collected")
    }
    fn reference(&self) -> PathBuf {
        self.state.join("reference")
    }
    fn file(&self, node: &str, run: &str, name: &str) -> PathBuf {
        collector::dest_dir(&self.store(), &self.reference(), node, run)
            .unwrap()
            .join(name)
    }
    fn collection(&self, node: &str, run: &str) -> collector::Collection {
        collector::load_collection(
            &collector::dest_dir(&self.store(), &self.reference(), node, run).unwrap(),
        )
        .unwrap()
    }
    fn point(&self, node: &str) -> Option<Point> {
        collector::read_point(&self.state, node)
    }
}

fn ctx(nodes: &[&Node]) -> Ctx {
    Ctx {
        nodes: nodes
            .iter()
            .map(|n| {
                (
                    n.name.clone(),
                    NodeEntry {
                        url: n.base.clone(),
                        token: Some(TOKEN.into()),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>(),
        collect: Default::default(),
        json: false,
    }
}

fn cadence() -> Cadence {
    Cadence {
        running_poll: Duration::ZERO,
        finished_recheck: Duration::ZERO,
        settle_grace: Duration::ZERO,
    }
}

/// A grace long enough that only the feed's rule can complete a run within a test.
fn long_grace() -> Cadence {
    Cadence {
        running_poll: Duration::ZERO,
        finished_recheck: Duration::ZERO,
        settle_grace: Duration::from_secs(3_600),
    }
}

async fn pass_with(
    n: &Node,
    all: &[&Node],
    lake: &LakeDirs,
    cadence: &Cadence,
    now: u64,
) -> NodeSummary {
    let (store, reference) = (lake.store(), lake.reference());
    let l = Lake {
        store: &store,
        reference: &reference,
    };
    collector::collect_node_with(
        &ctx(all),
        &n.name,
        l,
        &[],
        &Default::default(),
        cadence,
        now,
        true,
    )
    .await
}

async fn pass(n: &Node, lake: &LakeDirs, now: u64) -> NodeSummary {
    pass_with(n, &[n], lake, &cadence(), now).await
}

fn feed_requests(log: &[String]) -> Vec<&String> {
    log.iter()
        .filter(|l| l.starts_with(&format!("{FEED}?")))
        .collect()
}

fn lists(log: &[String]) -> usize {
    log.iter().filter(|l| l.as_str() == LIST).count()
}

fn naming<'a>(log: &'a [String], run: &str) -> Vec<&'a String> {
    log.iter().filter(|l| l.contains(&enc(run))).collect()
}

fn cursor_ns(cursor: &str) -> i64 {
    cursor.split('.').nth(1).unwrap().parse().unwrap()
}

/// A node with runs A, B and C, looked at once (a full look that leaves a point), then left to settle.
async fn three_runs() -> (Node, LakeDirs) {
    let n = Node::start("n1").await;
    for r in [RUN_A, RUN_B, RUN_C] {
        n.make_run(r);
    }
    // Written long enough ago that the first look's head is after them: a quiet node.
    tokio::time::sleep(SETTLE).await;
    let lake = LakeDirs::new();
    let first = pass(&n, &lake, 1).await;
    assert!(first.problems.is_empty(), "{:?}", first.problems);
    assert!(lake.point("n1").is_some(), "the first look leaves a point");
    tokio::time::sleep(SETTLE).await;
    n.take();
    (n, lake)
}

// ---------------------------------------------------------------- collect.by_changes

#[tokio::test]
async fn tc19_a_quiet_node_costs_one_feed_request_and_nothing_else() {
    let (n, lake) = three_runs().await;
    let before = lake.point("n1").unwrap();
    let out = pass(&n, &lake, 2).await;
    let log = n.take();
    assert_eq!(feed_requests(&log).len(), 1, "{log:?}");
    assert_eq!(
        log.len(),
        1,
        "no list of runs, no scopes, no file, no code: {log:?}"
    );
    assert!(out.runs.is_empty() && out.problems.is_empty(), "{out:?}");
    assert!(
        collector::ingest_selection(false, &[out]).is_none(),
        "no load into the warehouse"
    );
    let after = lake.point("n1").unwrap();
    assert!(
        cursor_ns(&after.cursor) > cursor_ns(&before.cursor),
        "the point moves to the horizon"
    );
}

#[tokio::test]
async fn tc20_tc21_one_changed_run_is_collected_and_the_others_are_not_asked_for() {
    let (n, lake) = three_runs().await;
    let before = lake.point("n1").unwrap();
    n.write(RUN_B, "metrics.json", "{\"stories\": {\"1\": \"DONE\"}}");
    tokio::time::sleep(SETTLE).await;
    let out = pass(&n, &lake, 2).await;
    let log = n.take();
    assert!(out.problems.is_empty(), "{:?}", out.problems);
    assert_eq!(
        std::fs::read(lake.file("n1", RUN_B, "metrics.json")).unwrap(),
        std::fs::read(n.dir(RUN_B).join("metrics.json")).unwrap()
    );
    assert!(
        log.iter()
            .any(|l| l.starts_with(SCOPES) && l.contains(&enc(RUN_B))),
        "{log:?}"
    );
    assert!(
        naming(&log, RUN_A).is_empty() && naming(&log, RUN_C).is_empty(),
        "runs the feed did not name were asked for: {log:?}"
    );
    assert_eq!(lists(&log), 0);
    assert!(cursor_ns(&lake.point("n1").unwrap().cursor) > cursor_ns(&before.cursor));
}

#[tokio::test]
async fn tc22_a_named_run_that_fails_leaves_the_point_and_the_next_pass_asks_from_it() {
    let (n, lake) = three_runs().await;
    let before = lake.point("n1").unwrap();
    n.write(RUN_A, "metrics.json", "{\"a\": 1}");
    n.write(RUN_B, "metrics.json", "{\"b\": 1}");
    tokio::time::sleep(SETTLE).await;
    *n.rig.fail_run.lock().unwrap() = Some(RUN_A.into());
    let out = pass(&n, &lake, 2).await;
    assert!(
        out.problems.iter().any(|p| p.contains(RUN_A)),
        "{:?}",
        out.problems
    );
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_B, "metrics.json")).unwrap(),
        "{\"b\": 1}",
        "the other run is collected"
    );
    assert_eq!(lake.point("n1").unwrap(), before, "the point does not move");
    *n.rig.fail_run.lock().unwrap() = None;
    n.take();
    let out = pass(&n, &lake, 3).await;
    let log = n.take();
    assert!(out.problems.is_empty(), "{:?}", out.problems);
    assert!(
        feed_requests(&log)[0].contains(&format!("after={}", enc(&before.cursor))),
        "asked from the old point: {log:?}"
    );
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_A, "metrics.json")).unwrap(),
        "{\"a\": 1}"
    );
}

#[tokio::test]
async fn tc23_a_node_that_drops_part_way_leaves_the_point_and_the_change_arrives_later() {
    let (n, lake) = three_runs().await;
    let before = lake.point("n1").unwrap();
    n.write(RUN_C, "metrics.json", "{\"c\": 1}");
    tokio::time::sleep(SETTLE).await;
    n.rig.dropped.store(true, Ordering::SeqCst);
    let out = pass(&n, &lake, 2).await;
    assert!(!out.problems.is_empty());
    assert_eq!(lake.point("n1").unwrap(), before);
    n.rig.dropped.store(false, Ordering::SeqCst);
    let out = pass(&n, &lake, 3).await;
    assert!(out.problems.is_empty(), "{:?}", out.problems);
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_C, "metrics.json")).unwrap(),
        "{\"c\": 1}"
    );
}

#[tokio::test]
async fn tc24_more_changes_than_a_page_are_fetched_in_parts_and_all_arrive() {
    let (n, lake) = three_runs().await;
    for i in 0..MANY_FILES {
        n.write(
            RUN_A,
            &format!("stories/01/artifacts/f{i:05}.txt"),
            &i.to_string(),
        );
    }
    tokio::time::sleep(SETTLE).await;
    let out = pass(&n, &lake, 2).await;
    let log = n.take();
    assert!(out.problems.is_empty(), "{:?}", out.problems);
    assert_eq!(
        feed_requests(&log).len(),
        FEED_PAGES_FOR_MANY,
        "{} changes in pages of {}",
        MANY_FILES,
        dbench::changes::LIMIT_DEFAULT
    );
    for i in [0, MANY_FILES / 2, MANY_FILES - 1] {
        assert_eq!(
            std::fs::read_to_string(lake.file(
                "n1",
                RUN_A,
                &format!("stories/01/artifacts/f{i:05}.txt")
            ))
            .unwrap(),
            i.to_string()
        );
    }
    let held = std::fs::read_dir(lake.file("n1", RUN_A, "stories/01/artifacts"))
        .unwrap()
        .count();
    assert_eq!(held, MANY_FILES);
}

#[tokio::test]
async fn tc25_a_reference_run_held_by_two_nodes_settles_and_is_not_copied_again() {
    let (a, b) = (Node::start("laptop").await, Node::start("quintus").await);
    for (n, finalize) in [
        (&a, "{\"score\": \"70/75\"}"),
        (&b, "{\"score\": \"70/75\", \"rescored\": true}"),
    ] {
        n.make_run(REF_RUN);
        n.write(REF_RUN, "finalize.json", finalize);
        n.write(REF_RUN, "run-status.json", FINISHED);
    }
    tokio::time::sleep(SETTLE).await;
    let lake = LakeDirs::new();
    for n in [&a, &b] {
        let out = pass_with(n, &[&a, &b], &lake, &cadence(), 1).await;
        assert!(out.problems.is_empty(), "{:?}", out.problems);
    }
    tokio::time::sleep(SETTLE).await;
    a.take();
    b.take();
    for p in 0..SHARED_PASSES {
        for n in [&a, &b] {
            let out = pass_with(n, &[&a, &b], &lake, &cadence(), 2 + p).await;
            assert!(
                out.runs.iter().all(|r| r.pulled_files == 0 && !r.changed),
                "pass {p} on {}: {out:?}",
                n.name
            );
            assert!(
                collector::ingest_selection(false, &[out]).is_none(),
                "no load into the warehouse"
            );
        }
    }
    assert!(
        naming(&a.take(), REF_RUN).is_empty() && naming(&b.take(), REF_RUN).is_empty(),
        "the shared run was asked for again"
    );
}

#[tokio::test]
async fn tc26_a_run_the_node_says_is_final_is_complete_in_the_same_pass_without_the_grace() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    let lake = LakeDirs::new();
    pass_with(&n, &[&n], &lake, &long_grace(), 1).await;
    n.write(RUN_A, "run-status.json", FINISHED);
    tokio::time::sleep(SETTLE).await;
    let out = pass_with(&n, &[&n], &lake, &long_grace(), 2).await;
    let run = out
        .runs
        .iter()
        .find(|r| r.run == RUN_A)
        .expect("named by the feed");
    assert!(run.complete, "{out:?}");
    assert!(lake.collection("n1", RUN_A).complete);
}

#[tokio::test]
async fn tc27_a_complete_run_that_changes_again_is_collected_and_reopened_when_resumed() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    n.write(RUN_A, "run-status.json", FINISHED);
    let lake = LakeDirs::new();
    pass_with(&n, &[&n], &lake, &long_grace(), 1).await;
    assert!(
        lake.collection("n1", RUN_A).complete,
        "complete after the first look"
    );
    // A resumed run: cancel and submit again with the same run id writes to the same folder.
    n.write(RUN_A, "run-status.json", STARTED);
    n.write(RUN_A, "summary.md", "# resumed\n");
    tokio::time::sleep(SETTLE).await;
    let out = pass_with(&n, &[&n], &lake, &long_grace(), 2).await;
    let run = out
        .runs
        .iter()
        .find(|r| r.run == RUN_A)
        .expect("named by the feed");
    assert!(
        !run.complete && run.changed && run.pulled_files >= 1,
        "{out:?}"
    );
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_A, "summary.md")).unwrap(),
        "# resumed\n"
    );
    assert!(!lake.collection("n1", RUN_A).complete);
}

#[tokio::test]
async fn tc28_a_finished_run_is_not_rechecked_on_a_timer() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    n.write(RUN_A, "run-status.json", FINISHED);
    tokio::time::sleep(SETTLE).await;
    let lake = LakeDirs::new();
    pass(&n, &lake, 1).await;
    n.take();
    // finished_recheck is zero: a full look would ask for the run again on every pass.
    for p in 2..5 {
        pass(&n, &lake, p).await;
    }
    assert!(naming(&n.take(), RUN_A).is_empty());
}

#[tokio::test]
async fn tc29_an_unreachable_node_keeps_its_point_and_the_others_are_collected() {
    let (a, b) = (Node::start("n1").await, Node::start("n2").await);
    a.make_run(RUN_A);
    b.make_run(RUN_B);
    let lake = LakeDirs::new();
    for n in [&a, &b] {
        pass_with(n, &[&a, &b], &lake, &cadence(), 1).await;
    }
    let before = lake.point("n2").unwrap();
    b.server.abort();
    tokio::time::sleep(SETTLE).await;
    a.write(RUN_A, "metrics.json", "{\"a\": 2}");
    tokio::time::sleep(SETTLE).await;
    let down = pass_with(&b, &[&a, &b], &lake, &cadence(), 2).await;
    assert!(
        down.problems
            .iter()
            .any(|p| p.contains("E-NODE-UNREACHABLE")),
        "{:?}",
        down.problems
    );
    assert_eq!(lake.point("n2").unwrap(), before);
    let up = pass_with(&a, &[&a, &b], &lake, &cadence(), 2).await;
    assert!(up.problems.is_empty(), "{:?}", up.problems);
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_A, "metrics.json")).unwrap(),
        "{\"a\": 2}"
    );
}

#[tokio::test]
async fn tc30_a_job_cancelled_with_no_file_written_updates_the_lake_s_job_state() {
    let n = Node::start("n1").await;
    let run = format!("combinations/{COMBINATION}/benchmarks/chpack/run-job");
    n.make_run(&run);
    assert_eq!(
        n.call(
            reqwest::Method::POST,
            "/v1/hold",
            serde_json::json!({"reason": "tc30"})
        )
        .await,
        200
    );
    let spec = serde_json::json!({"install_id": INSTALL_ID, "pack": PACK, "scope": "canvas", "run_id": "run-job", "client": "pi", "record": true});
    assert!(matches!(
        n.call(reqwest::Method::PUT, "/v1/jobs/tc30-job", spec)
            .await,
        200 | 201
    ));
    let lake = LakeDirs::new();
    pass(&n, &lake, 1).await;
    assert_eq!(
        lake.collection("n1", &run).job_state.as_deref(),
        Some("queued")
    );
    tokio::time::sleep(SETTLE).await;
    assert_eq!(
        n.call(
            reqwest::Method::POST,
            "/v1/jobs/tc30-job/cancel",
            serde_json::json!({"reason": "tc30"})
        )
        .await,
        200
    );
    tokio::time::sleep(SETTLE_JOB).await;
    pass(&n, &lake, 2).await;
    assert_eq!(
        lake.collection("n1", &run).job_state.as_deref(),
        Some("cancelled")
    );
}

/// Every file of a lake folder but the collector's own record, by relative name.
fn lake_files(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) {
        for e in std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out);
            } else if p.file_name().unwrap() != collector::COLLECTION_FILE {
                out.insert(
                    p.strip_prefix(base).unwrap().display().to_string(),
                    std::fs::read(&p).unwrap(),
                );
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(dir, dir, &mut out);
    out
}

#[tokio::test]
async fn tc31_collecting_by_changes_leaves_the_lake_a_full_look_would() {
    // A run grows as a real one does (its events, metrics, a story's records, then its final status), read by changes
    // after each step; then a fresh lake takes one full look at the final tree. Byte for byte the same.
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    let lake = LakeDirs::new();
    pass(&n, &lake, 1).await;
    let events =
        include_str!("../../../benchmarks/spec-bench/harness/fixtures/pi-smoke-events.jsonl");
    let lines: Vec<&str> = events.lines().collect();
    let mut log = String::new();
    for (step, chunk) in lines.chunks(lines.len().div_ceil(3)).enumerate() {
        for l in chunk {
            log.push_str(l);
            log.push('\n');
        }
        n.write(RUN_A, "stories/01/agent-events.jsonl", &log);
        n.write(RUN_A, "metrics.json", &format!("{{\"step\": {step}}}"));
        n.write(RUN_A, &format!("stories/01/artifacts/step-{step}.txt"), "x");
        tokio::time::sleep(SETTLE).await;
        let out = pass(&n, &lake, 2 + step as u64).await;
        assert!(out.problems.is_empty(), "{:?}", out.problems);
    }
    n.write(RUN_A, "stories/01/gate.json", "{\"passed\": true}");
    n.write(RUN_A, "run-status.json", FINISHED);
    tokio::time::sleep(SETTLE).await;
    pass(&n, &lake, 10).await;
    let fresh = LakeDirs::new();
    pass(&n, &fresh, 11).await;
    let by_changes =
        lake_files(&collector::dest_dir(&lake.store(), &lake.reference(), "n1", RUN_A).unwrap());
    let full =
        lake_files(&collector::dest_dir(&fresh.store(), &fresh.reference(), "n1", RUN_A).unwrap());
    assert_eq!(
        by_changes.keys().collect::<Vec<_>>(),
        full.keys().collect::<Vec<_>>()
    );
    assert!(by_changes == full, "same names, different bytes");
}

// ---------------------------------------------------------------- collect.full_look_fallback

#[tokio::test]
async fn tc32_first_contact_takes_head_then_a_full_look_and_keeps_head_as_the_point() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    let lake = LakeDirs::new();
    let out = pass(&n, &lake, 1).await;
    let log = n.take();
    assert_eq!(
        log.first().map(String::as_str),
        Some(&*format!(
            "{FEED}?after=head&limit={}",
            dbench::changes::LIMIT_DEFAULT
        )),
        "{log:?}"
    );
    assert_eq!(lists(&log), 1, "then the full look: {log:?}");
    assert!(
        out.notes
            .iter()
            .any(|l| l.contains("full look") && l.contains("no point")),
        "{:?}",
        out.notes
    );
    let p = lake.point("n1").unwrap();
    assert_eq!(p.node_id, n.node_id());
    assert!(p.cursor.starts_with(&format!("{}.", n.node_id())));
    assert!(lake.file("n1", RUN_A, "run.json").is_file());
}

#[tokio::test]
async fn tc33_a_write_made_during_the_full_look_arrives_with_the_next_feed_pass() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    let dir = n.dir(RUN_A);
    *n.rig.on_list.lock().unwrap() = Some(Box::new(move || {
        std::fs::write(dir.join("summary.md"), "written during the look\n").unwrap()
    }));
    let lake = LakeDirs::new();
    pass(&n, &lake, 1).await;
    tokio::time::sleep(SETTLE).await;
    pass(&n, &lake, 2).await;
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_A, "summary.md")).unwrap(),
        "written during the look\n"
    );
}

#[tokio::test]
async fn tc34_a_refused_point_is_dropped_for_a_full_look_and_a_new_point() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    let lake = LakeDirs::new();
    collector::write_point(
        &lake.state,
        "n1",
        &Point {
            cursor: "beef.1000".into(),
            node_id: "beef".into(),
            at: 1,
        },
    )
    .unwrap();
    let out = pass(&n, &lake, 1).await;
    let log = n.take();
    assert!(
        out.notes
            .iter()
            .any(|l| l.contains("full look") && l.contains("point refused")),
        "{:?}",
        out.notes
    );
    assert_eq!(lists(&log), 1, "{log:?}");
    assert_eq!(lake.point("n1").unwrap().node_id, n.node_id());
}

#[tokio::test]
async fn tc35_an_old_node_has_a_full_look_every_pass_and_no_point() {
    use axum::routing::get;
    use axum::Json;
    const OLD_RUN: &str = "combinations/f/v/x/os/m/eng-pi/benchmarks/p/r1";
    let listing = serde_json::json!({"run": OLD_RUN, "job": null, "run_state": "finished", "job_state": null, "final": true,
        "files": [{"name": "run.json", "size": 2, "mtime": 1.0, "final": true}], "streams": [], "stories": []});
    let lists_asked = Arc::new(AtomicU32::new(0));
    let asked = lists_asked.clone();
    let app = axum::Router::new()
        .route(
            LIST,
            get(move || {
                asked.fetch_add(1, Ordering::SeqCst);
                async { Json(serde_json::json!([{"run": OLD_RUN, "job": null, "run_status": null, "job_state": null}])) }
            }),
        )
        .route(SCOPES, get(move || std::future::ready(Json(listing.clone()))))
        .route(
            "/v1/runs/scope-file",
            get(|| async { ([("x-dbench-from", "0"), ("x-dbench-size", "2"), ("x-dbench-mtime", "1.0"), ("x-dbench-eof", "1"), ("x-dbench-final", "1")], "{}") }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let lake = LakeDirs::new();
    let ctx = Ctx {
        nodes: BTreeMap::from([(
            "old".to_string(),
            NodeEntry {
                url: format!("http://{addr}"),
                token: Some(TOKEN.into()),
            },
        )]),
        collect: Default::default(),
        json: false,
    };
    for now in 1..=3u64 {
        let (store, reference) = (lake.store(), lake.reference());
        let out = collector::collect_node_with(
            &ctx,
            "old",
            Lake {
                store: &store,
                reference: &reference,
            },
            &[],
            &Default::default(),
            &cadence(),
            now,
            true,
        )
        .await;
        assert!(
            out.notes
                .iter()
                .any(|l| l.contains("full look") && l.contains("no /v1/changes")),
            "pass {now}: {:?}",
            out.notes
        );
    }
    assert_eq!(lists_asked.load(Ordering::SeqCst), 3);
    assert!(lake.point("old").is_none());
    assert_eq!(
        std::fs::read(lake.file("old", OLD_RUN, "run.json")).unwrap(),
        b"{}",
        "its runs reach the lake as today"
    );
}

#[tokio::test]
async fn tc36_a_full_look_that_fails_part_way_writes_no_point() {
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    n.make_run(RUN_B);
    *n.rig.fail_run.lock().unwrap() = Some(RUN_A.into());
    let lake = LakeDirs::new();
    let out = pass(&n, &lake, 1).await;
    assert!(
        out.problems.iter().any(|p| p.contains(RUN_A)),
        "{:?}",
        out.problems
    );
    assert!(lake.point("n1").is_none());
    assert!(
        lake.file("n1", RUN_B, "run.json").is_file(),
        "the other run is kept"
    );
}

#[tokio::test]
async fn tc37_a_deleted_point_costs_one_full_look_then_feed_looks() {
    let (n, lake) = three_runs().await;
    collector::remove_point(&lake.state, "n1").unwrap();
    let out = pass(&n, &lake, 2).await;
    assert_eq!(lists(&n.take()), 1);
    assert!(
        out.notes.iter().any(|l| l.contains("no point")),
        "{:?}",
        out.notes
    );
    assert!(lake.point("n1").is_some());
    tokio::time::sleep(SETTLE).await;
    pass(&n, &lake, 3).await;
    assert_eq!(lists(&n.take()), 0);
}

// ---------------------------------------------------------------- collect.point_store

#[tokio::test]
async fn tc38_a_point_that_cannot_be_written_keeps_the_old_one_and_loses_nothing() {
    use std::os::unix::fs::PermissionsExt;
    let (n, lake) = three_runs().await;
    let before = lake.point("n1").unwrap();
    let points = lake.state.join(collector::POINTS_DIR);
    std::fs::set_permissions(&points, std::fs::Permissions::from_mode(0o555)).unwrap();
    n.write(RUN_A, "metrics.json", "{\"a\": 3}");
    tokio::time::sleep(SETTLE).await;
    let out = pass(&n, &lake, 2).await;
    assert!(
        out.problems
            .iter()
            .any(|p| p.contains(collector::E_POINT_WRITE) && p.contains("n1")),
        "{:?}",
        out.problems
    );
    assert_eq!(lake.point("n1").unwrap(), before);
    assert_eq!(
        std::fs::read_to_string(lake.file("n1", RUN_A, "metrics.json")).unwrap(),
        "{\"a\": 3}"
    );
    n.take();
    pass(&n, &lake, 3).await;
    let log = n.take();
    assert!(
        feed_requests(&log)[0].contains(&format!("after={}", enc(&before.cursor))),
        "{log:?}"
    );
}

// ---------------------------------------------------------------- story 23's owed code, under a feed

#[tokio::test]
async fn a_code_pull_owed_by_a_run_the_feed_does_not_name_is_still_retried() {
    // Story 23 (23.28): a failed code pull is retried on every pass until it succeeds. A feed look visits only the runs
    // the feed names, so the owed pull must be retried without the run changing.
    let n = Node::start("n1").await;
    n.make_run(RUN_A);
    n.write(RUN_A, "run-status.json", FINISHED);
    let tip = n.give_code(RUN_A);
    n.rig.fail_code.store(true, Ordering::SeqCst);
    tokio::time::sleep(SETTLE).await;
    let lake = LakeDirs::new();
    let first = pass(&n, &lake, 1).await;
    assert!(
        first
            .problems
            .iter()
            .any(|p| p.contains(RUN_A) && p.contains("500")),
        "{:?}",
        first.problems
    );
    let code = lake.state.join(dbench::lake_code::CODE_REPO);
    assert!(dbench::lake_code::is_pending(&code, "n1", RUN_A));
    tokio::time::sleep(SETTLE).await;
    n.rig.fail_code.store(false, Ordering::SeqCst);
    n.take();
    let out = pass(&n, &lake, 2).await;
    let log = n.take();
    assert!(out.problems.is_empty(), "{:?}", out.problems);
    assert!(
        log.iter().all(|l| !l.starts_with(SCOPES)),
        "the run itself is not visited: {log:?}"
    );
    assert!(log.iter().any(|l| l.starts_with(CODE)), "{log:?}");
    assert!(!dbench::lake_code::is_pending(&code, "n1", RUN_A));
    let out = std::process::Command::new("git")
        .arg("--git-dir")
        .arg(&code)
        .args([
            "rev-parse",
            &dbench::lake_code::head_ref("n1", RUN_A, "main"),
        ])
        .output()
        .unwrap();
    assert_eq!(String::from_utf8(out.stdout).unwrap().trim(), tip);
}

// ---------------------------------------------------------------- the equivalence classes of the data the nodes hold
//
// One case per way the harness changes a run, crossed with the kinds of file the allow-list holds (append log, whole
// record, blob, tree, egress log in the bench home, reference run). Each case keeps two lakes of the same node: one
// read through the feed, one by a full look every pass (its point removed first, so every pass is today's look). After
// the change, the two lakes hold the same files byte for byte, and the feed pass took no full look.

const RESCORE_FILE: &str = "rescore/2026.11.1/rescore.json";
const SPOILED_FILE: &str = "rescore-spoiled/2026.11.1-20261108T020000/rescore.json";
const COMPACT: &str = "stories/01/agent-events.compact.jsonl.gz";
const EVENTS: &str = "stories/01/agent-events.jsonl";
const ARTIFACT: &str = "stories/01/artifacts/a.txt";
/// The run that appears only after the point.
const RUN_NEW: &str = "combinations/kat/1/tiny/linux/box/fake-pi/benchmarks/chpack/run-new";
const A_YEAR_AGO: Duration = Duration::from_secs(365 * 24 * 3_600);

struct Twin {
    feed: LakeDirs,
    full: LakeDirs,
}

impl Node {
    fn egress(&self) -> PathBuf {
        self.shared
            .cfg
            .bench_home
            .join(dbench::collect::EGRESS_DIR)
            .join("work.jsonl")
    }

    /// RUN_A with one file of every kind, and the reference run.
    fn full_run(&self) {
        self.make_run(RUN_A);
        self.write(RUN_A, EVENTS, "{\"e\":1}\n{\"e\":2}\n");
        self.write(RUN_A, dbench::collect::SERVER_LOG, "line 1\n");
        self.write(RUN_A, COMPACT, "gz-v1");
        self.write(RUN_A, ARTIFACT, "a");
        self.write(RUN_A, RESCORE_FILE, "{\"results\": []}");
        std::fs::create_dir_all(self.egress().parent().unwrap()).unwrap();
        std::fs::write(self.egress(), "{\"host\":\"a\"}\n").unwrap();
        self.make_run(REF_RUN);
        self.write(REF_RUN, "finalize.json", "{\"score\": \"70/75\"}");
    }

    fn append(&self, path: &Path, text: &str) {
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .unwrap()
            .write_all(text.as_bytes())
            .unwrap();
    }
}

/// Every file of the node's lake folders (own runs and reference runs) but the collector's records.
fn whole_lake(l: &LakeDirs) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    for (tag, dir) in [("store", l.store()), ("reference", l.reference())] {
        if dir.exists() {
            for (k, v) in lake_files(&dir) {
                out.insert(format!("{tag}/{k}"), v);
            }
        }
    }
    out
}

/// One pass of each lake: the feed lake from its point, the other with a full look.
async fn twin_pass(n: &Node, t: &Twin, now: u64) -> Vec<String> {
    n.take();
    let f = pass(n, &t.feed, now).await;
    assert!(f.problems.is_empty(), "feed: {:?}", f.problems);
    let feed_log = n.take();
    collector::remove_point(&t.full.state, &n.name).unwrap();
    let g = pass(n, &t.full, now).await;
    assert!(g.problems.is_empty(), "full: {:?}", g.problems);
    n.take();
    feed_log
}

/// A node holding every kind of file, both lakes after their first look, and the feed lake with a point.
async fn twin() -> (Node, Twin) {
    let n = Node::start("n1").await;
    n.full_run();
    tokio::time::sleep(SETTLE).await;
    let t = Twin {
        feed: LakeDirs::new(),
        full: LakeDirs::new(),
    };
    twin_pass(&n, &t, 1).await;
    assert!(t.feed.point("n1").is_some());
    tokio::time::sleep(SETTLE).await;
    (n, t)
}

/// After `change`, a feed pass leaves the lake a full look leaves, without a full look of its own.
async fn same_after(case: &str, n: &Node, t: &Twin) {
    tokio::time::sleep(SETTLE).await;
    let log = twin_pass(n, t, 2).await;
    assert_eq!(
        lists(&log),
        0,
        "{case}: the feed pass took a full look: {log:?}"
    );
    let (feed, full) = (whole_lake(&t.feed), whole_lake(&t.full));
    assert_eq!(
        feed.keys().collect::<Vec<_>>(),
        full.keys().collect::<Vec<_>>(),
        "{case}: the lakes hold different files"
    );
    for (k, v) in &full {
        assert!(feed[k] == *v, "{case}: {k} differs");
    }
}

#[tokio::test]
async fn eq01_an_append_log_in_a_story_grows() {
    let (n, t) = twin().await;
    n.append(&n.dir(RUN_A).join(EVENTS), "{\"e\":3}\n");
    same_after("story log grows", &n, &t).await;
}

#[tokio::test]
async fn eq02_an_append_log_of_the_run_grows() {
    let (n, t) = twin().await;
    n.append(&n.dir(RUN_A).join(dbench::collect::SERVER_LOG), "line 2\n");
    same_after("server log grows", &n, &t).await;
}

#[tokio::test]
async fn eq03_an_append_log_is_rewritten_shorter() {
    let (n, t) = twin().await;
    n.write(RUN_A, EVENTS, "{\"e\":9}\n");
    same_after("story log shrinks", &n, &t).await;
}

#[tokio::test]
async fn eq04_the_egress_log_in_the_bench_home_grows() {
    let (n, t) = twin().await;
    n.append(&n.egress(), "{\"host\":\"b\"}\n");
    same_after("egress log grows", &n, &t).await;
}

#[tokio::test]
async fn eq05_a_whole_record_is_rewritten() {
    let (n, t) = twin().await;
    n.write(RUN_A, "metrics.json", "{\"stories\": {\"1\": \"DONE\"}}");
    same_after("metrics rewritten", &n, &t).await;
}

#[tokio::test]
async fn eq06_a_blob_is_replaced_by_a_rename_into_place() {
    let (n, t) = twin().await;
    let staged = n.dir(RUN_A).join("stories/01/.compact.new");
    std::fs::write(&staged, "gz-v2-longer").unwrap();
    std::fs::rename(&staged, n.dir(RUN_A).join(COMPACT)).unwrap();
    same_after("blob replaced", &n, &t).await;
}

#[tokio::test]
async fn eq07_a_record_is_copied_in_keeping_a_year_old_mtime() {
    let (n, t) = twin().await;
    let p = n.dir(RUN_A).join("metrics.json");
    std::fs::write(&p, "{\"stories\": {\"1\": \"PARTIAL\"}}").unwrap();
    let old = std::time::SystemTime::now() - A_YEAR_AGO;
    std::fs::File::options()
        .write(true)
        .open(&p)
        .unwrap()
        .set_modified(old)
        .unwrap();
    same_after("copy keeping an old mtime", &n, &t).await;
}

#[tokio::test]
async fn eq08_a_tree_gains_a_file_in_a_new_story() {
    let (n, t) = twin().await;
    n.write(RUN_A, "stories/02/artifacts/b.txt", "b");
    n.write(RUN_A, "stories/02/gate.json", "{\"passed\": false}");
    same_after("new story", &n, &t).await;
}

#[tokio::test]
async fn eq09_a_rescore_is_set_aside_with_its_reason_as_the_harness_does() {
    // finalize.set_aside: rename rescore/<v> to rescore-spoiled/<v>-<time>, then write set-aside.json in it.
    let (n, t) = twin().await;
    let d = n.dir(RUN_A);
    let dest = d.join(SPOILED_FILE);
    std::fs::create_dir_all(dest.parent().unwrap().parent().unwrap()).unwrap();
    std::fs::rename(
        d.join(RESCORE_FILE).parent().unwrap(),
        dest.parent().unwrap(),
    )
    .unwrap();
    std::fs::write(
        dest.parent().unwrap().join("set-aside.json"),
        "{\"reason\": \"x\"}",
    )
    .unwrap();
    same_after("rescore set aside with a reason", &n, &t).await;
}

#[tokio::test]
async fn eq10_a_folder_is_renamed_and_nothing_else_is_written() {
    let (n, t) = twin().await;
    let d = n.dir(RUN_A);
    let dest = d.join(SPOILED_FILE);
    std::fs::create_dir_all(dest.parent().unwrap().parent().unwrap()).unwrap();
    std::fs::rename(
        d.join(RESCORE_FILE).parent().unwrap(),
        dest.parent().unwrap(),
    )
    .unwrap();
    same_after("folder renamed alone", &n, &t).await;
}

#[tokio::test]
async fn eq11_a_file_is_deleted() {
    let (n, t) = twin().await;
    std::fs::remove_file(n.dir(RUN_A).join(ARTIFACT)).unwrap();
    same_after("file deleted", &n, &t).await;
}

#[tokio::test]
async fn eq12_a_new_run_starts_after_the_point() {
    let (n, t) = twin().await;
    n.make_run(RUN_NEW);
    n.write(RUN_NEW, EVENTS, "{\"e\":1}\n");
    same_after("new run", &n, &t).await;
}

#[tokio::test]
async fn eq13_a_run_becomes_this_node_s_after_its_records_were_written() {
    // run.sh writes run.json and the run's status; drive.py writes work_dir.txt only after setting up the workspace.
    let (n, t) = twin().await;
    let d = n.dir(RUN_NEW);
    std::fs::create_dir_all(d.join("stories/01")).unwrap();
    std::fs::write(d.join("run.json"), "{\"run\": \"new\"}").unwrap();
    std::fs::write(d.join("run-status.json"), STARTED).unwrap();
    tokio::time::sleep(SETTLE).await;
    twin_pass(&n, &t, 2).await;
    std::fs::write(
        d.join("work_dir.txt"),
        n.root.join("work").display().to_string(),
    )
    .unwrap();
    same_after("run marker written last", &n, &t).await;
}

#[tokio::test]
async fn eq14_a_reference_run_gains_a_record() {
    let (n, t) = twin().await;
    n.write(REF_RUN, "metrics.json", "{\"stories\": {\"1\": \"DONE\"}}");
    same_after("reference run record", &n, &t).await;
}
