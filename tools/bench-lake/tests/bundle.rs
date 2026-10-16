//! lakelib.code.workspace: TC-47 to TC-58, TC-84, and TC-109 on the fixture's real run.

mod common;
use bench_lake::{Error, Item, Reason, RefusedReason};
use common::*;
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::process::Command;

const BUNDLE: &str = "workspace.bundle";
const REAL_COMMIT_1: &str = "59a592fca04af9fe2c8b667b3a784298795ccde9";
const LAST_STORY: i64 = 12;
const STORY_WITHOUT_COMMIT: i64 = 6;
const RANDOM_BUNDLE_BYTES: usize = 4096;
const LCG_MUL: u64 = 6364136223846793005;
const LCG_ADD: u64 = 1442695040888963407;

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

fn set_commit(state: &Path, story: i64, commit: &str) {
    let p = state.join("collected/gruntus").join(ID_Q36).join("metrics.json");
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    v["stories"][story.to_string()]["commit"] = serde_json::json!(commit);
    fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
}

fn empty_or_missing(p: &Path) -> bool {
    match fs::read_dir(p) {
        Ok(mut it) => it.next().is_none(),
        Err(_) => !p.exists(),
    }
}

#[test]
fn tc47_good() {
    let (s, _state, lake) = scratch_lake("ws-good");
    let run = find(&lake, ID_Q36, Some("gruntus"));
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

#[test]
fn tc48_and_tc109_files_equal_the_repository_workspace() {
    let root = repo_root();
    if !root.join(".git").exists() {
        not_run("TC-48, TC-109", "no repository next to the crate");
        return;
    }
    let tracked = git(&root, &["ls-tree", "-r", "HEAD", "--", &format!("{ID_Q36}/workspace")]);
    if tracked.trim().is_empty() {
        not_run("TC-48, TC-109", "the repository does not track this run's workspace");
        return;
    }
    let (s, _state, lake) = scratch_lake("ws-repo");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let dest = s.join("last");
    let ws = lake.workspace(&run, LAST_STORY, &dest).unwrap();
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), ws.commit);
    let prefix = format!("{ID_Q36}/workspace/");
    let mut compared = 0;
    for l in tracked.lines() {
        let (meta, path) = l.split_once('\t').unwrap();
        let blob = meta.split(' ').nth(2).unwrap();
        let rel = path.strip_prefix(&prefix).unwrap();
        // bytes: the blob git computes for the working copy's file equals the repository's blob
        let hashed = git(&dest, &["hash-object", "--", rel]);
        assert_eq!(hashed, blob, "{rel}");
        compared += 1;
    }
    assert!(compared > 100, "{compared} files compared");
    // the repository's file list is a subset of the working copy; the rest is spec/ (the repository does not keep it)
    let ours = tree_of(&dest, &ws.commit);
    let repo_paths: Vec<&str> = tracked.lines().map(|l| l.split_once('\t').unwrap().1.strip_prefix(&prefix).unwrap()).collect();
    for p in &repo_paths {
        assert!(ours.contains_key(*p), "{p}");
    }
    let extra: Vec<&String> = ours.keys().filter(|p| !repo_paths.contains(&p.as_str())).collect();
    assert!(extra.iter().all(|p| p.starts_with("spec/")), "{extra:?}");
}

#[test]
fn tc49_bundle_unchanged() {
    let (s, _state, lake) = scratch_lake("ws-hash");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let before = fs::read(run.dir.join(BUNDLE)).unwrap();
    lake.workspace(&run, 1, &s.join("w")).unwrap();
    assert_eq!(fs::read(run.dir.join(BUNDLE)).unwrap(), before);
}

#[test]
fn tc50_destination_is_an_existing_empty_folder() {
    let (s, _state, lake) = scratch_lake("ws-empty");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let dest = s.join("w");
    fs::create_dir(&dest).unwrap();
    let ws = lake.workspace(&run, 1, &dest).unwrap();
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), ws.commit);
}

#[test]
fn tc51_no_bundle() {
    let (s, _state, lake) = scratch_lake("ws-nobundle");
    let run = find(&lake, ID_FLASH, Some("tritus"));
    let dest = s.join("w");
    let a = absent(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!(a.reason, Reason::NotCollected);
    assert_eq!(a.item, Item::Bundle);
    assert_eq!(a.node.as_deref(), Some("tritus"));
    assert!(!dest.exists(), "nothing was made");
    // no bundle and no metrics at all: the same absence (the bundle is looked for first)
    let a = absent(lake.workspace(&run, 99, &dest).unwrap_err());
    assert_eq!(a.item, Item::Bundle);
}

#[test]
fn tc51_bundle_that_is_a_link_or_a_folder() {
    let (s, state, lake) = scratch_lake("ws-linkbundle");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let b = state.join("collected/gruntus").join(ID_Q36).join(BUNDLE);
    let moved = s.join("moved.bundle");
    fs::rename(&b, &moved).unwrap();
    symlink(&moved, &b).unwrap();
    let a = absent(lake.workspace(&run, 1, &s.join("w")).unwrap_err());
    assert_eq!((a.reason, a.item), (Reason::NotAFile, Item::Bundle));
}

#[test]
fn tc51_metrics_not_there() {
    let (s, state, lake) = scratch_lake("ws-nometrics");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    fs::remove_file(state.join("collected/gruntus").join(ID_Q36).join("metrics.json")).unwrap();
    let a = absent(lake.workspace(&run, 1, &s.join("w")).unwrap_err());
    assert_eq!(a.reason, Reason::NotCollected);
    assert_eq!(a.item, Item::Workspace(1));
}

#[test]
fn tc52_no_commit_for_the_story() {
    let (s, _state, lake) = scratch_lake("ws-nocommit");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let metrics = lake.value(&run, &bench_lake::Record::Metrics).unwrap();
    assert!(metrics["stories"].get(STORY_WITHOUT_COMMIT.to_string()).is_none(), "story 6 has no entry in the real metrics");
    let dest = s.join("w");
    let a = absent(lake.workspace(&run, STORY_WITHOUT_COMMIT, &dest).unwrap_err());
    assert_eq!(a.reason, Reason::Malformed("no commit for story".to_string()));
    assert_eq!(a.item, Item::Workspace(STORY_WITHOUT_COMMIT));
    assert!(!dest.exists());
    // a story entry without a commit field, and a commit that is not a string
    let (_s2, state2, lake2) = scratch_lake("ws-nocommit2");
    let p = state2.join("collected/gruntus").join(ID_Q36).join("metrics.json");
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    v["stories"]["2"].as_object_mut().unwrap().remove("commit");
    v["stories"]["3"]["commit"] = serde_json::json!(7);
    fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
    let run2 = find(&lake2, ID_Q36, Some("gruntus"));
    for st in [2, 3] {
        let a = absent(lake2.workspace(&run2, st, &s.join("w2")).unwrap_err());
        assert_eq!(a.reason, Reason::Malformed("no commit for story".to_string()), "story {st}");
    }
}

#[test]
fn tc53_commit_not_in_the_bundle() {
    let (s, state, lake) = scratch_lake("ws-notin");
    set_commit(&state, 1, "0123456789abcdef0123456789abcdef01234567");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let dest = s.join("w");
    let a = absent(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!(a.reason, Reason::Malformed("commit not in bundle".to_string()));
    assert_eq!(a.item, Item::Workspace(1));
    assert!(!dest.exists(), "the folder the library made is removed");
    let pre = s.join("pre");
    fs::create_dir(&pre).unwrap();
    absent(lake.workspace(&run, 1, &pre).unwrap_err());
    assert!(empty_or_missing(&pre) && pre.exists(), "an existing empty folder is left empty");
}

#[test]
fn tc54_commit_not_hexadecimal() {
    let (s, state, lake) = scratch_lake("ws-hex");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    for bad in [&REAL_COMMIT_1[..39], "zzz592fca04af9fe2c8b667b3a784298795ccde9", "", "HEAD", "--upload-pack=x"] {
        set_commit(&state, 1, bad);
        let a = absent(lake.workspace(&run, 1, &s.join("w")).unwrap_err());
        assert_eq!(a.reason, Reason::Malformed("commit is not 40 hexadecimal characters".to_string()), "{bad:?}");
    }
    assert!(!s.join("w").exists());
}

#[test]
fn story_out_of_range_for_a_workspace() {
    let (s, _state, lake) = scratch_lake("ws-range");
    let run = find(&lake, ID_Q36, Some("gruntus"));
    for st in [1000, -1] {
        let a = absent(lake.workspace(&run, st, &s.join("w")).unwrap_err());
        assert_eq!(a.reason, Reason::BadName("story out of range".to_string()));
        assert_eq!(a.item, Item::Workspace(st));
    }
}

#[test]
fn tc55_destination_inside_a_root() {
    let (s, state, lake) = scratch_lake("ws-inside");
    let run = find(&lake, ID_Q36, Some("gruntus"));
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
    let (s, _state, lake) = scratch_lake("ws-notempty");
    let run = find(&lake, ID_Q36, Some("gruntus"));
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
fn tc57_git_fails() {
    let (s, state, lake) = scratch_lake("ws-gitfail");
    let b = state.join("collected/gruntus").join(ID_Q36).join(BUNDLE);
    let mut x = 12345u64;
    let random: Vec<u8> = (0..RANDOM_BUNDLE_BYTES)
        .map(|_| {
            x = x.wrapping_mul(LCG_MUL).wrapping_add(LCG_ADD);
            (x >> 33) as u8
        })
        .collect();
    fs::write(&b, random).unwrap();
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let dest = s.join("w");
    let r = refused(lake.workspace(&run, 1, &dest).unwrap_err());
    assert_eq!(r.reason, RefusedReason::GitClone);
    assert_eq!(r.code(), "E-LAKE-GIT-FAILED");
    assert!(r.message.as_deref().is_some_and(|m| !m.is_empty()), "git's message is carried");
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
    let (s, _state, lake) = scratch_lake("ws-env");
    let run = find(&lake, ID_Q36, Some("gruntus"));
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
    let (s, state, lake) = scratch_lake("ws-writes");
    let run = find(&lake, ID_Q36, Some("gruntus"));
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
    let (s, _state, lake) = scratch_lake("ws-ref");
    let run = find(&lake, ID_REFV, None);
    let ws = lake.workspace(&run, 1, &s.join("w")).unwrap();
    assert_eq!(ws.commit.len(), 40);
    assert_eq!(git(&s.join("w"), &["rev-parse", "HEAD"]), ws.commit);
}
