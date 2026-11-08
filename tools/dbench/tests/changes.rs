//! Story 24 (node.changes_feed), TC-08 to TC-12: `GET /v1/changes` through the real `dbench serve`.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use dbench::changes::{E_BAD_CURSOR, E_BAD_LIMIT, E_CURSOR_REFUSED, LIMIT_MAX, NOW_ENV, SETTLE_MARGIN_NS};

const INSTALL_ID: &str = "ch-install";
const COMBINATION: &str = "test/combo/ch";
const PACK: &str = "benchmarks/chpack";
const RUN_ID: &str = "run-1";
const RUN: &str = "combinations/test/combo/ch/benchmarks/chpack/run-1";
const OK: u16 = 200;
const BAD_REQUEST: u16 = 400;
const CONFLICT: u16 = 409;
const SERVER_STOP_DEADLINE: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(100);
/// Longer than the settle margin plus the job store's one-second stamps: a change made now is past the horizon by then.
const PAST_HORIZON: Duration = Duration::from_millis(3_500);
const NS_PER_MS: i64 = 1_000_000;
/// A clock moved back to 1970: every cursor this node gave is after it.
const CLOCK_MOVED_BACK_MS: &str = "1000";

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

/// A checkout with one combination, its install, and one run this node ran (run.json and work_dir.txt).
fn node() -> Node {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-changes-it-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let repo = root.join("repo");
    let comb = repo.join("combinations").join(COMBINATION);
    std::fs::create_dir_all(&comb).unwrap();
    std::fs::write(comb.join("config.sh"), format!("INSTALL_ID=\"{INSTALL_ID}\"\n")).unwrap();
    // The pack's own entry point, so a job for it is accepted; the node is held in TC-12, so it never runs.
    std::fs::create_dir_all(repo.join(PACK).join("harness")).unwrap();
    std::fs::write(repo.join(PACK).join("harness/run.sh"), "#!/bin/sh\nexit 0\n").unwrap();
    let share = root.join("userhome/.local/share");
    std::fs::create_dir_all(share.join(INSTALL_ID)).unwrap();
    std::fs::write(
        share.join(INSTALL_ID).join("install.env"),
        format!("INSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\n"),
    )
    .unwrap();
    let run = repo.join(RUN);
    std::fs::create_dir_all(run.join("stories/01")).unwrap();
    std::fs::write(run.join("run.json"), "{}").unwrap();
    std::fs::write(run.join("work_dir.txt"), root.join("work").display().to_string()).unwrap();
    std::fs::write(run.join("metrics.json"), "{}").unwrap();
    Node { home: root.join("dbench-home"), repo, share, root }
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

fn serve(node: &Node, env: &[(&str, &str)]) -> Server {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_dbench"));
    cmd.args(["serve", "--bind", "127.0.0.1:0", "--no-pull", "--allow-unreleased"])
        .arg("--repo")
        .arg(&node.repo)
        .arg("--home")
        .arg(&node.home)
        .arg("--share-dir")
        .arg(&node.share)
        .env("HOME", node.share.parent().unwrap().parent().unwrap())
        .env_remove(NOW_ENV)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().expect("spawn dbench");
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let addr = line.trim().strip_prefix(dbench::server::LISTENING_PREFIX).unwrap_or_else(|| panic!("{line:?}")).to_string();
    let token = std::fs::read_to_string(node.home.join("token")).unwrap().trim().to_string();
    Server { child, base: format!("http://{addr}"), token, http: reqwest::Client::new() }
}

impl Server {
    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> (u16, Value) {
        let mut r = self.http.request(method, format!("{}{path}", self.base)).bearer_auth(&self.token);
        if let Some(b) = body {
            r = r.json(&b);
        }
        let r = r.send().await.unwrap();
        let code = r.status().as_u16();
        let text = r.text().await.unwrap();
        (code, serde_json::from_str(&text).unwrap_or(Value::String(text)))
    }
    async fn changes(&self, query: &str) -> (u16, Value) {
        self.call(reqwest::Method::GET, &format!("/v1/changes?{query}"), None).await
    }
    async fn page(&self, query: &str) -> Value {
        let (code, v) = self.changes(query).await;
        assert_eq!(code, OK, "{query}: {v}");
        v
    }
}

fn now_ns() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos() as i64
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// The time part of a cursor, ns.
fn cursor_ns(cursor: &str) -> i64 {
    cursor.split('.').nth(1).unwrap().parse().unwrap()
}

#[tokio::test]
async fn tc08_head_lists_nothing_and_gives_the_horizon() {
    let n = node();
    let srv = serve(&n, &[]);
    let before = now_ns();
    let p = srv.page("after=head").await;
    let after = now_ns();
    assert_eq!(p["changes"], json!([]));
    assert_eq!(p["runs"], json!([]));
    assert_eq!(p["more"], json!(false));
    let id = p["node_id"].as_str().unwrap();
    let next = p["next"].as_str().unwrap();
    assert!(next.starts_with(&format!("{id}.")), "{p}");
    let ns = cursor_ns(next);
    assert!(before - SETTLE_MARGIN_NS <= ns && ns <= after - SETTLE_MARGIN_NS, "{ns} not 2 s behind the clock");
    assert_eq!(srv.page("after=head").await["node_id"], json!(id), "the node id is made once");
}

#[tokio::test]
async fn tc09_a_cursor_from_another_node_is_refused() {
    let n = node();
    let srv = serve(&n, &[]);
    let (code, v) = srv.changes(&format!("after={}", enc("beef.1000"))).await;
    assert_eq!(code, CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains(E_CURSOR_REFUSED), "{v}");
}

#[tokio::test]
async fn tc10_a_cursor_after_the_node_s_clock_is_refused() {
    let n = node();
    let cursor = {
        let srv = serve(&n, &[]);
        srv.page("after=head").await["next"].as_str().unwrap().to_string()
    };
    let srv = serve(&n, &[(NOW_ENV, CLOCK_MOVED_BACK_MS)]);
    let (code, v) = srv.changes(&format!("after={}", enc(&cursor))).await;
    assert_eq!(code, CONFLICT, "{v}");
    assert!(v["error"].as_str().unwrap().contains(E_CURSOR_REFUSED), "{v}");
}

#[tokio::test]
async fn tc11_a_bad_cursor_or_limit_is_a_bad_request() {
    let n = node();
    let srv = serve(&n, &[]);
    let id = srv.page("after=head").await["node_id"].as_str().unwrap().to_string();
    for (query, code_word) in [
        ("after=nodot".to_string(), E_BAD_CURSOR),
        (format!("after={}", enc(&format!("{id}.notanumber"))), E_BAD_CURSOR),
        ("limit=10".to_string(), E_BAD_CURSOR),
        ("after=head&limit=0".to_string(), E_BAD_LIMIT),
        (format!("after=head&limit={}", LIMIT_MAX + 1), E_BAD_LIMIT),
        ("after=head&limit=many".to_string(), E_BAD_LIMIT),
    ] {
        let (code, v) = srv.changes(&query).await;
        assert_eq!(code, BAD_REQUEST, "{query}: {v}");
        assert!(v["error"].as_str().unwrap_or_default().contains(code_word), "{query}: {v}");
    }
    let (code, v) = srv.changes(&format!("after=head&limit={LIMIT_MAX}")).await;
    assert_eq!(code, OK, "the largest limit is allowed: {v}");
}

#[tokio::test]
async fn tc12_a_job_cancelled_with_no_file_written_lists_its_run_with_the_new_state() {
    let n = node();
    let srv = serve(&n, &[]);
    let (code, v) = srv.call(reqwest::Method::POST, "/v1/hold", Some(json!({"reason": "tc12"}))).await;
    assert_eq!(code, OK, "{v}");
    let spec = json!({"install_id": INSTALL_ID, "pack": PACK, "scope": "canvas", "run_id": RUN_ID, "client": "pi", "record": true});
    let (code, v) = srv.call(reqwest::Method::PUT, "/v1/jobs/tc12-job", Some(spec)).await;
    assert!(code == OK || code == 201, "{code}: {v}");
    std::thread::sleep(PAST_HORIZON);
    let cursor = srv.page("after=head").await["next"].as_str().unwrap().to_string();
    let (code, v) = srv.call(reqwest::Method::POST, "/v1/jobs/tc12-job/cancel", Some(json!({"reason": "tc12"}))).await;
    assert_eq!(code, OK, "{v}");
    std::thread::sleep(PAST_HORIZON);
    let p = srv.page(&format!("after={}", enc(&cursor))).await;
    assert_eq!(p["changes"], json!([]), "no file was written: {p}");
    let runs = p["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 1, "{p}");
    assert_eq!(runs[0]["run"], json!(RUN));
    assert_eq!(runs[0]["job"], json!("tc12-job"));
    assert_eq!(runs[0]["job_state"], json!("cancelled"));
    assert_eq!(runs[0]["final"], json!(true), "a cancelled job's run is final");
    assert!(runs[0]["changed_ms"].as_i64().unwrap() * NS_PER_MS > cursor_ns(&cursor));
}
