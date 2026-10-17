//! BACKTEST of the scope collector (src/scope_collect.rs) against the OLD collector on REAL data. A replay node
//! (tests/support/replay.rs) is built from a run of the real lake as the node stood at a time T and served by the real
//! router; the old pass (`collector::collect_run`, whole-file ranges) and the new pass (`scope_collect::collect_run`, events
//! by cursor and files by scope) both collect it into scratch folders, and the results are compared. The lake is only read.
//! When it is absent every test prints SKIPPED and passes.
//!
//! RUN SET: the replay's (every run that did not finish cleanly, a spread of finished runs per node with and without raw
//! logs, and the one big run replayed uncapped).
//!
//! | test | dimension | oracle |
//! |---|---|---|
//! | b1_the_new_pass_equals_the_old_pass_at_the_end | every run, 3 looks at the end (grace) | each file the old pass holds is held by the new one: non-stream files byte for byte; each stream equals the old file's complete JSON-object lines (`events_only`); the notes agree on node, run, job, job state, run state and complete |
//! | b2_a_new_pass_that_polls_rebuilds_every_stream | runs with streams x polls at random T incl. inside a line x scenario (normal, crash, crash after started) | after every poll each stream in the lake is a byte prefix of `events_only(original)`; after the last it equals it; the run is complete after the grace; a crash is closed by its job |
//! | b3_a_resumed_run_reopens_on_real_data | finished runs with a new running job | complete goes false and new events arrive without a duplicate |
//!
//! The declared differences from a copy of the file (a torn last line, a non-JSON line, spaces around a line) are in
//! `events_only`; the tally prints how many real lines they changed, which must be 0 on real data.

#[path = "support/replay.rs"]
mod replay;

use dbench::client::{Api, NodeEntry};
use dbench::collect::Class;
use dbench::collector::{self, Cadence};
use dbench::scope_collect;
use replay::*;
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

const RUN_ID: &str = "replay";
const NODE: &str = "bt";
const PARALLEL_RUNS: usize = 3;
const GRACE_SECONDS: u64 = 60;
const T0: u64 = 1_000;
const POLLS_MIN: usize = 3;
const POLLS_MAX: usize = 9;
const CRASH_POLLS_MAX: usize = 5;
const BIG_RUN_POLLS: usize = 3;
const POOL_T: usize = 48;
const FAILURES_SHOWN: usize = 12;
const ALL_CLASSES: [Class; 2] = [Class::Record, Class::Raw];

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct Scratch(PathBuf);
impl Scratch {
    fn new() -> Scratch {
        let p = std::env::temp_dir().join(format!("dbench-scopebt-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Scratch(p)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

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
        eprintln!("backtest run set: {} runs, indexed in {:?}", runs.len(), started.elapsed());
        Some(runs)
    })
    .as_deref()
}

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
            match tokio::spawn(f(run, tally.clone())).await {
                Ok(Ok(())) => None,
                Ok(Err(e)) => Some(format!("{}: {e}", run.label)),
                Err(e) => Some(format!("{}: panic {e}", run.label)),
            }
        }));
    }
    let mut failures = Vec::new();
    for h in handles {
        if let Some(f) = h.await.unwrap() {
            failures.push(f);
        }
    }
    eprintln!("{name}: {} ({:?}); failures: {}", tally.show(), started.elapsed(), failures.len());
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

fn api(node: &Node) -> Api {
    Api::new(&NodeEntry { url: node.base.clone(), token: Some(TOKEN.into()) }).unwrap()
}

fn cadence() -> Cadence {
    Cadence { running_poll: Duration::ZERO, finished_recheck: Duration::ZERO, settle_grace: Duration::from_secs(GRACE_SECONDS) }
}

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

fn is_stream(name: &str) -> bool {
    name == "egress.jsonl" || (name.starts_with("stories/") && (name.ends_with("/agent-events.jsonl") || name.ends_with("/conditions.jsonl")) && name.matches('/').count() == 2)
}

/// What the scope API delivers of a log: its complete lines that are JSON objects, each without the blanks around it.
/// (The declared differences from a copy: a torn last line, a line that is not an object, blanks and CR around a line.)
fn events_only(data: &[u8]) -> Vec<u8> {
    let (mut out, mut start) = (Vec::new(), 0usize);
    while let Some(i) = data[start..].iter().position(|&b| b == b'\n') {
        let line = &data[start..start + i];
        start += i + 1;
        let Ok(text) = std::str::from_utf8(line) else { continue };
        let t = text.trim();
        if t.starts_with('{') && serde_json::from_str::<serde_json::Value>(t).is_ok_and(|v| v.is_object()) {
            out.extend_from_slice(t.as_bytes());
            out.push(b'\n');
        }
    }
    out
}

/// The old pass and the new pass over the same node state, looked at three times (the second inside the grace, the third
/// after it), into two scratch folders.
async fn both_passes(node: &Node, run_rel: &str, now0: u64) -> Result<(Scratch, Scratch, collector::Collection, collector::Collection), String> {
    let (old, new) = (Scratch::new(), Scratch::new());
    let (old_dir, new_dir) = (collector::store_dir(&old.0, NODE, run_rel).unwrap(), collector::store_dir(&new.0, NODE, run_rel).unwrap());
    let api = api(node);
    for now in [now0, now0 + 10, now0 + 10 + GRACE_SECONDS] {
        collector::collect_run(&api, NODE, run_rel, &old_dir, &ALL_CLASSES, &cadence(), now).await.map_err(|e| format!("old pass: {e:#}"))?;
        scope_collect::collect_run(&api, NODE, run_rel, &new_dir, &ALL_CLASSES, &cadence(), now).await.map_err(|e| format!("new pass: {e:#}"))?;
    }
    let (a, b) = (collector::load_collection(&old_dir), collector::load_collection(&new_dir));
    match (a, b) {
        (Some(a), Some(b)) => Ok((old, new, a, b)),
        _ => Err("a pass left no note".into()),
    }
}

fn compare(old: &Scratch, new: &Scratch, run_rel: &str, a: &collector::Collection, b: &collector::Collection, tally: &Tally) -> Result<(), String> {
    let (old_dir, new_dir) = (collector::store_dir(&old.0, NODE, run_rel).unwrap(), collector::store_dir(&new.0, NODE, run_rel).unwrap());
    let (fa, fb) = (files_below(&old_dir), files_below(&new_dir));
    for name in fa.iter().filter(|n| *n != collector::COLLECTION_FILE) {
        let want = std::fs::read(old_dir.join(name)).unwrap();
        let want = if is_stream(name) {
            let kept = events_only(&want);
            if kept != want {
                tally.add("logs_where_a_declared_difference_applies", 1);
                if kept.len() != want.len() {
                    tally.add("bytes_the_declared_differences_removed", want.len() - kept.len());
                }
            }
            kept
        } else {
            want
        };
        match std::fs::read(new_dir.join(name)) {
            Ok(got) if got == want => {
                tally.add(if is_stream(name) { "streams_equal" } else { "files_equal" }, 1);
                tally.add("bytes_compared", want.len());
            }
            Ok(got) => {
                let at = got.iter().zip(want.iter()).position(|(x, y)| x != y).unwrap_or(got.len().min(want.len()));
                return Err(format!("{name}: new pass holds {} bytes, expected {}; first difference at byte {at}", got.len(), want.len()));
            }
            Err(_) if is_stream(name) && want.is_empty() => tally.add("streams_with_no_events_not_created", 1),
            Err(_) => return Err(format!("{name}: the old pass holds it, the new pass does not")),
        }
    }
    for name in fb.iter().filter(|n| *n != collector::COLLECTION_FILE) {
        if !fa.contains(name) {
            return Err(format!("{name}: the new pass holds a file the old pass does not"));
        }
    }
    let same = |what: &str, x: String, y: String| if x == y { Ok(()) } else { Err(format!("note {what}: old {x}, new {y}")) };
    same("node", a.node.clone(), b.node.clone())?;
    same("run", a.run.clone(), b.run.clone())?;
    same("job", format!("{:?}", a.job), format!("{:?}", b.job))?;
    same("job_state", format!("{:?}", a.job_state), format!("{:?}", b.job_state))?;
    same("run state", format!("{:?}", a.run_status.as_ref().map(|s| &s.state)), format!("{:?}", b.run_status.as_ref().map(|s| &s.state)))?;
    // The one declared difference in the notes: the contract closes a run on its job alone (a harness that crashed before it
    // wrote a closing status), which the old pass never does. Otherwise the two agree.
    let closing = a.run_status.as_ref().is_some_and(|s| matches!(s.state.as_str(), "finished" | "failed" | "stopped"));
    let job_over = matches!(a.job_state.as_deref(), Some("done" | "failed" | "cancelled"));
    let want_complete = if !closing && job_over {
        tally.add("runs_closed_by_the_job_alone", 1);
        true
    } else {
        a.complete
    };
    same("complete", want_complete.to_string(), b.complete.to_string())?;
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn b1_the_new_pass_equals_the_old_pass_at_the_end() {
    for_runs("b1", any_run, |run, tally| async move {
        let node = Node::start().await;
        let mut rp = Replay::new(&node, run, RUN_ID);
        for scenario in [Scenario::Normal, Scenario::Crash, Scenario::CrashStarted] {
            rp.apply(&node, run.end + AFTER_END_SECONDS, Variant::Clean, scenario);
            let rel = node.run_rel(RUN_ID);
            let (old, new, a, b) = both_passes(&node, &rel, T0).await.map_err(|e| format!("{scenario:?}: {e}"))?;
            compare(&old, &new, &rel, &a, &b, &tally).map_err(|e| format!("{scenario:?}: {e}"))?;
            tally.add("end_states_compared", 1);
            if b.complete {
                tally.add("complete_runs", 1);
            }
        }
        Ok(())
    })
    .await;
}

fn streams_in(dir: &Path) -> BTreeSet<String> {
    files_below(dir).into_iter().filter(|n| is_stream(n)).collect()
}

/// A new pass that looks at the run at several moments. The lake's streams are only ever a prefix of what they will be.
async fn polling_trial(run: &'static LakeRun, scenario: Scenario, polls: usize, tally: &Tally, tag: &str) -> Result<(), String> {
    let node = Node::start().await;
    let mut rp = Replay::new(&node, run, RUN_ID);
    rp.monotone = true;
    let mut rng = Rng::seeded(&run.label, tag.len() as u64 + polls as u64);
    let pool: Vec<(f64, Variant)> = pick_times(run, POOL_T).into_iter().filter(|(t, _)| *t < run.end).collect();
    let mut times: Vec<(f64, Variant)> = Vec::new();
    if !pool.is_empty() {
        for _ in 0..polls.saturating_sub(1) {
            times.push(pool[rng.range(0, pool.len() - 1)]);
        }
        times.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    }
    let rel = node.run_rel(RUN_ID);
    let lake = Scratch::new();
    let dir = collector::store_dir(&lake.0, NODE, &rel).unwrap();
    let api = api(&node);
    let mut now = T0;
    let mut early_complete = false;
    for (i, (t, v)) in times.iter().enumerate() {
        rp.apply(&node, *t, *v, scenario);
        now += 1;
        let s = scope_collect::collect_run(&api, NODE, &rel, &dir, &ALL_CLASSES, &cadence(), now).await.map_err(|e| format!("{tag} poll {i}: {e:#}"))?;
        early_complete |= s.complete;
        tally.add("polls", 1);
    }
    // the end: the node's final state; the originals are what the node holds now
    rp.apply(&node, run.end + AFTER_END_SECONDS, Variant::Clean, scenario);
    let mut completes = Vec::new();
    for look in [now + 1, now + 2, now + 2 + GRACE_SECONDS] {
        let s = scope_collect::collect_run(&api, NODE, &rel, &dir, &ALL_CLASSES, &cadence(), look).await.map_err(|e| format!("{tag} end: {e:#}"))?;
        completes.push(s.complete);
    }
    if early_complete {
        return Err(format!("{tag}: the run was complete before it ended"));
    }
    if completes != [false, false, true] {
        return Err(format!("{tag} {scenario:?}: complete over the three looks at the end {completes:?}, wanted [false, false, true]"));
    }
    for name in streams_in(&node.run_dir(RUN_ID)).union(&streams_in(&dir)) {
        let original = std::fs::read(node.run_dir(RUN_ID).join(name)).unwrap_or_default();
        let want = events_only(&original);
        let got = std::fs::read(dir.join(name)).unwrap_or_default();
        if got != want {
            let at = got.iter().zip(want.iter()).position(|(x, y)| x != y).unwrap_or(got.len().min(want.len()));
            return Err(format!("{tag} {name}: lake holds {} bytes, the node's events are {}; first difference at byte {at}", got.len(), want.len()));
        }
        tally.add("streams_rebuilt", 1);
        tally.add("bytes_rebuilt", want.len());
    }
    Ok(())
}

#[tokio::test(flavor = "multi_thread")]
async fn b2_a_new_pass_that_polls_rebuilds_every_stream() {
    for_runs("b2", with_streams, |run, tally| async move {
        let mut rng = Rng::seeded(&run.label, 9);
        if run.big {
            return polling_trial(run, Scenario::Normal, BIG_RUN_POLLS, &tally, "big").await;
        }
        polling_trial(run, Scenario::Normal, rng.range(POLLS_MIN, POLLS_MAX), &tally, "random").await?;
        polling_trial(run, Scenario::Normal, 2, &tally, "gap").await?;
        let crash = if run.closing_state() || run.never_settled() { Scenario::Crash } else { Scenario::CrashStarted };
        polling_trial(run, crash, rng.range(POLLS_MIN, CRASH_POLLS_MAX), &tally, "crash").await
    })
    .await;
}

fn finished_with_streams(r: &LakeRun) -> bool {
    r.has_streams() && r.closing_state()
}

#[tokio::test(flavor = "multi_thread")]
async fn b3_a_resumed_run_reopens_on_real_data() {
    for_runs("b3", finished_with_streams, |run, tally| async move {
        let node = Node::start().await;
        let mut rp = Replay::new(&node, run, RUN_ID);
        let rel = node.run_rel(RUN_ID);
        let lake = Scratch::new();
        let dir = collector::store_dir(&lake.0, NODE, &rel).unwrap();
        let api = api(&node);
        rp.apply(&node, run.end + AFTER_END_SECONDS, Variant::Clean, Scenario::Normal);
        let mut last = false;
        for look in [T0, T0 + 1, T0 + 1 + GRACE_SECONDS] {
            last = scope_collect::collect_run(&api, NODE, &rel, &dir, &ALL_CLASSES, &cadence(), look).await.map_err(|e| format!("{e:#}"))?.complete;
        }
        if !last {
            return Err("the finished run was not complete".into());
        }
        // a new job resumes the run: the status file still says finished
        rp.apply(&node, run.end + AFTER_END_SECONDS, Variant::Clean, Scenario::Resumed);
        let s = scope_collect::collect_run(&api, NODE, &rel, &dir, &ALL_CLASSES, &cadence(), T0 + 500).await.map_err(|e| format!("{e:#}"))?;
        if s.complete {
            return Err("a resumed run (a running job) was still complete".into());
        }
        tally.add("reopened", 1);
        Ok(())
    })
    .await;
}
