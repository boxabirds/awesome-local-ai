//! Backtest of the verdict at ingest against the verdicts the bench machines recorded (story 23, ingest.verdict).
//! Runs only with the real lake: BENCH_LAKE_STATE=<state dir> cargo test -p dbench --test verdict_backtest -- --ignored
//! A recorded verdict was made on a machine from the runs its checkout held then, without the before-it-ended filter, so
//! a floor may differ; the parts that need no other run (gate, tasks, own score) must match exactly.

use dbench::ingest::inputs::{archived_of, decisions, verdict_runs, LakeSource};
use dbench::ingest::verdict::{baselines, ended_at, ended_early, verdict};
use serde_json::Value;
use std::path::PathBuf;

const PACK: &str = "vidi";
const MAX_LISTED: usize = 30;

#[test]
#[ignore]
fn the_verdicts_computed_at_ingest_match_the_ones_the_machines_recorded() {
    let state = PathBuf::from(std::env::var("BENCH_LAKE_STATE").expect("BENCH_LAKE_STATE: the lake's state dir"));
    let src = LakeSource::new(&state.join("collected"), &state.join("reference"));
    let archived = archived_of(&decisions(&state.join("collected")).unwrap());
    let runs = verdict_runs(&src, &archived, PACK).unwrap();
    let (mut total, mut same, mut local_mismatch, mut floor_only) = (0, 0, Vec::new(), Vec::new());
    for r in runs.iter().filter(|r| !r.reference) {
        let Some(stories) = r.metrics.get("stories").and_then(Value::as_object) else { continue };
        for (key, rec) in stories {
            let Some(recorded) = rec.get("verdict").filter(|_| ended_early(rec)) else { continue };
            let story: i64 = key.parse().unwrap();
            total += 1;
            let base = baselines(&runs, story, &r.id, ended_at(rec).unwrap_or(f64::MAX));
            let v = verdict(rec, story, &base);
            let local_same = recorded.get("gate_green") == Some(&Value::Bool(v.gate_green))
                && recorded.get("unverified_tasks") == Some(&serde_json::json!(v.unverified_tasks))
                && recorded.get("unverified_implementation_tasks") == Some(&serde_json::json!(v.unverified_implementation_tasks))
                && recorded.get("heldout").filter(|h| !h.is_null()) == v.heldout.as_ref();
            let floor_same = recorded.get("heldout_floor").and_then(Value::as_f64) == Some(v.heldout_floor);
            let verdict_same = recorded.get("verdict").and_then(Value::as_str) == Some(v.verdict);
            let line = format!(
                "{}/stories/{key:0>2}: recorded {} floor {} | now {} floor {} ({} baselines)",
                r.id,
                recorded.get("verdict").unwrap_or(&Value::Null),
                recorded.get("heldout_floor").unwrap_or(&Value::Null),
                v.verdict,
                v.heldout_floor,
                base.len()
            );
            if !local_same {
                local_mismatch.push(line);
            } else if !(floor_same && verdict_same) {
                floor_only.push(line);
            } else {
                same += 1;
            }
        }
    }
    println!("{total} recorded verdicts: {same} identical, {} differ only by floor, {} differ in their own parts", floor_only.len(), local_mismatch.len());
    for l in floor_only.iter().take(MAX_LISTED) {
        println!("  floor: {l}");
    }
    for l in local_mismatch.iter().take(MAX_LISTED) {
        println!("  OWN:   {l}");
    }
    assert!(total > 0, "no recorded verdicts found: wrong lake?");
    assert!(local_mismatch.is_empty(), "the parts that need no other run must match");
}

#[test]
#[ignore]
fn explain_the_floors_that_differ() {
    let state = PathBuf::from(std::env::var("BENCH_LAKE_STATE").unwrap());
    let src = LakeSource::new(&state.join("collected"), &state.join("reference"));
    let archived = archived_of(&decisions(&state.join("collected")).unwrap());
    let runs = verdict_runs(&src, &archived, PACK).unwrap();
    for (run, story) in [("gufo-pi/benchmarks/vidi/v2-r1", 10), ("gufo-pi/benchmarks/vidi/v2-r4", 4), ("mlxserve-pi/benchmarks/vidi/v2-mlx26101-r1", 11)] {
        let r = runs.iter().find(|r| r.id.ends_with(run)).unwrap();
        let rec = &r.metrics["stories"][story.to_string()];
        let before = ended_at(rec).unwrap();
        println!("== {run} story {story} ended {before}");
        for b in baselines(&runs, story, &r.id, f64::MAX) {
            let other = runs.iter().find(|x| x.id == b.run).unwrap();
            let fin = other.metrics["stories"][story.to_string()]["finished"].as_f64().unwrap_or(0.0);
            let fault = other.story_accepts.get(&story).map(|a| a.get("harness_fault").cloned().unwrap_or(Value::Null));
            println!("  {} status {} gate {:?} accept {} finished {} {} fault {:?}", b.run.rsplit("benchmarks/vidi/").next().unwrap(), b.status, b.gate_green, b.accept.as_ref().map(|a| a.to_string()).unwrap_or("-".into()), fin, if fin < before { "before" } else { "AFTER" }, fault);
        }
    }
}

#[test]
#[ignore]
fn without_the_before_it_ended_filter_every_recorded_floor_is_reproduced() {
    use dbench::ingest::verdict::floor;
    let state = PathBuf::from(std::env::var("BENCH_LAKE_STATE").unwrap());
    let src = LakeSource::new(&state.join("collected"), &state.join("reference"));
    let archived = archived_of(&decisions(&state.join("collected")).unwrap());
    let runs = verdict_runs(&src, &archived, PACK).unwrap();
    let (mut n, mut bad) = (0, Vec::new());
    for r in runs.iter().filter(|r| !r.reference) {
        let Some(stories) = r.metrics.get("stories").and_then(Value::as_object) else { continue };
        for (key, rec) in stories {
            let Some(recorded) = rec.get("verdict").filter(|_| ended_early(rec)) else { continue };
            let story: i64 = key.parse().unwrap();
            n += 1;
            let all = (floor(&baselines(&runs, story, &r.id, f64::MAX)) * 1000.0).round() / 1000.0;
            if recorded.get("heldout_floor").and_then(Value::as_f64) != Some(all) {
                bad.push(format!("{} {key}: recorded {:?} unfiltered {all}", r.id, recorded.get("heldout_floor")));
            }
        }
    }
    println!("{n} recorded, {} not reproduced without the filter: {bad:#?}", bad.len());
}
