//! lakelib.impl.rust: the bench-lake command, TC-85 to TC-88 (and the compare-git command).

mod common;
use common::*;
use serde_json::Value;
use std::fs;
use std::process::Output;

const EXIT_OK: i32 = 0;
const EXIT_QUESTION: i32 = 2;
const EXIT_DEFECT: i32 = 1;
const EXIT_NOT_RUN: i32 = 3;

fn run(args: &[&str]) -> Output {
    bench_lake_cmd().arg(fixture_state()).args(args).output().unwrap()
}

fn json_of(o: &Output) -> Value {
    serde_json::from_slice(&o.stdout).unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(&o.stdout)))
}

fn stdout_text(o: &Output) -> String {
    String::from_utf8(o.stdout.clone()).unwrap()
}

#[test]
fn tc85_the_command_answers_runs() {
    let o = run(&["runs"]);
    assert_eq!(o.status.code(), Some(EXIT_OK));
    assert!(o.stderr.is_empty());
    let text = stdout_text(&o);
    assert!(text.ends_with("}\n") && text.matches('\n').count() == 1);
    let v = json_of(&o);
    assert_eq!(v["status"], "found");
    assert_eq!(v["runs"].as_array().unwrap().len(), FIXTURE_RUN_COUNT);
    assert_eq!(v["missing_roots"], serde_json::json!([]));
    assert_eq!(v["rejected"], serde_json::json!([]));
    assert_eq!(text.trim_end(), bench_lake::canonical(&v), "the output is its own canonical form");
    assert_eq!(v["runs"][0]["dir"], "reference/todoodle/opus-5.5/run-1");
    assert_eq!(v["runs"][0]["node"], Value::Null);
}

#[test]
fn the_two_root_form_equals_the_state_dir_form() {
    let state = fixture_state();
    let two = bench_lake_cmd()
        .arg("--roots")
        .arg(state.join("collected"))
        .arg(state.join("reference"))
        .arg("runs")
        .output()
        .unwrap();
    assert_eq!(two.stdout, run(&["runs"]).stdout);
    let missing = bench_lake_cmd().arg(state.join("nothing")).arg("runs").output().unwrap();
    assert_eq!(missing.status.code(), Some(EXIT_OK));
    let v = json_of(&missing);
    assert_eq!(v["missing_roots"], serde_json::json!(["collected", "reference"]));
    assert_eq!(v["runs"], serde_json::json!([]));
}

#[test]
fn copies_and_preferred() {
    let v = json_of(&run(&["copies", ID_Q36]));
    let nodes: Vec<&str> = v["copies"].as_array().unwrap().iter().map(|c| c["node"].as_str().unwrap()).collect();
    assert_eq!(nodes, ["gruntus", "quintus", "tritus"]);
    assert_eq!(json_of(&run(&["copies", "combinations/none"]))["copies"], serde_json::json!([]));
    assert_eq!(json_of(&run(&["preferred", ID_Q36]))["preferred"]["node"], "gruntus");
    let a = run(&["preferred", "combinations/none"]);
    assert_eq!(a.status.code(), Some(EXIT_OK));
    assert_eq!(json_of(&a)["absent"]["code"], "E-LAKE-NO-RUN");
}

#[test]
fn tc86_payload_form_for_a_record_and_a_log() {
    let v = json_of(&run(&["record", ID_FRESH, "status"]));
    let file = fs::read(fixture_state().join("collected/gruntus").join(ID_FRESH).join("run-status.json")).unwrap();
    assert_eq!(v["length"], file.len());
    assert_eq!(v["sha256"], bench_lake::sha256_hex(&file));
    assert_eq!(v["value"], serde_json::from_slice::<Value>(&file).unwrap());
    assert_eq!((v["status"].as_str(), v["node"].as_str(), v["run"].as_str()), (Some("found"), Some("gruntus"), Some(ID_FRESH)));
    // a text record carries its text
    let t = json_of(&run(&["record", ID_FRESH, "base-commit", "1"]));
    assert_eq!(t["value"], "30816ab716043c8a400ee0e43b0e7f8b3438a3ea");
    assert_eq!(t["length"], 40);
    // a log carries length, lines and hash of the decoded stream, and no value
    let l = json_of(&run(&["log", ID_FRESH, "1"]));
    let raw = fs::read(fixture_state().join("collected/gruntus").join(ID_FRESH).join("stories/01/agent-events.jsonl")).unwrap();
    assert_eq!((l["form"].as_str(), l["lines"].as_u64(), l["length"].as_u64()), (Some("raw"), Some(20), Some(raw.len() as u64)));
    assert_eq!(l["sha256"], bench_lake::sha256_hex(&raw));
    assert!(l.get("value").is_none());
    assert_eq!(l["story"], 1);
    // the leading zero of a story is read as a number
    assert_eq!(run(&["log", ID_FRESH, "01"]).stdout, run(&["log", ID_FRESH, "1"]).stdout);
}

#[test]
fn the_node_at_id_form_picks_a_copy() {
    let spec = format!("quintus@{ID_Q36}");
    assert_eq!(json_of(&run(&["record", &spec, "status"]))["node"], "quintus");
    let a = json_of(&run(&["record", &spec, "finalize"]));
    assert_eq!(a["absent"]["code"], "E-LAKE-NOT-COLLECTED");
    assert_eq!(a["absent"]["node"], "quintus");
    let n = json_of(&run(&["record", &format!("nonode@{ID_Q36}"), "status"]));
    assert_eq!(n["absent"]["code"], "E-LAKE-NO-RUN");
    assert_eq!(n["absent"]["node"], "nonode");
}

#[test]
fn tc87_a_malformed_question_is_exit_2_with_a_message_on_stderr() {
    let cases: [&[&str]; 14] = [
        &["frobnicate"],
        &[],
        &["runs", "extra"],
        &["copies"],
        &["preferred"],
        &["record"],
        &["record", ID_FRESH],
        &["record", ID_FRESH, "nonesuch"],
        &["record", ID_FRESH, "accept", "notanumber"],
        &["record", ID_FRESH, "accept"],
        &["log", ID_FRESH],
        &["log", ID_FRESH, "x1"],
        &["workspace", ID_FRESH, "1"],
        &["complete"],
    ];
    for args in cases {
        let o = run(args);
        assert_eq!(o.status.code(), Some(EXIT_QUESTION), "{args:?}");
        assert!(o.stdout.is_empty(), "{args:?}: {}", stdout_text(&o));
        let e = String::from_utf8_lossy(&o.stderr).to_string();
        assert!(e.starts_with("bench-lake: ") && e.trim_end().lines().count() == 1, "{args:?}: {e:?}");
    }
    let o = bench_lake_cmd().output().unwrap();
    assert_eq!(o.status.code(), Some(EXIT_QUESTION));
    let o = bench_lake_cmd().arg("--roots").arg(fixture_state()).output().unwrap();
    assert_eq!(o.status.code(), Some(EXIT_QUESTION));
}

#[test]
fn tc88_absence_is_an_answer_on_stdout_with_exit_0() {
    let o = run(&["record", ID_DRY, "metrics"]);
    assert_eq!(o.status.code(), Some(EXIT_OK));
    assert!(o.stderr.is_empty());
    let v = json_of(&o);
    assert_eq!(v["status"], "absent");
    assert_eq!(v["absent"]["code"], "E-LAKE-NOT-COLLECTED");
    assert_eq!(v["absent"]["item"], "record:metrics");
    assert_eq!(v["absent"]["run"], ID_DRY);
    assert_eq!(stdout_text(&o).trim_end(), bench_lake::canonical(&v));
    for (args, code) in [
        (vec!["record", ID_FRESH, "accept", "1000"], "E-LAKE-BAD-NAME"),
        (vec!["record", ID_FRESH, "rescore", ".."], "E-LAKE-BAD-NAME"),
        (vec!["record", ID_FRESH, "rescore", ""], "E-LAKE-BAD-NAME"),
        (vec!["log", ID_FRESH, "2"], "E-LAKE-NOT-COLLECTED"),
        (vec!["log", ID_FRESH, "-1"], "E-LAKE-BAD-NAME"),
        (vec!["complete", "combinations/none"], "E-LAKE-NO-RUN"),
    ] {
        let o = run(&args);
        assert_eq!(o.status.code(), Some(EXIT_OK), "{args:?}");
        assert_eq!(json_of(&o)["absent"]["code"], code, "{args:?}");
    }
}

#[test]
fn a_damaged_record_and_a_damaged_log_are_absences() {
    let (_s, state, _lake) = scratch_lake("cmd-damaged");
    let run_dir = state.join("collected/gruntus").join(ID_Q36);
    let whole = fs::read(run_dir.join("stories/01/agent-events.compact.jsonl.gz")).unwrap();
    fs::write(run_dir.join("stories/01/agent-events.compact.jsonl.gz"), &whole[..whole.len() / 2]).unwrap();
    fs::write(run_dir.join("run-status.json"), b"{\"cut\":").unwrap();
    let ask = |args: &[&str]| bench_lake_cmd().arg(&state).args(args).output().unwrap();
    let l = ask(&["log", ID_Q36, "1"]);
    assert_eq!(l.status.code(), Some(EXIT_OK));
    assert_eq!(json_of(&l)["absent"]["detail"], "not valid gzip");
    let r = ask(&["record", ID_Q36, "status"]);
    assert_eq!(json_of(&r)["absent"]["detail"], "not valid JSON");
    assert_eq!(ask(&["complete", ID_Q36]).status.code(), Some(EXIT_OK));
}

#[test]
fn complete_command() {
    let v = json_of(&run(&["complete", ID_FRESH]));
    assert_eq!((v["completeness"].as_str(), v["state"].as_str()), (Some("complete"), Some("finished")));
    assert_eq!((v["settled_at"].as_u64(), v["collected_at"].as_u64()), (Some(1792116937), Some(1792160967)));
    let v = json_of(&run(&["complete", ID_TODOODLE]));
    assert_eq!(v["completeness"], "no-note");
    assert!(v["settled_at"].is_null() && v["state"].is_null() && v["collected_at"].is_null());
}

#[test]
fn workspace_command_success_and_refusal() {
    let s = Scratch::new("cmd-ws");
    let dest = s.join("w");
    let o = run(&["workspace", ID_Q36, "1", dest.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(EXIT_OK), "{}", String::from_utf8_lossy(&o.stderr));
    let v = json_of(&o);
    assert_eq!(v["commit"], "59a592fca04af9fe2c8b667b3a784298795ccde9");
    assert_eq!(v["path"], dest.to_str().unwrap());
    assert_eq!(v["story"], 1);
    assert_eq!(git(&dest, &["rev-parse", "HEAD"]), v["commit"].as_str().unwrap());
    // the destination is no longer empty: refused, exit 2, the refusal on stdout
    let o = run(&["workspace", ID_Q36, "1", dest.to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(EXIT_QUESTION));
    let v = json_of(&o);
    assert_eq!(v["status"], "refused");
    assert_eq!(v["refused"]["code"], "E-LAKE-DEST-NOT-EMPTY");
    assert_eq!(v["refused"]["item"], "workspace:1");
    // an absence is exit 0
    let o = run(&["workspace", ID_FLASH, "1", s.join("w2").to_str().unwrap()]);
    assert_eq!(o.status.code(), Some(EXIT_OK));
    assert_eq!(json_of(&o)["absent"]["item"], "bundle");
}

#[test]
fn compare_git_reports_not_run_and_runs() {
    let s = Scratch::new("cmd-compare");
    let report = s.join("out/report.json");
    // no repository: exit 3, a message, nothing on stdout, no report
    let o = bench_lake_cmd()
        .arg(fixture_state())
        .arg("compare-git")
        .arg(s.join("no-repo"))
        .arg("--report")
        .arg(&report)
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(EXIT_NOT_RUN));
    assert!(o.stdout.is_empty());
    assert!(String::from_utf8_lossy(&o.stderr).starts_with("bench-lake: not run: "), "{}", String::from_utf8_lossy(&o.stderr));
    assert!(!report.exists());
    // the real repository against the fixture lake: runs, writes the report, exit 0 (no library defect)
    if repo_root().join(".git").exists() {
        fs::create_dir_all(report.parent().unwrap()).unwrap();
        let o = bench_lake_cmd()
            .arg(fixture_state())
            .arg("compare-git")
            .arg(repo_root())
            .args(["--rev", "HEAD", "--report"])
            .arg(&report)
            .output()
            .unwrap();
        assert_eq!(o.status.code(), Some(EXIT_OK), "{}", String::from_utf8_lossy(&o.stderr));
        let v: Value = serde_json::from_slice(&fs::read(&report).unwrap()).unwrap();
        assert_eq!(v["defects"], serde_json::json!([]));
        assert_eq!(json_of(&o), v, "the report is also printed");
    } else {
        not_run("compare-git on the real repository", "no repository");
    }
    let _ = EXIT_DEFECT;
}

#[test]
fn a_big_story_number_is_a_bad_name_not_a_crash() {
    let v = json_of(&run(&["record", ID_FRESH, "accept", "99999999999999999999"]));
    assert_eq!(v["absent"]["code"], "E-LAKE-BAD-NAME");
}
