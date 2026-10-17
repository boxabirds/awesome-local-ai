//! GET /v1/runs/scopes and GET /v1/runs/scope-file (docs/design/dbench-scopes/api.md), through the real router on a
//! temporary node directory. Every test names the run it builds; fixtures are in `tests/fixtures/scopes_listing/`.
//!
//! Case table (MECE by the dimension each test varies):
//!
//! finality
//!   F1  run_state {started, finished, failed, stopped, unknown (no file), unknown (garbage state)} x job
//!       {none, queued, running, done, failed, cancelled}: `final`, `run_state`, `job_state` of the listing.
//!   F2  a live job on a `started` run: nothing final, every story and stream open.
//!   F3  a crashed harness (no run-status.json) whose job failed: the run closes, with run_state `unknown`.
//!   F4  a resumed run (a second job): the listing names the newer job; final is false again.
//!   F5  stories of a run in progress: 1 done, 2 running, 3 not started.
//!   F6  a final failed run: a story that never started and one that never ended are final.
//!   F7  a story with files and no metrics.json or progress.json: running while open, failed once the run is final.
//! contents
//!   C1  absent files are absent: an empty run lists run.json and nothing else; no streams, no stories.
//!   C2  no name outside the allow-list is ever listed (stray files, workspace/, temporaries).
//!   C3  stream bounds: first and last event time; a last line without its newline is skipped; a 100 MB log is fast;
//!       an empty log has null bounds; the egress log named by work_dir.txt.
//!   C4  streams are not in `files`; other raw logs (server.log) are.
//! errors and safety
//!   E1  bad run id 400, unknown run 404, missing run 400, no token 401.
//!   E2  a link named like an allow-listed file is not listed and not served; a linked stories folder is not entered.
//! scope-file
//!   S1  bytes and headers equal /v1/runs/file's, plus x-dbench-final (run file, story file, stream file; 1 and 0).
//!   S2  a name outside the allow-list is refused with E-NAME-NOT-ALLOWED; `from` that is not a number is 400.
//!   S3  an allow-listed name the run does not have is 404.
//! real data
//!   R1  every real run in the lake (capped, spread across nodes): final flag and story states against the recorded state.

use dbench::cli::ServerConfig;
use dbench::job::{AgentClient, Job, JobSpec, JobState};
use dbench::server::{router, Inner, Shared};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const TOKEN: &str = "test-token";
const INSTALL_ID: &str = "fake-install";
const COMBINATION: &str = "test/combo/fake";
const PACK: &str = "fakepack";
const RUN_ID: &str = "v2-r1";
const NOW: u64 = 1_792_000_000;
const SERVE_POLL: Duration = Duration::from_millis(50);
const MAX_RESTARTS: u32 = 2;
const BIG_LOG_BYTES: usize = 100 * 1024 * 1024;
const BIG_LOG_LINE_BYTES: usize = 4096;
const BIG_LOG_MAX_SECONDS: u64 = 5;
const HTTP_OK: u16 = 200;
const HTTP_BAD_REQUEST: u16 = 400;
const HTTP_UNAUTHORIZED: u16 = 401;
const HTTP_NOT_FOUND: u16 = 404;
const FINAL_HEADER: &str = "x-dbench-final";
const REAL_RUN_CAP: usize = 60;

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn fixture(name: &str) -> Vec<u8> {
    let p = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scopes_listing").join(name);
    std::fs::read(&p).unwrap_or_else(|e| panic!("fixture {}: {e}", p.display()))
}

struct Node {
    root: PathBuf,
    shared: Arc<Shared>,
    base: String,
    http: reqwest::Client,
}

impl Drop for Node {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

struct Reply {
    status: u16,
    headers: reqwest::header::HeaderMap,
    body: Vec<u8>,
}

impl Reply {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or_else(|e| panic!("not json ({e}): {}", String::from_utf8_lossy(&self.body)))
    }
    fn header(&self, name: &str) -> Option<String> {
        self.headers.get(name).and_then(|v| v.to_str().ok()).map(String::from)
    }
}

impl Node {
    async fn start() -> Node {
        let root = std::env::temp_dir().join(format!("dbench-scopes-listing-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&root);
        let (repo, home, share) = (root.join("repo"), root.join("home"), root.join("share"));
        std::fs::create_dir_all(repo.join("combinations").join(COMBINATION).join("benchmarks").join(PACK)).unwrap();
        std::fs::create_dir_all(home.join("jobs")).unwrap();
        std::fs::create_dir_all(share.join(INSTALL_ID)).unwrap();
        std::fs::write(
            share.join(INSTALL_ID).join("install.env"),
            format!("INSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\n"),
        )
        .unwrap();
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".into(),
            repo: repo.canonicalize().unwrap(),
            jobs_dir: home.join("jobs"),
            releases_dir: home.join("releases"),
            home,
            share_dir: share,
            bench_home: root.join("bench-home"),
            path_prepend: vec![],
            max_restarts: MAX_RESTARTS,
            pull: false,
            allow_unreleased: true,
            restart_backoff: SERVE_POLL,
            unfit_backoff: SERVE_POLL,
            cancel_grace: SERVE_POLL,
            tree_poll: SERVE_POLL,
        };
        let shared = Arc::new(Shared {
            cfg,
            token: TOKEN.into(),
            boot_time: None,
            inner: Mutex::new(Inner { jobs: HashMap::new(), queue: VecDeque::new(), current: None, hold: None }),
            wake: tokio::sync::Notify::new(),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = router(shared.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Node { root, shared, base: format!("http://{addr}"), http: reqwest::Client::new() }
    }

    fn run_rel(&self, run_id: &str) -> String {
        format!("combinations/{COMBINATION}/benchmarks/{PACK}/{run_id}")
    }

    fn run_dir(&self, run_id: &str) -> PathBuf {
        self.shared.cfg.repo.join(self.run_rel(run_id))
    }

    /// A run directory with its marker, and optionally a run-status.json from a fixture.
    fn make_run(&self, run_id: &str, status_fixture: Option<&str>) -> PathBuf {
        let dir = self.run_dir(run_id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.json"), fixture("run.json")).unwrap();
        if let Some(f) = status_fixture {
            std::fs::write(dir.join("run-status.json"), fixture(f)).unwrap();
        }
        dir
    }

    fn add_job(&self, id: &str, run_id: &str, state: JobState, seq: u64) {
        let spec = JobSpec {
            install_id: INSTALL_ID.into(),
            combination: None,
            pack: PACK.into(),
            scope: None,
            stories: None,
            run_id: run_id.into(),
            client: AgentClient::Pi,
            record: false,
            server_env: Default::default(),
            from_run: None,
            from_story: None,
        };
        let mut job = Job::new(id.into(), spec, NOW + seq);
        job.seq = seq;
        job.state = state;
        self.shared.lock().jobs.insert(id.into(), job);
    }

    async fn get(&self, path: &str, query: &[(&str, &str)]) -> Reply {
        self.get_as(path, query, Some(TOKEN)).await
    }

    async fn get_as(&self, path: &str, query: &[(&str, &str)], token: Option<&str>) -> Reply {
        let mut req = self.http.get(format!("{}{path}", self.base)).query(query);
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let resp = req.send().await.unwrap();
        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let body = resp.bytes().await.unwrap().to_vec();
        Reply { status, headers, body }
    }

    async fn scopes(&self, run_id: &str) -> Value {
        let r = self.get("/v1/runs/scopes", &[("run", &self.run_rel(run_id))]).await;
        assert_eq!(r.status, HTTP_OK, "scopes: {}", String::from_utf8_lossy(&r.body));
        r.json()
    }
}

fn job_state(label: &str) -> JobState {
    match label {
        "queued" => JobState::Queued,
        "running" => JobState::Running { pid: 1, pgid: 1, attempt: 1, started_at: NOW, boot_time: None },
        "done" => JobState::Done { exit_code: 0 },
        "failed" => JobState::Failed { reason: "test".into(), exit_code: None },
        "cancelled" => JobState::Cancelled,
        other => panic!("no job state {other}"),
    }
}

fn story(listing: &Value, n: u64) -> &Value {
    listing["stories"].as_array().unwrap().iter().find(|s| s["n"] == n).unwrap_or_else(|| panic!("no story {n} in {listing}"))
}

fn names(files: &Value) -> Vec<String> {
    files.as_array().unwrap().iter().map(|f| f["name"].as_str().unwrap().to_string()).collect()
}

fn write(dir: &Path, rel: &str, body: &str) {
    let p = dir.join(rel);
    std::fs::create_dir_all(p.parent().unwrap()).unwrap();
    std::fs::write(p, body).unwrap();
}

// ---------------------------------------------------------------- F1

#[tokio::test]
async fn f1_every_run_state_and_job_state_gives_the_contract_final_flag() {
    let run_states: [(&str, Option<&str>, &str); 6] = [
        ("started", Some("run-status-started.json"), "started"),
        ("finished", Some("run-status-finished.json"), "finished"),
        ("failed", Some("run-status-failed.json"), "failed"),
        ("stopped", Some("run-status-stopped.json"), "stopped"),
        ("absent", None, "unknown"),
        ("garbage", Some("run-status-garbage.json"), "unknown"),
    ];
    let jobs: [Option<&str>; 6] = [None, Some("queued"), Some("running"), Some("done"), Some("failed"), Some("cancelled")];
    let node = Node::start().await;
    let mut n = 0;
    for (tag, fixture_name, expect_state) in run_states {
        for job in jobs {
            let run_id = format!("v2-{tag}-{n}");
            n += 1;
            node.make_run(&run_id, fixture_name);
            if let Some(label) = job {
                node.add_job(&format!("job-{run_id}"), &run_id, job_state(label), n);
            }
            let listing = node.scopes(&run_id).await;
            let closing = matches!(expect_state, "finished" | "failed" | "stopped");
            let terminal = matches!(job, Some("done") | Some("failed") | Some("cancelled"));
            let ctx = format!("run {tag}, job {job:?}");
            assert_eq!(listing["run_state"], expect_state, "{ctx}");
            let live = matches!(job, Some("queued") | Some("running"));   // a live job reopens the run, whatever run-status.json says
            assert_eq!(listing["final"], !live && (closing || terminal), "{ctx}");
            match job {
                Some(label) => {
                    assert_eq!(listing["job_state"], label, "{ctx}");
                    assert_eq!(listing["job"], format!("job-{run_id}"), "{ctx}");
                }
                None => {
                    assert!(listing["job"].is_null(), "{ctx}");
                    assert!(listing["job_state"].is_null(), "{ctx}");
                }
            }
            assert_eq!(listing["run"], node.run_rel(&run_id), "{ctx}");
        }
    }
}

// ---------------------------------------------------------------- F2 to F7

#[tokio::test]
async fn f2_a_live_job_on_a_started_run_leaves_everything_open() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":1.5,\"type\":\"a\"}\n");
    write(&dir, "stories/01/conditions.jsonl", "{\"t\":2.5}\n");
    write(&dir, "egress.jsonl", "{\"t\":0.5}\n");
    node.add_job("job-1", RUN_ID, job_state("running"), 1);
    let l = node.scopes(RUN_ID).await;
    assert_eq!(l["final"], false);
    assert_eq!(l["streams"][0]["final"], false);
    let s1 = story(&l, 1);
    assert_eq!(s1["final"], false);
    assert_eq!(s1["state"], "running");
    for s in s1["streams"].as_array().unwrap() {
        assert_eq!(s["final"], false, "{s}");
    }
    for f in l["files"].as_array().unwrap() {
        assert_eq!(f["final"], false, "{f}");
    }
}

#[tokio::test]
async fn f3_a_crashed_harness_closes_from_the_failed_job_alone() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, None);
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":1.5}\n");
    node.add_job("job-1", RUN_ID, job_state("failed"), 1);
    let l = node.scopes(RUN_ID).await;
    assert_eq!(l["run_state"], "unknown");
    assert_eq!(l["final"], true);
    let s1 = story(&l, 1);
    assert_eq!(s1["final"], true);
    assert_eq!(s1["state"], "failed", "it had files, never recorded an end, and the run is over");
    assert_eq!(s1["streams"][0]["final"], true);
}

#[tokio::test]
async fn f4_a_resumed_run_names_the_new_job_and_is_open_again() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":1.5}\n");
    node.add_job("job-1", RUN_ID, job_state("failed"), 1);
    let before = node.scopes(RUN_ID).await;
    assert_eq!((before["job"].as_str(), before["final"].as_bool()), (Some("job-1"), Some(true)));
    node.add_job("job-1-again1", RUN_ID, job_state("running"), 2);
    let after = node.scopes(RUN_ID).await;
    assert_eq!(after["job"], "job-1-again1");
    assert_eq!(after["final"], false);
    assert_eq!(story(&after, 1)["final"], false);
    assert_eq!(story(&after, 1)["streams"][0]["final"], false);
}

#[tokio::test]
async fn f5_a_run_in_progress_has_story_1_done_2_running_3_not_started() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    std::fs::write(dir.join("metrics.json"), fixture("metrics-story1-done.json")).unwrap();
    std::fs::write(dir.join("progress.json"), fixture("progress-1done-2running-3pending.json")).unwrap();
    write(&dir, "stories/01/gate.json", "{}");
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":1.0}\n{\"_rx\":2.0}\n");
    write(&dir, "stories/02/agent-events.jsonl", "{\"_rx\":3.0}\n");
    node.add_job("job-1", RUN_ID, job_state("running"), 1);
    let l = node.scopes(RUN_ID).await;
    let states: Vec<(u64, &str, bool)> = l["stories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["n"].as_u64().unwrap(), s["state"].as_str().unwrap(), s["final"].as_bool().unwrap()))
        .collect();
    assert_eq!(states, vec![(1, "done", true), (2, "running", false), (3, "not_started", false)]);
    // Story 1's stream is final with its story; story 2's is not; story 3 has none.
    assert_eq!(story(&l, 1)["streams"][0]["final"], true);
    assert_eq!(story(&l, 2)["streams"][0]["final"], false);
    assert_eq!(story(&l, 3)["streams"].as_array().unwrap().len(), 0);
    assert_eq!(names(&story(&l, 1)["files"]), vec!["stories/01/gate.json"]);
    // The run-scope files are open, and listed with their size and mtime.
    let metrics = l["files"].as_array().unwrap().iter().find(|f| f["name"] == "metrics.json").unwrap();
    assert_eq!(metrics["final"], false);
    assert!(metrics["size"].as_u64().unwrap() > 0 && metrics["mtime"].as_f64().unwrap() > 0.0);
}

#[tokio::test]
async fn f6_a_final_failed_run_closes_a_story_that_never_started_and_one_that_never_ended() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-failed.json"));
    std::fs::write(dir.join("metrics.json"), fixture("metrics-story1-done.json")).unwrap();
    std::fs::write(dir.join("progress.json"), fixture("progress-1done-2running-3pending.json")).unwrap();
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":1.0}\n");
    write(&dir, "stories/02/agent-events.jsonl", "{\"_rx\":3.0}\n");
    let l = node.scopes(RUN_ID).await;
    assert_eq!(l["final"], true);
    let states: Vec<(u64, &str, bool)> = l["stories"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["n"].as_u64().unwrap(), s["state"].as_str().unwrap(), s["final"].as_bool().unwrap()))
        .collect();
    assert_eq!(states, vec![(1, "done", true), (2, "failed", true), (3, "not_started", true)]);
    for f in l["files"].as_array().unwrap() {
        assert_eq!(f["final"], true, "{f}");
    }
}

#[tokio::test]
async fn f7_a_story_with_files_and_no_record_follows_the_run() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    write(&dir, "stories/01/gate.json", "{}");
    node.add_job("job-1", RUN_ID, job_state("running"), 1);
    let open = node.scopes(RUN_ID).await;
    assert_eq!((story(&open, 1)["state"].as_str(), story(&open, 1)["final"].as_bool()), (Some("running"), Some(false)));
    std::fs::write(dir.join("run-status.json"), fixture("run-status-stopped.json")).unwrap();
    // The job is still running: a resumed run keeps its old closing state until the harness writes `started`.
    let still = node.scopes(RUN_ID).await;
    assert_eq!((story(&still, 1)["state"].as_str(), story(&still, 1)["final"].as_bool()), (Some("running"), Some(false)));
    node.shared.lock().jobs.clear();
    node.add_job("job-1", RUN_ID, job_state("done"), 1);
    let closed = node.scopes(RUN_ID).await;
    assert_eq!((story(&closed, 1)["state"].as_str(), story(&closed, 1)["final"].as_bool()), (Some("failed"), Some(true)));
}

// ---------------------------------------------------------------- C

#[tokio::test]
async fn c1_an_empty_run_lists_what_exists_and_nothing_else() {
    let node = Node::start().await;
    node.make_run(RUN_ID, None);
    let l = node.scopes(RUN_ID).await;
    assert_eq!(names(&l["files"]), vec!["run.json"]);
    assert_eq!(l["streams"].as_array().unwrap().len(), 0);
    assert_eq!(l["stories"].as_array().unwrap().len(), 0);
    assert_eq!(l["final"], false);
}

#[tokio::test]
async fn c2_no_name_outside_the_allow_list_is_listed() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-finished.json"));
    write(&dir, "notes.txt", "x");
    write(&dir, "workspace/src/main.rs", "x");
    write(&dir, "control/skip-story.json", "{}");
    write(&dir, "current_story", "01");
    write(&dir, ".metrics.json.123.tmp", "{}");
    write(&dir, "stories/01/secret.txt", "x");
    write(&dir, "stories/01/artifacts/ok.txt", "x");
    write(&dir, "stories/01/artifacts/bad name.txt", "x");
    write(&dir, "summary.md", "# s");
    let l = node.scopes(RUN_ID).await;
    let mut run_files = names(&l["files"]);
    run_files.sort();
    assert_eq!(run_files, vec!["run-status.json", "run.json", "summary.md"]);
    assert_eq!(names(&story(&l, 1)["files"]), vec!["stories/01/artifacts/ok.txt"]);
    // Every listed name is one the allow-list accepts.
    let all: Vec<String> = names(&l["files"]).into_iter().chain(names(&story(&l, 1)["files"])).collect();
    for n in all {
        assert!(dbench::collect::parse_name(&n).is_some(), "{n}");
    }
}

#[tokio::test]
async fn c3_stream_bounds_are_the_first_and_last_complete_event_times() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    // The last line has no newline: it is not an event yet.
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":10.25,\"a\":1}\n{\"_rx\":11.5}\n{\"_rx\":12.75}\n{\"_rx\":13");
    write(&dir, "stories/01/conditions.jsonl", "{\"t\": 100.5, \"ac\": true}\n");
    write(&dir, "stories/02/agent-events.jsonl", "");
    write(&dir, "egress.jsonl", "{\"t\":5.5}\n{\"t\":6.5}\n");
    let l = node.scopes(RUN_ID).await;
    let s1 = story(&l, 1);
    let by_name = |s: &Value, name: &str| s["streams"].as_array().unwrap().iter().find(|x| x["stream"] == name).cloned().unwrap();
    let agent = by_name(s1, "agent");
    assert_eq!((agent["first_ts"].as_f64(), agent["last_ts"].as_f64()), (Some(10.25), Some(12.75)));
    let cond = by_name(s1, "conditions");
    assert_eq!((cond["first_ts"].as_f64(), cond["last_ts"].as_f64()), (Some(100.5), Some(100.5)));
    let empty = by_name(story(&l, 2), "agent");
    assert!(empty["first_ts"].is_null() && empty["last_ts"].is_null(), "{empty}");
    let egress = &l["streams"][0];
    assert_eq!(egress["stream"], "egress");
    assert_eq!((egress["first_ts"].as_f64(), egress["last_ts"].as_f64()), (Some(5.5), Some(6.5)));
}

#[tokio::test]
async fn c3_the_egress_log_named_by_work_dir_txt_is_the_run_egress_stream() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    write(&dir, "work_dir.txt", "/somewhere/work-abc\n");
    let egress_dir = node.shared.cfg.bench_home.join("egress");
    std::fs::create_dir_all(&egress_dir).unwrap();
    std::fs::write(egress_dir.join("work-abc.jsonl"), "{\"t\":7.5}\n{\"t\":8.5}\n").unwrap();
    let l = node.scopes(RUN_ID).await;
    assert_eq!(l["streams"][0]["stream"], "egress");
    assert_eq!(l["streams"][0]["last_ts"].as_f64(), Some(8.5));
}

#[tokio::test]
async fn c3_a_100_mb_log_is_bounded_without_reading_it_all() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    let path = dir.join("stories/01/agent-events.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut f = std::io::BufWriter::new(std::fs::File::create(&path).unwrap());
    let pad = "x".repeat(BIG_LOG_LINE_BYTES);
    let lines = BIG_LOG_BYTES / BIG_LOG_LINE_BYTES;
    for i in 0..lines {
        writeln!(f, "{{\"_rx\":{}.5,\"pad\":\"{pad}\"}}", 1000 + i).unwrap();
    }
    f.flush().unwrap();
    drop(f);
    let started = Instant::now();
    let l = node.scopes(RUN_ID).await;
    assert!(started.elapsed() < Duration::from_secs(BIG_LOG_MAX_SECONDS), "took {:?}", started.elapsed());
    let agent = &story(&l, 1)["streams"][0];
    assert_eq!(agent["first_ts"].as_f64(), Some(1000.5));
    assert_eq!(agent["last_ts"].as_f64(), Some((1000 + lines - 1) as f64 + 0.5));
}

#[tokio::test]
async fn c4_streams_are_not_files_but_other_raw_logs_are() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    write(&dir, "server.log", "line\n");
    write(&dir, "egress.jsonl", "{\"t\":1.5}\n");
    write(&dir, "stories/01/agent-events.jsonl", "{\"_rx\":1.5}\n");
    write(&dir, "stories/01/conditions.jsonl", "{\"t\":1.5}\n");
    let l = node.scopes(RUN_ID).await;
    let mut run_files = names(&l["files"]);
    run_files.sort();
    assert_eq!(run_files, vec!["run-status.json", "run.json", "server.log"]);
    assert_eq!(names(&story(&l, 1)["files"]).len(), 0);
}

// ---------------------------------------------------------------- E

#[tokio::test]
async fn e1_bad_run_unknown_run_missing_run_and_no_token() {
    let node = Node::start().await;
    node.make_run(RUN_ID, None);
    for path in ["/v1/runs/scopes", "/v1/runs/scope-file"] {
        let bad = node.get(path, &[("run", "../etc"), ("name", "run.json")]).await;
        assert_eq!(bad.status, HTTP_BAD_REQUEST, "{path}");
        assert!(String::from_utf8_lossy(&bad.body).contains("E-BAD-RUN-ID"), "{path}");
        let unknown = node.get(path, &[("run", "combinations/nope/benchmarks/x/y"), ("name", "run.json")]).await;
        assert_eq!(unknown.status, HTTP_NOT_FOUND, "{path}");
        assert!(String::from_utf8_lossy(&unknown.body).contains("E-RUN-NOT-FOUND"), "{path}");
        let missing = node.get(path, &[("name", "run.json")]).await;
        assert_eq!(missing.status, HTTP_BAD_REQUEST, "{path}");
        let rel = node.run_rel(RUN_ID);
        let no_token = node.get_as(path, &[("run", rel.as_str()), ("name", "run.json")], None).await;
        assert_eq!(no_token.status, HTTP_UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn e2_a_link_is_never_listed_or_served() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-finished.json"));
    let outside = node.root.join("outside");
    std::fs::create_dir_all(&outside).unwrap();
    std::fs::write(outside.join("secret"), "secret").unwrap();
    std::fs::create_dir_all(dir.join("stories/01")).unwrap();
    std::os::unix::fs::symlink(outside.join("secret"), dir.join("stories/01/gate.json")).unwrap();
    std::os::unix::fs::symlink(outside.join("secret"), dir.join("summary.md")).unwrap();
    // A linked stories folder is not entered.
    std::fs::create_dir_all(outside.join("02")).unwrap();
    std::fs::write(outside.join("02/gate.json"), "{}").unwrap();
    std::os::unix::fs::symlink(outside.join("02"), dir.join("stories/02")).unwrap();
    let l = node.scopes(RUN_ID).await;
    assert!(!names(&l["files"]).contains(&"summary.md".to_string()));
    assert_eq!(names(&story(&l, 1)["files"]).len(), 0);
    assert!(l["stories"].as_array().unwrap().iter().all(|s| s["n"] != 2), "{l}");
    let rel = node.run_rel(RUN_ID);
    for name in ["summary.md", "stories/01/gate.json", "stories/02/gate.json"] {
        let r = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", name)]).await;
        assert_eq!(r.status, HTTP_NOT_FOUND, "{name}");
        assert!(!String::from_utf8_lossy(&r.body).contains("secret"), "{name}");
    }
}

// ---------------------------------------------------------------- S

#[tokio::test]
async fn s1_scope_file_serves_the_same_bytes_and_headers_as_runs_file_plus_the_final_header() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    std::fs::write(dir.join("metrics.json"), fixture("metrics-story1-done.json")).unwrap();
    std::fs::write(dir.join("progress.json"), fixture("progress-1done-2running-3pending.json")).unwrap();
    write(&dir, "stories/01/gate.json", "{\"gate\":1}");
    write(&dir, "stories/02/gate.json", "{\"gate\":2}");
    write(&dir, "stories/02/agent-events.jsonl", "{\"_rx\":1.5}\n");
    node.add_job("job-1", RUN_ID, job_state("running"), 1);
    let rel = node.run_rel(RUN_ID);
    let cases = [
        ("metrics.json", "0"),         // run scope, open
        ("stories/01/gate.json", "1"), // story 1 is done: final
        ("stories/02/gate.json", "0"), // story 2 is running
        ("stories/02/agent-events.jsonl", "0"),
    ];
    for (name, final_flag) in cases {
        let old = node.get("/v1/runs/file", &[("run", rel.as_str()), ("name", name)]).await;
        let new = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", name)]).await;
        assert_eq!(new.status, HTTP_OK, "{name}");
        assert_eq!(new.body, old.body, "{name}");
        for h in ["x-dbench-from", "x-dbench-size", "x-dbench-mtime", "x-dbench-eof"] {
            assert_eq!(new.header(h), old.header(h), "{name} {h}");
        }
        assert_eq!(new.header(FINAL_HEADER).as_deref(), Some(final_flag), "{name}");
    }
    // The run ends: every file is final.
    node.shared.lock().jobs.clear();
    std::fs::write(dir.join("run-status.json"), fixture("run-status-finished.json")).unwrap();
    for (name, _) in cases {
        let r = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", name)]).await;
        assert_eq!(r.header(FINAL_HEADER).as_deref(), Some("1"), "{name}");
    }
    // The job named in the listing and the run's own state agree with the file route.
    let l = node.scopes(RUN_ID).await;
    assert_eq!(l["final"], true);
}

#[tokio::test]
async fn s1_scope_file_honours_from_and_check_like_runs_file() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, Some("run-status-started.json"));
    write(&dir, "server.log", "0123456789\nabcdefghij\n");
    let rel = node.run_rel(RUN_ID);
    let whole = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", "server.log")]).await;
    assert_eq!(whole.body, b"0123456789\nabcdefghij\n");
    let stale = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", "server.log"), ("from", "5")]).await;
    assert_eq!(stale.status, HTTP_BAD_REQUEST, "an append file read from past 0 needs check=");
    let beyond = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", "server.log"), ("from", "9999")]).await;
    assert_eq!(beyond.status, 409);
}

#[tokio::test]
async fn s2_names_outside_the_allow_list_and_bad_parameters_are_refused() {
    let node = Node::start().await;
    let dir = node.make_run(RUN_ID, None);
    write(&dir, "notes.txt", "x");
    write(&dir, "workspace/a.txt", "x");
    let rel = node.run_rel(RUN_ID);
    for name in ["notes.txt", "workspace/a.txt", "../run.json", "stories/01/../../run.json", "/etc/passwd", ".run.json.1.tmp", ""] {
        let r = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", name)]).await;
        assert_eq!(r.status, HTTP_NOT_FOUND, "{name:?}");
        assert!(String::from_utf8_lossy(&r.body).contains("E-NAME-NOT-ALLOWED"), "{name:?}: {}", String::from_utf8_lossy(&r.body));
    }
    let no_name = node.get("/v1/runs/scope-file", &[("run", rel.as_str())]).await;
    assert_eq!(no_name.status, HTTP_BAD_REQUEST);
    let bad_from = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", "run.json"), ("from", "x")]).await;
    assert_eq!(bad_from.status, HTTP_BAD_REQUEST);
    let extra = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", "run.json"), ("bogus", "1")]).await;
    assert_eq!(extra.status, HTTP_BAD_REQUEST);
}

#[tokio::test]
async fn s3_an_allowed_name_the_run_does_not_have_is_not_found() {
    let node = Node::start().await;
    node.make_run(RUN_ID, None);
    let rel = node.run_rel(RUN_ID);
    let r = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", "metrics.json")]).await;
    assert_eq!(r.status, HTTP_NOT_FOUND);
    assert!(String::from_utf8_lossy(&r.body).contains("metrics.json is not on this node"), "{}", String::from_utf8_lossy(&r.body));
    assert!(r.header(FINAL_HEADER).is_none());
}

// ---------------------------------------------------------------- R

fn lake_dir() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    let dir = PathBuf::from(home).join("expts/awesome-local-ai-bench-private/state/collected");
    dir.is_dir().then_some(dir)
}

/// Every real run directory of one node of the lake: a `benchmarks/<pack>/<run>` folder holding a run.json.
fn lake_runs(node_dir: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth > 14 {
            return;
        }
        let Ok(rd) = std::fs::read_dir(dir) else { return };
        let mut entries: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            if !e.file_type().is_ok_and(|t| t.is_dir()) {
                continue;
            }
            let in_benchmarks = p.parent().and_then(|x| x.parent()).and_then(|x| x.file_name()).is_some_and(|n| n == "benchmarks");
            if in_benchmarks && p.join("run.json").is_file() {
                out.push(p);
            } else {
                walk(&p, depth + 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(node_dir, 0, &mut out);
    out
}

/// The state a lake run recorded in its run-status.json, or `absent`.
fn recorded_state(run: &Path) -> String {
    std::fs::read(run.join("run-status.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("state").and_then(|s| s.as_str()).map(String::from))
        .unwrap_or_else(|| "absent".into())
}

/// Copies the small files of a lake run into the node and empty placeholders for its logs.
fn copy_lake_run(src: &Path, dst: &Path) {
    std::fs::create_dir_all(dst).unwrap();
    for name in ["run.json", "metrics.json", "progress.json", "run-status.json"] {
        if src.join(name).is_file() {
            std::fs::copy(src.join(name), dst.join(name)).unwrap();
        }
    }
    if let Ok(rd) = std::fs::read_dir(src.join("stories")) {
        for e in rd.filter_map(|e| e.ok()).filter(|e| e.file_type().is_ok_and(|t| t.is_dir())) {
            let n = e.file_name();
            let story = dst.join("stories").join(&n);
            std::fs::create_dir_all(&story).unwrap();
            for log in ["agent-events.jsonl", "conditions.jsonl"] {
                if e.path().join(log).is_file() {
                    std::fs::write(story.join(log), "").unwrap();
                }
            }
        }
    }
    if src.join("egress.jsonl").is_file() {
        std::fs::write(dst.join("egress.jsonl"), "").unwrap();
    }
}

#[tokio::test]
async fn r1_every_real_run_in_the_lake_has_the_final_flag_its_recorded_state_implies() {
    let Some(lake) = lake_dir() else {
        eprintln!("r1: lake directory absent; skipped");
        return;
    };
    let mut per_node: Vec<Vec<PathBuf>> = std::fs::read_dir(&lake)
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let mut runs = lake_runs(&e.path());
            // A run in an unusual state (started, failed, stopped, no status) comes before a finished one, so the cap keeps them.
            runs.sort_by_key(|r| recorded_state(r) == "finished");
            runs
        })
        .filter(|runs| !runs.is_empty())
        .collect();
    per_node.sort();
    // Round-robin across the nodes, so a cap cuts every node evenly.
    let mut chosen: Vec<PathBuf> = Vec::new();
    let mut i = 0;
    while chosen.len() < REAL_RUN_CAP && per_node.iter().any(|r| i < r.len()) {
        for runs in &per_node {
            if let (Some(r), true) = (runs.get(i), chosen.len() < REAL_RUN_CAP) {
                chosen.push(r.clone());
            }
        }
        i += 1;
    }
    assert!(!chosen.is_empty(), "the lake holds no run");
    let node = Node::start().await;
    let mut tally: std::collections::BTreeMap<String, usize> = Default::default();
    let mut story_checks = 0usize;
    for (idx, src) in chosen.iter().enumerate() {
        let run_id = format!("real-{idx}");
        let dst = node.run_dir(&run_id);
        copy_lake_run(src, &dst);
        let recorded = recorded_state(src);
        // Three variants of the job: none, terminal, live.
        let variants: [(&str, Option<&str>); 3] = [("none", None), ("terminal", Some("done")), ("live", Some("running"))];
        for (tag, label) in variants {
            node.shared.lock().jobs.clear();
            if let Some(l) = label {
                node.add_job("job-r", &run_id, job_state(l), 1);
            }
            let listing = node.scopes(&run_id).await;
            let closing = matches!(recorded.as_str(), "finished" | "failed" | "stopped");
            let expect = label != Some("running") && (closing || label == Some("done"));
            assert_eq!(listing["final"], expect, "{} ({recorded}, job {tag})", src.display());
            assert_eq!(listing["run_state"], if closing || recorded == "started" { recorded.as_str() } else { "unknown" });
            if label.is_none() {
                *tally.entry(recorded.clone()).or_default() += 1;
                // Each story the record gives a closing status reads as that status; nothing else is `done`.
                let metrics: Option<Value> = std::fs::read(src.join("metrics.json")).ok().and_then(|b| serde_json::from_slice(&b).ok());
                for s in listing["stories"].as_array().unwrap() {
                    let n = s["n"].as_u64().unwrap().to_string();
                    let status = metrics.as_ref().and_then(|m| m["stories"][&n]["status"].as_str());
                    match status {
                        Some("DONE") => assert_eq!((s["state"].as_str(), s["final"].as_bool()), (Some("done"), Some(true)), "{} story {n}", src.display()),
                        Some("PARTIAL") => assert_eq!((s["state"].as_str(), s["final"].as_bool()), (Some("partial"), Some(true)), "{} story {n}", src.display()),
                        _ if expect => assert_eq!(s["final"].as_bool(), Some(true), "{} story {n}: {s}", src.display()),
                        _ => {}
                    }
                    story_checks += 1;
                }
            }
        }
    }
    eprintln!("r1: {} real runs by recorded state: {tally:?}; {story_checks} story checks", chosen.len());
}
