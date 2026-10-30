//! `dbench stalls`: whether an agent that repeats itself does worse. The warehouse is synthetic and small enough to
//! work out by hand; the numbers asserted below are those hand calculations.

use dbench::ingest::db::Db;
use dbench::stalls::{analyse, longest_identical_run, repeated_calls, spearman};
use rusqlite::params;

#[test]
fn the_longest_run_is_the_longest_stretch_of_equal_neighbours() {
    assert_eq!(longest_identical_run(&[]), 0);
    assert_eq!(longest_identical_run(&[7]), 1);
    assert_eq!(longest_identical_run(&[1, 2, 3]), 1);
    assert_eq!(longest_identical_run(&[1, 1, 2, 1, 1, 1]), 3, "the last stretch, not the first");
    assert_eq!(longest_identical_run(&[1, 1, 1, 2, 1, 1]), 3, "the first stretch");
    assert_eq!(longest_identical_run(&[1, 2, 1, 2, 1, 2]), 1, "alternating calls are not a run");
}

#[test]
fn a_call_is_repeated_when_the_same_call_came_earlier_in_the_story() {
    assert_eq!(repeated_calls(&[]), 0);
    assert_eq!(repeated_calls(&[1, 2, 3]), 0);
    assert_eq!(repeated_calls(&[1, 1, 1, 1, 1, 1, 2]), 5);
    assert_eq!(repeated_calls(&[1, 2, 1, 1]), 2, "not only neighbours");
}

#[test]
fn rank_correlation_is_minus_one_for_a_perfect_fall_and_averages_ties() {
    assert_eq!(spearman(&[1.0, 2.0, 3.0, 4.0], &[4.0, 3.0, 2.0, 1.0]), Some(-1.0));
    assert_eq!(spearman(&[1.0, 2.0, 3.0, 4.0], &[10.0, 20.0, 30.0, 99.0]), Some(1.0));
    // x = 1,1,2 (ranks 1.5,1.5,3) against y = 1,2,3 (ranks 1,2,3): r = 0.866...
    let r = spearman(&[1.0, 1.0, 2.0], &[1.0, 2.0, 3.0]).unwrap();
    assert!((r - 0.866_025_4).abs() < 1e-6, "{r}");
    assert_eq!(spearman(&[1.0, 2.0], &[2.0, 1.0]), None, "two pairs say nothing");
    assert_eq!(spearman(&[1.0, 1.0, 1.0], &[1.0, 2.0, 3.0]), None, "no spread in one of them");
}

const STACK_A: &str = "x/y/z/os/m/llamacpp-pi";
const STACK_B: &str = "x/y/z/os/m/gufo-pi";
const STACK_C: &str = "x/y/z/os/m/mlxserve-pi";

/// One story: `keys` are its tool calls in order (equal text = the same call), `held` is passed out of total.
fn story(db: &Db, stack: &str, n: i64, status: &str, held: Option<(i64, i64)>, keys: &[&str], compactions: usize) -> String {
    let run_dir = format!("combinations/{stack}/benchmarks/vidi/r1");
    let rel = format!("{run_dir}/stories/{n:02}");
    db.conn.execute("insert or ignore into runs(id) values (?1)", params![run_dir]).unwrap();
    db.conn
        .execute(
            "insert into stories(rel, run_id, stack, run, story, status, passed, total) values (?1, ?2, ?3, 'r1', ?4, ?5, ?6, ?7)",
            params![rel, run_dir, stack, n, status, held.map(|h| h.0), held.map(|h| h.1)],
        )
        .unwrap();
    let sk = db.conn.last_insert_rowid();
    for (i, k) in keys.iter().enumerate() {
        db.conn.execute("insert into tools(sk, call_idx, idx, name, args_json) values (?1, ?2, ?2, 'read', ?3)", params![sk, i as i64, k]).unwrap();
    }
    for i in 0..compactions {
        db.conn.execute("insert into compactions(sk, start, end, reason) values (?1, ?2, ?3, 'overflow')", params![sk, i as f64, i as f64 + 1.0]).unwrap();
    }
    rel
}

/// Stack A: five stories whose longest run rises 1, 2, 3, 6, 9 while the held-out result falls 4/4, 3/4, 2/4, 1/4, 0/4.
/// Stack B: five stories with no repeats and no spread. Stack C: two stories. Plus a story with no held-out total and one
/// with no tool calls, which are left out.
fn warehouse(path: &std::path::Path) -> Db {
    let db = Db::open(path).unwrap();
    story(&db, STACK_A, 1, "DONE", Some((4, 4)), &["a", "b", "c"], 0);
    story(&db, STACK_A, 2, "DONE", Some((3, 4)), &["a", "a", "b", "c"], 0);
    story(&db, STACK_A, 3, "DONE", Some((2, 4)), &["a", "b", "b", "b", "c"], 0);
    story(&db, STACK_A, 4, "PARTIAL", Some((1, 4)), &["a", "a", "a", "a", "a", "a", "b"], 1);
    story(&db, STACK_A, 5, "DONE", Some((0, 4)), &["a", "a", "a", "a", "a", "a", "a", "a", "a", "b"], 0);
    for n in 1..=5 {
        // Compactions are usual in these runs, so the report counts them: B4 has three and B5 has five.
        let compactions = match n { 4 => 3, 5 => 5, _ => 0 };
        story(&db, STACK_B, n, "DONE", Some((2, 4)), &["a", "b", "c", "d"], compactions);
    }
    story(&db, STACK_C, 1, "DONE", Some((1, 2)), &["a", "b"], 0);
    story(&db, STACK_C, 2, "DONE", Some((2, 2)), &["a", "a"], 0);
    story(&db, STACK_C, 3, "DONE", None, &["a", "b"], 0);
    story(&db, STACK_C, 4, "DONE", Some((1, 2)), &[], 0);
    db
}

#[test]
fn the_report_bins_stories_by_longest_run_and_works_the_numbers_out_per_stack() {
    let dir = std::env::temp_dir().join(format!("dbench-stalls-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let db = warehouse(&dir.join("c.db"));
    let r = analyse(&db.conn).unwrap();

    assert_eq!(r.stories.len(), 12, "5 + 5 + 2 with a held-out total and calls");
    assert_eq!(r.excluded, 2, "no held-out total; no tool calls");
    let s4 = r.stories.iter().find(|s| s.rel.ends_with("llamacpp-pi/benchmarks/vidi/r1/stories/04")).unwrap();
    assert_eq!((s4.tool_calls, s4.longest_run, s4.repeated_calls, s4.compactions), (7, 6, 5, 1));
    assert_eq!((s4.passed, s4.total), (1, 4));

    let bin = |label: &str| r.by_longest_run.iter().find(|b| b.label == label).unwrap_or_else(|| panic!("no bin {label}: {:?}", r.by_longest_run));
    // Run 1: A1 (1.0) and B1..B5 (0.5 each) and C1 (0.5): 7 stories, mean (1 + 2.5 + 0.5) / 7.
    assert_eq!(bin("1").stories, 7);
    assert!((bin("1").mean_held_out - 4.0 / 7.0).abs() < 1e-9, "{}", bin("1").mean_held_out);
    // 2-4: A2 (0.75, run 2), A3 (0.5, run 3), C2 (1.0, run 2).
    assert_eq!(bin("2-4").stories, 3);
    assert!((bin("2-4").mean_held_out - 2.25 / 3.0).abs() < 1e-9);
    // 5-9: A4 (0.25, run 6, PARTIAL) and A5 (0.0, run 9, DONE).
    assert_eq!(bin("5-9").stories, 2);
    assert!((bin("5-9").mean_held_out - 0.125).abs() < 1e-9);
    assert!((bin("5-9").done_share - 0.5).abs() < 1e-9);
    // Repeated share: A4 is 5 of 7, A5 is 8 of 10.
    assert!((bin("5-9").mean_repeated_share - (5.0 / 7.0 + 0.8) / 2.0).abs() < 1e-9);
    assert!(r.by_longest_run.iter().all(|b| b.label != "10-19" || b.stories == 0));

    // Compactions per story: A4 has one, B4 three, B5 five; the other nine have none.
    let c = |label: &str| r.by_compaction.iter().find(|b| b.label == label).unwrap_or_else(|| panic!("no bin {label}: {:?}", r.by_compaction));
    assert_eq!((c("0").stories, c("1").stories, c("2-3").stories, c("4+").stories), (9, 1, 1, 1));
    assert!((c("0").mean_held_out - 5.25 / 9.0).abs() < 1e-9);
    assert!((c("1").mean_held_out - 0.25).abs() < 1e-9);
    assert!((c("4+").mean_held_out - 0.5).abs() < 1e-9);

    // Within a stack: A falls perfectly; B has no spread and C is too small, so neither is reported.
    assert_eq!(r.within_stack.len(), 1, "{:?}", r.within_stack);
    assert_eq!((r.within_stack[0].0.as_str(), r.within_stack[0].1), (STACK_A, 5));
    assert!((r.within_stack[0].2 + 1.0).abs() < 1e-9);
    assert!((r.within_stack_mean.unwrap() + 1.0).abs() < 1e-9);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn the_command_prints_the_table_as_text_and_as_json_and_never_writes_the_database() {
    let dir = std::env::temp_dir().join(format!("dbench-stalls-cmd-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("c.db");
    drop(warehouse(&path));
    let before = std::fs::read(&path).unwrap();
    let run = |args: &[&str]| {
        let out = std::process::Command::new(env!("CARGO_BIN_EXE_dbench")).args(args).output().unwrap();
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).into_owned()
    };
    let db = path.to_str().unwrap();

    let text = run(&["stalls", "--db", db]);
    for want in ["longest run of identical consecutive tool calls", "5-9", "compactions during the story", "within a stack", "12 stories", "2 left out"] {
        assert!(text.contains(want), "{want} missing from:\n{text}");
    }
    assert!(!text.contains("stories/04"), "no per-story list unless asked:\n{text}");
    let listed = run(&["stalls", "--db", db, "--per-story"]);
    assert!(listed.contains("llamacpp-pi/benchmarks/vidi/r1/stories/04"), "{listed}");

    let json: serde_json::Value = serde_json::from_str(&run(&["--json", "stalls", "--db", db])).unwrap();
    assert_eq!(json["stories"].as_array().unwrap().len(), 12);
    assert_eq!(json["by_longest_run"][0]["label"], "1");

    assert_eq!(std::fs::read(&path).unwrap(), before, "the database must be left exactly as it was");
    std::fs::remove_dir_all(&dir).unwrap();
}
