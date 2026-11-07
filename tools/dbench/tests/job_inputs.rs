//! Story 23 (partial.job_inputs), TC-90 to TC-93: a partial rerun's starting code and record travel with the job from
//! the lake, through the real `dbench submit` and the real `dbench serve`, and nothing of the reference run is read
//! from the node's checkout. TC-94 (the size limit) is a unit test in src/job_inputs.rs.
//!
//! The lake is real: a run folder with its metrics.json, and the lake's code repository with the run's story refs,
//! made with real git. The harness is a script that prints what it was given.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

const NODE: &str = "node-t";
const INSTALL_ID: &str = "inputs-install";
const COMBINATION: &str = "test/combo/inputs";
const PACK: &str = "inputspack";
/// The reference run, as the lake names it.
const RUN: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r3";
/// The lake holds the run's code under this node; another copy of the run, without code, is under OTHER_NODE.
const CODE_NODE: &str = "thing2";
const OTHER_NODE: &str = "gruntus";
const STORIES: u32 = 3;
const FIRST: u32 = 3;
const DEADLINE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(100);
const SERVER_STOP_DEADLINE: Duration = Duration::from_secs(5);

const HARNESS: &str = r#"#!/usr/bin/env bash
set -euo pipefail
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from-run) echo "from-run: $2"; shift 2 ;;
    --from-code) echo "from-code: $2"; shift 2 ;;
    --from-metrics) echo "from-metrics: $2"; shift 2 ;;
    --run-id|--scope|--client|--only|--from-story) shift 2 ;;
    --record) shift ;;
    *) shift ;;
  esac
done
echo "harness ran"
"#;

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct World {
    root: PathBuf,
    repo: PathBuf,
    share: PathBuf,
    home: PathBuf,
    state: PathBuf,
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .args([
            "-c",
            "user.name=t",
            "-c",
            "user.email=t@t",
            "-c",
            "init.defaultBranch=main",
        ])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// A node checkout with one pack and install (and no reference run in it), and an empty lake.
fn world() -> World {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-inputs-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let repo = root.join("repo");
    std::fs::create_dir_all(repo.join(PACK).join("harness")).unwrap();
    std::fs::write(repo.join(PACK).join("harness/run.sh"), HARNESS).unwrap();
    std::fs::create_dir_all(repo.join("combinations").join(COMBINATION)).unwrap();
    std::fs::write(
        repo.join("combinations").join(COMBINATION).join("config.sh"),
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
    let state = root.join("lake-state");
    std::fs::create_dir_all(state.join("collected")).unwrap();
    git(&state, &["init", "-q", "--bare", "code.git"]);
    World {
        home: root.join("dbench-home"),
        repo,
        share,
        state,
        root,
    }
}

/// The run's code: one commit per story, each pushed to the lake's code repository as the run's story ref under
/// `node` for every story in `refs`. Returns each story's commit, by story number.
fn code(w: &World, node: &str, refs: &[u32]) -> Vec<String> {
    let work = w.root.join(format!("work-{node}"));
    std::fs::create_dir_all(&work).unwrap();
    git(&work, &["init", "-q"]);
    let mut commits = vec![String::new()];
    for n in 1..=STORIES {
        std::fs::write(work.join(format!("story{n}.ts")), format!("story {n}\n")).unwrap();
        git(&work, &["add", "-A"]);
        git(&work, &["commit", "-qm", &format!("story {n}")]);
        commits.push(git(&work, &["rev-parse", "HEAD"]));
    }
    let code_repo = w.state.join("code.git");
    for n in refs {
        let r = format!("refs/runs/{node}/{RUN}/story/{n:02}");
        git(
            &work,
            &[
                "push",
                "-q",
                code_repo.to_str().unwrap(),
                &format!("{}:{r}", commits[*n as usize]),
            ],
        );
    }
    commits
}

/// A copy of the run in the lake under `node`, with its record when `commits` is given.
fn copy(w: &World, node: &str, commits: Option<&[String]>) -> PathBuf {
    let dir = w.state.join("collected").join(node).join(RUN);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("run.json"), "{}").unwrap();
    if let Some(c) = commits {
        let stories: serde_json::Map<String, Value> = (1..=STORIES)
            .map(|n| (n.to_string(), json!({"commit": c[n as usize], "finished": 1.0})))
            .collect();
        std::fs::write(dir.join("metrics.json"), json!({"stories": stories}).to_string()).unwrap();
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

fn serve(w: &World) -> Server {
    let mut child = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(["serve", "--bind", "127.0.0.1:0", "--no-pull", "--allow-unreleased"])
        .arg("--repo")
        .arg(&w.repo)
        .arg("--home")
        .arg(&w.home)
        .arg("--share-dir")
        .arg(&w.share)
        .env("HOME", w.root.join("userhome"))
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
    let token = std::fs::read_to_string(w.home.join("token"))
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
    async fn job(&self, id: &str) -> (u16, Value) {
        let r = self
            .http
            .get(format!("{}/v1/jobs/{id}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .unwrap();
        let code = r.status().as_u16();
        (code, r.json().await.unwrap_or(Value::Null))
    }
    async fn wait_done(&self, id: &str) -> Value {
        let start = Instant::now();
        loop {
            let (_, v) = self.job(id).await;
            let status = v["state"]["status"].as_str().unwrap_or_default().to_string();
            if status == "done" || status == "failed" {
                return v;
            }
            assert!(start.elapsed() < DEADLINE, "job {id} never finished: {v}");
            tokio::time::sleep(POLL).await;
        }
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
}

/// `dbench submit` as a person runs it on the host, with the lake at BENCH_LAKE_STATE.
fn submit(w: &World, srv: &Server, id: &str, extra: &[&str]) -> Output {
    let config = w.root.join("nodes.toml");
    std::fs::write(
        &config,
        format!("[nodes.{NODE}]\nurl = \"{}\"\ntoken = \"{}\"\n", srv.base, srv.token),
    )
    .unwrap();
    Command::new(env!("CARGO_BIN_EXE_dbench"))
        .arg("--config")
        .arg(&config)
        .args([
            "submit",
            NODE,
            "--id",
            id,
            "--install-id",
            INSTALL_ID,
            "--pack",
            PACK,
            "--run-id",
            id,
            "--from-run",
            RUN,
        ])
        .args(extra)
        .env("HOME", w.root.join("userhome"))
        .env("BENCH_LAKE_STATE", &w.state)
        .output()
        .unwrap()
}

fn line_after<'a>(log: &'a str, label: &str) -> &'a str {
    log.lines()
        .find_map(|l| l.split_once(label).map(|(_, v)| v.trim()))
        .unwrap_or_else(|| panic!("no {label} in {log}"))
}

#[tokio::test(flavor = "multi_thread")]
async fn tc90_tc93_the_job_carries_the_run_s_code_to_the_story_before_and_its_record_and_runs_on_a_node_without_it() {
    let w = world();
    let commits = code(&w, CODE_NODE, &[1, 2, 3]);
    let with_code = copy(&w, CODE_NODE, Some(&commits));
    copy(&w, OTHER_NODE, Some(&commits)); // a copy with its record and no code: not the one used
    let srv = serve(&w);
    let story = FIRST.to_string();
    let out = submit(&w, &srv, "kg", &["--stories", &story]);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let v = srv.wait_done("kg").await;
    assert_eq!(v["state"]["status"], "done", "{v}");
    let log = srv.log("kg").await;
    assert!(log.contains("harness ran"), "{log}");
    assert_eq!(line_after(&log, "from-run:"), RUN);

    // The code: a bundle holding stories 1 and 2 and nothing of story 3, which the rerun is about to build.
    let bundle = PathBuf::from(line_after(&log, "from-code:"));
    let check = w.root.join("check");
    std::fs::create_dir_all(&check).unwrap();
    git(&check, &["init", "-q"]);
    git(
        &check,
        &["fetch", "-q", bundle.to_str().unwrap(), "+refs/*:refs/base/*"],
    );
    for (n, held) in [(1, true), (2, true), (3, false)] {
        let present = Command::new("git")
            .args(["cat-file", "-e", &commits[n]])
            .current_dir(&check)
            .status()
            .unwrap()
            .success();
        assert_eq!(present, held, "story {n}'s commit");
    }
    // The record: the lake's metrics.json, byte for byte.
    let metrics = PathBuf::from(line_after(&log, "from-metrics:"));
    assert_eq!(
        std::fs::read(metrics).unwrap(),
        std::fs::read(with_code.join("metrics.json")).unwrap()
    );

    // TC-93: the node never had the run; nothing of it was put in its checkout.
    assert!(!w.repo.join(RUN).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn tc91_tc92_a_run_without_the_code_or_the_record_is_refused_at_submit_and_nothing_is_queued() {
    let story = FIRST.to_string();
    // TC-91: the lake has story 1's code only, so there is no base for story 3.
    let w = world();
    let commits = code(&w, CODE_NODE, &[1]);
    copy(&w, CODE_NODE, Some(&commits));
    let srv = serve(&w);
    let out = submit(&w, &srv, "no-code", &["--stories", &story]);
    let said = String::from_utf8_lossy(&out.stderr).into_owned();
    assert!(!out.status.success(), "{said}");
    assert!(
        said.contains(&format!("reference run {RUN} has no code for story {}", FIRST - 1)),
        "{said}"
    );
    assert_eq!(srv.job("no-code").await.0, 404);

    // TC-92: the code is there, the record is not.
    let w = world();
    let commits = code(&w, CODE_NODE, &[1, 2, 3]);
    drop(commits);
    copy(&w, CODE_NODE, None);
    let srv = serve(&w);
    let out = submit(&w, &srv, "no-record", &["--from-story", &story]);
    let said = String::from_utf8_lossy(&out.stderr).into_owned();
    assert!(!out.status.success(), "{said}");
    assert!(
        said.contains(&format!("reference run {RUN} has no metrics.json in the lake")),
        "{said}"
    );
    assert_eq!(srv.job("no-record").await.0, 404);

    // And a run the lake does not hold at all.
    let w = world();
    let srv = serve(&w);
    let out = submit(&w, &srv, "no-run", &["--stories", &story]);
    let said = String::from_utf8_lossy(&out.stderr).into_owned();
    assert!(
        !out.status.success() && said.contains(&format!("reference run {RUN}: no such run in the lake")),
        "{said}"
    );
    assert_eq!(srv.job("no-run").await.0, 404);
}
