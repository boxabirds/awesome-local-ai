//! Unit tests of the pure parts: part rule, ranking, record names, completeness decision, absence forms,
//! canonical JSON, and the two source scans (TC-83, TC-89, TC-90).

use bench_lake::absent::*;
use bench_lake::complete::decide;
use bench_lake::layout::{compare_copies, is_valid_part, CopyNote};
use bench_lake::records::{is_valid_version, story_dir, Record};
use bench_lake::{canonical, sha256_hex, Absent, Item, Reason};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::fs;
use std::path::PathBuf;

const SIXTY_FOUR: usize = 64;
const SIXTY_FIVE: usize = 65;

fn note(node: &str, has_note: bool, complete: bool, files: usize, settled: Option<f64>) -> CopyNote {
    CopyNote { node: node.to_string(), has_note, complete, files, settled_at: settled }
}

// ---- layout: the part rule (TC-08, TC-09, TC-10) ----

#[test]
fn tc08_part_of_64_characters_is_valid() {
    assert!(is_valid_part(&"a".repeat(SIXTY_FOUR)));
}

#[test]
fn tc09_part_of_65_characters_is_not_valid() {
    assert!(!is_valid_part(&"a".repeat(SIXTY_FIVE)));
}

#[test]
fn tc10_dot_parts_are_not_valid() {
    for p in ["..", ".", "..."] {
        assert!(!is_valid_part(p), "{p}");
    }
}

#[test]
fn part_rule_alphabet() {
    for ok in ["a", "3.8-swift-1.5", "strix-halo-128GB", "v2_r1", "a.b", ".hidden"] {
        assert!(is_valid_part(ok), "{ok}");
    }
    for bad in ["", "a b", "a/b", "é", "a\n", "a:b", "a\\b"] {
        assert!(!is_valid_part(bad), "{bad:?}");
    }
}

// ---- layout: the ranking (TC-14) ----

#[test]
fn tc14_ranking_order() {
    let incomplete_many = note("a", true, false, 500, Some(9.0));
    let complete_few = note("b", true, true, 10, Some(9.0));
    let complete_many_early = note("c", true, true, 100, Some(1.0));
    let complete_many_late = note("d", true, true, 100, Some(2.0));
    let no_note = note("e", false, false, 0, None);
    let mut all = [&incomplete_many, &complete_few, &complete_many_early, &complete_many_late, &no_note];
    all.sort_by(|a, b| compare_copies(b, a)); // best first
    let order: Vec<&str> = all.iter().map(|n| n.node.as_str()).collect();
    assert_eq!(order, ["d", "c", "b", "a", "e"]);
}

#[test]
fn tc14_equal_but_node_prefers_the_smaller_node() {
    let a = note("alpha", true, true, 5, Some(7.0));
    let b = note("beta", true, true, 5, Some(7.0));
    assert_eq!(compare_copies(&a, &b), Ordering::Greater);
    assert_eq!(compare_copies(&b, &a), Ordering::Less);
    assert_eq!(compare_copies(&a, &a), Ordering::Equal);
}

#[test]
fn tc14_a_copy_with_no_note_ranks_below_one_with_a_note() {
    let none = note("a", false, false, 0, None);
    let weak = note("z", true, false, 0, None);
    assert_eq!(compare_copies(&weak, &none), Ordering::Greater);
}

#[test]
fn tc14_missing_settled_at_is_lowest() {
    let with = note("z", true, true, 5, Some(1.0));
    let without = note("a", true, true, 5, None);
    assert_eq!(compare_copies(&with, &without), Ordering::Greater);
}

// ---- records: names, padding, ranges (TC-22 to TC-26, TC-30 to TC-33) ----

#[test]
fn tc25_story_padding() {
    assert_eq!(story_dir(1).unwrap(), "01");
    assert_eq!(story_dir(12).unwrap(), "12");
    assert_eq!(Record::Accept(1).relative_path().unwrap(), PathBuf::from("stories/01/accept-summary.json"));
    assert_eq!(Record::Accept(12).relative_path().unwrap(), PathBuf::from("stories/12/accept-summary.json"));
}

#[test]
fn tc26_and_tc30_story_999_and_0() {
    assert_eq!(Record::Gate(999).relative_path().unwrap(), PathBuf::from("stories/999/gate.json"));
    assert_eq!(Record::Gate(0).relative_path().unwrap(), PathBuf::from("stories/00/gate.json"));
}

#[test]
fn tc31_story_out_of_range_is_a_bad_name() {
    for s in [1000, -1, i64::MAX, i64::MIN] {
        assert_eq!(Record::Accept(s).relative_path().unwrap_err(), "story out of range", "{s}");
        assert!(story_dir(s).is_err());
    }
}

#[test]
fn tc32_version_of_one_character() {
    assert!(is_valid_version("a"));
    assert_eq!(Record::Rescore("a".into()).relative_path().unwrap(), PathBuf::from("rescore/a/rescore.json"));
}

#[test]
fn tc33_bad_versions() {
    let long = "a".repeat(SIXTY_FIVE);
    for v in ["", long.as_str(), "a/b", "..", ".", "a b", "a\0b", "é"] {
        assert!(!is_valid_version(v), "{v:?}");
        assert_eq!(Record::Rescore(v.to_string()).relative_path().unwrap_err(), "version not valid");
        assert_eq!(Record::RescoreAccept(v.to_string(), 1).relative_path().unwrap_err(), "version not valid");
    }
    assert!(is_valid_version(&"a".repeat(SIXTY_FOUR)));
}

#[test]
fn every_record_maps_to_its_file_and_back() {
    let cases: Vec<(Record, &str)> = vec![
        (Record::RunDescription, "run.json"),
        (Record::Status, "run-status.json"),
        (Record::Metrics, "metrics.json"),
        (Record::Finalize, "finalize.json"),
        (Record::Progress, "progress.json"),
        (Record::Collection, "collection.json"),
        (Record::Rescore("v1".into()), "rescore/v1/rescore.json"),
        (Record::RescoreAccept("v1".into(), 2), "rescore/v1/stories/02/accept-summary.json"),
        (Record::Accept(3), "stories/03/accept-summary.json"),
        (Record::Prompt(4), "stories/04/prompt.md"),
        (Record::BaseCommit(5), "stories/05/base-commit"),
        (Record::Gate(6), "stories/06/gate.json"),
    ];
    for (record, path) in cases {
        assert_eq!(record.relative_path().unwrap(), PathBuf::from(path), "{record:?}");
        assert_eq!(Record::from_relative_path(path), Some(record), "{path}");
    }
}

#[test]
fn from_relative_path_rejects_what_is_not_a_record() {
    for p in [
        "",
        ".metrics.json.partial",
        ".metrics.json.1234.tmp",
        "stories/01/agent-events.jsonl",
        "stories/1/gate.json",
        "stories/1000/gate.json",
        "stories/01/../gate.json",
        "../metrics.json",
        "/metrics.json",
        "rescore/../x/rescore.json",
        "rescore/a/b/rescore.json",
        "metrics.json/",
        "stories/01/.gate.json",
    ] {
        assert_eq!(Record::from_relative_path(p), None, "{p:?}");
    }
}

#[test]
fn tc22_text_records() {
    assert!(Record::Prompt(1).is_text());
    assert!(Record::BaseCommit(1).is_text());
    for r in [Record::Metrics, Record::Gate(1), Record::Collection, Record::Rescore("v".into())] {
        assert!(!r.is_text(), "{r:?}");
    }
}

#[test]
fn record_names_from_words() {
    assert_eq!(Record::from_words("status", &[]).unwrap(), Record::Status);
    assert_eq!(Record::from_words("accept", &["1".into()]).unwrap(), Record::Accept(1));
    assert_eq!(Record::from_words("accept", &["-1".into()]).unwrap(), Record::Accept(-1));
    assert_eq!(Record::from_words("accept", &["001".into()]).unwrap(), Record::Accept(1));
    assert_eq!(Record::from_words("rescore", &["v1".into()]).unwrap(), Record::Rescore("v1".into()));
    assert_eq!(
        Record::from_words("rescore-accept", &["v1".into(), "2".into()]).unwrap(),
        Record::RescoreAccept("v1".into(), 2)
    );
    assert_eq!(Record::from_words("rescore", &["".into()]).unwrap(), Record::Rescore(String::new()));
    for (name, args) in [
        ("nope", vec![]),
        ("status", vec!["1".to_string()]),
        ("accept", vec![]),
        ("accept", vec!["x".to_string()]),
        ("accept", vec!["+1".to_string()]),
        ("accept", vec![" 1".to_string()]),
        ("accept", vec!["1".to_string(), "2".to_string()]),
        ("rescore-accept", vec!["v1".to_string()]),
        ("rescore", vec![]),
    ] {
        assert!(Record::from_words(name, &args).is_err(), "{name} {args:?}");
    }
}

#[test]
fn item_names() {
    assert_eq!(Record::Metrics.item_name(), "metrics");
    assert_eq!(Record::Accept(1000).item_name(), "accept:1000");
    assert_eq!(Record::Accept(-1).item_name(), "accept:-1");
    assert_eq!(Record::RescoreAccept("v1".into(), 1).item_name(), "rescore-accept:v1:1");
    assert_eq!(Record::RunDescription.item_name(), "run-description");
}

// ---- completeness (TC-65, TC-66, TC-67) ----

#[test]
fn tc65_settled_at_null_is_none() {
    let n = json!({"complete": false, "settled_at": null, "collected_at": 5, "run_status": null});
    match decide(&n).unwrap() {
        bench_lake::Completeness::Incomplete { state, settled_at, collected_at } => {
            assert_eq!(state, None);
            assert_eq!(settled_at, None);
            assert_eq!(collected_at.unwrap().as_u64(), Some(5));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn complete_true_with_state_and_times() {
    let n = json!({"complete": true, "settled_at": 7, "collected_at": 9, "run_status": {"state": "finished"}});
    match decide(&n).unwrap() {
        bench_lake::Completeness::Complete { state, settled_at, collected_at } => {
            assert_eq!(state.as_deref(), Some("finished"));
            assert_eq!(settled_at.unwrap().as_u64(), Some(7));
            assert_eq!(collected_at.unwrap().as_u64(), Some(9));
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn state_and_times_that_are_not_the_right_type_are_none() {
    let n = json!({"complete": true, "settled_at": "soon", "collected_at": [1], "run_status": {"state": 3}});
    match decide(&n).unwrap() {
        bench_lake::Completeness::Complete { state, settled_at, collected_at } => {
            assert_eq!((state, settled_at, collected_at), (None, None, None));
        }
        other => panic!("{other:?}"),
    }
    let n = json!({"complete": true, "run_status": "finished"});
    assert!(matches!(decide(&n), Ok(bench_lake::Completeness::Complete { state: None, .. })));
}

#[test]
fn tc67_no_boolean_complete() {
    for n in [json!({"complete": "yes"}), json!({"complete": 1}), json!({"complete": null}), json!({})] {
        assert_eq!(decide(&n).unwrap_err(), "complete is not a boolean", "{n}");
    }
}

#[test]
fn tc66_note_that_is_not_an_object() {
    for n in [json!([1]), json!("text"), json!(3), Value::Null] {
        assert_eq!(decide(&n).unwrap_err(), "note is not an object", "{n}");
    }
}

#[test]
fn completeness_names() {
    assert_eq!(bench_lake::Completeness::NoNote.as_str(), "no-note");
    let n = json!({"complete": false});
    assert_eq!(decide(&n).unwrap().as_str(), "incomplete");
    let n = json!({"complete": true});
    assert_eq!(decide(&n).unwrap().as_str(), "complete");
}

// ---- absence (TC-69, TC-70, TC-71, TC-75) ----

fn finalize_absent() -> Absent {
    Absent::new("combinations/x", Some("node-a"), Item::Record("finalize".into()), Reason::NotCollected)
}

#[test]
fn tc69_canonical_text() {
    assert_eq!(
        finalize_absent().to_text(),
        "run=combinations/x node=node-a item=record:finalize code=E-LAKE-NOT-COLLECTED detail=no such file"
    );
    let reference = Absent::new("benchmarks/reference/p/s/r", None, Item::Run, Reason::NoRun);
    assert_eq!(
        reference.to_text(),
        "run=benchmarks/reference/p/s/r node=- item=run code=E-LAKE-NO-RUN detail=no run with this id"
    );
}

#[test]
fn tc70_canonical_json() {
    assert_eq!(
        finalize_absent().to_json(),
        r#"{"code":"E-LAKE-NOT-COLLECTED","detail":"no such file","item":"record:finalize","node":"node-a","run":"combinations/x"}"#
    );
    let reference = Absent::new("r", None, Item::Log(2), Reason::Malformed("not valid gzip".into()));
    assert_eq!(
        reference.to_json(),
        r#"{"code":"E-LAKE-MALFORMED","detail":"not valid gzip","item":"log:2","node":null,"run":"r"}"#
    );
}

#[test]
fn item_texts() {
    let t = |i: Item| Absent::new("r", None, i, Reason::NotCollected).item_text();
    assert_eq!(t(Item::Run), "run");
    assert_eq!(t(Item::Record("accept:1".into())), "record:accept:1");
    assert_eq!(t(Item::Log(7)), "log:7");
    assert_eq!(t(Item::Bundle), "bundle");
    assert_eq!(t(Item::Workspace(1)), "workspace:1");
}

#[test]
fn tc71_every_code_has_its_text() {
    let all = [
        (Reason::NoRun, CODE_NO_RUN, "no run with this id"),
        (Reason::NotCollected, CODE_NOT_COLLECTED, "no such file"),
        (Reason::NotAFile, CODE_NOT_A_FILE, "not a regular file"),
        (Reason::Unreadable("permission denied".into()), CODE_UNREADABLE, "permission denied"),
        (Reason::Malformed("not valid JSON".into()), CODE_MALFORMED, "not valid JSON"),
        (Reason::BadName("story out of range".into()), CODE_BAD_NAME, "story out of range"),
    ];
    assert_eq!(all.len(), 6);
    for (reason, code, detail) in all {
        assert_eq!(reason.code(), code);
        assert_eq!(reason.detail(), detail);
    }
    assert_eq!(CODE_NO_RUN, "E-LAKE-NO-RUN");
    assert_eq!(CODE_NOT_COLLECTED, "E-LAKE-NOT-COLLECTED");
    assert_eq!(CODE_NOT_A_FILE, "E-LAKE-NOT-A-FILE");
    assert_eq!(CODE_UNREADABLE, "E-LAKE-UNREADABLE");
    assert_eq!(CODE_MALFORMED, "E-LAKE-MALFORMED");
    assert_eq!(CODE_BAD_NAME, "E-LAKE-BAD-NAME");
    let refused = [
        (RefusedReason::DestInsideRoot, CODE_DEST_INSIDE_ROOT, "destination is inside the lake"),
        (RefusedReason::DestNotEmpty, CODE_DEST_NOT_EMPTY, "destination is not empty"),
        (RefusedReason::GitClone, CODE_GIT_FAILED, "git clone failed"),
        (RefusedReason::GitCheckout, CODE_GIT_FAILED, "git checkout failed"),
    ];
    for (reason, code, detail) in refused {
        assert_eq!(reason.code(), code);
        assert_eq!(reason.detail(), detail);
    }
    assert_eq!(CODE_DEST_INSIDE_ROOT, "E-LAKE-DEST-INSIDE-ROOT");
    assert_eq!(CODE_DEST_NOT_EMPTY, "E-LAKE-DEST-NOT-EMPTY");
    assert_eq!(CODE_GIT_FAILED, "E-LAKE-GIT-FAILED");
}

#[test]
fn refused_json() {
    let r = Refused {
        run: "r".into(),
        node: Some("n".into()),
        item: Item::Workspace(1),
        reason: RefusedReason::DestNotEmpty,
        message: Some("ignored".into()),
    };
    assert_eq!(
        r.to_json(),
        r#"{"code":"E-LAKE-DEST-NOT-EMPTY","detail":"destination is not empty","item":"workspace:1","node":"n","run":"r"}"#
    );
    assert_eq!(r.code(), "E-LAKE-DEST-NOT-EMPTY");
}

#[test]
fn the_message_is_not_part_of_the_canonical_form() {
    let mut a = finalize_absent();
    a.message = Some("os says no".into());
    assert_eq!(a.to_json(), finalize_absent().to_json());
}

#[test]
fn unreadable_reason_from_io_errors() {
    use std::io::{Error, ErrorKind};
    assert_eq!(Reason::from_io(&Error::from(ErrorKind::PermissionDenied)), Reason::Unreadable("permission denied".into()));
    assert_eq!(Reason::from_io(&Error::from(ErrorKind::Other)), Reason::Unreadable("io error".into()));
    assert_eq!(Reason::from_io(&Error::from(ErrorKind::TimedOut)), Reason::Unreadable("io error".into()));
}

// ---- canonical JSON ----

fn canon(text: &str) -> String {
    canonical(&serde_json::from_str::<Value>(text).unwrap())
}

#[test]
fn canonical_sorts_keys_and_drops_whitespace() {
    assert_eq!(canon(r#"{ "b": 1, "a": [ 2, {"d":1,"c":2} ], "é": 0, "z": null }"#), r#"{"a":[2,{"c":2,"d":1}],"b":1,"z":null,"é":0}"#);
}

#[test]
fn canonical_strings() {
    let v = Value::String("q\"\\\u{8}\t\n\u{c}\r\u{1}\u{1f}\u{7f}é€😀".to_string());
    assert_eq!(canonical(&v), "\"q\\\"\\\\\\b\\t\\n\\f\\r\\u0001\\u001f\u{7f}é€😀\"");
}

#[test]
fn canonical_numbers() {
    for (input, want) in [
        ("1", "1"),
        ("-5", "-5"),
        ("1.0", "1.0"),
        ("1.5", "1.5"),
        ("1e2", "100.0"),
        ("0.00001", "0.00001"),
        ("0.000001", "1e-6"),
        ("1.5e-7", "1.5e-7"),
        ("1e15", "1000000000000000.0"),
        ("1e16", "1e+16"),
        ("1.5e16", "1.5e+16"),
        ("-0", "-0.0"),
        ("18446744073709551615", "18446744073709551615"),
        ("18446744073709551616", "1.8446744073709552e+19"),
        ("-9223372036854775808", "-9223372036854775808"),
        ("1791009358.777", "1791009358.777"),
    ] {
        assert_eq!(canon(input), want, "{input}");
    }
}

#[test]
fn canonical_sha256() {
    assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert_eq!(sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

// ---- source scans ----

fn src_files() -> Vec<(String, String)> {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push((p.file_name().unwrap().to_string_lossy().to_string(), fs::read_to_string(&p).unwrap()));
        }
    }
    out
}

const WRITE_CALLS: [&str; 14] = [
    "File::create",
    "create_dir",
    "fs::write",
    "remove_file",
    "remove_dir",
    "fs::rename",
    "fs::copy",
    "OpenOptions",
    "set_permissions",
    "hard_link",
    "symlink(",
    "set_len",
    ".write(true)",
    ".append(true)",
];

#[test]
fn tc83_rust_makes_no_writes_outside_bundle_rs() {
    let mut seen_in_bundle = false;
    for (name, text) in src_files() {
        let code: String = text.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        for call in WRITE_CALLS {
            if code.contains(call) {
                if name == "bundle.rs" {
                    seen_in_bundle = true;
                } else if name == "main.rs" {
                    // The program supplies the writer of the compare-git report: exactly one call, `fs::write`.
                    assert_eq!(call, "fs::write", "main.rs may only write the report, found {call}");
                    assert_eq!(code.matches("fs::write").count(), 1);
                } else {
                    panic!("{name} contains {call}");
                }
            }
        }
    }
    assert!(seen_in_bundle, "bundle.rs is where the working copy is made");
}

#[test]
fn tc83_only_bundle_rs_starts_a_process_for_the_library() {
    for (name, text) in src_files() {
        if text.contains("Command::new") {
            assert!(name == "bundle.rs" || name == "compare.rs", "{name} starts a process");
        }
    }
}

#[test]
fn tc89_dependencies_are_serde_json_flate2_and_sha2_only() {
    let toml = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml")).unwrap();
    let mut section = String::new();
    let mut deps = Vec::new();
    for line in toml.lines() {
        let t = line.trim();
        if t.starts_with('[') {
            section = t.to_string();
        } else if section.contains("dependencies") && !t.is_empty() && !t.starts_with('#') {
            assert_eq!(section, "[dependencies]", "only normal dependencies are allowed, found {section}");
            deps.push(t.split('=').next().unwrap().trim().to_string());
        }
    }
    deps.sort();
    assert_eq!(deps, ["flate2", "serde_json", "sha2"]);
}

#[test]
fn tc90_member_of_the_workspace() {
    let toml = fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../Cargo.toml")).unwrap();
    let members = toml.lines().find(|l| l.trim_start().starts_with("members")).expect("members line");
    assert!(members.contains("\"bench-lake\""), "{members}");
}
