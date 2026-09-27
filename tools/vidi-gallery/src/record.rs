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
pub async fn record(acceptance: &Path, config: &Path, ws: &Path, story: u64, processed: &str, out: &Path, port: u16) -> anyhow::Result<()> {
    let _ = std::fs::remove_dir_all(out);
    std::fs::create_dir_all(out)?;
    let spec = format!("tests/story-{story:02}.spec.ts");
    if !acceptance.join(&spec).is_file() {
        anyhow::bail!("the held-out suite has no {spec}");
    }
    // The suite's control server listens on port + 1; a leftover from an earlier run makes the
    // whole suite fail with EADDRINUSE, so wait for both ports rather than record a failure.
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
    let status = run_in_own_group(cmd).await?;
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
