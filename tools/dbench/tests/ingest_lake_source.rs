//! The ingest's published side read from the lake (story 23, ingest.lake_source): each combination run's preferred
//! copy, its record files only, and the archived markers from the host checkout as plain files. No git.

use dbench::ingest::inputs::{LakeSource, Published, ARCHIVED_MARKER};
use std::fs;
use std::path::{Path, PathBuf};

const RUN: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1";
const OTHER: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r2";
/// Sorts after COPY_NODE, so taking the first copy found instead of the preferred one is caught.
const OWN_NODE: &str = "thing2";
const COPY_NODE: &str = "gruntus";

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-lake-source-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    d
}

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

/// A collection note like the collector's: the copy on the node that ran the run lists its raw story logs.
fn note(raw_logs: usize) -> String {
    let mut files = serde_json::Map::new();
    files.insert("metrics.json".into(), serde_json::json!({"bytes": 10}));
    for s in 1..=raw_logs {
        files.insert(format!("stories/{s:02}/agent-events.jsonl"), serde_json::json!({"bytes": 100}));
    }
    serde_json::json!({"node": "x", "complete": true, "collected_at": 1.0, "files": files}).to_string()
}

/// One copy of a run in the lake under `node`, with records, raw files and a bundle.
fn copy(state: &Path, node: &str, run: &str, metrics: &str, raw_logs: usize) -> PathBuf {
    let dir = state.join("collected").join(node).join(run);
    write(&dir.join("collection.json"), note(raw_logs).as_bytes());
    write(&dir.join("metrics.json"), metrics.as_bytes());
    write(&dir.join("run.json"), b"{\"pack_version\":\"v2\"}");
    write(&dir.join("stories/01/agent-events.compact.jsonl.gz"), b"gz");
    write(&dir.join("stories/01/accept-summary.json"), b"{\"passed\":3,\"total\":4}");
    write(&dir.join("server.log"), b"raw server log");
    write(&dir.join("workspace.bundle"), b"bundle bytes");
    if raw_logs > 0 {
        write(&dir.join("stories/01/agent-events.jsonl"), b"{}\n");
    }
    dir
}

fn source(root: &Path) -> LakeSource {
    LakeSource::new(&root.join("state/collected"), &root.join("state/reference"), &root.join("checkout"))
}

#[test]
fn lists_only_record_files_of_combination_runs_with_their_paths_relative_to_the_repo() {
    let root = tmp("records");
    copy(&root.join("state"), OWN_NODE, RUN, "{\"a\":1}", 1);
    let paths = source(&root).paths().unwrap();
    let names: Vec<&str> = paths.keys().map(String::as_str).collect();
    assert_eq!(
        names,
        vec![
            format!("{RUN}/metrics.json").as_str(),
            format!("{RUN}/run.json").as_str(),
            format!("{RUN}/stories/01/accept-summary.json").as_str(),
            format!("{RUN}/stories/01/agent-events.compact.jsonl.gz").as_str(),
        ],
        "raw logs, the collection note and the bundle are not published records"
    );
}

#[test]
fn a_run_under_several_nodes_is_listed_once_from_the_copy_with_the_raw_logs() {
    let root = tmp("copies");
    copy(&root.join("state"), COPY_NODE, RUN, "{\"from\":\"copy\"}", 0);
    copy(&root.join("state"), OWN_NODE, RUN, "{\"from\":\"own\"}", 1);
    let src = source(&root);
    let paths = src.paths().unwrap();
    assert_eq!(paths.keys().filter(|p| p.ends_with("/metrics.json")).count(), 1);
    assert_eq!(src.read(&format!("{RUN}/metrics.json")).unwrap().unwrap(), b"{\"from\":\"own\"}");
}

#[test]
fn the_id_is_the_sha256_of_the_content_and_changes_when_the_bytes_change() {
    let root = tmp("ids");
    let dir = copy(&root.join("state"), OWN_NODE, RUN, "{\"a\":1}", 1);
    let before = source(&root).paths().unwrap()[&format!("{RUN}/metrics.json")].clone();
    assert_eq!(before, bench_lake::sha256_hex(b"{\"a\":1}"));
    fs::write(dir.join("metrics.json"), b"{\"a\":2}").unwrap();
    let after = source(&root).paths().unwrap()[&format!("{RUN}/metrics.json")].clone();
    assert_ne!(before, after);
}

#[test]
fn reading_a_path_that_is_not_a_listed_record_gives_none() {
    let root = tmp("absent");
    copy(&root.join("state"), OWN_NODE, RUN, "{}", 1);
    let src = source(&root);
    assert_eq!(src.read(&format!("{RUN}/server.log")).unwrap(), None, "a raw file is not a published record");
    assert_eq!(src.read(&format!("{RUN}/workspace.bundle")).unwrap(), None);
    assert_eq!(src.read(&format!("{OTHER}/metrics.json")).unwrap(), None);
}

#[test]
fn reference_runs_are_not_published_records() {
    let root = tmp("reference");
    let dir = root.join("state/reference/vidi/opus-5.5/v2-r1");
    write(&dir.join("run.json"), b"{}");
    write(&dir.join("metrics.json"), b"{}");
    assert!(source(&root).paths().unwrap().is_empty());
}

#[test]
fn archived_runs_come_from_markers_in_the_host_checkout_read_as_files() {
    let root = tmp("archived");
    copy(&root.join("state"), OWN_NODE, RUN, "{}", 1);
    write(&root.join("checkout").join(OTHER).join(ARCHIVED_MARKER), b"{}");
    write(&root.join("checkout/benchmarks/reference/vidi/opus-5.5/run-1").join(ARCHIVED_MARKER), b"{}");
    write(&root.join("checkout").join(RUN).join("archived.txt"), b"not a marker");
    let archived = source(&root).archived().unwrap();
    assert_eq!(
        archived.into_iter().collect::<Vec<_>>(),
        vec!["benchmarks/reference/vidi/opus-5.5/run-1".to_string(), OTHER.to_string()]
    );
}

#[test]
fn an_empty_or_missing_lake_lists_nothing_and_is_not_an_error() {
    let root = tmp("empty");
    let src = source(&root);
    assert!(src.paths().unwrap().is_empty());
    assert!(src.archived().unwrap().is_empty());
}

#[test]
fn it_describes_itself_as_the_lake() {
    let root = tmp("describe");
    assert_eq!(source(&root).describe(), format!("lake {}", root.join("state/collected").display()));
}

#[test]
fn a_malformed_record_in_the_lake_is_read_as_an_empty_record_and_the_other_runs_are_untouched() {
    use dbench::ingest::inputs::run_record;
    let root = tmp("malformed");
    copy(&root.join("state"), OWN_NODE, RUN, "{not json", 1);
    copy(&root.join("state"), OWN_NODE, OTHER, "{\"stories\": {}}", 1);
    let src = source(&root);
    let ids = src.paths().unwrap();
    let bad = run_record(&src, &ids, RUN).unwrap();
    assert_eq!(bad.metrics, serde_json::json!({}), "as from git: unparseable is empty, never an error that stops the pass");
    assert_eq!(bad.run_json, serde_json::json!({"pack_version": "v2"}), "the run's other records are still read");
    let good = run_record(&src, &ids, OTHER).unwrap();
    assert_eq!(good.metrics, serde_json::json!({"stories": {}}));
}
