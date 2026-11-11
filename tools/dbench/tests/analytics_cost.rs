//! What an analytics pass costs when nothing changed, by bytes allocated (deterministic, unlike time).
//!
//! On 10 Nov 2026 every collector pass that ingested anything ran the analytics over all 673 story runs, and each one
//! loaded all its calls, thinking text included, only to count them for the digest that says it is unchanged:
//! `analytics.load_calls` was 5-7 s of a 25 s pass on the owner's M2. An unchanged story run is counted, not loaded.

use dbench::analytics::{run_on, store::Store, Selection};
use dbench::ingest::db::Db;
use rusqlite::params;
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

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

fn allocated_by<T>(f: impl FnOnce() -> T) -> (T, usize) {
    let before = ALLOCATED.with(Cell::get);
    let out = f();
    (out, ALLOCATED.with(Cell::get) - before)
}

const RUN_DIR: &str = "combinations/x/y/z/os/m/llamacpp-pi/benchmarks/vidi/v2-r1";
const STORIES: i64 = 4;
const CALLS: i64 = 20;
const THINK_CHARS: usize = 50_000;
/// An unchanged pass may allocate at most this share of the thinking text the warehouse holds.
const MAX_SHARE_OF_TEXT: f64 = 0.05;

fn warehouse() -> Db {
    let db = Db::open_memory().unwrap();
    db.conn
        .execute("insert into runs(id) values (?1)", params![RUN_DIR])
        .unwrap();
    let think = "a long thought about the board ".repeat(THINK_CHARS / 31 + 1);
    for n in 1..=STORIES {
        let rel = format!("{RUN_DIR}/stories/{n:02}");
        db.conn
            .execute("insert into stories(rel, run_id, stack, run, story) values (?1, ?2, 'x/y/z/os/m/llamacpp-pi', 'v2-r1', ?3)", params![rel, RUN_DIR, n])
            .unwrap();
        let sk = db.conn.last_insert_rowid();
        db.conn
            .execute(
                "insert into msgs(sk, idx, role, text_full) values (?1, 0, 'user', 'the task')",
                params![sk],
            )
            .unwrap();
        db.conn
            .execute(
                "insert into collection(sk, inputs_digest) values (?1, 'd1')",
                params![sk],
            )
            .unwrap();
        for idx in 0..CALLS {
            db.conn
                .execute(
                    "insert into calls(sk, idx, rx, sent, think, in_tok, cache_tok, out_tok, n_tools, stop, think_full) values (?1,?2,?3,?4,?5,100,900,50,0,'stop',?6)",
                    params![sk, idx, idx as f64 + 1.0, idx as f64, think.len() as i64, think],
                )
                .unwrap();
        }
    }
    db
}

#[test]
fn a_pass_over_unchanged_story_runs_does_not_load_their_calls() {
    let db = warehouse();
    let mut store = Store::open_memory().unwrap();
    let first = run_on(&db.conn, &mut store, &Selection::default(), 1000.0).unwrap();
    assert_eq!(first.computed, STORIES as usize);
    let (again, bytes) =
        allocated_by(|| run_on(&db.conn, &mut store, &Selection::default(), 2000.0).unwrap());
    assert_eq!(
        (again.computed, again.unchanged),
        (0, STORIES as usize),
        "nothing changed"
    );
    let text = (STORIES * CALLS) as usize * THINK_CHARS;
    assert!(
        (bytes as f64) <= text as f64 * MAX_SHARE_OF_TEXT,
        "a pass that changed nothing allocated {bytes} bytes against {text} bytes of thinking text: it loaded the calls"
    );
}

// ---- the purge ----
//
// 11 Nov 2026: every analytics pass began by purging reference and orphaned story runs, with a delete per table whose
// `rel like '%benchmarks/reference/%'` could not use the index, so it read every row of call_context and think_text:
// 1.4-5.7 s of each pass on the owner's M2, where the collector runs in the background class, to remove nothing. The
// purge must cost what the number of story runs costs, not the number of rows.

const PURGE_STORIES: usize = 6;
const FEW_ROWS: usize = 20;
const MANY_ROWS: usize = 400;
/// How much more the purge may cost with 20 times the rows.
const MAX_PURGE_GROWTH: f64 = 1.5;

/// SQLite virtual-machine steps the purge takes on the analytics store, with `rows` call rows for each story run.
fn purge_steps(rows: usize) -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    let wh = Db::open_memory().unwrap();
    let store = Store::open_memory().unwrap();
    wh.conn.execute("insert into runs(id) values (?1)", params![RUN_DIR]).unwrap();
    for n in 1..=PURGE_STORIES {
        let rel = format!("{RUN_DIR}/stories/{n:02}");
        wh.conn
            .execute("insert into stories(rel, run_id, stack, run, story) values (?1, ?2, 'x/y/z/os/m/llamacpp-pi', 'v2-r1', ?3)", params![rel, RUN_DIR, n as i64])
            .unwrap();
        store.conn.execute("insert into analytics_story(rel, stack) values (?1, 'x/y/z/os/m/llamacpp-pi')", params![rel]).unwrap();
        for idx in 0..rows {
            store.conn.execute("insert into call_context(rel, idx) values (?1, ?2)", params![rel, idx as i64]).unwrap();
            store.conn.execute("insert into think_text(rel, idx) values (?1, ?2)", params![rel, idx as i64]).unwrap();
        }
    }
    let steps = Arc::new(AtomicU64::new(0));
    let counter = Arc::clone(&steps);
    store.conn.progress_handler(1, Some(move || {
        counter.fetch_add(1, Ordering::Relaxed);
        false
    }));
    assert_eq!(dbench::analytics::purge(&wh.conn, &store).unwrap(), 0, "nothing to remove");
    store.conn.progress_handler(1, None::<fn() -> bool>);
    assert_eq!(store.count("call_context").unwrap(), (PURGE_STORIES * rows) as i64, "nothing removed");
    steps.load(Ordering::Relaxed)
}

#[test]
fn a_purge_that_removes_nothing_costs_the_same_however_many_calls_the_story_runs_have() {
    let few = purge_steps(FEW_ROWS);
    let many = purge_steps(MANY_ROWS);
    assert!(
        (many as f64) <= (few as f64) * MAX_PURGE_GROWTH,
        "the purge took {few} SQLite steps with {FEW_ROWS} calls a story run and {many} with {MANY_ROWS}: it reads every row"
    );
}
