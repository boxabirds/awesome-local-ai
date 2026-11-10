//! What reading the lake costs the collector, by bytes allocated (deterministic, unlike time).
//!
//! On 10 Nov 2026 the collector took most of a core on the owner's M2 for every pass that pulled anything. Its stacks were
//! mostly copies of one map: `LakeSource::read` cloned the whole list of the lake's record files to look up the one it
//! read, and the verdict step reads two files for each story of each run, so a pass copied the list hundreds of times. A
//! read must cost the same in a small lake and a large one.

use dbench::ingest::inputs::{LakeSource, Published};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};

/// Counts the bytes this thread allocates (tests run on several threads at once).
struct Counting;

thread_local! {
    static ALLOCATED: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATED.with(|a| a.set(a.get() + layout.size()));
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

fn allocated_by(f: impl FnOnce()) -> usize {
    let before = ALLOCATED.with(Cell::get);
    f();
    ALLOCATED.with(Cell::get) - before
}

const PACK_DIR: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi";
const STORIES: usize = 12;
const READS: usize = 50;
const SMALL_LAKE_RUNS: usize = 4;
const LARGE_LAKE_RUNS: usize = 80;
/// How much more a read may allocate in the large lake than in the small one: the lake is 20 times larger.
const MAX_GROWTH: f64 = 1.5;

fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

/// A lake of `runs` runs, each with a metrics file and two records per story.
fn lake(name: &str, runs: usize) -> PathBuf {
    let root = std::env::temp_dir().join(format!("dbench-lake-cost-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    for r in 1..=runs {
        let dir = root
            .join("state/collected/node-a")
            .join(format!("{PACK_DIR}/v2-r{r}"));
        write(
            &dir.join("collection.json"),
            br#"{"node":"node-a","complete":true,"collected_at":1.0,"files":{}}"#,
        );
        write(&dir.join("metrics.json"), br#"{"stories":{}}"#);
        for s in 1..=STORIES {
            write(
                &dir.join(format!("stories/{s:02}/accept-summary.json")),
                br#"{"passed":1,"total":1}"#,
            );
            write(
                &dir.join(format!("stories/{s:02}/agent-events.compact.jsonl.gz")),
                b"gz",
            );
        }
    }
    root
}

fn bytes_per_read(name: &str, runs: usize) -> usize {
    let root = lake(name, runs);
    let src = LakeSource::new(&root.join("state/collected"), &root.join("state/reference"));
    let path = format!("{PACK_DIR}/v2-r1/metrics.json");
    assert!(
        src.read(&path).unwrap().is_some(),
        "the file is in the lake"
    );
    let total = allocated_by(|| {
        for _ in 0..READS {
            src.read(&path).unwrap();
        }
    });
    let _ = fs::remove_dir_all(&root);
    total / READS
}

#[test]
fn a_read_costs_the_same_in_a_large_lake_as_in_a_small_one() {
    let small = bytes_per_read("small", SMALL_LAKE_RUNS);
    let large = bytes_per_read("large", LARGE_LAKE_RUNS);
    assert!(
        (large as f64) <= (small as f64) * MAX_GROWTH,
        "a read allocated {small} bytes in a lake of {SMALL_LAKE_RUNS} runs and {large} in one of {LARGE_LAKE_RUNS}: \
         it copies something the size of the lake"
    );
}

/// A lake of `runs` runs whose stories have raw logs, as the candidates step finds them.
fn lake_with_logs(name: &str, runs: usize) -> PathBuf {
    let root = lake(name, runs);
    for r in 1..=runs {
        let dir = root
            .join("state/collected/node-a")
            .join(format!("{PACK_DIR}/v2-r{r}"));
        for s in 1..=STORIES {
            write(
                &dir.join(format!("stories/{s:02}/agent-events.jsonl")),
                b"{}\n",
            );
        }
    }
    root
}

fn bytes_per_run_for_candidates(name: &str, runs: usize) -> usize {
    use dbench::ingest::inputs::{candidates, lake_runs};
    let root = lake_with_logs(name, runs);
    let store = root.join("state/collected");
    let src = LakeSource::new(&store, &root.join("state/reference"));
    let lake = lake_runs(&store).unwrap();
    let archived = Default::default();
    src.paths().unwrap(); // the lake's list is built once per source; what is measured is what the step does with it
    let (found, bytes) = {
        let before = ALLOCATED.with(Cell::get);
        let found = candidates(&src, &archived, &lake).unwrap();
        (found, ALLOCATED.with(Cell::get) - before)
    };
    assert_eq!(
        found.len(),
        runs * STORIES,
        "every story with a log is a candidate"
    );
    let _ = fs::remove_dir_all(&root);
    bytes / runs
}

/// 10 Nov 2026: for each run in the lake, the candidates step asked whether anything was published under the run's
/// name by going through every published path, formatting a string for each: about 1 s of every collector pass.
#[test]
fn finding_the_candidates_costs_the_same_per_run_in_a_large_lake_as_in_a_small_one() {
    let small = bytes_per_run_for_candidates("cand-small", SMALL_LAKE_RUNS);
    let large = bytes_per_run_for_candidates("cand-large", LARGE_LAKE_RUNS);
    assert!(
        (large as f64) <= (small as f64) * MAX_GROWTH,
        "{small} bytes a run in a lake of {SMALL_LAKE_RUNS} runs, {large} in one of {LARGE_LAKE_RUNS}: each run goes through the whole lake"
    );
}
