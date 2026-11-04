//! annotations.store (story 23): the operator's decisions about runs, kept in one append-only log beside the lake
//! (`<state>/annotations/log.jsonl`), written by `annotate` and read by `annotations`, `records` and `runs`.
//! TC-C0 to TC-C5 against the real command and temporary folders; the fold and the rules through the library.

mod common;
use bench_lake::annotations::{fold, Event, Kind, Op, Store, StoreError};
use common::*;
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Output;

const EXIT_OK: i32 = 0;
const EXIT_STORE: i32 = 1;
const EXIT_QUESTION: i32 = 2;
const LOG: &str = "annotations/log.jsonl";
const DIR_MODE_PRIVATE: u32 = 0o700;
const FILE_MODE_PRIVATE: u32 = 0o600;
const MODE_BITS: u32 = 0o777;
const MODE_NONE: u32 = 0o000;
const WRITERS: usize = 20;
const LAST_STORY: &str = "999";
const ABOVE_LAST_STORY: &str = "1000";

fn bl(state: &Path, args: &[&str]) -> Output {
    let mut cmd = bench_lake_cmd();
    cmd.arg(state).args(args).env("USER", "tester");
    cmd.output().unwrap()
}

fn json_of(o: &Output) -> Value {
    serde_json::from_slice(&o.stdout)
        .unwrap_or_else(|e| panic!("not JSON ({e}): {}", String::from_utf8_lossy(&o.stdout)))
}

fn stderr(o: &Output) -> String {
    String::from_utf8_lossy(&o.stderr).to_string()
}

fn set(state: &Path, kind: &str, run: &str, reason: &str) -> Output {
    bl(state, &["annotate", "set", kind, run, "--reason", reason])
}

fn log_bytes(state: &Path) -> Option<Vec<u8>> {
    fs::read(state.join(LOG)).ok()
}

fn current(state: &Path) -> Value {
    let o = bl(state, &["annotations"]);
    assert_eq!(o.status.code(), Some(EXIT_OK), "{}", stderr(&o));
    json_of(&o)
}

/// The run folders and their files: what an annotation must never change.
fn record_snapshot(state: &Path) -> std::collections::BTreeMap<String, String> {
    let mut all = snapshot(&state.join("collected"));
    all.extend(
        snapshot(&state.join("reference"))
            .into_iter()
            .map(|(k, v)| (format!("reference/{k}"), v)),
    );
    all
}

#[test]
fn tc_c0_a_decision_is_appended_and_read_back_and_no_record_changes() {
    let (_s, state, _lake) = scratch_lake("ann-c0");
    assert!(
        log_bytes(&state).is_none(),
        "no store before the first decision"
    );
    assert_eq!(
        current(&state)["runs"],
        json!({}),
        "a missing log is an empty store"
    );
    let before = record_snapshot(&state);

    let o = set(
        &state,
        "invalid",
        ID_FRESH,
        "a harness fault spoiled every story",
    );
    assert_eq!(o.status.code(), Some(EXIT_OK), "{}", stderr(&o));
    let printed = json_of(&o);
    assert_eq!(printed["event"]["seq"], 1);
    assert_eq!(printed["event"]["by"], "tester");

    let text = String::from_utf8(log_bytes(&state).unwrap()).unwrap();
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines.len(), 1);
    let line: Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(
        (
            line["v"].clone(),
            line["seq"].clone(),
            line["op"].clone(),
            line["kind"].clone(),
            line["run"].clone(),
            line["story"].clone()
        ),
        (
            json!(1),
            json!(1),
            json!("set"),
            json!("invalid"),
            json!(ID_FRESH),
            Value::Null
        )
    );
    assert!(
        line["at"].as_str().unwrap().ends_with('Z'),
        "UTC time: {}",
        line["at"]
    );

    let now = current(&state);
    let inv = &now["runs"][ID_FRESH]["invalid"];
    assert_eq!(inv["reason"], "a harness fault spoiled every story");
    assert_eq!(inv["by"], "tester");
    assert_eq!(inv["seq"], 1);
    assert_eq!(now["runs"][ID_FRESH]["archived"], Value::Null);
    assert_eq!(now["runs"][ID_FRESH]["not_comparable"], json!({}));

    assert_eq!(record_snapshot(&state), before, "no record file changed");
    let dir_mode = fs::metadata(state.join("annotations"))
        .unwrap()
        .permissions()
        .mode()
        & MODE_BITS;
    let file_mode = fs::metadata(state.join(LOG)).unwrap().permissions().mode() & MODE_BITS;
    assert_eq!((dir_mode, file_mode), (DIR_MODE_PRIVATE, FILE_MODE_PRIVATE));
}

#[test]
fn tc_c1_a_decision_is_replaced_then_withdrawn_and_the_history_keeps_all_three() {
    let (_s, state, _lake) = scratch_lake("ann-c1");
    assert_eq!(
        set(&state, "invalid", ID_FRESH, "X").status.code(),
        Some(EXIT_OK)
    );
    assert_eq!(
        set(&state, "invalid", ID_FRESH, "Y").status.code(),
        Some(EXIT_OK)
    );
    assert_eq!(current(&state)["runs"][ID_FRESH]["invalid"]["reason"], "Y");
    let o = bl(
        &state,
        &[
            "annotate",
            "clear",
            "invalid",
            ID_FRESH,
            "--reason",
            "rescored cleanly",
        ],
    );
    assert_eq!(o.status.code(), Some(EXIT_OK), "{}", stderr(&o));
    assert_eq!(current(&state)["runs"][ID_FRESH]["invalid"], Value::Null);

    let h = bl(&state, &["annotations", "--history"]);
    assert_eq!(h.status.code(), Some(EXIT_OK));
    let events = json_of(&h)["events"].as_array().unwrap().clone();
    let summary: Vec<(i64, String, String)> = events
        .iter()
        .map(|e| {
            (
                e["seq"].as_i64().unwrap(),
                e["op"].as_str().unwrap().into(),
                e["reason"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert_eq!(
        summary,
        vec![
            (1, "set".into(), "X".into()),
            (2, "set".into(), "Y".into()),
            (3, "clear".into(), "rescored cleanly".into())
        ]
    );
}

#[test]
fn tc_c2_every_refusal_exits_2_names_the_rule_and_leaves_the_log_unchanged() {
    let (_s, state, _lake) = scratch_lake("ann-c2");
    assert_eq!(
        set(&state, "invalid", ID_FRESH, "X").status.code(),
        Some(EXIT_OK)
    );
    let before = log_bytes(&state).unwrap();
    let cases: &[(&[&str], &str)] = &[
        (
            &["annotate", "clear", "archived", ID_FRESH, "--reason", "r"],
            "nothing to clear",
        ),
        (
            &["annotate", "set", "invalid", ID_FRESH, "--reason", "X"],
            "already",
        ),
        (
            &["annotate", "set", "invalid", ID_FRESH, "--reason", ""],
            "reason",
        ),
        (&["annotate", "set", "invalid", ID_FRESH], "reason"),
        (
            &[
                "annotate",
                "set",
                "not_comparable",
                ID_FRESH,
                "--reason",
                "r",
            ],
            "story",
        ),
        (
            &[
                "annotate", "set", "invalid", ID_FRESH, "--story", "3", "--reason", "r",
            ],
            "story",
        ),
        (
            &[
                "annotate",
                "set",
                "not_comparable",
                ID_FRESH,
                "--story",
                "-1",
                "--reason",
                "r",
            ],
            "story",
        ),
        (
            &[
                "annotate",
                "set",
                "not_comparable",
                ID_FRESH,
                "--story",
                ABOVE_LAST_STORY,
                "--reason",
                "r",
            ],
            "story",
        ),
        (
            &[
                "annotate",
                "set",
                "not_comparable",
                ID_FRESH,
                "--story",
                "x",
                "--reason",
                "r",
            ],
            "story",
        ),
        (
            &["annotate", "set", "spoiled", ID_FRESH, "--reason", "r"],
            "kind",
        ),
        (
            &["annotate", "toggle", "invalid", ID_FRESH, "--reason", "r"],
            "set or clear",
        ),
        (
            &[
                "annotate",
                "set",
                "invalid",
                "combinations/a/b",
                "--reason",
                "r",
            ],
            "run",
        ),
        (
            &[
                "annotate",
                "set",
                "invalid",
                "combinations/qwen/3.8/../ubuntu/m/e-c/benchmarks/vidi/r",
                "--reason",
                "r",
            ],
            "run",
        ),
        (
            &[
                "annotate",
                "set",
                "invalid",
                "benchmarks/reference/vidi/opus-5.5",
                "--reason",
                "r",
            ],
            "run",
        ),
        (
            &[
                "annotate",
                "set",
                "invalid",
                "combinations/qwen/3.8/27b/ubuntu/m/engine/benchmarks/vidi/r",
                "--reason",
                "r",
            ],
            "run",
        ),
        (
            &[
                "annotate",
                "set",
                "invalid",
                "combinations/qwen/3.8/27b/ubuntu/m/e-c/results/vidi/r",
                "--reason",
                "r",
            ],
            "run",
        ),
        (
            &[
                "annotate",
                "set",
                "invalid",
                &format!("node-a@{ID_FRESH}"),
                "--reason",
                "r",
            ],
            "run",
        ),
        (
            &[
                "annotate", "set", "invalid", ID_FRESH, "--reason", "r", "--colour", "red",
            ],
            "--colour",
        ),
        (&["annotations", "--everything"], "annotations"),
    ];
    for (args, says) in cases {
        let o = bl(&state, args);
        assert_eq!(
            o.status.code(),
            Some(EXIT_QUESTION),
            "{args:?}: {}",
            stderr(&o)
        );
        assert!(
            stderr(&o).contains(says),
            "{args:?} should name {says:?}: {}",
            stderr(&o)
        );
        assert_eq!(
            log_bytes(&state).unwrap(),
            before,
            "{args:?} changed the log"
        );
    }
    // The boundaries that are accepted: story 0 and the last story, and a reason of one character.
    for story in ["0", LAST_STORY] {
        let o = bl(
            &state,
            &[
                "annotate",
                "set",
                "not_comparable",
                ID_FRESH,
                "--story",
                story,
                "--reason",
                "r",
            ],
        );
        assert_eq!(
            o.status.code(),
            Some(EXIT_OK),
            "story {story}: {}",
            stderr(&o)
        );
    }
    assert_eq!(
        set(&state, "archived", ID_FRESH, "s").status.code(),
        Some(EXIT_OK)
    );
    // A run need not be in the lake: most archived runs are not.
    let gone = "benchmarks/reference/vidi/opus-5.5/run-2";
    assert_eq!(
        set(&state, "archived", gone, "superseded").status.code(),
        Some(EXIT_OK)
    );
    let now = current(&state);
    assert_eq!(now["runs"][ID_FRESH]["not_comparable"]["0"]["reason"], "r");
    assert_eq!(
        now["runs"][ID_FRESH]["not_comparable"][LAST_STORY]["reason"],
        "r"
    );
    assert_eq!(now["runs"][gone]["archived"]["reason"], "superseded");
}

#[test]
fn tc_c3_a_store_that_cannot_be_read_fails_every_question_and_is_never_read_as_undecided() {
    let good = json!({"v":1,"seq":1,"at":"2026-11-04T15:00:00Z","by":"t","op":"set","kind":"invalid","run":ID_FRESH,"story":null,"reason":"r"});
    let second = json!({"v":1,"seq":2,"at":"2026-11-04T15:00:01Z","by":"t","op":"set","kind":"archived","run":ID_FRESH,"story":null,"reason":"r"});
    let unknown_kind = json!({"v":1,"seq":2,"at":"2026-11-04T15:00:01Z","by":"t","op":"set","kind":"spoiled","run":ID_FRESH,"story":null,"reason":"r"});
    let logs: Vec<(String, &str)> = vec![
        (format!("not json\n{good}\n{second}\n"), "line 1"),
        (format!("{good}\nnot json\n{second}\n"), "line 2"),
        (format!("{good}\n{second}\nnot json\n"), "line 3"),
        (format!("{good}\n{unknown_kind}\n"), "line 2"),
        (format!("{good}\n{good}\n"), "line 2"),
    ];
    for (text, names) in logs {
        let (_s, state, _lake) = scratch_lake("ann-c3");
        write(&state.join(LOG), text.as_bytes());
        for q in [
            &["annotations"][..],
            &["records"],
            &["runs"],
            &["annotate", "set", "invalid", ID_FLASH, "--reason", "r"],
        ] {
            let o = bl(&state, q);
            assert_eq!(
                o.status.code(),
                Some(EXIT_STORE),
                "{q:?} over {text:?}: {}",
                stderr(&o)
            );
            assert!(
                stderr(&o).contains(names),
                "{q:?} should name {names}: {}",
                stderr(&o)
            );
            assert!(
                o.stdout.is_empty(),
                "{q:?} answered: {}",
                String::from_utf8_lossy(&o.stdout)
            );
        }
        assert_eq!(
            fs::read_to_string(state.join(LOG)).unwrap(),
            text,
            "a failed write appended nothing"
        );
    }
    if is_root() {
        return not_run("TC-C3 unreadable log", "running as the super-user");
    }
    let (_s, state, _lake) = scratch_lake("ann-c3-perm");
    write(&state.join(LOG), format!("{good}\n").as_bytes());
    fs::set_permissions(state.join(LOG), fs::Permissions::from_mode(MODE_NONE)).unwrap();
    let o = bl(&state, &["records"]);
    fs::set_permissions(
        state.join(LOG),
        fs::Permissions::from_mode(FILE_MODE_PRIVATE),
    )
    .unwrap();
    assert_eq!(o.status.code(), Some(EXIT_STORE));
    assert!(stderr(&o).contains("log.jsonl"), "{}", stderr(&o));
}

#[test]
fn tc_c4_concurrent_writers_get_consecutive_numbers_and_whole_lines() {
    let (_s, state, _lake) = scratch_lake("ann-c4");
    let children: Vec<_> = (0..WRITERS)
        .map(|i| {
            let mut cmd = bench_lake_cmd();
            cmd.arg(&state)
                .args([
                    "annotate",
                    "set",
                    "not_comparable",
                    ID_FRESH,
                    "--story",
                    &i.to_string(),
                    "--reason",
                    &format!("writer {i}"),
                ])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped());
            cmd.spawn().unwrap()
        })
        .collect();
    for c in children {
        let o = c.wait_with_output().unwrap();
        assert_eq!(o.status.code(), Some(EXIT_OK), "{}", stderr(&o));
    }
    let text = fs::read_to_string(state.join(LOG)).unwrap();
    let mut seqs: Vec<i64> = text
        .lines()
        .map(|l| {
            serde_json::from_str::<Value>(l).unwrap()["seq"]
                .as_i64()
                .unwrap()
        })
        .collect();
    let in_file_order = seqs.clone();
    seqs.sort();
    assert_eq!(seqs, (1..=WRITERS as i64).collect::<Vec<_>>());
    assert_eq!(in_file_order, seqs, "the file is in seq order");
    assert_eq!(
        current(&state)["runs"][ID_FRESH]["not_comparable"]
            .as_object()
            .unwrap()
            .len(),
        WRITERS
    );
}

fn by_id(answer: &Value) -> std::collections::BTreeMap<String, Value> {
    answer["runs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                format!("{}@{}", r["node"], r["id"].as_str().unwrap()),
                r.clone(),
            )
        })
        .collect()
}

#[test]
fn tc_c5_records_leave_out_archived_runs_and_every_answer_carries_the_decisions() {
    let (_s, state, _lake) = scratch_lake("ann-c5");
    let records_before = json_of(&bl(&state, &["records"]));
    let ids_before: Vec<String> = records_before["runs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().into())
        .collect();
    assert!(
        ids_before.contains(&ID_FRESH.to_string()) && ids_before.contains(&ID_FLASH.to_string())
    );
    assert!(ids_before.contains(&ID_TODOODLE.to_string()));

    assert_eq!(
        set(&state, "invalid", ID_FRESH, "spoiled").status.code(),
        Some(EXIT_OK)
    );
    assert_eq!(
        set(&state, "archived", ID_TODOODLE, "superseded")
            .status
            .code(),
        Some(EXIT_OK)
    );
    let o = bl(
        &state,
        &[
            "annotate",
            "set",
            "not_comparable",
            ID_FLASH,
            "--story",
            "4",
            "--reason",
            "built twice",
        ],
    );
    assert_eq!(o.status.code(), Some(EXIT_OK));

    let records = json_of(&bl(&state, &["records"]));
    let runs: Vec<&Value> = records["runs"].as_array().unwrap().iter().collect();
    let ids: Vec<&str> = runs.iter().map(|r| r["id"].as_str().unwrap()).collect();
    assert!(
        !ids.contains(&ID_TODOODLE),
        "archived in the store: left out of records"
    );
    assert_eq!(ids.len(), ids_before.len() - 1);
    let fresh = runs.iter().find(|r| r["id"] == ID_FRESH).unwrap();
    assert_eq!(fresh["annotations"]["invalid"]["reason"], "spoiled");
    let flash = runs.iter().find(|r| r["id"] == ID_FLASH).unwrap();
    assert_eq!(
        flash["annotations"]["not_comparable"]["4"]["reason"],
        "built twice"
    );
    assert_eq!(flash["annotations"]["invalid"], Value::Null);

    let all = by_id(&json_of(&bl(&state, &["runs"])));
    let todoodle: Vec<&Value> = all.values().filter(|r| r["id"] == ID_TODOODLE).collect();
    assert!(
        !todoodle.is_empty(),
        "runs lists every run, archived ones too"
    );
    for r in todoodle {
        assert_eq!(r["annotations"]["archived"]["reason"], "superseded");
    }
    for r in all.values().filter(|r| r["id"] == ID_FRESH) {
        assert_eq!(
            r["annotations"]["invalid"]["reason"], "spoiled",
            "every copy carries the decision"
        );
    }
}

#[test]
fn the_roots_form_has_no_store_refuses_to_write_and_answers_without_decisions() {
    let (_s, state, _lake) = scratch_lake("ann-roots");
    let c = state.join("collected");
    let r = state.join("reference");
    let roots = |extra: &[&str]| {
        let mut cmd = bench_lake_cmd();
        cmd.args(["--roots"]).arg(&c).arg(&r).args(extra);
        cmd.output().unwrap()
    };
    let o = roots(&["annotate", "set", "invalid", ID_FRESH, "--reason", "r"]);
    assert_eq!(o.status.code(), Some(EXIT_QUESTION));
    assert!(stderr(&o).contains("state folder"), "{}", stderr(&o));
    let o = roots(&["annotations"]);
    assert_eq!(o.status.code(), Some(EXIT_QUESTION));
    let rec = json_of(&roots(&["records"]));
    let fresh = rec["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == ID_FRESH)
        .unwrap()
        .clone();
    assert_eq!(
        fresh["annotations"],
        json!({"archived": null, "invalid": null, "not_comparable": {}})
    );
    assert!(!state.join("annotations").exists());
}

// The fold and the rules, through the library.

fn ev(seq: i64, op: Op, kind: Kind, run: &str, story: Option<i64>, reason: &str) -> Event {
    Event {
        v: 1,
        seq,
        at: format!("2026-11-04T15:00:{seq:02}Z"),
        by: "t".into(),
        op,
        kind,
        run: run.into(),
        story,
        reason: reason.into(),
    }
}

#[test]
fn the_latest_event_of_each_run_story_and_kind_wins_and_a_clear_removes_it() {
    let events = vec![
        ev(1, Op::Set, Kind::Invalid, "a", None, "first"),
        ev(2, Op::Set, Kind::NotComparable, "a", Some(3), "s3"),
        ev(3, Op::Set, Kind::NotComparable, "a", Some(4), "s4"),
        ev(4, Op::Set, Kind::Invalid, "a", None, "second"),
        ev(5, Op::Clear, Kind::NotComparable, "a", Some(3), "undo"),
        ev(6, Op::Set, Kind::Archived, "b", None, "old"),
        ev(7, Op::Clear, Kind::Archived, "b", None, "back"),
    ];
    let state = fold(&events);
    let a = &state.runs["a"];
    assert_eq!(
        a.invalid.as_ref().map(|d| (d.reason.as_str(), d.seq)),
        Some(("second", 4))
    );
    assert_eq!(
        a.not_comparable.keys().copied().collect::<Vec<_>>(),
        vec![4]
    );
    assert!(a.archived.is_none());
    assert!(state
        .runs
        .get("b")
        .is_none_or(|b| b.archived.is_none() && b.invalid.is_none()));
    assert!(state.archived("b").is_none() && state.invalid("a").is_some());
}

#[test]
fn the_store_reads_a_missing_log_as_empty_and_names_the_line_of_a_bad_one() {
    let s = Scratch::new("ann-lib");
    let store = Store::in_state_dir(s.path());
    assert!(store.events().unwrap().is_empty());
    write(&s.path().join(LOG), b"{\"v\":1}\n");
    match store.events() {
        Err(StoreError::Malformed { line, .. }) => assert_eq!(line, 1),
        other => panic!("expected a malformed line, got {other:?}"),
    }
    let p: PathBuf = store.log_path();
    assert!(p.ends_with(LOG));
}
