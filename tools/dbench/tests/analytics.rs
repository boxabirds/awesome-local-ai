//! The thinking analytics (src/analytics) over an in-memory warehouse: what a story run's rows say, and that a run
//! recomputes exactly what changed.

use dbench::analytics::{run_on, store::Store, think_rows, context::CallIn, Selection, ANALYTICS_VERSION};
use dbench::ingest::db::Db;
use rusqlite::{params, Connection};

const REL: &str = "combinations/x/y/z/os/m/llamacpp-pi/benchmarks/vidi/v2-r1/stories/03";
const OTHER: &str = "combinations/x/y/z/os/m/llamacpp-pi/benchmarks/vidi/v2-r1/stories/04";
const TASK: &str = "implement the shared board so that several people see each other's edits appear live on the same board";

const RUN_DIR: &str = "combinations/x/y/z/os/m/llamacpp-pi/benchmarks/vidi/v2-r1";

fn story(wh: &Connection, rel: &str, n: i64) -> i64 {
    wh.execute("insert or ignore into runs(id) values (?1)", params![RUN_DIR]).unwrap();
    wh.execute("insert into stories(rel, run_id, stack, run, story) values (?1, ?3, 'x/y/z/os/m/llamacpp-pi', 'v2-r1', ?2)", params![rel, n, RUN_DIR]).unwrap();
    let sk = wh.last_insert_rowid();
    wh.execute("insert into msgs(sk, idx, role, text_full) values (?1, 0, 'user', ?2)", params![sk, TASK]).unwrap();
    wh.execute("insert into collection(sk, inputs_digest) values (?1, 'd1')", params![sk]).unwrap();
    sk
}

fn call(wh: &Connection, sk: i64, idx: i64, sent: f64, rx: f64, think: Option<&str>) {
    wh.execute(
        "insert into calls(sk, idx, rx, sent, think, in_tok, cache_tok, out_tok, n_tools, stop, think_full) values (?1,?2,?3,?4,?5,100,900,50,1,'toolUse',?6)",
        params![sk, idx, rx, sent, think.map_or(0, |t| t.chars().count() as i64), think],
    )
    .unwrap();
}

fn tool(wh: &Connection, sk: i64, call_idx: i64, idx: i64, res: &str) {
    wh.execute("insert into tools(sk, call_idx, idx, name, kind, start, end, res_full, res_chars) values (?1,?2,?3,'bash','unit',1.0,2.0,?4,?5)", params![sk, call_idx, idx, res, res.len() as i64]).unwrap();
}

fn warehouse() -> Db {
    let db = Db::open_memory().unwrap();
    let sk = story(&db.conn, REL, 3);
    call(&db.conn, sk, 0, 100.0, 110.0, Some(&format!("I need to {TASK} and then plan the work carefully step by step"))); // restates the task
    tool(&db.conn, sk, 0, 0, "test failed because the websocket connection was refused by the local server again");
    call(&db.conn, sk, 1, 112.0, 120.0, Some("the websocket connection was refused by the local server again so check the port")); // quotes the result
    call(&db.conn, sk, 2, 121.0, 130.0, None); // no thinking
    call(&db.conn, sk, 3, 131.0, 140.0, Some("the websocket connection was refused by the local server again so check the port")); // repeats call 1
    db.conn.execute("insert into compactions(sk, start, end) values (?1, 125.0, 126.0)", params![sk]).unwrap();
    db
}

fn dump(s: &Store) -> Vec<String> {
    let mut out = Vec::new();
    for sql in [
        "select rel, idx, frac, t_s, gap_s, dur_s, context_tok, compactions_before, since_compaction, after_compaction, prev_tool_kinds, prev_res_chars from call_context order by rel, idx",
        "select rel, idx, chars, words, gzip_ratio, repeat5, prompt_overlap, result_overlap, prev_sim, max_prev_sim from think_text order by rel, idx",
        "select rel, n_calls, think_chars, source_digest, version from analytics_story order by rel",
    ] {
        let mut q = s.conn.prepare(sql).unwrap();
        let n = q.column_count();
        let rows = q.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap();
        out.extend(rows.map(Result::unwrap));
    }
    out
}

#[test]
fn a_story_run_gets_one_context_row_per_call_and_one_text_row_per_call_with_thinking() {
    let db = warehouse();
    let mut s = Store::open_memory().unwrap();
    let sum = run_on(&db.conn, &mut s, &Selection::default(), 1000.0).unwrap();
    assert_eq!((sum.stories, sum.computed, sum.unchanged, sum.calls, sum.think_blocks), (1, 1, 0, 4, 3));
    assert_eq!((s.count("call_context").unwrap(), s.count("think_text").unwrap(), s.count("analytics_story").unwrap()), (4, 3, 1));
    // The compaction ended at 126: calls sent at 100, 112, 121 are before it; call 3 (131) is the first after.
    let after: Vec<i64> = s.conn.prepare("select after_compaction from call_context order by idx").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    assert_eq!(after, vec![0, 0, 0, 1]);
}

#[test]
fn thinking_is_set_against_the_task_the_tool_result_and_its_own_earlier_thinking() {
    let db = warehouse();
    let mut s = Store::open_memory().unwrap();
    run_on(&db.conn, &mut s, &Selection::default(), 1000.0).unwrap();
    let row = |idx: i64| -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
        s.conn.query_row("select prompt_overlap, result_overlap, prev_sim, max_prev_sim from think_text where idx = ?1", params![idx], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap()
    };
    let (task0, res0, prev0, max0) = row(0);
    assert!(task0.unwrap() > 0.3, "call 0 restates the task: {task0:?}");
    assert_eq!((res0, prev0, max0), (None, None, None)); // the first call: no earlier call, no earlier thinking
    let (task1, res1, prev1, _) = row(1);
    assert_eq!(task1, Some(0.0));
    assert!(res1.unwrap() > 0.5, "call 1 quotes the previous call's tool result: {res1:?}");
    assert!(prev1.unwrap() < 0.2);
    // Call 3 repeats call 1 word for word; call 2 had no thinking, so "the previous block" is call 1.
    let (_, res3, prev3, max3) = row(3);
    assert_eq!((prev3, max3), (Some(1.0), Some(1.0)));
    assert_eq!(res3, None); // call 2 ran no tool
}

#[test]
fn unchanged_story_runs_are_skipped_and_a_changed_one_is_recomputed() {
    let db = warehouse();
    let mut s = Store::open_memory().unwrap();
    run_on(&db.conn, &mut s, &Selection::default(), 1000.0).unwrap();
    let again = run_on(&db.conn, &mut s, &Selection::default(), 2000.0).unwrap();
    assert_eq!((again.computed, again.unchanged), (0, 1));
    // The story is still being appended to: a new call.
    call(&db.conn, 1, 4, 141.0, 150.0, Some("one more thought about the board"));
    let grown = run_on(&db.conn, &mut s, &Selection::default(), 3000.0).unwrap();
    assert_eq!((grown.computed, grown.unchanged, grown.calls), (1, 0, 5));
    assert_eq!(s.count("call_context").unwrap(), 5); // replaced, not added to
    // The warehouse's own digest of the inputs changed (a re-ingest from a longer log).
    db.conn.execute("update collection set inputs_digest = 'd2'", []).unwrap();
    assert_eq!(run_on(&db.conn, &mut s, &Selection::default(), 4000.0).unwrap().computed, 1);
}

#[test]
fn another_version_recomputes_everything() {
    let db = warehouse();
    let mut s = Store::open_memory().unwrap();
    run_on(&db.conn, &mut s, &Selection::default(), 1000.0).unwrap();
    s.conn.execute("update analytics_story set version = ?1", params![ANALYTICS_VERSION - 1]).unwrap();
    assert_eq!(run_on(&db.conn, &mut s, &Selection::default(), 2000.0).unwrap().computed, 1);
    assert_eq!(run_on(&db.conn, &mut s, &Selection { all: true, only: vec![] }, 3000.0).unwrap().computed, 1);
}

#[test]
fn a_rebuild_is_what_an_incremental_run_holds() {
    let db = warehouse();
    let sk2 = story(&db.conn, OTHER, 4);
    call(&db.conn, sk2, 0, 200.0, 210.0, Some("a different story entirely with its own thoughts about drawing shapes and arrows"));
    let mut incremental = Store::open_memory().unwrap();
    run_on(&db.conn, &mut incremental, &Selection::default(), 1000.0).unwrap();
    call(&db.conn, 1, 4, 141.0, 150.0, Some("late thought"));
    run_on(&db.conn, &mut incremental, &Selection::default(), 2000.0).unwrap();
    let mut fresh = Store::open_memory().unwrap();
    run_on(&db.conn, &mut fresh, &Selection::default(), 2000.0).unwrap();
    assert_eq!(dump(&incremental), dump(&fresh));
}

#[test]
fn only_selects_a_story_run_or_every_story_of_a_run() {
    let db = warehouse();
    story(&db.conn, OTHER, 4);
    let mut s = Store::open_memory().unwrap();
    let one = run_on(&db.conn, &mut s, &Selection { all: false, only: vec![OTHER.into()] }, 1000.0).unwrap();
    assert_eq!((one.stories, one.computed), (1, 1));
    let run_dir = REL.split("/stories/").next().unwrap().to_string();
    let both = run_on(&db.conn, &mut s, &Selection { all: false, only: vec![run_dir] }, 2000.0).unwrap();
    assert_eq!((both.stories, both.computed, both.unchanged), (2, 1, 1));
}

#[test]
fn a_story_run_with_no_calls_is_recorded_with_no_rows() {
    let db = Db::open_memory().unwrap();
    story(&db.conn, REL, 3);
    let mut s = Store::open_memory().unwrap();
    let sum = run_on(&db.conn, &mut s, &Selection::default(), 1.0).unwrap();
    assert_eq!((sum.computed, s.count("call_context").unwrap(), s.count("analytics_story").unwrap()), (1, 0, 1));
}

#[test]
fn think_rows_skip_blank_thinking_and_short_blocks_have_no_overlaps() {
    let calls = vec![
        CallIn { idx: 0, rx: Some(1.0), think_full: Some("   \n".into()), ..Default::default() },
        CallIn { idx: 1, rx: Some(2.0), think_full: Some("too short".into()), ..Default::default() },
    ];
    let rows = think_rows(&calls, &[], TASK);
    assert_eq!(rows.len(), 1);
    assert_eq!((rows[0].idx, rows[0].prompt_overlap, rows[0].prev_sim, rows[0].features.repeat5), (1, None, None, None));
}

#[test]
fn a_story_run_whose_log_has_no_stamps_is_computed_with_null_times() {
    // 20% of the pi calls in the real warehouse come from compact logs with no stamps: rx and sent are null.
    let db = Db::open_memory().unwrap();
    let sk = story(&db.conn, REL, 3);
    for idx in 0..3 {
        db.conn.execute("insert into calls(sk, idx, think, in_tok, think_full) values (?1, ?2, 12, 10, 'a thought one two three')", params![sk, idx]).unwrap();
    }
    let mut s = Store::open_memory().unwrap();
    let sum = run_on(&db.conn, &mut s, &Selection::default(), 1.0).unwrap();
    assert_eq!((sum.computed, sum.calls, sum.think_blocks), (1, 3, 3));
    let (t, f): (Option<f64>, f64) = s.conn.query_row("select t_s, frac from call_context where idx = 2", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((t, f), (None, 1.0));
}

#[test]
fn a_story_run_says_whether_the_thinking_text_it_was_computed_from_is_all_the_harness_recorded() {
    // The harness records the thinking it counted (the record's profile); an older compact log holds less of it.
    let db = Db::open_memory().unwrap();
    let whole = story(&db.conn, REL, 3);
    let cut = story(&db.conn, OTHER, 4);
    let unknown = story(&db.conn, "combinations/x/y/z/os/m/llamacpp-pi/benchmarks/vidi/v2-r1/stories/05", 5);
    for sk in [whole, cut, unknown] {
        call(&db.conn, sk, 0, 1.0, 2.0, Some("twelve chars")); // 12
    }
    db.conn.execute("update stories set conversation_json = '{\"thinking_chars\": 12}' where sk = ?1", params![whole]).unwrap();
    db.conn.execute("update stories set conversation_json = '{\"thinking_chars\": 9000}' where sk = ?1", params![cut]).unwrap();
    let mut s = Store::open_memory().unwrap();
    run_on(&db.conn, &mut s, &Selection::default(), 1.0).unwrap();
    let flag = |rel: &str| -> (i64, Option<i64>, Option<i64>) {
        s.conn.query_row("select think_chars, think_chars_recorded, think_complete from analytics_story where rel = ?1", params![rel], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap()
    };
    assert_eq!(flag(REL), (12, Some(12), Some(1)));
    assert_eq!(flag(OTHER), (12, Some(9000), Some(0)));
    assert_eq!(flag("combinations/x/y/z/os/m/llamacpp-pi/benchmarks/vidi/v2-r1/stories/05"), (12, None, None));
}

// ---- the collector's hook: analytics after ingest ----

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("dbench-analytics-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn after_an_ingest_the_analytics_file_beside_the_warehouse_is_brought_up_to_date() {
    use dbench::analytics::after_ingest;
    let dir = scratch("hook");
    let wh = dir.join("conversations.db");
    {
        let db = Db::open(&wh).unwrap();
        let sk = story(&db.conn, REL, 3);
        call(&db.conn, sk, 0, 1.0, 2.0, Some("one thought two three"));
    }
    let out = dir.join("analytics.db");
    // No analytics file yet: made even though nothing new was ingested (the backfill).
    let msg = after_ingest(&wh, 0, 10.0).expect("computed");
    assert!(msg.contains("1 story runs"), "{msg}");
    assert!(out.exists());
    // Nothing ingested and the file exists: left alone.
    assert_eq!(after_ingest(&wh, 0, 20.0), None);
    // Something ingested but nothing changed for analytics: nothing to say.
    assert_eq!(after_ingest(&wh, 3, 30.0), None);
    let s = Store::open(&out).unwrap();
    assert_eq!(s.count("analytics_story").unwrap(), 1);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_failure_in_analytics_is_a_message_never_a_panic_or_an_error_for_the_collector() {
    use dbench::analytics::after_ingest;
    let dir = scratch("fail");
    let msg = after_ingest(&dir.join("no-such-warehouse.db"), 1, 1.0).expect("a message");
    assert!(msg.starts_with("analytics: "), "{msg}");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_analytics_file_can_be_opened_read_only_once_a_pass_is_done() {
    // Readers (the sqlite3 CLI, DuckDB's attach) open it read-only while no collector pass has it open: in WAL mode that
    // fails for lack of a -shm file, so the file is not in WAL mode.
    use dbench::analytics::after_ingest;
    let dir = scratch("readonly");
    let wh = dir.join("conversations.db");
    {
        let db = Db::open(&wh).unwrap();
        let sk = story(&db.conn, REL, 3);
        call(&db.conn, sk, 0, 1.0, 2.0, Some("one thought two three"));
    }
    after_ingest(&wh, 0, 1.0).expect("computed");
    let ro = Connection::open_with_flags(dir.join("analytics.db"), rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let n: i64 = ro.query_row("select count(*) from analytics_story", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    let mode: String = ro.query_row("pragma journal_mode", [], |r| r.get(0)).unwrap();
    assert_ne!(mode, "wal");
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn a_rebuild_keeps_the_theme_tables_it_does_not_compute() {
    // The themes are written by the insights scripts (benchmarks/docs/insights/thinking); `dbench analyse --rebuild`
    // replaces the file, and must not take them with the old one.
    use dbench::cli::AnalyseArgs;
    let dir = scratch("themes");
    let wh = dir.join("conversations.db");
    {
        let db = Db::open(&wh).unwrap();
        let sk = story(&db.conn, REL, 3);
        call(&db.conn, sk, 0, 1.0, 2.0, Some("one thought two three"));
    }
    let out = dir.join("analytics.db");
    dbench::analytics::after_ingest(&wh, 0, 1.0).expect("computed");
    {
        let c = Connection::open(&out).unwrap();
        c.execute("insert into theme(version, id, name, definition) values (1, 0, 'Weighing', 'but, wait')", []).unwrap();
        c.execute("insert into theme_story(rel, version, source_digest, paragraphs, computed_at) values (?1, 1, 'd', 4, 1.0)", params![REL]).unwrap();
        c.execute("insert into theme_share(rel, version, theme, chars, paragraphs) values (?1, 1, 0, 12.5, 2)", params![REL]).unwrap();
    }
    let args = AnalyseArgs { db: wh, out: out.clone(), rebuild: true, all: false, only: vec![] };
    dbench::analytics::cmd_analyse(&args, true).unwrap();
    let c = Connection::open(&out).unwrap();
    let share: f64 = c.query_row("select chars from theme_share where rel = ?1 and theme = 0", params![REL], |r| r.get(0)).unwrap();
    let name: String = c.query_row("select name from theme where version = 1", [], |r| r.get(0)).unwrap();
    let n: i64 = c.query_row("select count(*) from theme_story", [], |r| r.get(0)).unwrap();
    assert_eq!((share, name.as_str(), n), (12.5, "Weighing", 1));
    // And the computed tables were rebuilt, not copied.
    assert_eq!(c.query_row::<i64, _, _>("select count(*) from analytics_story", [], |r| r.get(0)).unwrap(), 1);
    std::fs::remove_dir_all(&dir).unwrap();
}
