//! The lake's code repository (story 23, code.lake_repo): one bare git repository beside the lake, `<state>/code.git`,
//! that holds every run's code. A copy of a run has its refs under `refs/runs/<node>/<run>/`: its branch heads at
//! `heads/<branch>` and the commit each story ended on at `story/NN`. `<node>` is the copy's node as bench-lake reports
//! it, or `reference` for a reference run (its files sit in the lake's reference root whichever node ran it). There is
//! one object store, so what two runs share is kept once.
//!
//! Two writers fill it: `import_bundles`, once, from the `workspace.bundle` files already in the lake, and the
//! collector (`apply_code`), from each node's code endpoint. git runs through bench-lake's `git_command`, which sees
//! no user or system configuration.

use anyhow::{bail, Context, Result};
use bench_lake::code::{git_command, BUNDLE_FILE};
use bench_lake::{Lake, Record, RunRef};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

/// The repository's folder name in the lake's state folder.
pub use bench_lake::code::{CODE_REPO, HEADS, REFERENCE_NODE, RUNS_REFS, STORY};
const BRANCH_PREFIX: &str = "refs/heads/";
/// A recorded commit in full.
pub const FULL_COMMIT_LEN: usize = 40;
/// The shortest recorded commit taken as a prefix; shorter could match by chance.
pub const MIN_COMMIT_PREFIX: usize = 7;

/// The bundle does not verify, or git could not take it.
pub const E_CODE_BAD_BUNDLE: &str = "E-CODE-BAD-BUNDLE";
/// A story's recorded commit is not among the commits of its run's own heads (or names none, or more than one).
pub const E_CODE_STORY_MISSING: &str = "E-CODE-STORY-MISSING";
/// The run's metrics.json can't be read, so no story ref can be made; its heads are still written.
pub const E_CODE_NO_RECORD: &str = "E-CODE-NO-RECORD";
/// A folder that holds a bundle but that the lake does not take as a run (bench-lake rejected it), so no reader can
/// find its code.
pub const E_CODE_NOT_A_RUN: &str = "E-CODE-NOT-A-RUN";
/// The node's dbench has no code route (an old node): the run's files are still pulled, its code is not.
pub const E_CODE_ENDPOINT_MISSING: &str = "E-CODE-ENDPOINT-MISSING";
/// A story key of metrics.json that is not a story number.
pub const E_CODE_BAD_STORY: &str = "E-CODE-BAD-STORY";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ImportProblem {
    pub code: &'static str,
    pub node: String,
    pub run: String,
    pub story: Option<u32>,
    pub detail: String,
}

/// What an import did. `copies` counts the copies that have a bundle; `fetched` those whose objects had to be read
/// from the bundle; `unchanged` those of which no ref moved.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportReport {
    pub copies: usize,
    pub fetched: usize,
    pub unchanged: usize,
    pub head_refs_written: usize,
    pub story_refs_written: usize,
    pub problems: Vec<ImportProblem>,
}

/// The node segment of a lake copy's refs.
pub use bench_lake::code::{head_ref, node_of, run_prefix, story_ref};

/// bench-lake's rule for the names a refs path is made from (`code::check_names`), as this crate's errors.
pub fn check_names(node: &str, run: &str) -> Result<()> {
    bench_lake::code::check_names(node, run).map_err(anyhow::Error::msg)
}

fn git(code: &Path) -> Command {
    let mut c = git_command();
    c.arg("-C").arg(code);
    c
}

fn message_of(out: &Output) -> String {
    let text = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if text.is_empty() {
        format!("git exited with {}", out.status)
    } else {
        text
    }
}

fn checked(mut cmd: Command, what: &str) -> Result<String> {
    let out = cmd.output().with_context(|| format!("run git {what}"))?;
    if !out.status.success() {
        bail!("git {what}: {}", message_of(&out));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The bare repository at `code`, made (readable by the owner alone) when it is not there.
pub fn open(code: &Path) -> Result<()> {
    if code.join("HEAD").is_file() {
        return Ok(());
    }
    crate::store::create_private_dir_all(code)?;
    let mut init = git(code);
    init.args(["init", "--quiet", "--bare", "--template="]);
    checked(init, "init")?;
    Ok(())
}

/// Every ref under `prefix/` with the commit it names.
pub fn refs_under(code: &Path, prefix: &str) -> Result<BTreeMap<String, String>> {
    let mut c = git(code);
    c.args(["for-each-ref", "--format=%(refname) %(objectname)"]).arg(format!("{prefix}/"));
    Ok(checked(c, "for-each-ref")?
        .lines()
        .filter_map(|l| l.split_once(' ').map(|(r, o)| (r.to_string(), o.to_string())))
        .collect())
}

fn has_commit(code: &Path, commit: &str) -> bool {
    git(code)
        .args(["cat-file", "-e", &format!("{commit}^{{commit}}")])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Sets every ref to its commit in one transaction (all or none).
fn update_refs(code: &Path, updates: &BTreeMap<String, String>) -> Result<()> {
    if updates.is_empty() {
        return Ok(());
    }
    let mut child = git(code)
        .args(["update-ref", "--stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .context("run git update-ref")?;
    {
        let mut stdin = child.stdin.take().context("git update-ref stdin")?;
        writeln!(stdin, "start")?;
        for (r, c) in updates {
            writeln!(stdin, "update {r} {c}")?;
        }
        writeln!(stdin, "prepare")?;
        writeln!(stdin, "commit")?;
    }
    let out = child.wait_with_output()?;
    if !out.status.success() {
        bail!("git update-ref: {}", message_of(&out));
    }
    Ok(())
}

/// The branch heads a verified bundle holds: branch name to commit.
fn bundle_branches(code: &Path, bundle: &Path) -> Result<BTreeMap<String, String>> {
    let mut c = git(code);
    c.args(["bundle", "list-heads"]).arg(bundle);
    Ok(checked(c, "bundle list-heads")?
        .lines()
        .filter_map(|l| {
            let (commit, name) = l.split_once(' ')?;
            Some((name.strip_prefix(BRANCH_PREFIX)?.to_string(), commit.to_string()))
        })
        .collect())
}

/// Every commit reachable from the run's own heads.
fn run_commits(code: &Path, node: &str, run: &str) -> Result<BTreeSet<String>> {
    let mut c = git(code);
    c.arg("rev-list").arg(format!("--glob={}/{HEADS}/*", run_prefix(node, run)));
    Ok(checked(c, "rev-list")?.lines().map(str::to_string).collect())
}

/// The run's commit a story's record names: the commit itself when it is one of the run's, or the one commit of the
/// run a shorter record begins.
pub fn resolve_commit(recorded: &str, commits: &BTreeSet<String>) -> Option<String> {
    let recorded = recorded.to_ascii_lowercase();
    if recorded.len() < MIN_COMMIT_PREFIX || recorded.len() > FULL_COMMIT_LEN || !recorded.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut found = commits.range(recorded.clone()..).take_while(|c| c.starts_with(&recorded));
    let first = found.next()?;
    found.next().is_none().then(|| first.clone())
}

/// Takes one copy's bundle into the repository. Returns whether its objects had to be read from the bundle and how
/// many head refs moved.
fn take_bundle(code: &Path, node: &str, run: &str, bundle: &Path) -> std::result::Result<(bool, usize), String> {
    let verify = git(code)
        .args(["bundle", "verify", "--quiet"])
        .arg(bundle)
        .output()
        .map_err(|e| e.to_string())?;
    if !verify.status.success() {
        return Err(message_of(&verify));
    }
    let branches = bundle_branches(code, bundle).map_err(|e| e.to_string())?;
    let held = refs_under(code, &format!("{}/{HEADS}", run_prefix(node, run))).map_err(|e| e.to_string())?;
    let wanted: BTreeMap<String, String> = branches.iter().map(|(b, c)| (head_ref(node, run, b), c.clone())).collect();
    let moved: BTreeMap<String, String> = wanted.into_iter().filter(|(r, c)| held.get(r) != Some(c)).collect();
    if moved.is_empty() {
        return Ok((false, 0));
    }
    // A commit in the store came with its whole history (a fetch takes a bundle whole or not at all), so when every
    // head is there already, as for the other node folders' copies of the same run, the refs are set without reading
    // the bundle's objects again.
    if moved.values().all(|c| has_commit(code, c)) {
        update_refs(code, &moved).map_err(|e| e.to_string())?;
        return Ok((false, moved.len()));
    }
    let fetch = git(code)
        .args(["fetch", "--quiet", "--atomic", "--no-tags", "--no-write-fetch-head"])
        .arg(bundle)
        .arg(format!("+{BRANCH_PREFIX}*:{}/{HEADS}/*", run_prefix(node, run)))
        .output()
        .map_err(|e| e.to_string())?;
    if !fetch.status.success() {
        return Err(message_of(&fetch));
    }
    Ok((true, moved.len()))
}

/// The story refs a copy's record gives, checked against the run's own commits; the stories that can't be given are
/// listed.
fn story_updates(code: &Path, lake: &Lake, copy: &RunRef, node: &str, problems: &mut Vec<ImportProblem>) -> Result<BTreeMap<String, String>> {
    let problem = |code: &'static str, story: Option<u32>, detail: String| ImportProblem {
        code,
        node: node.to_string(),
        run: copy.id.clone(),
        story,
        detail,
    };
    let metrics = match lake.value(copy, &Record::Metrics) {
        Ok(m) => m,
        Err(a) => {
            problems.push(problem(E_CODE_NO_RECORD, None, format!("{a:?}")));
            return Ok(BTreeMap::new());
        }
    };
    let Some(stories) = metrics.get("stories").and_then(|s| s.as_object()) else {
        problems.push(problem(E_CODE_NO_RECORD, None, "metrics.json has no stories".to_string()));
        return Ok(BTreeMap::new());
    };
    let commits = run_commits(code, node, &copy.id)?;
    let mut out = BTreeMap::new();
    for (key, story) in stories {
        let Ok(n) = key.parse::<u32>() else {
            problems.push(problem(E_CODE_BAD_STORY, None, format!("story key {key:?}")));
            continue;
        };
        match story.get("commit").and_then(|c| c.as_str()) {
            None => problems.push(problem(E_CODE_STORY_MISSING, Some(n), "no commit recorded".to_string())),
            Some(recorded) => match resolve_commit(recorded, &commits) {
                Some(commit) => {
                    out.insert(story_ref(node, &copy.id, n), commit);
                }
                None => problems.push(problem(
                    E_CODE_STORY_MISSING,
                    Some(n),
                    format!("{recorded} is not a commit of this run's bundle"),
                )),
            },
        }
    }
    Ok(out)
}

/// Takes every `workspace.bundle` in the lake into the code repository at `lake_code`, with a story ref for each story
/// commit its run's record names. Safe to repeat: a copy already taken moves no ref and adds no object. A bundle that
/// fails, or a story that can't be given a ref, is listed and the import goes on; an error is returned only when the
/// repository itself can't be used.
pub fn import_bundles(lake: &Lake, lake_code: &Path) -> Result<ImportReport> {
    open(lake_code)?;
    let mut report = ImportReport::default();
    let discovery = lake.discover();
    for rejected in &discovery.rejected {
        if rejected.path.join(BUNDLE_FILE).is_file() {
            report.problems.push(ImportProblem {
                code: E_CODE_NOT_A_RUN,
                node: String::new(),
                run: rejected.label.clone(),
                story: None,
                detail: format!("{BUNDLE_FILE} in a folder the lake rejects ({})", rejected.code),
            });
        }
    }
    for copy in &discovery.runs {
        let bundle = copy.dir.join(BUNDLE_FILE);
        if !bundle.is_file() {
            continue;
        }
        report.copies += 1;
        let node = node_of(copy).to_string();
        let bundle: PathBuf = std::path::absolute(&bundle)?;
        let (fetched, heads) = match take_bundle(lake_code, &node, &copy.id, &bundle) {
            Ok(done) => done,
            Err(detail) => {
                report.problems.push(ImportProblem {
                    code: E_CODE_BAD_BUNDLE,
                    node,
                    run: copy.id.clone(),
                    story: None,
                    detail,
                });
                continue;
            }
        };
        report.fetched += usize::from(fetched);
        report.head_refs_written += heads;
        let wanted = story_updates(lake_code, lake, copy, &node, &mut report.problems)?;
        let held = refs_under(lake_code, &format!("{}/{STORY}", run_prefix(&node, &copy.id)))?;
        let moved: BTreeMap<String, String> = wanted.into_iter().filter(|(r, c)| held.get(r) != Some(c)).collect();
        update_refs(lake_code, &moved)?;
        report.story_refs_written += moved.len();
        if heads == 0 && moved.is_empty() {
            report.unchanged += 1;
        }
    }
    Ok(report)
}

/// `dbench code-import`: the report on stdout (JSON with --json); an error, and so a non-zero exit, when anything was
/// listed.
pub fn cmd_code_import(state: &Path, json: bool) -> Result<()> {
    let report = import_bundles(&Lake::in_state_dir(state), &state.join(CODE_REPO))?;
    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        println!(
            "{} copies with a bundle: {} read from their bundle, {} unchanged; {} head refs and {} story refs written",
            report.copies, report.fetched, report.unchanged, report.head_refs_written, report.story_refs_written
        );
        for p in &report.problems {
            let story = p.story.map(|s| format!(" story {s}")).unwrap_or_default();
            println!("{} {} {}{story}: {}", p.code, p.node, p.run, p.detail);
        }
    }
    if !report.problems.is_empty() {
        bail!("{} problems listed", report.problems.len());
    }
    Ok(())
}

// ---- the collector's half ----

/// What one pull of a run's code did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Pulled {
    /// The node had no commit the lake lacks (204).
    NothingNew,
    /// A bundle was taken; this many refs of the run moved.
    Applied { refs_moved: usize },
    /// The node has no repository for the run, or does not list it (404 with an error).
    NoCode(String),
    /// The node's dbench has no code route (404 without a body): an old node.
    EndpointMissing,
}

static INCOMING: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
const INCOMING_PREFIX: &str = "incoming-";
const BUNDLE_SUFFIX: &str = ".bundle";
const TAG_PREFIX: &str = "refs/tags/story-";

/// Takes a bundle from a node into the run's refs: its branches under `heads/`, its `story-NN` tags under `story/NN`.
/// The bundle is verified first (complete, and its prerequisites held), and fetched in one transaction, so a bundle cut
/// short or damaged moves no ref. Returns how many of the run's refs moved.
pub fn apply_code(lake_code: &Path, node: &str, run: &str, bundle: &Path) -> Result<usize> {
    check_names(node, run)?;
    open(lake_code)?;
    let bundle = std::path::absolute(bundle)?;
    let verify = git(lake_code)
        .args(["bundle", "verify", "--quiet"])
        .arg(&bundle)
        .output()
        .context("run git bundle verify")?;
    if !verify.status.success() {
        bail!("{E_CODE_BAD_BUNDLE}: {}", message_of(&verify));
    }
    let prefix = run_prefix(node, run);
    let before = refs_under(lake_code, &prefix)?;
    let fetch = git(lake_code)
        .args(["fetch", "--quiet", "--atomic", "--no-tags", "--no-write-fetch-head"])
        .arg(&bundle)
        .arg(format!("+{BRANCH_PREFIX}*:{prefix}/{HEADS}/*"))
        .arg(format!("+{TAG_PREFIX}*:{prefix}/{STORY}/*"))
        .output()
        .context("run git fetch")?;
    if !fetch.status.success() {
        bail!("{E_CODE_BAD_BUNDLE}: {}", message_of(&fetch));
    }
    let after = refs_under(lake_code, &prefix)?;
    Ok(after.iter().filter(|(r, c)| before.get(*r) != Some(c)).count())
}

/// Pulls the commits of a run that the lake lacks from its node: sends the tips the lake holds for the run, writes the
/// answer to a file inside the repository, takes it (`apply_code`) and removes the file whatever happened.
pub async fn pull_code(api: &crate::client::Api, lake_code: &Path, node: &str, run: &str) -> Result<Pulled> {
    check_names(node, run)?;
    open(lake_code)?;
    let haves: BTreeSet<String> = refs_under(lake_code, &run_prefix(node, run))?.into_values().collect();
    let haves: Vec<String> = haves.into_iter().collect();
    let (status, body) = api.run_code(run, &haves).await?;
    match status {
        reqwest::StatusCode::NO_CONTENT => Ok(Pulled::NothingNew),
        reqwest::StatusCode::NOT_FOUND if body.is_empty() => Ok(Pulled::EndpointMissing),
        reqwest::StatusCode::NOT_FOUND => Ok(Pulled::NoCode(String::from_utf8_lossy(&body).into_owned())),
        s if s.is_success() => {
            let n = INCOMING.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            let file = lake_code.join(format!("{INCOMING_PREFIX}{}-{n}{BUNDLE_SUFFIX}", std::process::id()));
            // git runs off the async workers: a pass pulls many runs from many nodes at once.
            let (code, node, run, at) = (lake_code.to_path_buf(), node.to_string(), run.to_string(), file.clone());
            let applied = tokio::task::spawn_blocking(move || -> Result<usize> {
                std::fs::write(&at, &body)?;
                apply_code(&code, &node, &run, &at)
            })
            .await
            .map_err(anyhow::Error::from)
            .and_then(|r| r);
            let _ = std::fs::remove_file(&file);
            Ok(Pulled::Applied { refs_moved: applied? })
        }
        s => bail!("{s}: {}", String::from_utf8_lossy(&body)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r4";
    const REF_RUN: &str = "benchmarks/reference/vidi/opus-5.5/run-1";

    #[test]
    fn ref_names_keep_the_run_ids_slashes_and_number_stories_in_two_digits() {
        assert_eq!(head_ref("thing2", RUN, "main"), format!("refs/runs/thing2/{RUN}/heads/main"));
        assert_eq!(story_ref("thing2", RUN, 1), format!("refs/runs/thing2/{RUN}/story/01"));
        assert_eq!(story_ref("thing2", RUN, 99), format!("refs/runs/thing2/{RUN}/story/99"));
        assert_eq!(story_ref("thing2", RUN, 100), format!("refs/runs/thing2/{RUN}/story/100"));
        assert_eq!(story_ref(REFERENCE_NODE, REF_RUN, 3), format!("refs/runs/reference/{REF_RUN}/story/03"));
    }

    #[test]
    fn only_a_run_id_and_a_node_name_the_lake_accepts_make_refs() {
        assert!(check_names("thing2", RUN).is_ok());
        assert!(check_names(REFERENCE_NODE, REF_RUN).is_ok());
        for (node, run) in [
            ("thing2", "combinations/../../refs/heads/x"),
            ("thing2", "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/.."),
            ("thing2", "combinations/qwen/3.8"),
            ("thing2", ""),
            ("a/b", RUN),
            ("..", RUN),
            ("", RUN),
        ] {
            assert!(check_names(node, run).is_err(), "{node} {run}");
        }
    }

    #[test]
    fn a_refused_name_writes_nothing() {
        let code = std::env::temp_dir().join(format!("dbench-lake-code-unit-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&code);
        assert!(apply_code(&code, "thing2", "combinations/../x", Path::new("/nonexistent.bundle")).is_err());
        assert!(!code.exists(), "no repository made for a refused name");
    }

    #[test]
    fn a_recorded_commit_is_one_of_the_runs_own_or_the_only_one_it_begins() {
        let commits: BTreeSet<String> = [
            "aaaaaaa1111111111111111111111111111111aa",
            "aaaaaaa2222222222222222222222222222222bb",
            "bcdef01234567890123456789012345678901234",
        ]
        .into_iter()
        .map(String::from)
        .collect();
        assert_eq!(
            resolve_commit("bcdef01234567890123456789012345678901234", &commits).as_deref(),
            Some("bcdef01234567890123456789012345678901234")
        );
        assert_eq!(
            resolve_commit("BCDEF01", &commits).as_deref(),
            Some("bcdef01234567890123456789012345678901234"),
            "case does not matter"
        );
        assert_eq!(
            resolve_commit("aaaaaaa1", &commits).as_deref(),
            Some("aaaaaaa1111111111111111111111111111111aa")
        );
        assert_eq!(resolve_commit("aaaaaaa", &commits), None, "begins two");
        assert_eq!(resolve_commit("bcdef0", &commits), None, "shorter than 7");
        assert_eq!(
            resolve_commit("cccccccccccccccccccccccccccccccccccccccc", &commits),
            None,
            "not this run's"
        );
        assert_eq!(
            resolve_commit("bcdef01234567890123456789012345678901234ff", &commits),
            None,
            "longer than 40"
        );
        assert_eq!(resolve_commit("bcdefg0", &commits), None, "not hexadecimal");
    }
}
