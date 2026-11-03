//! lakelib.equal.old_reads: TC-97 to TC-106 (comparison A, comparison B on scratch repositories, and on the real one).

mod common;
use bench_lake::compare::compare_git;
use bench_lake::{Lake, Record};
use common::*;
use flate2::read::GzDecoder;
use serde_json::{json, Value};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

const HOST_ENV: &str = "BENCH_LAKE_HOST_STATE";
const HOST_REPO_ENV: &str = "BENCH_LAKE_HOST_REPO";

fn walk(dir: &Path, base: &Path, out: &mut Vec<String>) {
    for e in fs::read_dir(dir).unwrap().flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(&p, base, out);
        } else {
            out.push(p.strip_prefix(base).unwrap().to_string_lossy().to_string());
        }
    }
}

fn files_of(dir: &Path) -> Vec<String> {
    let mut v = Vec::new();
    walk(dir, dir, &mut v);
    v.sort();
    v
}

/// Builds a repository holding the preferred copy of every run of `lake` (records only), skipping what is named,
/// with plumbing only: no branch and no ref is created. Returns (repo folder, commit id).
fn build_repo(s: &Scratch, lake: &Lake, skip_runs: &[&str], skip_files: &[(&str, &str)]) -> (PathBuf, String) {
    let repo = s.join("repo");
    fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q"]);
    let d = lake.discover();
    let mut ids: Vec<&str> = d.runs.iter().map(|r| r.id.as_str()).collect();
    ids.dedup();
    for id in ids {
        if skip_runs.contains(&id) {
            continue;
        }
        let run = lake.preferred(&d, id).unwrap();
        for rel in files_of(&run.dir) {
            if Record::from_relative_path(&rel).is_none() || skip_files.contains(&(id, rel.as_str())) {
                continue;
            }
            write(&repo.join(id).join(&rel), &fs::read(run.dir.join(&rel)).unwrap());
        }
    }
    let index = s.join("index");
    let env = |c: &mut Command| {
        c.env_clear()
            .env("PATH", std::env::var("PATH").unwrap())
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_INDEX_FILE", &index)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@example.invalid")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@example.invalid")
            .arg("-C")
            .arg(&repo);
    };
    let run_git = |args: &[&str]| -> String {
        let mut c = Command::new("git");
        env(&mut c);
        let out = c.args(args).output().unwrap();
        assert!(out.status.success(), "{args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    };
    run_git(&["--work-tree", repo.to_str().unwrap(), "add", "-A", "--", "."]);
    let tree = run_git(&["write-tree"]);
    let commit = run_git(&["commit-tree", &tree, "-m", "fixture records"]);
    (repo, commit)
}

fn differences(report: &Value) -> Vec<(String, String, String)> {
    report["differences"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| {
            (
                d["run"].as_str().unwrap().to_string(),
                d["file"].as_str().unwrap().to_string(),
                d["kind"].as_str().unwrap().to_string(),
            )
        })
        .collect()
}

#[test]
fn tc97_a_library_equals_a_direct_read() {
    let lake = fixture_lake();
    let d = lake.discover();
    let (mut compared, mut skipped, mut total) = (0, 0, 0);
    for run in &d.runs {
        for rel in files_of(&run.dir) {
            total += 1;
            let direct = fs::read(run.dir.join(&rel)).unwrap();
            if let Some(record) = Record::from_relative_path(&rel) {
                assert_eq!(lake.bytes(run, &record).unwrap(), direct, "{} {rel}", run.label);
                compared += 1;
            } else if let Some(story) = rel.strip_prefix("stories/").and_then(|r| r.split('/').next()) {
                let story: i64 = story.parse().unwrap();
                if rel.ends_with("agent-events.jsonl") {
                    let log = lake.log(run, story).unwrap();
                    assert_eq!(log.bytes().unwrap(), direct);
                    compared += 1;
                } else if rel.ends_with("agent-events.compact.jsonl.gz") {
                    let mut decoded = Vec::new();
                    GzDecoder::new(&direct[..]).read_to_end(&mut decoded).unwrap();
                    let has_raw = run.dir.join(format!("stories/{story:02}/agent-events.jsonl")).is_file();
                    let log = lake.log(run, story).unwrap();
                    if has_raw {
                        assert_eq!(log.form(), bench_lake::Form::Raw);
                        skipped += 1; // the raw log is returned instead of this one
                    } else {
                        assert_eq!(log.bytes().unwrap(), decoded);
                        compared += 1;
                    }
                }
            } else {
                assert_eq!(rel.rsplit('/').next().unwrap(), "workspace.bundle", "{rel} is neither a record nor a log");
                skipped += 1;
            }
        }
    }
    // every file of every run is accounted for: compared, or a bundle, or a compact log shadowed by a raw one
    assert_eq!(compared + skipped, total);
    assert!(compared > skipped);
}

#[test]
fn tc98_b_library_equals_the_repository_on_the_fixtures() {
    let s = Scratch::new("cmp-ok");
    let lake = fixture_lake();
    let (repo, rev) = build_repo(&s, &lake, &[], &[]);
    let report = compare_git(&lake, &repo, &rev).unwrap();
    assert_eq!(report.defects, 0);
    assert_eq!(report.differences, 0, "{}", report.value);
    assert_eq!(report.runs_compared, FIXTURE_DISTINCT_IDS);
    assert_eq!(report.value["not_compared"], json!([]));
    assert_eq!(report.value["rev"], json!(rev));
}

#[test]
fn tc98_b_on_the_real_repository_nothing_differs() {
    let root = repo_root();
    if !root.join(".git").exists() {
        not_run("TC-98 real repository", "no repository next to the crate");
        return;
    }
    let lake = fixture_lake();
    let report = compare_git(&lake, &root, "HEAD").unwrap();
    assert_eq!(report.defects, 0);
    let differs: Vec<_> = differences(&report.value).into_iter().filter(|d| d.2 == "differs").collect();
    assert!(differs.is_empty(), "fixture files that differ from the repository: {differs:?}");
    assert!(report.runs_compared >= 1);
}

#[test]
fn tc99_b_a_difference_is_reported() {
    let (s, state, lake) = scratch_lake("cmp-differs");
    let (repo, rev) = build_repo(&s, &lake, &[], &[]);
    let p = state.join("collected/node-a").join(ID_FRESH).join("metrics.json");
    let mut bytes = fs::read(&p).unwrap();
    let last = bytes.len() - 1;
    bytes[last] = if bytes[last] == b' ' { b'\n' } else { b' ' };
    fs::write(&p, bytes).unwrap();
    let report = compare_git(&lake, &repo, &rev).unwrap();
    assert_eq!(report.differences, 1, "{}", report.value);
    assert_eq!(differences(&report.value), [(ID_FRESH.to_string(), "metrics.json".to_string(), "differs".to_string())]);
    assert_eq!(report.value["differences"][0]["node"], json!("node-a"));
    assert_eq!(report.value["differences"][0]["lake_complete"], json!(true));
    assert_eq!(report.defects, 0);
}

#[test]
fn tc99_b_equal_values_with_different_bytes_still_differ() {
    // Bytes are compared first; a reformatted file is a difference even if its parsed value is equal.
    let (s, state, lake) = scratch_lake("cmp-format");
    let (repo, rev) = build_repo(&s, &lake, &[], &[]);
    let p = state.join("collected/node-a").join(ID_FRESH).join("run-status.json");
    let v: Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
    let report = compare_git(&lake, &repo, &rev).unwrap();
    assert_eq!(differences(&report.value), [(ID_FRESH.to_string(), "run-status.json".to_string(), "differs".to_string())]);
}

#[test]
fn tc100_b_the_lake_lacks_a_file() {
    let (s, state, lake) = scratch_lake("cmp-lakeabsent");
    let (repo, rev) = build_repo(&s, &lake, &[], &[]);
    fs::remove_file(state.join("collected/node-a").join(ID_FRESH).join("finalize.json")).unwrap();
    fs::remove_file(state.join("collected/node-a").join(ID_DRY).join("finalize.json")).unwrap();
    let report = compare_git(&lake, &repo, &rev).unwrap();
    let mut got = differences(&report.value);
    got.sort();
    assert_eq!(
        got,
        [
            (ID_DRY.to_string(), "finalize.json".to_string(), "lake-absent".to_string()),
            (ID_FRESH.to_string(), "finalize.json".to_string(), "lake-absent".to_string()),
        ]
    );
    let by_run = |id: &str| report.value["differences"].as_array().unwrap().iter().find(|d| d["run"] == id).unwrap().clone();
    assert_eq!(by_run(ID_FRESH)["lake_complete"], json!(true));
    assert_eq!(by_run(ID_DRY)["lake_complete"], json!(false));
}

#[test]
fn tc101_b_the_repository_lacks_a_file() {
    let s = Scratch::new("cmp-repoabsent");
    let lake = fixture_lake();
    let (repo, rev) = build_repo(&s, &lake, &[], &[(ID_FRESH, "finalize.json"), (ID_REFV, "stories/01/gate.json")]);
    let report = compare_git(&lake, &repo, &rev).unwrap();
    let mut got = differences(&report.value);
    got.sort();
    assert_eq!(
        got,
        [
            (ID_REFV.to_string(), "stories/01/gate.json".to_string(), "repository-absent".to_string()),
            (ID_FRESH.to_string(), "finalize.json".to_string(), "repository-absent".to_string()),
        ]
    );
}

#[test]
fn tc102_fixture_drop_list_is_recorded() {
    // The committed drop list is a tab-separated file, every line with file and reason.
    let dir = manifest_dir().join("tests/fixtures");
    let dropped = fs::read_to_string(dir.join("DROPPED.tsv")).unwrap();
    for l in dropped.lines().filter(|l| !l.is_empty()) {
        assert!(l.split('\t').count() >= 2, "{l}");
    }
}

/// The real node names a scratch lake is laid out under; the builder maps them to the fixture's aliases.
const SCRATCH_REAL_NODES: [(&str, &str); 4] = [("host-a", "node-a"), ("host-b", "node-b"), ("host-c", "node-c"), ("host-d", "node-d")];
/// The ref the builder compares the lake with (REPO_REF in make-lake-fixture.sh).
const BUILDER_REPO_REF: &str = "refs/remotes/origin/main";

/// TC-102: the real builder, run on a lake where one tracked record differs from the repository, drops that file,
/// writes it to DROPPED.tsv with its reason, and keeps a tracked record that is equal. The lake is a copy of the
/// fixture laid out under real-looking node names; the repository is a scratch one. The builder is a macOS script
/// (sed -i '', stat -f), so elsewhere this reports not run.
#[test]
fn tc102_the_builder_drops_a_file_that_differs_from_the_repository() {
    if !cfg!(target_os = "macos") {
        not_run("TC-102", "make-lake-fixture.sh is a macOS script");
        return;
    }
    let s = Scratch::new("builder");
    // the builder writes lake/, DROPPED.tsv and MANIFEST.sha256 next to itself: run a copy in the scratch folder
    let here = s.join("fixtures");
    fs::create_dir_all(&here).unwrap();
    let script = here.join("make-lake-fixture.sh");
    fs::copy(manifest_dir().join("tests/fixtures/make-lake-fixture.sh"), &script).unwrap();
    // the lake: the fixture's runs under real-looking node names
    let state = s.join("state");
    let fixture = fixture_state();
    copy_tree(&fixture.join("reference"), &state.join("reference"));
    for (real, alias) in SCRATCH_REAL_NODES {
        let from = fixture.join("collected").join(alias);
        if from.exists() {
            copy_tree(&from, &state.join("collected").join(real));
        }
    }
    // the repository: run.json of ID_FRESH differs from the lake's, finalize.json is the same
    let lake_run = state.join("collected/host-a").join(ID_FRESH);
    let repo = s.join("repo");
    fs::create_dir_all(&repo).unwrap();
    git(&repo, &["init", "-q"]);
    write(&repo.join(ID_FRESH).join("run.json"), b"{\"edited\":true}\n");
    write(&repo.join(ID_FRESH).join("finalize.json"), &fs::read(lake_run.join("finalize.json")).unwrap());
    git(&repo, &["add", "-A"]);
    git(&repo, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "records"]);
    git(&repo, &["update-ref", BUILDER_REPO_REF, "HEAD"]);

    let mut cmd = Command::new("bash");
    cmd.arg(&script);
    for (real, alias) in SCRATCH_REAL_NODES {
        cmd.arg("--alias").arg(format!("{real}={alias}"));
    }
    let out = cmd.arg(&state).arg(&repo).output().unwrap();
    assert!(out.status.success(), "builder failed: {}", String::from_utf8_lossy(&out.stderr));

    let dropped = fs::read_to_string(here.join("DROPPED.tsv")).unwrap();
    let want = format!("collected/node-a/{ID_FRESH}/run.json\t{ID_FRESH}\tdiffers from origin/main\n");
    assert_eq!(dropped, want);
    let built = here.join("lake/collected/node-a").join(ID_FRESH);
    assert!(!built.join("run.json").exists(), "the differing file is not in the fixture");
    assert_eq!(fs::read(built.join("finalize.json")).unwrap(), fs::read(lake_run.join("finalize.json")).unwrap());
    // nothing in the lake was changed: its run.json is still there
    assert!(lake_run.join("run.json").is_file());
}

#[test]
fn tc103_fixture_size_is_within_the_budget() {
    let dir = manifest_dir().join("tests/fixtures");
    let script = fs::read_to_string(dir.join("make-lake-fixture.sh")).unwrap();
    let budget: u64 = script
        .lines()
        .find_map(|l| l.strip_prefix("FIXTURE_BUDGET_BYTES=").map(|v| v.trim().parse().unwrap()))
        .expect("FIXTURE_BUDGET_BYTES in make-lake-fixture.sh");
    let total: u64 = files_of(&dir.join("lake")).iter().map(|f| fs::metadata(dir.join("lake").join(f)).unwrap().len()).sum();
    assert!(total <= budget, "{total} > {budget}");
    assert!(total > 0);
}

#[test]
fn tc105_untracked_runs_are_not_compared_and_not_counted() {
    let s = Scratch::new("cmp-untracked");
    let lake = fixture_lake();
    let (repo, rev) = build_repo(&s, &lake, &[ID_DRY, ID_TODOODLE], &[]);
    let report = compare_git(&lake, &repo, &rev).unwrap();
    assert_eq!(report.runs_compared, FIXTURE_DISTINCT_IDS - 2);
    let mut nc: Vec<String> = report.value["not_compared"].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect();
    nc.sort();
    assert_eq!(nc, [ID_TODOODLE, ID_DRY]);
    assert_eq!(report.differences, 0, "an untracked run is not a set of differences");
}

#[test]
fn tc106_cannot_look_is_not_a_pass() {
    let s = Scratch::new("cmp-cannot");
    let lake = fixture_lake();
    let (repo, rev) = build_repo(&s, &lake, &[], &[]);
    // no repository
    assert!(compare_git(&lake, &s.join("no-such-repo"), &rev).is_err());
    let not_a_repo = s.join("plain");
    fs::create_dir(&not_a_repo).unwrap();
    assert!(compare_git(&lake, &not_a_repo, &rev).is_err());
    // a revision that does not exist
    assert!(compare_git(&lake, &repo, "0123456789abcdef0123456789abcdef01234567").is_err());
    assert!(compare_git(&lake, &repo, "no-such-ref").is_err());
    // no lake
    let none = Lake::in_state_dir(&s.join("no-lake"));
    assert!(compare_git(&none, &repo, &rev).is_err());
    // nothing of the lake is tracked: nothing compared is not a pass
    let empty_repo_s = Scratch::new("cmp-empty");
    let ids: Vec<String> = lake.discover().runs.iter().map(|r| r.id.clone()).collect();
    let skip: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (r2, rev2) = build_repo(&empty_repo_s, &lake, &skip, &[]);
    assert!(compare_git(&lake, &r2, &rev2).is_err());
}

#[test]
fn tc104_real_data_comparison() {
    let (Ok(state), Ok(repo)) = (std::env::var(HOST_ENV), std::env::var(HOST_REPO_ENV)) else {
        not_run("TC-104", &format!("{HOST_ENV} and {HOST_REPO_ENV} are not set: the host's lake is not on this machine, and task 5.32 is open"));
        return;
    };
    let lake = Lake::in_state_dir(Path::new(&state));
    let report = compare_git(&lake, Path::new(&repo), bench_lake::compare::DEFAULT_REV).unwrap();
    assert_eq!(report.defects, 0, "library defects: {}", report.value["defects"]);
    eprintln!("TC-104: {} runs compared, {} differences", report.runs_compared, report.differences);
}
