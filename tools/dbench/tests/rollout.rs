//! Story 23 (rollout.per_machine), TC-B0: a mixed fleet while nodes move to story 23's dbench one at a time.
//!
//! Node A still runs the old dbench: it offers every run in its checkout, its own and the copies git carried to it, the
//! old `workspace.bundle` among their files, and has no code route. Node B runs the new one (the real `dbench serve`):
//! it offers only the run it ran. After one collector pass over each and an ingest, every run is in the warehouse once,
//! from the copy on the node that ran it, and bench-lake (what the benchmarker loads) names each once too. No bundle
//! reaches the lake. TC-B2 (a node without the code route) is code_pull.rs's.

use axum::extract::Query;
use axum::routing::get;
use axum::Json;
use dbench::client::{Ctx, NodeEntry};
use std::collections::{BTreeMap, HashMap};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant};

const COMBINATION: &str = "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi";
/// The run node A ran.
const RUN_A: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1";
/// The run node B ran; git carried a copy of its records to node A.
const RUN_B: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r2";
const NODE_A: &str = "node-old";
const NODE_B: &str = "node-new";
const INSTALL_ID: &str = "rollout-install";
const TOKEN: &str = "t";
const COMPACT_LOG: &str = "stories/01/agent-events.compact.jsonl.gz";
const RAW_LOG: &str = "stories/01/agent-events.jsonl";
const BUNDLE: &str = "workspace.bundle";
const SERVER_STOP_DEADLINE: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(100);

fn tmp() -> PathBuf {
    let d = std::env::temp_dir().join(format!("dbench-rollout-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d.canonicalize().unwrap()
}

fn gzip(text: &str) -> Vec<u8> {
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(text.as_bytes()).unwrap();
    enc.finish().unwrap()
}

/// A real agent stream from the harness's fixtures, compacted as a story's record.
fn compact_log() -> Vec<u8> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../benchmarks/spec-bench/harness/fixtures/accounting/claude-slept.jsonl");
    gzip(&std::fs::read_to_string(&path).unwrap())
}

fn run_json(run: &str) -> Vec<u8> {
    format!(r#"{{"pack_version": "vidi-v2", "model_id": "m", "started_at": "2026-10-02T09:00:00Z", "note": "{run}"}}"#)
        .into_bytes()
}

/// The files of a run as a node's checkout holds them: the records, and for the node that ran it a raw log too.
fn files(run: &str, own: bool) -> BTreeMap<String, Vec<u8>> {
    let mut f = BTreeMap::from([
        ("run.json".to_string(), run_json(run)),
        (COMPACT_LOG.to_string(), compact_log()),
        (BUNDLE.to_string(), b"bundle bytes".to_vec()),
    ]);
    if own {
        f.insert(RAW_LOG.to_string(), b"{}\n".to_vec());
    }
    f
}

/// Node A, the old dbench: lists every run it has, each with every file it has, and has no code route (404, no body).
async fn old_node(runs: BTreeMap<&'static str, BTreeMap<String, Vec<u8>>>) -> String {
    let runs = Arc::new(runs);
    let (r1, r2, r3) = (runs.clone(), runs.clone(), runs.clone());
    let app = axum::Router::new()
        .route(
            "/v1/runs",
            get(move || {
                let list: Vec<_> = r1
                    .keys()
                    .map(|r| serde_json::json!({"run": r, "job": null, "run_status": null, "job_state": null}))
                    .collect();
                std::future::ready(Json(serde_json::Value::Array(list)))
            }),
        )
        .route(
            "/v1/runs/scopes",
            get(move |Query(q): Query<HashMap<String, String>>| {
                let run = q.get("run").cloned().unwrap_or_default();
                let files: Vec<_> = r2[run.as_str()]
                    .iter()
                    .map(|(n, b)| serde_json::json!({"name": n, "size": b.len(), "mtime": 1.0, "final": true}))
                    .collect();
                std::future::ready(Json(
                    serde_json::json!({"run": run, "job": null, "run_state": "finished",
                    "job_state": null, "final": true, "files": files, "streams": [], "stories": []}),
                ))
            }),
        )
        .route(
            "/v1/runs/scope-file",
            get(move |Query(q): Query<HashMap<String, String>>| {
                let body = r3[q["run"].as_str()][&q["name"]].clone();
                let size = body.len().to_string();
                std::future::ready((
                    [
                        ("x-dbench-from", "0".to_string()),
                        ("x-dbench-size", size),
                        ("x-dbench-mtime", "1.0".to_string()),
                        ("x-dbench-eof", "1".to_string()),
                        ("x-dbench-final", "1".to_string()),
                    ],
                    body,
                ))
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

struct Server {
    child: Child,
    base: String,
    token: String,
}

impl Drop for Server {
    fn drop(&mut self) {
        // SAFETY: kill(2) on our own child's pid; SIGTERM so a coverage profile is written.
        unsafe { libc::kill(self.child.id() as i32, libc::SIGTERM) };
        let start = Instant::now();
        while matches!(self.child.try_wait(), Ok(None)) && start.elapsed() < SERVER_STOP_DEADLINE {
            std::thread::sleep(POLL);
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// Node B, the new dbench: the real server over a checkout holding the run it ran (work_dir.txt marks it its own).
fn new_node(root: &Path) -> Server {
    let repo = root.join("node-b/repo");
    let comb = repo.join("combinations").join(COMBINATION);
    std::fs::create_dir_all(&comb).unwrap();
    std::fs::write(comb.join("config.sh"), format!("INSTALL_ID=\"{INSTALL_ID}\"\n")).unwrap();
    let run = repo.join(RUN_B);
    for (name, bytes) in files(RUN_B, true) {
        let f = run.join(&name);
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(f, bytes).unwrap();
    }
    std::fs::write(run.join("work_dir.txt"), "/home/x/.w/v2-r2\n").unwrap();
    let share = root.join("node-b/userhome/.local/share");
    std::fs::create_dir_all(share.join(INSTALL_ID)).unwrap();
    std::fs::write(
        share.join(INSTALL_ID).join("install.env"),
        format!("INSTALL_ID=\"{INSTALL_ID}\"\nCOMBINATION=\"{COMBINATION}\"\n"),
    )
    .unwrap();
    let home = root.join("node-b/dbench-home");
    let mut child = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(["serve", "--bind", "127.0.0.1:0", "--no-pull", "--allow-unreleased"])
        .arg("--repo")
        .arg(&repo)
        .arg("--home")
        .arg(&home)
        .arg("--share-dir")
        .arg(&share)
        .env("HOME", root.join("node-b/userhome"))
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn dbench");
    let mut line = String::new();
    BufReader::new(child.stdout.take().unwrap())
        .read_line(&mut line)
        .unwrap();
    let addr = line
        .trim()
        .strip_prefix(dbench::server::LISTENING_PREFIX)
        .unwrap_or_else(|| panic!("{line:?}"))
        .to_string();
    let token = std::fs::read_to_string(home.join("token")).unwrap().trim().to_string();
    Server {
        child,
        base: format!("http://{addr}"),
        token,
    }
}

fn cadence() -> dbench::collector::Cadence {
    dbench::collector::Cadence {
        running_poll: Duration::ZERO,
        finished_recheck: Duration::ZERO,
        settle_grace: Duration::ZERO,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn tc_b0_a_mixed_fleet_gives_each_run_once_from_the_node_that_ran_it_and_no_bundle() {
    let root = tmp();
    let a = old_node(BTreeMap::from([
        (RUN_A, files(RUN_A, true)),
        (RUN_B, files(RUN_B, false)),
    ]))
    .await;
    let b = new_node(&root);
    let ctx = Ctx {
        nodes: BTreeMap::from([
            (
                NODE_A.to_string(),
                NodeEntry {
                    url: a,
                    token: Some(TOKEN.into()),
                },
            ),
            (
                NODE_B.to_string(),
                NodeEntry {
                    url: b.base.clone(),
                    token: Some(b.token.clone()),
                },
            ),
        ]),
        collect: Default::default(),
        json: false,
    };
    let state = root.join("state");
    let store = state.join("collected");
    let lake = dbench::collector::Lake {
        store: &store,
        reference: &state.join("reference"),
    };
    for node in [NODE_A, NODE_B] {
        dbench::collector::collect_node_with(&ctx, node, lake, &[], &Default::default(), &cadence(), 1, true).await;
    }
    // The lake: A's run and the copy git carried to A under A, B's run under B; no bundle from either.
    for (node, run) in [(NODE_A, RUN_A), (NODE_A, RUN_B), (NODE_B, RUN_B)] {
        let dir = dbench::collector::store_dir(&store, node, run).unwrap();
        assert_eq!(
            std::fs::read(dir.join("run.json")).unwrap(),
            run_json(run),
            "{node} {run}"
        );
        assert!(!dir.join(BUNDLE).exists(), "{node} {run}: the bundle is not collected");
    }
    assert!(!dbench::collector::store_dir(&store, NODE_B, RUN_A).unwrap().exists());

    // The ingest: each run once in the warehouse, from the copy with the raw logs (B's for RUN_B).
    let db_path = root.join("insights/conversations.db");
    let checkout = root.join("checkout");
    std::fs::create_dir_all(&checkout).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args([
            "ingest",
            "--db",
            db_path.to_str().unwrap(),
            "--repo",
            checkout.to_str().unwrap(),
        ])
        .args(["--store", store.to_str().unwrap()])
        .output()
        .unwrap();
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    let db = dbench::ingest::db::Db::open_read_only(&db_path).unwrap();
    let mut stmt = db.conn.prepare("select id, node from runs order by id").unwrap();
    let rows: Vec<(String, Option<String>)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        rows,
        vec![
            (RUN_A.to_string(), Some(NODE_A.to_string())),
            (RUN_B.to_string(), Some(NODE_B.to_string()))
        ]
    );
    let stories: i64 = db
        .conn
        .query_row("select count(*) from stories", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stories, 2, "one story per run, not one per copy");
    drop(stmt);
    drop(db);

    // bench-lake, which the benchmarker loads: two runs, RUN_B's preferred copy the one on B.
    let bl = bench_lake::Lake::in_state_dir(&state);
    let d = bl.discover();
    let ids: std::collections::BTreeSet<&str> = d.runs.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, [RUN_A, RUN_B].into_iter().collect());
    assert_eq!(bl.preferred(&d, RUN_B).unwrap().node.as_deref(), Some(NODE_B));
    assert_eq!(bl.preferred(&d, RUN_A).unwrap().node.as_deref(), Some(NODE_A));
    drop(b);
    let _ = std::fs::remove_dir_all(&root);
}
