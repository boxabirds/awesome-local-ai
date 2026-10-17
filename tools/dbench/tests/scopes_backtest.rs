//! BACKTEST of the scope API (docs/design/dbench-scopes/api.md, "Backtest") on REAL data: a replay node (tests/support/
//! replay.rs) is built from runs of the real lake as the node stood at a time T, the real router serves it, and the
//! properties below must hold for every run and T. A failure is a finding: the properties are not weakened.
//!
//! The lake is `~/expts/awesome-local-ai-bench-private/state/collected`; it is only read. When it is absent every test prints
//! a SKIPPED line and passes.
//!
//! RUN SET: every lake run that did not finish cleanly (failed, stopped, started, no status), plus per node a spread of
//! finished runs with raw logs (FINISHED_PER_NODE) and without (one node has no raw log at all), plus one big run whose
//! logs are replayed UNCAPPED (it holds logs of more than 100,000 lines). All other logs are cut to their first LINE_CAP
//! lines in a copy (runtime); the capped copy is "the original file" of the properties.
//!
//! CASE TABLE (one test per row; each row varies one dimension):
//!
//! | test | dimension | what is compared | oracle |
//! |---|---|---|---|
//! | p1_pages_rebuild_the_replayed_logs | T x variant (clean, half next line, half last line, no newline) x page size (1000, random, 1 and 7 in windows or whole when small) x stream | every page against the file's complete lines, in order; the cursor `next` against an independent TS:N | the replayed file's bytes and a cursor derived from them |
//! | p2_a_collector_that_polls_at_times_rebuilds_every_log | polls T1<..<Tk (k 3..12), a two-poll gap, a crashed harness | one cursor per stream kept between polls, lines appended to a local copy; idle polls; `final` never true before the log is complete | the original lake file's complete lines, byte for byte |
//! | p3_final_flags_follow_run_status_and_job | T x scenario (normal, crashed with no status, crashed after `started`, resumed) | listing `final` per run, story, stream; events `final` agrees with the listing | (run-status closing OR job terminal) AND no live job; story: ended by T OR run final |
//! | p4_scope_files_equal_their_sources | T | every listed file through /scope-file: bytes, size, x-dbench-final; every allow-listed file present is listed | the replay folder and the lake source |
//! | p5_absent_is_not_an_error | T x story not started / stream absent / story never in the run | listing has no entry, events are empty with next null and the right final | the model of what started |

#[path = "support/replay.rs"]
mod replay;

use replay::*;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::future::Future;
use std::path::Path;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;

const RUN_ID: &str = "replay";
/// How many runs are replayed at once inside one test.
const PARALLEL_RUNS: usize = 4;
/// T values per run for each property (the first and the last two are always kept).
const MAX_T_P1: usize = 11;
const MAX_T_P1_BIG: usize = 7;
const MAX_T_P3: usize = 14;
const MAX_T_P4: usize = 10;
const MAX_T_P5: usize = 8;
const POOL_T: usize = 64;
/// Page sizes.
const PAGE_BIG: usize = 1000;
const PAGE_SMALL: [usize; 2] = [1, 7];
const PAGE_RANDOM_MAX: usize = 2500;
/// Streams this short are paged completely with every page size; longer ones with pages of 1 and 7 in a window.
const SMALL_FULL_MAX: usize = 300;
const WINDOW_LINES: usize = 120;
/// Streams per moment that get the windows of small pages.
const WINDOW_STREAMS: usize = 4;
const COLLECTOR_POLLS_MIN: usize = 3;
const COLLECTOR_POLLS_MAX: usize = 12;
const CRASH_POLLS_MAX: usize = 6;
const BIG_RUN_POLLS: usize = 4;
const FAILURES_SHOWN: usize = 12;
const SLOWEST_SHOWN: usize = 3;
const BIG_LOG_LINES: usize = 100_000;
const BIG_LOGS_MIN: usize = 3;
const NEVER_STORY: u32 = 99;

struct Tally(Mutex<BTreeMap<&'static str, usize>>);
impl Tally {
    fn new() -> Arc<Tally> {
        Arc::new(Tally(Mutex::new(BTreeMap::new())))
    }
    fn add(&self, k: &'static str, n: usize) {
        *self.0.lock().unwrap().entry(k).or_default() += n;
    }
    fn show(&self) -> String {
        self.0.lock().unwrap().iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(" ")
    }
}

fn runs() -> Option<&'static [LakeRun]> {
    static RUNS: OnceLock<Option<Vec<LakeRun>>> = OnceLock::new();
    RUNS.get_or_init(|| {
        let lake = lake_dir()?;
        let started = Instant::now();
        let runs = select_runs(&lake);
        let mut by: BTreeMap<String, usize> = BTreeMap::new();
        for r in &runs {
            *by.entry(format!("{} {}{}", r.node, r.real_state, if r.has_streams() { "" } else { " (no raw log)" })).or_default() += 1;
        }
        let big_logs = runs
            .iter()
            .flat_map(|r| r.stories.values())
            .filter_map(|s| s.agent.as_ref())
            .filter(|a| !a.idx.capped && a.idx.ends.len() > BIG_LOG_LINES)
            .count();
        eprintln!("backtest run set: {} runs, indexed in {:?}; {big_logs} uncapped logs of more than {BIG_LOG_LINES} lines", runs.len(), started.elapsed());
        for (k, v) in &by {
            eprintln!("  {k}: {v}");
        }
        Some(runs)
    })
    .as_deref()
}

/// Run `f` for every selected run (in parallel), collect the failures, print the tally, panic with the failures.
async fn for_runs<F, Fut>(name: &'static str, filter: fn(&LakeRun) -> bool, f: F)
where
    F: Fn(&'static LakeRun, Arc<Tally>) -> Fut + Send + Sync + Clone + 'static,
    Fut: Future<Output = Result<(), String>> + Send + 'static,
{
    let Some(runs) = runs() else {
        eprintln!("SKIPPED {name}: the lake is absent on this machine");
        return;
    };
    let started = Instant::now();
    let tally = Tally::new();
    let sem = Arc::new(tokio::sync::Semaphore::new(PARALLEL_RUNS));
    let mut handles = Vec::new();
    for run in runs.iter().filter(|r| filter(r)) {
        let (f, tally, sem) = (f.clone(), tally.clone(), sem.clone());
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            tally.add("runs", 1);
            let began = Instant::now();
            let out = match tokio::spawn(f(run, tally.clone())).await {
                Ok(Ok(())) => None,
                Ok(Err(e)) => Some(format!("{}: {e}", run.label)),
                Err(e) => Some(format!("{}: panic {e}", run.label)),
            };
            (out, format!("{} {:?}", run.label, began.elapsed()), began.elapsed())
        }));
    }
    let mut failures = Vec::new();
    let mut timings = Vec::new();
    for h in handles {
        let (out, label, took) = h.await.unwrap();
        timings.push((took, label));
        if let Some(f) = out {
            failures.push(f);
        }
    }
    timings.sort();
    let slowest: Vec<String> = timings.iter().rev().take(SLOWEST_SHOWN).map(|(_, l)| l.clone()).collect();
    eprintln!("{name}: {} ({:?}); slowest: {slowest:?}; failures: {}", tally.show(), started.elapsed(), failures.len());
    if !failures.is_empty() {
        let shown: Vec<String> = failures.iter().take(FAILURES_SHOWN).cloned().collect();
        panic!("{name}: {} runs failed:\n{}", failures.len(), shown.join("\n"));
    }
}

fn any_run(_: &LakeRun) -> bool {
    true
}
fn with_streams(r: &LakeRun) -> bool {
    r.has_streams()
}

// ---------------------------------------------------------------- P1

/// The cursor after each delivered line, as the contract writes it: the time text as written and how many lines with that
/// text have been delivered so far; None where the line does not start with its time key.
fn cursor_oracle(data: &[u8], ranges: &[(usize, usize)], kind: Kind) -> Vec<Option<String>> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut out = vec![None];
    for (a, b) in ranges {
        out.push(time_text(&data[*a..*b], kind).map(|t| {
            let c = counts.entry(t.clone()).or_default();
            *c += 1;
            format!("{t}:{c}")
        }));
    }
    out
}

struct StreamCheck<'a> {
    node: &'a Node,
    s: &'a StreamState,
    data: &'a [u8],
    ranges: &'a [(usize, usize)],
    cursors: &'a [Option<String>],
    tally: &'a Tally,
}

impl StreamCheck<'_> {
    fn id(&self) -> String {
        format!("{} story {:?}", self.s.kind.stream(), self.s.story)
    }

    /// Page from `start` (lines delivered, cursor) with the sizes `next_size` yields, until the stream is exhausted or
    /// `max_lines` lines were checked. Returns the (lines delivered, cursor) after every page.
    async fn pass(&self, label: &'static str, next_size: &mut (dyn FnMut() -> usize + Send), start: (usize, Option<String>), max_lines: Option<usize>) -> Result<Vec<(usize, String)>, String> {
        let (mut pos, mut after) = start;
        let stop = max_lines.map(|m| pos + m);
        let mut points = Vec::new();
        loop {
            if stop.is_some_and(|z| pos >= z) {
                break;
            }
            let size = next_size();
            let page = self.node.events(RUN_ID, self.s.kind, self.s.story, after.as_deref(), size).await?;
            self.tally.add("pages", 1);
            self.tally.add(label, 1);
            if page.lines.is_empty() {
                if pos != self.ranges.len() {
                    return Err(format!("{}: empty page after {pos} of {} lines (after {after:?}, size {size})", self.id(), self.ranges.len()));
                }
                if page.next != after {
                    return Err(format!("{}: an empty page changed the cursor {after:?} -> {:?}", self.id(), page.next));
                }
                break;
            }
            if page.lines.len() > size.min(MAX_LIMIT) {
                return Err(format!("{}: {} lines for limit {size}", self.id(), page.lines.len()));
            }
            for l in &page.lines {
                let Some((a, b)) = self.ranges.get(pos) else {
                    return Err(format!("{}: line {pos} is beyond the {} complete lines of the file: {}", self.id(), self.ranges.len(), &l[..l.len().min(120)]));
                };
                if l.as_bytes() != &self.data[*a..*b] {
                    return Err(format!("{}: line {pos} differs (after {after:?}, size {size}): got {} expected {}", self.id(), &l[..l.len().min(120)], String::from_utf8_lossy(&self.data[*a..(*b).min(*a + 120)])));
                }
                pos += 1;
            }
            self.tally.add("lines", page.lines.len());
            let Some(next) = page.next else {
                return Err(format!("{}: next is null after {pos} lines", self.id()));
            };
            if let Some(Some(want)) = self.cursors.get(pos) {
                if want.rsplit(':').next().is_some_and(|n| n != "1") {
                    self.tally.add("page_ends_inside_a_tie", 1);
                }
                if &next != want {
                    return Err(format!("{}: cursor after {pos} lines is {next}, the file says {want}", self.id()));
                }
            }
            points.push((pos, next.clone()));
            after = Some(next);
        }
        if stop.is_none() && pos != self.ranges.len() {
            return Err(format!("{}: delivered {pos} of {} lines", self.id(), self.ranges.len()));
        }
        Ok(points)
    }
}

async fn p1_moment(node: &Node, m: &Moment, rng: &mut Rng, tally: &Tally) -> Result<(), String> {
    let mut windows_left = WINDOW_STREAMS;
    // The streams still being written come first: they are the ones the windows are spent on.
    let mut order: Vec<&StreamState> = m.streams.iter().collect();
    order.sort_by_key(|s| s.story.is_none_or(|n| m.ended.contains(&n)));
    for s in order {
        let data = std::fs::read(&s.path).map_err(|e| format!("read {}: {e}", s.path.display()))?;
        if data.len() as u64 != s.len {
            return Err(format!("replay file {} holds {} bytes, expected {}", s.path.display(), data.len(), s.len));
        }
        let ranges = s.src.expected(s.len);
        let cursors = cursor_oracle(&data, &ranges, s.kind);
        let chk = StreamCheck { node, s, data: &data, ranges: &ranges, cursors: &cursors, tally };
        tally.add("streams", 1);
        let last_complete = s.src.idx.ends.partition_point(|e| *e <= s.len).checked_sub(1).map_or(0, |i| s.src.idx.ends[i]);
        if s.len > last_complete {
            tally.add("streams_with_a_half_written_last_line", 1);
        }
        chk.pass("pages_size_1000", &mut || PAGE_BIG, (0, None), None).await?;
        let mut sizes = Rng::seeded(&format!("{}{:?}", s.path.display(), m.t.to_bits()), 11);
        let points = chk.pass("pages_size_random", &mut || sizes.range(1, PAGE_RANDOM_MAX), (0, None), None).await?;
        if ranges.len() <= SMALL_FULL_MAX {
            for size in PAGE_SMALL {
                chk.pass(if size == 1 { "pages_size_1" } else { "pages_size_7" }, &mut || size, (0, None), None).await?;
            }
        } else if windows_left > 0 {
            windows_left -= 1;
            for size in PAGE_SMALL {
                // from the start, and from a cursor in the middle of the stream
                chk.pass(if size == 1 { "pages_size_1" } else { "pages_size_7" }, &mut || size, (0, None), Some(WINDOW_LINES)).await?;
                if !points.is_empty() {
                    let (pos, cur) = points[rng.range(0, points.len() - 1)].clone();
                    chk.pass(if size == 1 { "pages_size_1" } else { "pages_size_7" }, &mut || size, (pos, Some(cur)), Some(WINDOW_LINES)).await?;
                }
            }
        }
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn p1_pages_rebuild_the_replayed_logs() {
    for_runs("p1", with_streams, |run, tally| async move {
        let node = Node::start().await;
        let mut rp = Replay::new(&node, run, RUN_ID);
        let max = if run.big { MAX_T_P1_BIG } else { MAX_T_P1 };
        let mut rng = Rng::seeded(&run.label, 3);
        for (t, v) in pick_times(run, max) {
            let m = rp.apply(&node, t, v, Scenario::Normal);
            tally.add("moments", 1);
            p1_moment(&node, &m, &mut rng, &tally).await.map_err(|e| format!("T={t} {v:?}: {e}"))?;
        }
        tally.add("requests", node.requests.load(std::sync::atomic::Ordering::Relaxed));
        Ok(())
    })
    .await;
}

// ---------------------------------------------------------------- P2

type Key = (Kind, Option<u32>);

/// The bytes of a stream's file when the replay is whole: the complete lines that are JSON objects.
fn full_bytes(src: &StreamSrc) -> Vec<u8> {
    let data = std::fs::read(&src.path).unwrap();
    let mut out = Vec::new();
    for (a, b) in src.expected(src.idx.full_len) {
        out.extend_from_slice(&data[a..b]);
        out.push(b'\n');
    }
    out
}

fn streams_of_run(run: &'static LakeRun) -> HashMap<Key, &'static StreamSrc> {
    let mut m = HashMap::new();
    if let Some(e) = &run.egress {
        m.insert((Kind::Egress, None), e);
    }
    for st in run.stories.values() {
        if let Some(a) = &st.agent {
            m.insert((Kind::Agent, Some(st.n)), a);
        }
        if let Some(c) = &st.cond {
            m.insert((Kind::Conditions, Some(st.n)), c);
        }
    }
    m
}

struct Collector {
    cursors: HashMap<Key, Option<String>>,
    local: HashMap<Key, Vec<u8>>,
}

/// One poll: discover the streams from the listing, read each until an empty page, then ask again at once.
async fn poll(node: &Node, c: &mut Collector, m: &Moment, rng: &mut Rng, full: &HashMap<Key, Vec<u8>>, tally: &Tally) -> Result<(), String> {
    let listing = node.scopes(RUN_ID).await?;
    let mut keys: Vec<(Key, bool)> = Vec::new();
    for s in listing["streams"].as_array().unwrap() {
        let kind = if s["stream"] == "egress" { Kind::Egress } else { return Err(format!("unexpected run stream {s}")) };
        keys.push(((kind, None), s["final"].as_bool().unwrap()));
    }
    for st in listing["stories"].as_array().unwrap() {
        let n = st["n"].as_u64().unwrap() as u32;
        for s in st["streams"].as_array().unwrap() {
            let kind = match s["stream"].as_str().unwrap() {
                "agent" => Kind::Agent,
                "conditions" => Kind::Conditions,
                other => return Err(format!("unexpected story stream {other}")),
            };
            keys.push(((kind, Some(n)), s["final"].as_bool().unwrap()));
        }
    }
    let listed: BTreeSet<String> = keys.iter().map(|(k, _)| format!("{k:?}")).collect();
    let held: BTreeSet<String> = m.streams.iter().map(|s| format!("{:?}", (s.kind, s.story))).collect();
    if listed != held {
        return Err(format!("T={}: the listing names streams {listed:?}, the node holds {held:?}", m.t));
    }
    for (key, listed_final) in keys {
        let cursor = c.cursors.entry(key).or_default();
        let local = c.local.entry(key).or_default();
        let final_seen;
        loop {
            let size = rng.range(1, PAGE_RANDOM_MAX);
            let page = node.events(RUN_ID, key.0, key.1, cursor.as_deref(), size).await?;
            tally.add("pages", 1);
            if page.lines.is_empty() {
                if page.next != *cursor {
                    return Err(format!("T={} {key:?}: an empty page moved the cursor {cursor:?} -> {:?}", m.t, page.next));
                }
                final_seen = page.final_;
                break;
            }
            tally.add("lines", page.lines.len());
            local.extend_from_slice(&join_lines(&page.lines));
            *cursor = page.next;
        }
        if final_seen != listed_final {
            return Err(format!("T={} {key:?}: events say final={final_seen}, the listing says {listed_final}", m.t));
        }
        if final_seen && *local != full[&key] {
            return Err(format!(
                "T={} {key:?}: the stream is final with an empty page but the collector holds {} bytes of the {} the file has (it would never get the rest)",
                m.t,
                local.len(),
                full[&key].len()
            ));
        }
        // nothing new exists: the same call gives an empty page and the same cursor
        let again = node.events(RUN_ID, key.0, key.1, cursor.as_deref(), PAGE_BIG).await?;
        if !again.lines.is_empty() || again.next != *cursor {
            return Err(format!("T={} {key:?}: an immediate second read returned {} lines / cursor {:?} instead of an empty page at {cursor:?}", m.t, again.lines.len(), again.next));
        }
        tally.add("idle_reads", 1);
    }
    Ok(())
}

async fn collector_trial(run: &'static LakeRun, scenario: Scenario, polls: usize, inside_lines: bool, tally: &Tally, tag: &str) -> Result<(), String> {
    let node = Node::start().await;
    let mut rp = Replay::new(&node, run, RUN_ID);
    rp.monotone = true;
    let mut rng = Rng::seeded(&run.label, tag.len() as u64 + polls as u64);
    tally.add("collector_trials", 1);
    let pool: Vec<(f64, Variant)> = pick_times(run, POOL_T).into_iter().filter(|(t, _)| *t < run.end).collect();
    let mut times: Vec<(f64, Variant)> = Vec::new();
    if inside_lines {
        // polls that land inside a line, then the same instant with the line whole, then a line being written again
        let Some((t, _)) = pool.iter().find(|(_, v)| *v == Variant::HalfLast) else { return Ok(()) };
        times.extend([Variant::HalfLast, Variant::NoNewline, Variant::Clean, Variant::HalfNext].map(|v| (*t, v)));
        tally.add("inside_line_trials", 1);
    } else if !pool.is_empty() {
        for _ in 0..polls.saturating_sub(1) {
            times.push(pool[rng.range(0, pool.len() - 1)]);
        }
        times.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    }
    times.push((run.end + AFTER_END_SECONDS, Variant::Clean));
    let full: HashMap<Key, Vec<u8>> = streams_of_run(run).into_iter().map(|(k, s)| (k, full_bytes(s))).collect();
    let mut c = Collector { cursors: HashMap::new(), local: HashMap::new() };
    for (i, (t, v)) in times.iter().enumerate() {
        let m = rp.apply(&node, *t, *v, scenario);
        tally.add("polls", 1);
        poll(&node, &mut c, &m, &mut rng, &full, tally).await.map_err(|e| format!("trial {tag} poll {i}/{} {scenario:?} {v:?}: {e}", times.len()))?;
    }
    // after the last poll (at the end, job terminal) every stream equals its original file
    for (key, want) in &full {
        let got = c.local.get(key).cloned().unwrap_or_default();
        if &got != want {
            let at = got.iter().zip(want.iter()).position(|(a, b)| a != b).unwrap_or(got.len().min(want.len()));
            return Err(format!("trial {tag} {key:?}: collector copy has {} bytes, the original {}; first difference at byte {at}", got.len(), want.len()));
        }
        tally.add("logs_rebuilt", 1);
        tally.add("bytes_rebuilt", want.len());
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn p2_a_collector_that_polls_at_times_rebuilds_every_log() {
    for_runs("p2", with_streams, |run, tally| async move {
        let mut rng = Rng::seeded(&run.label, 5);
        if run.big {
            return collector_trial(run, Scenario::Normal, BIG_RUN_POLLS, false, &tally, "big").await;
        }
        let k = rng.range(COLLECTOR_POLLS_MIN, COLLECTOR_POLLS_MAX);
        collector_trial(run, Scenario::Normal, k, false, &tally, "random").await?;
        collector_trial(run, Scenario::Normal, 0, true, &tally, "lines").await?;
        // a collector that was off for the whole run: one early poll, then one after the end
        collector_trial(run, Scenario::Normal, 2, false, &tally, "gap").await?;
        // the harness crashed: no run-status.json at all, or `started` forever; only the job closes the run
        let scenario = if run.closing_state() || run.never_settled() { Scenario::Crash } else { Scenario::CrashStarted };
        collector_trial(run, scenario, rng.range(COLLECTOR_POLLS_MIN, CRASH_POLLS_MAX), false, &tally, "crash").await
    })
    .await;
}

// ---------------------------------------------------------------- P3

fn check_listing(run: &LakeRun, m: &Moment, l: &serde_json::Value) -> Result<(), String> {
    let ctx = format!("T={} end={} scenario status={:?} job={:?}", m.t, m.at_end, m.run_status_state, m.job_label);
    if l["final"].as_bool() != Some(m.expect_final) {
        return Err(format!("{ctx}: listing final={} but (status closing OR job terminal) AND no live job is {}", l["final"], m.expect_final));
    }
    let want_state = m.run_status_state.as_deref().filter(|s| matches!(*s, "started" | "finished" | "failed" | "stopped")).unwrap_or("unknown");
    if l["run_state"] != want_state {
        return Err(format!("{ctx}: run_state {} expected {want_state}", l["run_state"]));
    }
    if l["job"].as_str() != m.job_id.as_deref() || l["job_state"].as_str() != m.job_label {
        return Err(format!("{ctx}: job {} / {} expected {:?} / {:?}", l["job"], l["job_state"], m.job_id, m.job_label));
    }
    let listed: BTreeSet<u32> = l["stories"].as_array().unwrap().iter().map(|s| s["n"].as_u64().unwrap() as u32).collect();
    if listed != m.started {
        return Err(format!("{ctx}: listed stories {listed:?}, started stories {:?}", m.started));
    }
    let mut stream_set: BTreeSet<String> = BTreeSet::new();
    for s in l["stories"].as_array().unwrap() {
        let n = s["n"].as_u64().unwrap() as u32;
        let want = m.ended.contains(&n) || m.expect_final;
        if s["final"].as_bool() != Some(want) {
            return Err(format!("{ctx}: story {n} final={} expected {want} (ended {}, run final {})", s["final"], m.ended.contains(&n), m.expect_final));
        }
        if m.ended.contains(&n) {
            let status = run.stories[&n].status.as_deref().unwrap();
            if s["state"].as_str() != Some(&status.to_lowercase()) {
                return Err(format!("{ctx}: story {n} state {} for a story recorded {status}", s["state"]));
            }
        }
        for x in s["streams"].as_array().unwrap() {
            stream_set.insert(format!("{}:{n}", x["stream"].as_str().unwrap()));
            if x["final"].as_bool() != Some(want) {
                return Err(format!("{ctx}: story {n} stream {} final={} expected {want}", x["stream"], x["final"]));
            }
        }
    }
    for x in l["streams"].as_array().unwrap() {
        stream_set.insert(x["stream"].as_str().unwrap().to_string());
        if x["final"].as_bool() != Some(m.expect_final) {
            return Err(format!("{ctx}: egress final={} expected {}", x["final"], m.expect_final));
        }
    }
    let held: BTreeSet<String> = m
        .streams
        .iter()
        .map(|s| match s.story {
            Some(n) => format!("{}:{n}", s.kind.stream()),
            None => s.kind.stream().to_string(),
        })
        .collect();
    if stream_set != held {
        return Err(format!("{ctx}: listed streams {stream_set:?}, held {held:?}"));
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn p3_final_flags_follow_run_status_and_job() {
    for_runs("p3", any_run, |run, tally| async move {
        let node = Node::start().await;
        let mut rp = Replay::new(&node, run, RUN_ID);
        for (t, v) in pick_times(run, MAX_T_P3) {
            let at_end = t >= run.end;
            let mut scenarios = vec![Scenario::Normal, Scenario::Crash, Scenario::CrashStarted];
            if at_end {
                scenarios.push(Scenario::Resumed);
            }
            for sc in scenarios {
                let m = rp.apply(&node, t, v, sc);
                let l = node.scopes(RUN_ID).await?;
                check_listing(run, &m, &l).map_err(|e| format!("{sc:?} {v:?}: {e}"))?;
                tally.add("listings", 1);
                if at_end && sc == Scenario::Resumed && m.expect_final {
                    return Err(format!("{sc:?}: a resumed run (new job running) must not be final"));
                }
                if at_end && matches!(sc, Scenario::Crash | Scenario::CrashStarted) && !l["final"].as_bool().unwrap() {
                    return Err(format!("{sc:?}: a crashed harness with a terminal job must close the run"));
                }
                // the events route agrees with the listing, stream by stream
                for s in &m.streams {
                    let p = node.events(RUN_ID, s.kind, s.story, None, 1).await?;
                    let want = match s.story {
                        Some(n) => m.ended.contains(&n) || m.expect_final,
                        None => m.expect_final,
                    };
                    if p.final_ != want {
                        return Err(format!("{sc:?} T={t}: events {} story {:?} final={} but the listing rule gives {want}", s.kind.stream(), s.story, p.final_));
                    }
                    tally.add("event_flags", 1);
                }
            }
        }
        Ok(())
    })
    .await;
}

// ---------------------------------------------------------------- P4

fn walk_files(dir: &Path, rel: &str, out: &mut Vec<String>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.filter_map(|e| e.ok()) {
        let name = e.file_name().to_string_lossy().to_string();
        let r = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            walk_files(&e.path(), &r, out);
        } else {
            out.push(r);
        }
    }
}

fn is_stream_name(name: &str) -> bool {
    name == "egress.jsonl" || (name.starts_with("stories/") && (name.ends_with("/agent-events.jsonl") || name.ends_with("/conditions.jsonl")))
}

#[tokio::test(flavor = "multi_thread")]
async fn p4_scope_files_equal_their_sources() {
    for_runs("p4", any_run, |run, tally| async move {
        let node = Node::start().await;
        let mut rp = Replay::new(&node, run, RUN_ID);
        let rel = node.run_rel(RUN_ID);
        for (t, v) in pick_times(run, MAX_T_P4) {
            let m = rp.apply(&node, t, v, Scenario::Normal);
            let l = node.scopes(RUN_ID).await?;
            let mut listed: BTreeMap<String, (bool, u64)> = BTreeMap::new();
            for f in l["files"].as_array().unwrap() {
                listed.insert(f["name"].as_str().unwrap().into(), (f["final"].as_bool().unwrap(), f["size"].as_u64().unwrap()));
            }
            for s in l["stories"].as_array().unwrap() {
                for f in s["files"].as_array().unwrap() {
                    listed.insert(f["name"].as_str().unwrap().into(), (f["final"].as_bool().unwrap(), f["size"].as_u64().unwrap()));
                }
            }
            for (name, (final_, size)) in &listed {
                let r = node.get("/v1/runs/scope-file", &[("run", rel.as_str()), ("name", name.as_str())]).await;
                if r.status != HTTP_OK {
                    return Err(format!("T={t}: {name} is listed but scope-file gives {} {}", r.status, String::from_utf8_lossy(&r.body[..r.body.len().min(200)])));
                }
                let on_disk = std::fs::read(rp.dir.join(name)).map_err(|e| format!("T={t}: {name} is listed but not in the replay folder: {e}"))?;
                if r.body != on_disk {
                    return Err(format!("T={t}: {name}: scope-file returned {} bytes, the file holds {}", r.body.len(), on_disk.len()));
                }
                if r.body.len() as u64 != *size {
                    return Err(format!("T={t}: {name}: listing size {size}, served {}", r.body.len()));
                }
                // files copied from the lake equal the lake's file
                let lake_src = if let Some(rest) = name.strip_prefix("stories/") {
                    let (n, file) = rest.split_once('/').unwrap();
                    let st = run.stories.get(&n.parse::<u32>().unwrap()).unwrap();
                    st.files.iter().find(|(r, _)| r == file).map(|(_, p)| p.clone())
                } else {
                    run.run_files.iter().find(|(r, _)| r == name).map(|(_, p)| p.clone())
                };
                if let Some(p) = lake_src {
                    if std::fs::read(&p).unwrap() != r.body {
                        return Err(format!("T={t}: {name}: served bytes differ from the lake file {}", p.display()));
                    }
                    tally.add("files_equal_lake", 1);
                }
                let header = r.header(FINAL_HEADER);
                let want = if *final_ { "1" } else { "0" };
                if header.as_deref() != Some(want) {
                    return Err(format!("T={t}: {name}: x-dbench-final {header:?}, the listing says final={final_}"));
                }
                tally.add("files", 1);
            }
            // nothing the node holds under an allow-listed name is left out of the listing
            let mut present = Vec::new();
            walk_files(&rp.dir, "", &mut present);
            for name in present {
                if is_stream_name(&name) || dbench::collect::parse_name(&name).is_none() {
                    continue;
                }
                if !listed.contains_key(&name) {
                    return Err(format!("T={t} (end {}, started {:?}): {name} is in the folder under an allow-listed name but not in the listing", m.at_end, m.started));
                }
                tally.add("present_listed", 1);
            }
            tally.add("moments", 1);
        }
        Ok(())
    })
    .await;
}

// ---------------------------------------------------------------- P5

#[tokio::test(flavor = "multi_thread")]
async fn p5_absent_is_not_an_error() {
    for_runs("p5", any_run, |run, tally| async move {
        let node = Node::start().await;
        let mut rp = Replay::new(&node, run, RUN_ID);
        for (t, v) in pick_times(run, MAX_T_P5) {
            let m = rp.apply(&node, t, v, Scenario::Normal);
            let l = node.scopes(RUN_ID).await?;
            let held: BTreeSet<(Kind, Option<u32>)> = m.streams.iter().map(|s| (s.kind, s.story)).collect();
            // every story the run has that has not started, plus a story the run never had
            let mut absent: Vec<u32> = run.stories.keys().filter(|n| !m.started.contains(n)).copied().collect();
            absent.push(NEVER_STORY);
            for n in absent {
                if l["stories"].as_array().unwrap().iter().any(|s| s["n"].as_u64() == Some(n as u64)) {
                    return Err(format!("T={t}: story {n} has not started but is listed"));
                }
                for kind in [Kind::Agent, Kind::Conditions] {
                    let p = node.events(RUN_ID, kind, Some(n), None, PAGE_BIG).await.map_err(|e| format!("T={t}: a story that has not started is an error: {e}"))?;
                    if !p.lines.is_empty() || p.next.is_some() || p.final_ != m.expect_final {
                        return Err(format!("T={t}: story {n} {}: lines {} next {:?} final {} (run final {})", kind.stream(), p.lines.len(), p.next, p.final_, m.expect_final));
                    }
                    tally.add("absent_stories", 1);
                }
            }
            // a started story without a conditions or agent log, and a run without an egress log
            for st in m.started.iter().copied() {
                for kind in [Kind::Agent, Kind::Conditions] {
                    if held.contains(&(kind, Some(st))) {
                        continue;
                    }
                    let p = node.events(RUN_ID, kind, Some(st), None, PAGE_BIG).await.map_err(|e| format!("T={t}: a missing log is an error: {e}"))?;
                    if !p.lines.is_empty() || p.next.is_some() {
                        return Err(format!("T={t}: story {st} {} has no file but the route returned {} lines, next {:?}", kind.stream(), p.lines.len(), p.next));
                    }
                    tally.add("absent_logs", 1);
                }
            }
            if !held.contains(&(Kind::Egress, None)) {
                let p = node.events(RUN_ID, Kind::Egress, None, None, PAGE_BIG).await.map_err(|e| format!("T={t}: a missing egress log is an error: {e}"))?;
                if !p.lines.is_empty() || p.next.is_some() || p.final_ != m.expect_final {
                    return Err(format!("T={t}: no egress file but lines {} next {:?} final {}", p.lines.len(), p.next, p.final_));
                }
                tally.add("absent_egress", 1);
            }
            tally.add("moments", 1);
        }
        Ok(())
    })
    .await;
}

// ---------------------------------------------------------------- the run set itself

#[test]
fn the_run_set_covers_the_lake() {
    let Some(runs) = runs() else {
        eprintln!("SKIPPED the_run_set_covers_the_lake: the lake is absent on this machine");
        return;
    };
    let count = |state: &str| runs.iter().filter(|r| r.real_state == state).count();
    assert!(count("failed") >= 4, "failed runs: {}", count("failed"));
    assert!(count("stopped") >= 8, "stopped runs: {}", count("stopped"));
    assert!(runs.iter().filter(|r| r.never_settled()).count() >= 3);
    assert!(count("finished") >= 15, "finished runs: {}", count("finished"));
    let nodes: std::collections::BTreeSet<&str> = runs.iter().map(|r| r.node.as_str()).collect();
    assert!(nodes.len() >= MIN_NODES, "nodes in the run set: {nodes:?}");
    let big = runs
        .iter()
        .flat_map(|r| r.stories.values())
        .filter_map(|s| s.agent.as_ref())
        .filter(|a| !a.idx.capped && a.idx.ends.len() > BIG_LOG_LINES)
        .count();
    assert!(big >= BIG_LOGS_MIN, "uncapped logs of more than {BIG_LOG_LINES} lines: {big}");
}


// ---------------------------------------------------------------- negative controls

/// The properties can fail: each control damages the node, the oracle or the expectation by one thing and the check
/// must say so. A property that never failed proves nothing.
#[tokio::test(flavor = "multi_thread")]
async fn negative_controls_the_checks_do_fail() {
    let Some(runs) = runs() else {
        eprintln!("SKIPPED negative_controls: the lake is absent on this machine");
        return;
    };
    let run: &'static LakeRun = runs
        .iter()
        .filter(|r| !r.big && r.real_state == "finished" && r.stories.values().any(|s| s.agent.as_ref().is_some_and(|a| a.idx.ends.len() > 60)))
        .min_by_key(|r| r.stories.values().filter_map(|s| s.agent.as_ref()).map(|a| a.idx.full_len).sum::<u64>())
        .expect("a finished run with a log of more than 60 lines");
    let node = Node::start().await;
    let mut rp = Replay::new(&node, run, RUN_ID);
    let tally = Tally::new();
    let m = rp.apply(&node, run.end - 1.0, Variant::Clean, Scenario::Normal);
    let s = m.streams.iter().find(|s| s.kind == Kind::Agent && s.src.expected(s.len).len() > 60).expect("an agent log with 60 lines");
    let original = std::fs::read(&s.path).unwrap();
    let ranges = s.src.expected(s.len);
    let cursors = cursor_oracle(&original, &ranges, s.kind);
    let check = |data: &[u8]| {
        let data = data.to_vec();
        let (ranges, cursors, node, tally) = (ranges.clone(), cursors.clone(), &node, &tally);
        async move {
            let chk = StreamCheck { node, s, data: &data, ranges: &ranges, cursors: &cursors, tally };
            chk.pass("control", &mut || PAGE_BIG, (0, None), None).await
        }
    };
    assert!(check(&original).await.is_ok(), "the undamaged node must pass");
    // 1. one byte of line 40 differs on the node
    let (a, b) = ranges[40];
    let mut damaged = original.clone();
    let at = (a..b).find(|i| damaged[*i].is_ascii_lowercase() && *i > a + 20).unwrap();
    damaged[at] = if damaged[at] == b'q' { b'z' } else { b'q' };
    std::fs::write(&s.path, &damaged).unwrap();
    let e = check(&original).await.expect_err("a changed byte must be found");
    assert!(e.contains("differs"), "{e}");
    // 2. the node lost its last line
    std::fs::write(&s.path, &original[..ranges[ranges.len() - 1].0]).unwrap();
    let e = check(&original).await.expect_err("a missing last line must be found");
    assert!(e.contains("empty page after") || e.contains("delivered"), "{e}");
    // 3. the node returns a line twice
    let mut doubled = original.clone();
    doubled.extend_from_slice(&original[ranges[5].0..ranges[5].1 + 1]);
    std::fs::write(&s.path, &doubled).unwrap();
    let e = check(&original).await.expect_err("a duplicated line must be found");
    assert!(e.contains("beyond") || e.contains("differs"), "{e}");
    std::fs::write(&s.path, &original).unwrap();
    // 4. the expectation of the final flag is wrong
    let l = node.scopes(RUN_ID).await.unwrap();
    assert!(check_listing(run, &m, &l).is_ok());
    let mut wrong = rp.apply(&node, run.end - 1.0, Variant::Clean, Scenario::Normal);
    wrong.expect_final = !wrong.expect_final;
    assert!(check_listing(run, &wrong, &l).is_err(), "a wrong expected final flag must be found");
    // 5. the collector is told a log is complete that is not
    let mut c = Collector { cursors: HashMap::new(), local: HashMap::new() };
    let mut full: HashMap<Key, Vec<u8>> = streams_of_run(run).into_iter().map(|(k, s)| (k, full_bytes(s))).collect();
    let end = rp.apply(&node, run.end + AFTER_END_SECONDS, Variant::Clean, Scenario::Normal);
    let mut rng = Rng::seeded("control", 1);
    poll(&node, &mut c, &end, &mut rng, &full, &tally).await.expect("a whole collector read passes");
    let key = (s.kind, s.story);
    full.get_mut(&key).unwrap().push(b'x');
    let mut c = Collector { cursors: HashMap::new(), local: HashMap::new() };
    assert!(poll(&node, &mut c, &end, &mut rng, &full, &tally).await.is_err(), "a final stream that lacks bytes must be found");
    eprintln!("negative controls: damaged byte, lost line, duplicated line, wrong final flag, incomplete final stream: all found, on {}", run.label);
}
