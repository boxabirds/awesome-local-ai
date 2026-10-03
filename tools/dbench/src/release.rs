//! `dbench harness-release`: run every check, and only if all pass tag HEAD and push the tag.
//!
//! The checks are data: `tools/dbench/checks.toml` in the repo being released. `--check-only` runs
//! the same list and tags nothing.

use anyhow::{bail, Context, Result};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::File;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::cli::HarnessReleaseArgs;
use crate::timefmt::{fmt_duration, now_secs, utc_date};

/// The check list, relative to the repo root.
pub const CHECKS_FILE: &str = "tools/dbench/checks.toml";
/// A release is `harness-v<YYYY.MM.DD>.<n>`, n counting that day's releases from 1.
pub const TAG_PREFIX: &str = "harness-v";
pub const REMOTE: &str = "origin";
pub const MAIN_BRANCH: &str = "main";
/// Lines of a failing check's output shown in the summary (the whole output is in the log dir).
pub const TAIL_LINES: usize = 40;
/// How pytest's `-rs` report starts the line of a skipped test.
pub const SKIP_MARKER: &str = "SKIPPED";
/// The default log dir is this plus the process id, under the system temp dir.
const LOG_DIR_PREFIX: &str = "dbench-harness-release-";

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct CheckList {
    /// What the checks read, as repo-relative globs (`tools/**`, `*.sh`): a release needs it all committed
    /// before it is tagged. The strings are git `:(glob)` pathspecs.
    pub paths: Vec<String>,
    /// What a benchmark node runs: the repo-relative paths (directories or files, no globs) that
    /// `dbench serve` takes from a release tag to make the release's directory (harness.rs). Each must
    /// be under the checked paths, so what runs is what the checks read.
    #[serde(default)]
    pub harness: Vec<String>,
    #[serde(rename = "check")]
    pub checks: Vec<Check>,
}

#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Check {
    pub name: String,
    /// Working directory, relative to the repo root.
    pub dir: String,
    /// The program and its arguments; run directly, not through a shell.
    pub command: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Files (relative to `dir`) that must exist, or the check fails as "missing".
    #[serde(default)]
    pub requires: Vec<String>,
    /// Test files that must not be skipped: an output line with `SKIPPED` and one of these names
    /// fails the check even when the command exits 0.
    #[serde(default)]
    pub no_skips_of: Vec<String>,
    /// When the check fails, its output lines containing this are shown as well as the tail
    /// (for a command whose failures are far above its last lines).
    #[serde(default)]
    pub failure_marker: Option<String>,
}

/// How one check ended.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    Passed,
    /// The command ran and exited non-zero (or was killed by a signal: no code).
    Failed(Option<i32>),
    /// A required file or the working directory isn't there.
    Missing(String),
    /// The command couldn't be started.
    CannotRun(String),
    /// The command exited 0 but skipped a test that must run; the line that says so.
    Skipped(String),
}

pub fn parse_checks(text: &str) -> Result<CheckList> {
    let list: CheckList = toml::from_str(text)?;
    if list.checks.is_empty() {
        bail!("no checks: a release that checks nothing proves nothing");
    }
    if list.paths.is_empty() {
        bail!("no paths: nothing would have to be committed to be released");
    }
    if let Some(p) = list.paths.iter().find(|p| !inside_repo(p)) {
        bail!("path {p:?} is not a path inside the repo");
    }
    if let Some(p) = list.harness.iter().find(|p| !inside_repo(p)) {
        bail!("harness path {p:?} is not a path inside the repo");
    }
    if let Some(p) = list.harness.iter().find(|p| !checked(p, &list.paths)) {
        bail!("harness path {p:?} is not under the checked paths: what a node runs must be what the checks read");
    }
    let mut seen = BTreeSet::new();
    for c in &list.checks {
        if c.name.trim().is_empty() {
            bail!("a check has no name");
        }
        if !seen.insert(c.name.as_str()) {
            bail!("two checks named {}", c.name);
        }
        if c.command.is_empty() {
            bail!("{}: empty command", c.name);
        }
        if !inside_repo(&c.dir) {
            bail!("{}: dir {:?} is not a path inside the repo", c.name, c.dir);
        }
    }
    Ok(list)
}

/// Whether a plain path is under one of the checked globs that covers a whole tree (`dir/**`).
fn checked(path: &str, paths: &[String]) -> bool {
    paths
        .iter()
        .filter_map(|p| p.strip_suffix("/**"))
        .any(|tree| Path::new(path).starts_with(tree))
}

pub(crate) fn inside_repo(rel: &str) -> bool {
    !rel.is_empty()
        && Path::new(rel)
            .components()
            .all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

/// The next release tag for a date, given the tags that exist: one more than that day's highest.
pub fn next_tag(existing: &[String], (y, m, d): (i64, u32, u32)) -> String {
    let day = format!("{TAG_PREFIX}{y:04}.{m:02}.{d:02}.");
    let highest = existing
        .iter()
        .filter_map(|t| t.strip_prefix(&day)?.parse::<u32>().ok())
        .max()
        .unwrap_or(0);
    format!("{day}{}", highest + 1)
}

/// The first output line that reports a skip of one of `names`.
pub fn skipped_line<'a>(output: &'a str, names: &[String]) -> Option<&'a str> {
    output
        .lines()
        .find(|l| l.contains(SKIP_MARKER) && names.iter().any(|n| l.contains(n.as_str())))
}

/// The last `n` lines of `text`.
pub fn tail(text: &str, n: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(n)..].join("\n")
}

/// The first `n` lines of `text` that contain `marker`.
pub fn marked_lines(text: &str, marker: &str, n: usize) -> String {
    let lines: Vec<&str> = text
        .lines()
        .filter(|l| l.contains(marker))
        .take(n)
        .collect();
    lines.join("\n")
}

impl Outcome {
    pub fn passed(&self) -> bool {
        *self == Outcome::Passed
    }

    /// Why it failed, for the summary line.
    pub fn reason(&self) -> String {
        match self {
            Outcome::Passed => String::new(),
            Outcome::Failed(Some(code)) => format!("exit {code}"),
            Outcome::Failed(None) => "killed by a signal".into(),
            Outcome::Missing(what) => format!("missing: {what}"),
            Outcome::CannotRun(why) => format!("cannot run {why}"),
            Outcome::Skipped(line) => format!("skipped: {line}"),
        }
    }
}

/// Runs one check in the repo, keeping its output (stdout and stderr together) in `log`.
pub fn run_check(repo: &Path, check: &Check, log: &Path) -> Outcome {
    let dir = repo.join(&check.dir);
    if !dir.is_dir() {
        return Outcome::Missing(format!("directory {}", check.dir));
    }
    if let Some(f) = check.requires.iter().find(|f| !dir.join(f).exists()) {
        return Outcome::Missing(Path::new(&check.dir).join(f).display().to_string());
    }
    let program = &check.command[0];
    let streams = File::create(log).and_then(|out| Ok((out.try_clone()?, out)));
    let (out, err) = match streams {
        Ok(pair) => pair,
        Err(e) => return Outcome::CannotRun(format!("{program}: log {}: {e}", log.display())),
    };
    let status = Command::new(program)
        .args(&check.command[1..])
        .current_dir(&dir)
        .envs(&check.env)
        .stdin(Stdio::null())
        .stdout(out)
        .stderr(err)
        .status();
    match status {
        Err(e) => Outcome::CannotRun(format!("{program}: {e}")),
        Ok(s) if !s.success() => Outcome::Failed(s.code()),
        Ok(_) => {
            let output = read_log(log);
            match skipped_line(&output, &check.no_skips_of) {
                Some(line) => Outcome::Skipped(line.trim().to_string()),
                None => Outcome::Passed,
            }
        }
    }
}

fn read_log(log: &Path) -> String {
    std::fs::read(log)
        .map(|b| String::from_utf8_lossy(&b).into_owned())
        .unwrap_or_default()
}

/// `harness unit suite` -> `harness-unit-suite`, for the log's file name.
fn slug(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect()
}

struct CheckResult<'a> {
    check: &'a Check,
    outcome: Outcome,
    elapsed: Duration,
    log: PathBuf,
}

/// Runs every check in order (all of them, so one attempt shows everything that is wrong),
/// printing a line for each as it ends.
fn run_checks<'a>(repo: &Path, checks: &'a [Check], log_dir: &Path) -> Vec<CheckResult<'a>> {
    let width = checks.iter().map(|c| c.name.len()).max().unwrap_or(0);
    let mut results = Vec::with_capacity(checks.len());
    for check in checks {
        let log = log_dir.join(format!("{}.log", slug(&check.name)));
        let start = Instant::now();
        let outcome = run_check(repo, check, &log);
        let elapsed = start.elapsed();
        let verdict = if outcome.passed() { "PASS" } else { "FAIL" };
        let line = format!(
            "  {verdict}  {:<width$}  {:>6}  {}",
            check.name,
            fmt_duration(elapsed.as_secs()),
            outcome.reason()
        );
        println!("{}", line.trim_end());
        results.push(CheckResult {
            check,
            outcome,
            elapsed,
            log,
        });
    }
    results
}

/// For each failed check that ran: what it printed (its marked lines, then the tail).
fn print_failures(results: &[CheckResult]) {
    for r in results.iter().filter(|r| !r.outcome.passed()) {
        let output = read_log(&r.log);
        if output.trim().is_empty() {
            continue;
        }
        println!("\n--- {}: {} ---", r.check.name, r.outcome.reason());
        if let Some(marker) = &r.check.failure_marker {
            let marked = marked_lines(&output, marker, TAIL_LINES);
            if !marked.is_empty() {
                println!("lines with {marker:?} (first {TAIL_LINES} at most):\n{marked}\n");
            }
        }
        println!(
            "last lines of {}:\n{}",
            r.log.display(),
            tail(&output, TAIL_LINES)
        );
    }
}

pub(crate) fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .stdin(Stdio::null())
        .output()
        .context("running git")?;
    if !out.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim_end().to_string())
}

/// The checked paths as git pathspecs.
pub(crate) fn glob_specs(paths: &[String]) -> Vec<String> {
    paths.iter().map(|p| format!(":(glob){p}")).collect()
}

fn remote_main() -> String {
    format!("refs/remotes/{REMOTE}/{MAIN_BRANCH}")
}

/// `git status` lines for the checked paths; with `untracked`, files git doesn't know (and doesn't ignore) too.
fn changes(repo: &Path, paths: &[String], untracked: bool) -> Result<String> {
    let mode = if untracked {
        "--untracked-files=all"
    } else {
        "--untracked-files=no"
    };
    let specs = glob_specs(paths);
    let mut args = vec!["status", "--porcelain", mode, "--"];
    args.extend(specs.iter().map(String::as_str));
    git(repo, &args)
}

/// What a release needs before any check runs: HEAD is what origin/main points at (fetched now),
/// and everything under the checked paths is committed. Returns HEAD's commit.
pub(crate) fn preflight(repo: &Path, paths: &[String]) -> Result<String> {
    let refspec = format!("+refs/heads/{MAIN_BRANCH}:{}", remote_main());
    git(repo, &["fetch", "--quiet", "--tags", REMOTE, &refspec])?;
    let head = git(repo, &["rev-parse", "HEAD"])?;
    let main = git(repo, &["rev-parse", &remote_main()])?;
    if head != main {
        let range = format!("HEAD...{}", remote_main());
        let counts = git(repo, &["rev-list", "--left-right", "--count", &range])?;
        let (ahead, behind) = counts.split_once('\t').unwrap_or(("?", "?"));
        bail!(
            "HEAD is not {REMOTE}/{MAIN_BRANCH} ({ahead} ahead, {behind} behind): \
             a release is of what {MAIN_BRANCH} has, so push or pull first"
        );
    }
    let dirty = changes(repo, paths, true)?;
    if !dirty.is_empty() {
        bail!(
            "uncommitted or untracked files under the checked paths (the checks would run with them, \
             and the tag wouldn't have them); commit, ignore or remove them:\n{dirty}"
        );
    }
    Ok(head)
}

/// After the checks (`during` says what ran meanwhile): the verdict must be on the
/// commit about to be tagged.
pub(crate) fn still_the_same(repo: &Path, paths: &[String], head: &str, during: &str) -> Result<()> {
    let now = git(repo, &["rev-parse", "HEAD"])?;
    if now != head {
        bail!(
            "HEAD moved while {during} (from {head} to {now}): nothing tagged, run it again"
        );
    }
    let dirty = changes(repo, paths, false)?;
    if !dirty.is_empty() {
        bail!(
            "files under the checked paths changed while {during}: nothing tagged\n{dirty}"
        );
    }
    Ok(())
}

pub(crate) fn todays_next_tag(repo: &Path) -> Result<String> {
    let pattern = format!("{TAG_PREFIX}*");
    let tags: Vec<String> = git(repo, &["tag", "--list", &pattern])?
        .lines()
        .map(str::to_string)
        .collect();
    Ok(next_tag(&tags, utc_date(now_secs())))
}

/// How a release whose checks ran here was verified, for its tag.
fn local_verification(head: &str, results: &[CheckResult]) -> String {
    let mut message = format!("Verified by the checks run locally: every check passed on {head}:\n");
    for r in results {
        message.push_str(&format!(
            "- {} ({})\n",
            r.check.name,
            fmt_duration(r.elapsed.as_secs())
        ));
    }
    message
}

/// An annotated tag on `commit`, pushed; a tag that can't be pushed is removed again. Its message
/// says how the commit was `verified`.
pub(crate) fn tag_and_push(repo: &Path, commit: &str, verified: &str) -> Result<String> {
    let tag = todays_next_tag(repo)?;
    let message = format!("Harness release {tag}\n\n{verified}");
    git(
        repo,
        &["tag", "--annotate", "--message", &message, &tag, commit],
    )?;
    let tag_ref = format!("refs/tags/{tag}");
    if let Err(e) = git(repo, &["push", "--quiet", REMOTE, &tag_ref]) {
        let removed = match git(repo, &["tag", "--delete", &tag]) {
            Ok(_) => "the local tag was removed".to_string(),
            Err(e) => format!("and the local tag {tag} could not be removed: {e:#}"),
        };
        bail!("{e:#}\nnot released: {removed}");
    }
    Ok(tag)
}

fn find_repo(given: &Option<PathBuf>) -> Result<PathBuf> {
    let start = match given {
        Some(p) => p.clone(),
        None => std::env::current_dir()?,
    };
    let top = git(&start, &["rev-parse", "--show-toplevel"])
        .with_context(|| format!("{} is not in a git repository", start.display()))?;
    Ok(PathBuf::from(top))
}

fn load_checks(repo: &Path) -> Result<CheckList> {
    let file = repo.join(CHECKS_FILE);
    let text = std::fs::read_to_string(&file)
        .with_context(|| format!("the check list {CHECKS_FILE} ({})", file.display()))?;
    parse_checks(&text).with_context(|| format!("the check list {CHECKS_FILE}"))
}

fn dry_run(repo: &Path, list: &CheckList) -> Result<()> {
    println!("{} checks from {CHECKS_FILE}:", list.checks.len());
    for c in &list.checks {
        let env: String = c.env.iter().map(|(k, v)| format!("{k}={v} ")).collect();
        println!(
            "  {}\n      in {}: {env}{}",
            c.name,
            c.dir,
            c.command.join(" ")
        );
        if !c.requires.is_empty() {
            println!("      needs {}", c.requires.join(", "));
        }
        if !c.no_skips_of.is_empty() {
            println!("      fails if it skips {}", c.no_skips_of.join(", "));
        }
    }
    println!(
        "checked paths (must be committed): {}",
        list.paths.join(" ")
    );
    let head = git(repo, &["rev-parse", "--short", "HEAD"])?;
    println!(
        "would then tag HEAD ({head}) as {} and push it to {REMOTE}, if HEAD is {REMOTE}/{MAIN_BRANCH} \
         (going by the tags here now; a release fetches first)",
        todays_next_tag(repo)?
    );
    println!("dry run: nothing was run, fetched or tagged");
    Ok(())
}

pub fn run(args: &HarnessReleaseArgs) -> Result<()> {
    let repo = find_repo(&args.repo)?;
    let list = load_checks(&repo)?;
    if args.dry_run {
        return dry_run(&repo, &list);
    }
    // A release names a commit; a check-only run checks whatever is checked out.
    let head = if args.check_only {
        None
    } else {
        Some(preflight(&repo, &list.paths)?)
    };
    let own_log_dir = args.log_dir.is_none();
    let log_dir = args.log_dir.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("{LOG_DIR_PREFIX}{}", std::process::id()))
    });
    std::fs::create_dir_all(&log_dir).with_context(|| format!("log dir {}", log_dir.display()))?;

    println!("{} checks from {CHECKS_FILE}:", list.checks.len());
    let results = run_checks(&repo, &list.checks, &log_dir);
    let failed: Vec<&str> = results
        .iter()
        .filter(|r| !r.outcome.passed())
        .map(|r| r.check.name.as_str())
        .collect();
    if !failed.is_empty() {
        print_failures(&results);
        println!("\nfull output of each check: {}", log_dir.display());
        let not_released = if head.is_some() { "not released: " } else { "" };
        bail!(
            "{not_released}{} of {} checks failed ({})",
            failed.len(),
            results.len(),
            failed.join(", ")
        );
    }
    if own_log_dir {
        let _ = std::fs::remove_dir_all(&log_dir);
    }
    match head {
        None => println!(
            "all {} checks passed (check only: nothing tagged)",
            results.len()
        ),
        Some(head) => {
            still_the_same(&repo, &list.paths, &head, "the checks ran")?;
            let tag = tag_and_push(&repo, &head, &local_verification(&head, &results))?;
            println!(
                "all {} checks passed: released {head} as {tag} (pushed to {REMOTE})",
                results.len()
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: (i64, u32, u32) = (2026, 10, 1);

    fn tags(names: &[&str]) -> Vec<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn the_first_release_of_a_day_is_number_one() {
        assert_eq!(next_tag(&[], DAY), "harness-v2026.10.01.1");
        // Other days, other tags and malformed numbers don't count.
        let other = tags(&[
            "harness-v2026.09.30.4",
            "harness-v2026.10.011.7",
            "harness-v2026.10.01.x",
            "harness-v2026.10.01.",
            "harness-v2026.10.01.2-rc",
            "v2026.10.01.3",
        ]);
        assert_eq!(next_tag(&other, DAY), "harness-v2026.10.01.1");
    }

    #[test]
    fn the_nth_release_of_a_day_follows_the_highest_so_far() {
        let one = tags(&["harness-v2026.10.01.1"]);
        assert_eq!(next_tag(&one, DAY), "harness-v2026.10.01.2");
        // A deleted tag leaves a gap; the number is never reused. Order and digits don't matter.
        let gap = tags(&[
            "harness-v2026.10.01.10",
            "harness-v2026.10.01.2",
            "harness-v2026.09.30.40",
        ]);
        assert_eq!(next_tag(&gap, DAY), "harness-v2026.10.01.11");
    }

    const LIST: &str = r#"
paths = ["src/**", "tests/**"]

[[check]]
name = "unit"
dir = "src"
command = ["pytest", "-q"]
env = { REPLAY_ALL = "1" }
requires = ["test_a.py"]
no_skips_of = ["test_a.py"]

[[check]]
name = "shell"
dir = "."
command = ["bash", "tests/run-tests.sh"]
"#;

    #[test]
    fn a_check_list_parses() {
        let list = parse_checks(LIST).unwrap();
        assert_eq!(list.paths, ["src/**", "tests/**"]);
        assert_eq!(list.checks.len(), 2);
        let unit = &list.checks[0];
        assert_eq!((unit.name.as_str(), unit.dir.as_str()), ("unit", "src"));
        assert_eq!(unit.command, ["pytest", "-q"]);
        assert_eq!(unit.env["REPLAY_ALL"], "1");
        assert_eq!(unit.requires, ["test_a.py"]);
        assert_eq!(unit.no_skips_of, ["test_a.py"]);
        let shell = &list.checks[1];
        assert!(shell.env.is_empty() && shell.requires.is_empty() && shell.no_skips_of.is_empty());
    }

    fn err(text: &str) -> String {
        format!("{:#}", parse_checks(text).unwrap_err())
    }

    #[test]
    fn a_check_list_that_proves_nothing_is_refused() {
        // No checks at all: every release would pass.
        assert!(err("paths = [\"src\"]\ncheck = []\n").contains("no checks"));
        assert!(err("paths = [\"src\"]\n").contains("check"));
        // No checked paths: nothing would have to be committed.
        assert!(err(&LIST.replace("[\"src/**\", \"tests/**\"]", "[]")).contains("no paths"));
        assert!(err(&LIST.replace("[\"pytest\", \"-q\"]", "[]")).contains("unit: empty command"));
        assert!(err(&LIST.replace("\"shell\"", "\"unit\"")).contains("two checks named unit"));
        assert!(err(&LIST.replace("name = \"unit\"", "name = \"\"")).contains("no name"));
        // A typo in a field must not silently drop a rule.
        assert!(err(&LIST.replace("no_skips_of", "no_skip_of")).contains("no_skip_of"));
        // Checks and paths stay inside the repo.
        assert!(err(&LIST.replace("dir = \"src\"", "dir = \"../src\"")).contains("../src"));
        assert!(err(&LIST.replace("dir = \"src\"", "dir = \"/src\"")).contains("/src"));
        assert!(err(&LIST.replace("[\"src/**\", \"tests/**\"]", "[\"../**\"]")).contains("../**"));
    }

    #[test]
    fn a_skip_of_a_named_test_file_is_found() {
        let names = tags(&["test_pipeline.py"]);
        let out = "....s..\nSKIPPED [1] test_hostenv.py:12: macOS only\n\
                   SKIPPED [7] test_pipeline.py:41: needs node, npm and npx\n120 passed, 8 skipped in 3s\n";
        assert_eq!(
            skipped_line(out, &names),
            Some("SKIPPED [7] test_pipeline.py:41: needs node, npm and npx")
        );
        // Skips of other files are theirs to decide, and a passing mention is not a skip.
        let fine = "SKIPPED [1] test_hostenv.py:12: macOS only\ntest_pipeline.py .......\n";
        assert_eq!(skipped_line(fine, &names), None);
        assert_eq!(skipped_line(out, &[]), None);
    }

    #[test]
    fn marked_lines_are_the_first_that_carry_the_marker() {
        let out = "  ok   a\n  FAIL b\n  ok   c\n  FAIL d\n  FAIL e\n";
        assert_eq!(marked_lines(out, "FAIL", 2), "  FAIL b\n  FAIL d");
        assert_eq!(marked_lines(out, "nope", 2), "");
    }

    #[test]
    fn the_tail_is_the_last_lines() {
        assert_eq!(tail("a\nb\nc\n", 2), "b\nc");
        assert_eq!(tail("a\nb", 5), "a\nb");
        assert_eq!(tail("", 5), "");
    }

    fn repo_root() -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
    }

    /// The real list: it parses, and names the checks the release is defined by.
    #[test]
    fn the_repos_own_check_list_is_valid() {
        let text = std::fs::read_to_string(repo_root().join(CHECKS_FILE)).unwrap();
        let list = parse_checks(&text).unwrap();
        let names: Vec<&str> = list.checks.iter().map(|c| c.name.as_str()).collect();
        for want in [
            "harness unit suite",
            "harness real-log replay",
            "rust tests (tools workspace)",
            "dbench clippy",
            "benchmarker unit tests",
            "benchmarker end-to-end tests",
            "repo shell tests",
        ] {
            assert!(
                names.contains(&want),
                "no check named {want:?} in {names:?}"
            );
        }
        // Every check runs inside a checked path, so its code has to be committed to be released.
        for c in &list.checks {
            assert!(
                c.dir == "."
                    || list
                        .paths
                        .iter()
                        .filter_map(|p| p.strip_suffix("/**"))
                        .any(|p| Path::new(&c.dir).starts_with(p)),
                "{}: dir {} is not under any of paths",
                c.name,
                c.dir
            );
        }
        // The self-test may not be skipped, and the replay may not be absent or skipped.
        let unit = list
            .checks
            .iter()
            .find(|c| c.name == "harness unit suite")
            .unwrap();
        assert!(unit.no_skips_of.contains(&"test_pipeline.py".to_string()));
        assert!(unit.command.contains(&"-rs".to_string()));
        // The coverage gate: drive.py stays at 100% of lines and branches, measured by the whole suite.
        // Its plugin comes from `uv run --with`, like every other package, never from a step of the workflow.
        const COVERAGE_GATE: [&str; 4] = [
            "--cov=drive",
            "--cov-branch",
            "--cov-fail-under=100",
            "--cov-report=term-missing:skip-covered",
        ];
        for arg in COVERAGE_GATE {
            assert!(unit.command.contains(&arg.to_string()), "the unit suite should run with {arg}");
        }
        let with: Vec<&str> = unit
            .command
            .windows(2)
            .filter(|w| w[0] == "--with")
            .map(|w| w[1].as_str())
            .collect();
        assert!(with.contains(&"pytest-cov"), "{with:?}");
        let replay = list
            .checks
            .iter()
            .find(|c| c.name == "harness real-log replay")
            .unwrap();
        assert_eq!(replay.requires, ["test_replay_real_logs.py"]);
        assert_eq!(replay.env["REPLAY_ALL"], "1");
    }

    /// What a node runs is named by the release itself, is under the checked paths, and holds the
    /// harness's entry point. The node reads the list with its own, more forgiving parser (a newer
    /// checks.toml must not stop an older node); both must find the same paths.
    #[test]
    fn the_repos_check_list_names_the_harness_a_node_runs() {
        let text = std::fs::read_to_string(repo_root().join(CHECKS_FILE)).unwrap();
        let list = parse_checks(&text).unwrap();
        assert!(!list.harness.is_empty());
        assert_eq!(crate::harness::harness_paths(&text).unwrap(), list.harness);
        let entry = Path::new(crate::job::SPEC_BENCH_ENTRY);
        assert!(list.harness.iter().any(|p| entry.starts_with(p)), "{:?}", list.harness);
        for p in &list.harness {
            assert!(repo_root().join(p).exists(), "{p} is not in the repo");
        }
    }

    #[test]
    fn harness_paths_must_be_inside_the_repo_and_under_the_checked_paths() {
        let with = |harness: &str| LIST.replace("paths = [\"src/**\", \"tests/**\"]", &format!("paths = [\"src/**\", \"tests/**\"]\nharness = [{harness}]"));
        assert_eq!(parse_checks(&with("\"src/harness\", \"tests\"")).unwrap().harness, ["src/harness", "tests"]);
        assert!(parse_checks(LIST).unwrap().harness.is_empty());
        let err = |text: &str| format!("{:#}", parse_checks(text).unwrap_err());
        assert!(err(&with("\"../src\"")).contains("../src"));
        assert!(err(&with("\"docs\"")).contains("not under the checked paths"));
        // Under a tree that is checked whole, not merely next to a file pattern.
        assert!(err(&with("\"srcs\"")).contains("not under the checked paths"));
    }

    /// One Rust version for every build: the toolchain file names an exact release (a channel like
    /// "stable" moves, and brings new clippy lints with it).
    #[test]
    fn the_rust_version_is_pinned_in_one_place() {
        const TOOLCHAIN_FILE: &str = "tools/rust-toolchain.toml";
        const VERSION_PARTS: usize = 3; // major.minor.patch; "1.98" would follow its patch releases
        let text = std::fs::read_to_string(repo_root().join(TOOLCHAIN_FILE)).unwrap();
        let doc: toml::Value = toml::from_str(&text).unwrap();
        let channel = doc["toolchain"]["channel"].as_str().unwrap();
        let parts: Vec<&str> = channel.split('.').collect();
        assert!(
            parts.len() == VERSION_PARTS
                && parts
                    .iter()
                    .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())),
            "{TOOLCHAIN_FILE}: channel {channel:?} is not an exact version"
        );
    }
}
