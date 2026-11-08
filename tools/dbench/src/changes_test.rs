//! Unit tests of the change feed (changes.rs): TC-01 to TC-07 of story 24's test strategy.

use super::*;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const NODE: &str = "n0d31d";
const RUN: &str = "combinations/kat/1/tiny/linux/box/fake-pi/benchmarks/vidi/r1";
const EVENTS: &str = "stories/01/agent-events.jsonl";
// Recorded files: a pi session's events, and a run's own records.
const PI_EVENTS: &str =
    include_str!("../../../benchmarks/spec-bench/harness/fixtures/pi-smoke-events.jsonl");
const RUN_JSON: &str = include_str!("../tests/fixtures/scopes_listing/run.json");
const METRICS: &str = include_str!("../tests/fixtures/scopes_listing/metrics-story1-done.json");
const FINALIZE: &str = r#"{"score": "4/5", "suite": "kat-v1"}"#;
/// Long enough between two writes for their ctimes to differ on APFS and ext4 (nanosecond stamps).
const BETWEEN_WRITES: Duration = Duration::from_millis(15);
const YEAR_S: u64 = 365 * 24 * 3600;

struct Tree {
    root: PathBuf,
}
impl Tree {
    fn repo(&self) -> PathBuf {
        self.root.join("repo")
    }
    fn run_dir(&self) -> PathBuf {
        self.repo().join(RUN)
    }
    fn share(&self) -> PathBuf {
        self.root.join("share")
    }
    fn home(&self) -> PathBuf {
        self.root.join("bench-home")
    }
    fn write(&self, rel: &str, text: &str) {
        let p = self.run_dir().join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }
    fn append(&self, rel: &str, text: &str) {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(self.run_dir().join(rel))
            .unwrap();
        f.write_all(text.as_bytes()).unwrap();
    }
    fn size(&self, rel: &str) -> u64 {
        std::fs::metadata(self.run_dir().join(rel)).unwrap().len()
    }
    fn page(&self, after: &Position, horizon_ns: i64, limit: usize) -> ChangesPage {
        changes_after(
            &self.repo(),
            &self.share(),
            &self.home(),
            &HashMap::new(),
            NODE,
            after,
            horizon_ns,
            limit,
        )
    }
}

/// A node checkout holding one own run (run.json and work_dir.txt), with a story's events and the run's metrics.
fn tree(tag: &str) -> Tree {
    let root = std::env::temp_dir().join(format!("dbench-changes-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let t = Tree { root };
    let comb = t.repo().join("combinations/kat/1/tiny/linux/box/fake-pi");
    std::fs::create_dir_all(&comb).unwrap();
    std::fs::write(comb.join("config.sh"), "INSTALL_ID=\"w\"\n").unwrap();
    std::fs::create_dir_all(t.share()).unwrap();
    std::fs::create_dir_all(t.home()).unwrap();
    t.write("run.json", RUN_JSON);
    t.write("work_dir.txt", &t.root.join("work").display().to_string());
    t.write("metrics.json", METRICS);
    t.write(
        EVENTS,
        &PI_EVENTS
            .lines()
            .take(3)
            .map(|l| format!("{l}\n"))
            .collect::<String>(),
    );
    std::thread::sleep(BETWEEN_WRITES);
    t
}

fn at(ns: i64) -> Position {
    Position { ns, key: None }
}

fn files(p: &ChangesPage) -> Vec<String> {
    p.changes
        .iter()
        .map(|c| format!("{}/{}", c.run, c.file))
        .collect()
}

fn file_item(run: &str, file: &str, ns: i64) -> (i64, String, Item) {
    let key = format!("{run}/{file}");
    (
        ns,
        key,
        Item::File(Change {
            run: run.into(),
            file: file.into(),
            size: 1,
            changed_ms: ms(ns),
        }),
    )
}

#[test]
fn tc01_nothing_after_the_cursor_gives_no_changes_and_the_horizon() {
    let t = tree("tc01");
    let cursor = now_ns();
    let later = cursor + SETTLE_MARGIN_NS;
    let p = t.page(&at(cursor), later, LIMIT_DEFAULT);
    assert!(p.changes.is_empty() && p.runs.is_empty(), "{p:?}");
    assert_eq!(p.next, cursor_text(NODE, &at(later)));
    assert!(!p.more);
    assert_eq!(p.node_id, NODE);
}

#[test]
fn tc02_an_appended_log_is_listed_alone_with_its_new_size() {
    let t = tree("tc02");
    let cursor = now_ns();
    std::thread::sleep(BETWEEN_WRITES);
    t.append(
        EVENTS,
        &PI_EVENTS.lines().nth(3).map(|l| format!("{l}\n")).unwrap(),
    );
    let p = t.page(&at(cursor), now_ns(), LIMIT_DEFAULT);
    assert_eq!(files(&p), vec![format!("{RUN}/{EVENTS}")]);
    assert_eq!(p.changes[0].size, t.size(EVENTS));
}

#[test]
fn tc03_changes_come_in_the_order_they_were_written() {
    let t = tree("tc03");
    let cursor = now_ns();
    std::thread::sleep(BETWEEN_WRITES);
    t.write("metrics.json", METRICS);
    std::thread::sleep(BETWEEN_WRITES);
    t.write("finalize.json", FINALIZE);
    std::thread::sleep(BETWEEN_WRITES);
    t.append(EVENTS, "{}\n");
    let p = t.page(&at(cursor), now_ns(), LIMIT_DEFAULT);
    assert_eq!(
        files(&p),
        vec![
            format!("{RUN}/metrics.json"),
            format!("{RUN}/finalize.json"),
            format!("{RUN}/{EVENTS}")
        ]
    );
    assert!(p
        .changes
        .windows(2)
        .all(|w| w[0].changed_ms <= w[1].changed_ms));
}

#[test]
fn tc04_at_one_change_time_a_cursor_after_the_first_lists_the_second() {
    let ns = 1_000 * NS_PER_MS;
    let items = vec![file_item("r", "b", ns), file_item("r", "a", ns)];
    let p = page(
        items.clone(),
        NODE,
        &Position {
            ns,
            key: Some("r/a".into()),
        },
        ns,
        LIMIT_DEFAULT,
    );
    assert_eq!(files(&p), vec!["r/b"]);
    let p = page(items, NODE, &at(ns - 1), ns, LIMIT_DEFAULT);
    assert_eq!(
        files(&p),
        vec!["r/a", "r/b"],
        "ordered by path at one change time"
    );
}

#[test]
fn tc05_a_write_inside_the_settle_margin_waits_for_the_next_look() {
    let t = tree("tc05");
    let cursor = now_ns() - 1;
    t.write("finalize.json", FINALIZE);
    let written = now_ns();
    let now_look = t.page(
        &at(cursor - SETTLE_MARGIN_NS),
        horizon(written),
        LIMIT_DEFAULT,
    );
    assert!(
        !files(&now_look).contains(&format!("{RUN}/finalize.json")),
        "{now_look:?}"
    );
    let later_look = t.page(
        &at(cursor),
        horizon(written + SETTLE_MARGIN_NS),
        LIMIT_DEFAULT,
    );
    assert!(
        files(&later_look).contains(&format!("{RUN}/finalize.json")),
        "{later_look:?}"
    );
}

#[test]
fn tc06_a_file_renamed_into_place_with_a_year_old_mtime_is_listed() {
    let t = tree("tc06");
    t.write("finalize.json", FINALIZE);
    std::thread::sleep(BETWEEN_WRITES);
    let cursor = now_ns();
    std::thread::sleep(BETWEEN_WRITES);
    let staged = t.run_dir().join(".finalize.json.new");
    std::fs::write(&staged, r#"{"score": "5/5"}"#).unwrap();
    let old = SystemTime::now() - Duration::from_secs(YEAR_S);
    std::fs::File::options()
        .write(true)
        .open(&staged)
        .unwrap()
        .set_modified(old)
        .unwrap();
    std::fs::rename(&staged, t.run_dir().join("finalize.json")).unwrap();
    let p = t.page(&at(cursor), now_ns(), LIMIT_DEFAULT);
    assert_eq!(files(&p), vec![format!("{RUN}/finalize.json")]);
}

#[test]
fn tc07_five_changes_in_pages_of_two_equal_one_page_of_five() {
    let t = tree("tc07");
    let cursor = now_ns();
    for n in 1..=5 {
        std::thread::sleep(BETWEEN_WRITES);
        t.write(&format!("stories/0{n}/gate.json"), METRICS);
    }
    let horizon_ns = now_ns();
    let whole = t.page(&at(cursor), horizon_ns, LIMIT_MAX);
    assert_eq!(whole.changes.len(), 5);
    let (mut got, mut sizes, mut after) = (Vec::new(), Vec::new(), at(cursor));
    loop {
        let p = t.page(&after, horizon_ns, 2);
        sizes.push(p.changes.len());
        got.extend(files(&p));
        if !p.more {
            assert_eq!(
                p.next,
                cursor_text(NODE, &at(horizon_ns)),
                "the last page ends at the horizon"
            );
            break;
        }
        after = parse_cursor(&p.next, NODE, horizon_ns + SETTLE_MARGIN_NS).unwrap();
    }
    assert_eq!(sizes, vec![2, 2, 1]);
    assert_eq!(got, files(&whole));
}
