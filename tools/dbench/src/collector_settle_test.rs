//! Unit tests of completeness under a feed look (collector::settle_now, story 24 collect.by_changes): the TC-26 and TC-27
//! rule. Under a feed, a held run is complete in the pass it is held; a later change reopens it.

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
