//! The scope collector (`dbench collect --scopes`, src/scope_collect.rs) against the REAL router on a real socket, over node
//! directories built by hand. Real-data comparison with the old collector is in tests/scope_collect_backtest.rs.
//!
//! MECE: every test is one cell of one dimension, and each dimension's cells cover it.
//!
//! D1 a stream's LAKE copy before the pull x the node's file (`stream_cells`, every page size 1, 2, 3 and the default)
//!   lake absent / a whole-line prefix / a prefix and a torn tail / identical / a different first event / further than the node
//!   node file empty / whole lines / torn last line / a non-JSON line / a blank line / an array line / a lower time later /
//!   many ties / times written oddly / a line without a time / non-ASCII and escapes / a 2 MiB line / key order and repeats
//! D2 what the node's AUTHORITY says (`stream_cells`): the lake becomes the node's complete event lines, byte for byte, and
//!   the cells where it is NOT the node's bytes are the declared ones (d2_*): torn tail, non-event lines, surrounding blanks
//! D3 the cursor memory (`note_cursor_*`): trusted while the length matches, scanned when it does not, never a duplicate
//! D4 the pass limit (`a_pass_stops_at_its_page_cap_and_the_next_continues`)
//! D5 the run's STATE x the job (`completion_by_state_and_job`): started/finished/failed/stopped/none x none/queued/running/
//!   done/failed/cancelled, three looks each, and the cells that reopen (`a_resumed_run_reopens`, `a_line_after_the_final_look`)
//! D6 the CLASSES (`records_only_takes_no_raw_stream_or_file`)
//! D7 the FILES by kind (`files_of_every_kind_arrive`): whole, append (prefix check, rewrite), blob of several chunks, a
//!   story file, a nested file; and what is never taken (`nothing_outside_the_allow_list_reaches_the_lake`)
//! D8 the ROUTES used (`only_the_scope_routes_are_used`, `the_old_pass_does_not_use_the_scope_routes`) and the flag
//! D9 the NODE's faults (`e_*`): unreachable, old, an error part-way, a line break in an event, a cursor that does not move

#![allow(clippy::cloned_ref_to_slice_refs)]

#[path = "support/replay.rs"]
mod replay;

use dbench::client::{Api, Ctx, NodeEntry};
use dbench::collect::{self, Class};
use dbench::collector::{self, Cadence, Collection, Config, Lake};
use dbench::scope_collect::{self, pull_stream, StreamTarget, E_BAD_EVENTS, MAX_PAGES_PER_STREAM_PASS};
use replay::{Node, TOKEN};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

const RUN_ID: &str = "r1";
const NODE: &str = "n1";
const GRACE_SECONDS: u64 = 60;
const T0: u64 = 1_000;
const WITHIN_GRACE: u64 = T0 + 10;
const AFTER_GRACE: u64 = T0 + 10 + GRACE_SECONDS;
const PAGE_SIZES: [usize; 4] = [1, 2, 3, 10_000];
const BIG_LINE_BYTES: usize = 2 * 1024 * 1024;
const BLOB_CHUNKS: usize = 3;
const AGENT: &str = "stories/01/agent-events.jsonl";
const CONDITIONS: &str = "stories/01/conditions.jsonl";
const EGRESS: &str = "egress.jsonl";
const ALL_CLASSES: [Class; 2] = [Class::Record, Class::Raw];

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Lakedir(PathBuf);
impl Lakedir {
    fn new() -> Lakedir {
        let p = std::env::temp_dir().join(format!("dbench-scopecollect-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Lakedir(p)
    }
}
impl Drop for Lakedir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn cadence(recheck: u64) -> Cadence {
    Cadence { running_poll: Duration::ZERO, finished_recheck: Duration::from_secs(recheck), settle_grace: Duration::from_secs(GRACE_SECONDS) }
}

struct Fx {
    node: Node,
    lake: Lakedir,
}

impl Fx {
    async fn new() -> Fx {
        let node = Node::start().await;
        std::fs::create_dir_all(node.run_dir(RUN_ID)).unwrap();
        std::fs::write(node.run_dir(RUN_ID).join("run.json"), "{}").unwrap();
        // the node lists the runs of a combination: a folder under combinations/ that has config.sh
        std::fs::write(node.shared.cfg.repo.join("combinations").join(replay::COMBINATION).join("config.sh"), "").unwrap();
        Fx { node, lake: Lakedir::new() }
    }
    fn api(&self) -> Api {
        Api::new(&NodeEntry { url: self.node.base.clone(), token: Some(TOKEN.into()) }).unwrap()
    }
    fn ctx(&self) -> Ctx {
        Ctx { nodes: BTreeMap::from([(NODE.to_string(), NodeEntry { url: self.node.base.clone(), token: Some(TOKEN.into()) })]), collect: Default::default(), json: false }
    }
    fn rel(&self) -> String {
        self.node.run_rel(RUN_ID)
    }
    fn dest(&self) -> PathBuf {
        collector::store_dir(&self.lake.0, NODE, &self.rel()).unwrap()
    }
    fn on_node(&self, name: &str) -> PathBuf {
        let p = name.split('/').fold(self.node.run_dir(RUN_ID), |p, s| p.join(s));
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        p
    }
    fn write(&self, name: &str, bytes: &[u8]) {
        std::fs::write(self.on_node(name), bytes).unwrap();
    }
    fn append(&self, name: &str, bytes: &[u8]) {
        use std::io::Write;
        std::fs::OpenOptions::new().create(true).append(true).open(self.on_node(name)).unwrap().write_all(bytes).unwrap();
    }
    fn status(&self, state: &str) {
        self.write("run-status.json", format!(r#"{{"state":"{state}"}}"#).as_bytes());
    }
    fn job(&self, label: Option<&str>) {
        let jobs: Vec<(String, &str, u64)> = label.map(|l| ("j1".to_string(), l, 1)).into_iter().collect();
        self.node.set_jobs(RUN_ID, &jobs);
    }
    fn in_lake(&self, name: &str) -> Option<Vec<u8>> {
        std::fs::read(self.dest().join(name)).ok()
    }
    fn note(&self) -> Collection {
        collector::load_collection(&self.dest()).expect("a note")
    }
    /// One pass of the new collector over the run.
    async fn pass(&self, now: u64) -> collector::RunSummary {
        self.pass_as(now, &ALL_CLASSES, 0).await
    }
    async fn pass_as(&self, now: u64, classes: &[Class], recheck: u64) -> collector::RunSummary {
        scope_collect::collect_run(&self.api(), NODE, &self.rel(), &self.dest(), classes, &cadence(recheck), now).await.unwrap()
    }
    /// The stream's target as the node lists it.
    async fn target(&self, stream: &str, story: Option<&str>) -> StreamTarget {
        let listing = self.api().scopes(&self.rel()).await.unwrap();
        listing
            .stream_targets(&ALL_CLASSES)
            .into_iter()
            .find(|t| t.stream == stream && t.story.as_deref() == story)
            .unwrap_or_else(|| panic!("the node lists no {stream} stream"))
    }
    fn requested(&self) -> Vec<String> {
        self.node.paths.lock().unwrap().clone()
    }
}

fn ag(ts: &str, n: usize) -> String {
    format!(r#"{{"_rx":{ts},"n":{n}}}"#)
}
fn lines(ls: &[String]) -> Vec<u8> {
    ls.iter().flat_map(|l| format!("{l}\n").into_bytes()).collect()
}

// ------------------------------------------------------------------ D1 and D2

struct Cell {
    name: &'static str,
    /// What the node's file holds.
    node: Vec<u8>,
    /// What the lake holds before the pull (None: no file).
    lake: Option<Vec<u8>>,
    /// What the lake must hold after (None: no file).
    want: Option<Vec<u8>>,
    replaced: bool,
}

fn big_line() -> String {
    format!(r#"{{"_rx":5.5,"pad":"{}"}}"#, "x".repeat(BIG_LINE_BYTES))
}

fn cells() -> Vec<Cell> {
    let (l1, l2, l3) = (ag("10.5", 1), ag("20.5", 2), ag("30.5", 3));
    let three = lines(&[l1.clone(), l2.clone(), l3.clone()]);
    let cell = |name, node: Vec<u8>, lake: Option<Vec<u8>>, want: Option<Vec<u8>>, replaced| Cell { name, node, lake, want, replaced };
    let ties: Vec<String> = (1..=5).map(|n| ag("7.25", n)).collect();
    let odd_times = [
        r#"{"_rx":1e9,"a":1}"#.to_string(),
        r#"{"_rx":1000000000.50,"a":2}"#.to_string(),
        r#"{ "_rx" : 2000000000.0 , "z" : "éé\n\"q\"" }"#.to_string(),
        r#"{"b":[1,2,{"_rx":3}],"_rx":2000000000.125,"_rx":2000000000.25}"#.to_string(),
    ];
    vec![
        // D1: lake before x node file
        cell("lake absent, node empty", vec![], None, None, false),
        cell("lake absent, node three lines", three.clone(), None, Some(three.clone()), false),
        cell("lake holds the first line", three.clone(), Some(lines(&[l1.clone()])), Some(three.clone()), false),
        cell("lake holds two lines and a torn tail", three.clone(), Some([lines(&[l1.clone(), l2.clone()]), br#"{"_rx":25.0,"n"#.to_vec()].concat()), Some(three.clone()), false),
        cell("lake identical", three.clone(), Some(three.clone()), Some(three.clone()), false),
        cell("lake's first event differs from the node's", three.clone(), Some(lines(&[ag("9.5", 1), l2.clone()])), Some(three.clone()), true),
        cell("lake is further than the node", lines(&[l1.clone(), l2.clone()]), Some(three.clone()), Some(lines(&[l1.clone(), l2.clone()])), true),
        // D1: node file shapes
        cell("many events with one time", lines(&ties), None, Some(lines(&ties)), false),
        cell("ties with the lake ending among them", lines(&ties), Some(lines(&ties[..3])), Some(lines(&ties)), false),
        cell("a lower time later in the file is kept in file order", lines(&[ag("10.5", 1), ag("5.5", 2), ag("7.5", 3)]), None, Some(lines(&[ag("10.5", 1), ag("5.5", 2), ag("7.5", 3)])), false),
        cell("times written oddly, text kept as written", lines(&odd_times), None, Some(lines(&odd_times)), false),
        cell("a line with no time", lines(&[l1.clone(), r#"{"n":2}"#.to_string(), l3.clone()]), None, Some(lines(&[l1.clone(), r#"{"n":2}"#.to_string(), l3.clone()])), false),
        cell("non-ASCII and escapes", lines(&[r#"{"_rx":1.5,"t":"héllo ☃ ☃ \\ \/"}"#.to_string()]), None, Some(lines(&[r#"{"_rx":1.5,"t":"héllo ☃ ☃ \\ \/"}"#.to_string()])), false),
        cell("a line of 2 MiB", lines(&[big_line(), l3.clone()]), None, Some(lines(&[big_line(), l3.clone()])), false),
        cell("key order and a repeated key kept", lines(&[r#"{"z":1,"_rx":2.5,"a":2,"z":3}"#.to_string()]), None, Some(lines(&[r#"{"z":1,"_rx":2.5,"a":2,"z":3}"#.to_string()])), false),
        // D2: the declared differences from a copy of the file
        cell("d2: a torn last line stays on the node", [lines(&[l1.clone()]), br#"{"_rx":25.0,"n"#.to_vec()].concat(), None, Some(lines(&[l1.clone()])), false),
        cell("d2: only a torn line: nothing arrives", br#"{"_rx":25.0,"n"#.to_vec(), None, None, false),
        cell("d2: a complete line that is not JSON is not taken", [lines(&[l1.clone()]), b"garbage\n".to_vec(), lines(&[l3.clone()])].concat(), None, Some(lines(&[l1.clone(), l3.clone()])), false),
        cell("d2: a blank line is not taken", [lines(&[l1.clone()]), b"\n".to_vec(), lines(&[l3.clone()])].concat(), None, Some(lines(&[l1.clone(), l3.clone()])), false),
        cell("d2: an array line is not taken", [lines(&[l1.clone()]), b"[1,2]\n".to_vec(), lines(&[l3.clone()])].concat(), None, Some(lines(&[l1.clone(), l3.clone()])), false),
        cell("d2: spaces around a line and a CR are dropped", b"  {\"_rx\":1.5,\"n\":1}  \r\n".to_vec(), None, Some(b"{\"_rx\":1.5,\"n\":1}\n".to_vec()), false),
    ]
}

#[tokio::test(flavor = "multi_thread")]
async fn stream_cells() {
    let mut failures = Vec::new();
    for page in PAGE_SIZES {
        for c in cells() {
            let fx = Fx::new().await;
            fx.status("started");
            fx.job(Some("running"));
            fx.write(AGENT, &c.node);
            if let Some(l) = &c.lake {
                std::fs::create_dir_all(fx.dest().join("stories/01")).unwrap();
                std::fs::write(fx.dest().join(AGENT), l).unwrap();
            }
            let target = fx.target("agent", Some("01")).await;
            let p = pull_stream(&fx.api(), &fx.rel(), &target, &fx.dest().join(AGENT), None, page).await.unwrap();
            let got = fx.in_lake(AGENT);
            let mut bad = |what: &str| failures.push(format!("[{}] page {page}: {what}", c.name));
            if got != c.want {
                bad(&format!("lake holds {:?} bytes, wanted {:?}", got.as_ref().map(Vec::len), c.want.as_ref().map(Vec::len)));
            }
            if p.replaced != c.replaced {
                bad(&format!("replaced={} wanted {}", p.replaced, c.replaced));
            }
            if !p.drained {
                bad("the read did not reach the end");
            }
            if let (Some(g), Some(w)) = (&got, &c.want) {
                if g.len() as u64 != p.bytes || g != w {
                    bad("bytes differ from the wanted file");
                }
            }
            // a second pull finds nothing and changes nothing
            let again = pull_stream(&fx.api(), &fx.rel(), &target, &fx.dest().join(AGENT), None, page).await.unwrap();
            if again.events != 0 || again.replaced || fx.in_lake(AGENT) != c.want {
                bad("a second pull pulled or changed something");
            }
        }
    }
    assert!(failures.is_empty(), "{} cells failed:\n{}", failures.len(), failures.join("\n"));
}

#[tokio::test]
async fn the_three_streams_each_arrive_from_their_own_file() {
    let fx = Fx::new().await;
    fx.status("started");
    fx.job(Some("running"));
    let (a, c, e) = (lines(&[ag("1.5", 1), ag("2.5", 2)]), lines(&[r#"{"t":1.25,"cpu":3}"#.into(), r#"{"t":2.25,"cpu":4}"#.into()]), lines(&[r#"{"t":1.75,"host":"a"}"#.into()]));
    fx.write(AGENT, &a);
    fx.write(CONDITIONS, &c);
    fx.write(EGRESS, &e);
    fx.pass(T0).await;
    assert_eq!((fx.in_lake(AGENT), fx.in_lake(CONDITIONS), fx.in_lake(EGRESS)), (Some(a), Some(c), Some(e)));
}

// ------------------------------------------------------------------ D3

#[tokio::test]
async fn note_cursor_is_trusted_while_the_length_matches_and_scanned_when_it_does_not() {
    let fx = Fx::new().await;
    fx.status("started");
    fx.job(Some("running"));
    let first = lines(&[ag("1.5", 1), ag("2.5", 2), ag("2.5", 3)]);
    fx.write(AGENT, &first);
    fx.pass(T0).await;
    let n = fx.note();
    assert_eq!(n.cursors.get(AGENT).map(String::as_str), Some("2.5:2"), "the cursor after the last event, ties counted");
    // trusted: more arrives, only the new line is pulled
    fx.append(AGENT, &lines(&[ag("3.5", 4)]));
    let s = fx.pass(T0 + 1).await;
    assert_eq!((s.pulled_files, s.pulled_bytes), (1, lines(&[ag("3.5", 4)]).len() as u64), "{s:?}");
    // not trusted: the lake's file was lengthened behind the note's back with a whole event the node also has: no duplicate
    fx.append(AGENT, &lines(&[ag("4.5", 5)]));
    let mut extra = std::fs::OpenOptions::new().append(true).open(fx.dest().join(AGENT)).unwrap();
    std::io::Write::write_all(&mut extra, lines(&[ag("4.5", 5)]).as_slice()).unwrap();
    drop(extra);
    fx.pass(T0 + 2).await;
    let want = [first, lines(&[ag("3.5", 4), ag("4.5", 5)])].concat();
    assert_eq!(fx.in_lake(AGENT).unwrap(), want, "the scan found the cursor of what the lake held; nothing twice");
    // not trusted: the note says one thing and the file is another length (a crash after the write): the torn tail goes
    let mut f = std::fs::OpenOptions::new().append(true).open(fx.dest().join(AGENT)).unwrap();
    std::io::Write::write_all(&mut f, br#"{"_rx":5.5,"n"#).unwrap();
    drop(f);
    fx.append(AGENT, &lines(&[ag("5.5", 6)]));
    fx.pass(T0 + 3).await;
    let want = [want, lines(&[ag("5.5", 6)])].concat();
    assert_eq!(fx.in_lake(AGENT).unwrap(), want);
    // a note with no cursors at all (written by the old pass): the same file, the same result
    let mut note = fx.note();
    note.cursors.clear();
    collector::save_collection(&fx.dest(), &note).unwrap();
    fx.append(AGENT, &lines(&[ag("6.5", 7)]));
    fx.pass(T0 + 4).await;
    assert_eq!(fx.in_lake(AGENT).unwrap(), [want, lines(&[ag("6.5", 7)])].concat());
}

// ------------------------------------------------------------------ D4

#[tokio::test]
async fn a_pass_stops_at_its_page_cap_and_the_next_continues() {
    let fx = Fx::new().await;
    fx.status("started");
    fx.job(Some("running"));
    let total = MAX_PAGES_PER_STREAM_PASS + 6;
    let all: Vec<String> = (1..=total).map(|n| ag(&format!("{n}.5"), n)).collect();
    fx.write(AGENT, &lines(&all));
    let target = fx.target("agent", Some("01")).await;
    let dest = fx.dest().join(AGENT);
    let first = pull_stream(&fx.api(), &fx.rel(), &target, &dest, None, 1).await.unwrap();
    assert_eq!((first.events as usize, first.drained), (MAX_PAGES_PER_STREAM_PASS, false), "one page of one event per request, capped");
    let second = pull_stream(&fx.api(), &fx.rel(), &target, &dest, None, 1).await.unwrap();
    assert!(second.drained && second.events as usize == total - MAX_PAGES_PER_STREAM_PASS,"{second:?}");
    assert_eq!(std::fs::read(&dest).unwrap(), lines(&all));
}

// ------------------------------------------------------------------ D5

fn is_final(state: Option<&str>, job: Option<&str>) -> bool {
    // the contract: (run-status closing OR job terminal) AND no live job
    let live = matches!(job, Some("queued" | "running"));
    let closing = matches!(state, Some("finished" | "failed" | "stopped"));
    let terminal = matches!(job, Some("done" | "failed" | "cancelled"));
    !live && (closing || terminal)
}

#[tokio::test(flavor = "multi_thread")]
async fn completion_by_state_and_job() {
    let states = [Some("started"), Some("finished"), Some("failed"), Some("stopped"), None];
    let jobs = [None, Some("queued"), Some("running"), Some("done"), Some("failed"), Some("cancelled")];
    let mut failures = Vec::new();
    for state in states {
        for job in jobs {
            let fx = Fx::new().await;
            if let Some(s) = state {
                fx.status(s);
            }
            fx.job(job);
            fx.write(AGENT, &lines(&[ag("1.5", 1)]));
            fx.write("metrics.json", b"{}");
            let seen: Vec<bool> = [fx.pass(T0).await, fx.pass(WITHIN_GRACE).await, fx.pass(AFTER_GRACE).await].iter().map(|s| s.complete).collect();
            let want = if is_final(state, job) { vec![false, false, true] } else { vec![false, false, false] };
            if seen != want {
                failures.push(format!("state {state:?} job {job:?}: complete over three looks {seen:?}, wanted {want:?}"));
            }
            let n = fx.note();
            if n.job_state.as_deref() != job {
                failures.push(format!("state {state:?} job {job:?}: note's job_state {:?}", n.job_state));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[tokio::test]
async fn a_complete_run_is_not_looked_at_again_inside_the_recheck_window() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    for now in [T0, WITHIN_GRACE, AFTER_GRACE] {
        fx.pass_as(now, &ALL_CLASSES, 3600).await;
    }
    assert!(fx.note().complete);
    let before = fx.requested().len();
    let s = fx.pass_as(AFTER_GRACE + 1, &ALL_CLASSES, 3600).await;
    assert!(s.complete && !s.changed);
    assert_eq!(fx.requested().len(), before, "no request was made for a complete run inside the window");
}

#[tokio::test]
async fn a_resumed_run_reopens() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.job(Some("done"));
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    for now in [T0, WITHIN_GRACE, AFTER_GRACE] {
        fx.pass(now).await;
    }
    assert!(fx.note().complete);
    // a new job resumes the run: it appends, and the run-status file still says finished
    fx.job(Some("running"));
    fx.append(AGENT, &lines(&[ag("2.5", 2)]));
    let s = fx.pass(AFTER_GRACE + 1).await;
    assert!(!s.complete && s.changed, "{s:?}");
    assert_eq!(fx.in_lake(AGENT).unwrap(), lines(&[ag("1.5", 1), ag("2.5", 2)]));
    assert_eq!(fx.note().settled_at, None);
    fx.job(Some("done"));
    let t = AFTER_GRACE + 2;
    let seen: Vec<bool> = [fx.pass(t).await, fx.pass(t + 1).await, fx.pass(t + 1 + GRACE_SECONDS).await].iter().map(|s| s.complete).collect();
    assert_eq!(seen, vec![false, false, true]);
}

#[tokio::test]
async fn a_line_after_the_final_look_is_still_collected_and_holds_completeness_back() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    fx.pass(T0).await;
    fx.pass(WITHIN_GRACE).await;
    assert!(fx.note().settled_at.is_some());
    // the node says final, yet one more line lands before the next look
    fx.append(AGENT, &lines(&[ag("2.5", 2)]));
    let s = fx.pass(AFTER_GRACE).await;
    assert!(!s.complete && s.pulled_files == 1, "{s:?}");
    assert_eq!(fx.in_lake(AGENT).unwrap(), lines(&[ag("1.5", 1), ag("2.5", 2)]));
    assert!(!fx.pass(AFTER_GRACE + 1).await.complete);
    assert!(fx.pass(AFTER_GRACE + 1 + GRACE_SECONDS).await.complete);
}

// ------------------------------------------------------------------ D6

#[tokio::test]
async fn records_only_takes_no_raw_stream_or_file() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    fx.write(CONDITIONS, &lines(&[r#"{"t":1.5}"#.into()]));
    fx.write(EGRESS, &lines(&[r#"{"t":1.5}"#.into()]));
    fx.write("server.log", b"raw\n");
    fx.write("metrics.json", b"{\"m\":1}");
    fx.pass_as(T0, &[Class::Record], 0).await;
    let held: BTreeSet<String> = files_below(&fx.dest());
    assert_eq!(held, BTreeSet::from(["collection.json".to_string(), "metrics.json".to_string(), "run-status.json".to_string(), "run.json".to_string()]));
    assert!(fx.note().cursors.is_empty());
}

// ------------------------------------------------------------------ D7

fn files_below(dir: &Path) -> BTreeSet<String> {
    fn walk(dir: &Path, rel: &str, out: &mut BTreeSet<String>) {
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let name = format!("{rel}{}", e.file_name().to_string_lossy());
            if e.file_type().unwrap().is_dir() {
                walk(&e.path(), &format!("{name}/"), out);
            } else {
                out.insert(name);
            }
        }
    }
    let mut out = BTreeSet::new();
    walk(dir, "", &mut out);
    out
}

fn pseudo(len: usize) -> Vec<u8> {
    let mut x = 0x9E37_79B9_7F4A_7C15u64;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            (x >> 24) as u8
        })
        .collect()
}

#[tokio::test(flavor = "multi_thread")]
async fn files_of_every_kind_arrive() {
    let fx = Fx::new().await;
    fx.status("started");
    fx.job(Some("running"));
    let bundle = pseudo(BLOB_CHUNKS * collect::COLLECT_CHUNK_BYTES as usize + 77);
    fx.write("workspace.bundle", &bundle);
    fx.write("metrics.json", b"{\"v\":1}");
    fx.write("stories/01/gate.json", b"{\"gate\":1}");
    fx.write("stories/01/artifacts/shots/a.png", &pseudo(5000));
    fx.write("server.log", b"line one\n");
    fx.pass(T0).await;
    let held = |name: &str| fx.in_lake(name).unwrap_or_else(|| panic!("{name} did not arrive"));
    assert_eq!(held("workspace.bundle"), bundle, "a blob of several chunks");
    assert_eq!(held("metrics.json"), b"{\"v\":1}");
    assert_eq!(held("stories/01/gate.json"), b"{\"gate\":1}", "a story file");
    assert_eq!(held("stories/01/artifacts/shots/a.png"), pseudo(5000), "a nested file");
    assert_eq!(held("server.log"), b"line one\n");
    // a whole file changes: replaced; an append file grows: only the new bytes; one is rewritten: fetched again
    fx.write("metrics.json", b"{\"v\":22}");
    fx.append("server.log", b"line two\n");
    let s = fx.pass(T0 + 1).await;
    assert_eq!(s.pulled_files, 2, "{s:?}");
    assert_eq!((held("metrics.json"), held("server.log")), (b"{\"v\":22}".to_vec(), b"line one\nline two\n".to_vec()));
    fx.write("server.log", b"rewritten from the start and longer than before\n");
    fx.pass(T0 + 2).await;
    assert_eq!(held("server.log"), b"rewritten from the start and longer than before\n".to_vec());
    // nothing changed: nothing pulled
    assert_eq!(fx.pass(T0 + 3).await.pulled_files, 0);
}

#[tokio::test]
async fn nothing_outside_the_allow_list_reaches_the_lake() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    fx.write("workspace/src/app.js", b"the agent's tree");
    fx.write("workspace/node_modules/x/index.js", b"deps");
    fx.write("control/stop", b"1");
    fx.write(".gitignore", b"x");
    fx.write("planted.sh", b"echo");
    fx.write("stories/01/planted.sh", b"echo");
    fx.write("current-story", b"1");
    fx.write("work_dir.txt", b"/somewhere/machine/path");
    for now in [T0, WITHIN_GRACE, AFTER_GRACE] {
        fx.pass(now).await;
    }
    for name in files_below(&fx.dest()) {
        assert!(name == collector::COLLECTION_FILE || collect::parse_name(&name).is_some(), "{name} is not an allow-listed name");
    }
    let held = files_below(&fx.dest());
    for banned in ["workspace/src/app.js", "control/stop", ".gitignore", "planted.sh", "stories/01/planted.sh", "current-story", "work_dir.txt"] {
        assert!(!held.contains(banned), "{banned} reached the lake");
    }
    assert!(!held.iter().any(|n| n.starts_with("workspace/") || n.contains(".git")), "{held:?}");
    assert!(!fx.dest().join(".git").exists());
}

#[tokio::test]
async fn the_pass_writes_only_inside_the_runs_lake_folder() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    fx.write("workspace.bundle", &pseudo(1000));
    let before = files_below(&fx.lake.0);
    assert!(before.is_empty());
    for now in [T0, WITHIN_GRACE, AFTER_GRACE] {
        fx.pass(now).await;
    }
    let rel_run = format!("{NODE}/{}/", fx.rel());
    for f in files_below(&fx.lake.0) {
        assert!(f.starts_with(&rel_run), "{f} is outside the run's folder");
    }
    assert!(!files_below(&fx.lake.0).iter().any(|f| f.split('/').any(|s| s.starts_with('.'))), "no partial or temporary file is left");
}

// ------------------------------------------------------------------ D8

#[tokio::test]
async fn only_the_scope_routes_are_used() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.job(Some("done"));
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    fx.write("metrics.json", b"{}");
    fx.write("workspace.bundle", &pseudo(100));
    let ctx = fx.ctx();
    let cfg = Config { store: fx.lake.0.clone(), reference: fx.lake.0.join("ref"), no_ingest: true, scopes: true, free_bytes: |_| Ok(u64::MAX), ..Default::default() };
    collector::pass(&ctx, &cfg, &cadence(0), false, T0).await.unwrap();
    let paths = fx.requested();
    for old in ["/v1/runs/files", "/v1/runs/file"] {
        assert!(!paths.iter().any(|p| p == old), "the old route {old} was used: {paths:?}");
    }
    for new in ["/v1/runs", "/v1/runs/scopes", "/v1/runs/events", "/v1/runs/scope-file"] {
        assert!(paths.iter().any(|p| p == new), "{new} was not used: {paths:?}");
    }
    assert!(fx.in_lake(AGENT).is_some() && fx.in_lake("metrics.json").is_some());
}

#[tokio::test]
async fn the_old_pass_does_not_use_the_scope_routes() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.job(Some("done"));
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    let cfg = Config { store: fx.lake.0.clone(), reference: fx.lake.0.join("ref"), no_ingest: true, free_bytes: |_| Ok(u64::MAX), ..Default::default() };
    collector::pass(&fx.ctx(), &cfg, &cadence(0), false, T0).await.unwrap();
    let paths = fx.requested();
    assert!(paths.iter().any(|p| p == "/v1/runs/files"), "{paths:?}");
    assert!(!paths.iter().any(|p| p.starts_with("/v1/runs/scope") || p == "/v1/runs/events"), "{paths:?}");
}

#[test]
fn the_flag_selects_the_scope_pass() {
    let ctx = Ctx { nodes: BTreeMap::new(), collect: Default::default(), json: false };
    let args = |extra: &[&str]| {
        let mut argv = vec!["dbench", "collect", "--store", "/x/lake", "--db", "/x/db", "--no-ingest"];
        argv.extend(extra);
        match <dbench::cli::Cli as clap::Parser>::try_parse_from(argv).unwrap().cmd {
            dbench::cli::Cmd::Collect(a) => a,
            other => panic!("{other:?}"),
        }
    };
    assert!(collector::resolve(&ctx, &args(&["--scopes"])).unwrap().scopes);
    assert!(!collector::resolve(&ctx, &args(&[])).unwrap().scopes);
}

// ------------------------------------------------------------------ D9

use axum::{extract::Query, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use std::sync::{Arc, Mutex};

async fn serve(app: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://{addr}")
}

fn ctx_for(url: String) -> Ctx {
    Ctx { nodes: BTreeMap::from([(NODE.to_string(), NodeEntry { url, token: None })]), collect: Default::default(), json: false }
}

const FAKE_RUN: &str = "combinations/a/b/benchmarks/p/r1";

fn runs_route() -> impl Fn() -> std::future::Ready<Json<serde_json::Value>> + Clone {
    || std::future::ready(Json(serde_json::json!([{"run": FAKE_RUN, "job": null, "run_status": null, "job_state": null}])))
}

fn listing_with_stream(final_: bool) -> serde_json::Value {
    serde_json::json!({"run": FAKE_RUN, "job": null, "run_state": "started", "job_state": null, "final": final_, "files": [], "streams": [],
      "stories": [{"n": 1, "state": "running", "final": final_, "files": [], "streams": [{"stream": "agent", "final": final_, "first_ts": 1.5, "last_ts": 1.5}]}]})
}

#[tokio::test]
async fn e_unreachable_and_old_nodes_are_reported_with_their_codes() {
    let lake = Lakedir::new();
    let none = BTreeSet::new();
    let l = Lake { store: &lake.0, reference: &lake.0 };
    let gone = collector::collect_node_with(&ctx_for("http://127.0.0.1:1".into()), NODE, l, &[], &none, &cadence(0), T0, true).await;
    assert!(!gone.reachable && gone.problems[0].starts_with(collector::E_NODE_UNREACHABLE), "{:?}", gone.problems);
    // a node that has /v1/runs but no scope routes
    let app = Router::new().route("/v1/runs", get(runs_route()));
    let old = collector::collect_node_with(&ctx_for(serve(app).await), NODE, l, &[], &none, &cadence(0), T0, true).await;
    assert!(old.reachable && old.problems.len() == 1 && old.problems[0].starts_with(collector::E_NODE_OLD), "{:?}", old.problems);
    assert!(old.problems[0].contains(FAKE_RUN));
    assert!(files_below(&lake.0).is_empty(), "nothing was written");
}

#[tokio::test]
async fn e_an_error_part_way_keeps_what_arrived_and_the_next_pass_finishes() {
    let lake = Lakedir::new();
    let none = BTreeSet::new();
    let l = Lake { store: &lake.0, reference: &lake.0 };
    let calls = Arc::new(Mutex::new(0usize));
    let seen = calls.clone();
    let events = move |Query(q): Query<BTreeMap<String, String>>| {
        let seen = seen.clone();
        async move {
            let n = {
                let mut g = seen.lock().unwrap();
                *g += 1;
                *g
            };
            match (n, q.get("after").map(String::as_str)) {
                (1, None) => (StatusCode::OK, "{\"events\":[\n{\"_rx\":1.5,\"n\":1}\n],\"next\":\"1.5:1\",\"final\":false}".to_string()).into_response(),
                (2, _) => (StatusCode::INTERNAL_SERVER_ERROR, "{\"error\":\"boom\"}".to_string()).into_response(),
                (_, Some("1.5:1")) => (StatusCode::OK, "{\"events\":[\n{\"_rx\":2.5,\"n\":2}\n],\"next\":\"2.5:1\",\"final\":true}".to_string()).into_response(),
                _ => (StatusCode::OK, "{\"events\":[],\"next\":\"2.5:1\",\"final\":true}".to_string()).into_response(),
            }
        }
    };
    let app = Router::new().route("/v1/runs", get(runs_route())).route("/v1/runs/scopes", get(|| async { Json(listing_with_stream(false)) })).route("/v1/runs/events", get(events));
    let ctx = ctx_for(serve(app).await);
    let first = collector::collect_node_with(&ctx, NODE, l, &[], &none, &cadence(0), T0, true).await;
    assert!(first.problems.iter().any(|p| p.contains("boom")), "{:?}", first.problems);
    let dest = collector::store_dir(&lake.0, NODE, FAKE_RUN).unwrap();
    assert_eq!(std::fs::read(dest.join(AGENT)).unwrap(), b"{\"_rx\":1.5,\"n\":1}\n", "the first page is kept");
    let second = collector::collect_node_with(&ctx, NODE, l, &[], &none, &cadence(0), T0 + 1, true).await;
    assert!(second.problems.is_empty(), "{:?}", second.problems);
    assert_eq!(std::fs::read(dest.join(AGENT)).unwrap(), b"{\"_rx\":1.5,\"n\":1}\n{\"_rx\":2.5,\"n\":2}\n", "no repeat, no gap");
}

#[tokio::test]
async fn e_an_event_with_a_line_break_is_refused_and_nothing_is_written() {
    let lake = Lakedir::new();
    let none = BTreeSet::new();
    let l = Lake { store: &lake.0, reference: &lake.0 };
    let events = || async { (StatusCode::OK, "{\"events\":[{\"_rx\":1.5,\n\"n\":1}],\"next\":\"1.5:1\",\"final\":false}").into_response() };
    let app = Router::new().route("/v1/runs", get(runs_route())).route("/v1/runs/scopes", get(|| async { Json(listing_with_stream(false)) })).route("/v1/runs/events", get(events));
    let out = collector::collect_node_with(&ctx_for(serve(app).await), NODE, l, &[], &none, &cadence(0), T0, true).await;
    assert!(out.problems.iter().any(|p| p.contains(E_BAD_EVENTS)), "{:?}", out.problems);
    let dest = collector::store_dir(&lake.0, NODE, FAKE_RUN).unwrap();
    assert!(!dest.join(AGENT).exists() || std::fs::read(dest.join(AGENT)).unwrap().is_empty());
}

#[tokio::test]
async fn e_a_cursor_that_does_not_move_ends_the_pass_with_an_error_not_a_loop() {
    let lake = Lakedir::new();
    let none = BTreeSet::new();
    let l = Lake { store: &lake.0, reference: &lake.0 };
    let events = || async { (StatusCode::OK, "{\"events\":[{\"_rx\":1.5,\"n\":1}],\"next\":null,\"final\":false}").into_response() };
    let app = Router::new().route("/v1/runs", get(runs_route())).route("/v1/runs/scopes", get(|| async { Json(listing_with_stream(false)) })).route("/v1/runs/events", get(events));
    let out = tokio::time::timeout(Duration::from_secs(20), collector::collect_node_with(&ctx_for(serve(app).await), NODE, l, &[], &none, &cadence(0), T0, true)).await.expect("the pass ended");
    assert!(out.problems.iter().any(|p| p.contains(E_BAD_EVENTS)), "{:?}", out.problems);
}

#[tokio::test]
async fn e_one_runs_error_does_not_stop_the_others() {
    let fx = Fx::new().await;
    fx.status("finished");
    fx.write(AGENT, &lines(&[ag("1.5", 1)]));
    // a second run the node lists, whose directory is then removed under the listing
    let other = fx.node.run_dir("r2");
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(other.join("run.json"), "{}").unwrap();
    std::fs::create_dir_all(other.join("stories/01")).unwrap();
    std::fs::write(other.join(AGENT), lines(&[ag("9.5", 1)])).unwrap();
    let cfg = Config { store: fx.lake.0.clone(), reference: fx.lake.0.join("ref"), no_ingest: true, scopes: true, free_bytes: |_| Ok(u64::MAX), ..Default::default() };
    let summaries = collector::pass(&fx.ctx(), &cfg, &cadence(0), false, T0).await.unwrap();
    assert_eq!(summaries[0].runs.len(), 2, "{summaries:?}");
    assert_eq!(fx.in_lake(AGENT).unwrap(), lines(&[ag("1.5", 1)]));
    let r2 = collector::store_dir(&fx.lake.0, NODE, &fx.node.run_rel("r2")).unwrap();
    assert_eq!(std::fs::read(r2.join(AGENT)).unwrap(), lines(&[ag("9.5", 1)]));
}

/// The run is final in the listing, but the stream's own answer says it is not (the run was reopened between the two
/// calls): the run must not be called complete however many looks pass. The control: the same node with the stream final.
#[tokio::test]
async fn e_a_stream_that_is_not_final_holds_completeness_back() {
    for (stream_final, want) in [(false, [false, false, false]), (true, [false, false, true])] {
        let lake = Lakedir::new();
        let events = move |Query(q): Query<BTreeMap<String, String>>| async move {
            let body = match q.get("after").map(String::as_str) {
                None => format!("{{\"events\":[\n{{\"_rx\":1.5,\"n\":1}}\n],\"next\":\"1.5:1\",\"final\":{stream_final}}}"),
                Some(_) => format!("{{\"events\":[],\"next\":\"1.5:1\",\"final\":{stream_final}}}"),
            };
            (StatusCode::OK, body).into_response()
        };
        let scopes = || async {
            let mut l = listing_with_stream(true);
            l["run_state"] = "finished".into();
            Json(l)
        };
        let app = Router::new().route("/v1/runs/scopes", get(scopes)).route("/v1/runs/events", get(events));
        let api = Api::new(&NodeEntry { url: serve(app).await, token: None }).unwrap();
        let dest = collector::store_dir(&lake.0, NODE, FAKE_RUN).unwrap();
        let mut seen = Vec::new();
        for now in [T0, WITHIN_GRACE, AFTER_GRACE] {
            seen.push(scope_collect::collect_run(&api, NODE, FAKE_RUN, &dest, &ALL_CLASSES, &cadence(0), now).await.unwrap().complete);
        }
        assert_eq!(seen, want, "stream final = {stream_final}");
    }
}
