//! The real `vidi-gallery` binary against a temp repo, a temp private checkout beside it and a temp HOME: it starts, says where
//! it listens, serves the run list with the judges unblinded from the keys on this machine, and stops cleanly on SIGTERM.
//! Nothing outside the temp directory is read or written: the cache, the keys and the private checkout are all under it.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
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

/// What the machine would have: a checkout with no run in it, a private checkout beside it holding the lake (its `state/`,
/// the gallery's default) with one scored run and one independent judge's result, and a HOME holding the key that says which
/// build that judge's letter was.
fn world(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("vidi-gallery-it-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let (repo, home) = (root.join("awesome-local-ai"), root.join("home"));
    std::fs::create_dir_all(&repo).unwrap();
    let run = root.join("awesome-local-ai-bench-private/state/collected/node-t").join(RUN);
    std::fs::create_dir_all(run.join("workspace")).unwrap();
    std::fs::write(run.join("run.json"), "{}").unwrap();
    std::fs::write(run.join("metrics.json"), r#"{"stories": {}}"#).unwrap();
    std::fs::write(run.join("accept-final-summary.json"), r#"{"passed": 71, "total": 75}"#).unwrap();
    let results = root.join("awesome-local-ai-bench-private/gradings").join(PACKAGE).join("results/judge-1");
    std::fs::create_dir_all(&results).unwrap();
    std::fs::write(results.join("build-A.jsonl"), r#"{"category": "functional", "severity": "high"}"#).unwrap();
    std::fs::create_dir_all(home.join(".vidi-bench/keys")).unwrap();
    std::fs::write(home.join(".vidi-bench/keys").join(format!("{PACKAGE}.json")), format!(r#"{{"A": "{UNBLINDED_AS}"}}"#)).unwrap();
    (root, repo, home)
}

/// Starts the gallery on a port the system picks (`--port 0`) and reads the port from what it says: a port chosen here and
/// freed before the gallery binds it can be taken by another test in between ("Address already in use").
fn start(repo: &Path, home: &Path, extra: &[&str]) -> (Gallery, String, String) {
    start_with(repo, home, extra, &[])
}

fn start_with(repo: &Path, home: &Path, extra: &[&str], env: &[(&str, &std::ffi::OsStr)]) -> (Gallery, String, String) {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_vidi-gallery"));
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd
        .arg("--repo")
        .arg(repo)
        .args(["--port", "0"])
        .args(extra)
        .env("HOME", home)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let stdout = BufReader::new(child.stdout.take().unwrap());
    // Held from the start, so a failure below kills the gallery instead of leaving it running.
    let mut g = Gallery { child, stdout, port: 0, early: String::new() };
    let (mut first, mut second) = (String::new(), String::new());
    while first.is_empty() || second.is_empty() {
        let mut line = String::new();
        assert_ne!(g.stdout.read_line(&mut line).unwrap(), 0, "the gallery ended before it said where it listens: {}", g.early);
        if line.starts_with("vidi-gallery: ") {
            first = line;
        } else if line.starts_with("story review: ") {
            second = line;
        } else {
            g.early.push_str(&line);
        }
    }
    let port = first
        .split("http://127.0.0.1:")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .and_then(|p| p.parse().ok())
        .unwrap_or_else(|| panic!("no port in {first:?}"));
    assert_ne!(port, 0, "the gallery says the port it is listening on, not the one it was asked for: {first}");
    g.port = port;
    (g, first, second)
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

/// A POST with no body over a plain connection: the status.
fn post(port: u16, path: &str) -> u16 {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(s, "POST {path} HTTP/1.0\r\nContent-Length: 0\r\n\r\n").unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw).unwrap();
    raw.split_whitespace().nth(1).unwrap().parse().unwrap()
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

/// How long an install that was stopped may take to be gone (the gallery's own grace is 3 s).
const GONE_DEADLINE: Duration = Duration::from_secs(10);
/// Two processes the fake install starts: itself, and a child of its own, as npm's are.
const INSTALL_PROCESSES: usize = 2;

/// A world whose `npm` (first on the PATH) records its pid and its child's in `pids`, then waits for ever: an install
/// that is still running whenever the test acts.
fn hanging_install(tag: &str) -> (PathBuf, PathBuf, PathBuf, PathBuf, std::ffi::OsString) {
    let (root, repo, home) = world(tag);
    let bin = root.join("fake-bin");
    std::fs::create_dir_all(&bin).unwrap();
    let pids = root.join("install.pids");
    let npm = bin.join("npm");
    std::fs::write(&npm, format!("#!/bin/sh\necho $$ >> '{p}'\nsleep 600 &\necho $! >> '{p}'\nwait\n", p = pids.display())).unwrap();
    std::fs::set_permissions(&npm, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let path = std::env::join_paths(std::iter::once(bin.clone()).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap()))).unwrap();
    (root, repo, home, pids, path)
}

/// Opens the world's run and waits until its install has started: the install's pids.
fn open_until_installing(g: &Gallery, pids: &Path) -> Vec<i32> {
    let (_, body) = get(g.port, "/api/runs");
    let slug = serde_json::from_str::<serde_json::Value>(&body).unwrap()["runs"][0]["slug"].as_str().unwrap().to_string();
    assert_eq!(post(g.port, &format!("/api/open/{slug}")), 200);
    let start = Instant::now();
    loop {
        let found: Vec<i32> = std::fs::read_to_string(pids).unwrap_or_default().lines().filter_map(|l| l.trim().parse().ok()).collect();
        if found.len() == INSTALL_PROCESSES {
            return found;
        }
        assert!(start.elapsed() < STOP_DEADLINE, "the install never started");
        std::thread::sleep(POLL);
    }
}

fn alive(pid: i32) -> bool {
    // SAFETY: signal 0 only asks whether the process exists.
    unsafe { libc::kill(pid, 0) == 0 }
}

/// Waits for every pid to be gone; the ones still alive at the deadline (killed then, so a failure leaves nothing).
fn left_running(pids: &[i32]) -> Vec<i32> {
    let start = Instant::now();
    while pids.iter().any(|&p| alive(p)) && start.elapsed() < GONE_DEADLINE {
        std::thread::sleep(POLL);
    }
    let left: Vec<i32> = pids.iter().copied().filter(|&p| alive(p)).collect();
    for &p in &left {
        // SAFETY: kill(2) on a process this test's fake install started.
        unsafe { libc::kill(p, libc::SIGKILL) };
    }
    left
}

#[test]
fn a_build_stopped_while_it_installs_leaves_no_install_running_and_does_not_start() {
    let (root, repo, home, pids, path) = hanging_install("stop-installing");
    let (g, _, _) = start_with(&repo, &home, &[], &[("PATH", &path)]);
    let install = open_until_installing(&g, &pids);
    let (_, body) = get(g.port, "/api/runs");
    let slug = serde_json::from_str::<serde_json::Value>(&body).unwrap()["runs"][0]["slug"].as_str().unwrap().to_string();
    assert_eq!(post(g.port, &format!("/api/stop/{slug}")), 204);
    assert_eq!(left_running(&install), Vec::<i32>::new(), "the install of a stopped build is still running");
    let (_, status) = get(g.port, "/api/status");
    assert_eq!(serde_json::from_str::<serde_json::Value>(&status).unwrap(), serde_json::json!({}), "a stopped build has no state");
    let (ok, rest) = stop(g);
    assert!(ok, "{rest}");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_gallery_stopped_while_a_build_installs_leaves_no_install_running() {
    let (root, repo, home, pids, path) = hanging_install("sigterm-installing");
    let (g, _, _) = start_with(&repo, &home, &[], &[("PATH", &path)]);
    let install = open_until_installing(&g, &pids);
    let (ok, rest) = stop(g);
    assert!(ok, "{rest}");
    assert_eq!(left_running(&install), Vec::<i32>::new(), "the install outlived the gallery");
    std::fs::remove_dir_all(&root).unwrap();
}
