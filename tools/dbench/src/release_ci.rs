//! `dbench harness-release --verified-by-ci`: cut the release from CI's verdict, running no check here.
//!
//! CI runs the same check list on every push that changes a checked path (the workflow's `paths:`
//! filters), so for such a commit the checks have already run. This asks GitHub, read-only and
//! through the `gh` CLI, for the workflow's runs, and tags the commit of a successful one, provided
//! nothing the checks read differs between that commit and HEAD. Results-only commits start no run,
//! so the commit tagged is often an ancestor of HEAD: the one CI checked, with the same checked files.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use std::io::ErrorKind;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::cli::HarnessReleaseArgs;
use crate::release::{
    git, git_succeeds, glob_specs, preflight, still_the_same, tag_and_push, todays_next_tag,
    CheckList, CHECKS_FILE, MAIN_BRANCH, REMOTE,
};
use crate::timefmt::fmt_duration;

/// The workflow that runs the checks in CI, relative to the repo root.
pub const WORKFLOW_FILE: &str = ".github/workflows/checks.yml";
/// What that workflow must run for its success to be a verdict on the check list.
pub const CHECK_ONLY_INVOCATION: &str = "harness-release --check-only";
/// The GitHub CLI: the owner's existing sign-in, and only ever `run list` (a read).
pub const GH: &str = "gh";
/// The fields asked of `gh run list --json`.
pub const RUN_FIELDS: &str = "databaseId,status,conclusion,headSha,event,url";
/// How many of the workflow's newest push runs are looked at. The runs that can count are those of
/// HEAD and of the commits since the last change to a checked path: the newest there are.
pub const RUN_LIST_LIMIT: u32 = 50;
/// `--wait` gives up after this long by default: longer than the workflow's own 45-minute limit.
pub const DEFAULT_WAIT_TIMEOUT_SECS: u64 = 60 * 60;
/// `--wait` asks GitHub this often by default.
pub const DEFAULT_POLL_SECS: u64 = 30;
/// Only a push run checks exactly the commit it is listed under (a pull request's checks a merge).
const PUSH_EVENT: &str = "push";
const COMPLETED: &str = "completed";
const SUCCESS: &str = "success";
/// A commit id as GitHub gives it: SHA-1 or SHA-256, in hex.
const SHA_LENGTHS: [usize; 2] = [40, 64];
/// Characters of a commit id shown where the whole of it isn't needed.
const SHORT_SHA: usize = 10;

/// One run of the workflow, as `gh run list --json` gives it.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CiRun {
    pub database_id: u64,
    /// `completed`, or a state on the way there (`queued`, `pending`, `in_progress`, ...).
    pub status: String,
    /// Empty (or absent) until the run is completed.
    #[serde(default)]
    pub conclusion: Option<String>,
    pub head_sha: String,
    pub event: String,
    pub url: String,
}

impl CiRun {
    fn completed(&self) -> bool {
        self.status == COMPLETED
    }

    fn succeeded(&self) -> bool {
        self.completed() && self.conclusion.as_deref() == Some(SUCCESS)
    }

    /// Whether `head_sha` is a commit id and nothing else: it is passed to git.
    fn names_a_commit(&self) -> bool {
        SHA_LENGTHS.contains(&self.head_sha.len())
            && self.head_sha.chars().all(|c| c.is_ascii_hexdigit())
    }

    fn conclusion_or_unknown(&self) -> &str {
        match self.conclusion.as_deref() {
            Some(c) if !c.is_empty() => c,
            _ => "no conclusion",
        }
    }
}

pub fn parse_runs(text: &str) -> Result<Vec<CiRun>> {
    Ok(serde_json::from_str(text)?)
}

/// `owner/repo` from a GitHub remote URL (ssh or https, with or without `.git`); None for any other.
pub fn github_slug(url: &str) -> Option<String> {
    const HOST: &str = "github.com";
    let url = url.trim().trim_end_matches('/');
    let url = url.strip_suffix(".git").unwrap_or(url);
    let (before, after) = url.split_once(HOST)?;
    // The host is the whole host: not `notgithub.com`, and followed by the path.
    if !(before.is_empty() || before.ends_with(['@', '/'])) {
        return None;
    }
    let path = after.strip_prefix([':', '/'])?;
    let (owner, repo) = path.split_once('/')?;
    let plain = |s: &str| !s.is_empty() && !s.contains(['/', ':', ' ']) && !s.starts_with('-');
    (plain(owner) && plain(repo)).then(|| format!("{owner}/{repo}"))
}

/// Whether a workflow's text runs the check list: `harness-release --check-only` on a line that
/// isn't a comment. (Not a YAML parse: enough to tell the checks workflow from one that isn't.)
pub fn workflow_runs_the_checks(text: &str) -> bool {
    text.lines()
        .any(|l| !l.trim_start().starts_with('#') && l.contains(CHECK_ONLY_INVOCATION))
}

/// What CI says about the commits whose checked files are HEAD's.
#[derive(Debug, Clone, PartialEq)]
pub enum Verdict {
    /// A completed, successful run: its commit may be tagged.
    Verified(CiRun),
    /// No success yet, and a run hasn't ended.
    InProgress(CiRun),
    /// Every run ended, none in success; the newest of them.
    Failed(CiRun),
    NoRun,
}

/// The verdict from the runs that apply (push runs of a commit with HEAD's checked files), newest
/// first. A success counts whatever else there is (a cancelled run that was run again); failing
/// that an unfinished run may yet succeed; failing that the newest run says why not.
pub fn verdict(applicable: &[CiRun]) -> Verdict {
    if let Some(run) = applicable.iter().find(|r| r.succeeded()) {
        return Verdict::Verified(run.clone());
    }
    if let Some(run) = applicable.iter().find(|r| !r.completed()) {
        return Verdict::InProgress(run.clone());
    }
    match applicable.first() {
        Some(run) => Verdict::Failed(run.clone()),
        None => Verdict::NoRun,
    }
}

fn short(sha: &str) -> &str {
    &sha[..sha.len().min(SHORT_SHA)]
}

fn workflow_name() -> &'static str {
    WORKFLOW_FILE.rsplit('/').next().unwrap_or(WORKFLOW_FILE)
}

/// The workflow's newest push runs, from GitHub (read-only). The repository is origin's when that
/// is a GitHub URL; otherwise gh works it out from the checkout.
fn list_runs(repo: &Path) -> Result<Vec<CiRun>> {
    let limit = RUN_LIST_LIMIT.to_string();
    let mut cmd = Command::new(GH);
    cmd.current_dir(repo)
        .args(["run", "list", "--workflow", workflow_name()])
        .args(["--event", PUSH_EVENT, "--limit", &limit, "--json", RUN_FIELDS])
        .stdin(Stdio::null());
    let origin = git(repo, &["remote", "get-url", REMOTE]).unwrap_or_default();
    if let Some(slug) = github_slug(&origin) {
        cmd.args(["--repo", &slug]);
    }
    let out = match cmd.output() {
        Ok(out) => out,
        Err(e) if e.kind() == ErrorKind::NotFound => bail!(
            "the GitHub CLI (`{GH}`) is not installed, or not on PATH: --verified-by-ci asks GitHub through it. \
             Install it and sign in (`{GH} auth login`), or run the checks here (`dbench harness-release`)"
        ),
        Err(e) => bail!("cannot run `{GH}`: {e}"),
    };
    if !out.status.success() {
        let code = match out.status.code() {
            Some(code) => format!("exit {code}"),
            None => "killed by a signal".to_string(),
        };
        bail!(
            "`{GH} run list` failed ({code}): {}\nif {GH} is not signed in, `{GH} auth status` says so and \
             `{GH} auth login` signs in; or run the checks here (`dbench harness-release`)",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    parse_runs(&String::from_utf8_lossy(&out.stdout))
        .with_context(|| format!("`{GH} run list` did not answer with a list of runs"))
}

/// Whether nothing the checks read, the check list or the workflow differs between `commit` and `head`.
fn same_checked_files(repo: &Path, paths: &[String], commit: &str, head: &str) -> Result<bool> {
    let specs = glob_specs(paths);
    let mut args = vec!["diff", "--quiet", commit, head, "--", CHECKS_FILE, WORKFLOW_FILE];
    args.extend(specs.iter().map(String::as_str));
    git_succeeds(repo, &args)
}

/// What the runs say about `head`.
struct Asked {
    verdict: Verdict,
    /// A successful run of an ancestor that no longer counts: a checked file changed since.
    stale_success: Option<CiRun>,
}

fn ask(repo: &Path, paths: &[String], head: &str) -> Result<Asked> {
    let mut applicable = Vec::new();
    let mut stale_success = None;
    for run in list_runs(repo)? {
        if run.event != PUSH_EVENT || !run.names_a_commit() {
            continue;
        }
        // A commit this checkout doesn't have, or one that isn't in HEAD's history, isn't being released.
        let commit = format!("{}^{{commit}}", run.head_sha);
        if !git_succeeds(repo, &["rev-parse", "--verify", "--quiet", &commit])?
            || !git_succeeds(repo, &["merge-base", "--is-ancestor", &run.head_sha, head])?
        {
            continue;
        }
        if same_checked_files(repo, paths, &run.head_sha, head)? {
            applicable.push(run);
        } else if stale_success.is_none() && run.succeeded() {
            stale_success = Some(run);
        }
    }
    Ok(Asked {
        verdict: verdict(&applicable),
        stale_success,
    })
}

/// Why there is no release, for a verdict that isn't `Verified`.
fn refusal(asked: &Asked, head: &str, waited: Option<Duration>) -> String {
    match &asked.verdict {
        Verdict::Verified(_) => String::new(),
        Verdict::InProgress(run) => {
            let state = format!(
                "the CI run for {} has not ended (status {}): {}",
                short(&run.head_sha),
                run.status,
                run.url
            );
            match waited {
                Some(waited) => format!(
                    "{state}\nstill not ended after waiting {}; run it again, or with a longer --wait-timeout-secs",
                    fmt_duration(waited.as_secs())
                ),
                None => format!(
                    "{state}\nrun it again when the run has ended, or add --wait to wait for it \
                     (up to --wait-timeout-secs, {DEFAULT_WAIT_TIMEOUT_SECS} by default)"
                ),
            }
        }
        Verdict::Failed(run) => format!(
            "the CI run for {} did not succeed (conclusion: {}): {}",
            short(&run.head_sha),
            run.conclusion_or_unknown(),
            run.url
        ),
        Verdict::NoRun => {
            let stale = match &asked.stale_success {
                Some(run) => format!(
                    "\nthe last successful run is for {} ({}), but a checked file, the check list or the \
                     workflow has changed since, so it says nothing about HEAD",
                    short(&run.head_sha),
                    run.url
                ),
                None => String::new(),
            };
            format!(
                "no CI run of {WORKFLOW_FILE} for HEAD ({}), nor for an earlier commit with the same checked \
                 files (the newest {RUN_LIST_LIMIT} push runs were looked at){stale}\n\
                 CI runs only when a push changes a checked path (the workflow's `paths:` filters, the \
                 `paths` of {CHECKS_FILE}): a push of benchmark results alone starts no run. Either run the \
                 checks here (`dbench harness-release`), or push a change under the checked paths and \
                 release once its run has passed",
                short(head)
            )
        }
    }
}

/// Asks until there is a verdict that waiting can't change, or (with `wait`) the timeout passes.
fn verified_run(repo: &Path, paths: &[String], head: &str, args: &HarnessReleaseArgs) -> Result<CiRun> {
    let timeout = Duration::from_secs(args.wait_timeout_secs);
    let poll = Duration::from_secs(args.poll_secs);
    let start = Instant::now();
    loop {
        let asked = ask(repo, paths, head)?;
        let waited = match &asked.verdict {
            Verdict::Verified(run) => return Ok(run.clone()),
            Verdict::InProgress(run) if args.wait => {
                let waited = start.elapsed();
                if waited < timeout {
                    println!(
                        "CI run {} for {} is {}; waiting ({} of {} at most)",
                        run.database_id,
                        short(&run.head_sha),
                        run.status,
                        fmt_duration(waited.as_secs()),
                        fmt_duration(timeout.as_secs())
                    );
                    std::thread::sleep(poll.min(timeout - waited));
                    continue;
                }
                Some(waited)
            }
            _ => None,
        };
        bail!("{}", refusal(&asked, head, waited));
    }
}

/// The workflow in HEAD must run the check list, or its success is a verdict on something else.
fn workflow_guard(repo: &Path) -> Result<()> {
    let text = git(repo, &["show", &format!("HEAD:{WORKFLOW_FILE}")])
        .with_context(|| format!("HEAD has no CI workflow {WORKFLOW_FILE}: nothing ran the checks in CI"))?;
    if !workflow_runs_the_checks(&text) {
        bail!(
            "{WORKFLOW_FILE} in HEAD does not run `dbench {CHECK_ONLY_INVOCATION}`: \
             its success says nothing about the checks of {CHECKS_FILE}"
        );
    }
    Ok(())
}

/// What the tag says about how it was verified.
fn tag_message(run: &CiRun, head: &str) -> String {
    let mut message = format!(
        "Verified by CI, no check was run locally: run {} of {WORKFLOW_FILE} concluded {SUCCESS} for {}\n{}\n",
        run.database_id, run.head_sha, run.url
    );
    if run.head_sha != head {
        message.push_str(&format!(
            "\n{REMOTE}/{MAIN_BRANCH} was at {head}; between the two commits nothing differs under the \
             checked paths, in {CHECKS_FILE} or in {WORKFLOW_FILE}.\n"
        ));
    }
    message
}

fn which_commit(run: &CiRun, head: &str) -> String {
    if run.head_sha == head {
        format!("HEAD ({head})")
    } else {
        format!(
            "{}, not HEAD ({}): it is the commit CI checked, and no checked file differs between the two",
            run.head_sha,
            short(head)
        )
    }
}

fn dry_run(repo: &Path, list: &CheckList, args: &HarnessReleaseArgs) -> Result<()> {
    let refused = |e: anyhow::Error| anyhow!("would not release: {e:#}");
    workflow_guard(repo).map_err(refused)?;
    let head = git(repo, &["rev-parse", "HEAD"])?;
    let run = verified_run(repo, &list.paths, &head, args).map_err(refused)?;
    println!(
        "would tag {} as {} and push it to {REMOTE}: CI run {} concluded {SUCCESS} ({})",
        which_commit(&run, &head),
        todays_next_tag(repo)?,
        run.database_id,
        run.url
    );
    println!(
        "a release first fetches, and needs HEAD to be {REMOTE}/{MAIN_BRANCH} with nothing uncommitted or \
         untracked under the checked paths; none of that was looked at"
    );
    println!("dry run: GitHub was asked (read-only); nothing was run, fetched or tagged");
    Ok(())
}

/// The release on CI's verdict: every git precondition of a local release, and no check run here.
pub fn run(repo: &Path, list: &CheckList, args: &HarnessReleaseArgs) -> Result<()> {
    if args.dry_run {
        return dry_run(repo, list, args);
    }
    let refused = |e: anyhow::Error| anyhow!("not released: {e:#}");
    let head = preflight(repo, &list.paths)?;
    workflow_guard(repo).map_err(refused)?;
    let run = verified_run(repo, &list.paths, &head, args).map_err(refused)?;
    still_the_same(repo, &list.paths, &head, "CI was asked")?;
    let tag = tag_and_push(repo, &run.head_sha, &tag_message(&run, &head))?;
    println!(
        "CI run {} concluded {SUCCESS} ({}): released {} as {tag} (pushed to {REMOTE})",
        run.database_id,
        run.url,
        which_commit(&run, &head)
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `gh run list --json databaseId,status,conclusion,headSha,event,url,createdAt` printed
    /// for this repository's workflow (the owner replaced): a field not asked for is ignored.
    const REAL: &str = r#"[{"conclusion":"","createdAt":"2026-10-01T10:17:31Z","databaseId":36848206617,"event":"push","headSha":"e5c6e71cfd5d3758abe994e2a0193e22f5f52bdb","status":"pending","url":"https://github.com/example/awesome-local-ai/actions/runs/36848206617"},{"conclusion":"","createdAt":"2026-10-01T10:11:51Z","databaseId":36847596596,"event":"push","headSha":"2c35fa922434d31ca5e5ef086093157a83399b0a","status":"in_progress","url":"https://github.com/example/awesome-local-ai/actions/runs/36847596596"},{"conclusion":"cancelled","createdAt":"2026-10-01T10:09:37Z","databaseId":36847358251,"event":"push","headSha":"df33652039161266182079ce99e391943b27b30a","status":"completed","url":"https://github.com/example/awesome-local-ai/actions/runs/36847358251"}]"#;
    const SHA: &str = "e5c6e71cfd5d3758abe994e2a0193e22f5f52bdb";

    fn run(id: u64, status: &str, conclusion: &str) -> CiRun {
        CiRun {
            database_id: id,
            status: status.into(),
            conclusion: Some(conclusion.into()),
            head_sha: SHA.into(),
            event: PUSH_EVENT.into(),
            url: format!("https://ci.example.invalid/runs/{id}"),
        }
    }

    #[test]
    fn ghs_run_list_parses() {
        let runs = parse_runs(REAL).unwrap();
        assert_eq!(runs.len(), 3);
        assert_eq!(runs[0].database_id, 36848206617);
        assert_eq!(runs[0].head_sha, SHA);
        assert_eq!((runs[0].status.as_str(), runs[0].event.as_str()), ("pending", "push"));
        assert!(runs[0].url.ends_with("/actions/runs/36848206617"));
        // Unfinished runs have an empty conclusion; none of these succeeded.
        assert_eq!(runs[0].conclusion.as_deref(), Some(""));
        assert_eq!(runs[2].conclusion.as_deref(), Some("cancelled"));
        assert!(runs.iter().all(|r| !r.succeeded() && r.names_a_commit()));
        assert!(!runs[0].completed() && !runs[1].completed() && runs[2].completed());
        assert_eq!(parse_runs("[]").unwrap(), []);
    }

    #[test]
    fn a_null_or_absent_conclusion_is_no_conclusion() {
        let null = r#"[{"conclusion":null,"databaseId":1,"event":"push","headSha":"ab","status":"queued","url":"u"}]"#;
        let absent = r#"[{"databaseId":1,"event":"push","headSha":"ab","status":"queued","url":"u"}]"#;
        for text in [null, absent] {
            let runs = parse_runs(text).unwrap();
            assert_eq!(runs[0].conclusion, None);
            assert!(!runs[0].succeeded());
            assert_eq!(runs[0].conclusion_or_unknown(), "no conclusion");
        }
    }

    #[test]
    fn an_answer_that_is_not_a_run_list_is_an_error() {
        for text in ["", "<html>", "{}", r#"[{"databaseId":"x"}]"#, r#"[{"databaseId":1}]"#] {
            assert!(parse_runs(text).is_err(), "{text:?}");
        }
    }

    #[test]
    fn only_a_completed_success_succeeded() {
        assert!(run(1, "completed", "success").succeeded());
        for (status, conclusion) in [
            ("completed", "failure"),
            ("completed", "cancelled"),
            ("completed", "skipped"),
            ("completed", "neutral"),
            ("completed", ""),
            ("in_progress", ""),
            // Not a state GitHub reports; a success that isn't completed is not one.
            ("in_progress", "success"),
        ] {
            assert!(!run(1, status, conclusion).succeeded(), "{status} {conclusion}");
        }
    }

    #[test]
    fn a_head_sha_that_is_not_a_commit_id_is_not_passed_to_git() {
        let with = |sha: &str| CiRun {
            head_sha: sha.into(),
            ..run(1, "completed", "success")
        };
        assert!(with(SHA).names_a_commit());
        assert!(with(&"a".repeat(64)).names_a_commit());
        for sha in ["", "HEAD", "--output=/tmp/x", &SHA[1..], &format!("{}g", &SHA[1..])] {
            assert!(!with(sha).names_a_commit(), "{sha:?}");
        }
    }

    #[test]
    fn the_verdict_is_a_success_if_there_is_one_then_a_run_not_ended_then_the_newest_failure() {
        assert_eq!(verdict(&[]), Verdict::NoRun);
        let (ok, failed, cancelled, going) = (
            run(1, "completed", "success"),
            run(2, "completed", "failure"),
            run(3, "completed", "cancelled"),
            run(4, "in_progress", ""),
        );
        assert_eq!(verdict(std::slice::from_ref(&ok)), Verdict::Verified(ok.clone()));
        // A success counts beside a newer failure or unfinished run of the same checked files.
        let all = [going.clone(), failed.clone(), ok.clone(), cancelled.clone()];
        assert_eq!(verdict(&all), Verdict::Verified(ok));
        let unfinished = [failed.clone(), going.clone(), cancelled.clone()];
        assert_eq!(verdict(&unfinished), Verdict::InProgress(going));
        assert_eq!(verdict(&[cancelled.clone(), failed]), Verdict::Failed(cancelled));
    }

    #[test]
    fn the_repository_is_taken_from_a_github_origin() {
        for url in [
            "git@github.com:owner/repo.git",
            "https://github.com/owner/repo.git",
            "https://github.com/owner/repo",
            "https://github.com/owner/repo/",
            "ssh://git@github.com/owner/repo.git",
            "https://user@github.com/owner/repo.git\n",
        ] {
            assert_eq!(github_slug(url).as_deref(), Some("owner/repo"), "{url}");
        }
        // Anything else is left to gh: a local path, another host, or not a repository's URL.
        for url in [
            "",
            "/srv/git/remote.git",
            "https://gitlab.com/owner/repo.git",
            "https://notgithub.com/owner/repo",
            "https://github.com/owner",
            "https://github.com/owner/repo/extra",
            "git@github.com:--flag/repo",
        ] {
            assert_eq!(github_slug(url), None, "{url}");
        }
    }

    #[test]
    fn a_workflow_runs_the_checks_only_where_it_invokes_them() {
        assert!(workflow_runs_the_checks(
            "steps:\n  - run: tools/dbench/target/debug/dbench harness-release --check-only --log-dir x\n"
        ));
        assert!(!workflow_runs_the_checks("# run by `dbench harness-release --check-only`\nsteps: []\n"));
        assert!(!workflow_runs_the_checks("  # dbench harness-release --check-only\n"));
        assert!(!workflow_runs_the_checks("steps:\n  - run: dbench harness-release\n"));
        assert!(!workflow_runs_the_checks(""));
    }

    /// The repo's own workflow is the one asked about, and it runs the check list (not merely in a comment).
    #[test]
    fn the_repos_ci_workflow_runs_the_check_list() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let workflow = std::fs::read_to_string(root.join(WORKFLOW_FILE)).unwrap();
        assert!(workflow_runs_the_checks(&workflow));
        assert_eq!(workflow_name(), "checks.yml");
        // The workflow gives up before the default wait does.
        let limit = workflow
            .lines()
            .find_map(|l| l.trim().strip_prefix("timeout-minutes:"))
            .and_then(|m| m.trim().parse::<u64>().ok())
            .expect("the job's timeout-minutes");
        const SECS_PER_MIN: u64 = 60;
        assert!(limit * SECS_PER_MIN < DEFAULT_WAIT_TIMEOUT_SECS);
    }

    #[test]
    fn the_tag_message_names_the_run_and_the_commit_it_checked() {
        let run = run(7, "completed", "success");
        let on_head = tag_message(&run, SHA);
        for part in ["Verified by CI", "run 7", &run.url, SHA] {
            assert!(on_head.contains(part), "{on_head}");
        }
        assert!(!on_head.contains("was at"));
        let head = "f".repeat(40);
        let earlier = tag_message(&run, &head);
        assert!(earlier.contains(&format!("was at {head}")) && earlier.contains(SHA), "{earlier}");
    }
}
