//! Unit tests of the rules a feed look follows (story 24, collect.by_changes): completeness (collector::settle_now, the
//! TC-26 and TC-27 rule: a held run is complete in the pass it is held, a later change reopens it), which runs are
//! visited (collector::named_runs, scope_collect::visits), and the full look's grace, unchanged.

use super::*;

const NOW: u64 = 1_762_560_000;

fn open_run() -> Collection {
    Collection {
        run: "combinations/a/benchmarks/p/r1".into(),
        ..Default::default()
    }
}

#[test]
fn tc26_a_held_run_is_complete_in_the_same_pass_with_no_grace() {
    let mut c = open_run();
    settle_now(&mut c, true, NOW);
    assert!(c.complete);
    assert_eq!(c.settled_at, Some(NOW));
}

#[test]
fn tc26_the_grace_rule_would_have_waited() {
    // The contrast: today's full-look rule needs a second look after the grace.
    let mut c = open_run();
    let cadence = Cadence {
        running_poll: Duration::ZERO,
        finished_recheck: Duration::ZERO,
        settle_grace: Duration::from_secs(60),
    };
    settle(&mut c, true, 0, &cadence, NOW);
    assert!(!c.complete);
}

#[test]
fn tc27_a_run_not_held_is_not_complete_and_a_complete_one_reopens() {
    let mut c = open_run();
    settle_now(&mut c, false, NOW);
    assert!(!c.complete);
    assert_eq!(c.settled_at, None);
    settle_now(&mut c, true, NOW);
    assert!(c.complete);
    settle_now(&mut c, false, NOW + 1);
    assert!(
        !c.complete,
        "a change named by the feed reopens a complete run"
    );
    assert_eq!(c.settled_at, None);
}

fn page(changes: &[&str], runs: &[&str]) -> crate::changes::ChangesPage {
    crate::changes::ChangesPage {
        node_id: "n0".into(),
        changes: changes
            .iter()
            .map(|r| crate::changes::Change {
                run: r.to_string(),
                file: "metrics.json".into(),
                size: 1,
                changed_ms: 1,
            })
            .collect(),
        runs: runs
            .iter()
            .map(|r| crate::changes::RunState {
                run: r.to_string(),
                job: None,
                job_state: None,
                final_: false,
                changed_ms: 1,
            })
            .collect(),
        next: "n0.1".into(),
        more: false,
    }
}

#[test]
fn the_runs_visited_are_the_union_of_every_page_s_changes_and_runs_once_each() {
    let pages = [
        page(&["r/b", "r/a", "r/b"], &["r/c"]),
        page(&["r/a"], &["r/d", "r/c"]),
    ];
    assert_eq!(
        named_runs(&pages).into_iter().collect::<Vec<_>>(),
        vec!["r/a", "r/b", "r/c", "r/d"]
    );
    assert!(
        named_runs(&[page(&[], &[])]).is_empty(),
        "a quiet answer names no run"
    );
}

#[test]
fn a_named_run_is_visited_even_when_due_says_no_and_a_full_look_still_asks_due() {
    use crate::scope_collect::{visits, Look};
    let hour = Cadence {
        running_poll: Duration::ZERO,
        finished_recheck: Duration::from_secs(3_600),
        settle_grace: Duration::ZERO,
    };
    let complete = Collection {
        complete: true,
        collected_at: NOW,
        ..Default::default()
    };
    assert!(
        !due(Some(&complete), NOW + 1, &hour),
        "due says no: complete and checked a second ago"
    );
    assert!(visits(Look::Named, &complete, NOW + 1, &hour));
    assert!(!visits(
        Look::Full { feed: true },
        &complete,
        NOW + 1,
        &hour
    ));
    assert!(!visits(
        Look::Full { feed: false },
        &complete,
        NOW + 1,
        &hour
    ));
    assert!(
        visits(Look::Full { feed: false }, &complete, NOW + 3_600, &hour),
        "the hourly recheck of a full look"
    );
}
