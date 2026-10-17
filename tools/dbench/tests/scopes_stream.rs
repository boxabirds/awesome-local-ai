//! GET /v1/runs/events (docs/design/dbench-scopes/api.md, "Events"), through the real router on a real socket, and the
//! paging core (`stream::read_page`) directly.
//!
//! The cases (MECE: each row is one cell of "what the file holds" x "what the caller sends"):
//!
//! File contents (paging core and route)
//!   F1  five events with one time, pages of 1, 2, 3                       ties_across_page_boundaries
//!   F2  mixed ties, pages of every size 1..=len+1 rebuild the file         every_page_size_rebuilds_the_file
//!   F3  cursor from a response resumes exactly, with and without the hint cursor_resumes_with_and_without_hint
//!   F4  last line has no newline: held back, returned once completed       half_line_is_held_back_then_returned
//!   F5  last complete line is not JSON: not returned, earlier ones are     invalid_trailing_line_does_not_block
//!   F6  an invalid line in the middle: skipped, later lines still flow     invalid_middle_line_is_skipped
//!   F7  empty file / missing file: empty result, not an error              empty_and_missing_files_are_not_errors
//!   F8  a line with a lower time than the one before: file order, counted  lower_time_is_kept_in_file_order
//!   F9  a restarted agent (second `session` event in one file)             restarted_agent_keeps_both_sessions
//!   F10 time text kept verbatim (big values, 3+ digit fractions, 1e9)      time_text_is_verbatim
//!   F11 the file is replaced under a remembered position                   replaced_file_does_not_use_a_stale_position
//!   F12 time key missing on a line                                         line_without_time_is_returned
//! Request (route)
//!   R1  bad cursors                                                        bad_cursors_are_refused
//!   R2  bad stream name                                                    bad_stream_is_refused
//!   R3  story given for egress                                             story_for_egress_is_refused
//!   R4  story missing for agent / conditions; malformed story              story_is_required_for_story_streams
//!   R5  symlinked file, symlinked story dir, symlinked egress              links_are_refused
//!   R6  limit 0, default, over the maximum                                 limit_zero_default_and_maximum
//!   R7  run missing / not a run / no token                                 run_and_token_checks
//!   R8  the three streams, their time keys, `final` present               each_stream_reads_its_file
//!   R9  egress through work_dir.txt                                        egress_through_work_dir
//! Real data
//!   D1  up to five real agent logs, pages of 1, 7, 1000, byte for byte     real_logs_rebuild_byte_for_byte

use dbench::cli::ServerConfig;
use dbench::scopes::stream::{self, Cursor};
use dbench::server::{router, Inner, Shared};
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TOKEN: &str = "test-token";
const RUN: &str = "combinations/test/combo/benchmarks/pack/r1";
const STORY: &str = "02";
const AGENT_KEY: &str = "_rx";
const COND_KEY: &str = "t";
const DEFAULT_LIMIT: usize = 1000;
const MAX_LIMIT: usize = 10000;
const OVER_MAX_LINES: usize = MAX_LIMIT + 50;
const TIE_COUNT: usize = 5;
const TINY_BACKOFF: Duration = Duration::from_millis(10);
const REAL_LOGS_MAX: usize = 5;
const REAL_LINES_MAX: usize = 200_000;
const REAL_PAGE_SIZES: [usize; 3] = [1, 7, 1000];
/// Page size 1 over a 200000-line log is 200000 requests; the real-data test pages 1 and 7 through a prefix this long.
const REAL_SMALL_PAGE_LINES: usize = 1500;
/// Pages this size or larger go through the whole copy.
const FULL_PASS_MIN_LIMIT: usize = 1000;
const LAKE: &str = "/Users/julian/expts/awesome-local-ai-bench-private/state/collected";

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Temp(PathBuf);
impl Temp {
    fn new(tag: &str) -> Temp {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let p =
            std::env::temp_dir().join(format!("dbench-stream-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Temp(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct Rig {
    _root: Temp,
    repo: PathBuf,
    bench_home: PathBuf,
    base: String,
    client: reqwest::Client,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Rig {
    fn drop(&mut self) {
        self.server.abort();
    }
}

struct Resp {
    status: u16,
    body: String,
}

impl Rig {
    /// A node whose repo holds one run, `RUN`, with a run.json.
    async fn new(tag: &str) -> Rig {
        let root = Temp::new(tag);
        Rig::over(root, None).await
    }

    /// A node over `repo` (already holding runs) when given, else over a fresh one.
    async fn over(root: Temp, repo: Option<PathBuf>) -> Rig {
        let repo = repo.unwrap_or_else(|| {
            let repo = root.0.join("repo");
            std::fs::create_dir_all(repo.join(RUN)).unwrap();
            std::fs::write(repo.join(RUN).join("run.json"), "{}").unwrap();
            repo
        });
        let repo = repo.canonicalize().unwrap();
        let bench_home = root.0.join("bench-home");
        std::fs::create_dir_all(&bench_home).unwrap();
        let cfg = ServerConfig {
            bind: "127.0.0.1:0".into(),
            repo: repo.clone(),
            jobs_dir: root.0.join("jobs"),
            releases_dir: root.0.join("releases"),
            home: root.0.join("home"),
            share_dir: root.0.join("share"),
            bench_home: bench_home.clone(),
            path_prepend: vec![],
            max_restarts: 0,
            pull: false,
            allow_unreleased: true,
            restart_backoff: TINY_BACKOFF,
            unfit_backoff: TINY_BACKOFF,
            cancel_grace: TINY_BACKOFF,
            tree_poll: TINY_BACKOFF,
        };
        let st = Arc::new(Shared {
            cfg,
            token: TOKEN.into(),
            boot_time: None,
            inner: Mutex::new(Inner {
                jobs: HashMap::new(),
                queue: VecDeque::new(),
                current: None,
                hold: None,
            }),
            wake: tokio::sync::Notify::new(),
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = router(st);
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Rig {
            _root: root,
            repo,
            bench_home,
            base: format!("http://{addr}"),
            client: reqwest::Client::new(),
            server,
        }
    }

    fn run_dir(&self) -> PathBuf {
        self.repo.join(RUN)
    }

    fn story_file(&self, story: &str, name: &str) -> PathBuf {
        let d = self.run_dir().join("stories").join(story);
        std::fs::create_dir_all(&d).unwrap();
        d.join(name)
    }

    async fn get(&self, query: &str) -> Resp {
        self.get_with(query, Some(TOKEN)).await
    }

    async fn get_with(&self, query: &str, token: Option<&str>) -> Resp {
        let mut req = self
            .client
            .get(format!("{}/v1/runs/events?{query}", self.base));
        if let Some(t) = token {
            req = req.bearer_auth(t);
        }
        let r = req.send().await.unwrap();
        Resp {
            status: r.status().as_u16(),
            body: r.text().await.unwrap(),
        }
    }

    /// The events of one page, for the stream and the run.
    async fn page(
        &self,
        stream_q: &str,
        after: Option<&str>,
        limit: usize,
    ) -> (Vec<String>, Option<String>, Value) {
        let mut q = format!("run={RUN}&{stream_q}&limit={limit}");
        if let Some(a) = after {
            q.push_str(&format!("&after={a}"));
        }
        let r = self.get(&q).await;
        assert_eq!(r.status, 200, "{}", r.body);
        let v: Value = serde_json::from_str(&r.body).unwrap();
        let next = v["next"].as_str().map(String::from);
        (lines_of(&r.body), next, v)
    }

    /// Every event of a stream by pages of `limit`, following `next` until a page is empty. Also returns the cursors seen.
    async fn all(&self, stream_q: &str, limit: usize) -> (Vec<String>, Vec<Option<String>>) {
        let (mut out, mut cursors, mut after) = (Vec::new(), Vec::new(), None::<String>);
        loop {
            let (lines, next, _) = self.page(stream_q, after.as_deref(), limit).await;
            if lines.is_empty() {
                return (out, cursors);
            }
            assert!(lines.len() <= limit);
            out.extend(lines);
            cursors.push(next.clone());
            after = next;
        }
    }
}

/// The event lines of a response, exactly as the file holds them: the route lays them out one per line.
fn lines_of(body: &str) -> Vec<String> {
    let v: Value = serde_json::from_str(body).unwrap();
    let n = v["events"].as_array().unwrap().len();
    if n == 0 {
        return vec![];
    }
    let start = body.find("[\n").unwrap() + 2;
    let end = body.find("\n],\"next\"").unwrap();
    let lines: Vec<String> = body[start..end].split(",\n").map(String::from).collect();
    assert_eq!(lines.len(), n);
    lines
}

fn ev(ts: &str, n: usize) -> String {
    format!(r#"{{"_rx":{ts},"n":{n}}}"#)
}

fn write_lines(path: &Path, lines: &[String]) {
    let mut f = std::fs::File::create(path).unwrap();
    for l in lines {
        writeln!(f, "{l}").unwrap();
    }
}

fn append(path: &Path, text: &str) {
    let mut f = std::fs::OpenOptions::new().append(true).open(path).unwrap();
    f.write_all(text.as_bytes()).unwrap();
}

const AGENT_Q: &str = "stream=agent&story=02";

/// A file of events with ties and a gap: times 1,1,1,2,3,3,5.
fn tied_lines() -> Vec<String> {
    ["1.0", "1.0", "1.0", "2.5", "3", "3", "5.125"]
        .iter()
        .enumerate()
        .map(|(i, t)| ev(t, i))
        .collect()
}

// ---- F1 ----

#[tokio::test]
async fn ties_across_page_boundaries() {
    let rig = Rig::new("ties").await;
    let lines: Vec<String> = (0..TIE_COUNT).map(|i| ev("1791500200.530", i)).collect();
    write_lines(&rig.story_file(STORY, "agent-events.jsonl"), &lines);
    for limit in 1..=3 {
        let (got, cursors) = rig.all(AGENT_Q, limit).await;
        assert_eq!(got, lines, "limit {limit}");
        // the cursor counts the events of that time already delivered
        let expect_last = format!("1791500200.530:{TIE_COUNT}");
        assert_eq!(
            cursors.last().unwrap().as_deref(),
            Some(expect_last.as_str())
        );
        assert_eq!(
            cursors[0].as_deref(),
            Some(format!("1791500200.530:{limit}").as_str())
        );
    }
}

// ---- F2 ----

#[test]
fn every_page_size_rebuilds_the_file() {
    let t = Temp::new("sizes");
    let path = t.0.join("a.jsonl");
    let lines = tied_lines();
    write_lines(&path, &lines);
    for limit in 1..=lines.len() + 1 {
        stream::forget_hints();
        let (mut got, mut after) = (Vec::new(), None::<Cursor>);
        loop {
            let page = stream::read_page(&path, AGENT_KEY, after.as_ref(), limit).unwrap();
            if page.lines.is_empty() {
                assert_eq!(page.next, after, "an empty page keeps the cursor");
                break;
            }
            got.extend(page.lines);
            after = page.next;
        }
        assert_eq!(got, lines, "limit {limit}");
    }
}

// ---- F3 ----

#[test]
fn cursor_resumes_with_and_without_hint() {
    let t = Temp::new("resume");
    let path = t.0.join("a.jsonl");
    let lines = tied_lines();
    write_lines(&path, &lines);
    let first = stream::read_page(&path, AGENT_KEY, None, 2).unwrap();
    assert_eq!(first.next.as_ref().unwrap().to_string(), "1.0:2");
    let hinted = stream::read_page(&path, AGENT_KEY, first.next.as_ref(), 100).unwrap();
    stream::forget_hints();
    let cold = stream::read_page(&path, AGENT_KEY, first.next.as_ref(), 100).unwrap();
    assert_eq!(hinted.lines, lines[2..]);
    assert_eq!(cold.lines, lines[2..]);
    assert_eq!(hinted.next, cold.next);
    assert_eq!(cold.next.unwrap().to_string(), "5.125:1");
    // a cursor parsed from its text is the same cursor
    assert_eq!(Cursor::parse("1.0:2"), first.next);
}

// ---- F4 ----

#[tokio::test]
async fn half_line_is_held_back_then_returned() {
    let rig = Rig::new("half").await;
    let path = rig.story_file(STORY, "agent-events.jsonl");
    let full = [ev("1.5", 0), ev("2.5", 1)];
    write_lines(&path, &full);
    let half = r#"{"_rx":3.5,"n":"#; // an unfinished write: no newline, not JSON yet
    append(&path, half);
    let (got, next, _) = rig.page(AGENT_Q, None, 10).await;
    assert_eq!(got, full);
    assert_eq!(next.as_deref(), Some("2.5:1"));
    // a line that is valid JSON but still lacks its newline is held back too
    append(&path, "2}");
    let (got, next2, _) = rig.page(AGENT_Q, next.as_deref(), 10).await;
    assert!(got.is_empty());
    assert_eq!(next2, next);
    append(&path, "\n");
    let (got, next3, _) = rig.page(AGENT_Q, next.as_deref(), 10).await;
    assert_eq!(got, vec![r#"{"_rx":3.5,"n":2}"#.to_string()]);
    assert_eq!(next3.as_deref(), Some("3.5:1"));
}

// ---- F5 ----

#[tokio::test]
async fn invalid_trailing_line_does_not_block() {
    let rig = Rig::new("badtail").await;
    let path = rig.story_file(STORY, "agent-events.jsonl");
    let good = [ev("1.5", 0), ev("2.5", 1)];
    write_lines(&path, &good);
    append(&path, "{\"_rx\":3.5, oops\n");
    let (got, next, _) = rig.page(AGENT_Q, None, 10).await;
    assert_eq!(got, good);
    assert_eq!(next.as_deref(), Some("2.5:1"));
}

// ---- F6 ----

#[test]
fn invalid_middle_line_is_skipped() {
    let t = Temp::new("badmid");
    let path = t.0.join("a.jsonl");
    std::fs::write(
        &path,
        format!("{}\nnot json\n\n[1,2]\n{}\n", ev("1.5", 0), ev("2.5", 1)),
    )
    .unwrap();
    let page = stream::read_page(&path, AGENT_KEY, None, 10).unwrap();
    assert_eq!(page.lines, vec![ev("1.5", 0), ev("2.5", 1)]);
    let one = stream::read_page(&path, AGENT_KEY, None, 1).unwrap();
    let rest = stream::read_page(&path, AGENT_KEY, one.next.as_ref(), 10).unwrap();
    assert_eq!(rest.lines, vec![ev("2.5", 1)]);
}

// ---- F7 ----

#[tokio::test]
async fn empty_and_missing_files_are_not_errors() {
    let rig = Rig::new("empty").await;
    // story directory absent
    let (got, next, v) = rig.page(AGENT_Q, None, 10).await;
    assert!(got.is_empty());
    assert_eq!(next, None);
    assert_eq!(v["final"], Value::Bool(false));
    // egress absent
    let (got, next, _) = rig.page("stream=egress", None, 10).await;
    assert!((got.is_empty()) && next.is_none());
    // empty file
    std::fs::write(rig.story_file(STORY, "agent-events.jsonl"), "").unwrap();
    let (got, next, _) = rig.page(AGENT_Q, None, 10).await;
    assert!(got.is_empty() && next.is_none());
    // a cursor on an empty or shorter file keeps the cursor
    let (got, next, _) = rig.page(AGENT_Q, Some("1.5:3"), 10).await;
    assert!(got.is_empty());
    assert_eq!(next.as_deref(), Some("1.5:3"));
}

// ---- F8 ----

#[test]
fn lower_time_is_kept_in_file_order() {
    let t = Temp::new("lower");
    let path = t.0.join("a.jsonl");
    // 5 is seen again after 3: the exact path counts it
    let lines: Vec<String> = ["5", "5", "3", "5", "6", "6"]
        .iter()
        .enumerate()
        .map(|(i, t)| ev(t, i))
        .collect();
    write_lines(&path, &lines);
    for limit in 1..=lines.len() + 1 {
        stream::forget_hints();
        let (mut got, mut after, mut cursors) = (Vec::new(), None::<Cursor>, Vec::new());
        loop {
            let page = stream::read_page(&path, AGENT_KEY, after.as_ref(), limit).unwrap();
            if page.lines.is_empty() {
                break;
            }
            got.extend(page.lines);
            cursors.push(page.next.clone().unwrap().to_string());
            after = page.next;
        }
        assert_eq!(got, lines, "limit {limit}");
        if limit == lines.len() {
            // the third event with time 5 is the fourth line: 5 was delivered 3 times in all
            assert_eq!(cursors, vec!["6:2"]);
        }
        if limit == 4 {
            assert_eq!(cursors[0], "5:3");
        }
    }
    // the same time written two ways is two different times, kept apart
    write_lines(&path, &[ev("1.5", 0), ev("1.50", 1), ev("1.5", 2)]);
    stream::forget_hints();
    let a = stream::read_page(&path, AGENT_KEY, None, 3).unwrap();
    assert_eq!(a.next.unwrap().to_string(), "1.5:2");
    let b =
        stream::read_page(&path, AGENT_KEY, Some(&Cursor::parse("1.50:1").unwrap()), 3).unwrap();
    assert_eq!(b.lines, vec![ev("1.5", 2)]);
}

// ---- F9 ----

#[tokio::test]
async fn restarted_agent_keeps_both_sessions() {
    let rig = Rig::new("restart").await;
    let session = |ts: &str| format!(r#"{{"_rx":{ts},"type":"session","version":3,"id":"x"}}"#);
    let lines = vec![
        session("10.001"),
        ev("10.002", 0),
        ev("11.5", 1),
        session("20.0"),
        ev("20.001", 2),
    ];
    write_lines(&rig.story_file(STORY, "agent-events.jsonl"), &lines);
    let (got, _) = rig.all(AGENT_Q, 2).await;
    assert_eq!(got, lines);
}

// ---- F10 ----

#[test]
fn time_text_is_verbatim() {
    let t = Temp::new("verbatim");
    let path = t.0.join("a.jsonl");
    for ts in [
        "1791500200.530",
        "1791500200.5300000001",
        "17915002005301234567890.123456789",
        "1e9",
        "1.0E+9",
        "0.000",
        "-0.5",
        "9007199254740993",
    ] {
        write_lines(&path, &[ev(ts, 0), ev(ts, 1)]);
        stream::forget_hints();
        let page = stream::read_page(&path, AGENT_KEY, None, 1).unwrap();
        let c = page.next.unwrap();
        assert_eq!(c.ts, ts);
        assert_eq!(c.to_string(), format!("{ts}:1"));
        let rest = stream::read_page(&path, AGENT_KEY, Some(&c), 5).unwrap();
        assert_eq!(rest.lines, vec![ev(ts, 1)], "{ts}");
    }
    // the key is found at the top level only, not inside a nested object or a string
    let line = r#"{"a":{"_rx":9},"s":"\"_rx\":7","_rx":4.250,"b":[{"_rx":8}]}"#;
    write_lines(&path, &[line.to_string()]);
    let page = stream::read_page(&path, AGENT_KEY, None, 5).unwrap();
    assert_eq!(page.next.unwrap().ts, "4.250");
}

// ---- F11 ----

#[test]
fn replaced_file_does_not_use_a_stale_position() {
    let t = Temp::new("replaced");
    let path = t.0.join("a.jsonl");
    write_lines(&path, &tied_lines());
    let first = stream::read_page(&path, AGENT_KEY, None, 4).unwrap();
    assert_eq!(first.next.as_ref().unwrap().to_string(), "2.5:1");
    // rewritten in place, shorter, other content: the remembered position no longer fits
    let other: Vec<String> = [("2.5", 100), ("2.5", 101), ("9", 102)]
        .iter()
        .map(|(t, n)| ev(t, *n))
        .collect();
    write_lines(&path, &other);
    let page = stream::read_page(&path, AGENT_KEY, first.next.as_ref(), 10).unwrap();
    assert_eq!(page.lines, other[1..]);
    // rewritten longer, a different line sits at the remembered offset
    let first = stream::read_page(&path, AGENT_KEY, None, 1).unwrap();
    let longer: Vec<String> = [("7", 1), ("2.5", 2), ("2.5", 3), ("8", 4)]
        .iter()
        .map(|(t, n)| ev(t, *n))
        .collect();
    write_lines(&path, &longer);
    let page = stream::read_page(&path, AGENT_KEY, first.next.as_ref(), 10).unwrap();
    // the cursor says "one event of time 2.5 delivered": the first such event is line 2, so line 3 follows
    assert_eq!(page.lines, longer[2..]);
}

// ---- F12 ----

#[test]
fn line_without_time_is_returned() {
    let t = Temp::new("notime");
    let path = t.0.join("a.jsonl");
    let lines = vec![ev("1.5", 0), r#"{"type":"note"}"#.to_string(), ev("2.5", 2)];
    write_lines(&path, &lines);
    for limit in 1..=4 {
        stream::forget_hints();
        let (mut got, mut after) = (Vec::new(), None::<Cursor>);
        loop {
            let page = stream::read_page(&path, AGENT_KEY, after.as_ref(), limit).unwrap();
            if page.lines.is_empty() {
                break;
            }
            got.extend(page.lines);
            after = page.next;
        }
        assert_eq!(got, lines, "limit {limit}");
    }
}

// ---- R1 ----

#[tokio::test]
async fn bad_cursors_are_refused() {
    let rig = Rig::new("cursor").await;
    for bad in [
        "", "abc", "1.5", "1.5:", "1.5:x", "1.5:0", "1.5:-1", "x:1", "1.5:1:2", "1 5:1", "1.5:1.0",
        "%20",
    ] {
        let r = rig.get(&format!("run={RUN}&{AGENT_Q}&after={bad}")).await;
        assert_eq!(r.status, 400, "{bad:?}: {}", r.body);
        assert!(r.body.contains("E-BAD-CURSOR"), "{bad:?}: {}", r.body);
    }
    assert_eq!(
        Cursor::parse("1.5:2").unwrap(),
        Cursor {
            ts: "1.5".into(),
            n: 2
        }
    );
    assert_eq!(Cursor::parse("1e9:2").unwrap().ts, "1e9");
    assert!(Cursor::parse("1.5:0").is_none());
}

// ---- R2 ----

#[tokio::test]
async fn bad_stream_is_refused() {
    let rig = Rig::new("stream").await;
    for bad in ["", "server", "proxy", "requests", "Agent", "../agent"] {
        let r = rig
            .get(&format!("run={RUN}&stream={bad}&story={STORY}"))
            .await;
        assert_eq!(r.status, 400, "{bad:?}: {}", r.body);
        assert!(r.body.contains("E-BAD-STREAM"), "{bad:?}: {}", r.body);
    }
    let r = rig.get(&format!("run={RUN}&story={STORY}")).await;
    assert_eq!(r.status, 400);
    assert!(r.body.contains("E-BAD-STREAM"));
}

// ---- R3 ----

#[tokio::test]
async fn story_for_egress_is_refused() {
    let rig = Rig::new("egstory").await;
    let r = rig
        .get(&format!("run={RUN}&stream=egress&story={STORY}"))
        .await;
    assert_eq!(r.status, 400, "{}", r.body);
    assert!(r.body.contains("E-BAD-STREAM"));
}

// ---- R4 ----

#[tokio::test]
async fn story_is_required_for_story_streams() {
    let rig = Rig::new("nostory").await;
    for stream in ["agent", "conditions"] {
        let r = rig.get(&format!("run={RUN}&stream={stream}")).await;
        assert_eq!(r.status, 400, "{stream}: {}", r.body);
        assert!(r.body.contains("E-BAD-STREAM"));
    }
    for bad in ["x", "../02", "0 2", "", "02/.."] {
        let r = rig
            .get(&format!("run={RUN}&stream=agent&story={bad}"))
            .await;
        assert_eq!(r.status, 400, "{bad:?}: {}", r.body);
        assert!(r.body.contains("E-BAD-STREAM"), "{bad:?}: {}", r.body);
    }
}

// ---- R5 ----

#[tokio::test]
async fn links_are_refused() {
    let rig = Rig::new("links").await;
    let outside = rig._root.0.join("outside");
    std::fs::create_dir_all(outside.join("03")).unwrap();
    write_lines(
        &outside.join("03").join("agent-events.jsonl"),
        &[ev("1.5", 0)],
    );
    write_lines(&outside.join("secret.jsonl"), &[ev("1.5", 0)]);
    let stories = rig.run_dir().join("stories");
    std::fs::create_dir_all(stories.join("02")).unwrap();
    // the file is a link
    std::os::unix::fs::symlink(
        outside.join("secret.jsonl"),
        stories.join("02").join("agent-events.jsonl"),
    )
    .unwrap();
    // the story directory is a link
    std::os::unix::fs::symlink(outside.join("03"), stories.join("03")).unwrap();
    // the egress file is a link
    std::os::unix::fs::symlink(
        outside.join("secret.jsonl"),
        rig.run_dir().join("egress.jsonl"),
    )
    .unwrap();
    for q in [
        "stream=agent&story=02",
        "stream=agent&story=03",
        "stream=egress",
    ] {
        let r = rig.get(&format!("run={RUN}&{q}")).await;
        assert_eq!(r.status, 404, "{q}: {}", r.body);
        assert!(r.body.contains("E-OUTSIDE-RUN"), "{q}: {}", r.body);
    }
}

// ---- R6 ----

#[tokio::test]
async fn limit_zero_default_and_maximum() {
    let rig = Rig::new("limit").await;
    let lines: Vec<String> = (0..OVER_MAX_LINES)
        .map(|i| ev(&format!("{}.5", i / 3), i))
        .collect();
    write_lines(&rig.story_file(STORY, "agent-events.jsonl"), &lines);
    let r = rig.get(&format!("run={RUN}&{AGENT_Q}")).await;
    assert_eq!(lines_of(&r.body).len(), DEFAULT_LIMIT);
    let r = rig
        .get(&format!("run={RUN}&{AGENT_Q}&limit={}", MAX_LIMIT * 10))
        .await;
    assert_eq!(lines_of(&r.body).len(), MAX_LIMIT);
    let r = rig
        .get(&format!("run={RUN}&{AGENT_Q}&limit={MAX_LIMIT}"))
        .await;
    assert_eq!(lines_of(&r.body).len(), MAX_LIMIT);
    // 0 asks for nothing: empty, and the cursor stays where it was
    let (got, next, _) = rig.page(AGENT_Q, Some("3.5:2"), 0).await;
    assert!(got.is_empty());
    assert_eq!(next.as_deref(), Some("3.5:2"));
    let (got, next, _) = rig.page(AGENT_Q, None, 0).await;
    assert!(got.is_empty() && next.is_none());
    // the whole stream still rebuilds through the default limit
    let (all, _) = rig.all(AGENT_Q, DEFAULT_LIMIT).await;
    assert_eq!(all, lines);
}

// ---- R7 ----

#[tokio::test]
async fn run_and_token_checks() {
    let rig = Rig::new("run").await;
    let r = rig.get(&format!("run=..%2Fetc&{AGENT_Q}")).await;
    assert_eq!(
        (r.status, r.body.contains("E-BAD-RUN-ID")),
        (400, true),
        "{}",
        r.body
    );
    let r = rig
        .get(&format!(
            "run=combinations/test/combo/benchmarks/pack/nope&{AGENT_Q}"
        ))
        .await;
    assert_eq!(
        (r.status, r.body.contains("E-RUN-NOT-FOUND")),
        (404, true),
        "{}",
        r.body
    );
    let r = rig.get(&format!("stream=agent&story={STORY}")).await;
    assert!(r.status == 400 || r.status == 422, "{}", r.status);
    let r = rig.get_with(&format!("run={RUN}&{AGENT_Q}"), None).await;
    assert_eq!(r.status, 401);
    let r = rig
        .get_with(&format!("run={RUN}&{AGENT_Q}"), Some("wrong"))
        .await;
    assert_eq!(r.status, 401);
}

// ---- R8 ----

#[tokio::test]
async fn each_stream_reads_its_file() {
    let rig = Rig::new("streams").await;
    let a = vec![ev("1.5", 0), ev("2.5", 1)];
    write_lines(&rig.story_file(STORY, "agent-events.jsonl"), &a);
    let c: Vec<String> = ["10.25", "10.25", "11.0"]
        .iter()
        .map(|t| format!(r#"{{"t":{t},"ac":true}}"#))
        .collect();
    write_lines(&rig.story_file(STORY, "conditions.jsonl"), &c);
    let e: Vec<String> = ["20.5", "21.5"]
        .iter()
        .map(|t| format!(r#"{{"t":{t},"request":"CONNECT x:443","allowed":true}}"#))
        .collect();
    write_lines(&rig.run_dir().join("egress.jsonl"), &e);
    let (got, next, v) = rig.page(AGENT_Q, None, 10).await;
    assert_eq!((got, next.as_deref()), (a, Some("2.5:1")));
    assert_eq!(v["final"], Value::Bool(false));
    assert_eq!(v["events"][0]["n"], 0);
    let (got, next, _) = rig.page("stream=conditions&story=02", None, 10).await;
    assert_eq!((got, next.as_deref()), (c, Some("11.0:1")));
    let (got, next, _) = rig.page("stream=egress", None, 10).await;
    assert_eq!((got, next.as_deref()), (e, Some("21.5:1")));
    // another story's files are not this story's
    let (got, _, _) = rig.page("stream=agent&story=03", None, 10).await;
    assert!(got.is_empty());
}

// ---- R9 ----

#[tokio::test]
async fn egress_through_work_dir() {
    let rig = Rig::new("egwork").await;
    std::fs::write(rig.run_dir().join("work_dir.txt"), "/somewhere/work-abc\n").unwrap();
    let dir = rig.bench_home.join("egress");
    std::fs::create_dir_all(&dir).unwrap();
    let e = vec![r#"{"t":5.5,"request":"x","allowed":false}"#.to_string()];
    write_lines(&dir.join("work-abc.jsonl"), &e);
    let (got, next, _) = rig.page("stream=egress", None, 10).await;
    assert_eq!((got, next.as_deref()), (e, Some("5.5:1")));
}

// ---- D1 ----

/// The first `REAL_LINES_MAX` lines of a real log, as bytes (a copy: the lake is never written).
fn copy_prefix(src: &Path, dst: &Path) {
    use std::io::{BufRead, BufReader};
    let mut r = BufReader::new(std::fs::File::open(src).unwrap());
    let mut out = std::fs::File::create(dst).unwrap();
    let mut buf = Vec::new();
    for _ in 0..REAL_LINES_MAX {
        buf.clear();
        if r.read_until(b'\n', &mut buf).unwrap() == 0 {
            break;
        }
        out.write_all(&buf).unwrap();
    }
}

/// The complete lines of a file that are JSON objects: what the route must return, in order.
fn expected_lines(path: &Path) -> Vec<String> {
    let bytes = std::fs::read(path).unwrap();
    let mut out = Vec::new();
    let mut rest = &bytes[..];
    while let Some(i) = rest.iter().position(|b| *b == b'\n') {
        let line = &rest[..i];
        rest = &rest[i + 1..];
        if let Ok(s) = std::str::from_utf8(line) {
            if matches!(serde_json::from_str::<Value>(s), Ok(Value::Object(_))) {
                out.push(s.to_string());
            }
        }
    }
    out
}

fn real_logs() -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut stack = vec![PathBuf::from(LAKE)];
    while let Some(d) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else {
            continue;
        };
        let mut entries: Vec<_> = rd.flatten().collect();
        entries.sort_by_key(|e| e.file_name());
        for e in entries {
            let p = e.path();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                stack.push(p);
            } else if p.file_name().is_some_and(|n| n == "agent-events.jsonl")
                && e.metadata().is_ok_and(|m| m.len() > 0)
            {
                found.push(p);
            }
        }
        if found.len() >= REAL_LOGS_MAX * 20 {
            break;
        }
    }
    // spread the pick over the candidates: different nodes, runs, clients and sizes
    let step = (found.len() / REAL_LOGS_MAX).max(1);
    found
        .into_iter()
        .step_by(step)
        .take(REAL_LOGS_MAX)
        .collect()
}

#[tokio::test]
async fn real_logs_rebuild_byte_for_byte() {
    if !Path::new(LAKE).is_dir() {
        eprintln!("SKIPPED real_logs_rebuild_byte_for_byte: {LAKE} is absent on this machine");
        return;
    }
    let logs = real_logs();
    assert!(
        !logs.is_empty(),
        "the lake exists but holds no agent-events.jsonl"
    );
    let rig = Rig::new("real").await;
    let mut total = 0usize;
    for (i, log) in logs.iter().enumerate() {
        let copy = rig.story_file(&format!("{:02}", i + 1), "agent-events.jsonl");
        copy_prefix(log, &copy);
        let expected = expected_lines(&copy);
        assert!(
            !expected.is_empty(),
            "{} has no complete line",
            log.display()
        );
        let q = format!("stream=agent&story={:02}", i + 1);
        for limit in REAL_PAGE_SIZES {
            let want: &[String] = if limit >= FULL_PASS_MIN_LIMIT {
                &expected
            } else {
                &expected[..expected.len().min(REAL_SMALL_PAGE_LINES)]
            };
            let (got, _) = if want.len() == expected.len() {
                rig.all(&q, limit).await
            } else {
                // pages of 1 and 7 over a prefix: stop after the prefix is delivered
                let (mut out, mut after) = (Vec::new(), None::<String>);
                while out.len() < want.len() {
                    let (lines, next, _) = rig.page(&q, after.as_deref(), limit).await;
                    assert!(!lines.is_empty());
                    out.extend(lines);
                    after = next;
                }
                out.truncate(want.len());
                (out, vec![])
            };
            assert_eq!(got.len(), want.len(), "{} limit {limit}", log.display());
            assert!(
                got.iter().zip(want).all(|(a, b)| a == b),
                "{} limit {limit}: a line differs",
                log.display()
            );
        }
        eprintln!(
            "real log {}: {} lines, pages of {:?} rebuild it",
            log.display(),
            expected.len(),
            REAL_PAGE_SIZES
        );
        total += expected.len();
    }
    eprintln!("real logs: {} logs, {total} lines", logs.len());
}

// Silence the unused-constant warning for the conditions key, kept for documentation of the three keys.
#[test]
fn time_keys_per_stream() {
    assert_eq!((AGENT_KEY, COND_KEY), ("_rx", "t"));
}

// ---- R10: `final` follows the scope rules (api.md, "Final, and resumption") ----

fn write_state(rig: &Rig, run_status: Option<&str>, metrics: Option<&str>) {
    if let Some(state) = run_status {
        std::fs::write(rig.run_dir().join("run-status.json"), format!(r#"{{"state":"{state}"}}"#)).unwrap();
    }
    if let Some(m) = metrics {
        std::fs::write(rig.run_dir().join("metrics.json"), m).unwrap();
    }
}

async fn final_of(rig: &Rig, query: &str) -> Value {
    rig.page(query, None, 10).await.2["final"].clone()
}

#[tokio::test]
async fn a_closed_run_makes_every_stream_final() {
    for state in ["finished", "failed", "stopped"] {
        let rig = Rig::new(&format!("final-{state}")).await;
        write_lines(&rig.story_file(STORY, "agent-events.jsonl"), &[ev("1.5", 0)]);
        write_state(&rig, Some(state), None);
        assert_eq!(final_of(&rig, AGENT_Q).await, Value::Bool(true), "agent, run {state}");
        assert_eq!(final_of(&rig, "stream=conditions&story=02").await, Value::Bool(true), "story that never started, run {state}");
        assert_eq!(final_of(&rig, "stream=egress").await, Value::Bool(true), "egress, run {state}");
    }
}

#[tokio::test]
async fn an_open_run_is_final_only_for_a_story_that_has_ended() {
    let rig = Rig::new("final-open").await;
    write_lines(&rig.story_file(STORY, "agent-events.jsonl"), &[ev("1.5", 0)]);
    write_state(&rig, Some("started"), Some(r#"{"stories":{"2":{"status":"DONE"},"3":{"title":"running"}}}"#));
    assert_eq!(final_of(&rig, AGENT_Q).await, Value::Bool(true), "story 2 has ended");
    assert_eq!(final_of(&rig, "stream=agent&story=03").await, Value::Bool(false), "story 3 has not ended");
    assert_eq!(final_of(&rig, "stream=egress").await, Value::Bool(false), "egress waits for the run");
}
