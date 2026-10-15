//! Story 5, unit tests of the collector through its public API: blob transfer (against an in-process fake node that stands in
//! for the transport only), the reference destination, the collection note's states, the run-id layout and the free-space
//! decision (lake.transfer.blob_files, lake.reference.collect_into_reference, lake.collect.completeness,
//! lake.layout.run_id_kept, lake.collect.space_guard), and the node's staleness rule for a blob read.

use dbench::client::{Api, Ctx, NodeEntry, RunRef};
use dbench::collect::{Class, FileEntry, FileKind, Manifest, RunListing, RunStatus, COLLECT_CHUNK_BYTES, HDR_EOF, HDR_FROM, HDR_MTIME, HDR_SIZE};
use dbench::collector::*;
use dbench::ingest::db::REFERENCE_RUN_PREFIX;
use dbench::server::blob_stale;
use anyhow::Result;
use axum::{
    body::Body,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn collect_args(extra: &[&str]) -> dbench::cli::CollectArgs {
    let mut argv = vec!["dbench", "collect"];
    argv.extend(extra);
    match <dbench::cli::Cli as clap::Parser>::try_parse_from(argv).unwrap().cmd {
        dbench::cli::Cmd::Collect(a) => a,
        other => panic!("{other:?}"),
    }
}


// ---- story 5: the lake takes the full record ----


/// A node that serves what a test gives it, over HTTP, with the faults a real node can have: a size that is too big
/// (a lying or racing server), a file rewritten between two requests, an old node with no /v1/runs. It is a double of
/// the transport only: the collector's own code is what runs against it.
struct FakeFile {
    data: Vec<u8>,
    mtime: f64,
    kind: FileKind,
}

#[derive(Default)]
struct FakeNode {
    files: BTreeMap<String, FakeFile>,
    state: Option<&'static str>,
    job_state: Option<&'static str>,
    runs: Vec<String>,
    runs_status: Option<u16>,
    lie: usize,
    bump: bool,
    requests: Vec<(String, u64, Option<String>)>,
    rewrite: Option<(usize, String, Vec<u8>)>,
}

type Fake = Arc<Mutex<FakeNode>>;

async fn fake_runs(State(n): State<Fake>) -> Response {
    let n = n.lock().unwrap();
    if let Some(code) = n.runs_status {
        return (StatusCode::from_u16(code).unwrap(), "no such route").into_response();
    }
    let listing: Vec<RunListing> = n.runs.iter().map(|r| RunListing { run: r.clone(), job: None, run_status: None, job_state: None }).collect();
    Json(listing).into_response()
}

async fn fake_files(State(n): State<Fake>, Query(q): Query<BTreeMap<String, String>>) -> Response {
    let n = n.lock().unwrap();
    let files = n.files.iter().map(|(name, f)| FileEntry { name: name.clone(), kind: f.kind, size: f.data.len() as u64, mtime: f.mtime }).collect();
    Json(Manifest {
        run: q.get("run").cloned().unwrap_or_default(),
        job: None,
        run_status: n.state.map(|s| RunStatus { state: s.into(), at: None }),
        job_state: n.job_state.map(String::from),
        files,
        unlisted: 0,
    })
    .into_response()
}

async fn fake_file(State(n): State<Fake>, Query(q): Query<BTreeMap<String, String>>) -> Response {
    let mut n = n.lock().unwrap();
    let name = q.get("name").cloned().unwrap_or_default();
    let from: u64 = q.get("from").and_then(|f| f.parse().ok()).unwrap_or(0);
    let held = q.get("mtime").cloned();
    n.requests.push((name.clone(), from, held.clone()));
    let count = n.requests.len();
    if n.bump {
        for f in n.files.values_mut() {
            f.mtime += 1.0;
        }
    }
    if let Some((after, which, bytes)) = n.rewrite.clone() {
        if count > after {
            let f = n.files.get_mut(&which).unwrap();
            f.data = bytes;
            f.mtime += 1.0;
            n.rewrite = None;
        }
    }
    let lying = count <= n.lie;
    let Some(f) = n.files.get(&name) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such file"}))).into_response();
    };
    let size = f.data.len() as u64;
    if f.kind == FileKind::Blob && (from > size || (from > 0 && held.as_deref() != Some(format!("{:.3}", f.mtime).as_str()))) {
        return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "E-BLOB-CHANGED", "size": size}))).into_response();
    }
    let end = (from + COLLECT_CHUNK_BYTES).min(size);
    let body = f.data[from as usize..end as usize].to_vec();
    let reported = if lying { size + 10 } else { size };
    axum::http::Response::builder()
        .header(HDR_FROM, from.to_string())
        .header(HDR_SIZE, reported.to_string())
        .header(HDR_MTIME, format!("{:.3}", f.mtime))
        .header(HDR_EOF, if end >= size { "1" } else { "0" })
        .body(Body::from(body))
        .unwrap()
}

/// The node on a free port: its address, a client for it and the shared state a test reads and changes.
async fn serve_fake(node: FakeNode) -> (String, Api, Fake) {
    let shared: Fake = Arc::new(Mutex::new(node));
    let app = Router::new()
        .route("/v1/runs", get(fake_runs))
        .route("/v1/runs/files", get(fake_files))
        .route("/v1/runs/file", get(fake_file))
        .with_state(shared.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let api = Api::new(&NodeEntry { url: url.clone(), token: None }).unwrap();
    (url, api, shared)
}

/// Bytes that differ from place to place, so a wrong offset shows.
fn pattern(len: usize, seed: u8) -> Vec<u8> {
    (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed).wrapping_add((i >> 8) as u8)).collect()
}

fn blob(data: Vec<u8>) -> FakeFile {
    FakeFile { data, mtime: 1_790_000_000.5, kind: FileKind::Blob }
}

fn whole(data: &[u8]) -> FakeFile {
    FakeFile { data: data.to_vec(), mtime: 1_790_000_000.5, kind: FileKind::Whole }
}

fn one_file(name: &str, f: FakeFile) -> FakeNode {
    FakeNode { files: BTreeMap::from([(name.to_string(), f)]), ..Default::default() }
}

fn entry_of(n: &Fake, name: &str) -> FileEntry {
    let n = n.lock().unwrap();
    let f = &n.files[name];
    FileEntry { name: name.into(), kind: f.kind, size: f.data.len() as u64, mtime: f.mtime }
}

fn requests(n: &Fake) -> Vec<(u64, Option<String>)> {
    n.lock().unwrap().requests.iter().map(|(_, from, held)| (*from, held.clone())).collect()
}

fn no_progress() -> impl FnMut(&Partial) -> Result<()> {
    |_| Ok(())
}

fn scratch_dir(tag: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-collector-s5-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

const BUNDLE: &str = "workspace.bundle";
fn run_ref() -> RunRef {
    RunRef::Path("combinations/a/benchmarks/p/r1".into())
}

// ---- lake.transfer.blob_files ----

#[tokio::test]
async fn a_blob_of_exactly_one_chunk_arrives_in_one_request_with_eof() {
    // TC-24
    let data = pattern(COLLECT_CHUNK_BYTES as usize, 1);
    let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
    let dir = scratch_dir("exact");
    let dest = dir.join(BUNDLE);
    let pulled = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
    assert_eq!(requests(&node).len(), 1);
    assert!(pulled.at_eof && pulled.bytes == data.len() as u64 && pulled.refetches == 0);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!partial_path(&dest).exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_blob_of_one_chunk_and_one_byte_arrives_in_two_requests() {
    // TC-25
    let data = pattern(COLLECT_CHUNK_BYTES as usize + 1, 2);
    let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
    let dir = scratch_dir("plus-one");
    let dest = dir.join(BUNDLE);
    pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
    // The second request names the identity the first carried.
    assert_eq!(requests(&node), [(0, None), (COLLECT_CHUNK_BYTES, Some("1790000000.500".to_string()))]);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_blob_of_zero_bytes_is_a_zero_byte_file_with_no_partial_left() {
    // TC-23 (the collector's half)
    let (_, api, node) = serve_fake(one_file(BUNDLE, blob(Vec::new()))).await;
    let dir = scratch_dir("zero");
    let dest = dir.join(BUNDLE);
    let pulled = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
    assert_eq!((pulled.bytes, pulled.at_eof), (0, true));
    assert_eq!(std::fs::metadata(&dest).unwrap().len(), 0);
    assert!(!partial_path(&dest).exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn the_final_name_appears_only_after_the_last_chunk_while_the_partial_holds_what_was_pulled() {
    // TC-17, TC-16 (three requests for ten MiB)
    let data = pattern(10 * 1024 * 1024, 3);
    let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
    let dir = scratch_dir("atomic");
    let dest = dir.join(BUNDLE);
    let part = partial_path(&dest);
    let mut seen: Vec<u64> = Vec::new();
    let mut progress = |p: &Partial| -> Result<()> {
        assert!(!dest.exists(), "the final name must not exist before the last chunk");
        assert_eq!(std::fs::metadata(&part).unwrap().len(), p.bytes, "the partial holds exactly what is recorded");
        assert_eq!((p.node_size, p.node_mtime), (data.len() as u64, 1_790_000_000.5));
        seen.push(p.bytes);
        Ok(())
    };
    pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut progress).await.unwrap();
    assert_eq!(requests(&node).len(), 3);
    assert_eq!(seen, [COLLECT_CHUNK_BYTES, 2 * COLLECT_CHUNK_BYTES, data.len() as u64]);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!part.exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_pass_killed_after_two_chunks_is_resumed_from_the_partial_and_ends_equal() {
    // TC-18
    let data = pattern(10 * 1024 * 1024, 4);
    let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
    let dir = scratch_dir("resume");
    let dest = dir.join(BUNDLE);
    // What the killed pass left: two chunks in the partial, and the record of them.
    let two = 2 * COLLECT_CHUNK_BYTES;
    std::fs::write(partial_path(&dest), &data[..two as usize]).unwrap();
    let resume = Partial { bytes: two, node_size: data.len() as u64, node_mtime: 1_790_000_000.5 };
    pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, Some(&resume), &mut no_progress()).await.unwrap();
    assert_eq!(requests(&node), [(two, Some("1790000000.500".to_string()))], "one request, from the partial's length");
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    // A partial longer than the record (the kill came after a chunk but before the note) is cut back to the record.
    let _ = std::fs::remove_file(&dest);
    std::fs::write(partial_path(&dest), &data[..(two + 17) as usize]).unwrap();
    pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, Some(&resume), &mut no_progress()).await.unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_partial_of_a_file_the_node_has_since_rewritten_is_discarded_and_the_file_fetched_from_the_start() {
    // TC-19 (the record no longer matches the manifest)
    let data = pattern(3 * 1024 * 1024, 5);
    let (_, api, node) = serve_fake(one_file(BUNDLE, blob(data.clone()))).await;
    let dir = scratch_dir("stale-partial");
    let dest = dir.join(BUNDLE);
    std::fs::write(partial_path(&dest), pattern(1000, 99)).unwrap();
    let stale = Partial { bytes: 1000, node_size: data.len() as u64, node_mtime: 1_790_000_000.4 };
    pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, Some(&stale), &mut no_progress()).await.unwrap();
    assert_eq!(requests(&node), [(0, None)]);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_file_rewritten_between_two_chunks_is_refused_with_a_conflict_and_the_copy_ends_equal_to_the_new_file() {
    // TC-19
    let old = pattern(6 * 1024 * 1024, 6);
    let new = pattern(5 * 1024 * 1024 + 123, 7);
    let mut fake = one_file(BUNDLE, blob(old));
    fake.rewrite = Some((1, BUNDLE.to_string(), new.clone()));
    let (_, api, node) = serve_fake(fake).await;
    let dir = scratch_dir("rewrite");
    let dest = dir.join(BUNDLE);
    let entry = entry_of(&node, BUNDLE);
    let pulled = pull_blob(&api, &run_ref(), &entry, &dest, None, &mut no_progress()).await.unwrap();
    assert_eq!(pulled.refetches, 1, "one refetch from 0");
    assert_eq!(std::fs::read(&dest).unwrap(), new);
    assert!(!partial_path(&dest).exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_node_that_reports_more_bytes_than_it_sends_makes_the_collector_discard_the_partial_and_fetch_again() {
    // TC-22
    let data = pattern(100, 8);
    let mut fake = one_file(BUNDLE, blob(data.clone()));
    fake.lie = 1;
    let (_, api, node) = serve_fake(fake).await;
    let dir = scratch_dir("short-once");
    let dest = dir.join(BUNDLE);
    let pulled = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap();
    assert_eq!(pulled.refetches, 1);
    assert_eq!(requests(&node).len(), 2);
    assert_eq!(std::fs::read(&dest).unwrap(), data);
    assert!(!partial_path(&dest).exists());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_node_that_keeps_reporting_a_wrong_size_fails_with_both_codes_and_leaves_no_file_under_the_real_name() {
    // TC-22, TC-21
    let mut fake = one_file(BUNDLE, blob(pattern(100, 9)));
    fake.lie = 1000;
    let (_, api, node) = serve_fake(fake).await;
    let dir = scratch_dir("short-always");
    let dest = dir.join(BUNDLE);
    let err = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap_err().to_string();
    assert!(err.contains(E_REFETCH_LIMIT) && err.contains(E_BLOB_SHORT), "{err}");
    assert!(!dest.exists() && !partial_path(&dest).exists());
    assert_eq!(requests(&node).len(), (MAX_REFETCHES_PER_PASS + 1) as usize);
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_blob_whose_node_file_changes_on_every_request_fails_and_the_lake_keeps_its_last_complete_copy() {
    // TC-21: the file is rewritten at every request, so every resume is refused.
    let last_good = pattern(50, 10);
    let dir = scratch_dir("limit");
    let dest = dir.join(BUNDLE);
    std::fs::write(&dest, &last_good).unwrap();
    let mut fake = one_file(BUNDLE, blob(pattern(5 * 1024 * 1024, 11)));
    fake.bump = true;
    let (_, api, node) = serve_fake(fake).await;
    let err = pull_blob(&api, &run_ref(), &entry_of(&node, BUNDLE), &dest, None, &mut no_progress()).await.unwrap_err().to_string();
    assert!(err.contains(E_REFETCH_LIMIT), "{err}");
    assert_eq!(std::fs::read(&dest).unwrap(), last_good, "the complete copy is untouched");
    assert!(!partial_path(&dest).exists(), "no partial of a file that keeps changing is left behind");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn a_collection_note_written_before_blobs_existed_loads_with_no_partial() {
    // TC-28
    let old = r#"{"node":"n","run":"r","job":null,"run_status":null,"job_state":null,"complete":false,"first_collected_at":1,"collected_at":2,"settled_at":null,
        "files":{"server.log":{"bytes":3,"node_size":3,"node_mtime":1.5,"at_eof":true,"pulled_at":2}},"dbench_version":"v"}"#;
    let c: Collection = serde_json::from_str(old).unwrap();
    assert_eq!(c.files["server.log"].partial, None);
    assert_eq!(c.files["server.log"].refetches, 0);
    assert_eq!(c.unlisted, 0);
}

#[test]
fn plan_skips_a_blob_the_lake_holds_resumes_a_matching_partial_and_starts_over_otherwise() {
    let blob_entry = |size: u64, mtime: f64| Manifest {
        run: "r".into(),
        job: None,
        run_status: None,
        job_state: None,
        files: vec![FileEntry { name: "workspace.bundle".into(), kind: FileKind::Blob, size, mtime }],
        unlisted: 0,
    };
    let held = |size: u64, mtime: f64| Collected { bytes: size, node_size: size, node_mtime: mtime, at_eof: true, pulled_at: 1, refetches: 0, partial: None };
    let action = |m: &Manifest, c: &Collection, final_len: u64, partial_len: u64| {
        plan(m, c, |n| if n == "workspace.bundle" { final_len } else if n == partial_name("workspace.bundle") { partial_len } else { 0 })[0].1
    };
    let mut local = Collection::default();
    // Nothing held: from the start.
    assert_eq!(action(&blob_entry(100, 2.0), &local, 0, 0), Action::Blob { resume_from: 0 });
    // Held, node unchanged: skipped. Node rewrote it (mtime or size): fetched again.
    local.files.insert("workspace.bundle".into(), held(100, 2.0));
    assert_eq!(action(&blob_entry(100, 2.0), &local, 100, 0), Action::Skip);
    assert_eq!(action(&blob_entry(100, 3.0), &local, 100, 0), Action::Blob { resume_from: 0 });
    assert_eq!(action(&blob_entry(120, 2.0), &local, 100, 0), Action::Blob { resume_from: 0 });
    // A zero-byte blob held is skipped too.
    let mut zero = Collection::default();
    zero.files.insert("workspace.bundle".into(), held(0, 2.0));
    assert_eq!(action(&blob_entry(0, 2.0), &zero, 0, 0), Action::Skip);
    // A partial whose recorded identity is the manifest's resumes from its recorded length, if the partial file holds that much.
    let mut part = Collection::default();
    part.files.insert("workspace.bundle".into(), Collected { bytes: 40, node_size: 100, node_mtime: 2.0, at_eof: false, pulled_at: 1, refetches: 0, partial: Some(Partial { bytes: 40, node_size: 100, node_mtime: 2.0 }) });
    assert_eq!(action(&blob_entry(100, 2.0), &part, 0, 40), Action::Blob { resume_from: 40 });
    assert_eq!(action(&blob_entry(100, 2.0), &part, 0, 55), Action::Blob { resume_from: 40 }, "longer is cut back to the record");
    assert_eq!(action(&blob_entry(100, 2.0), &part, 0, 39), Action::Blob { resume_from: 0 }, "shorter than recorded: start over");
    assert_eq!(action(&blob_entry(100, 4.0), &part, 0, 40), Action::Blob { resume_from: 0 }, "the node file changed");
    assert_eq!(action(&blob_entry(101, 2.0), &part, 0, 40), Action::Blob { resume_from: 0 });
}

#[test]
fn the_partial_file_sits_beside_the_final_name_and_starts_with_a_dot() {
    assert_eq!(partial_name("workspace.bundle"), ".workspace.bundle.partial");
    assert_eq!(partial_name("a/b/c.bin"), "a/b/.c.bin.partial");
    assert_eq!(partial_path(Path::new("/lake/n/r/stories/01/accept.json")), PathBuf::from("/lake/n/r/stories/01/.accept.json.partial"));
    // The collected rules never accept it, and the not-collected list names it.
    assert!(dbench::collect::parse_name(&partial_name("stories/01/accept.json")).is_none());
    assert!(matches!(dbench::collect::classify(&partial_name("stories/01/accept.json")), dbench::collect::Classification::NotCollected(..)));
}

// ---- lake.reference.collect_into_reference ----

#[test]
fn a_reference_run_goes_to_the_reference_folder_by_pack_stack_and_run_and_any_other_run_to_the_lake() {
    // TC-59, TC-60
    let (store, reference) = (Path::new("/lake"), Path::new("/ref"));
    assert_eq!(dest_dir(store, reference, "node-a", "benchmarks/reference/vidi/opus-5.5/v2-r1"), Some(PathBuf::from("/ref/vidi/opus-5.5/v2-r1")));
    assert_eq!(
        dest_dir(store, reference, "node-a", "combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/v2-r1"),
        Some(PathBuf::from("/lake/node-a/combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/v2-r1"))
    );
    // Boundary: dots and dashes in the stack name, and a pack other than vidi.
    assert_eq!(dest_dir(store, reference, "n", "benchmarks/reference/todoodle/sonnet-5.5-x.y/run-3"), Some(PathBuf::from("/ref/todoodle/sonnet-5.5-x.y/run-3")));
}

#[test]
fn a_reference_run_id_of_the_wrong_shape_has_no_destination() {
    // TC-61
    let (store, reference) = (Path::new("/lake"), Path::new("/ref"));
    for bad in [
        "benchmarks/reference/vidi/opus-5.5",
        "benchmarks/reference/vidi",
        "benchmarks/reference/",
        "benchmarks/reference/vidi/opus-5.5/v2-r1/extra",
        "benchmarks/reference/vidi/../v2-r1",
        "benchmarks/reference/../x/y",
        "benchmarks/reference/vidi/opus 5.5/v2-r1",
        "benchmarks/reference/vidi/opus-5.5/v2-r1/",
    ] {
        assert_eq!(dest_dir(store, reference, "n", bad), None, "{bad}");
    }
}

#[test]
fn a_reference_run_is_wanted_an_archived_one_is_not_and_the_run_narrowing_works_as_before() {
    // TC-62
    let reference = "benchmarks/reference/vidi/opus-5.5/v2-r1";
    let none = BTreeSet::new();
    assert!(wanted(reference, &[], &none));
    assert!(wanted(reference, &[reference.to_string()], &none));
    assert!(!wanted(reference, &["benchmarks/reference/vidi/opus-5.5/v2-r2".to_string()], &none));
    let archived = BTreeSet::from([reference.to_string()]);
    assert!(!wanted(reference, &[], &archived));
    assert!(!wanted(reference, &[reference.to_string()], &archived));
    assert!(wanted("combinations/a/benchmarks/vidi/v2-r1", &[], &archived));
}

#[test]
fn a_reference_run_takes_its_records_only_and_any_other_run_takes_both_classes() {
    assert_eq!(classes_for("benchmarks/reference/vidi/opus-5.5/v2-r1"), &[Class::Record]);
    assert_eq!(classes_for("combinations/a/benchmarks/p/r1"), &[Class::Record, Class::Raw]);
}

fn node_with_run_files(run: &str) -> FakeNode {
    let mut files = BTreeMap::new();
    files.insert("run.json".to_string(), whole(b"{}"));
    files.insert("metrics.json".to_string(), whole(b"{\"stories\":{}}"));
    files.insert("workspace.bundle".to_string(), blob(pattern(5000, 12)));
    files.insert("stories/01/agent-events.compact.jsonl.gz".to_string(), blob(pattern(3000, 13)));
    files.insert("stories/01/agent-events.jsonl".to_string(), FakeFile { data: pattern(2000, 14), mtime: 1_790_000_000.5, kind: FileKind::Append });
    files.insert("server.log".to_string(), FakeFile { data: pattern(500, 15), mtime: 1_790_000_000.5, kind: FileKind::Append });
    FakeNode { files, state: Some("finished"), runs: vec![run.to_string()], ..Default::default() }
}

fn cadence_with_grace(grace_secs: u64) -> Cadence {
    Cadence { running_poll: Duration::from_secs(10), finished_recheck: Duration::from_secs(3600), settle_grace: Duration::from_secs(grace_secs) }
}

#[tokio::test]
async fn the_note_of_a_reference_run_holds_the_full_id_and_the_node_and_a_second_node_updates_it_in_the_one_folder() {
    // TC-66, TC-68, TC-63 (records in, raw out)
    let run = "benchmarks/reference/vidi/opus-5.5/v2-r1";
    let (_, api, _) = serve_fake(node_with_run_files(run)).await;
    let root = scratch_dir("reference-note");
    let (store, reference) = (root.join("lake"), root.join("reference"));
    let dir = dest_dir(&store, &reference, "node-a", run).unwrap();
    collect_run(&api, "node-a", run, &dir, classes_for(run), &cadence_with_grace(0), 100).await.unwrap();
    let note = load_collection(&dir).unwrap();
    assert_eq!((note.run.as_str(), note.node.as_str()), (run, "node-a"));
    let mut held: Vec<&str> = note.files.keys().map(String::as_str).collect();
    held.sort_unstable();
    assert_eq!(held, ["metrics.json", "run.json", "stories/01/agent-events.compact.jsonl.gz", "workspace.bundle"], "records only");
    assert!(!dir.join("stories/01/agent-events.jsonl").exists() && !dir.join("server.log").exists());
    assert!(!store.join("node-a").exists(), "nothing of a reference run under the lake's node folders");
    // The same run seen on a second node: the same folder, the note now names the second node.
    let (_, api_b, _) = serve_fake(node_with_run_files(run)).await;
    let dir_b = dest_dir(&store, &reference, "node-b", run).unwrap();
    assert_eq!(dir, dir_b);
    collect_run(&api_b, "node-b", run, &dir_b, classes_for(run), &cadence_with_grace(0), 200).await.unwrap();
    let note = load_collection(&dir).unwrap();
    assert_eq!((note.run.as_str(), note.node.as_str(), note.first_collected_at), (run, "node-b", 100));
    std::fs::remove_dir_all(root).unwrap();
}

// ---- lake.collect.completeness ----

async fn pass_once(api: &Api, run: &str, dir: &Path, grace: u64, now: u64) -> RunSummary {
    collect_run(api, "n", run, dir, classes_for(run), &cadence_with_grace(grace), now).await.unwrap()
}

const COMBINATION_RUN: &str = "combinations/a/benchmarks/p/r1";

#[tokio::test]
async fn a_run_with_no_note_becomes_collecting_and_the_first_time_is_set() {
    // TC-69
    let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let dir = scratch_dir("first-pass");
    let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 100).await;
    let note = load_collection(&dir).unwrap();
    assert_eq!((note.first_collected_at, note.collected_at, note.complete), (100, 100, false));
    assert!(s.changed && s.pulled_files == 6, "{s:?}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_running_run_is_never_complete_however_long_it_waits() {
    // TC-70
    let mut node = node_with_run_files(COMBINATION_RUN);
    node.state = Some("started");
    let (_, api, _) = serve_fake(node).await;
    let dir = scratch_dir("running");
    for now in [100, 200, 100_000] {
        pass_once(&api, COMBINATION_RUN, &dir, 0, now).await;
        let note = load_collection(&dir).unwrap();
        assert!(!note.complete && note.settled_at.is_none(), "now {now}");
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_settled_run_with_every_file_held_waits_out_the_grace_then_completes_and_a_later_look_changes_nothing() {
    // TC-71, TC-73, TC-74 and the boundary: grace elapsed by one second less, and exactly.
    let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let dir = scratch_dir("settle");
    pass_once(&api, COMBINATION_RUN, &dir, 60, 100).await;
    let note = load_collection(&dir).unwrap();
    assert_eq!((note.settled_at, note.complete), (None, false), "a pass that pulled files has not yet seen the run held");
    // Everything is held now: this pass sees it settled.
    pass_once(&api, COMBINATION_RUN, &dir, 60, 110).await;
    let note = load_collection(&dir).unwrap();
    assert_eq!((note.settled_at, note.complete), (Some(110), false));
    pass_once(&api, COMBINATION_RUN, &dir, 60, 169).await;
    assert!(!load_collection(&dir).unwrap().complete, "one second short of the grace");
    pass_once(&api, COMBINATION_RUN, &dir, 60, 170).await;
    assert!(load_collection(&dir).unwrap().complete, "exactly the grace");
    // A look within the hour changes nothing and pulls nothing; an hourly look finds nothing and keeps it complete.
    let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 200).await;
    assert!(s.complete && !s.changed && s.pulled_files == 0);
    let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 170 + 3600).await;
    assert!(s.complete && !s.changed && s.pulled_files == 0, "{s:?}");
    assert!(load_collection(&dir).unwrap().complete);
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_grace_of_zero_completes_on_the_pass_that_sees_it_settled_twice_and_a_grace_of_one_second_needs_one_second() {
    let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let dir = scratch_dir("grace-boundary");
    pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
    pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
    assert!(load_collection(&dir).unwrap().settled_at.is_some());
    assert!(!load_collection(&dir).unwrap().complete, "the pass that first sees it settled only starts the grace");
    pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
    assert!(load_collection(&dir).unwrap().complete, "zero seconds elapsed, zero grace");
    std::fs::remove_dir_all(&dir).unwrap();
    let dir = scratch_dir("grace-one");
    pass_once(&api, COMBINATION_RUN, &dir, 1, 100).await;
    pass_once(&api, COMBINATION_RUN, &dir, 1, 100).await;
    pass_once(&api, COMBINATION_RUN, &dir, 1, 100).await;
    assert!(!load_collection(&dir).unwrap().complete, "zero seconds elapsed against a one second grace");
    pass_once(&api, COMBINATION_RUN, &dir, 1, 101).await;
    assert!(load_collection(&dir).unwrap().complete, "one second elapsed");
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_file_that_changes_on_the_node_after_the_run_settled_clears_the_settling() {
    // TC-72
    let (_, api, node) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let dir = scratch_dir("changed-in-grace");
    pass_once(&api, COMBINATION_RUN, &dir, 60, 100).await;
    pass_once(&api, COMBINATION_RUN, &dir, 60, 110).await;
    assert_eq!(load_collection(&dir).unwrap().settled_at, Some(110));
    {
        let mut n = node.lock().unwrap();
        let f = n.files.get_mut("run.json").unwrap();
        f.data = b"{\"changed\":true}".to_vec();
        f.mtime += 5.0;
    }
    let s = pass_once(&api, COMBINATION_RUN, &dir, 60, 120).await;
    let note = load_collection(&dir).unwrap();
    assert!(s.changed && note.settled_at.is_none() && !note.complete, "{note:?}");
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn an_outstanding_partial_blocks_completeness() {
    // TC-76
    let manifest = Manifest {
        run: "r".into(),
        job: None,
        run_status: Some(RunStatus { state: "finished".into(), at: None }),
        job_state: None,
        files: vec![FileEntry { name: "workspace.bundle".into(), kind: FileKind::Blob, size: 100, mtime: 2.0 }],
        unlisted: 0,
    };
    let mut local = Collection::default();
    let mut rec = Collected { bytes: 100, node_size: 100, node_mtime: 2.0, at_eof: true, pulled_at: 1, refetches: 0, partial: None };
    local.files.insert("workspace.bundle".into(), rec.clone());
    assert!(all_at_eof(&manifest, &local));
    rec.partial = Some(Partial { bytes: 40, node_size: 100, node_mtime: 2.0 });
    local.files.insert("workspace.bundle".into(), rec);
    assert!(!all_at_eof(&manifest, &local), "a partial outstanding");
}

#[tokio::test]
async fn an_old_node_with_no_runs_route_is_reported_with_its_code_and_an_unreachable_one_with_its() {
    // TC-79, TC-78 (the unit half)
    let (url, _, _) = serve_fake(FakeNode { runs_status: Some(404), ..Default::default() }).await;
    let ctx = Ctx { nodes: BTreeMap::from([("old".to_string(), NodeEntry { url, token: None })]), collect: Default::default(), json: false };
    let root = scratch_dir("old-node");
    let none = BTreeSet::new();
    let old = collect_node(&ctx, "old", Lake { store: &root, reference: &root }, &[], &none, &cadence_with_grace(0), 1).await;
    assert!(!old.reachable && old.problems.len() == 1 && old.problems[0].starts_with(E_NODE_OLD), "{:?}", old.problems);
    let ctx = Ctx { nodes: BTreeMap::from([("gone".to_string(), NodeEntry { url: "http://127.0.0.1:1".into(), token: None })]), collect: Default::default(), json: false };
    let gone = collect_node(&ctx, "gone", Lake { store: &root, reference: &root }, &[], &none, &cadence_with_grace(0), 1).await;
    assert!(!gone.reachable && gone.problems[0].starts_with(E_NODE_UNREACHABLE), "{:?}", gone.problems);
    assert!(std::fs::read_dir(&root).unwrap().next().is_none(), "the lake is left as it was");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_run_a_node_sends_that_is_not_a_run_path_is_reported_and_skipped() {
    // TC-82 (collect_node side), TC-61
    let root = Path::new("/lake");
    assert_eq!(dest_dir(root, root, "n", "a/b"), None);
    assert_eq!(dest_dir(root, root, "n", "benchmarks/reference/vidi/opus-5.5"), None);
}

#[test]
fn collection_json_has_no_error_reason_or_problem_field_even_with_blobs_and_unlisted_files() {
    // TC-80
    let mut c = Collection { node: "n".into(), run: "r".into(), unlisted: 3, ..Default::default() };
    c.files.insert("workspace.bundle".into(), Collected { bytes: 3, node_size: 9, node_mtime: 1.5, at_eof: false, pulled_at: 2, refetches: 1, partial: Some(Partial { bytes: 3, node_size: 9, node_mtime: 1.5 }) });
    let text = serde_json::to_string_pretty(&c).unwrap();
    for word in ["error", "reason", "problem", "fault"] {
        assert!(!text.contains(word), "{word}: {text}");
    }
    assert_eq!(serde_json::from_str::<Collection>(&text).unwrap(), c);
}

// ---- lake.layout.run_id_kept ----

fn golden_ids() -> Vec<String> {
    include_str!("../tests/fixtures/run-ids.txt").lines().filter(|l| !l.starts_with('#') && !l.is_empty()).map(String::from).collect()
}

#[test]
fn every_run_id_that_exists_today_has_its_expected_folder() {
    // TC-81, TC-85 (an id with -opencode is left as it is)
    let ids = golden_ids();
    assert_eq!(ids.len(), 71);
    let (store, reference) = (Path::new("/lake"), Path::new("/ref"));
    let mut opencode = 0;
    for id in &ids {
        let dir = dest_dir(store, reference, "node-a", id).unwrap_or_else(|| panic!("{id}"));
        match id.strip_prefix(REFERENCE_RUN_PREFIX) {
            Some(rest) => assert_eq!(dir, reference.join(rest), "{id}"),
            None => {
                assert_eq!(dir, store.join("node-a").join(id), "{id}");
                assert_eq!(store_dir(store, "node-a", id), Some(dir.clone()), "{id}");
            }
        }
        if id.contains("-opencode") {
            opencode += 1;
            assert!(dir.to_str().unwrap().contains("-opencode"), "{id}");
        }
    }
    assert!(opencode >= 1, "the set holds an OpenCode id");
}

#[test]
fn a_path_that_is_not_a_run_has_no_folder_and_nothing_is_written() {
    // TC-82, TC-83, TC-86
    let store = Path::new("/lake");
    for bad in ["a/b", "../x", "x", "", "combinations/a/benchmarks/p", "combinations/a/b/c/d", "combinations/a/benchmarks/p/r 1", "combinations/a/benchmarks/p/r1/", "/combinations/a/benchmarks/p/r1", "combinations/a/benchmarks/p/../r1"] {
        assert_eq!(store_dir(store, "node-a", bad), None, "{bad:?}");
        assert_eq!(dest_dir(store, store, "node-a", bad), None, "{bad:?}");
    }
    assert_eq!(store_dir(store, "a/b", "combinations/a/benchmarks/p/r1"), None);
    assert_eq!(store_dir(store, "", "combinations/a/benchmarks/p/r1"), None);
    assert_eq!(store_dir(store, "..", "combinations/a/benchmarks/p/r1"), None);
}

#[test]
fn the_longest_id_today_and_the_longest_the_rules_allow_have_folders_and_one_character_more_does_not() {
    // TC-82 boundary
    let store = Path::new("/lake");
    let longest = golden_ids().into_iter().max_by_key(|i| i.len()).unwrap();
    assert!(store_dir(store, "n", &longest).is_some());
    // 512 characters: segments of valid-id size filling the limit exactly.
    let head = "combinations/".to_string();
    let tail = "/benchmarks/p/r1";
    let filler = 512 - head.len() - tail.len();
    let seg = "s".repeat(dbench::ids::MAX_ID_LEN);
    let mut mid = String::new();
    while mid.len() + 1 + seg.len() <= filler {
        mid.push_str(&seg);
        mid.push('/');
    }
    let rest = filler.saturating_sub(mid.len());
    mid.push_str(&"t".repeat(rest));
    let id = format!("{head}{mid}{tail}");
    assert_eq!(id.len(), 512, "{}", id.len());
    assert!(store_dir(store, "n", &id).is_some());
    assert!(store_dir(store, "n", &format!("{id}x")).is_none());
}

#[tokio::test]
async fn the_note_of_a_combination_run_holds_its_id_and_the_lake_folder_is_store_node_id() {
    // TC-84
    let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let root = scratch_dir("layout");
    let dir = store_dir(&root, "n", COMBINATION_RUN).unwrap();
    pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
    assert_eq!(load_collection(&dir).unwrap().run, COMBINATION_RUN);
    assert!(root.join("n").join(COMBINATION_RUN).join("collection.json").is_file());
    std::fs::remove_dir_all(root).unwrap();
}

// ---- lake.collect.space_guard (the decision) ----

const ONE_GIB: u64 = BYTES_PER_GIB;

#[test]
fn free_space_far_above_the_margin_or_just_above_it_or_exactly_at_it_pulls() {
    // TC-90, TC-91, TC-92
    let margin = dbench::cli::DEFAULT_FREE_SPACE_MARGIN_GIB;
    assert_eq!(space_decision(Ok(100 * margin * ONE_GIB), margin), SpaceDecision::Pull);
    assert_eq!(space_decision(Ok(margin * ONE_GIB + 1), margin), SpaceDecision::Pull);
    assert_eq!(space_decision(Ok(margin * ONE_GIB), margin), SpaceDecision::Pull);
}

#[test]
fn one_byte_below_the_margin_holds_with_one_line_that_names_the_free_space_and_the_margin() {
    // TC-93
    let margin = dbench::cli::DEFAULT_FREE_SPACE_MARGIN_GIB;
    let free = margin * ONE_GIB - 1;
    match space_decision(Ok(free), margin) {
        SpaceDecision::Hold(line) => {
            assert!(line.contains(&free.to_string()) && line.contains(&(margin * ONE_GIB).to_string()), "{line}");
            assert!(!line.contains('\n'), "one line");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn free_space_that_cannot_be_read_holds_and_says_so_without_a_guessed_value() {
    // TC-94
    match space_decision(Err(std::io::Error::other("no such device")), 10) {
        SpaceDecision::Hold(line) => assert!(line.contains("could not read") && line.contains("no such device") && !line.contains("bytes free"), "{line}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_margin_is_a_setting_with_a_proposed_default_of_ten_gib() {
    // TC-98
    assert_eq!(space_decision(Ok(5 * ONE_GIB), 4), SpaceDecision::Pull);
    assert!(matches!(space_decision(Ok(5 * ONE_GIB), 6), SpaceDecision::Hold(_)));
    assert_eq!(dbench::cli::DEFAULT_FREE_SPACE_MARGIN_GIB, 10);
    assert_eq!(collect_args(&[]).free_space_margin_gib, 10);
    assert_eq!(collect_args(&["--free-space-margin-gib", "3"]).free_space_margin_gib, 3);
    assert_eq!(Config::default().free_space_margin_gib, 10);
}

#[test]
fn the_free_bytes_of_a_real_folder_are_read_and_of_a_missing_one_are_an_error() {
    let dir = scratch_dir("free");
    assert!(free_bytes(&dir).unwrap() > 0);
    assert!(free_bytes(&dir.join("not-there")).is_err());
    std::fs::remove_dir_all(dir).unwrap();
}

#[tokio::test]
async fn a_pass_that_holds_for_space_contacts_no_node_and_creates_no_file() {
    // TC-93 (the pass half)
    let (url, _, node) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let root = scratch_dir("hold");
    let ctx = Ctx { nodes: BTreeMap::from([("n".to_string(), NodeEntry { url, token: None })]), collect: Default::default(), json: false };
    let cfg = Config { store: root.join("lake"), reference: root.join("reference"), no_ingest: true, free_bytes: |_| Ok(0), ..Default::default() };
    let summaries = pass(&ctx, &cfg, &cadence_with_grace(0), false, 100).await.unwrap();
    assert!(summaries.is_empty());
    assert!(node.lock().unwrap().requests.is_empty());
    assert_eq!(std::fs::read_dir(root.join("lake")).unwrap().count(), 0, "nothing in the lake");
    // With the space back, the same pass pulls.
    let cfg = Config { free_bytes: |_| Ok(u64::MAX), ..cfg };
    let summaries = pass(&ctx, &cfg, &cadence_with_grace(0), false, 101).await.unwrap();
    assert_eq!(summaries[0].runs.len(), 1);
    assert!(root.join("lake/n").join(COMBINATION_RUN).join("collection.json").is_file());
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn the_collection_notes_and_the_lake_are_created_readable_by_the_owner_alone() {
    // TC-55 (the collector's half; the integration test checks a whole pass)
    use std::os::unix::fs::PermissionsExt;
    let (_, api, _) = serve_fake(node_with_run_files(COMBINATION_RUN)).await;
    let root = scratch_dir("modes");
    let dir = root.join("lake/n").join(COMBINATION_RUN);
    pass_once(&api, COMBINATION_RUN, &dir, 0, 100).await;
    let mut seen = 0;
    let mut stack = vec![root.join("lake")];
    while let Some(d) = stack.pop() {
        assert_eq!(std::fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o700, "{}", d.display());
        for e in std::fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else {
                assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600, "{}", p.display());
                seen += 1;
            }
        }
    }
    assert!(seen >= 6);
    std::fs::remove_dir_all(root).unwrap();
}

const MTIME: f64 = 1_790_000_000.123;

#[test]
fn a_blob_read_from_the_start_is_never_stale_whatever_it_names() {
    // TC-27, boundary: from 0 needs no identity (it is the first chunk, which carries the identity).
    assert!(!blob_stale(0, 10, MTIME, None));
    assert!(!blob_stale(0, 0, MTIME, None));
    assert!(!blob_stale(0, 10, MTIME, Some(1.0)));
}

#[test]
fn a_blob_read_from_past_the_end_is_stale() {
    // TC-27
    assert!(blob_stale(11, 10, MTIME, Some(MTIME)));
    assert!(blob_stale(1, 0, MTIME, Some(MTIME)));
}

#[test]
fn a_blob_read_from_past_zero_with_another_mtime_or_none_is_stale() {
    // TC-27
    assert!(blob_stale(5, 10, MTIME, Some(MTIME + 1.0)));
    assert!(blob_stale(5, 10, MTIME, None));
    assert!(!blob_stale(5, 10, MTIME, Some(MTIME)));
}

#[test]
fn a_blob_read_from_its_last_byte_is_fresh_and_from_exactly_the_size_too() {
    // TC-27, boundary
    assert!(!blob_stale(9, 10, MTIME, Some(MTIME)));
    assert!(!blob_stale(10, 10, MTIME, Some(MTIME)));
}

#[test]
fn the_mtime_is_compared_to_the_millisecond_the_headers_carry() {
    // The header text has three decimals; a client that sends it back must be taken as the same time.
    assert!(!blob_stale(5, 10, 1_790_000_000.123_4, Some(1_790_000_000.123)));
    assert!(blob_stale(5, 10, 1_790_000_000.123_6, Some(1_790_000_000.123)));
}
