//! The real `vidi-gallery` binary against a temp repo, a temp private checkout beside it and a temp HOME: it starts, says where
//! it listens, serves the run list with the judges unblinded from the keys on this machine, and stops cleanly on SIGTERM.
//! Nothing outside the temp directory is read or written: the cache, the keys and the private checkout are all under it.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::time::{Duration, Instant};

const STOP_DEADLINE: Duration = Duration::from_secs(20);
const POLL: Duration = Duration::from_millis(50);
const RUN: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1";
const SETUP: &str = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
const PACKAGE: &str = "vidi-v1";
const UNBLINDED_AS: &str = "opus-5.5";

struct Gallery {
    child: Child,
    stdout: BufReader<ChildStdout>,
    port: u16,
    /// Lines printed before the two that say where it listens (the background preparation prints as soon as it has nothing to do).
    early: String,
}

impl Drop for Gallery {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
}

/// What the machine would have: a repo with one scored run, a private checkout beside it with one independent judge's result,
/// and a HOME holding the key that says which build that judge's letter was.
fn world(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("vidi-gallery-it-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (repo, home) = (root.join("awesome-local-ai"), root.join("home"));
    let run = repo.join(RUN);
    std::fs::create_dir_all(run.join("workspace")).unwrap();
    std::fs::write(run.join("metrics.json"), r#"{"stories": {}}"#).unwrap();
    std::fs::write(run.join("accept-final-summary.json"), r#"{"passed": 71, "total": 75}"#).unwrap();
    let results = root.join("awesome-local-ai-bench-private/gradings").join(PACKAGE).join("results/judge-1");
    std::fs::create_dir_all(&results).unwrap();
    std::fs::write(results.join("build-A.jsonl"), r#"{"category": "functional", "severity": "high"}"#).unwrap();
    std::fs::create_dir_all(home.join(".vidi-bench/keys")).unwrap();
    std::fs::write(home.join(".vidi-bench/keys").join(format!("{PACKAGE}.json")), format!(r#"{{"A": "{UNBLINDED_AS}"}}"#)).unwrap();
    (root, repo, home)
}

fn start(repo: &Path, home: &Path, extra: &[&str]) -> (Gallery, String, String) {
    let port = free_port();
    let mut child = Command::new(env!("CARGO_BIN_EXE_vidi-gallery"))
        .arg("--repo")
        .arg(repo)
        .args(["--port", &port.to_string()])
        .args(extra)
        .env("HOME", home)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let (mut first, mut second, mut early) = (String::new(), String::new(), String::new());
    while first.is_empty() || second.is_empty() {
        let mut line = String::new();
        assert_ne!(stdout.read_line(&mut line).unwrap(), 0, "the gallery ended before it said where it listens: {early}");
        if line.starts_with("vidi-gallery: ") {
            first = line;
        } else if line.starts_with("story review: ") {
            second = line;
        } else {
            early.push_str(&line);
        }
    }
    (Gallery { child, stdout, port, early }, first, second)
}

/// A GET over a plain connection: (status, body).
fn get(port: u16, path: &str) -> (u16, String) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(s, "GET {path} HTTP/1.0\r\n\r\n").unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw).unwrap();
    let status = raw.split_whitespace().nth(1).unwrap().parse().unwrap();
    (status, raw.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default())
}

/// SIGTERM, then the rest of what it printed and how it exited.
fn stop(mut g: Gallery) -> (bool, String) {
    // SAFETY: kill(2) on our own child's pid.
    unsafe { libc::kill(g.child.id() as i32, libc::SIGTERM) };
    let start = Instant::now();
    let status = loop {
        if let Some(s) = g.child.try_wait().unwrap() {
            break s;
        }
        assert!(start.elapsed() < STOP_DEADLINE, "the gallery did not stop on SIGTERM");
        std::thread::sleep(POLL);
    };
    let mut rest = std::mem::take(&mut g.early);
    g.stdout.read_to_string(&mut rest).unwrap();
    (status.success(), rest)
}

#[test]
fn the_gallery_serves_the_run_list_with_judges_unblinded_from_this_machines_keys_and_stops_on_sigterm() {
    let (root, repo, home) = world("labelled");
    let (g, first, second) = start(&repo, &home, &[]);
    let canonical = repo.canonicalize().unwrap();
    assert_eq!(first.trim_end(), format!("vidi-gallery: http://127.0.0.1:{}/  (repo {})", g.port, canonical.display()));
    assert_eq!(second.trim_end(), format!("story review: http://127.0.0.1:{}/review  (0  builds, labelled)", g.port), "no private tag: no family, no reviewable build");

    let (status, body) = get(g.port, "/api/runs");
    assert_eq!(status, 200, "{body}");
    let v: serde_json::Value = serde_json::from_str(&body).unwrap();
    let run = &v["runs"][0];
    assert_eq!((run["setup"].as_str(), run["run"].as_str()), (Some(SETUP), Some("v2-r1")));
    assert_eq!((run["score"]["passed"].as_u64(), run["score"]["total"].as_u64()), (Some(71), Some(75)));
    assert_eq!(v["runs"].as_array().unwrap().len(), 1);
    assert_eq!(v["colours"][0][0], SETUP);
    let judge = &v["judges"][0];
    assert_eq!((judge["package"].as_str(), judge["judge"].as_str(), judge["letter"].as_str(), judge["build"].as_str()), (Some(PACKAGE), Some("judge-1"), Some("A"), Some(UNBLINDED_AS)));
    assert_eq!(judge["judging"]["functional"]["high"], 1);

    // The two pages, and the review state in its labelled form.
    assert!(get(g.port, "/").1.contains("<html"), "the gallery page");
    assert!(get(g.port, "/review").1.contains("<html"), "the review page");
    let (status, state) = get(g.port, "/api/review/state");
    let state: serde_json::Value = serde_json::from_str(&state).unwrap();
    assert_eq!((status, state["blind"].as_bool(), state["builds"].as_array().map(Vec::len)), (200, Some(false), Some(0)));

    let (ok, rest) = stop(g);
    assert!(ok, "a SIGTERM is a clean stop: {rest}");
    assert!(rest.contains("all walkthroughs recorded"), "{rest}");
    assert!(rest.contains("stopping the builds that are running"), "{rest}");
    // Everything it made is under the temp HOME and the temp private checkout.
    assert!(home.join(".cache/awesome-local-ai/vidi-gallery/record.config.ts").is_file());
    assert!(root.join("awesome-local-ai-bench-private/state/recording-secret").is_file());
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn started_blind_the_gallery_says_so() {
    let (root, repo, home) = world("blind");
    let (g, _first, second) = start(&repo, &home, &["--blind"]);
    assert!(second.trim_end().ends_with("(0  builds, blind)"), "{second}");
    let (_, state) = get(g.port, "/api/review/state");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&state).unwrap()["blind"], true);
    let (ok, rest) = stop(g);
    assert!(ok, "{rest}");
    std::fs::remove_dir_all(&root).unwrap();
}
