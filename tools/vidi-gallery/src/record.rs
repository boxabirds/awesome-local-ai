//! Recorded walkthroughs: a story's held-out tests run against a review build with Playwright's
//! trace (every step and every check, with a screencast) and video on. The suite itself is not
//! changed: a small wrapper config imports it and only turns recording on. The trace opens in
//! Playwright's own trace viewer, served locally, where each check is listed with its result and
//! clicking it shows the page at that moment.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

/// Written next to the gallery's cache; imports the suite's own config by absolute path.
pub fn write_config(acceptance: &Path, dir: &Path) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let acc = acceptance.display();
    let path = dir.join("record.config.ts");
    std::fs::write(
        &path,
        format!(
            "import base from '{acc}/playwright.config.ts';\n\
             // Review recordings: the held-out suite unchanged, plus a trace and a video of every test.\n\
             export default {{\n  ...base,\n  testDir: '{acc}/tests',\n  globalSetup: '{acc}/tests/global-setup.ts',\n  \
             reporter: [['json', {{ outputFile: process.env.ACCEPT_JSON }}]],\n  \
             use: {{ ...base.use, trace: 'on', video: 'on' }},\n}};\n"
        ),
    )?;
    Ok(path)
}

/// "1:DONE,2:DONE,3:PARTIAL,…": the stories built up to and including `build`, in build order,
/// with how each ended, as the suite expects in PROCESSED_STORIES.
pub fn processed(build_order: &[u64], statuses: &std::collections::BTreeMap<u64, String>, build: u64) -> String {
    let upto = build_order.iter().position(|&s| s == build).map(|i| i + 1).unwrap_or(build_order.len());
    build_order[..upto]
        .iter()
        .map(|s| format!("{s}:{}", statuses.get(s).map(String::as_str).unwrap_or("DONE")))
        .collect::<Vec<_>>()
        .join(",")
}

/// Run one story's tests against `ws` with recording on. Results land in `out` (report.json and
/// artifacts/). `port` is the app port; the suite's control server uses port + 1.
pub async fn record(acceptance: &Path, config: &Path, ws: &Path, story: u64, processed: &str, out: &Path, port: u16, owned: &[PathBuf]) -> anyhow::Result<()> {
    let _ = std::fs::remove_dir_all(out);
    std::fs::create_dir_all(out)?;
    let spec = format!("tests/story-{story:02}.spec.ts");
    if !acceptance.join(&spec).is_file() {
        anyhow::bail!("the held-out suite has no {spec}");
    }
    // The suite's control server listens on port + 1; a leftover from an earlier run makes the
    // whole suite fail with EADDRINUSE, so wait for both ports rather than record a failure.
    reap_listeners(&[port, port + 1], owned).await;
    wait_free(&[port, port + 1]).await?;
    let log = std::fs::File::create(out.join("run.log"))?;
    let mut cmd = tokio::process::Command::new("npx");
    cmd
        .args(["playwright", "test", &spec, "--config"])
        .arg(config)
        .current_dir(acceptance)
        .env("WORKSPACE", ws)
        .env("PROCESSED_STORIES", processed)
        .env("ACCEPT_PORT", port.to_string())
        .env("ACCEPT_JSON", out.join("report.json"))
        .env("ACCEPT_ARTIFACTS", out.join("artifacts"))
        .env("SHOT_DIR", out.join("shots"))
        .stdin(Stdio::null())
        .stdout(Stdio::from(log.try_clone()?))
        .stderr(Stdio::from(log));
    let status = run_in_own_group(cmd).await;
    reap_listeners(&[port, port + 1], owned).await;
    let status = status?;
    // A failing test exits non-zero; that's a result, not a recording failure. No report is.
    if !out.join("report.json").is_file() {
        anyhow::bail!("playwright exited {status} without a report (see run.log)");
    }
    // Every test refused a connection: the app never came up, so this recording shows nothing about it.
    if let Some(why) = app_never_started(&paths(out, out)) {
        anyhow::bail!("{why} (see run.log)");
    }
    Ok(())
}

const SECRET_BYTES: usize = 16;

/// A recording's directory name, from a secret: the review is blind, and a trace carries its output
/// paths (the viewer shows them), so neither the directory nor the trace may name the build.
pub fn blind_name(secret: &str, slug: &str, story: u64) -> String {
    let h = crate::builds::fnv1a(format!("{secret}\n{slug}\n{story}").as_bytes());
    format!("r{h:016x}")
}

/// The secret behind blind_name, made on first use and kept (next to the recordings, not under them).
pub fn secret(path: &Path) -> anyhow::Result<String> {
    if let Ok(s) = std::fs::read_to_string(path) {
        if !s.trim().is_empty() {
            return Ok(s.trim().to_string());
        }
    }
    let mut bytes = [0u8; SECRET_BYTES];
    use std::io::Read;
    std::fs::File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    let s: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, &s)?;
    Ok(s)
}

const PORT_WAIT: Duration = Duration::from_secs(30);
const PORT_POLL: Duration = Duration::from_millis(250);

async fn wait_free(ports: &[u16]) -> anyhow::Result<()> {
    let deadline = tokio::time::Instant::now() + PORT_WAIT;
    loop {
        let busy: Vec<u16> = ports.iter().copied().filter(|&p| std::net::TcpListener::bind(("127.0.0.1", p)).is_err()).collect();
        if busy.is_empty() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            anyhow::bail!("port(s) {busy:?} still in use after {}s", PORT_WAIT.as_secs());
        }
        tokio::time::sleep(PORT_POLL).await;
    }
}

/// Stop what still listens on `ports` if it is ours: running in (or from) one of `owned`, e.g. the
/// gallery's checkouts or the held-out suite. The suite starts the app server detached, in its own
/// session, so a recording that dies (or a gallery that stops) mid-run leaves it holding the port;
/// the recording's own process group doesn't include it. Anything else on the port is left alone.
pub async fn reap_listeners(ports: &[u16], owned: &[PathBuf]) {
    for &port in ports {
        let out = tokio::process::Command::new("lsof")
            .args(["-nP", "-t", &format!("-iTCP:{port}"), "-sTCP:LISTEN"])
            .output().await;
        let Ok(out) = out else { continue };
        for pid in String::from_utf8_lossy(&out.stdout).lines().filter_map(|l| l.trim().parse::<libc::pid_t>().ok()) {
            if !is_ours(pid, owned).await {
                eprintln!("recording port {port} is held by pid {pid}, which isn't the gallery's; leaving it");
                continue;
            }
            // SAFETY: getpgid/killpg/kill only look up and signal processes.
            unsafe {
                let group = libc::getpgid(pid);
                if group > 1 && group != libc::getpgrp() {
                    libc::killpg(group, libc::SIGKILL);
                } else {
                    libc::kill(pid, libc::SIGKILL);
                }
            }
        }
    }
}

async fn is_ours(pid: libc::pid_t, owned: &[PathBuf]) -> bool {
    let cwd = tokio::process::Command::new("lsof").args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"]).output().await;
    let cwd = cwd.map(|o| String::from_utf8_lossy(&o.stdout).lines().find_map(|l| l.strip_prefix('n').map(str::to_string)).unwrap_or_default()).unwrap_or_default();
    let cmd = tokio::process::Command::new("ps").args(["-o", "command=", "-p", &pid.to_string()]).output().await;
    let cmd = cmd.map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
    owned.iter().any(|root| {
        let r = root.to_string_lossy();
        !r.is_empty() && (Path::new(&cwd).starts_with(root) || cmd.contains(r.as_ref()))
    })
}

/// Run `cmd` as the leader of its own process group and, when it exits, kill whatever it left
/// behind (npx → playwright → the app server and the control server). Also killed if this future
/// is dropped, so a stopped gallery doesn't leave a recording's servers holding the ports.
pub async fn run_in_own_group(mut cmd: tokio::process::Command) -> anyhow::Result<std::process::ExitStatus> {
    let mut child = cmd.process_group(0).kill_on_drop(true).spawn()?;
    let pgid = child.id().map(|id| id as libc::pid_t);
    struct Reap(Option<libc::pid_t>);
    impl Drop for Reap {
        fn drop(&mut self) {
            if let Some(g) = self.0 {
                // SAFETY: killpg only sends a signal; the group is the one this child leads.
                unsafe { libc::killpg(g, libc::SIGKILL) };
            }
        }
    }
    let _reap = Reap(pgid);
    Ok(child.wait().await?)
}

/// Why a recording says nothing about the build, if every non-passing path failed to reach the app.
pub fn app_never_started(paths: &[Path_]) -> Option<String> {
    let failed: Vec<&Path_> = paths.iter().filter(|p| p.status != "passed" && p.status != "skipped").collect();
    let refused = |p: &&Path_| p.error.contains("ERR_CONNECTION_REFUSED");
    (!failed.is_empty() && failed.len() == paths.len() && failed.iter().all(refused))
        .then(|| "the app never started: every test's connection was refused".to_string())
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Path_ {
    /// The test's title: one path through the story.
    pub title: String,
    pub status: String,
    pub error: String,
    /// Relative to the recordings root, for the page to link.
    pub trace: Option<String>,
    pub video: Option<String>,
}

fn walk(suite: &Value, out: &mut Vec<Path_>, root: &Path) {
    for spec in suite.get("specs").and_then(Value::as_array).into_iter().flatten() {
        let title = spec.get("title").and_then(Value::as_str).unwrap_or("").to_string();
        for test in spec.get("tests").and_then(Value::as_array).into_iter().flatten() {
            let Some(result) = test.get("results").and_then(Value::as_array).and_then(|r| r.last()) else { continue };
            let attachment = |name: &str| {
                result.get("attachments").and_then(Value::as_array).into_iter().flatten()
                    .find(|a| a.get("name").and_then(Value::as_str) == Some(name))
                    .and_then(|a| a.get("path").and_then(Value::as_str))
                    .and_then(|p| Path::new(p).strip_prefix(root).ok().map(|r| r.to_string_lossy().to_string()))
            };
            let error = result.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or("");
            let error = strip_ansi(error).lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
            out.push(Path_ {
                title: title.clone(),
                status: result.get("status").and_then(Value::as_str).unwrap_or("").to_string(),
                error,
                trace: attachment("trace"),
                video: attachment("video"),
            });
        }
    }
    for s in suite.get("suites").and_then(Value::as_array).into_iter().flatten() {
        walk(s, out, root);
    }
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            for c in chars.by_ref() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// The recorded paths of one story, from its report; attachment paths made relative to `root`.
pub fn paths(out: &Path, root: &Path) -> Vec<Path_> {
    let Some(doc) = std::fs::read_to_string(out.join("report.json")).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) else {
        return Vec::new();
    };
    let mut v = Vec::new();
    for s in doc.get("suites").and_then(Value::as_array).into_iter().flatten() {
        walk(s, &mut v, root);
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A listener in its own session (as the suite's app server is), running in `dir`, on `port`.
    fn detached_listener(dir: &Path, port: u16) -> u32 {
        std::fs::create_dir_all(dir).unwrap();
        let py = format!("import os,socket,time\nos.setsid()\ns=socket.socket()\ns.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)\ns.bind(('127.0.0.1',{port}))\ns.listen()\ntime.sleep(60)\n");
        let child = std::process::Command::new("python3").arg("-c").arg(py).current_dir(dir).spawn().unwrap();
        let id = child.id();
        for _ in 0..50 {
            if std::net::TcpListener::bind(("127.0.0.1", port)).is_err() {
                return id;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        panic!("listener never came up");
    }

    fn free_port() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port()
    }

    #[tokio::test]
    async fn a_detached_server_of_ours_left_on_a_recording_port_is_stopped() {
        let root = std::env::temp_dir().join(format!("vidi-reap-{}", std::process::id())).canonicalize_or_self();
        let port = free_port();
        let pid = detached_listener(&root.join("checkouts/run@05"), port);
        reap_listeners(&[port], &[root.clone()]).await;
        tokio::time::sleep(PORT_POLL).await;
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok(), "port {port} still held by {pid}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[tokio::test]
    async fn someone_elses_listener_is_left_alone() {
        let ours = std::env::temp_dir().join(format!("vidi-reap-ours-{}", std::process::id())).canonicalize_or_self();
        let theirs = std::env::temp_dir().join(format!("vidi-reap-theirs-{}", std::process::id()));
        let port = free_port();
        let pid = detached_listener(&theirs, port);
        reap_listeners(&[port], &[ours.clone()]).await;
        tokio::time::sleep(PORT_POLL).await;
        assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_err(), "killed a listener that isn't ours");
        unsafe { libc::killpg(pid as libc::pid_t, libc::SIGKILL) };
        let _ = std::fs::remove_dir_all(&theirs);
    }

    trait CanonOrSelf { fn canonicalize_or_self(self) -> PathBuf; }
    impl CanonOrSelf for PathBuf {
        fn canonicalize_or_self(self) -> PathBuf {
            std::fs::create_dir_all(&self).unwrap();
            self.canonicalize().unwrap()
        }
    }

    #[test]
    fn a_recordings_directory_name_says_nothing_about_its_build() {
        let a = blind_name("s3cret", "qwen_3.8_27b_ubuntu_nvidia4090_llamacpp-opencode_canvas-pi-03", 5);
        assert!(!a.contains("qwen") && !a.contains("canvas") && !a.contains("nvidia"), "{a}");
        assert_eq!(a, blind_name("s3cret", "qwen_3.8_27b_ubuntu_nvidia4090_llamacpp-opencode_canvas-pi-03", 5));
        assert_ne!(a, blind_name("s3cret", "qwen_3.8_27b_ubuntu_nvidia4090_llamacpp-opencode_canvas-pi-03", 6));
        assert_ne!(a, blind_name("other", "qwen_3.8_27b_ubuntu_nvidia4090_llamacpp-opencode_canvas-pi-03", 5));
    }

    #[test]
    fn the_secret_is_made_once_and_then_kept() {
        let f = std::env::temp_dir().join(format!("vidi-rec-secret-{}", std::process::id()));
        let _ = std::fs::remove_file(&f);
        let first = secret(&f).unwrap();
        assert!(first.len() >= 32);
        assert_eq!(first, secret(&f).unwrap());
        let _ = std::fs::remove_file(&f);
    }

    #[tokio::test]
    async fn a_run_leaves_nothing_behind_in_its_process_group() {
        // The child starts a background process that would outlive it, then exits (as npx does
        // when playwright fails and a server it started keeps running).
        let pidfile = std::env::temp_dir().join(format!("vidi-rec-orphan-{}", std::process::id()));
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(format!("sleep 60 & echo $! > {}; exit 1", pidfile.display()));
        let status = run_in_own_group(cmd).await.unwrap();
        assert!(!status.success());
        let pid: libc::pid_t = std::fs::read_to_string(&pidfile).unwrap().trim().parse().unwrap();
        let _ = std::fs::remove_file(&pidfile);
        tokio::time::sleep(PORT_POLL).await;
        // SAFETY: signal 0 only checks that the process exists.
        let alive = unsafe { libc::kill(pid, 0) } == 0;
        assert!(!alive, "the background process {pid} survived the run");
    }

    #[tokio::test]
    async fn a_port_held_by_someone_else_is_waited_for() {
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = held.local_addr().unwrap().port();
        let waiter = tokio::spawn(async move { wait_free(&[port]).await });
        tokio::time::sleep(PORT_POLL * 2).await;
        assert!(!waiter.is_finished(), "went ahead while the port was held");
        drop(held);
        waiter.await.unwrap().unwrap();
    }

    #[test]
    fn processed_stops_at_the_build_and_keeps_statuses() {
        let order = [1, 2, 3, 4, 5, 7];
        let st: std::collections::BTreeMap<u64, String> = [(3, "PARTIAL".to_string())].into();
        assert_eq!(processed(&order, &st, 5), "1:DONE,2:DONE,3:PARTIAL,4:DONE,5:DONE");
        assert_eq!(processed(&order, &st, 1), "1:DONE");
    }

    fn path(status: &str, error: &str) -> Path_ {
        Path_ { title: "t".into(), status: status.into(), error: error.into(), trace: None, video: None }
    }

    #[test]
    fn a_recording_where_the_app_never_started_is_rejected() {
        let refused = "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:19813/";
        assert!(app_never_started(&[path("failed", refused), path("failed", refused)]).is_some());
        // a real failure among them means the app did start
        assert!(app_never_started(&[path("failed", refused), path("failed", "expect(locator).toBeVisible()")]).is_none());
        assert!(app_never_started(&[path("passed", ""), path("failed", refused)]).is_none());
        assert!(app_never_started(&[]).is_none());
    }

    #[test]
    fn a_report_gives_each_path_its_status_error_and_recordings() {
        let root = Path::new("/rec");
        let report = serde_json::json!({"suites": [{"title": "story-01.spec.ts", "suites": [{"title": "story 1", "specs": [
            {"title": "golden path", "tests": [{"results": [{"status": "passed", "attachments": [
                {"name": "video", "path": "/rec/r/story-01/artifacts/a/video.webm"},
                {"name": "trace", "path": "/rec/r/story-01/artifacts/a/trace.zip"}]}]}]},
            {"title": "reset view", "tests": [{"results": [{"status": "failed",
                "error": {"message": "\u{1b}[31mError: expect(locator).toBeVisible()\u{1b}[39m\n\nLocator: …"}, "attachments": []}]}]}
        ]}]}]});
        let dir = std::env::temp_dir().join(format!("vidi-rec-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("report.json"), report.to_string()).unwrap();
        let got = paths(&dir, root);
        assert_eq!(got[0].trace.as_deref(), Some("r/story-01/artifacts/a/trace.zip"));
        assert_eq!(got[0].video.as_deref(), Some("r/story-01/artifacts/a/video.webm"));
        assert_eq!((got[1].status.as_str(), got[1].error.as_str()), ("failed", "Error: expect(locator).toBeVisible()"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
