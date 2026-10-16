//! lakelib.records.read: TC-17 to TC-34, with TC-73, TC-74, TC-79, TC-80 (the cases that read records).

mod common;
use bench_lake::{Item, Lake, Reason, Record, RunRef};
use common::*;
use serde_json::Value;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::PathBuf;

const SIX: [Record; 6] =
    [Record::RunDescription, Record::Status, Record::Metrics, Record::Finalize, Record::Progress, Record::Collection];

fn assert_record_equals_file(lake: &Lake, run: &RunRef, record: &Record) {
    let path = run.dir.join(record.relative_path().unwrap());
    let direct = fs::read(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    assert_eq!(lake.bytes(run, record).unwrap(), direct, "{record:?}");
    let value = lake.value(run, record).unwrap();
    if record.is_text() {
        assert_eq!(value, Value::String(String::from_utf8(direct).unwrap()));
    } else {
        assert_eq!(value, serde_json::from_slice::<Value>(&direct).unwrap());
    }
}

#[test]
fn tc17_every_record_of_a_combination_run() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    for r in &SIX {
        assert_record_equals_file(&lake, &run, r);
    }
}

#[test]
fn tc18_records_of_a_reference_run() {
    let lake = fixture_lake();
    let run = find(&lake, ID_REFV, None);
    for r in &SIX {
        assert_record_equals_file(&lake, &run, r);
    }
}

#[test]
fn tc19_story_records() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    for r in [Record::Accept(1), Record::Prompt(1), Record::BaseCommit(1), Record::Gate(1)] {
        assert_record_equals_file(&lake, &run, &r);
    }
    let base = lake.value(&run, &Record::BaseCommit(1)).unwrap();
    assert_eq!(base, Value::String("30816ab716043c8a400ee0e43b0e7f8b3438a3ea".to_string()));
}

fn add_rescore(state: &std::path::Path, node: &str, id: &str, version: &str) {
    let run = state.join("collected").join(node).join(id);
    write(&run.join("rescore").join(version).join("rescore.json"), br#"{"version":"x"}"#);
    let accept = fs::read(run.join("stories/01/accept-summary.json")).unwrap();
    write(&run.join("rescore").join(version).join("stories/01/accept-summary.json"), &accept);
}

#[test]
fn tc20_rescore_records() {
    let (_s, state, lake) = scratch_lake("rescore");
    add_rescore(&state, "gruntus", ID_FRESH, "vidi-v2.0-pre2");
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let v = "vidi-v2.0-pre2".to_string();
    assert_eq!(lake.bytes(&run, &Record::Rescore(v.clone())).unwrap(), br#"{"version":"x"}"#);
    assert_eq!(lake.value(&run, &Record::Rescore(v.clone())).unwrap()["version"], "x");
    let direct = fs::read(run.dir.join("rescore/vidi-v2.0-pre2/stories/01/accept-summary.json")).unwrap();
    assert_eq!(lake.bytes(&run, &Record::RescoreAccept(v.clone(), 1)).unwrap(), direct);
    let e = lake.bytes(&run, &Record::RescoreAccept(v, 2)).unwrap_err();
    assert_eq!(e.reason, Reason::NotCollected);
    assert_eq!(e.item, Item::Record("rescore-accept:vidi-v2.0-pre2:2".to_string()));
}

#[test]
fn tc21_rescore_versions() {
    let (_s, state, lake) = scratch_lake("versions");
    // created in reverse byte order
    add_rescore(&state, "gruntus", ID_FRESH, "v2");
    add_rescore(&state, "gruntus", ID_FRESH, "v1");
    // a file, a link and a folder with a bad name are not versions
    write(&state.join("collected/gruntus").join(ID_FRESH).join("rescore/notes.txt"), b"x");
    fs::create_dir_all(state.join("collected/gruntus").join(ID_FRESH).join("rescore/bad name")).unwrap();
    symlink(
        state.join("collected/gruntus").join(ID_FRESH).join("rescore/v1"),
        state.join("collected/gruntus").join(ID_FRESH).join("rescore/v0-link"),
    )
    .unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.rescore_versions(&run).unwrap(), ["v1", "v2"]);
    let none = find(&lake, ID_Q36, Some("gruntus"));
    assert_eq!(lake.rescore_versions(&none).unwrap(), Vec::<String>::new());
}

#[test]
fn tc21_rescore_that_is_a_link_is_not_a_file() {
    let (_s, state, lake) = scratch_lake("rescorelink");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    symlink(&state, run_dir.join("rescore")).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.rescore_versions(&run).unwrap_err();
    assert_eq!(e.reason, Reason::NotAFile);
}

#[test]
fn tc22_text_records_are_text_and_the_same_bytes() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    for r in [Record::Prompt(1), Record::BaseCommit(1)] {
        let bytes = lake.bytes(&run, &r).unwrap();
        match lake.value(&run, &r).unwrap() {
            Value::String(s) => assert_eq!(s.as_bytes(), bytes.as_slice()),
            other => panic!("{other:?}"),
        }
    }
}

#[test]
fn tc23_bytes_are_exact_for_non_utf8_and_crlf() {
    let (_s, state, lake) = scratch_lake("exact");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    let odd: Vec<u8> = vec![0xff, 0xfe, b'\r', b'\n', 0x00, b'x'];
    fs::write(run_dir.join("stories/01/prompt.md"), &odd).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.bytes(&run, &Record::Prompt(1)).unwrap(), odd);
    let e = lake.value(&run, &Record::Prompt(1)).unwrap_err();
    assert_eq!(e.reason, Reason::Malformed("not valid UTF-8".to_string()));
    fs::write(run_dir.join("stories/01/prompt.md"), b"a\r\nb\r\n").unwrap();
    assert_eq!(lake.value(&run, &Record::Prompt(1)).unwrap(), Value::String("a\r\nb\r\n".to_string()));
    // a structured record with CRLF between tokens parses, and its bytes are returned as they are
    let crlf = b"{\r\n \"a\": 1\r\n}\r\n";
    fs::write(run_dir.join("stories/01/gate.json"), crlf).unwrap();
    assert_eq!(lake.bytes(&run, &Record::Gate(1)).unwrap(), crlf);
    assert_eq!(lake.value(&run, &Record::Gate(1)).unwrap()["a"], 1);
    // invalid UTF-8 inside a structured record is malformed
    fs::write(run_dir.join("stories/01/gate.json"), b"{\"a\":\"\xff\"}").unwrap();
    assert_eq!(
        lake.value(&run, &Record::Gate(1)).unwrap_err().reason,
        Reason::Malformed("not valid UTF-8".to_string())
    );
    // a byte order mark is not accepted
    fs::write(run_dir.join("stories/01/gate.json"), b"\xef\xbb\xbf{}").unwrap();
    assert_eq!(
        lake.value(&run, &Record::Gate(1)).unwrap_err().reason,
        Reason::Malformed("not valid JSON".to_string())
    );
}

#[test]
fn tc24_commit_of_a_story() {
    let lake = fixture_lake();
    let run = find(&lake, ID_Q36, Some("gruntus"));
    let metrics = lake.value(&run, &Record::Metrics).unwrap();
    let commit = metrics["stories"]["1"]["commit"].as_str().unwrap();
    assert_eq!(commit.len(), 40);
    assert_eq!(commit, "59a592fca04af9fe2c8b667b3a784298795ccde9");
    let direct: Value = serde_json::from_slice(&fs::read(run.dir.join("metrics.json")).unwrap()).unwrap();
    assert_eq!(direct["stories"]["1"]["commit"], metrics["stories"]["1"]["commit"]);
}

#[test]
fn tc27_absent_record_combination() {
    let lake = fixture_lake();
    let run = find(&lake, ID_Q36, Some("quintus"));
    let e = lake.bytes(&run, &Record::Finalize).unwrap_err();
    assert_eq!(e.reason, Reason::NotCollected);
    assert_eq!(e.run, ID_Q36);
    assert_eq!(e.node.as_deref(), Some("quintus"));
    assert_eq!(e.item, Item::Record("finalize".to_string()));
    assert_eq!(
        e.to_text(),
        format!("run={ID_Q36} node=quintus item=record:finalize code=E-LAKE-NOT-COLLECTED detail=no such file")
    );
    assert_eq!(lake.value(&run, &Record::Finalize).unwrap_err(), e);
}

#[test]
fn tc28_absent_record_reference() {
    let (_s, state, lake) = scratch_lake("absentref");
    fs::remove_file(state.join("reference/vidi/sonnet-5.5/v2-r1/progress.json")).unwrap();
    let run = find(&lake, ID_REFV, None);
    let e = lake.bytes(&run, &Record::Progress).unwrap_err();
    assert_eq!(e.reason, Reason::NotCollected);
    assert_eq!(e.node, None);
    assert_eq!(e.run, ID_REFV);
    let todoodle = find(&lake, ID_TODOODLE, None);
    assert_eq!(lake.bytes(&todoodle, &Record::Metrics).unwrap_err().reason, Reason::NotCollected);
}

#[test]
fn tc29_a_link_in_the_place_of_a_record() {
    let (_s, state, lake) = scratch_lake("linkrecord");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    fs::remove_file(run_dir.join("metrics.json")).unwrap();
    symlink(run_dir.join("finalize.json"), run_dir.join("metrics.json")).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.bytes(&run, &Record::Metrics).unwrap_err().reason, Reason::NotAFile);
    assert_eq!(lake.value(&run, &Record::Metrics).unwrap_err().reason, Reason::NotAFile);
    // a folder in the place of a record
    fs::remove_file(run_dir.join("metrics.json")).unwrap();
    fs::create_dir(run_dir.join("metrics.json")).unwrap();
    assert_eq!(lake.bytes(&run, &Record::Metrics).unwrap_err().reason, Reason::NotAFile);
    // a link in a folder of the path
    let outside = state.join("outside");
    copy_tree(&run_dir.join("stories/01"), &outside);
    fs::remove_dir_all(run_dir.join("stories/01")).unwrap();
    symlink(&outside, run_dir.join("stories/01")).unwrap();
    assert_eq!(lake.bytes(&run, &Record::Accept(1)).unwrap_err().reason, Reason::NotAFile);
}

#[test]
fn tc30_story_0_and_999_names() {
    let (_s, state, lake) = scratch_lake("stories");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    write(&run_dir.join("stories/00/gate.json"), b"{\"s\":0}");
    write(&run_dir.join("stories/999/gate.json"), b"{\"s\":999}");
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.value(&run, &Record::Gate(0)).unwrap()["s"], 0);
    assert_eq!(lake.value(&run, &Record::Gate(999)).unwrap()["s"], 999);
}

fn nowhere() -> RunRef {
    RunRef {
        kind: bench_lake::Kind::Combination,
        node: Some("nowhere".to_string()),
        id: "combinations/x".to_string(),
        dir: PathBuf::from("/this/folder/does/not/exist"),
        label: "collected/nowhere/combinations/x".to_string(),
    }
}

#[test]
fn tc31_story_out_of_range_is_a_bad_name_before_any_file_is_touched() {
    let lake = fixture_lake();
    for s in [1000, -1] {
        let e = lake.bytes(&nowhere(), &Record::Accept(s)).unwrap_err();
        assert_eq!(e.reason, Reason::BadName("story out of range".to_string()), "{s}");
        assert_eq!(e.item, Item::Record(format!("accept:{s}")));
        assert_eq!(lake.value(&nowhere(), &Record::Gate(s)).unwrap_err().code(), "E-LAKE-BAD-NAME");
    }
    // 0 and 999 pass the name check and then find nothing
    for s in [0, 999] {
        assert_eq!(lake.bytes(&nowhere(), &Record::Accept(s)).unwrap_err().reason, Reason::NotCollected);
    }
}

#[test]
fn tc32_and_tc33_versions_before_any_file_is_touched() {
    let lake = fixture_lake();
    assert_eq!(lake.bytes(&nowhere(), &Record::Rescore("a".into())).unwrap_err().reason, Reason::NotCollected);
    let long = "a".repeat(65);
    for v in ["", long.as_str(), "a/b", "..", "a b"] {
        let e = lake.bytes(&nowhere(), &Record::Rescore(v.to_string())).unwrap_err();
        assert_eq!(e.reason, Reason::BadName("version not valid".to_string()), "{v:?}");
        let e = lake.bytes(&nowhere(), &Record::RescoreAccept(v.to_string(), 1)).unwrap_err();
        assert_eq!(e.code(), "E-LAKE-BAD-NAME");
    }
    // a version that escapes is never turned into a path
    let e = lake.bytes(&nowhere(), &Record::Rescore("../../etc".into())).unwrap_err();
    assert_eq!(e.code(), "E-LAKE-BAD-NAME");
}

#[test]
fn tc34_a_record_that_does_not_parse() {
    let (_s, state, lake) = scratch_lake("cut");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    let whole = fs::read(run_dir.join("metrics.json")).unwrap();
    let half = &whole[..whole.len() / 2];
    fs::write(run_dir.join("metrics.json"), half).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.value(&run, &Record::Metrics).unwrap_err();
    assert_eq!(e.reason, Reason::Malformed("not valid JSON".to_string()));
    assert!(e.message.as_deref().is_some_and(|m| !m.is_empty()), "the parser's message is carried: {:?}", e.message);
    assert_eq!(lake.bytes(&run, &Record::Metrics).unwrap(), half);
}

#[test]
fn tc73_unreadable_record() {
    if is_root() {
        not_run("TC-73", "running as root");
        return;
    }
    let (_s, state, lake) = scratch_lake("unreadable");
    let p = state.join("collected/gruntus").join(ID_FRESH).join("metrics.json");
    fs::set_permissions(&p, fs::Permissions::from_mode(0o000)).unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.bytes(&run, &Record::Metrics).unwrap_err();
    assert_eq!(e.reason, Reason::Unreadable("permission denied".to_string()));
    assert_eq!(e.code(), "E-LAKE-UNREADABLE");
    assert!(e.message.is_some());
    assert_eq!(lake.value(&run, &Record::Metrics).unwrap_err().code(), "E-LAKE-UNREADABLE");
}

#[test]
fn tc74_no_fallback_to_another_copy() {
    let lake = fixture_lake();
    let d = lake.discover();
    let gruntus = lake.find_run(&d, ID_Q36).unwrap();
    assert!(lake.bytes(gruntus, &Record::Finalize).is_ok(), "the preferred copy holds finalize.json");
    let quintus = lake.find_run(&d, &format!("quintus@{ID_Q36}")).unwrap();
    let e = lake.bytes(quintus, &Record::Finalize).unwrap_err();
    assert_eq!(e.reason, Reason::NotCollected);
    assert_eq!(e.node.as_deref(), Some("quintus"));
}

#[test]
fn tc75_no_default_value_for_an_absent_record() {
    let lake = fixture_lake();
    let run = find(&lake, ID_FLASH, Some("tritus"));
    for r in [Record::Metrics, Record::Accept(1), Record::Prompt(1), Record::BaseCommit(1)] {
        assert!(lake.value(&run, &r).is_err(), "{r:?}");
        assert!(lake.bytes(&run, &r).is_err(), "{r:?}");
    }
}

#[test]
fn tc79_a_transfer_in_progress_is_never_returned() {
    let (_s, state, lake) = scratch_lake("partial");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    fs::remove_file(run_dir.join("metrics.json")).unwrap();
    fs::write(run_dir.join(".metrics.json.partial"), b"{\"half\":").unwrap();
    fs::write(run_dir.join(".metrics.json.1234.tmp"), b"{\"half\":").unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    let e = lake.bytes(&run, &Record::Metrics).unwrap_err();
    assert_eq!(e.reason, Reason::NotCollected);
    assert_eq!(lake.value(&run, &Record::Metrics).unwrap_err().reason, Reason::NotCollected);
    assert_eq!(Record::from_relative_path(".metrics.json.partial"), None);
    assert_eq!(Record::from_relative_path(".metrics.json.1234.tmp"), None);
}

#[test]
fn tc80_a_transfer_next_to_a_good_file() {
    let (_s, state, lake) = scratch_lake("partialgood");
    let run_dir = state.join("collected/gruntus").join(ID_FRESH);
    let good = fs::read(run_dir.join("metrics.json")).unwrap();
    fs::write(run_dir.join(".metrics.json.partial"), b"{\"half\":").unwrap();
    fs::write(run_dir.join(".metrics.json.1234.tmp"), b"junk").unwrap();
    let run = find(&lake, ID_FRESH, Some("gruntus"));
    assert_eq!(lake.bytes(&run, &Record::Metrics).unwrap(), good);
}
