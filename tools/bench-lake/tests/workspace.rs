//! lakelib.code.workspace: TC-47 to TC-58, TC-84, TC-109 on the fixture's real run, and story 23's TC-80 and TC-81:
//! the working copy comes from the lake's code repository (`state/code.git`), at the copy's `story/NN` ref.

mod common;
use bench_lake::{Error, Item, Reason, RefusedReason};
use common::*;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::process::Command;

const REAL_COMMIT_1: &str = "59a592fca04af9fe2c8b667b3a784298795ccde9";
const LAST_STORY: i64 = 12;
const STORY_WITHOUT_COMMIT: i64 = 6;
/// A tree no repository holds: a commit made to point at it is in the code repository, its files are not.
const MISSING_TREE: &str = "0123456789abcdef0123456789abcdef01234567";

fn absent(e: Error) -> bench_lake::Absent {
    match e {
        Error::Absent(a) => a,
        Error::Refused(r) => panic!("expected an absence, got {r:?}"),
    }
}

fn refused(e: Error) -> bench_lake::Refused {
    match e {
        Error::Refused(r) => r,
        Error::Absent(a) => panic!("expected a refusal, got {a:?}"),
    }
}

fn empty_or_missing(p: &Path) -> bool {
    match fs::read_dir(p) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => !p.exists(),
    }
}

#[test]
fn tc47_good() {
    let (s, _state, lake) = scratch_lake_with_code("ws-good");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let dest = s.join("work");
    let ws = lake.workspace(&run, 1, &dest).unwrap();
    assert_eq!(ws.path, dest);
    assert_eq!(ws.commit, REAL_COMMIT_1);
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), REAL_COMMIT_1);
    assert_eq!(git(&dest, &["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD", "detached");
    assert_eq!(git(&dest, &["status", "--porcelain"]), "", "a clean tree");
    assert!(dest.join(".git").is_dir());
    let metrics = lake.value(&run, &bench_lake::Record::Metrics).unwrap();
    assert_eq!(metrics["stories"]["1"]["commit"].as_str().unwrap(), ws.commit);
}

fn tree_of(dir: &Path, commit: &str) -> BTreeMap<String, String> {
    git(dir, &["ls-tree", "-r", commit])
        .lines()
        .map(|l| {
            let (meta, path) = l.split_once('\t').unwrap();
            (path.to_string(), meta.split(' ').nth(2).unwrap().to_string())
        })
        .collect()
}

/// The workspace mirror the repository tracked for ID_Q36 at story 12, as `<blob>\t<path>` lines: taken from
/// commit 8ba488994 (8 Oct 2026, "story 12 done"), `git ls-tree -r 8ba488994 -- <id>/workspace`. Main's history no
/// longer tracks workspace mirrors (they were removed from it), and that commit survives only in local tags, so the
/// listing is kept here and the test runs everywhere.
const REPO_WORKSPACE_AT_STORY_12: &str = "tests/fixtures/workspace-mirror-q36-story12.tsv";

#[test]
fn tc48_and_tc109_files_equal_the_repository_workspace() {
    let listing = fs::read_to_string(manifest_dir().join(REPO_WORKSPACE_AT_STORY_12)).unwrap();
    let tracked: Vec<(&str, &str)> = listing.lines().map(|l| l.split_once('\t').unwrap()).collect();
    let (s, _state, lake) = scratch_lake_with_code("ws-repo");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let dest = s.join("last");
    let ws = lake.workspace(&run, LAST_STORY, &dest).unwrap();
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), ws.commit);
    let mut compared = 0;
    for (blob, rel) in &tracked {
        // bytes: the blob git computes for the working copy's file equals the repository's blob
        let hashed = git(&dest, &["hash-object", "--", rel]);
        assert_eq!(&hashed, blob, "{rel}");
        compared += 1;
    }
    assert!(compared > 100, "{compared} files compared");
    // the repository's file list is a subset of the working copy; the rest is spec/ (the repository does not keep it)
    let ours = tree_of(&dest, &ws.commit);
    let repo_paths: Vec<&str> = tracked.iter().map(|(_, p)| *p).collect();
    for p in &repo_paths {
        assert!(ours.contains_key(*p), "{p}");
    }
    let extra: Vec<&String> = ours.keys().filter(|p| !repo_paths.contains(&p.as_str())).collect();
    assert!(extra.iter().all(|p| p.starts_with("spec/")), "{extra:?}");
}

#[test]
fn tc49_the_code_repository_is_unchanged() {
    let (s, state, lake) = scratch_lake_with_code("ws-hash");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let before = snapshot(&state.join("code.git"));
    lake.workspace(&run, 1, &s.join("w")).unwrap();
    assert_eq!(snapshot(&state.join("code.git")), before);
}

#[test]
fn tc50_destination_is_an_existing_empty_folder() {
    let (s, _state, lake) = scratch_lake_with_code("ws-empty");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let dest = s.join("w");
    fs::create_dir(&dest).unwrap();
    let ws = lake.workspace(&run, 1, &dest).unwrap();
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), ws.commit);
}

#[test]
fn tc81_a_run_with_no_code_in_the_lake() {
    let (s, _state, lake) = scratch_lake_with_code("ws-nocode");
    let run = find(&lake, ID_FLASH, Some("node-d"));
    let dest = s.join("w");
    let a = absent(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!((a.reason.clone(), a.item.clone()), (Reason::NoRef, Item::Code));
    assert_eq!(a.code(), "E-LAKE-NOT-COLLECTED");
    assert_eq!(a.node.as_deref(), Some("node-d"));
    assert!(!dest.exists(), "nothing was made");
}

#[test]
fn tc81_a_lake_without_a_code_repository() {
    let (s, _state, lake) = scratch_lake("ws-norepo");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let a = absent(lake.workspace(&run, 1, &s.join("w")).unwrap_err());
    assert_eq!((a.reason.clone(), a.item.clone()), (Reason::NoRef, Item::Code));
    assert!(!s.join("w").exists());
}

#[test]
fn tc81_a_story_the_lake_has_no_ref_for() {
    let (s, _state, lake) = scratch_lake_with_code("ws-nostory");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let metrics = lake.value(&run, &bench_lake::Record::Metrics).unwrap();
    assert!(metrics["stories"].get(STORY_WITHOUT_COMMIT.to_string()).is_none(), "story 6 has no entry in the real metrics");
    let dest = s.join("w");
    let a = absent(lake.workspace(&run, STORY_WITHOUT_COMMIT, &dest).unwrap_err());
    assert_eq!((a.reason.clone(), a.item.clone()), (Reason::NoRef, Item::Code));
    assert!(!dest.exists());
    // the same for a story beyond the last
    let a = absent(lake.workspace(&run, LAST_STORY + 1, &dest).unwrap_err());
    assert_eq!((a.reason.clone(), a.item.clone()), (Reason::NoRef, Item::Code));
}

#[test]
fn the_working_copy_does_not_need_the_runs_metrics() {
    let (s, state, lake) = scratch_lake_with_code("ws-nometrics");
    let run = find(&lake, ID_Q36, Some("node-a"));
    fs::remove_file(state.join("collected/node-a").join(ID_Q36).join("metrics.json")).unwrap();
    let ws = lake.workspace(&run, 1, &s.join("w")).unwrap();
    assert_eq!(ws.commit, REAL_COMMIT_1);
}

#[test]
fn tc80_the_working_copy_is_the_story_refs_commit_and_its_history_only() {
    let (s, state, lake) = scratch_lake_with_code("ws-ref");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let code = state.join("code.git");
    let reference = bench_lake::code::story_ref("node-a", ID_Q36, 3);
    let at_ref = git(&code, &["rev-parse", &reference]);
    let dest = s.join("w");
    let ws = lake.workspace(&run, 3, &dest).unwrap();
    assert_eq!(ws.commit, at_ref);
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), at_ref);
    assert_eq!(git(&dest, &["rev-list", "--count", "HEAD"]), git(&code, &["rev-list", "--count", &reference]), "the story's history");
    assert_eq!(git(&dest, &["for-each-ref", "--format=%(refname)"]), "refs/lake/story", "no other run's refs, no later story");
    // a story ref moved (a story restarted on the node): the working copy follows the ref
    let story_2 = git(&code, &["rev-parse", &bench_lake::code::story_ref("node-a", ID_Q36, 2)]);
    git(&code, &["update-ref", &reference, &story_2]);
    let moved = lake.workspace(&run, 3, &s.join("moved")).unwrap();
    assert_eq!(moved.commit, story_2);
}

#[test]
fn tc53_a_story_commit_whose_files_are_not_in_the_repository() {
    let (s, state, lake) = scratch_lake_with_code("ws-notin");
    let code = state.join("code.git");
    let broken = Command::new("git")
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .arg("--git-dir")
        .arg(&code)
        .args(["hash-object", "-t", "commit", "-w", "--literally", "--stdin"])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut c| {
            use std::io::Write;
            c.stdin.take().unwrap().write_all(format!("tree {MISSING_TREE}\nauthor a <a> 0 +0000\ncommitter a <a> 0 +0000\n\nbroken\n").as_bytes())?;
            c.wait_with_output()
        })
        .unwrap();
    let broken = String::from_utf8(broken.stdout).unwrap().trim().to_string();
    git(&code, &["update-ref", &bench_lake::code::story_ref("node-a", ID_Q36, 1), &broken]);
    let run = find(&lake, ID_Q36, Some("node-a"));
    let dest = s.join("w");
    let r = refused(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!(r.reason, RefusedReason::GitClone);
    assert_eq!(r.code(), "E-LAKE-GIT-FAILED");
    assert!(r.message.as_deref().is_some_and(|m| !m.is_empty()), "git's message is carried");
    assert!(!dest.exists(), "the folder the library made is removed");
    let pre = s.join("pre");
    fs::create_dir(&pre).unwrap();
    refused(lake.workspace(&run, 1, &pre).unwrap_err());
    assert!(empty_or_missing(&pre) && pre.exists(), "an existing empty folder is left empty");
}

#[test]
fn story_out_of_range_for_a_workspace() {
    let (s, _state, lake) = scratch_lake_with_code("ws-range");
    let run = find(&lake, ID_Q36, Some("node-a"));
    for st in [1000, -1] {
        let a = absent(lake.workspace(&run, st, &s.join("w")).unwrap_err());
        assert_eq!(a.reason, Reason::BadName("story out of range".to_string()));
        assert_eq!(a.item, Item::Workspace(st));
    }
}

#[test]
fn tc55_destination_inside_a_root() {
    let (s, state, lake) = scratch_lake_with_code("ws-inside");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let inside = state.join("collected/new-dest");
    let r = refused(lake.workspace(&run, 1, &inside).unwrap_err());
    assert_eq!(r.reason, RefusedReason::DestInsideRoot);
    assert!(!inside.exists());
    // inside the reference folder, and the root itself
    assert_eq!(refused(lake.workspace(&run, 1, &state.join("reference/x")).unwrap_err()).reason, RefusedReason::DestInsideRoot);
    assert_eq!(refused(lake.workspace(&run, 1, &state.join("collected")).unwrap_err()).reason, RefusedReason::DestInsideRoot);
    // a link outside that points inside
    let link = s.join("link");
    symlink(state.join("collected"), &link).unwrap();
    let r = refused(lake.workspace(&run, 1, &link.join("via-link")).unwrap_err());
    assert_eq!(r.reason, RefusedReason::DestInsideRoot);
    assert!(!state.join("collected/via-link").exists());
    // a path that climbs back into the root
    let climbing = s.join("a/../state/collected/climb");
    fs::create_dir_all(s.join("a")).unwrap();
    assert_eq!(refused(lake.workspace(&run, 1, &climbing).unwrap_err()).reason, RefusedReason::DestInsideRoot);
    assert!(!state.join("collected/climb").exists());
}

#[test]
fn tc56_destination_not_empty() {
    let (s, _state, lake) = scratch_lake_with_code("ws-notempty");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let dest = s.join("w");
    write(&dest.join("keep.txt"), b"mine");
    let r = refused(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!(r.reason, RefusedReason::DestNotEmpty);
    assert_eq!(fs::read(dest.join("keep.txt")).unwrap(), b"mine");
    assert_eq!(fs::read_dir(&dest).unwrap().count(), 1);
    // a file in the destination's place
    let file = s.join("afile");
    fs::write(&file, b"x").unwrap();
    assert_eq!(refused(lake.workspace(&run, 1, &file).unwrap_err()).reason, RefusedReason::DestNotEmpty);
}

#[test]
fn tc57_a_code_repository_that_is_not_one() {
    let (s, state, lake) = scratch_lake("ws-gitfail");
    fs::write(state.join("code.git"), b"not a repository").unwrap();
    let run = find(&lake, ID_Q36, Some("node-a"));
    let dest = s.join("w");
    let a = absent(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!((a.reason.clone(), a.item.clone()), (Reason::NoRef, Item::Code));
    assert!(empty_or_missing(&dest));
}

/// Puts the environment variables back, also when the test panics.
struct EnvGuard(Vec<(&'static str, Option<std::ffi::OsString>)>);

impl Drop for EnvGuard {
    fn drop(&mut self) {
        for (k, v) in self.0.drain(..) {
            match v {
                Some(v) => std::env::set_var(k, v),
                None => std::env::remove_var(k),
            }
        }
    }
}

#[test]
fn tc58_the_callers_git_settings_do_not_matter() {
    let (s, _state, lake) = scratch_lake_with_code("ws-env");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let plain = s.join("plain");
    lake.workspace(&run, 1, &plain).unwrap();
    // A template folder with a hook, a global config that sets a hooks path and a template folder.
    let template = s.join("template");
    write(&template.join("hooks/post-checkout"), format!("#!/bin/sh\ntouch {}/HOOK-RAN\n", s.path().display()).as_bytes());
    Command::new("chmod").arg("+x").arg(template.join("hooks/post-checkout")).status().unwrap();
    let hooks = s.join("hooks");
    write(&hooks.join("post-checkout"), format!("#!/bin/sh\ntouch {}/HOOK-RAN\n", s.path().display()).as_bytes());
    Command::new("chmod").arg("+x").arg(hooks.join("post-checkout")).status().unwrap();
    let cfg = s.join("gitconfig");
    fs::write(
        &cfg,
        format!(
            "[core]\n\thooksPath = {}\n\tautocrlf = true\n[init]\n\ttemplateDir = {}\n[checkout]\n\tdefaultRemote = nonsense\n",
            hooks.display(),
            template.display()
        ),
    )
    .unwrap();
    let guard = EnvGuard(
        ["GIT_CONFIG_GLOBAL", "GIT_TEMPLATE_DIR", "GIT_DIR", "GIT_WORK_TREE", "HOME"].iter().map(|k| (*k, std::env::var_os(k))).collect(),
    );
    std::env::set_var("GIT_CONFIG_GLOBAL", &cfg);
    std::env::set_var("GIT_TEMPLATE_DIR", &template);
    std::env::set_var("GIT_DIR", s.join("nonexistent-git-dir"));
    std::env::set_var("GIT_WORK_TREE", s.join("nonexistent-tree"));
    std::env::set_var("HOME", s.path());
    let dirty = s.join("dirty");
    let result = lake.workspace(&run, 1, &dirty);
    drop(guard);
    let ws = result.unwrap();
    assert!(!s.join("HOOK-RAN").exists(), "no hook of the caller's configuration ran");
    assert_eq!(ws.commit, REAL_COMMIT_1);
    assert_eq!(tree_of(&dirty, &ws.commit), tree_of(&plain, &ws.commit));
    let files = |d: &Path| -> BTreeMap<String, Vec<u8>> {
        tree_of(d, REAL_COMMIT_1).keys().map(|p| (p.clone(), fs::read(d.join(p)).unwrap())).collect()
    };
    assert_eq!(files(&dirty), files(&plain), "same bytes, no line-ending conversion");
    assert_eq!(fs::read_dir(dirty.join(".git/hooks")).map(|d| d.count()).unwrap_or(0), 0, "no hook was copied from the template");
}

#[test]
fn tc84_workspace_writes_only_its_destination() {
    let (s, state, lake) = scratch_lake_with_code("ws-writes");
    let run = find(&lake, ID_Q36, Some("node-a"));
    let before = snapshot(&state);
    let dest = s.join("w");
    lake.workspace(&run, 1, &dest).unwrap();
    assert_eq!(snapshot(&state), before);
    assert!(dest.join(".git").is_dir() && fs::read_dir(&dest).unwrap().count() > 1);
    // the same after a refusal and after an absence
    let _ = lake.workspace(&run, 1, &state.join("collected/x"));
    let _ = lake.workspace(&run, STORY_WITHOUT_COMMIT, &s.join("w2"));
    assert_eq!(snapshot(&state), before);
}

#[test]
fn a_reference_run_has_a_workspace_too() {
    let (s, _state, lake) = scratch_lake_with_code("ws-ref");
    let run = find(&lake, ID_REFV, None);
    let ws = lake.workspace(&run, 1, &s.join("w")).unwrap();
    assert_eq!(ws.commit.len(), 40);
    assert_eq!(git(&s.join("w"), &["rev-parse", "HEAD"]), ws.commit);
}
