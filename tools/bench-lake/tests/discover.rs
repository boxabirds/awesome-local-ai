//! lakelib.layout.discover: TC-01 to TC-16.

mod common;
use bench_lake::{Kind, Lake};
use common::*;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;

const NODE_PATH: &str = "collected/gruntus/combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi";
const REAL_HOST_ENV: &str = "BENCH_LAKE_HOST_STATE";

fn labels(d: &bench_lake::Discovery) -> Vec<(String, &'static str)> {
    d.rejected.iter().map(|r| (r.label.clone(), r.code)).collect()
}

fn make_run(state: &Path, rel_from_state: &str) {
    write(&state.join(rel_from_state).join("run.json"), b"{}");
}

#[test]
fn tc01_combination_run_one_copy() {
    let lake = fixture_lake();
    let d = lake.discover();
    let copies = lake.copies(&d, ID_FLASH);
    assert_eq!(copies.len(), 1);
    let r = copies[0];
    assert_eq!(r.kind, Kind::Combination);
    assert_eq!(r.node.as_deref(), Some("tritus"));
    assert_eq!(r.id, ID_FLASH);
    assert_eq!(r.dir, fixture_state().join("collected/tritus").join(ID_FLASH));
    assert_eq!(r.label, format!("collected/tritus/{ID_FLASH}"));
}

#[test]
fn whole_fixture_lake_is_listed_in_order() {
    let d = fixture_lake().discover();
    assert!(d.rejected.is_empty(), "{:?}", d.rejected);
    assert!(d.missing_roots.is_empty());
    let got: Vec<(String, Option<String>)> = d.runs.iter().map(|r| (r.id.clone(), r.node.clone())).collect();
    let want: Vec<(String, Option<String>)> = vec![
        (ID_TODOODLE, None),
        (ID_REFV, None),
        (ID_Q36, Some("gruntus")),
        (ID_Q36, Some("quintus")),
        (ID_Q36, Some("tritus")),
        (ID_DRY, Some("gruntus")),
        (ID_FRESH, Some("gruntus")),
        (ID_FLASH, Some("tritus")),
    ]
    .into_iter()
    .map(|(i, n)| (i.to_string(), n.map(String::from)))
    .collect();
    assert_eq!(got, want);
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT);
}

#[test]
fn tc02_combination_run_several_copies() {
    let lake = fixture_lake();
    let d = lake.discover();
    let copies = lake.copies(&d, ID_Q36);
    let nodes: Vec<&str> = copies.iter().map(|r| r.node.as_deref().unwrap()).collect();
    assert_eq!(nodes, ["gruntus", "quintus", "tritus"]);
    assert!(copies.iter().all(|r| r.kind == Kind::Combination && r.id == ID_Q36));
}

#[test]
fn tc03_reference_run() {
    let lake = fixture_lake();
    let d = lake.discover();
    let copies = lake.copies(&d, ID_REFV);
    assert_eq!(copies.len(), 1);
    let r = copies[0];
    assert_eq!(r.kind, Kind::Reference);
    assert_eq!(r.node, None);
    assert_eq!(r.id, "benchmarks/reference/vidi/sonnet-5.5/v2-r1");
    assert_eq!(r.dir, fixture_state().join("reference/vidi/sonnet-5.5/v2-r1"));
    assert_eq!(r.label, "reference/vidi/sonnet-5.5/v2-r1");
}

#[test]
fn tc04_reference_run_has_no_node_and_one_place() {
    let lake = fixture_lake();
    let d = lake.discover();
    for id in [ID_REFV, ID_TODOODLE] {
        let copies = lake.copies(&d, id);
        assert_eq!(copies.len(), 1, "{id}");
        assert_eq!(copies[0].node, None);
    }
    assert!(lake.copies(&d, "benchmarks/reference/no/such/run").is_empty());
}

#[test]
fn tc05_the_real_stray_folder() {
    let (_s, state, lake) = scratch_lake("stray");
    fs::create_dir(state.join("collected/tritus/benchmarks")).unwrap();
    let d = lake.discover();
    assert_eq!(labels(&d), [("collected/tritus/benchmarks".to_string(), "E-LAKE-STRAY")]);
    assert_eq!(d.rejected[0].path, state.join("collected/tritus/benchmarks"));
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT);
}

#[test]
fn tc06_file_and_symlink_where_folders_belong() {
    let (_s, state, lake) = scratch_lake("links");
    write(&state.join("collected/zz-file"), b"x");
    symlink(state.join("collected/gruntus"), state.join("collected/zz-link")).unwrap();
    // A link at run depth that points to a run.
    let pack = state.join(NODE_PATH);
    symlink(pack.join("v2-fresh-r1"), pack.join("v2-link")).unwrap();
    // A file and a link inside a node folder.
    write(&state.join("collected/tritus/readme.txt"), b"x");
    let d = lake.discover();
    let got = labels(&d);
    assert!(got.contains(&("collected/zz-file".to_string(), "E-LAKE-NOT-A-FOLDER")), "{got:?}");
    assert!(got.contains(&("collected/zz-link".to_string(), "E-LAKE-NOT-A-FOLDER")), "{got:?}");
    assert!(got.contains(&(format!("{NODE_PATH}/v2-link"), "E-LAKE-NOT-A-FOLDER")), "{got:?}");
    assert!(got.contains(&("collected/tritus/readme.txt".to_string(), "E-LAKE-STRAY")), "{got:?}");
    assert_eq!(got.len(), 4, "{got:?}");
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT, "the link's target is not listed twice");
}

#[test]
fn tc06_a_link_named_combinations_is_not_followed() {
    let (_s, state, lake) = scratch_lake("combolink");
    fs::create_dir(state.join("collected/newnode")).unwrap();
    symlink(state.join("collected/tritus/combinations"), state.join("collected/newnode/combinations")).unwrap();
    let d = lake.discover();
    assert_eq!(labels(&d), [("collected/newnode/combinations".to_string(), "E-LAKE-NOT-A-FOLDER")]);
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT);
}

#[test]
fn tc07_depth_nine_and_ten() {
    let (_s, state, lake) = scratch_lake("depth");
    let nine = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r9";
    make_run(&state, nine);
    // A run-like folder one level deeper, inside a run folder: it is the run's own content.
    make_run(&state, &format!("{nine}/r10"));
    let d = lake.discover();
    assert!(d.runs.iter().any(|r| r.label == nine));
    assert!(!d.runs.iter().any(|r| r.label.ends_with("r10")));
    assert!(d.rejected.is_empty(), "{:?}", d.rejected);
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT + 1);
}

#[test]
fn tc07_a_chain_that_ends_too_early_is_shallow() {
    let (_s, state, lake) = scratch_lake("shallow");
    fs::create_dir_all(state.join("collected/tritus/combinations/a/b/c")).unwrap();
    fs::create_dir_all(state.join("reference/pack")).unwrap();
    let d = lake.discover();
    assert_eq!(
        labels(&d),
        [
            ("collected/tritus/combinations/a/b/c".to_string(), "E-LAKE-SHALLOW"),
            ("reference/pack".to_string(), "E-LAKE-SHALLOW")
        ]
    );
}

#[test]
fn tc07_a_file_above_run_depth_is_not_a_folder() {
    let (_s, state, lake) = scratch_lake("fileabove");
    write(&state.join("collected/tritus/combinations/a/file.txt"), b"x");
    let d = lake.discover();
    assert_eq!(
        labels(&d),
        [("collected/tritus/combinations/a/file.txt".to_string(), "E-LAKE-NOT-A-FOLDER")]
    );
}

#[test]
fn tc08_to_tc10_part_rule_in_the_walk() {
    let (_s, state, lake) = scratch_lake("parts");
    let base = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p";
    make_run(&state, &format!("{base}/{}", "x".repeat(64)));
    make_run(&state, &format!("{base}/{}", "y".repeat(65)));
    make_run(&state, &format!("{base}/with space"));
    make_run(&state, &format!("{base}/..."));
    let d = lake.discover();
    assert!(d.runs.iter().any(|r| r.id.ends_with(&"x".repeat(64))));
    let got = labels(&d);
    assert_eq!(got.len(), 3, "{got:?}");
    assert!(got.iter().all(|(_, c)| *c == "E-LAKE-BAD-PART"));
    assert!(got.iter().any(|(l, _)| l.ends_with(&"y".repeat(65))));
    assert!(got.iter().any(|(l, _)| l.ends_with("/...")));
    assert!(got.iter().any(|(l, _)| l.ends_with("with space")));
}

#[test]
fn tc09_literal_benchmarks_and_dash_rules() {
    let (_s, state, lake) = scratch_lake("literal");
    make_run(&state, "collected/tritus/combinations/a/b/c/d/e/f-g/notbenchmarks/p/r");
    make_run(&state, "collected/tritus/combinations/a/b/c/d/e/nodash/benchmarks/p/r");
    let d = lake.discover();
    assert_eq!(
        labels(&d),
        [
            ("collected/tritus/combinations/a/b/c/d/e/f-g/notbenchmarks".to_string(), "E-LAKE-BAD-PART"),
            ("collected/tritus/combinations/a/b/c/d/e/nodash".to_string(), "E-LAKE-BAD-PART"),
        ]
    );
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT);
}

#[test]
fn tc09_a_bad_node_name() {
    let (_s, state, lake) = scratch_lake("badnode");
    fs::create_dir(state.join("collected/bad node")).unwrap();
    let d = lake.discover();
    assert_eq!(labels(&d), [("collected/bad node".to_string(), "E-LAKE-BAD-PART")]);
}

#[test]
fn tc11_no_marker() {
    let (_s, state, lake) = scratch_lake("nomarker");
    let rel = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r";
    fs::create_dir_all(state.join(rel).join("stories")).unwrap();
    let d = lake.discover();
    assert_eq!(labels(&d), [(rel.to_string(), "E-LAKE-NO-MARKER")]);
    // A marker that is a folder or a link is not a marker.
    let rel2 = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r2";
    fs::create_dir_all(state.join(rel2).join("run.json")).unwrap();
    let rel3 = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p/r3";
    fs::create_dir_all(state.join(rel3)).unwrap();
    write(&state.join("target.json"), b"{}");
    symlink(state.join("target.json"), state.join(rel3).join("collection.json")).unwrap();
    let d = lake.discover();
    assert_eq!(d.rejected.len(), 3);
    assert!(d.rejected.iter().all(|r| r.code == "E-LAKE-NO-MARKER"));
}

#[test]
fn either_marker_makes_a_run() {
    let (_s, state, lake) = scratch_lake("markers");
    let base = "collected/tritus/combinations/a/b/c/d/e/f-g/benchmarks/p";
    write(&state.join(base).join("r1/collection.json"), b"{}");
    write(&state.join(base).join("r2/run.json"), b"{}");
    let d = lake.discover();
    assert!(d.rejected.is_empty());
    assert_eq!(d.runs.len(), FIXTURE_RUN_COUNT + 2);
}

#[test]
fn tc12_missing_root() {
    let lake = Lake::new(&fixture_state().join("collected"), &fixture_state().join("no-such-reference"));
    let d = lake.discover();
    assert_eq!(d.missing_roots, ["reference"]);
    assert!(d.rejected.is_empty());
    assert!(d.runs.iter().all(|r| r.kind == Kind::Combination));
    assert_eq!(d.runs.len(), 6);
    let lake = Lake::new(&fixture_state().join("no-such-collected"), &fixture_state().join("reference"));
    let d = lake.discover();
    assert_eq!(d.missing_roots, ["collected"]);
    assert_eq!(d.runs.len(), 2);
    let lake = Lake::in_state_dir(&fixture_state().join("nothing-here"));
    let d = lake.discover();
    assert_eq!(d.missing_roots, ["collected", "reference"]);
    assert!(d.runs.is_empty() && d.rejected.is_empty());
}

#[test]
fn tc13_empty_root() {
    let s = Scratch::new("empty");
    fs::create_dir_all(s.join("state/collected")).unwrap();
    fs::create_dir_all(s.join("state/reference")).unwrap();
    let d = Lake::in_state_dir(&s.join("state")).discover();
    assert!(d.runs.is_empty());
    assert!(d.rejected.is_empty());
    assert!(d.missing_roots.is_empty());
}

#[test]
fn tc14_preferred_on_real_notes() {
    let lake = fixture_lake();
    let d = lake.discover();
    assert_eq!(lake.preferred(&d, ID_Q36).unwrap().node.as_deref(), Some("gruntus"));
    assert_eq!(lake.preferred(&d, ID_REFV).unwrap().node, None);
    assert!(lake.preferred(&d, "combinations/nothing").is_none());
}

fn set_note(state: &Path, node: &str, f: impl Fn(&mut serde_json::Value)) {
    let p = state.join("collected").join(node).join(ID_Q36).join("collection.json");
    let mut v: serde_json::Value = serde_json::from_slice(&fs::read(&p).unwrap()).unwrap();
    f(&mut v);
    fs::write(&p, serde_json::to_vec(&v).unwrap()).unwrap();
}

#[test]
fn tc14_preferred_follows_the_ranking_on_scratch_notes() {
    let (_s, state, lake) = scratch_lake("rank");
    let pref = |lake: &Lake| {
        let d = lake.discover();
        lake.preferred(&d, ID_Q36).unwrap().node.clone().unwrap()
    };
    assert_eq!(pref(&lake), "gruntus");
    // quintus settles later: it wins (same complete flag, same number of files).
    set_note(&state, "quintus", |v| v["settled_at"] = serde_json::json!(1792116938));
    assert_eq!(pref(&lake), "quintus");
    // equal settled_at: the smaller node name.
    set_note(&state, "quintus", |v| v["settled_at"] = serde_json::json!(1792116937));
    assert_eq!(pref(&lake), "gruntus");
    // gruntus incomplete: a complete copy ranks first.
    set_note(&state, "gruntus", |v| v["complete"] = serde_json::json!(false));
    assert_eq!(pref(&lake), "quintus");
    // quintus's note lists fewer files than tritus's; make tritus complete with more files.
    set_note(&state, "tritus", |v| {
        let files: serde_json::Map<String, serde_json::Value> =
            (0..100).map(|i| (format!("f{i}"), serde_json::json!({}))).collect();
        v["files"] = serde_json::Value::Object(files);
    });
    assert_eq!(pref(&lake), "tritus");
    // a copy with no note ranks last.
    fs::remove_file(state.join("collected/tritus").join(ID_Q36).join("collection.json")).unwrap();
    assert_eq!(pref(&lake), "quintus");
    // a note that is not JSON counts as no note.
    fs::write(state.join("collected/quintus").join(ID_Q36).join("collection.json"), b"not json").unwrap();
    assert_eq!(pref(&lake), "gruntus");
}

#[test]
fn tc15_preferred_against_the_hosts_lake() {
    let Ok(state) = std::env::var(REAL_HOST_ENV) else {
        not_run("TC-15", &format!("{REAL_HOST_ENV} is not set: the host's lake is not on this machine"));
        return;
    };
    let lake = Lake::in_state_dir(Path::new(&state));
    let d = lake.discover();
    let mut ids: Vec<&str> = d.runs.iter().map(|r| r.id.as_str()).collect();
    ids.dedup();
    let mut checked = 0;
    for id in ids {
        let copies = lake.copies(&d, id);
        if copies.len() < 2 {
            continue;
        }
        let holds_raw = |r: &&bench_lake::RunRef| {
            fs::read_dir(r.dir.join("stories"))
                .map(|it| it.flatten().any(|e| e.path().join("agent-events.jsonl").is_file()))
                .unwrap_or(false)
        };
        if copies.iter().any(&holds_raw) {
            let p = lake.preferred(&d, id).unwrap();
            assert!(holds_raw(&p), "preferred copy of {id} does not hold the raw logs");
            checked += 1;
        }
    }
    eprintln!("TC-15: {checked} ids with several copies and raw logs checked");
}

#[test]
fn tc16_order_is_stable() {
    let build = |order: &[&str], tag: &str| {
        let s = Scratch::new(tag);
        for node in order {
            let base = format!("state/collected/{node}/combinations/a/b/c/d/e/f-g/benchmarks/p");
            for run in ["r3", "r1", "r2"] {
                write(&s.join(&format!("{base}/{run}/run.json")), b"{}");
            }
            fs::create_dir_all(s.join(&format!("state/collected/{node}/stray2"))).unwrap();
            fs::create_dir_all(s.join(&format!("state/collected/{node}/stray1"))).unwrap();
        }
        write(&s.join("state/collected/file-b"), b"x");
        write(&s.join("state/collected/file-a"), b"x");
        let d = Lake::in_state_dir(&s.join("state")).discover();
        let runs: Vec<(String, Option<String>)> = d.runs.iter().map(|r| (r.id.clone(), r.node.clone())).collect();
        let rej: Vec<(String, &str)> = d.rejected.iter().map(|r| (r.label.clone(), r.code)).collect();
        (runs, rej)
    };
    let a = build(&["m", "a", "z"], "order1");
    let b = build(&["z", "m", "a"], "order2");
    assert_eq!(a, b);
    let ids: Vec<&str> = a.0.iter().map(|r| r.0.as_str()).collect();
    let mut sorted = ids.clone();
    sorted.sort();
    assert_eq!(ids, sorted);
    let paths: Vec<&str> = a.1.iter().map(|r| r.0.as_str()).collect();
    let mut sorted = paths.clone();
    sorted.sort();
    assert_eq!(paths, sorted);
    assert_eq!(a.0.iter().filter(|r| r.0.ends_with("/r1")).count(), 3);
}

#[test]
fn tc81_discover_ignores_temporaries_beside_records() {
    let (_s, state, lake) = scratch_lake("tmpdiscover");
    let before = lake.discover();
    let run = state.join("collected/gruntus").join(ID_FRESH);
    write(&run.join(".collection.json.partial"), b"x");
    write(&run.join(".metrics.json.1234.tmp"), b"x");
    let after = lake.discover();
    assert_eq!(before, after);
    assert!(after.rejected.is_empty());
}

#[test]
fn an_unlistable_folder_is_rejected_unreadable() {
    if is_root() {
        not_run("E-LAKE-UNREADABLE discovery", "running as root");
        return;
    }
    use std::os::unix::fs::PermissionsExt;
    let (_s, state, lake) = scratch_lake("unlistable");
    let dir = state.join("collected/gruntus/combinations/qwen/3.8-swift-1.5/27b");
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o000)).unwrap();
    let d = lake.discover();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(
        d.rejected.iter().any(|r| r.code == "E-LAKE-UNREADABLE" && r.label.ends_with("combinations/qwen/3.8-swift-1.5/27b")),
        "{:?}",
        d.rejected
    );
}

#[test]
fn find_run_by_id_and_by_node() {
    let lake = fixture_lake();
    let d = lake.discover();
    assert_eq!(lake.find_run(&d, ID_Q36).unwrap().node.as_deref(), Some("gruntus"));
    let spec = format!("quintus@{ID_Q36}");
    assert_eq!(lake.find_run(&d, &spec).unwrap().node.as_deref(), Some("quintus"));
    let e = lake.find_run(&d, &format!("nonode@{ID_Q36}")).unwrap_err();
    assert_eq!(e.code(), "E-LAKE-NO-RUN");
    assert_eq!(e.node.as_deref(), Some("nonode"));
    assert_eq!(e.run, ID_Q36);
    let e = lake.find_run(&d, "combinations/none").unwrap_err();
    assert_eq!((e.code(), e.node), ("E-LAKE-NO-RUN", None));
    assert_eq!(lake.find_run(&d, ID_REFV).unwrap().kind, Kind::Reference);
}

#[test]
fn tc72_no_run_is_an_absence() {
    let lake = fixture_lake();
    let d = lake.discover();
    let e = lake.preferred_or_absent(&d, "combinations/not/in/the/lake").unwrap_err();
    assert_eq!(e.code(), "E-LAKE-NO-RUN");
    assert_eq!(e.run, "combinations/not/in/the/lake");
    assert_eq!(e.node, None);
    assert_eq!(e.item, bench_lake::Item::Run);
    assert_eq!(e.detail(), "no run with this id");
}
