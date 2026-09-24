//! End-to-end: the real `dbench serve` binary against a temp repo with fake packs.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

const DEADLINE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(100);
const MAX_RESTARTS: u32 = 2;
const BACKOFF_MS: &str = "100";
const GRACE_MS: &str = "1000";
const INSTALL_ID: &str = "fake-install";
const COMBINATION: &str = "test/combo/fake";
const SIGTERM_EXIT: i32 = 128 + libc::SIGTERM;
const SIGKILL_EXIT: i32 = 128 + libc::SIGKILL;

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct TempRoot(PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

const HEADER: &str = r#"#!/usr/bin/env bash
set -euo pipefail
INSTALL_ID="$1"; shift
RUN_ID=""; SCOPE=""; CLIENT=""; RECORD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id) RUN_ID="$2"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --client) CLIENT="$2"; shift 2 ;;
    --only) shift 2 ;;
    --record) RECORD=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
COMBINATION="$(sed -n 's/^COMBINATION="\(.*\)"/\1/p' "$HOME/.local/share/$INSTALL_ID/install.env")"
RUN_DIR="$PWD/combinations/$COMBINATION/benchmarks/$(basename "$(dirname "$(dirname "$0")")")/$RUN_ID"
mkdir -p "$RUN_DIR"
echo "path-head: ${PATH%%:*}"
echo "args: $INSTALL_ID $RUN_ID $SCOPE $CLIENT $RECORD"
"#;

const FAKE_BODY: &str = r#"echo "[story 1] Fake story one — agent starting"
echo "[story 1] agent done in 1.5s; running gates"
echo "[story 1] gate green=True accept 3/4 stalled=False"
echo 2 > "$RUN_DIR/current_story"
cat > "$RUN_DIR/metrics.json" <<'EOF'
{"stories": {"1": {"title": "Fake story one", "accept": {"passed": 3, "total": 4}}, "2": {"title": "Fake story two"}}}
EOF
exit 0
"#;

const FAIL_BODY: &str = r#"echo "[story 1] Crashy story — agent starting"
echo "Traceback (most recent call last):"
echo '  File "drive.py", line 1, in <module>'
echo "RuntimeError: fake crash"
exit 1
"#;

const SLOW_BODY: &str = r#"echo "[story 1] Slow story — agent starting"
sleep 300 &
echo "sleep-pid: $!"
wait
"#;

/// Ignores SIGTERM (and so does its sleep, which inherits the ignore): only SIGKILL stops it.
const STUBBORN_BODY: &str = r#"trap '' TERM
echo "[story 1] Stubborn story — agent starting"
sleep 300 &
echo "sleep-pid: $!"
wait
"#;

struct Env {
    root: TempRoot,
    repo: PathBuf,
    home: PathBuf,
    user_home: PathBuf,
    bin: PathBuf,
}

fn setup() -> Env {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-it-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let repo = root.join("repo");
    for (pack, body) in [
        ("fakepack", FAKE_BODY),
        ("failpack", FAIL_BODY),
        ("slowpack", SLOW_BODY),
        ("stubbornpack", STUBBORN_BODY),
    ] {
        let dir = repo.join(pack).join("harness");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.sh"), format!("{HEADER}{body}")).unwrap();
    }
    let user_home = root.join("userhome");
    let share = user_home.join(".local/share").join(INSTALL_ID);
    std::fs::create_dir_all(&share).unwrap();
    std::fs::write(
        share.join("install.env"),
        format!("# fake\nINSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\nBACKEND=\"fake\"\n"),
    )
    .unwrap();
    let bin = root.join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    Env {
        home: root.join("dbench-home"),
        repo,
        user_home,
        bin,
        root: TempRoot(root),
    }
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
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start(env: &Env, pull: bool) -> Server {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_dbench"));
    cmd.args(["serve", "--bind", "127.0.0.1:0"])
        .arg("--repo")
        .arg(&env.repo)
        .arg("--home")
        .arg(&env.home)
        .arg("--share-dir")
        .arg(env.user_home.join(".local/share"))
        .arg("--path-prepend")
        .arg(&env.bin)
        .args(["--max-restarts", &MAX_RESTARTS.to_string()])
        .args([
            "--restart-backoff-ms",
            BACKOFF_MS,
            "--cancel-grace-ms",
            GRACE_MS,
        ])
        .env("HOME", &env.user_home)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    if !pull {
        cmd.arg("--no-pull");
    }
    let mut child = cmd.spawn().expect("spawn dbench");
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    let addr = line
        .trim()
        .strip_prefix(dbench::server::LISTENING_PREFIX)
        .unwrap_or_else(|| panic!("{line:?}"))
        .to_string();
    let token = std::fs::read_to_string(env.home.join("token"))
        .unwrap()
        .trim()
        .to_string();
    Server {
        child,
        _stdout: stdout,
        base: format!("http://{addr}"),
        token,
        http: reqwest::Client::new(),
    }
}

impl Server {
    async fn call(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> (u16, Value) {
        let mut rb = self
            .http
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(&self.token);
        if let Some(b) = body {
            rb = rb.json(&b);
        }
        let resp = rb.send().await.unwrap();
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap();
        (
            status,
            serde_json::from_str(&text).unwrap_or(Value::String(text)),
        )
    }
    async fn get(&self, path: &str) -> Value {
        let (s, v) = self.call(reqwest::Method::GET, path, None).await;
        assert_eq!(s, 200, "{path}: {v}");
        v
    }
    async fn submit(&self, id: &str, spec: &Value) -> (u16, Value) {
        self.call(
            reqwest::Method::PUT,
            &format!("/v1/jobs/{id}"),
            Some(spec.clone()),
        )
        .await
    }
    async fn cancel(&self, id: &str) -> (u16, Value) {
        self.call(
            reqwest::Method::POST,
            &format!("/v1/jobs/{id}/cancel"),
            None,
        )
        .await
    }
    async fn log(&self, id: &str) -> String {
        let r = self
            .http
            .get(format!("{}/v1/jobs/{id}/log", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .unwrap();
        r.text().await.unwrap()
    }
    async fn wait_for(&self, id: &str, what: &str, pred: impl Fn(&Value) -> bool) -> Value {
        let start = Instant::now();
        loop {
            let v = self.get(&format!("/v1/jobs/{id}")).await;
            if pred(&v) {
                return v;
            }
            assert!(
                start.elapsed() < DEADLINE,
                "timed out waiting for {id} to be {what}: {v:#}"
            );
            tokio::time::sleep(POLL).await;
        }
    }
    async fn wait_status(&self, id: &str, status: &str) -> Value {
        self.wait_for(id, status, |v| v["state"]["status"] == status)
            .await
    }
}

fn spec(pack: &str, run_id: &str) -> Value {
    json!({"install_id": INSTALL_ID, "pack": pack, "scope": "canvas", "run_id": run_id, "client": "pi", "record": true})
}

fn group_alive(pgid: i32) -> bool {
    unsafe { libc::kill(-pgid, 0) == 0 }
}
fn pid_alive(pid: i32) -> bool {
    unsafe { libc::kill(pid, 0) == 0 }
}

fn logged_pid(log: &str, key: &str) -> i32 {
    log.lines()
        .find_map(|l| l.strip_prefix(key))
        .unwrap_or_else(|| panic!("no {key} in {log}"))
        .trim()
        .parse()
        .unwrap()
}

async fn wait_until(what: &str, f: impl Fn() -> bool) {
    let start = Instant::now();
    while !f() {
        assert!(start.elapsed() < DEADLINE, "timed out waiting for {what}");
        tokio::time::sleep(POLL).await;
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn submit_run_done_log_events_progress_and_idempotence() {
    let env = setup();
    let srv = start(&env, true); // pull on: the temp repo is not a git repo, so the pull fails

    // Auth: health is open, everything else needs the token.
    let health = srv
        .http
        .get(format!("{}/v1/health", srv.base))
        .send()
        .await
        .unwrap();
    assert_eq!(health.status(), 200);
    let anon = srv
        .http
        .get(format!("{}/v1/jobs", srv.base))
        .send()
        .await
        .unwrap();
    assert_eq!(anon.status(), 401);
    let wrong = srv
        .http
        .get(format!("{}/v1/jobs", srv.base))
        .bearer_auth("nope")
        .send()
        .await
        .unwrap();
    assert_eq!(wrong.status(), 401);
    let mode = std::os::unix::fs::PermissionsExt::mode(
        &std::fs::metadata(env.home.join("token"))
            .unwrap()
            .permissions(),
    );
    assert_eq!(mode & 0o777, 0o600);

    // Validation.
    assert_eq!(srv.submit("bad id", &spec("fakepack", "r1")).await.0, 400);
    assert_eq!(srv.submit("...", &spec("fakepack", "r1")).await.0, 400); // ".." itself is normalised away by the URL parser
    assert_eq!(srv.submit("j", &spec("fakepack", "a/b")).await.0, 400);
    assert_eq!(srv.submit("j", &spec("nopack", "r1")).await.0, 400);
    assert_eq!(srv.submit("j", &spec("../etc", "r1")).await.0, 400);
    let mut missing = spec("fakepack", "r1");
    missing["install_id"] = json!("not-installed");
    assert_eq!(srv.submit("j", &missing).await.0, 400);
    let mut extra = spec("fakepack", "r1");
    extra["command"] = json!("rm -rf /");
    assert_eq!(
        srv.submit("j", &extra).await.0,
        422,
        "unknown fields are rejected"
    );

    // Submit, run, done.
    let (s, v) = srv.submit("job-1", &spec("fakepack", "run-1")).await;
    assert_eq!(s, 201, "{v}");
    let v = srv.wait_status("job-1", "done").await;
    assert_eq!(v["state"]["exit_code"], 0);
    assert_eq!(v["attempt"], 1);
    assert_eq!(v["last_pull"]["ok"], false, "{v:#}");

    // Repeat submits.
    assert_eq!(srv.submit("job-1", &spec("fakepack", "run-1")).await.0, 200);
    let mut different = spec("fakepack", "run-1");
    different["record"] = json!(false);
    assert_eq!(srv.submit("job-1", &different).await.0, 409);

    // Progress from the run dir.
    let p = &v["progress"];
    assert_eq!(p["combination"], COMBINATION);
    let run_dir = env
        .repo
        .join("combinations")
        .join(COMBINATION)
        .join("benchmarks/fakepack/run-1");
    assert_eq!(p["run_dir"], run_dir.display().to_string());
    assert_eq!(p["current_story"], "2");
    assert_eq!(
        p["stories"],
        json!([{"id": "1", "title": "Fake story one", "passed": 3, "total": 4}])
    );
    let tail: Vec<String> = serde_json::from_value(p["log_tail"].clone()).unwrap();
    assert!(tail.len() <= dbench::progress::LOG_TAIL_LINES && !tail.is_empty());

    // Log: harness output, cwd = repo, PATH prepend, argv.
    let log = srv.log("job-1").await;
    assert!(
        log.contains(&format!("path-head: {}", env.bin.display())),
        "{log}"
    );
    assert!(
        log.contains(&format!("args: {INSTALL_ID} run-1 canvas pi 1")),
        "{log}"
    );
    assert!(log.contains("git pull --ff-only: FAILED"), "{log}");
    // A followed log of a finished job ends by itself.
    let followed = tokio::time::timeout(
        DEADLINE,
        srv.http
            .get(format!("{}/v1/jobs/job-1/log?follow=1&from=0", srv.base))
            .bearer_auth(&srv.token)
            .send(),
    )
    .await
    .unwrap()
    .unwrap()
    .text()
    .await
    .unwrap();
    assert_eq!(followed, log);
    let from = log.find("[story 1]").unwrap();
    let partial = srv
        .http
        .get(format!("{}/v1/jobs/job-1/log?from={from}", srv.base))
        .bearer_auth(&srv.token)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(partial, log[from..]);

    // Events.
    let ev = srv.get("/v1/jobs/job-1/events").await;
    let kinds: Vec<&str> = ev["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["story_start", "agent_done", "scored"]);
    assert_eq!(ev["events"][2]["passed"], 3);
    assert_eq!(ev["events"][2]["story"], 1);

    // List and node.
    let jobs = srv.get("/v1/jobs").await;
    assert_eq!(jobs.as_array().unwrap().len(), 1);
    let node = srv.get("/v1/node").await;
    assert_eq!(
        node["combinations"],
        json!([{"install_id": INSTALL_ID, "combination": COMBINATION, "backend": "fake"}])
    );
    assert!(node["tools"].as_object().unwrap().contains_key("git"));
    assert!(node["cpus"].as_u64().unwrap() > 0);
    assert_eq!(node["current_job"], Value::Null);
    drop(env.root);
}

#[tokio::test(flavor = "multi_thread")]
async fn failure_hits_max_restarts() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(
        srv.submit("crashy", &spec("failpack", "run-f")).await.0,
        201
    );
    let v = srv.wait_status("crashy", "failed").await;
    assert_eq!(v["attempt"], MAX_RESTARTS + 1);
    assert_eq!(v["state"]["exit_code"], 1);
    let ev = srv.get("/v1/jobs/crashy/events").await;
    let crashes: Vec<&Value> = ev["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "crash")
        .collect();
    assert_eq!(crashes.len() as u32, MAX_RESTARTS + 1);
    assert_eq!(crashes[0]["exception"], "RuntimeError: fake crash");
    let log = srv.log("crashy").await;
    assert_eq!(
        log.matches("] attempt ").count() as u32,
        MAX_RESTARTS + 1,
        "{log}"
    );

    // The queue moves on after a failure: FIFO, one at a time.
    assert_eq!(srv.submit("after", &spec("fakepack", "run-a")).await.0, 201);
    srv.wait_status("after", "done").await;
}

/// `exit` is the harness's recorded exit: 143 (SIGTERM) or 137 (SIGKILL).
async fn cancel_kills_group(pack: &str, exit: i32) {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("slow", &spec(pack, "run-s")).await.0, 201);
    // A second job waits behind it.
    assert_eq!(
        srv.submit("queued", &spec("fakepack", "run-q")).await.0,
        201
    );
    let v = srv.wait_status("slow", "running").await;
    let pgid = v["state"]["pgid"].as_i64().unwrap() as i32;
    assert_eq!(v["state"]["pid"], v["state"]["pgid"]);
    assert_eq!(
        srv.get("/v1/jobs/queued").await["state"]["status"],
        "queued"
    );
    assert_eq!(srv.get("/v1/node").await["current_job"], "slow");
    let log_srv_base = srv.base.clone();
    let start = Instant::now();
    let sleep_pid = loop {
        let log = srv.log("slow").await;
        if log.contains("sleep-pid: ") {
            break logged_pid(&log, "sleep-pid: ");
        }
        assert!(start.elapsed() < DEADLINE);
        tokio::time::sleep(POLL).await;
    };
    assert!(group_alive(pgid) && pid_alive(sleep_pid));

    // Follow the log while it runs; the stream must end once the job is cancelled.
    let http = srv.http.clone();
    let token = srv.token.clone();
    let follower = tokio::spawn(async move {
        http.get(format!("{log_srv_base}/v1/jobs/slow/log?follow=1"))
            .bearer_auth(token)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap()
    });
    tokio::time::sleep(Duration::from_millis(300)).await;

    let (s, _) = srv.cancel("slow").await;
    assert_eq!(s, 202);
    srv.wait_status("slow", "cancelled").await;
    wait_until("process group gone", || !group_alive(pgid)).await;
    assert!(
        !pid_alive(sleep_pid),
        "the harness's child must die with the group"
    );
    let followed = tokio::time::timeout(DEADLINE, follower)
        .await
        .expect("follow ended")
        .unwrap();
    assert!(followed.contains("story — agent starting"), "{followed}");
    assert!(followed.contains("cancel: SIGTERM"), "{followed}");
    // Who did it: several clients can control a node, so submit and cancel record the caller.
    assert!(followed.contains("submitted by 127.0.0.1"), "{followed}");
    assert!(
        followed.contains("cancel requested by 127.0.0.1"),
        "{followed}"
    );
    assert!(
        followed.contains(&format!("harness exited {exit}; job cancelled")),
        "{followed}"
    );

    // The queued job runs next; cancelling a finished job is refused.
    srv.wait_status("queued", "done").await;
    assert_eq!(srv.cancel("queued").await.0, 409);
    assert_eq!(srv.cancel("slow").await.0, 200, "cancel is idempotent");

    // Cancelling a queued job is immediate.
    assert_eq!(srv.submit("blocker", &spec(pack, "run-b")).await.0, 201);
    assert_eq!(
        srv.submit("waiting", &spec("fakepack", "run-w")).await.0,
        201
    );
    srv.wait_status("blocker", "running").await;
    let (s, v) = srv.cancel("waiting").await;
    assert_eq!((s, v["state"]["status"].as_str()), (200, Some("cancelled")));
    assert_eq!(srv.cancel("blocker").await.0, 202);
    srv.wait_status("blocker", "cancelled").await;
    drop(env.root);
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_kills_the_process_group() {
    cancel_kills_group("slowpack", SIGTERM_EXIT).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn cancel_escalates_to_sigkill_when_sigterm_is_ignored() {
    cancel_kills_group("stubbornpack", SIGKILL_EXIT).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn server_restart_adopts_a_live_harness() {
    let env = setup();
    let mut a = start(&env, false);
    assert_eq!(a.submit("long", &spec("slowpack", "run-l")).await.0, 201);
    let v = a.wait_status("long", "running").await;
    let pid = v["state"]["pid"].as_i64().unwrap() as i32;

    // Kill the server hard; the harness is in its own process group and keeps running.
    a.child.kill().unwrap();
    a.child.wait().unwrap();
    assert!(group_alive(pid));

    let b = start(&env, false);
    let v = b.get("/v1/jobs/long").await;
    assert_eq!(v["state"]["status"], "running");
    assert_eq!(v["state"]["pid"], pid, "adopted, not restarted");
    assert_eq!(v["attempt"], 1);
    assert_eq!(b.get("/v1/node").await["current_job"], "long");
    assert!(b.log("long").await.contains("adopted the running harness"));

    assert_eq!(b.cancel("long").await.0, 202);
    b.wait_status("long", "cancelled").await;
    wait_until("group gone", || !group_alive(pid)).await;
    drop(env.root);
}

#[tokio::test(flavor = "multi_thread")]
async fn server_restart_requeues_a_dead_harness() {
    let env = setup();
    let mut a = start(&env, false);
    assert_eq!(a.submit("long", &spec("slowpack", "run-l")).await.0, 201);
    let v = a.wait_status("long", "running").await;
    let pid = v["state"]["pid"].as_i64().unwrap() as i32;

    // Server and harness both die (as in a reboot or a crash of the whole session).
    a.child.kill().unwrap();
    a.child.wait().unwrap();
    unsafe { libc::kill(-pid, libc::SIGKILL) };
    wait_until("group gone", || !group_alive(pid)).await;

    let b = start(&env, false);
    let v = b
        .wait_for("long", "restarted as attempt 2", |v| {
            v["state"]["status"] == "running" && v["attempt"] == 2
        })
        .await;
    assert_ne!(v["state"]["pid"], pid);
    let history = v["history"].to_string();
    assert!(history.contains("requeued to resume"), "{history}");
    assert_eq!(b.cancel("long").await.0, 202);
    b.wait_status("long", "cancelled").await;
    drop(env.root);
}
