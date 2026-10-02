//! End-to-end: jobs run the harness of the latest release, not of main. The real `dbench serve`
//! binary against a temp checkout with a bare remote and a fake harness; tags, commits and pushes
//! happen only inside those temp repos.

use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use dbench::harness::{KEEP_RELEASES, MANIFEST_FILE, RELEASES_DIR, RESULTS_ROOT_SUPPORT};
use dbench::job::SPEC_BENCH_ENTRY;
use dbench::release::{CHECKS_FILE, MAIN_BRANCH, REMOTE};

const DEADLINE: Duration = Duration::from_secs(30);
const POLL: Duration = Duration::from_millis(100);
const MAX_RESTARTS: u32 = 2;
const BACKOFF_MS: &str = "100";
const GRACE_MS: &str = "1000";
const TREE_POLL_MS: &str = "100";
const INSTALL_ID: &str = "fake-install";
const COMBINATION: &str = "test/combo";
const PACK: &str = "benchmarks/fakepack";
const PACK_NAME: &str = "fakepack";
const EXECUTABLE: u32 = 0o755;
const WRITE_BITS: u32 = 0o222;
const OWNER_ALL: u32 = 0o700;

const TAG_1: &str = "harness-v2026.10.01.1";
const TAG_2: &str = "harness-v2026.10.01.2";
const TAG_10: &str = "harness-v2026.10.01.10";
const TAG_NEXT_DAY: &str = "harness-v2026.10.02.1";
/// Newer than every other by name, but on a commit main doesn't have.
const TAG_OFF_MAIN: &str = "harness-v2099.01.01.1";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct TempRoot(PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        make_writable(&self.0);
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Release directories are read-only; give the owner write access back so they can be removed.
fn make_writable(dir: &Path) {
    let Ok(meta) = std::fs::symlink_metadata(dir) else {
        return;
    };
    if meta.is_symlink() {
        return;
    }
    let mode = meta.permissions().mode();
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode | OWNER_ALL));
    if meta.is_dir() {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            make_writable(&e.path());
        }
    }
}

/// The fake generic harness. It says which version it is and where it runs from, writes its result
/// under the results root, and with --record commits and pushes it there, as drive.py does.
const HARNESS: &str = r#"#!/usr/bin/env bash
set -euo pipefail
VERSION="@VERSION@"
INSTALL_ID="$1"; shift
RUN_ID=""; PACK=""; RECORD=0; FROM_RUN=""; FROM_STORY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pack) PACK="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --scope|--client|--only) shift 2 ;;
    --from-run) FROM_RUN="$2"; shift 2 ;;
    --from-story) FROM_STORY="$2"; shift 2 ;;
    --record) RECORD=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODE_ROOT="$(cd "$HERE/../../.." && pwd)"
ROOT="${SPEC_BENCH_RESULTS_ROOT:-$CODE_ROOT}"
echo "harness: $VERSION"
echo "code-root: $CODE_ROOT"
echo "results-root: ${SPEC_BENCH_RESULTS_ROOT:-unset}"
if [[ -n "$FROM_RUN" ]]; then echo "from-run: $FROM_RUN"; fi
if [[ -n "$FROM_STORY" ]]; then echo "from-story: $FROM_STORY"; fi
if [[ -f "$CODE_ROOT/RELEASE.json" ]]; then echo "manifest: $(tr -d ' \n' < "$CODE_ROOT/RELEASE.json")"; fi
COMBINATION="$(sed -n 's/^COMBINATION="\(.*\)"/\1/p' "$HOME/.local/share/$INSTALL_ID/install.env")"
RUN_DIR="$ROOT/combinations/$COMBINATION/benchmarks/$(basename "$PACK")/$RUN_ID"
mkdir -p "$RUN_DIR"
@BODY@
echo "$VERSION" > "$RUN_DIR/result.txt"
if [[ "$RECORD" == 1 ]]; then
  git -C "$ROOT" add -- "$RUN_DIR"
  git -C "$ROOT" commit -q -m "record $RUN_ID by $VERSION"
  git -C "$ROOT" push -q origin HEAD:main
fi
"#;

/// What main has after the release: a harness that fails at once.
const BROKEN: &str = "echo \"main-broken\" >&2; exit 1";
/// The first attempt says it has started, waits for `go`, and fails; the restart succeeds.
const GATED: &str = r#"if [[ ! -e "$RUN_DIR/attempt1" ]]; then
  touch "$RUN_DIR/attempt1"
  while [[ ! -e "$RUN_DIR/go" ]]; do sleep 0.1; done
  exit 1
fi"#;

fn harness(version: &str, body: &str) -> String {
    HARNESS
        .replace("@VERSION@", version)
        .replace("@BODY@", body)
}

/// A release says which paths are the harness (what a node materialises), next to its checks.
const CHECKS: &str = r#"paths = ["benchmarks/**", "tools/**"]
harness = ["benchmarks/spec-bench", "benchmarks/perf"]

[[check]]
name = "nothing"
dir = "."
command = ["true"]
"#;
const CHECKS_WITHOUT_HARNESS: &str = r#"paths = ["benchmarks/**", "tools/**"]

[[check]]
name = "nothing"
dir = "."
command = ["true"]
"#;

struct Env {
    _root: TempRoot,
    /// The node's checkout: where results are written, committed and pushed.
    repo: PathBuf,
    /// Another clone, standing in for wherever main is pushed and releases are cut.
    dev: PathBuf,
    remote: PathBuf,
    home: PathBuf,
    user_home: PathBuf,
}

fn git_cmd(dir: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(dir);
    for (k, v) in git_env() {
        c.env(k, v);
    }
    c
}

/// git, cut off from the developer's own configuration (signing, hooks, default branch).
fn git_env() -> [(&'static str, &'static str); 6] {
    [
        ("GIT_CONFIG_GLOBAL", "/dev/null"),
        ("GIT_CONFIG_NOSYSTEM", "1"),
        ("GIT_AUTHOR_NAME", "Test"),
        ("GIT_AUTHOR_EMAIL", "test@example.invalid"),
        ("GIT_COMMITTER_NAME", "Test"),
        ("GIT_COMMITTER_EMAIL", "test@example.invalid"),
    ]
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = git_cmd(dir).args(args).output().expect("run git");
    assert!(
        out.status.success(),
        "git {args:?} in {}: {}",
        dir.display(),
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn write(repo: &Path, rel: &str, text: &str) {
    let path = repo.join(rel);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(&path, text).unwrap();
}

/// Commit a harness version on main in the dev clone and push it. Returns the commit.
fn push_main(env: &Env, version: &str, body: &str) -> String {
    write(&env.dev, SPEC_BENCH_ENTRY, &harness(version, body));
    let entry = env.dev.join(SPEC_BENCH_ENTRY);
    std::fs::set_permissions(&entry, std::fs::Permissions::from_mode(EXECUTABLE)).unwrap();
    git(&env.dev, &["add", "-A"]);
    git(
        &env.dev,
        &["commit", "-q", "-m", &format!("harness {version}")],
    );
    // The node pushes its records to main too: go on top of them.
    git(&env.dev, &["pull", "-q", "--rebase", REMOTE, MAIN_BRANCH]);
    git(
        &env.dev,
        &["push", "-q", REMOTE, &format!("HEAD:{MAIN_BRANCH}")],
    );
    git(&env.dev, &["rev-parse", "HEAD"])
}

fn push_tag(env: &Env, tag: &str, commit: &str) {
    git(&env.dev, &["tag", "--annotate", "-m", tag, tag, commit]);
    git(
        &env.dev,
        &["push", "-q", REMOTE, &format!("refs/tags/{tag}")],
    );
}

/// A released harness version: committed on main, tagged, both pushed. Returns the commit.
fn release(env: &Env, tag: &str, version: &str, body: &str) -> String {
    let commit = push_main(env, version, body);
    push_tag(env, tag, &commit);
    commit
}

fn setup() -> Env {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-harness-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let remote = root.join("remote.git");
    let dev = root.join("dev");
    let repo = root.join("repo");
    git(
        &root,
        &["init", "-q", "--bare", "-b", MAIN_BRANCH, "remote.git"],
    );
    git(&root, &["clone", "-q", "remote.git", "dev"]);
    write(&dev, CHECKS_FILE, CHECKS);
    write(&dev, "benchmarks/perf/thermal.py", "# fake\n");
    write(
        &dev,
        RESULTS_ROOT_SUPPORT,
        "# fake: the harness reads its results root here\n",
    );
    write(&dev, "tools/other/README.md", "not part of the harness\n");
    write(
        &dev,
        &format!("combinations/{COMBINATION}/config.sh"),
        &format!("INSTALL_ID=\"{INSTALL_ID}\"\n"),
    );
    write(&dev, SPEC_BENCH_ENTRY, &harness("v0", ""));
    git(&dev, &["add", "-A"]);
    git(&dev, &["commit", "-q", "-m", "first"]);
    git(
        &dev,
        &["push", "-q", REMOTE, &format!("HEAD:{MAIN_BRANCH}")],
    );
    git(&root, &["clone", "-q", "remote.git", "repo"]);
    let user_home = root.join("userhome");
    let share = user_home.join(".local/share").join(INSTALL_ID);
    std::fs::create_dir_all(&share).unwrap();
    std::fs::write(
        share.join("install.env"),
        format!("INSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\nBACKEND=\"fake\"\n"),
    )
    .unwrap();
    Env {
        home: root.join("dbench-home"),
        repo,
        dev,
        remote,
        user_home,
        _root: TempRoot(root),
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

fn start(env: &Env, extra: &[&str]) -> Server {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_dbench"));
    cmd.args(["serve", "--bind", "127.0.0.1:0"])
        .arg("--repo")
        .arg(&env.repo)
        .arg("--home")
        .arg(&env.home)
        .arg("--share-dir")
        .arg(env.user_home.join(".local/share"))
        .args(["--max-restarts", &MAX_RESTARTS.to_string()])
        .args([
            "--restart-backoff-ms",
            BACKOFF_MS,
            "--cancel-grace-ms",
            GRACE_MS,
            "--tree-poll-ms",
            TREE_POLL_MS,
        ])
        .args(extra)
        .env("HOME", &env.user_home)
        .envs(git_env())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
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
    async fn get(&self, path: &str) -> Value {
        let resp = self
            .http
            .get(format!("{}{path}", self.base))
            .bearer_auth(&self.token)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 200, "{path}");
        resp.json().await.unwrap()
    }
    async fn submit(&self, id: &str, record: bool) {
        let spec = json!({"install_id": INSTALL_ID, "pack": PACK, "run_id": id, "client": "pi", "record": record});
        let resp = self
            .http
            .put(format!("{}/v1/jobs/{id}", self.base))
            .bearer_auth(&self.token)
            .json(&spec)
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status().as_u16(),
            201,
            "{}",
            resp.text().await.unwrap()
        );
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
    async fn wait_status(&self, id: &str, status: &str) -> Value {
        let start = Instant::now();
        loop {
            let v = self.get(&format!("/v1/jobs/{id}")).await;
            if v["state"]["status"] == status {
                return v;
            }
            let ended = ["done", "failed", "cancelled"]
                .iter()
                .any(|s| v["state"]["status"] == *s);
            assert!(
                !ended && start.elapsed() < DEADLINE,
                "waiting for {id} to be {status}: {v:#}\n{}",
                self.log(id).await
            );
            tokio::time::sleep(POLL).await;
        }
    }
    /// Submit a job named `id` and wait for it to finish.
    async fn run(&self, id: &str, record: bool) -> (Value, String) {
        self.submit(id, record).await;
        let v = self.wait_status(id, "done").await;
        (v, self.log(id).await)
    }
}

async fn wait_until(what: &str, f: impl Fn() -> bool) {
    let start = Instant::now();
    while !f() {
        assert!(start.elapsed() < DEADLINE, "timed out waiting for {what}");
        tokio::time::sleep(POLL).await;
    }
}

fn run_dir(env: &Env, id: &str) -> PathBuf {
    env.repo
        .join("combinations")
        .join(COMBINATION)
        .join("benchmarks")
        .join(PACK_NAME)
        .join(id)
}

/// The first attempt is under way AND the server has saved that to disk. The harness creates
/// `attempt1` as soon as it starts, a moment before the server writes the job as running (its pid
/// is only known after the spawn); a server stopped in that moment leaves a job on disk that still
/// says queued, and the next server starts it afresh. A test that stops or replaces the server
/// waits for both.
async fn wait_first_attempt_saved(env: &Env, id: &str) {
    let started = run_dir(env, id).join("attempt1");
    let file = env.home.join(format!("jobs/{id}.json"));
    wait_until("the first attempt, saved as running", || {
        started.exists()
            && std::fs::read(&file)
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
                .is_some_and(|j| j["state"]["status"] == "running")
    })
    .await;
}

fn release_dir(env: &Env, tag: &str) -> PathBuf {
    env.home.join(RELEASES_DIR).join(tag)
}

fn releases_present(env: &Env) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(env.home.join(RELEASES_DIR))
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

/// How many times the harness started, and as which version.
fn versions_run(log: &str) -> Vec<&str> {
    log.lines()
        .filter_map(|l| l.strip_prefix("harness: "))
        .collect()
}

fn short(env: &Env, commit: &str) -> String {
    git(&env.repo, &["rev-parse", "--short", commit])
}

#[tokio::test(flavor = "multi_thread")]
async fn a_job_runs_the_latest_release_while_main_has_moved_on_and_records_in_the_checkout() {
    let env = setup();
    let released = release(&env, TAG_1, "v1", "");
    let main = push_main(&env, "main-after-v1", BROKEN);
    let srv = start(&env, &[]);

    let (job, log) = srv.run("r1", true).await;
    // The checkout was pulled to main, whose harness would have failed; the release's ran.
    assert_eq!(git(&env.repo, &["rev-parse", "HEAD~1"]), main, "{log}");
    assert_eq!(versions_run(&log), ["v1"], "{log}");
    assert!(!log.contains("main-broken"), "{log}");
    assert_eq!(job["attempt"], 1);
    // The job says which release it ran: in its record, its history and its log.
    assert_eq!(
        job["harness"],
        json!({"kind": "release", "tag": TAG_1, "commit": released})
    );
    let noted = job["history"].as_array().unwrap().iter().any(|n| {
        let text = n["text"].as_str().unwrap();
        text.contains(TAG_1) && text.contains(&short(&env, &released))
    });
    assert!(noted, "{job:#}");
    assert!(log.contains(&format!("harness release {TAG_1}")), "{log}");

    // It ran from the release's own directory: made from the tag, with a manifest, no .git, only
    // the paths the release calls the harness, and read-only.
    let dir = release_dir(&env, TAG_1);
    assert!(
        log.contains(&format!("code-root: {}", dir.display())),
        "{log}"
    );
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(dir.join(MANIFEST_FILE)).unwrap()).unwrap();
    assert_eq!(
        manifest,
        json!({"tag": TAG_1, "commit": released, "commit_short": short(&env, &released)})
    );
    assert!(log.contains(&format!("\"tag\":\"{TAG_1}\"")), "{log}");
    assert!(!dir.join(".git").exists());
    assert!(dir.join("benchmarks/perf/thermal.py").is_file());
    assert!(!dir.join("combinations").exists() && !dir.join("tools").exists());
    for p in [
        dir.clone(),
        dir.join(SPEC_BENCH_ENTRY),
        dir.join("benchmarks"),
    ] {
        let mode = std::fs::metadata(&p).unwrap().permissions().mode();
        assert_eq!(mode & WRITE_BITS, 0, "{} is writable", p.display());
    }

    // Its results are in the checkout, committed there and pushed to main.
    assert!(
        log.contains(&format!("results-root: {}", env.repo.display())),
        "{log}"
    );
    let result = run_dir(&env, "r1").join("result.txt");
    assert_eq!(std::fs::read_to_string(result).unwrap().trim(), "v1");
    let pushed = git(&env.remote, &["log", "-1", "--format=%s", MAIN_BRANCH]);
    assert_eq!(pushed, "record r1 by v1");
    assert_eq!(
        job["progress"]["run_dir"],
        run_dir(&env, "r1").display().to_string()
    );

    // A newer release is picked up by the next job; the first job keeps saying what it ran.
    let newer = release(&env, TAG_2, "v2", "");
    let (job2, log2) = srv.run("r2", true).await;
    assert_eq!(versions_run(&log2), ["v2"], "{log2}");
    assert_eq!(job2["harness"]["tag"], TAG_2);
    assert_eq!(job2["harness"]["commit"], newer);
    assert_eq!(srv.get("/v1/jobs/r1").await["harness"]["tag"], TAG_1);
    let all = srv.get("/v1/jobs").await;
    let listed: Vec<&str> = all
        .as_array()
        .unwrap()
        .iter()
        .map(|j| j["harness"]["tag"].as_str().unwrap())
        .collect();
    assert_eq!(listed, [TAG_2, TAG_1]);
}

#[tokio::test(flavor = "multi_thread")]
async fn the_newest_release_is_by_its_name_not_its_date_and_only_from_main() {
    let env = setup();
    // Made in this order: by tag date .2 is the newest, by name the next day's is.
    let next_day = release(&env, TAG_NEXT_DAY, "next-day", "");
    release(&env, TAG_10, "ten", "");
    release(&env, TAG_2, "two", "");
    // A commit main doesn't have (no branch: a bare commit object), tagged with the newest name of all.
    let tree = git(&env.dev, &["rev-parse", "HEAD^{tree}"]);
    let stray = git(&env.dev, &["commit-tree", &tree, "-m", "not on main"]);
    push_tag(&env, TAG_OFF_MAIN, &stray);
    let srv = start(&env, &[]);

    let (job, log) = srv.run("r1", false).await;
    assert_eq!(versions_run(&log), ["next-day"], "{log}");
    assert_eq!(job["harness"]["tag"], TAG_NEXT_DAY);
    assert_eq!(job["harness"]["commit"], next_day);
}

#[tokio::test(flavor = "multi_thread")]
async fn without_a_release_a_job_is_refused_and_says_how_to_make_one() {
    let env = setup();
    push_main(&env, "unreleased", "");
    let srv = start(&env, &[]);

    srv.submit("r1", false).await;
    let job = srv.wait_status("r1", "failed").await;
    let reason = job["state"]["reason"].as_str().unwrap();
    assert!(reason.contains("no harness release"), "{reason}");
    assert!(reason.contains("dbench harness-release"), "{reason}");
    assert!(reason.contains("--allow-unreleased"), "{reason}");
    // Nothing ran: no attempt, no restart, no harness output, no results.
    assert_eq!(job["attempt"], 0);
    let log = srv.log("r1").await;
    assert!(versions_run(&log).is_empty(), "{log}");
    assert!(!run_dir(&env, "r1").exists());
    assert!(job.get("harness").is_none_or(Value::is_null), "{job:#}");
}

#[tokio::test(flavor = "multi_thread")]
async fn allow_unreleased_runs_the_checkouts_harness_and_says_so_loudly() {
    let env = setup();
    push_main(&env, "unreleased", "");
    let srv = start(&env, &["--allow-unreleased"]);

    let (job, log) = srv.run("r1", false).await;
    assert_eq!(versions_run(&log), ["unreleased"], "{log}");
    // As before releases existed: the checkout is both code and results, and no variable is set.
    assert!(
        log.contains(&format!("code-root: {}", env.repo.display())),
        "{log}"
    );
    assert!(log.contains("results-root: unset"), "{log}");
    assert_eq!(job["harness"], json!({"kind": "unreleased"}));
    let noted = job["history"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["text"].as_str().unwrap().contains("UNRELEASED"));
    assert!(noted, "{job:#}");
    assert!(log.contains("UNRELEASED"), "{log}");

    // Once there is a release, the flag changes nothing: jobs run it.
    release(&env, TAG_1, "v1", "");
    let (job2, log2) = srv.run("r2", false).await;
    assert_eq!(versions_run(&log2), ["v1"], "{log2}");
    assert_eq!(job2["harness"]["tag"], TAG_1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_job_keeps_the_release_it_started_on() {
    let env = setup();
    let first = release(&env, TAG_1, "v1", GATED);
    let srv = start(&env, &[]);
    srv.submit("r1", false).await;
    wait_first_attempt_saved(&env, "r1").await;

    // A newer release arrives while the job runs; then its first attempt fails and it restarts.
    release(&env, TAG_2, "v2", "");
    // Its release directory goes missing too (pruned by hand, a wiped home): it is made again.
    let dir = release_dir(&env, TAG_1);
    make_writable(&dir);
    std::fs::remove_dir_all(&dir).unwrap();
    std::fs::write(run_dir(&env, "r1").join("go"), "").unwrap();

    let job = srv.wait_status("r1", "done").await;
    let log = srv.log("r1").await;
    assert_eq!(versions_run(&log), ["v1", "v1"], "{log}");
    assert_eq!(job["attempt"], 2);
    assert_eq!(
        job["harness"],
        json!({"kind": "release", "tag": TAG_1, "commit": first})
    );
    assert!(dir.join(MANIFEST_FILE).is_file());
    assert!(log.contains("made again"), "{log}");

    // The next job runs the newer release.
    let (job2, log2) = srv.run("r2", false).await;
    assert_eq!(versions_run(&log2), ["v2"], "{log2}");
    assert_eq!(job2["harness"]["tag"], TAG_2);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restarted_job_whose_release_is_gone_fails_instead_of_changing_harness() {
    let env = setup();
    release(&env, TAG_1, "v1", GATED);
    let srv = start(&env, &[]);
    srv.submit("r1", false).await;
    wait_first_attempt_saved(&env, "r1").await;

    // The release is withdrawn everywhere (tag deleted) and its directory is gone; a newer one exists.
    release(&env, TAG_2, "v2", "");
    git(
        &env.dev,
        &["push", "-q", REMOTE, &format!(":refs/tags/{TAG_1}")],
    );
    git(&env.repo, &["tag", "--delete", TAG_1]);
    let dir = release_dir(&env, TAG_1);
    make_writable(&dir);
    std::fs::remove_dir_all(&dir).unwrap();
    std::fs::write(run_dir(&env, "r1").join("go"), "").unwrap();

    let job = srv.wait_status("r1", "failed").await;
    let reason = job["state"]["reason"].as_str().unwrap();
    assert!(reason.contains(TAG_1), "{reason}");
    assert!(reason.contains("not switching"), "{reason}");
    let log = srv.log("r1").await;
    assert_eq!(versions_run(&log), ["v1"], "v2 must not have run: {log}");
    assert_eq!(job["harness"]["tag"], TAG_1);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_release_that_does_not_say_what_the_harness_is_fails_the_job() {
    let env = setup();
    write(&env.dev, CHECKS_FILE, CHECKS_WITHOUT_HARNESS);
    release(&env, TAG_1, "v1", "");
    let srv = start(&env, &[]);

    srv.submit("r1", false).await;
    let job = srv.wait_status("r1", "failed").await;
    let reason = job["state"]["reason"].as_str().unwrap();
    assert!(
        reason.contains(TAG_1) && reason.contains("harness"),
        "{reason}"
    );
    assert!(reason.contains(CHECKS_FILE), "{reason}");
    assert_eq!(job["attempt"], 0);
    assert!(
        releases_present(&env).is_empty(),
        "{:?}",
        releases_present(&env)
    );
}

/// Upgrading a node: a job that started under a dbench from before releases has no harness on
/// record and has been running the checkout's own. Its restart keeps that, flag or no flag; it is
/// not moved onto a release part-way through its run.
#[tokio::test(flavor = "multi_thread")]
async fn a_job_started_before_releases_keeps_the_checkouts_harness_when_it_restarts() {
    let env = setup();
    push_main(&env, "before-releases", GATED);
    let old = start(&env, &["--allow-unreleased"]);
    old.submit("r1", false).await;
    wait_first_attempt_saved(&env, "r1").await;
    drop(old); // the harness runs on, to be adopted

    // As the old version stored it: no harness on record.
    let file = env.home.join("jobs/r1.json");
    let mut job: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    assert!(job.as_object_mut().unwrap().remove("harness").is_some());
    std::fs::write(&file, serde_json::to_vec(&job).unwrap()).unwrap();
    release(&env, TAG_1, "v1", "");

    let new = start(&env, &[]);
    std::fs::write(run_dir(&env, "r1").join("go"), "").unwrap();
    let job = new.wait_status("r1", "done").await;
    let log = new.log("r1").await;
    // Both attempts ran from the checkout (the second after a pull: main's harness as it is now).
    assert_eq!(versions_run(&log), ["before-releases", "v1"], "{log}");
    let from_checkout = format!("code-root: {}", env.repo.display());
    assert_eq!(log.matches(&from_checkout).count(), 2, "{log}");
    assert_eq!(job["harness"], json!({"kind": "unreleased"}));
    let noted = job["history"]
        .as_array()
        .unwrap()
        .iter()
        .any(|n| n["text"].as_str().unwrap().contains("started before"));
    assert!(noted, "{job:#}");
    assert!(
        releases_present(&env).is_empty(),
        "{:?}",
        releases_present(&env)
    );

    // A new job on the same node runs the release.
    let (job2, log2) = new.run("r2", false).await;
    assert_eq!(job2["harness"]["tag"], TAG_1);
    assert!(
        log2.contains(&format!(
            "code-root: {}",
            release_dir(&env, TAG_1).display()
        )),
        "{log2}"
    );
}

/// A harness from before it could be told where results go would ignore the variable and treat
/// its own directory as the results root. Such a release is never run.
#[tokio::test(flavor = "multi_thread")]
async fn a_release_whose_harness_cannot_be_told_where_results_go_fails_the_job() {
    let env = setup();
    std::fs::remove_file(env.dev.join(RESULTS_ROOT_SUPPORT)).unwrap();
    release(&env, TAG_1, "v1", "");
    let srv = start(&env, &[]);

    srv.submit("r1", false).await;
    let job = srv.wait_status("r1", "failed").await;
    let reason = job["state"]["reason"].as_str().unwrap();
    assert!(
        reason.contains(TAG_1) && reason.contains(RESULTS_ROOT_SUPPORT),
        "{reason}"
    );
    assert_eq!(job["attempt"], 0);
    assert!(versions_run(&srv.log("r1").await).is_empty());
    assert!(
        releases_present(&env).is_empty(),
        "{:?}",
        releases_present(&env)
    );
}

/// A release directory as an earlier job left it, without running one.
fn old_release_dir(env: &Env, tag: &str) {
    let dir = release_dir(env, tag);
    std::fs::create_dir_all(dir.join("benchmarks")).unwrap();
    let manifest = json!({"tag": tag, "commit": "0".repeat(40), "commit_short": "0000000"});
    std::fs::write(dir.join(MANIFEST_FILE), manifest.to_string()).unwrap();
    for p in [dir.join("benchmarks"), dir.join(MANIFEST_FILE), dir] {
        let mode = std::fs::metadata(&p).unwrap().permissions().mode();
        std::fs::set_permissions(&p, std::fs::Permissions::from_mode(mode & !WRITE_BITS)).unwrap();
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn old_release_directories_are_pruned_but_never_the_one_a_job_runs_from() {
    let env = setup();
    release(&env, TAG_1, "v1", GATED);
    let srv = start(&env, &[]);
    srv.submit("r1", false).await;
    wait_first_attempt_saved(&env, "r1").await;

    // While it runs, more recent releases than its own pile up (more than are kept), and a
    // half-made one is left behind.
    let newer: Vec<String> = (1..=KEEP_RELEASES + 1)
        .map(|n| format!("harness-v2027.01.01.{n}"))
        .collect();
    for tag in &newer {
        old_release_dir(&env, tag);
    }
    let partial = env
        .home
        .join(RELEASES_DIR)
        .join(".harness-v2027.01.02.1.partial");
    std::fs::create_dir_all(&partial).unwrap();
    let unrelated = env.home.join(RELEASES_DIR).join("notes");
    std::fs::create_dir_all(&unrelated).unwrap();
    std::fs::write(run_dir(&env, "r1").join("go"), "").unwrap();

    // Its restart prunes: the newest KEEP_RELEASES stay, and so does its own, old as it is.
    srv.wait_status("r1", "done").await;
    let mut expected: Vec<String> = newer[1..].to_vec();
    expected.push(TAG_1.to_string());
    expected.push("notes".to_string()); // not a release: not dbench's to remove
    expected.sort();
    assert_eq!(releases_present(&env), expected);
    let log = srv.log("r1").await;
    assert!(
        log.contains(&format!("pruned release {}", newer[0])),
        "{log}"
    );

    // With that job finished, nothing holds its release: the next job's start prunes it.
    release(&env, TAG_2, "v2", "");
    srv.run("r2", false).await;
    let present = releases_present(&env);
    assert!(!present.contains(&TAG_1.to_string()), "{present:?}");
    assert!(present.contains(&TAG_2.to_string()), "{present:?}");
}

/// What the harness's known-good mode reads from a reference run (drive.py known_good_base).
const REFERENCE_FILES: [&str; 2] = ["workspace.bundle", "metrics.json"];
const KNOWN_GOOD_STORY: u32 = 2;

#[tokio::test(flavor = "multi_thread")]
async fn a_known_good_job_on_a_release_reads_its_reference_run_from_the_checkout() {
    // The release's own directory holds code only. A finished run is a result, so the path the
    // harness is given is in the node's checkout, where results are, whichever harness runs.
    let env = setup();
    release(&env, TAG_1, "v1", "");
    let reference = format!("combinations/{COMBINATION}/benchmarks/{PACK_NAME}/v2-r3");
    for f in REFERENCE_FILES {
        write(&env.repo, &format!("{reference}/{f}"), "{}");
    }
    let srv = start(&env, &[]);
    let spec = json!({"install_id": INSTALL_ID, "pack": PACK, "run_id": "kg", "client": "pi", "record": false,
                      "stories": [KNOWN_GOOD_STORY], "from_run": reference});
    let resp = srv
        .http
        .put(format!("{}/v1/jobs/kg", srv.base))
        .bearer_auth(&srv.token)
        .json(&spec)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 201, "{}", resp.text().await.unwrap());
    srv.wait_status("kg", "done").await;
    let log = srv.log("kg").await;
    assert!(log.contains(&format!("code-root: {}", release_dir(&env, TAG_1).display())), "{log}");
    assert!(log.contains(&format!("from-run: {}", env.repo.join(&reference).display())), "{log}");
    assert!(!release_dir(&env, TAG_1).join(&reference).exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_job_from_a_story_on_a_release_passes_it_with_the_reference_run_in_the_checkout() {
    let env = setup();
    release(&env, TAG_1, "v1", "");
    let reference = format!("combinations/{COMBINATION}/benchmarks/{PACK_NAME}/v2-r3");
    for f in REFERENCE_FILES {
        write(&env.repo, &format!("{reference}/{f}"), "{}");
    }
    let srv = start(&env, &[]);
    let spec = json!({"install_id": INSTALL_ID, "pack": PACK, "run_id": "fs", "client": "pi", "record": false,
                      "from_run": reference, "from_story": KNOWN_GOOD_STORY});
    let resp = srv
        .http
        .put(format!("{}/v1/jobs/fs", srv.base))
        .bearer_auth(&srv.token)
        .json(&spec)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status().as_u16(), 201, "{}", resp.text().await.unwrap());
    srv.wait_status("fs", "done").await;
    let log = srv.log("fs").await;
    assert!(log.contains(&format!("from-run: {}", env.repo.join(&reference).display())), "{log}");
    assert!(log.contains(&format!("from-story: {KNOWN_GOOD_STORY}")), "{log}");
}
