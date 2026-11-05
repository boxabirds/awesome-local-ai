//! The lake's code repository (story 23, code.lake_repo): `dbench code-import` takes every workspace.bundle already in
//! the lake into `<state>/code.git`, with `story/NN` refs from the commits the runs' records name (TC-1A to TC-1D).
//! Real git, real bundles copied from the lake (tests/fixtures/code_lake/README.md), in temporary folders.

use dbench::lake_code::{self, import_bundles, ImportReport, E_CODE_BAD_BUNDLE, E_CODE_STORY_MISSING};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const NODE: &str = "gruntus";
const MLX: &str = "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r4";
const GUFO: &str = "combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2";
const STRATA: &str = "combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/benchmarks/vidi/strata-s2on-r1";
/// A reference run's place in the lake (`<state>/reference/<pack>/<stack>/<run>`) and its id.
const REF_DIR: &str = "vidi/opus-5.5/run-9";
const REF_RUN: &str = "benchmarks/reference/vidi/opus-5.5/run-9";
const MLX_STORIES: usize = 3;
const GUFO_STORIES: usize = 11;
const SHORT_COMMIT: usize = 7;

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/code_lake")
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        let dest = to.join(e.file_name());
        if e.file_type().unwrap().is_dir() {
            copy_tree(&e.path(), &dest);
        } else {
            fs::copy(e.path(), &dest).unwrap();
        }
    }
}

/// A state folder holding a copy of the fixture lake.
fn state(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-lake-code-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    copy_tree(&fixture(), &d);
    fs::remove_file(d.join("README.md")).unwrap();
    d
}

fn run_dir(state: &Path, run: &str) -> PathBuf {
    state.join("collected").join(NODE).join(run)
}

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}

/// Every ref of the code repository with the commit it names.
fn refs(code: &Path) -> BTreeMap<String, String> {
    git(code, &["for-each-ref", "--format=%(refname) %(objectname)"])
        .lines()
        .map(|l| {
            let (r, c) = l.split_once(' ').unwrap();
            (r.to_string(), c.to_string())
        })
        .collect()
}

fn bundle_heads(bundle: &Path) -> BTreeMap<String, String> {
    let out = Command::new("git").args(["bundle", "list-heads"]).arg(bundle).output().unwrap();
    String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .filter_map(|l| {
            let (c, r) = l.split_once(' ')?;
            Some((r.strip_prefix("refs/heads/")?.to_string(), c.to_string()))
        })
        .collect()
}

fn story_commits(dir: &Path) -> BTreeMap<u32, String> {
    let m: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("metrics.json")).unwrap()).unwrap();
    m["stories"]
        .as_object()
        .unwrap()
        .iter()
        .map(|(k, v)| (k.parse().unwrap(), v["commit"].as_str().unwrap().to_string()))
        .collect()
}

/// What the object store holds: the loose objects and every pack file's name.
fn objects(code: &Path) -> (String, Vec<String>) {
    let count = git(code, &["count-objects", "-v"]);
    let mut packs: Vec<String> = fs::read_dir(code.join("objects/pack"))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    packs.sort();
    (count, packs)
}

fn import(state: &Path) -> ImportReport {
    import_bundles(&bench_lake::Lake::in_state_dir(state), &state.join(lake_code::CODE_REPO)).unwrap()
}

fn problems_of<'a>(r: &'a ImportReport, run: &str) -> Vec<&'a lake_code::ImportProblem> {
    r.problems.iter().filter(|p| p.run == run).collect()
}

#[test]
fn import_takes_each_runs_heads_and_one_story_ref_per_recorded_story_commit() {
    // TC-1A
    let s = state("import");
    // A reference run: its copy has no node, so its refs go under `reference`, bench-lake's label for that root.
    copy_tree(&run_dir(&s, MLX), &s.join("reference").join(REF_DIR));
    let code = s.join(lake_code::CODE_REPO);
    assert!(!code.exists(), "no code repository before the import");

    let report = import(&s);

    let refs = refs(&code);
    for (node, run, dir, stories) in [
        (NODE, MLX, run_dir(&s, MLX), MLX_STORIES),
        (NODE, GUFO, run_dir(&s, GUFO), GUFO_STORIES),
        (lake_code::REFERENCE_NODE, REF_RUN, s.join("reference").join(REF_DIR), MLX_STORIES),
    ] {
        for (branch, commit) in bundle_heads(&dir.join("workspace.bundle")) {
            assert_eq!(
                refs.get(&format!("refs/runs/{node}/{run}/heads/{branch}")),
                Some(&commit),
                "{run} {branch}"
            );
        }
        let want = story_commits(&dir);
        assert_eq!(want.len(), stories);
        for (n, commit) in &want {
            assert_eq!(refs.get(&format!("refs/runs/{node}/{run}/story/{n:02}")), Some(commit), "{run} story {n}");
        }
        let written = refs.keys().filter(|r| r.starts_with(&format!("refs/runs/{node}/{run}/story/"))).count();
        assert_eq!(written, stories, "one story ref per recorded story of {run}, no more");
        assert!(problems_of(&report, run).is_empty(), "{run}: {:?}", report.problems);
    }
    assert_eq!(report.copies, 4);
    // The reference copy holds the same bundle as the mlx-serve run: its objects are read once, and the second copy
    // only gets its refs.
    assert_eq!(report.fetched, 3);
    // Nothing but the runs' refs.
    assert!(refs.keys().all(|r| r.starts_with("refs/runs/")), "{refs:?}");
    // The lake's bundles are left where they were.
    assert!(run_dir(&s, MLX).join("workspace.bundle").is_file());
    fs::remove_dir_all(s).unwrap();
}

#[test]
fn a_second_import_changes_no_ref_and_adds_no_object() {
    // TC-1B
    let s = state("again");
    let code = s.join(lake_code::CODE_REPO);
    import(&s);
    let (refs_before, objects_before) = (refs(&code), objects(&code));

    let again = import(&s);

    assert_eq!(refs(&code), refs_before);
    assert_eq!(objects(&code), objects_before);
    assert_eq!(again.fetched, 0, "no copy fetched again");
    assert_eq!(again.story_refs_written, 0);
    assert_eq!(again.unchanged, again.copies);
    fs::remove_dir_all(s).unwrap();
}

#[test]
fn a_truncated_bundle_is_listed_the_other_runs_are_imported_and_the_command_exits_non_zero() {
    // TC-1C
    let s = state("truncated");
    let bundle = run_dir(&s, GUFO).join("workspace.bundle");
    let bytes = fs::read(&bundle).unwrap();
    fs::write(&bundle, &bytes[..bytes.len() / 2]).unwrap();

    let report = import(&s);

    let listed = problems_of(&report, GUFO);
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!(listed[0].code, E_CODE_BAD_BUNDLE);
    assert_eq!((listed[0].node.as_str(), listed[0].story), (NODE, None));
    let refs = refs(&s.join(lake_code::CODE_REPO));
    assert!(!refs.keys().any(|r| r.contains(GUFO)), "nothing of the bad bundle: {refs:?}");
    assert_eq!(
        refs.keys().filter(|r| r.contains(&format!("{MLX}/story/"))).count(),
        MLX_STORIES,
        "the other runs imported"
    );

    // The command: the same report, and a non-zero exit because something was listed.
    let out = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(["--json", "code-import", "--state"])
        .arg(&s)
        .output()
        .unwrap();
    assert!(!out.status.success());
    let shown: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert!(
        shown["problems"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["code"] == E_CODE_BAD_BUNDLE && p["run"] == GUFO),
        "{shown}"
    );
    fs::remove_dir_all(s).unwrap();
}

#[test]
fn a_story_commit_missing_from_its_bundle_is_listed_and_the_runs_heads_are_still_written() {
    // TC-1D, on the real case: strata-s2on-r1's bundle holds snapshot commits, not the commit its record names.
    let s = state("missing");
    let report = import(&s);

    let listed = problems_of(&report, STRATA);
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!((listed[0].code, listed[0].story), (E_CODE_STORY_MISSING, Some(2)));
    let refs = refs(&s.join(lake_code::CODE_REPO));
    for (branch, commit) in bundle_heads(&run_dir(&s, STRATA).join("workspace.bundle")) {
        assert_eq!(refs.get(&format!("refs/runs/{NODE}/{STRATA}/heads/{branch}")), Some(&commit));
    }
    assert!(!refs.keys().any(|r| r.starts_with(&format!("refs/runs/{NODE}/{STRATA}/story/"))));
    fs::remove_dir_all(s).unwrap();
}

#[test]
fn a_bundle_in_a_folder_the_lake_does_not_take_as_a_run_is_listed_not_skipped() {
    // Found on the real lake, 5 Nov 2026: reference vidi opus-5.5 run-1 has a bundle and a metrics.json but no
    // run.json or collection.json, so bench-lake rejects the folder (E-LAKE-NO-MARKER) and the import never saw it.
    let s = state("nomarker");
    let dir = s.join("reference").join(REF_DIR);
    copy_tree(&run_dir(&s, MLX), &dir);
    fs::remove_file(dir.join("run.json")).unwrap();

    let report = import(&s);

    let listed: Vec<_> = report.problems.iter().filter(|p| p.code == lake_code::E_CODE_NOT_A_RUN).collect();
    assert_eq!(listed.len(), 1, "{:?}", report.problems);
    assert_eq!(listed[0].run, format!("reference/{REF_DIR}"), "named by its place in the lake");
    assert!(listed[0].detail.contains("E-LAKE-NO-MARKER"), "{}", listed[0].detail);
    assert!(!refs(&s.join(lake_code::CODE_REPO)).keys().any(|r| r.contains(REF_DIR)));
    fs::remove_dir_all(s).unwrap();
}

#[test]
fn a_short_recorded_commit_is_the_one_commit_of_the_run_it_begins_and_one_of_another_run_is_missing() {
    // TC-1D, boundary: 11 records in the lake hold 7 characters. The object store is shared, so a commit that only
    // another run holds must not count for this one.
    let s = state("short");
    let mlx = run_dir(&s, MLX);
    let full = story_commits(&mlx);
    let gufo_commit = story_commits(&run_dir(&s, GUFO))[&1].clone();
    let metrics = serde_json::json!({"stories": {
        "1": {"commit": full[&1][..SHORT_COMMIT]},
        "2": {"commit": gufo_commit},
        "3": {"commit": full[&3]},
    }});
    fs::write(mlx.join("metrics.json"), metrics.to_string()).unwrap();

    let report = import(&s);

    let refs = refs(&s.join(lake_code::CODE_REPO));
    assert_eq!(
        refs.get(&format!("refs/runs/{NODE}/{MLX}/story/01")),
        Some(&full[&1]),
        "the short commit, in full"
    );
    assert_eq!(refs.get(&format!("refs/runs/{NODE}/{MLX}/story/03")), Some(&full[&3]));
    assert!(
        !refs.contains_key(&format!("refs/runs/{NODE}/{MLX}/story/02")),
        "another run's commit is not this run's"
    );
    let listed = problems_of(&report, MLX);
    assert_eq!(listed.len(), 1, "{listed:?}");
    assert_eq!((listed[0].code, listed[0].story), (E_CODE_STORY_MISSING, Some(2)));
    fs::remove_dir_all(s).unwrap();
}
