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
const TREE_POLL_MS: &str = "100";
const INSTALL_ID: &str = "fake-install";
const COMBINATION: &str = "test/combo/fake";
const OTHER_COMBINATION: &str = "test/combo/other";
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

/// Exits as the harness does while the machine hasn't recovered from a swap or memory guard stop (75), more times
/// than the restart cap allows, then finishes. The count is kept beside the script.
const UNFIT_TIMES: u32 = MAX_RESTARTS + 2;
const UNFIT_BODY: &str = r#"n=$(cat "$0.count" 2>/dev/null || echo 0); echo $((n + 1)) > "$0.count"
if [ "$n" -lt "$UNFIT_TIMES" ]; then echo "MACHINE UNFIT: story 9 was stopped (swap guard)" >&2; exit 75; fi
exit 0
"#;
const UNFIT_BACKOFF_MS: &str = "150";

/// Crashes every time, but not the same way twice in a row (the exception alternates), so each
/// failure could be one that a restart gets past.
const FAIL_BODY: &str = r#"n=$(cat "$0.count" 2>/dev/null || echo 0); echo $((n + 1)) > "$0.count"
echo "[story 1] Crashy story — agent starting"
echo "Traceback (most recent call last):"
echo '  File "drive.py", line 1, in <module>'
if [ $((n % 2)) -eq 0 ]; then echo "RuntimeError: fake crash"; else echo "ValueError: another fake crash"; fi
exit 1
"#;

/// The same failure every time, word for word: a broken checkout, say.
const SAME_FAIL_LINE: &str = "git pull --ff-only failed: unmerged files";
const SAME_FAIL_BODY: &str = r#"echo "[story 1] Same story — agent starting"
echo "error: Pulling is not possible because you have unmerged files." >&2
echo "git pull --ff-only failed: unmerged files" >&2
exit 1
"#;

/// The same traceback every time, but with what changes from one attempt to the next: the time,
/// the pid, a temp path and a port.
const VOLATILE_FAIL_BODY: &str = r#"n=$(cat "$0.count" 2>/dev/null || echo 0); echo $((n + 1)) > "$0.count"
echo "[$(date -u +%Y-%m-%dT%H:%M:%S)] [story 2] Volatile story — agent starting"
echo "Traceback (most recent call last):"
echo "  File \"/tmp/tmpq$n$$/drive.py\", line 9, in <module>"
echo "ConnectionError: server pid $$ on 127.0.0.1:$((18000 + n)) stopped at $(date -u +%H:%M:%S).$n after 1.${n}s, see /tmp/run-$$-$n/server.log"
exit 1
"#;

/// The same failure every time, but each attempt records one more finished story (metrics.json),
/// as a run that crashes now and then yet moves forward does.
const PROGRESS_FAIL_BODY: &str = r#"n=$(cat "$0.count" 2>/dev/null || echo 0); echo $((n + 1)) > "$0.count"
stories=""
for i in $(seq 1 $((n + 1))); do
  stories="$stories${stories:+, }\"$i\": {\"title\": \"S$i\", \"accept\": {\"passed\": 1, \"total\": 1}}"
done
echo "{\"stories\": {$stories}}" > "$RUN_DIR/metrics.json"
echo "[story $((n + 2))] Next story — agent starting"
echo "Traceback (most recent call last):"
echo '  File "drive.py", line 1, in <module>'
echo "RuntimeError: crash after a recorded story"
exit 1
"#;

const MISSING_BODY: &str = r#"echo "[story 3] agent done; running gates"
echo "MISSING RESOURCES: the agent's e2e tests have no browser (browser not installed). Story 3 scores are void." >&2
echo "exit 3: some later noise" >&2
exit 3
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

/// Starts a "server" in its own session, as run.sh does with setsid, so it is outside the
/// harness's process group; then either exits (leakpack) or waits to be cancelled (leakwaitpack).
const LEAK_BODY: &str = r#"perl -e 'use POSIX; POSIX::setsid(); exec @ARGV' sleep 300 &
echo "server-pid: $!"
sleep 1
echo "[story 1] Leaky story — agent starting"
"#;

/// Runs story 3 of 4 and writes the harness's progress.json, then waits (to be cancelled).
const PROGRESS_BODY: &str = r#"echo 3 > "$RUN_DIR/current_story"
cat > "$RUN_DIR/progress.json" <<'EOF'
{"updated_at": 1790302781.2, "scope": "canvas", "stories": [
  {"id": 1, "title": "One", "status": "DONE", "accept": {"passed": 4, "total": 4}},
  {"id": 2, "title": "Two", "status": "PARTIAL", "ended_by": "operator", "reason": "stuck",
   "verdict": "amber", "accept": {"passed": 1, "total": 5}},
  {"id": 3, "title": "Three", "status": "running", "started_at": 1790291590.0, "calls": 572,
   "partial_base": [2], "accept": null,
   "tasks": [{"n": 8, "title": "E2E", "type": "test:e2e", "tcs": ["TC-22"], "status": "written", "found": 7, "total": 7}],
   "baselines": [{"source": "other canvas-pi-01", "calls": 236, "status": "DONE"}],
   "recent_activity": ["bash: npx playwright test"]},
  {"id": 4, "title": "Four", "status": "pending"}
]}
EOF
echo "[story 3] Three — agent starting"
sleep 300 &
wait
"#;

struct Env {
    root: TempRoot,
    repo: PathBuf,
    home: PathBuf,
    user_home: PathBuf,
    bin: PathBuf,
}

/// Prints the variables a job's server_env may set, as the model server would see them.
const ENV_BODY: &str = r#"echo "server-env: GPU_BACKEND=${GPU_BACKEND:-unset} SPEC_DRAFT_N_MAX=${SPEC_DRAFT_N_MAX:-unset}"
exit 0
"#;

fn setup() -> Env {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-it-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let repo = root.join("repo");
    for (pack, body) in [
        ("fakepack", FAKE_BODY),
        ("envpack", ENV_BODY),
        ("failpack", FAIL_BODY),
        ("samefailpack", SAME_FAIL_BODY),
        ("volatilefailpack", VOLATILE_FAIL_BODY),
        ("progressfailpack", PROGRESS_FAIL_BODY),
        ("unfitpack", &format!("UNFIT_TIMES={UNFIT_TIMES}\n{UNFIT_BODY}")),
        ("missingpack", MISSING_BODY),
        ("slowpack", SLOW_BODY),
        ("stubbornpack", STUBBORN_BODY),
        ("progresspack", PROGRESS_BODY),
        ("leakpack", &format!("{LEAK_BODY}exit 0\n")),
        ("leakwaitpack", &format!("{LEAK_BODY}sleep 300 &\nwait\n")),
    ] {
        let dir = repo.join(pack).join("harness");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.sh"), format!("{HEADER}{body}")).unwrap();
    }
    // combinations/<COMBINATION>/config.sh names the install, as in the real repo.
    // A second combination claims the same install id, which install.env contradicts.
    for (combination, install_id) in [(COMBINATION, INSTALL_ID), (OTHER_COMBINATION, INSTALL_ID)] {
        let dir = repo.join("combinations").join(combination);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("config.sh"),
            format!("# fake\nINSTALL_ID=\"{install_id}\"   # install dir\n"),
        )
        .unwrap();
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
        // These tests are about the server, not about which harness runs: the temp repo has no
        // release (most aren't git repos), so jobs run its own harness. tests/harness.rs covers releases.
        .arg("--allow-unreleased")
        .args([
            "--restart-backoff-ms",
            BACKOFF_MS,
            "--cancel-grace-ms",
            GRACE_MS,
            "--tree-poll-ms",
            TREE_POLL_MS,
            "--unfit-backoff-ms",
            UNFIT_BACKOFF_MS,
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
    async fn hold(&self, body: Option<Value>) -> (u16, Value) {
        self.call(reqwest::Method::POST, "/v1/hold", body).await
    }
    async fn release(&self) -> (u16, Value) {
        self.call(reqwest::Method::POST, "/v1/release", None).await
    }
    async fn cancel(&self, id: &str) -> (u16, Value) {
        self.cancel_with(id, Some(json!({"reason": TEST_CANCEL_REASON}))).await
    }
    async fn cancel_with(&self, id: &str, body: Option<Value>) -> (u16, Value) {
        self.call(
            reqwest::Method::POST,
            &format!("/v1/jobs/{id}/cancel"),
            body,
        )
        .await
    }
    async fn skip_story(&self, id: &str, body: Value) -> (u16, Value) {
        self.call(
            reqwest::Method::POST,
            &format!("/v1/jobs/{id}/skip-story"),
            Some(body),
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

/// 1 Oct 2026: the swap guard stopped a run, and dbench restarted it 30 s later like any crash, without waiting
/// for the machine to recover; three more such stops would have failed the job. Exit 75 (machine unfit) waits
/// the longer backoff each time, isn't counted against the restart cap, and is noted as a wait.
#[tokio::test(flavor = "multi_thread")]
async fn a_machine_unfit_exit_waits_and_does_not_use_up_the_restarts() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("unfit", &spec("unfitpack", "run-u")).await.0, 201);
    let v = srv.wait_status("unfit", "done").await;
    assert!(v["attempt"].as_u64().unwrap() <= u64::from(MAX_RESTARTS) + 1, "{v}");
    let waits = v["history"].as_array().unwrap().iter()
        .filter(|n| n["text"].as_str().unwrap().contains("machine unfit")).count() as u32;
    assert_eq!(waits, UNFIT_TIMES, "{v}");
    let log = srv.log("unfit").await;
    assert!(log.contains("machine unfit (exit 75); waiting"), "{log}");
    assert!(!log.contains("restarts used"), "{log}");
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

/// The monitor's A-031: a failure that can't change between attempts (unmerged files in the
/// checkout, a model server that exits at start, a traceback at import) used every restart within
/// minutes. The second identical failure with no new story recorded ends the job, naming it.
#[tokio::test(flavor = "multi_thread")]
async fn the_same_failure_twice_with_no_progress_stops_the_job() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("same", &spec("samefailpack", "run-same")).await.0, 201);
    let v = srv.wait_status("same", "failed").await;
    assert_eq!(v["attempt"], 2, "{v}");
    assert_eq!(v["state"]["exit_code"], 1);
    let reason = v["state"]["reason"].as_str().unwrap();
    assert_eq!(
        reason,
        format!("the same failure twice with no progress: exit 1: {SAME_FAIL_LINE}")
    );
    let notes: Vec<&str> = v["history"].as_array().unwrap().iter()
        .map(|n| n["text"].as_str().unwrap()).collect();
    assert_eq!(notes.iter().filter(|t| t.contains(SAME_FAIL_LINE)).count(), 1, "{notes:?}");
    assert!(notes.iter().any(|t| t.starts_with(reason) && t.contains("not restarting")), "{notes:?}");
    let log = srv.log("same").await;
    assert_eq!(log.matches("] attempt ").count(), 2, "{log}");
    assert!(log.contains(&format!("{reason}; not restarting")), "{log}");
    assert!(!log.contains("restarts used"), "{log}");
}

/// Times, pids, temp paths and ports differ from one attempt to the next; the failure is the same.
#[tokio::test(flavor = "multi_thread")]
async fn a_failure_that_differs_only_in_volatile_parts_counts_as_the_same() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("vol", &spec("volatilefailpack", "run-vol")).await.0, 201);
    let v = srv.wait_status("vol", "failed").await;
    assert_eq!(v["attempt"], 2, "{v}");
    let reason = v["state"]["reason"].as_str().unwrap();
    assert!(reason.starts_with("the same failure twice with no progress: exit 1: ConnectionError: server pid "), "{reason}");
    // The raw lines did differ.
    let log = srv.log("vol").await;
    assert!(log.contains("127.0.0.1:18000") && log.contains("127.0.0.1:18001"), "{log}");
}

/// Failures that differ each time could each be transient: every restart is used.
#[tokio::test(flavor = "multi_thread")]
async fn different_failures_use_all_the_restarts() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("alt", &spec("failpack", "run-alt")).await.0, 201);
    let v = srv.wait_status("alt", "failed").await;
    assert_eq!(v["attempt"], MAX_RESTARTS + 1, "{v}");
    let reason = v["state"]["reason"].as_str().unwrap();
    assert!(reason.ends_with(&format!("all {MAX_RESTARTS} restarts used")), "{reason}");
}

/// The same failure, but each attempt recorded another story: the run is moving, so it keeps its restarts.
#[tokio::test(flavor = "multi_thread")]
async fn the_same_failure_after_a_new_story_keeps_restarting() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("moving", &spec("progressfailpack", "run-mv")).await.0, 201);
    let v = srv.wait_status("moving", "failed").await;
    assert_eq!(v["attempt"], MAX_RESTARTS + 1, "{v}");
    let reason = v["state"]["reason"].as_str().unwrap();
    assert!(reason.ends_with(&format!("all {MAX_RESTARTS} restarts used")), "{reason}");
    assert_eq!(v["progress"]["stories"].as_array().unwrap().len() as u32, MAX_RESTARTS + 1, "{v}");
}

#[tokio::test(flavor = "multi_thread")]
async fn missing_resources_fail_at_once_and_say_why() {
    // The harness exits 3 when the machine lacks what the run needs (a browser, …). Restarting
    // would hit the same wall, so the job fails on its first attempt, with the harness's reason.
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(
        srv.submit("nobrowser", &spec("missingpack", "run-m"))
            .await
            .0,
        201
    );
    let v = srv.wait_status("nobrowser", "failed").await;
    assert_eq!(v["attempt"], 1, "{v}");
    assert_eq!(v["state"]["exit_code"], 3);
    let reason = v["state"]["reason"].as_str().unwrap();
    assert!(reason.starts_with("missing resources: "), "{reason}");
    assert!(reason.contains("browser not installed"), "{reason}");
    assert!(!reason.contains("later noise"), "{reason}");
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

const TEST_CANCEL_REASON: &str = "preflight failed: the sandbox hid Claude Code's temp dir";

/// 1 Oct 2026: a job cancelled after its preflight failed showed "none given" as its reason, because a cancel
/// carried none. A cancel now needs one, and the job keeps it: in its state, its history and its log.
#[tokio::test(flavor = "multi_thread")]
async fn a_cancel_needs_a_reason_and_the_job_keeps_it() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("blocker", &spec("slowpack", "run-b")).await.0, 201);
    assert_eq!(srv.submit("waiting", &spec("fakepack", "run-w")).await.0, 201);
    srv.wait_status("blocker", "running").await;
    for body in [None, Some(json!({})), Some(json!({"reason": "  "}))] {
        let (s, v) = srv.cancel_with("waiting", body.clone()).await;
        assert!(s == 400 || s == 415 || s == 422, "{body:?}: {s} {v}");
    }
    assert_eq!(srv.get("/v1/jobs/waiting").await["state"]["status"], "queued", "a refused cancel cancels nothing");
    let (s, v) = srv.cancel("waiting").await;
    assert_eq!((s, v["state"]["status"].as_str()), (200, Some("cancelled")));
    let v = srv.get("/v1/jobs/waiting").await;
    assert_eq!(v["cancel_reason"], TEST_CANCEL_REASON);
    let note = v["history"].as_array().unwrap().last().unwrap()["text"].as_str().unwrap().to_string();
    assert!(note.contains(TEST_CANCEL_REASON) && note.contains("127.0.0.1"), "{note}");
    assert!(srv.log("waiting").await.contains(TEST_CANCEL_REASON));
    // A running job keeps the reason too, through to its final state.
    assert_eq!(srv.cancel_with("blocker", Some(json!({"reason": "made room for a rerun"}))).await.0, 202);
    srv.wait_status("blocker", "cancelled").await;
    assert_eq!(srv.get("/v1/jobs/blocker").await["cancel_reason"], "made room for a rerun");
    // Cancelling again keeps the first reason; a job cancelled before reasons were kept takes the one given now.
    assert_eq!(srv.cancel_with("blocker", Some(json!({"reason": "later"}))).await.0, 200);
    assert_eq!(srv.get("/v1/jobs/blocker").await["cancel_reason"], "made room for a rerun");
    drop(env.root);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_job_cancelled_without_a_reason_takes_one_later() {
    let env = setup();
    // As a server from before reasons were kept left it: cancelled, no reason.
    let mut job = dbench::job::Job::new("old".into(), serde_json::from_value(spec("fakepack", "run-o")).unwrap(), 1);
    job.state = dbench::job::JobState::Cancelled;
    let jobs = env.home.join("jobs");
    std::fs::create_dir_all(&jobs).unwrap();
    dbench::store::save_job(&jobs, &job).unwrap();
    let srv = start(&env, false);
    assert_eq!(srv.get("/v1/jobs/old").await.get("cancel_reason"), None);
    assert_eq!(srv.cancel_with("old", Some(json!({"reason": TEST_CANCEL_REASON}))).await.0, 200);
    let v = srv.get("/v1/jobs/old").await;
    assert_eq!(v["cancel_reason"], TEST_CANCEL_REASON);
    let note = v["history"].as_array().unwrap().last().unwrap()["text"].as_str().unwrap().to_string();
    assert!(note.contains("reason given after the cancel") && note.contains(TEST_CANCEL_REASON), "{note}");
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

/// How long a held node is watched to see that it starts nothing: several restart backoffs and queue wakes.
const HELD_WATCH: Duration = Duration::from_secs(2);

/// 1 Oct 2026: a node's server could only be restarted on a new binary mid-job (the new server adopts the harness
/// and, not knowing how it ended, requeues it) or in the seconds between two jobs. A hold lets the running job
/// finish and starts no other until released; it outlives a restart of the server, so the restart is clean.
#[tokio::test(flavor = "multi_thread")]
async fn a_held_node_finishes_its_job_starts_no_other_and_stays_held_across_a_restart() {
    let env = setup();
    let mut a = start(&env, false);
    assert_eq!(a.submit("now", &spec("slowpack", "run-n")).await.0, 201);
    assert_eq!(a.submit("next", &spec("fakepack", "run-x")).await.0, 201);
    a.wait_status("now", "running").await;
    for body in [None, Some(json!({})), Some(json!({"reason": " "}))] {
        assert_eq!(a.hold(body.clone()).await.0, 400, "{body:?}");
    }
    let (s, v) = a.hold(Some(json!({"reason": "restart on the new binary"}))).await;
    assert_eq!(s, 200, "{v}");
    let node = a.get("/v1/node").await;
    assert_eq!(node["hold"]["reason"], "restart on the new binary");
    assert_eq!(node["current_job"], "now", "the running job is not touched");
    assert_eq!(a.cancel("now").await.0, 202);                      // the running job ends (here, by a cancel)
    a.wait_status("now", "cancelled").await;
    tokio::time::sleep(HELD_WATCH).await;
    assert_eq!(a.get("/v1/jobs/next").await["state"]["status"], "queued", "held: nothing new starts");
    assert_eq!(a.get("/v1/node").await["current_job"], Value::Null);

    a.child.kill().unwrap();
    a.child.wait().unwrap();
    let b = start(&env, false);
    tokio::time::sleep(HELD_WATCH).await;
    assert_eq!(b.get("/v1/jobs/next").await["state"]["status"], "queued", "still held after the restart");
    assert_eq!(b.get("/v1/node").await["hold"]["reason"], "restart on the new binary");

    assert_eq!(b.release().await.0, 200);
    b.wait_status("next", "done").await;
    assert_eq!(b.get("/v1/node").await.get("hold"), None);
    assert_eq!(b.release().await.0, 200, "release is idempotent");
    drop(env.root);
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

#[tokio::test(flavor = "multi_thread")]
async fn submit_by_combination_reads_the_install_id_from_the_repo() {
    let env = setup();
    let srv = start(&env, false);
    let by_combination = |run_id: &str, combination: &str| {
        let mut s = spec("fakepack", run_id);
        s.as_object_mut().unwrap().remove("install_id");
        s["combination"] = json!(combination);
        s
    };

    // Resolved from combinations/<COMBINATION>/config.sh, stored by install id.
    let (code, v) = srv.submit("c1", &by_combination("rc", COMBINATION)).await;
    assert_eq!(code, 201, "{v}");
    assert_eq!(v["spec"]["install_id"], INSTALL_ID, "{v}");
    assert!(v["spec"].get("combination").is_none(), "{v}");
    // The same job by install id, or by a tab-completed path, is the same job.
    assert_eq!(srv.submit("c1", &spec("fakepack", "rc")).await.0, 200);
    let completed = by_combination("rc", &format!("combinations/{COMBINATION}/"));
    assert_eq!(srv.submit("c1", &completed).await.0, 200);

    // Each rejection says why.
    for (combination, why) in [
        ("test/combo/nope", "no combination"),
        ("test/combo", "has no config.sh"),
        ("../..", "is not a combination"),
        (OTHER_COMBINATION, "is installed as"),
    ] {
        let (code, v) = srv.submit("c2", &by_combination("rx", combination)).await;
        assert_eq!(code, 400, "{combination}: {v}");
        let e = v["error"].as_str().unwrap_or_default();
        assert!(e.contains(why), "{combination}: {e}");
    }
    // Exactly one of the two.
    let mut both = spec("fakepack", "rx");
    both["combination"] = json!(COMBINATION);
    assert_eq!(srv.submit("c2", &both).await.0, 400);
    let mut neither = spec("fakepack", "rx");
    neither.as_object_mut().unwrap().remove("install_id");
    assert_eq!(srv.submit("c2", &neither).await.0, 400);

    srv.wait_status("c1", "done").await;
    drop(env.root);
}

/// The harness's own session children (a model server under setsid) are outside its process
/// group; dbench still stops them once the harness is gone, whether it exited or was cancelled.
async fn leftovers_are_stopped(pack: &str, cancel: bool) {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(srv.submit("leak", &spec(pack, "run-leak")).await.0, 201);
    srv.wait_status("leak", "running").await;
    let start = Instant::now();
    let server_pid = loop {
        let log = srv.log("leak").await;
        if log.contains("agent starting") {
            break logged_pid(&log, "server-pid: ");
        }
        assert!(start.elapsed() < DEADLINE, "{log}");
        tokio::time::sleep(POLL).await;
    };
    if cancel {
        assert!(pid_alive(server_pid));
        assert_eq!(srv.cancel("leak").await.0, 202);
        srv.wait_status("leak", "cancelled").await;
    } else {
        srv.wait_status("leak", "done").await;
    }
    // The job reaches its final state only after the leftovers are gone.
    assert!(
        !pid_alive(server_pid),
        "the setsid'd server must be stopped"
    );
    let log = srv.log("leak").await;
    assert!(
        log.contains(&format!(
            "stopping processes the harness left running: sleep ({server_pid})"
        )),
        "{log}"
    );
    drop(env.root);
}

#[tokio::test(flavor = "multi_thread")]
async fn leftovers_are_stopped_when_the_harness_exits() {
    leftovers_are_stopped("leakpack", false).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn leftovers_are_stopped_when_the_job_is_cancelled() {
    leftovers_are_stopped("leakwaitpack", true).await;
}

/// The status view carries every story from the harness's progress.json, and
/// skip-story leaves a request for the harness in the run dir, only for the
/// story that is running.
#[tokio::test(flavor = "multi_thread")]
async fn progress_stories_and_skip_story() {
    let env = setup();
    let srv = start(&env, false);
    assert_eq!(
        srv.submit("prog", &spec("progresspack", "run-p")).await.0,
        201
    );
    assert_eq!(
        srv.submit("behind", &spec("fakepack", "run-b")).await.0,
        201
    );
    let v = srv
        .wait_for("prog", "running story 3", |v| {
            v["state"]["status"] == "running"
                && v["progress"]["stories"]
                    .as_array()
                    .is_some_and(|s| s.len() == 4)
        })
        .await;
    let p = &v["progress"];
    assert_eq!(p["current_story"], "3");
    assert_eq!(p["stories_updated_at"], 1790302781.2);
    assert!(p.get("error").is_none(), "{p:#}");
    let stories = p["stories"].as_array().unwrap();
    assert_eq!(
        stories
            .iter()
            .map(|s| s["status"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["DONE", "PARTIAL", "running", "pending"]
    );
    // Old consumers keep their id/passed/total.
    assert_eq!(
        (
            &stories[0]["id"],
            &stories[0]["passed"],
            &stories[0]["total"]
        ),
        (&json!("1"), &json!(4), &json!(4))
    );
    assert_eq!(stories[1]["verdict"], "amber");
    let running = &stories[2];
    assert_eq!(running["calls"], 572);
    assert_eq!(running["partial_base"], json!([2]));
    assert_eq!(
        running["tasks"],
        json!([{"n": 8, "title": "E2E", "type": "test:e2e", "tcs": ["TC-22"], "status": "written", "found": 7, "total": 7}])
    );
    assert_eq!(running["baselines"][0]["source"], "other canvas-pi-01");
    assert_eq!(
        running["recent_activity"],
        json!(["bash: npx playwright test"])
    );
    assert_eq!(
        stories[3],
        json!({"id": "4", "title": "Four", "passed": null, "total": null, "status": "pending"})
    );

    let run_dir = env
        .repo
        .join("combinations")
        .join(COMBINATION)
        .join("benchmarks/progresspack/run-p");
    let control = run_dir.join("control/skip-story.json");
    let body = |story: u32, reason: &str| json!({"story": story, "reason": reason});

    // Refusals, none of which writes anything.
    assert_eq!(srv.skip_story("nope", body(3, "x")).await.0, 404);
    let (code, v) = srv.skip_story("prog", body(2, "x")).await;
    assert_eq!(code, 409, "{v}");
    assert!(
        v["error"]
            .as_str()
            .unwrap()
            .contains("the current story is 3"),
        "{v}"
    );
    assert_eq!(srv.skip_story("prog", body(3, "  ")).await.0, 400);
    assert_eq!(srv.skip_story("prog", json!({"story": 3})).await.0, 400);
    let (code, v) = srv.skip_story("behind", body(3, "x")).await;
    assert_eq!(code, 409, "queued: {v}");
    assert!(v["error"].as_str().unwrap().contains("not running"), "{v}");
    assert!(!control.exists());

    // Accepted: the request is in the run dir, the job keeps running, and who asked is recorded.
    let before = dbench::timefmt::now_secs();
    let (code, v) = srv
        .skip_story("prog", body(3, "no commit for 107 min"))
        .await;
    assert_eq!(code, 202, "{v}");
    assert_eq!(v["state"]["status"], "running");
    let written: Value = serde_json::from_slice(&std::fs::read(&control).unwrap()).unwrap();
    assert_eq!(written["story"], 3);
    assert_eq!(written["reason"], "no commit for 107 min");
    assert_eq!(written["by"], "127.0.0.1");
    let at = written["at"].as_u64().unwrap();
    assert!(
        at >= before && at <= dbench::timefmt::now_secs(),
        "{written}"
    );
    assert_eq!(written.as_object().unwrap().len(), 4, "{written}");
    let note = "skip-story 3 requested by 127.0.0.1: no commit for 107 min";
    assert!(v["history"].to_string().contains(note), "{v:#}");
    assert!(srv.log("prog").await.contains(note));

    // Once the job is over there is nothing to skip.
    assert_eq!(srv.cancel("prog").await.0, 202);
    srv.wait_status("prog", "cancelled").await;
    assert_eq!(srv.skip_story("prog", body(3, "x")).await.0, 409);
    srv.wait_status("behind", "done").await;
    assert_eq!(srv.skip_story("behind", body(2, "x")).await.0, 409);
    drop(env.root);
}

#[tokio::test]
async fn server_env_reaches_the_harness_and_is_checked() {
    let env = setup();
    let srv = start(&env, false);

    // Allowed keys with valid values reach the harness's environment (and so the model server).
    let mut s = spec("envpack", "env-1");
    s["server_env"] = json!({"GPU_BACKEND": "rocm", "SPEC_DRAFT_N_MAX": "4"});
    let (code, _) = srv.submit("env-1", &s).await;
    assert_eq!(code, 201);
    srv.wait_status("env-1", "done").await;
    let log = srv.log("env-1").await;
    assert!(
        log.contains("server-env: GPU_BACKEND=rocm SPEC_DRAFT_N_MAX=4"),
        "{log}"
    );

    // Without server_env the harness gets nothing extra.
    let (code, _) = srv.submit("env-2", &spec("envpack", "env-2")).await;
    assert_eq!(code, 201);
    srv.wait_status("env-2", "done").await;
    assert!(srv
        .log("env-2")
        .await
        .contains("server-env: GPU_BACKEND=unset SPEC_DRAFT_N_MAX=unset"));

    // The same id with a different server_env is a different job.
    let mut other = s.clone();
    other["server_env"] = json!({"GPU_BACKEND": "vulkan", "SPEC_DRAFT_N_MAX": "4"});
    let (code, _) = srv.submit("env-1", &other).await;
    assert_eq!(code, 409);

    // Keys outside the list, and values outside a key's range, are refused.
    for bad in [
        json!({"LD_PRELOAD": "/tmp/x.so"}),
        json!({"GPU_BACKEND": "rocm; rm -rf /"}),
        json!({"SPEC_DRAFT_N_MAX": "0"}),
        json!({"SPEC_DRAFT_P_MIN": "1.5"}),
    ] {
        let mut b = spec("envpack", "env-bad");
        b["server_env"] = bad.clone();
        let (code, body) = srv.submit("env-bad", &b).await;
        assert_eq!(code, 400, "{bad} -> {body}");
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn jobs_submitted_in_the_same_second_keep_their_order_across_a_restart() {
    let env = setup();
    let mut a = start(&env, false);
    assert_eq!(a.submit("long", &spec("slowpack", "run-l")).await.0, 201);
    let v = a.wait_status("long", "running").await;
    let pid = v["state"]["pid"].as_i64().unwrap() as i32;
    // Submitted in this order within the same second; the ids sort the other way.
    assert_eq!(a.submit("zz-first", &spec("slowpack", "run-z")).await.0, 201);
    assert_eq!(a.submit("aa-second", &spec("slowpack", "run-a")).await.0, 201);
    let first = a.get("/v1/jobs/zz-first").await;
    let second = a.get("/v1/jobs/aa-second").await;
    assert!(second["seq"].as_u64().unwrap() > first["seq"].as_u64().unwrap(), "{first} {second}");

    a.child.kill().unwrap();
    a.child.wait().unwrap();
    let b = start(&env, false);
    assert_eq!(b.cancel("long").await.0, 202);
    b.wait_status("long", "cancelled").await;
    wait_until("group gone", || !group_alive(pid)).await;
    b.wait_status("zz-first", "running").await;
    assert_eq!(b.get("/v1/jobs/aa-second").await["state"]["status"], "queued");
    assert_eq!(b.cancel("zz-first").await.0, 202);
    assert_eq!(b.cancel("aa-second").await.0, 200, "a queued job is cancelled at once");
    b.wait_status("zz-first", "cancelled").await;
    drop(env.root);
}
