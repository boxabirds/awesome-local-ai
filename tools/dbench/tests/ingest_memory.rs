// Ingesting a story never holds its log whole. Its own test binary, so the peak of the children it waits for is only
// the ingest's.
//
// 30 Oct 2026: the collector reached 967 MB (1.7 GB in Activity Monitor). A 208 MB log was read whole and decoded into a
// second copy: 433 MB before parsing began, 488 MB at the peak.

use std::path::PathBuf;

const RUN: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1";
/// How many times the recorded pi stream is repeated to make a large log.
const REPEATS: usize = 500;

fn fixture(rel: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/spec-bench/harness/fixtures").join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The largest resident size of any child this process has waited for, in bytes.
fn peak_child_rss() -> u64 {
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::getrusage(libc::RUSAGE_CHILDREN, &mut ru) }, 0);
    // macOS gives bytes, Linux kibibytes.
    let unit = if cfg!(target_os = "macos") { 1 } else { 1024 };
    ru.ru_maxrss as u64 * unit
}

#[test]
fn ingesting_a_large_log_peaks_below_the_size_of_the_log() {
    let root = std::env::temp_dir().join(format!("dbench-ingest-memory-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let lake = root.join("store/node-a").join(RUN);
    std::fs::create_dir_all(lake.join("stories/01")).unwrap();
    std::fs::create_dir_all(root.join("repo")).unwrap();
    let log = fixture("events/pi/agent-events.jsonl").repeat(REPEATS);
    std::fs::write(lake.join("stories/01/agent-events.jsonl"), &log).unwrap();
    std::fs::write(lake.join("collection.json"), r#"{"node": "node-a", "complete": true, "collected_at": 1790001000.0}"#).unwrap();

    let db = root.join("insights/conversations.db");
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_dbench"))
        .args(["--json", "ingest", "--worktree", "--rebuild"])
        .arg("--db").arg(&db)
        .arg("--repo").arg(root.join("repo"))
        .arg("--store").arg(root.join("store"))
        .output()
        .unwrap();
    assert!(out.status.success(), "{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let summary: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(summary["ingested"].as_u64(), Some(1), "{summary}");

    let peak = peak_child_rss();
    let size = log.len() as u64;
    eprintln!("log {} MB, ingest peak {} MB", size >> 20, peak >> 20);
    std::fs::remove_dir_all(&root).unwrap();
    assert!(peak < size, "ingesting a {} MB log peaked at {} MB: the log was held whole", size >> 20, peak >> 20);
}
