//! The verdict on a story the operator ended early: can later stories build on it? Computed at ingest on the host
//! from every run's records (story 23, ingest.verdict), not on the bench machine from whatever runs its checkout
//! happened to hold. The rule moved here from the harness (progress.baselines and progress.base_health); it is not
//! kept there.
//!
//! green: the gate is green, every task that isn't verified is a test task, and the story's own held-out tests do no
//!        worse than the worst healthy baseline for the story (DONE, gate green, with a held-out score); all must pass
//!        when there is none.
//! amber: the gate is green, but an implementation task isn't verified or the held-out tests fall short.
//! red:   the gate is red.
//!
//! A baseline is the same story in another run of the same pack that finished it before this story ended, so a later
//! run never changes a verdict. Partial reruns are never baselines, and a score the machine spoiled (`harness_fault`
//! in its held-out result) says nothing about the build.

use serde_json::Value;

pub const GREEN: &str = "green";
pub const AMBER: &str = "amber";
pub const RED: &str = "red";
/// A task the agent must build (the others are test tasks).
const IMPLEMENTATION: &str = "implementation";
const VERIFIED: &str = "verified";
const DONE: &str = "DONE";
/// When nothing healthy has finished the story before, every held-out test must pass.
const NO_BASELINE_FLOOR: f64 = 1.0;
/// The floor is reported to three places, as the harness did.
const FLOOR_PLACES: f64 = 1000.0;

/// One run's records, as the verdict needs them.
pub struct RunRecords {
    /// The run directory relative to the repository (`combinations/...` or `benchmarks/reference/...`).
    pub id: String,
    pub reference: bool,
    pub metrics: Value,
    /// The run-level held-out result (accept.json, else its summary): a reference build is scored once, at the end.
    pub run_accept: Option<Value>,
    /// Story number -> that story's held-out result (stories/NN/accept.json, else its summary).
    pub story_accepts: std::collections::BTreeMap<i64, Value>,
}

/// The same story in another run, as a candidate floor.
#[derive(Debug, Clone, PartialEq)]
pub struct Baseline {
    pub run: String,
    pub status: String,
    pub gate_green: Option<bool>,
    /// The story's own held-out counts (`by_story[NN]`), None when void or absent.
    pub accept: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Verdict {
    pub verdict: &'static str,
    pub gate_green: bool,
    pub unverified_tasks: Vec<i64>,
    pub unverified_implementation_tasks: Vec<i64>,
    pub heldout: Option<Value>,
    pub heldout_floor: f64,
    pub heldout_ok: bool,
}

fn story_key(story: i64) -> String {
    format!("{story:02}")
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().is_some_and(|x| x != 0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

/// A story's own held-out counts in an accept result.
fn by_story(accept: Option<&Value>, story: i64) -> Option<Value> {
    accept?.get("by_story")?.get(story_key(story)).filter(|v| !v.is_null()).cloned()
}

/// The same story in every other run that finished it before `before`.
pub fn baselines(runs: &[RunRecords], story: i64, exclude: &str, before: f64) -> Vec<Baseline> {
    let mut out = Vec::new();
    for r in runs {
        if r.id == exclude || truthy(r.metrics.get("known_good")) {
            continue; // itself; or diagnostic, built on another run's code: never a baseline
        }
        let Some(s) = r.metrics.get("stories").and_then(|s| s.get(story.to_string())).filter(|s| s.is_object()) else { continue };
        let Some(finished) = number(s.get("finished")).filter(|f| *f != 0.0) else { continue };
        if finished >= before {
            continue; // finished after the story being judged: not known when it ended
        }
        let status = r
            .metrics
            .get("processed")
            .and_then(Value::as_array)
            .and_then(|ps| ps.iter().find(|p| p.get("id").and_then(Value::as_i64) == Some(story)))
            .and_then(|p| p.get("status").and_then(Value::as_str))
            .unwrap_or(DONE)
            .to_string();
        let mut own = by_story(s.get("accept"), story).or_else(|| by_story(r.run_accept.as_ref(), story));
        if own.is_some() && r.story_accepts.get(&story).is_some_and(|a| truthy(a.get("harness_fault"))) {
            own = None; // scored without a working machine: says nothing about the build
        }
        // Reference builds have no harness gate; their agents' own build and tests passed.
        let gate_green = match s.get("gate").and_then(|g| g.get("all_green")) {
            Some(v) => Some(truthy(Some(v))),
            None if r.reference => Some(true),
            None => None,
        };
        out.push(Baseline { run: r.id.clone(), status, gate_green, accept: own });
    }
    out
}

/// The lowest held-out pass rate among the healthy baselines, or 1.0 when there is none.
pub fn floor(base: &[Baseline]) -> f64 {
    base.iter()
        .filter(|b| b.status == DONE && b.gate_green == Some(true))
        .filter_map(|b| {
            let a = b.accept.as_ref()?;
            let total = number(a.get("total")).filter(|t| *t != 0.0)?;
            Some(number(a.get("passed")).unwrap_or(0.0) / total)
        })
        .fold(None, |m: Option<f64>, r| Some(m.map_or(r, |m| m.min(r))))
        .unwrap_or(NO_BASELINE_FLOOR)
}

/// The verdict on story `story` from its record and its baselines.
pub fn verdict(rec: &Value, story: i64, base: &[Baseline]) -> Verdict {
    let gate_green = truthy(rec.get("gate").and_then(|g| g.get("all_green")));
    let rows: Vec<&Value> = rec.get("tasks").and_then(Value::as_array).map(|t| t.iter().collect()).unwrap_or_default();
    let unverified: Vec<&Value> = rows.into_iter().filter(|r| r.get("status").and_then(Value::as_str) != Some(VERIFIED)).collect();
    let n = |r: &&Value| r.get("n").and_then(Value::as_i64);
    let unverified_tasks: Vec<i64> = unverified.iter().filter_map(n).collect();
    let unverified_implementation_tasks: Vec<i64> =
        unverified.iter().filter(|r| r.get("type").and_then(Value::as_str) == Some(IMPLEMENTATION)).filter_map(n).collect();
    let fl = floor(base);
    let heldout = by_story(rec.get("accept"), story);
    let rate = heldout.as_ref().and_then(|h| {
        let total = number(h.get("total")).filter(|t| *t != 0.0)?;
        Some(number(h.get("passed")).unwrap_or(0.0) / total)
    });
    let heldout_ok = rate.is_none_or(|r| r >= fl);
    let verdict = if !gate_green {
        RED
    } else if !unverified_implementation_tasks.is_empty() || !heldout_ok {
        AMBER
    } else {
        GREEN
    };
    Verdict {
        verdict,
        gate_green,
        unverified_tasks,
        unverified_implementation_tasks,
        heldout,
        heldout_floor: (fl * FLOOR_PLACES).round() / FLOOR_PLACES,
        heldout_ok,
    }
}

/// Whether a story record is one the operator ended early (the only ones that get a verdict).
pub fn ended_early(rec: &Value) -> bool {
    rec.get("skip").is_some_and(|s| !s.is_null())
}

/// When the story ended, for choosing its baselines.
pub fn ended_at(rec: &Value) -> Option<f64> {
    number(rec.get("finished")).or_else(|| number(rec.get("agent_finished")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const STORY: i64 = 4;
    const ENDED: f64 = 1000.0;
    const EARLIER: f64 = 900.0;
    const LATER: f64 = 1100.0;

    /// Another run that finished story 4 at `finished`, DONE with gate `gate`, passing `passed` of `total`.
    fn run(id: &str, finished: f64, gate: bool, passed: i64, total: i64) -> RunRecords {
        RunRecords {
            id: id.into(),
            reference: false,
            metrics: json!({"stories": {"4": {"finished": finished, "gate": {"all_green": gate},
                "accept": {"by_story": {"04": {"passed": passed, "total": total}}}}}}),
            run_accept: None,
            story_accepts: Default::default(),
        }
    }

    /// The story being judged: ended early, with this gate, task table and own score.
    fn skipped(gate: bool, tasks: serde_json::Value, own: Option<(i64, i64)>) -> serde_json::Value {
        let accept = own.map(|(p, t)| json!({"by_story": {"04": {"passed": p, "total": t}}}));
        json!({"skip": {"by": "owner"}, "finished": ENDED, "gate": {"all_green": gate}, "tasks": tasks, "accept": accept})
    }

    fn all_verified() -> serde_json::Value {
        json!([{"n": 1, "type": "implementation", "status": "verified"}, {"n": 2, "type": "test", "status": "verified"}])
    }

    fn three_earlier() -> Vec<RunRecords> {
        vec![run("a", EARLIER, true, 6, 6), run("b", EARLIER, true, 5, 6), run("c", EARLIER, true, 4, 6)]
    }

    #[test]
    fn tc40_the_floor_is_the_worst_earlier_healthy_score_and_meeting_it_is_green() {
        let runs = three_earlier();
        let base = baselines(&runs, STORY, "me", ENDED);
        let v = verdict(&skipped(true, all_verified(), Some((4, 6))), STORY, &base);
        assert_eq!((v.verdict, v.heldout_floor, v.heldout_ok), (GREEN, 0.667, true));
    }

    #[test]
    fn tc41_below_the_floor_is_amber() {
        let base = baselines(&three_earlier(), STORY, "me", ENDED);
        let v = verdict(&skipped(true, all_verified(), Some((3, 6))), STORY, &base);
        assert_eq!((v.verdict, v.heldout_ok), (AMBER, false));
    }

    #[test]
    fn tc42_a_red_gate_is_red_whatever_the_score() {
        let base = baselines(&three_earlier(), STORY, "me", ENDED);
        let v = verdict(&skipped(false, all_verified(), Some((6, 6))), STORY, &base);
        assert_eq!((v.verdict, v.gate_green), (RED, false));
    }

    #[test]
    fn tc43_with_no_earlier_run_every_test_must_pass() {
        assert_eq!(floor(&[]), NO_BASELINE_FLOOR);
        let v = verdict(&skipped(true, all_verified(), Some((5, 6))), STORY, &[]);
        assert_eq!((v.verdict, v.heldout_floor), (AMBER, 1.0));
        let v = verdict(&skipped(true, all_verified(), Some((6, 6))), STORY, &[]);
        assert_eq!(v.verdict, GREEN);
    }

    #[test]
    fn tc44_a_run_that_finished_the_story_after_it_ended_is_not_a_baseline() {
        let mut runs = three_earlier();
        runs.push(run("late", LATER, true, 0, 6));
        let base = baselines(&runs, STORY, "me", ENDED);
        assert!(base.iter().all(|b| b.run != "late"));
        assert_eq!(floor(&base), 4.0 / 6.0);
        // Finishing at the very moment it ended is not before it.
        runs.push(run("same", ENDED, true, 0, 6));
        assert!(baselines(&runs, STORY, "me", ENDED).iter().all(|b| b.run != "same"));
    }

    #[test]
    fn tc45_partial_reruns_spoiled_scores_partial_stories_red_gates_and_itself_never_set_the_floor() {
        let mut rerun = run("rerun", EARLIER, true, 0, 6);
        rerun.metrics["known_good"] = json!({"from": "a"});
        let mut spoiled = run("spoiled", EARLIER, true, 0, 6);
        spoiled.story_accepts.insert(STORY, json!({"harness_fault": "no browser"}));
        let mut partial = run("partial", EARLIER, true, 0, 6);
        partial.metrics["processed"] = json!([{"id": STORY, "status": "PARTIAL"}]);
        let red = run("red", EARLIER, false, 0, 6);
        let me = run("me", EARLIER, true, 0, 6);
        let runs = vec![rerun, spoiled, partial, red, me, run("ok", EARLIER, true, 5, 6)];
        let base = baselines(&runs, STORY, "me", ENDED);
        assert!(base.iter().all(|b| b.run != "rerun" && b.run != "me"));
        assert_eq!(base.iter().find(|b| b.run == "spoiled").unwrap().accept, None);
        assert_eq!(floor(&base), 5.0 / 6.0, "only the healthy run counts");
    }

    #[test]
    fn a_reference_build_counts_with_a_green_gate_and_its_run_level_score() {
        let reference = RunRecords {
            id: "benchmarks/reference/vidi/opus-5.5/run-1".into(),
            reference: true,
            metrics: json!({"stories": {"4": {"finished": EARLIER}}}),
            run_accept: Some(json!({"by_story": {"04": {"passed": 2, "total": 4}}})),
            story_accepts: Default::default(),
        };
        let base = baselines(&[reference], STORY, "me", ENDED);
        assert_eq!(base[0].gate_green, Some(true));
        assert_eq!(floor(&base), 0.5);
    }

    #[test]
    fn tc47_only_a_story_the_operator_ended_gets_a_verdict() {
        assert!(ended_early(&skipped(true, all_verified(), None)));
        assert!(!ended_early(&json!({"status": "DONE", "finished": ENDED})));
        assert!(!ended_early(&json!({"skip": null})));
    }

    #[test]
    fn tc48_with_no_own_score_the_verdict_comes_from_the_gate_and_tasks() {
        let base = baselines(&three_earlier(), STORY, "me", ENDED);
        let v = verdict(&skipped(true, all_verified(), None), STORY, &base);
        assert_eq!((v.verdict, v.heldout_ok, v.heldout), (GREEN, true, None));
    }

    #[test]
    fn an_unverified_implementation_task_is_amber_and_an_unverified_test_task_is_not() {
        let impl_gap = json!([{"n": 1, "type": "implementation", "status": "partial"}, {"n": 2, "type": "test", "status": "verified"}]);
        let v = verdict(&skipped(true, impl_gap, Some((6, 6))), STORY, &[]);
        assert_eq!((v.verdict, v.unverified_tasks.clone(), v.unverified_implementation_tasks.clone()), (AMBER, vec![1], vec![1]));
        let test_gap = json!([{"n": 1, "type": "implementation", "status": "verified"}, {"n": 2, "type": "test", "status": "partial"}]);
        let v = verdict(&skipped(true, test_gap, Some((6, 6))), STORY, &[]);
        assert_eq!((v.verdict, v.unverified_tasks), (GREEN, vec![2]));
    }
}
