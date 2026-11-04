//! The `records` question (story 23, readers.benchmarker): every run's result documents in one answer, read from the
//! preferred copy, with the runs the host checkout marks archived left out.

mod common;
use common::*;
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Output;

const EXIT_OK: i32 = 0;
const EXIT_QUESTION: i32 = 2;
const STACK: &str = "combinations/fam/1.0/27b/ubuntu/box/llamacpp-pi/benchmarks/vidi";
const NODE_RAN: &str = "node-b";
const NODE_COPY: &str = "node-a";
const REF_ID: &str = "benchmarks/reference/vidi/opus-5.5/run-1";
const MODE_NONE: u32 = 0o000;

fn id(run: &str) -> String {
    format!("{STACK}/{run}")
}

fn put(dir: &Path, files: &[(&str, &str)]) {
    for (rel, text) in files {
        write(&dir.join(rel), text.as_bytes());
    }
}

/// A run folder under `node`, with a collection note naming `raw` raw story logs (the ranking prefers more).
fn run_dir(state: &Path, node: &str, run: &str, raw: usize) -> std::path::PathBuf {
    let dir = state.join("collected").join(node).join(id(run));
    let files: serde_json::Map<String, Value> = (1..=raw)
        .map(|s| (format!("stories/{s:02}/agent-events.jsonl"), json!({})))
        .collect();
    write(
        &dir.join("collection.json"),
        json!({"complete": true, "files": files}).to_string().as_bytes(),
    );
    dir
}

fn ask(state: &Path, args: &[&str]) -> Output {
    bench_lake_cmd().arg(state).arg("records").args(args).output().unwrap()
}

fn answer(state: &Path, args: &[&str]) -> Value {
    let o = ask(state, args);
    assert_eq!(o.status.code(), Some(EXIT_OK), "{}", String::from_utf8_lossy(&o.stderr));
    let v: Value = serde_json::from_slice(&o.stdout).unwrap();
    assert_eq!(v["status"], "found");
    v
}

fn run_of<'a>(v: &'a Value, run_id: &str) -> &'a Value {
    v["runs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == run_id)
        .unwrap_or_else(|| panic!("no {run_id} in {v}"))
}

fn ids(v: &Value) -> Vec<String> {
    v["runs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect()
}

/// Two copies of r1 (the node that ran it holds the raw log and a different metrics.json), r2 on one node, a
/// reference run.
fn lake() -> (Scratch, std::path::PathBuf) {
    let s = Scratch::new("results");
    let state = s.join("state");
    let copy = run_dir(&state, NODE_COPY, "r1", 0);
    put(
        &copy,
        &[
            ("run.json", "{\"host\":\"copy\"}"),
            ("metrics.json", "{\"from\":\"copy\"}"),
        ],
    );
    let ran = run_dir(&state, NODE_RAN, "r1", 1);
    put(
        &ran,
        &[
            ("run.json", "{\"host\":\"ran\"}"),
            ("run-status.json", "{\"state\":\"finished\"}"),
            ("metrics.json", "{\"from\":\"ran\"}"),
            ("finalize.json", "{\"rescore\":\"done\"}"),
            ("interventions.md", "- 2026-10-01T10:00Z story 2: restarted\n"),
            ("summary.md", "# r1\n"),
            ("progress.json", "{}"),
            ("run-history.jsonl", "{}\n"),
            ("server.log", "log\n"),
            ("stories/01/accept-summary.json", "{\"passed\":1}"),
            ("stories/01/agent-events.jsonl", "{}\n"),
            ("rescore/vidi-v2/rescore.json", "{\"results\":[]}"),
            ("rescore/vidi-v2/per-story.md", "| story |\n"),
            ("rescore/vidi-v2/metrics.json", "{}"),
            ("rescore/vidi-v2/stories/01/accept-summary.json", "{\"passed\":3}"),
            ("rescore/vidi-v2/stories/02/accept.json", "{\"passed\":4}"),
            ("rescore/vidi-v2/stories/02/accept-report.json", "{}"),
            (
                "rescore/vidi-v2/stories/2/accept-summary.json",
                "{\"bad\":\"story folder\"}",
            ),
            ("rescore/not a version/rescore.json", "{}"),
            ("workspace.bundle", "bundle"),
        ],
    );
    let r2 = run_dir(&state, NODE_COPY, "r2", 0);
    put(&r2, &[("run.json", "{not json"), ("metrics.json", "{}")]);
    let reference = state.join("reference/vidi/opus-5.5/run-1");
    put(&reference, &[("run.json", "{}"), ("metrics.json", "{\"ref\":true}")]);
    (s, state)
}

#[test]
fn each_run_once_from_its_preferred_copy_ordered_by_id_with_its_result_documents_as_text() {
    let (_s, state) = lake();
    let v = answer(&state, &[]);
    assert_eq!(ids(&v), vec![REF_ID.to_string(), id("r1"), id("r2")]);
    let r1 = run_of(&v, &id("r1"));
    assert_eq!(r1["node"], NODE_RAN, "the copy with the raw logs");
    assert_eq!(r1["kind"], "combination");
    assert_eq!(r1["dir"], format!("collected/{NODE_RAN}/{}", id("r1")));
    assert_eq!(
        r1["files"],
        json!({
            "run.json": "{\"host\":\"ran\"}",
            "run-status.json": "{\"state\":\"finished\"}",
            "metrics.json": "{\"from\":\"ran\"}",
            "finalize.json": "{\"rescore\":\"done\"}",
            "interventions.md": "- 2026-10-01T10:00Z story 2: restarted\n",
            "summary.md": "# r1\n",
            "rescore/vidi-v2/rescore.json": "{\"results\":[]}",
            "rescore/vidi-v2/per-story.md": "| story |\n",
            "rescore/vidi-v2/stories/01/accept-summary.json": "{\"passed\":3}",
            "rescore/vidi-v2/stories/02/accept.json": "{\"passed\":4}",
        }),
        "logs, story records, progress, the note, other rescore files and badly named folders are not result documents"
    );
    assert_eq!(r1["bundle"], true);
    assert_eq!(r1["unreadable"], json!([]));
}

#[test]
fn a_record_that_does_not_parse_is_given_as_written_and_a_run_without_a_bundle_says_so() {
    let (_s, state) = lake();
    let v = answer(&state, &[]);
    let r2 = run_of(&v, &id("r2"));
    assert_eq!(r2["files"], json!({"run.json": "{not json", "metrics.json": "{}"}));
    assert_eq!(r2["bundle"], false);
    let reference = run_of(&v, REF_ID);
    assert_eq!(reference["node"], Value::Null);
    assert_eq!(reference["kind"], "reference");
    assert_eq!(
        reference["files"],
        json!({"run.json": "{}", "metrics.json": "{\"ref\":true}"})
    );
}

#[test]
fn a_run_marked_archived_in_the_checkout_is_left_out_and_nothing_else_is_a_marker() {
    let (s, state) = lake();
    let checkout = s.join("checkout");
    write(&checkout.join(id("r1")).join("archived.json"), b"{}");
    fs::create_dir_all(checkout.join(id("r2")).join("archived.json")).unwrap(); // a folder is not a marker
    write(&checkout.join(REF_ID).join("archived.md"), b"{}"); // another name is not a marker
    let v = answer(&state, &["--archived", checkout.to_str().unwrap()]);
    assert_eq!(ids(&v), vec![REF_ID.to_string(), id("r2")]);
    assert_eq!(
        ids(&answer(&state, &[])).len(),
        3,
        "without --archived nothing is left out"
    );
    let empty = s.join("empty-checkout");
    fs::create_dir_all(&empty).unwrap();
    assert_eq!(ids(&answer(&state, &["--archived", empty.to_str().unwrap()])).len(), 3);
}

#[test]
fn a_document_that_cannot_be_read_or_is_not_utf8_is_named_unreadable_and_the_rest_is_given() {
    if is_root() {
        return not_run("records-unreadable", "the super-user reads any file");
    }
    let (s, state) = lake();
    let dir = state.join("collected").join(NODE_RAN).join(id("r1"));
    let locked = dir.join("finalize.json");
    fs::set_permissions(&locked, fs::Permissions::from_mode(MODE_NONE)).unwrap();
    write(&dir.join("summary.md"), &[0xff, 0xfe, b'x']);
    fs::remove_file(dir.join("run-status.json")).unwrap();
    fs::create_dir_all(dir.join("run-status.json")).unwrap(); // a folder where a document should be
    let v = answer(&state, &[]);
    make_writable(s.path());
    let r1 = run_of(&v, &id("r1"));
    assert_eq!(
        r1["unreadable"],
        json!(["finalize.json", "run-status.json", "summary.md"])
    );
    let files = r1["files"].as_object().unwrap();
    for gone in ["finalize.json", "summary.md", "run-status.json"] {
        assert!(!files.contains_key(gone), "{gone}");
    }
    assert_eq!(files["metrics.json"], "{\"from\":\"ran\"}");
}

#[test]
fn an_empty_lake_has_no_runs_and_a_malformed_question_prints_nothing() {
    let s = Scratch::new("results-empty");
    assert_eq!(answer(&s.join("none"), &[])["runs"], json!([]));
    for bad in [&["--archived"][..], &["extra"][..], &["--archived", "a", "b"][..]] {
        let o = ask(&s.join("none"), bad);
        assert_eq!(o.status.code(), Some(EXIT_QUESTION), "{bad:?}");
        assert!(o.stdout.is_empty());
        assert!(String::from_utf8_lossy(&o.stderr).starts_with("bench-lake: "));
    }
}

#[test]
fn the_answer_is_canonical_and_reads_nothing_into_the_lake() {
    let (_s, state) = lake();
    let before = snapshot(&state);
    let o = ask(&state, &[]);
    let text = String::from_utf8(o.stdout).unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(text.trim_end(), bench_lake::canonical(&v));
    assert_eq!(snapshot(&state), before);
}

#[test]
fn folders_that_are_not_runs_and_missing_roots_are_reported_as_runs_reports_them() {
    if is_root() {
        return not_run("records-rejected", "the super-user reads any folder");
    }
    let (s, state) = lake();
    let locked = state.join("collected").join(NODE_COPY).join("combinations/fam/1.0/27b/ubuntu/box/llamacpp-pi/benchmarks/other");
    fs::create_dir_all(locked.join("r9")).unwrap();
    fs::set_permissions(&locked, fs::Permissions::from_mode(MODE_NONE)).unwrap();
    let records = answer(&state, &[]);
    let runs = bench_lake_cmd().arg(&state).arg("runs").output().unwrap();
    make_writable(s.path());
    let runs: Value = serde_json::from_slice(&runs.stdout).unwrap();
    assert_eq!(records["rejected"], runs["rejected"]);
    assert_eq!(records["rejected"][0]["code"], "E-LAKE-UNREADABLE");
    assert_eq!(records["missing_roots"], json!([]));
    let only_collected = s.join("only-collected");
    fs::create_dir_all(only_collected.join("collected")).unwrap();
    assert_eq!(answer(&only_collected, &[])["missing_roots"], json!(["reference"]));
}
