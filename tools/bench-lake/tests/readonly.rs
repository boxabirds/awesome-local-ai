//! lakelib.access.read_only: TC-77 to TC-81 and TC-84 (TC-82 is Python; TC-83 is in unit.rs; TC-84 in bundle.rs).
//! Also W-2 (TC-108) on a lake given by BENCH_LAKE_HOST_STATE, and on the fixture lake.

mod common;
use bench_lake::{Lake, Record};
use common::*;
use std::path::Path;

const HOST_ENV: &str = "BENCH_LAKE_HOST_STATE";
const SIX: [Record; 6] =
    [Record::RunDescription, Record::Status, Record::Metrics, Record::Finalize, Record::Progress, Record::Collection];
const SOME_STORIES: [i64; 4] = [0, 1, 2, 999];

/// Every question of the library over every run, rendered to text so two sequences can be compared.
fn ask_everything(lake: &Lake) -> Vec<String> {
    let mut out = Vec::new();
    let d = lake.discover();
    out.push(format!("{:?}", d));
    for run in &d.runs {
        out.push(format!("copies {}", lake.copies(&d, &run.id).len()));
        out.push(format!("preferred {:?}", lake.preferred(&d, &run.id).map(|r| r.label.clone())));
        out.push(format!("completeness {:?}", lake.completeness(run)));
        out.push(format!("versions {:?}", lake.rescore_versions(run)));
        for r in &SIX {
            out.push(format!("{r:?} {:?}", lake.bytes(run, r).map(|b| bench_lake::sha256_hex(&b))));
            out.push(format!("{r:?} {:?}", lake.value(run, r).map(|v| bench_lake::canonical(&v))));
        }
        for s in SOME_STORIES {
            for r in [Record::Accept(s), Record::Prompt(s), Record::BaseCommit(s), Record::Gate(s)] {
                out.push(format!("{r:?} {:?}", lake.bytes(run, &r).map(|b| bench_lake::sha256_hex(&b))));
            }
            match lake.log(run, s) {
                Ok(log) => out.push(format!("log {s} {:?} {:?}", log.form(), log.digest())),
                Err(e) => out.push(format!("log {s} {}", e.to_text())),
            }
        }
    }
    out
}

#[test]
fn tc77_the_lake_is_unchanged_after_every_call() {
    let (s, state, lake) = scratch_lake("unchanged");
    let before = snapshot(&state);
    let answers = ask_everything(&lake);
    assert!(answers.len() > 100);
    // also the workspace call, a refusal and an absence
    let run = find(&lake, ID_Q36, Some("gruntus"));
    lake.workspace(&run, 1, &s.join("w")).unwrap();
    let _ = lake.workspace(&run, 1, &state.join("collected/x"));
    assert_eq!(snapshot(&state), before);
}

#[test]
fn tc78_a_read_only_lake_answers_as_before() {
    let (_s, state, lake) = scratch_lake("readonly");
    let want = ask_everything(&lake);
    make_read_only(&state);
    let got = ask_everything(&lake);
    make_writable(&state);
    assert_eq!(got, want);
}

#[test]
fn tc108_w2_read_only_over_a_whole_lake() {
    fn over(state: &Path) -> usize {
        let lake = Lake::in_state_dir(state);
        let before = snapshot(state);
        let d = lake.discover();
        let mut asked = 0;
        for run in &d.runs {
            // every run is answered or named absent: never a panic, never a silent skip
            let _ = lake.value(run, &Record::Status).map(|_| ()).map_err(|e| e.to_text());
            let _ = lake.completeness(run).map(|_| ()).map_err(|e| e.to_text());
            let _ = lake.log(run, 1).map(|l| l.form()).map_err(|e| e.to_text());
            asked += 1;
        }
        assert_eq!(snapshot(state), before, "the lake is unchanged");
        asked
    }
    assert_eq!(over(&fixture_state()), FIXTURE_RUN_COUNT);
    match std::env::var(HOST_ENV) {
        Ok(state) => eprintln!("TC-108: {} runs of {state} asked", over(Path::new(&state))),
        Err(_) => not_run("TC-108 on the host's lake", &format!("{HOST_ENV} is not set; the fixture lake was used")),
    }
}
