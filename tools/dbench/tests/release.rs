//! End-to-end: the real `dbench harness-release` binary against a temp repo with a bare remote and
//! fake checks. Tags and pushes happen only inside those temp repos.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU32, Ordering};

use dbench::release::{next_tag, CHECKS_FILE, MAIN_BRANCH, REMOTE, TAG_PREFIX};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Each fake check appends its name to this file (outside the repo), so a test can see what ran.
const RAN_FILE: &str = "ran";
const CHECKED_PATHS: &str = r#"paths = ["code/**", "tools/**", "*.sh"]"#;
/// A file under the checked paths, and one outside them.
const CHECKED_FILE: &str = "code/lib.txt";
const UNCHECKED_FILE: &str = "results/run-1.json";
const EXECUTABLE: u32 = 0o755;

struct TempRoot(PathBuf);
impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Env {
    root: TempRoot,
    repo: PathBuf,
    remote: PathBuf,
}

/// git, cut off from the developer's own configuration (signing, hooks, default branch).
fn git_cmd(dir: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(dir)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_AUTHOR_NAME", "Test")
        .env("GIT_AUTHOR_EMAIL", "test@example.invalid")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.invalid");
    c
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
    std::fs::write(path, text).unwrap();
}

fn commit_all(repo: &Path, message: &str) {
    git(repo, &["add", "-A"]);
    git(repo, &["commit", "-q", "-m", message]);
}

/// A check that records that it ran, prints `says` and exits `code`.
fn check(name: &str, says: &str, code: i32) -> String {
    format!(
        "[[check]]\nname = \"{name}\"\ndir = \"code\"\n\
         command = [\"sh\", \"-c\", \"echo {name} >> ../../{RAN_FILE}; echo '{says}'; exit {code}\"]\n"
    )
}

fn passing(name: &str) -> String {
    check(name, "all good", 0)
}

/// A repo on main with `checks` as its check list, committed and pushed to a bare remote.
fn setup(checks: &str) -> Env {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let root = std::env::temp_dir().join(format!("dbench-release-it-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let root = root.canonicalize().unwrap();
    let (repo, remote) = (root.join("repo"), root.join("remote.git"));
    let initial = format!("--initial-branch={MAIN_BRANCH}");
    git(&root, &["init", "-q", "--bare", &initial, "remote.git"]);
    git(&root, &["init", "-q", &initial, "repo"]);
    write(&repo, CHECKS_FILE, &format!("{CHECKED_PATHS}\n\n{checks}"));
    write(&repo, CHECKED_FILE, "code\n");
    write(&repo, UNCHECKED_FILE, "{}\n");
    commit_all(&repo, "initial");
    git(&repo, &["remote", "add", REMOTE, remote.to_str().unwrap()]);
    git(&repo, &["push", "-q", REMOTE, MAIN_BRANCH]);
    Env {
        root: TempRoot(root),
        repo,
        remote,
    }
}

struct Ran {
    ok: bool,
    /// stdout then stderr.
    text: String,
}

fn release(env: &Env, flags: &[&str]) -> Ran {
    release_with_path(env, flags, None)
}

/// With `path`, the release sees that PATH and no other (a fake `gh` first on it, or none at all).
fn release_with_path(env: &Env, flags: &[&str], path: Option<std::ffi::OsString>) -> Ran {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_dbench"));
    if let Some(path) = path {
        cmd.env("PATH", path);
    }
    cmd.args(["harness-release", "--repo"])
        .arg(&env.repo)
        .args(flags)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_COMMITTER_NAME", "Test")
        .env("GIT_COMMITTER_EMAIL", "test@example.invalid");
    let out = cmd.output().expect("run dbench");
    Ran {
        ok: out.status.success(),
        text: format!(
            "{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        ),
    }
}

fn tags(dir: &Path) -> Vec<String> {
    git(dir, &["tag", "--list"])
        .lines()
        .map(str::to_string)
        .collect()
}

fn ran(env: &Env) -> Vec<String> {
    std::fs::read_to_string(env.root.0.join(RAN_FILE))
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

/// Today's nth release tag, by the same rule the binary uses (unit-tested beside it).
fn todays_tag(n: u32) -> String {
    let today = dbench::timefmt::utc_date(dbench::timefmt::now_secs());
    (1..n).fold(next_tag(&[], today), |tag, _| next_tag(&[tag], today))
}

fn assert_no_tags(env: &Env, r: &Ran) {
    assert_eq!(tags(&env.repo), Vec::<String>::new(), "{}", r.text);
    assert_eq!(tags(&env.remote), Vec::<String>::new(), "{}", r.text);
}

#[test]
fn all_checks_pass_so_head_is_tagged_and_the_tag_is_pushed() {
    let env = setup(&format!("{}{}", passing("first"), passing("second")));
    let r = release(&env, &[]);
    assert!(r.ok, "{}", r.text);
    let tag = todays_tag(1);
    assert!(tag.starts_with(TAG_PREFIX));
    assert_eq!(tags(&env.repo), std::slice::from_ref(&tag), "{}", r.text);
    assert_eq!(tags(&env.remote), std::slice::from_ref(&tag), "{}", r.text);
    // Annotated, on HEAD, in both places.
    let head = git(&env.repo, &["rev-parse", "HEAD"]);
    for dir in [&env.repo, &env.remote] {
        assert_eq!(git(dir, &["cat-file", "-t", &tag]), "tag");
        assert_eq!(git(dir, &["rev-parse", &format!("{tag}^{{commit}}")]), head);
    }
    let message = git(&env.repo, &["tag", "--list", "--format=%(contents)", &tag]);
    assert!(
        message.contains("first") && message.contains("second"),
        "{message}"
    );
    // The tag says how it was verified.
    assert!(message.contains("checks run locally"), "{message}");
    assert_eq!(ran(&env), ["first", "second"]);
    for line in ["PASS  first", "PASS  second"] {
        assert!(r.text.contains(line), "no {line:?} in:\n{}", r.text);
    }
    assert!(r.text.contains(&tag), "{}", r.text);
}

#[test]
fn one_failing_check_means_no_tag_and_the_failure_is_named() {
    let checks = format!(
        "{}{}{}",
        passing("first"),
        check("broken", "assert 1 == 2 went wrong", 3),
        passing("last")
    );
    let env = setup(&checks);
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    // Every check still runs, so one release attempt shows everything that is wrong.
    assert_eq!(ran(&env), ["first", "broken", "last"]);
    for line in ["PASS  first", "FAIL  broken", "PASS  last", "exit 3"] {
        assert!(r.text.contains(line), "no {line:?} in:\n{}", r.text);
    }
    // The failing check's own output is shown, and the refusal names it.
    assert!(r.text.contains("assert 1 == 2 went wrong"), "{}", r.text);
    assert!(
        r.text
            .contains("not released: 1 of 3 checks failed (broken)"),
        "{}",
        r.text
    );
}

#[test]
fn a_check_whose_command_is_missing_is_a_failure() {
    let missing = "[[check]]\nname = \"ghost\"\ndir = \"code\"\ncommand = [\"no-such-program-dbench-test\", \"--version\"]\n";
    let env = setup(&format!("{}{missing}", passing("first")));
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(r.text.contains("FAIL  ghost"), "{}", r.text);
    assert!(
        r.text.contains("cannot run no-such-program-dbench-test"),
        "{}",
        r.text
    );
}

#[test]
fn a_check_whose_file_or_directory_is_missing_is_a_failure() {
    let no_file = "[[check]]\nname = \"replay\"\ndir = \"code\"\nrequires = [\"test_replay.py\"]\n\
                   command = [\"sh\", \"-c\", \"echo replay >> ../../ran\"]\n";
    let no_dir = "[[check]]\nname = \"elsewhere\"\ndir = \"tools/gone\"\ncommand = [\"true\"]\n";
    let env = setup(&format!("{no_file}{no_dir}"));
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("missing: code/test_replay.py"),
        "{}",
        r.text
    );
    assert!(
        r.text.contains("missing: directory tools/gone"),
        "{}",
        r.text
    );
    // The command of a check with a missing file is not run: it would test something else.
    assert_eq!(ran(&env), Vec::<String>::new());
}

#[test]
fn a_skipped_self_test_is_a_failure_though_the_command_exits_zero() {
    let skipping = "[[check]]\nname = \"unit\"\ndir = \"code\"\nno_skips_of = [\"test_pipeline.py\"]\n\
                    command = [\"sh\", \"-c\", \"echo 'SKIPPED [7] test_pipeline.py:41: needs node, npm and npx'\"]\n";
    let env = setup(skipping);
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(r.text.contains("FAIL  unit"), "{}", r.text);
    assert!(
        r.text
            .contains("skipped: SKIPPED [7] test_pipeline.py:41: needs node, npm and npx"),
        "{}",
        r.text
    );
}

#[test]
fn uncommitted_changes_under_the_checked_paths_are_refused_before_anything_runs() {
    let env = setup(&passing("first"));
    write(&env.repo, CHECKED_FILE, "edited\n");
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("uncommitted") && r.text.contains(CHECKED_FILE),
        "{}",
        r.text
    );
    assert_eq!(ran(&env), Vec::<String>::new());

    // Staged counts too.
    git(&env.repo, &["add", CHECKED_FILE]);
    let r = release(&env, &[]);
    assert!(!r.ok && r.text.contains(CHECKED_FILE), "{}", r.text);
    assert_no_tags(&env, &r);
}

#[test]
fn an_untracked_file_under_the_checked_paths_is_refused() {
    // The checks would run with it, and the tagged commit wouldn't have it.
    let env = setup(&passing("first"));
    write(&env.repo, "code/test_new.py", "new\n");
    write(&env.repo, "new-script.sh", "new\n");
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    for f in ["code/test_new.py", "new-script.sh"] {
        assert!(r.text.contains(f), "no {f} in:\n{}", r.text);
    }
    assert_eq!(ran(&env), Vec::<String>::new());
}

#[test]
fn changes_outside_the_checked_paths_do_not_block_a_release() {
    // Benchmark results land all day; they aren't what the checks read.
    let env = setup(&passing("first"));
    write(&env.repo, UNCHECKED_FILE, "{\"edited\": true}\n");
    write(&env.repo, "results/run-2.json", "{}\n");
    write(
        &env.repo,
        "results/notes.sh",
        "a script, but not at the root\n",
    );
    let r = release(&env, &[]);
    assert!(r.ok, "{}", r.text);
    assert_eq!(tags(&env.remote), [todays_tag(1)]);
}

#[test]
fn head_ahead_of_origin_main_is_refused() {
    let env = setup(&passing("first"));
    write(&env.repo, CHECKED_FILE, "newer\n");
    commit_all(&env.repo, "not pushed");
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("HEAD is not origin/main") && r.text.contains("1 ahead"),
        "{}",
        r.text
    );
    assert_eq!(ran(&env), Vec::<String>::new());
}

#[test]
fn head_behind_origin_main_is_refused_after_fetching() {
    let env = setup(&passing("first"));
    // Someone else pushes; this checkout hasn't fetched, so its own origin/main still equals HEAD.
    let other = env.root.0.join("other");
    git(
        &env.root.0,
        &["clone", "-q", env.remote.to_str().unwrap(), "other"],
    );
    write(&other, CHECKED_FILE, "theirs\n");
    commit_all(&other, "theirs");
    git(&other, &["push", "-q", REMOTE, MAIN_BRANCH]);
    assert_eq!(
        git(&env.repo, &["rev-parse", "HEAD"]),
        git(
            &env.repo,
            &["rev-parse", &format!("{REMOTE}/{MAIN_BRANCH}")]
        )
    );
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("HEAD is not origin/main") && r.text.contains("1 behind"),
        "{}",
        r.text
    );
    assert_eq!(ran(&env), Vec::<String>::new());
}

#[test]
fn an_unreachable_remote_is_refused() {
    let env = setup(&passing("first"));
    std::fs::remove_dir_all(&env.remote).unwrap();
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_eq!(tags(&env.repo), Vec::<String>::new());
    assert!(r.text.contains("git fetch"), "{}", r.text);
    assert_eq!(ran(&env), Vec::<String>::new());
}

#[test]
fn a_second_release_the_same_day_is_number_two() {
    let env = setup(&passing("first"));
    assert!(release(&env, &[]).ok);
    write(&env.repo, CHECKED_FILE, "second\n");
    commit_all(&env.repo, "second");
    git(&env.repo, &["push", "-q", REMOTE, MAIN_BRANCH]);
    let r = release(&env, &[]);
    assert!(r.ok, "{}", r.text);
    assert_eq!(tags(&env.remote), [todays_tag(1), todays_tag(2)]);
    assert_eq!(
        git(
            &env.remote,
            &["rev-parse", &format!("{}^{{commit}}", todays_tag(2))]
        ),
        git(&env.repo, &["rev-parse", "HEAD"])
    );
}

#[test]
fn a_release_made_from_another_checkout_counts_towards_the_number() {
    let env = setup(&passing("first"));
    let other = env.root.0.join("other");
    git(
        &env.root.0,
        &["clone", "-q", env.remote.to_str().unwrap(), "other"],
    );
    for n in [1, 4] {
        git(&other, &["tag", "-a", "-m", "theirs", &todays_tag(n)]);
    }
    git(&other, &["push", "-q", REMOTE, "--tags"]);
    assert_eq!(tags(&env.repo), Vec::<String>::new());
    let r = release(&env, &[]);
    assert!(r.ok, "{}", r.text);
    assert_eq!(
        tags(&env.remote),
        [todays_tag(1), todays_tag(4), todays_tag(5)]
    );
}

#[test]
fn check_only_runs_the_checks_and_never_tags() {
    let env = setup(&format!("{}{}", passing("first"), passing("second")));
    let r = release(&env, &["--check-only"]);
    assert!(r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert_eq!(ran(&env), ["first", "second"]);
    assert!(r.text.contains("PASS  first"), "{}", r.text);
}

#[test]
fn check_only_does_not_look_at_git_state() {
    // CI checks a pull request or a pushed commit: not origin/main, and no remote to ask.
    let env = setup(&passing("first"));
    write(&env.repo, CHECKED_FILE, "newer\n");
    commit_all(&env.repo, "not pushed");
    write(&env.repo, CHECKED_FILE, "and dirty\n");
    std::fs::remove_dir_all(&env.remote).unwrap();
    let r = release(&env, &["--check-only"]);
    assert!(r.ok, "{}", r.text);
    assert_eq!(tags(&env.repo), Vec::<String>::new());
    assert_eq!(ran(&env), ["first"]);
}

#[test]
fn check_only_fails_when_a_check_fails() {
    let env = setup(&format!(
        "{}{}",
        check("broken", "boom", 1),
        passing("last")
    ));
    let r = release(&env, &["--check-only"]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("FAIL  broken") && r.text.contains("boom"),
        "{}",
        r.text
    );
    assert!(
        r.text.contains("1 of 2 checks failed (broken)"),
        "{}",
        r.text
    );
}

#[test]
fn dry_run_runs_nothing_and_tags_nothing() {
    let env = setup(&format!(
        "{}{}",
        passing("first"),
        check("broken", "boom", 1)
    ));
    let before = git(
        &env.repo,
        &["rev-parse", &format!("{REMOTE}/{MAIN_BRANCH}")],
    );
    let r = release(&env, &["--dry-run"]);
    assert!(r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert_eq!(ran(&env), Vec::<String>::new());
    // It says what would run, where, and the tag a release would make.
    for part in [
        "first",
        "broken",
        "code",
        "sh -c",
        &todays_tag(1),
        "dry run",
    ] {
        assert!(r.text.contains(part), "no {part:?} in:\n{}", r.text);
    }
    assert_eq!(
        git(
            &env.repo,
            &["rev-parse", &format!("{REMOTE}/{MAIN_BRANCH}")]
        ),
        before
    );
}

#[test]
fn a_commit_made_while_the_checks_run_is_not_released() {
    // Other work is committed to this repo all day. The checks then ran on a mixture: tag nothing.
    let committing = "[[check]]\nname = \"slow\"\ndir = \"code\"\n\
        command = [\"git\", \"-c\", \"user.name=T\", \"-c\", \"user.email=t@example.invalid\", \"commit\", \"-q\", \"--allow-empty\", \"-m\", \"meanwhile\"]\n";
    let env = setup(committing);
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("HEAD moved while the checks ran"),
        "{}",
        r.text
    );
}

#[test]
fn a_tracked_file_edited_while_the_checks_run_is_not_released() {
    let editing = "[[check]]\nname = \"slow\"\ndir = \"code\"\ncommand = [\"sh\", \"-c\", \"echo edited > lib.txt\"]\n";
    let env = setup(editing);
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(
        r.text.contains("changed while the checks ran") && r.text.contains(CHECKED_FILE),
        "{}",
        r.text
    );
}

#[test]
fn a_tag_that_cannot_be_pushed_is_not_left_behind() {
    let env = setup(&passing("first"));
    let hook = env.remote.join("hooks/pre-receive");
    std::fs::create_dir_all(hook.parent().unwrap()).unwrap();
    std::fs::write(
        &hook,
        "#!/bin/sh\necho 'tags are refused here' >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&hook, std::fs::Permissions::from_mode(EXECUTABLE)).unwrap();
    let r = release(&env, &[]);
    assert!(!r.ok, "{}", r.text);
    assert_no_tags(&env, &r);
    assert!(r.text.contains("git push"), "{}", r.text);
}

#[test]
fn a_repo_without_a_check_list_is_refused() {
    let env = setup(&passing("first"));
    git(&env.repo, &["rm", "-q", CHECKS_FILE]);
    commit_all(&env.repo, "no checks");
    git(&env.repo, &["push", "-q", REMOTE, MAIN_BRANCH]);
    for flags in [&[][..], &["--check-only"], &["--dry-run"]] {
        let r = release(&env, flags);
        assert!(!r.ok, "{}", r.text);
        assert!(r.text.contains(CHECKS_FILE), "{}", r.text);
        assert_no_tags(&env, &r);
    }
}

#[test]
fn the_full_output_of_each_check_is_kept_in_the_log_dir() {
    let env = setup(&format!(
        "{}{}",
        passing("first one"),
        check("broken", "boom", 1)
    ));
    let logs = env.root.0.join("logs");
    let r = release(&env, &["--check-only", "--log-dir", logs.to_str().unwrap()]);
    assert!(!r.ok, "{}", r.text);
    assert_eq!(
        std::fs::read_to_string(logs.join("first-one.log")).unwrap(),
        "all good\n"
    );
    assert_eq!(
        std::fs::read_to_string(logs.join("broken.log")).unwrap(),
        "boom\n"
    );
    assert!(r.text.contains("broken.log"), "{}", r.text);
}

#[test]
fn without_repo_it_takes_the_repository_the_current_directory_is_in() {
    let env = setup(&passing("first"));
    let out = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(["harness-release", "--check-only"])
        .current_dir(env.repo.join("code"))
        .output()
        .expect("run dbench");
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert_eq!(ran(&env), ["first"]);
}
