//! Story 23 (readers.gallery), TC-70 to TC-73: the real `vidi-gallery` binary over a fixture lake, through HTTP. The checkout
//! holds no run; the lake (the private checkout's `state/`, the gallery's default) holds the runs and their code in
//! `code.git`. A spy `git` first on the PATH logs every git command the gallery runs, so the test can say it never pulls a
//! checkout and only reads the lake's code repository.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const NODE: &str = "node-t";
const ID_PREFIX: &str = "combinations/q/1/s/os/hw/eng-cli/benchmarks/vidi/";
const SLUG_PREFIX: &str = "q_1_s_os_hw_eng-cli_";
const START_DEADLINE: Duration = Duration::from_secs(30);

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

struct World {
    root: PathBuf,
    repo: PathBuf,
    state: PathBuf,
    home: PathBuf,
    spy_log: PathBuf,
    bin: PathBuf,
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

impl World {
    fn new(tag: &str) -> World {
        let root = std::env::temp_dir().join(format!("vidi-gallery-lake-it-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let repo = root.join("awesome-local-ai");
        std::fs::create_dir_all(&repo).unwrap();
        let state = root.join("awesome-local-ai-bench-private/state");
        std::fs::create_dir_all(state.join("collected")).unwrap();
        std::fs::create_dir_all(state.join("reference")).unwrap();
        git(&state, &["init", "-q", "--bare", "code.git"]);
        let home = root.join("home");
        std::fs::create_dir_all(&home).unwrap();
        // The spy: logs its arguments and working folder, then runs the real git.
        let real = String::from_utf8(Command::new("sh").args(["-c", "command -v git"]).output().unwrap().stdout).unwrap().trim().to_string();
        let bin = root.join("spy-bin");
        std::fs::create_dir_all(&bin).unwrap();
        let spy_log = root.join("git-calls.log");
        std::fs::write(bin.join("git"), format!("#!/bin/sh\nprintf '%s | %s\\n' \"$PWD\" \"$*\" >> '{}'\nexec '{real}' \"$@\"\n", spy_log.display())).unwrap();
        Command::new("chmod").arg("+x").arg(bin.join("git")).status().unwrap();
        World { root, repo, state, home, spy_log, bin }
    }

    /// A run in the lake: run.json, metrics.json naming each story's commit, and (unless `code` is false) its code in code.git,
    /// one commit per story adding `story-NN.txt`, with the story refs dbench makes.
    fn add_run(&self, name: &str, stories: &[u64], code: bool) -> PathBuf {
        let id = format!("{ID_PREFIX}{name}");
        let src = self.root.join("src").join(name);
        std::fs::create_dir_all(&src).unwrap();
        git(&src, &["init", "-q"]);
        let mut commits = serde_json::Map::new();
        for &s in stories {
            std::fs::write(src.join(format!("story-{s:02}.txt")), format!("{s}\n")).unwrap();
            git(&src, &["add", "-A"]);
            git(&src, &["commit", "-q", "-m", &format!("story {s}")]);
            commits.insert(s.to_string(), serde_json::json!({"commit": git(&src, &["rev-parse", "HEAD"])}));
        }
        let run = self.state.join("collected").join(NODE).join(&id);
        std::fs::create_dir_all(&run).unwrap();
        std::fs::write(run.join("run.json"), r#"{"pack_version": "vidi-v2.0-pre2"}"#).unwrap();
        std::fs::write(run.join("metrics.json"), serde_json::json!({"stories": commits}).to_string()).unwrap();
        if code {
            let code_repo = self.state.join("code.git");
            let prefix = format!("refs/runs/{NODE}/{id}");
            git(&code_repo, &["fetch", "-q", "--no-tags", src.to_str().unwrap(), &format!("+refs/heads/*:{prefix}/heads/*")]);
            for (s, c) in &commits {
                let n: u64 = s.parse().unwrap();
                git(&code_repo, &["update-ref", &format!("{prefix}/story/{n:02}"), c["commit"].as_str().unwrap()]);
            }
        }
        run
    }
}

struct Gallery {
    child: Child,
    port: u16,
}

impl Drop for Gallery {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Starts the gallery on a port the system picks and reads it from the gallery's first line.
fn start(w: &World) -> Gallery {
    let path = format!("{}:{}", w.bin.display(), std::env::var("PATH").unwrap_or_default());
    let mut child = Command::new(env!("CARGO_BIN_EXE_vidi-gallery"))
        .arg("--repo")
        .arg(&w.repo)
        .args(["--port", "0"])
        .env("HOME", &w.home)
        .env("PATH", path)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut out = BufReader::new(child.stdout.take().unwrap());
    let mut g = Gallery { child, port: 0 };
    let started = Instant::now();
    loop {
        let mut line = String::new();
        assert_ne!(out.read_line(&mut line).unwrap(), 0, "the gallery ended before it said where it listens");
        if let Some(rest) = line.strip_prefix("vidi-gallery: http://127.0.0.1:") {
            g.port = rest.split('/').next().and_then(|p| p.parse().ok()).expect("a port");
        }
        if line.starts_with("story review: ") {
            break;
        }
        assert!(started.elapsed() < START_DEADLINE, "the gallery did not start");
    }
    std::thread::spawn(move || {
        let mut sink = String::new();
        let _ = out.read_to_string(&mut sink);
    });
    g
}

fn request(port: u16, method: &str, path: &str) -> (u16, serde_json::Value) {
    let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
    write!(s, "{method} {path} HTTP/1.0\r\nContent-Length: 0\r\n\r\n").unwrap();
    let mut raw = String::new();
    s.read_to_string(&mut raw).unwrap();
    let status = raw.split_whitespace().nth(1).unwrap().parse().unwrap();
    let body = raw.split_once("\r\n\r\n").map(|(_, b)| b.to_string()).unwrap_or_default();
    (status, serde_json::from_str(&body).unwrap_or(serde_json::Value::Null))
}

#[test]
fn the_gallery_lists_opens_and_scores_runs_from_the_lake_and_never_pulls_a_checkout() {
    let w = World::new("lake");
    let built = w.add_run("built", &[1, 2, 3], true);
    // TC-72: the full held-out result is in the lake copy only; there is no private copy of the run anywhere
    std::fs::create_dir_all(built.join("stories/03")).unwrap();
    std::fs::write(built.join("stories/03/accept.json"), r#"{"passed": 9, "total": 12, "tests": []}"#).unwrap();
    // TC-73: a record whose code is not in the lake; it keeps a bundle file, which is not code
    let uncoded = w.add_run("uncoded", &[1], false);
    std::fs::create_dir_all(uncoded.join("workspace")).unwrap();
    std::fs::write(uncoded.join("workspace.bundle"), "not code").unwrap();
    let g = start(&w);

    // TC-70: the list is the lake's runs; the checkout holds none
    assert!(std::fs::read_dir(&w.repo).unwrap().next().is_none(), "the checkout is empty");
    let (status, v) = request(g.port, "GET", "/api/runs");
    assert_eq!(status, 200, "{v}");
    let runs = v["runs"].as_array().unwrap();
    let names: Vec<&str> = runs.iter().map(|r| r["run"].as_str().unwrap()).collect();
    assert_eq!(names, ["built", "uncoded"]);
    let built_run = &runs[0];
    assert_eq!((built_run["has_history"].as_bool(), built_run["score"]["passed"].as_u64(), built_run["score"]["total"].as_u64()),
               (Some(true), Some(9), Some(12)), "TC-72: the score from the lake copy's held-out result");
    assert_eq!(runs[1]["has_history"].as_bool(), Some(false), "TC-73: no code in the lake");

    // TC-71: opening the run checks out its last story, 3, equal to code.git at story/03
    let slug = format!("{SLUG_PREFIX}built");
    let (status, v) = request(g.port, "POST", &format!("/api/open/{slug}"));
    assert_eq!(status, 200, "{v}");
    let checkout = w.home.join(".cache/awesome-local-ai/vidi-gallery/checkouts").join(format!("{slug}@03"));
    let story_3 = git(&w.state.join("code.git"), &["rev-parse", &format!("refs/runs/{NODE}/{ID_PREFIX}built/story/03")]);
    assert_eq!(git(&checkout, &["rev-parse", "HEAD"]), story_3);
    assert_eq!(git(&checkout, &["status", "--porcelain"]), "", "the files are that commit's");
    assert!(checkout.join("story-03.txt").is_file());
    let _ = request(g.port, "POST", &format!("/api/stop/{slug}"));

    // TC-73: the run without code opens its hand-built folder, never the bundle
    let (status, v) = request(g.port, "POST", &format!("/api/open/{SLUG_PREFIX}uncoded"));
    assert_eq!(status, 200, "{v}");
    let _ = request(g.port, "POST", &format!("/api/stop/{SLUG_PREFIX}uncoded"));
    drop(g);

    // No pull, no fetch from a remote, nothing run in the checkout: git ran only on the lake's code repository and the
    // working copies made from it (and `describe` in the private checkout, for the pack version).
    let calls = std::fs::read_to_string(&w.spy_log).unwrap_or_default();
    assert!(!calls.is_empty(), "the spy saw the checkout being made");
    let repo = w.repo.canonicalize().unwrap();
    for call in calls.lines() {
        assert!(!call.contains(" pull") && !call.contains("ls-files"), "{call}");
        // the checkout's path as a whole path, not as the prefix of `awesome-local-ai-bench-private`
        let on_checkout = [repo.display().to_string(), w.repo.display().to_string()]
            .iter()
            .any(|r| call.split([' ', '|']).any(|word| word == r || word.starts_with(&format!("{r}/"))));
        assert!(!on_checkout, "git ran on the checkout: {call}");
        assert!(!call.contains("workspace.bundle"), "a bundle was read: {call}");
    }
    assert!(calls.lines().any(|c| c.contains("code.git")), "the code came from the lake's code repository: {calls}");
}
