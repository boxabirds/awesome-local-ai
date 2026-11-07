//! Story 23 (node.own_runs), TC-02 to TC-05: the real `dbench serve` offers only the runs this node ran.
//!
//! A run is this node's when its folder holds `work_dir.txt`, which the harness writes and git never carries. A copy
//! of another machine's run that git brought into the checkout has the records and no note: it is neither listed nor
//! served. The old `workspace.bundle` is not offered even in a run of this node's own.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

const INSTALL_ID: &str = "own-install";
const REF_INSTALL_ID: &str = "own-ref";
const COMBINATION: &str = "test/combo/own";
const RUN_BASE: &str = "benchmarks/reference/ownpack/opus";
/// A run this node ran.
const OWN_RUN: &str = "combinations/test/combo/own/benchmarks/ownpack/run-own";
/// The same combination's run from another machine, carried here by git.
const CARRIED_RUN: &str = "combinations/test/combo/own/benchmarks/ownpack/run-carried";
/// A reference run this node ran, filed under its stack's RUN_BASE.
const OWN_REF_RUN: &str = "benchmarks/reference/ownpack/opus/run-1";
/// A reference run of the same stack from another machine, carried here by git.
const CARRIED_REF_RUN: &str = "benchmarks/reference/ownpack/opus/run-2";
const RUN_MARKER: &str = "run.json";
const WORK_DIR_FILE: &str = "work_dir.txt";
const BUNDLE_FILE: &str = "workspace.bundle";
const METRICS_FILE: &str = "metrics.json";
const NOT_FOUND: u16 = 404;
const OK: u16 = 200;
const SERVER_STOP_DEADLINE: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(100);

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Node {
    root: PathBuf,
    repo: PathBuf,
    share: PathBuf,
    home: PathBuf,
}

impl Drop for Node {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A checkout with one combination and one reference stack, and no runs yet.
fn node() -> Node {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-own-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let repo = root.join("repo");
    let comb = repo.join("combinations").join(COMBINATION);
    std::fs::create_dir_all(&comb).unwrap();
    std::fs::write(
        comb.join("config.sh"),
        format!("INSTALL_ID=\"{INSTALL_ID}\"\n"),
    )
    .unwrap();
    let share = root.join("userhome/.local/share");
    std::fs::create_dir_all(share.join(INSTALL_ID)).unwrap();
    std::fs::write(
        share.join(INSTALL_ID).join("install.env"),
        format!("INSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\n"),
    )
    .unwrap();
    std::fs::create_dir_all(share.join(REF_INSTALL_ID)).unwrap();
    std::fs::write(
        share.join(REF_INSTALL_ID).join("install.env"),
        format!("INSTALL_ID=\"{REF_INSTALL_ID}\"\nRUN_BASE=\"{RUN_BASE}\"\n"),
    )
    .unwrap();
    Node {
        home: root.join("dbench-home"),
        repo,
        share,
        root,
    }
}

/// A run folder with its records; `own` adds the work-folder note the harness writes on the machine that ran it.
fn run(node: &Node, rel: &str, own: bool) -> PathBuf {
    let dir = node.repo.join(rel);
    std::fs::create_dir_all(dir.join("stories/01")).unwrap();
    std::fs::write(dir.join(RUN_MARKER), "{}").unwrap();
    std::fs::write(dir.join(METRICS_FILE), "{}").unwrap();
    if own {
        std::fs::write(dir.join(WORK_DIR_FILE), "/home/x/.w/run\n").unwrap();
    }
    dir
}

struct Server {
    child: Child,
    base: String,
    token: String,
    http: reqwest::Client,
}

impl Drop for Server {
    fn drop(&mut self) {
        // SAFETY: kill(2) on our own child's pid; SIGTERM so a coverage profile is written.
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) };
        let start = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && start.elapsed() < SERVER_STOP_DEADLINE {
            std::thread::sleep(POLL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn serve(node: &Node) -> Server {
    let mut child = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args([
            "serve",
            "--bind",
            "127.0.0.1:0",
            "--no-pull",
            "--allow-unreleased",
        ])
        .arg("--repo")
        .arg(&node.repo)
        .arg("--home")
        .arg(&node.home)
        .arg("--share-dir")
        .arg(&node.share)
        .env("HOME", node.share.parent().unwrap().parent().unwrap())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn dbench");
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let addr = line
        .trim()
        .strip_prefix(dbench::server::LISTENING_PREFIX)
        .unwrap_or_else(|| panic!("{line:?}"))
        .to_string();
    let token = std::fs::read_to_string(node.home.join("token"))
        .unwrap()
        .trim()
        .to_string();
    Server {
        child,
        base: format!("http://{addr}"),
        token,
        http: reqwest::Client::new(),
    }
}

impl Server {
    async fn get(&self, path: &str) -> (u16, String) {
        let r = self
            .http
            .get(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .unwrap();
        (r.status().as_u16(), r.text().await.unwrap())
    }
    async fn json(&self, path: &str) -> Value {
        let (code, body) = self.get(path).await;
        assert_eq!(code, OK, "{path}: {body}");
        serde_json::from_str(&body).unwrap()
    }
    async fn listed(&self) -> Vec<String> {
        let v = self.json("/v1/runs").await;
        v.as_array()
            .unwrap()
            .iter()
            .map(|r| r["run"].as_str().unwrap().to_string())
            .collect()
    }
}

/// Every route that serves one run's files answers 404, naming the run.
async fn assert_not_served(srv: &Server, rel: &str) {
    for path in [
        format!("/v1/runs/files?run={rel}"),
        format!("/v1/runs/file?run={rel}&name={METRICS_FILE}"),
        format!("/v1/runs/scopes?run={rel}"),
    ] {
        let (code, body) = srv.get(&path).await;
        assert_eq!(code, NOT_FOUND, "{path}: {body}");
        assert!(
            body.contains(&format!("no run {rel} on this node")),
            "{path}: {body}"
        );
    }
}

fn names(manifest: &Value) -> Vec<String> {
    manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap().to_string())
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn tc02_a_run_git_carried_here_is_neither_listed_nor_served() {
    let n = node();
    run(&n, OWN_RUN, true);
    run(&n, CARRIED_RUN, false);
    let srv = serve(&n);
    assert_eq!(srv.listed().await, [OWN_RUN]);
    assert_not_served(&srv, CARRIED_RUN).await;
    assert!(
        names(&srv.json(&format!("/v1/runs/files?run={OWN_RUN}")).await)
            .contains(&METRICS_FILE.to_string())
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn tc03_a_reference_run_is_offered_only_by_the_node_that_ran_it() {
    let n = node();
    run(&n, OWN_REF_RUN, true);
    run(&n, CARRIED_REF_RUN, false);
    let srv = serve(&n);
    assert_eq!(srv.listed().await, [OWN_REF_RUN]);
    assert_not_served(&srv, CARRIED_REF_RUN).await;
    let (code, body) = srv
        .get(&format!(
            "/v1/runs/file?run={OWN_REF_RUN}&name={METRICS_FILE}"
        ))
        .await;
    assert_eq!((code, body.as_str()), (OK, "{}"));
}

#[tokio::test(flavor = "multi_thread")]
async fn tc04_a_node_that_ran_nothing_lists_nothing_and_says_so_with_200() {
    let n = node();
    // Records git carried from other machines are all it holds.
    run(&n, CARRIED_RUN, false);
    run(&n, CARRIED_REF_RUN, false);
    let srv = serve(&n);
    assert_eq!(srv.json("/v1/runs").await, json!([]));
}

#[tokio::test(flavor = "multi_thread")]
async fn tc05_an_old_workspace_bundle_in_an_own_run_is_not_offered() {
    let n = node();
    let dir = run(&n, OWN_RUN, true);
    std::fs::write(dir.join(BUNDLE_FILE), b"bundle bytes").unwrap();
    let srv = serve(&n);
    let m = srv.json(&format!("/v1/runs/files?run={OWN_RUN}")).await;
    assert!(!names(&m).contains(&BUNDLE_FILE.to_string()), "{m}");
    assert!(
        !m["unlisted"].to_string().contains(BUNDLE_FILE),
        "{}",
        m["unlisted"]
    );
    let (code, body) = srv
        .get(&format!("/v1/runs/file?run={OWN_RUN}&name={BUNDLE_FILE}"))
        .await;
    assert_ne!(code, OK, "{body}");
}
