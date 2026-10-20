//! `/slots` snapshots and the freeze detector.

use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

#[derive(Debug, Clone, Deserialize)]
pub struct NextToken {
    #[serde(default)]
    pub n_decoded: u64,
    #[serde(default)]
    pub n_remain: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Slot {
    pub id: u64,
    pub is_processing: bool,
    #[serde(default)]
    pub n_prompt_tokens: u64,
    #[serde(default)]
    pub n_prompt_tokens_processed: u64,
    #[serde(default)]
    pub n_prompt_tokens_cache: u64,
    #[serde(default)]
    pub next_token: Vec<NextToken>,
}

/// Every counter that moves while a request is being served. A slot whose fingerprint is unchanged between two
/// polls made no progress between them.
pub type Fingerprint = (u64, u64, u64, u64, u64, u64);

impl Slot {
    pub fn fingerprint(&self) -> Fingerprint {
        let next = self.next_token.first();
        (
            self.id,
            self.n_prompt_tokens,
            self.n_prompt_tokens_processed,
            self.n_prompt_tokens_cache,
            next.map_or(0, |n| n.n_decoded),
            next.map_or(0, |n| n.n_remain),
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Wedge {
    pub slot: u64,
    pub fingerprint: Fingerprint,
    pub frozen_for: Duration,
}

/// Flags a slot that is processing and whose fingerprint has not changed for longer than `stall`.
pub struct WedgeTracker {
    stall: Duration,
    /// per slot: the fingerprint last seen and when it was first seen
    seen: HashMap<u64, (Fingerprint, Duration)>,
}

impl WedgeTracker {
    pub fn new(stall: Duration) -> Self {
        Self { stall, seen: HashMap::new() }
    }

    /// `now` is time since the attempt began; the tracker only compares differences.
    pub fn observe(&mut self, now: Duration, slots: &[Slot]) -> Option<Wedge> {
        let mut wedge = None;
        for slot in slots {
            if !slot.is_processing {
                self.seen.remove(&slot.id);
                continue;
            }
            let fp = slot.fingerprint();
            match self.seen.get(&slot.id) {
                Some((last, since)) if *last == fp => {
                    let frozen_for = now.saturating_sub(*since);
                    if frozen_for > self.stall && wedge.is_none() {
                        wedge = Some(Wedge { slot: slot.id, fingerprint: fp, frozen_for });
                    }
                }
                _ => {
                    self.seen.insert(slot.id, (fp, now));
                }
            }
        }
        wedge
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const STALL: Duration = Duration::from_secs(45);
    const POLL: Duration = Duration::from_secs(2);

    fn slot(id: u64, processing: bool, processed: u64, decoded: u64) -> Slot {
        Slot {
            id,
            is_processing: processing,
            n_prompt_tokens: 106_337,
            n_prompt_tokens_processed: processed,
            n_prompt_tokens_cache: 51_200,
            next_token: vec![NextToken { n_decoded: decoded, n_remain: 1024 - decoded }],
        }
    }

    /// Polls every two seconds for `secs` seconds with the same slots each time.
    fn poll_unchanged(t: &mut WedgeTracker, slots: &[Slot], secs: u64) -> Option<Wedge> {
        let mut found = None;
        let mut now = Duration::ZERO;
        while now <= Duration::from_secs(secs) {
            found = found.or(t.observe(now, slots));
            now += POLL;
        }
        found
    }

    #[test]
    fn a_processing_slot_whose_counters_stop_is_a_wedge_after_the_stall_time() {
        let mut t = WedgeTracker::new(STALL);
        let w = poll_unchanged(&mut t, &[slot(0, true, 0, 0)], 50).expect("frozen for 50 s");
        assert_eq!(w.slot, 0);
        assert!(w.frozen_for > STALL);
        assert_eq!(w.fingerprint, (0, 106_337, 0, 51_200, 0, 1024));
    }

    #[test]
    fn a_slot_frozen_for_less_than_the_stall_time_is_not_a_wedge() {
        let mut t = WedgeTracker::new(STALL);
        assert_eq!(poll_unchanged(&mut t, &[slot(0, true, 0, 0)], 40), None);
    }

    #[test]
    fn a_slot_that_keeps_moving_is_never_a_wedge() {
        let mut t = WedgeTracker::new(STALL);
        for step in 0..60u64 {
            let now = POLL * step as u32;
            assert_eq!(t.observe(now, &[slot(0, true, step * 512, 0)]), None);
        }
    }

    #[test]
    fn an_idle_slot_is_never_a_wedge_however_long_it_is_unchanged() {
        let mut t = WedgeTracker::new(STALL);
        assert_eq!(poll_unchanged(&mut t, &[slot(0, false, 0, 0)], 600), None);
    }

    #[test]
    fn the_clock_restarts_when_a_counter_moves() {
        let mut t = WedgeTracker::new(STALL);
        assert_eq!(poll_unchanged(&mut t, &[slot(0, true, 0, 0)], 40), None);
        // one token decoded at 42 s: the 40 s already spent frozen does not count against the new state
        let mut now = Duration::from_secs(42);
        assert_eq!(t.observe(now, &[slot(0, true, 0, 1)]), None);
        now += Duration::from_secs(40);
        assert_eq!(t.observe(now, &[slot(0, true, 0, 1)]), None);
    }

    #[test]
    fn one_frozen_slot_is_reported_even_while_the_other_moves() {
        let mut t = WedgeTracker::new(STALL);
        let mut found = None;
        for step in 0..30u64 {
            let now = POLL * step as u32;
            found = found.or(t.observe(now, &[slot(0, true, 0, 0), slot(1, true, step * 512, 0)]));
        }
        assert_eq!(found.expect("slot 0 is frozen").slot, 0);
    }

    #[test]
    fn a_slots_listing_parses_with_missing_fields() {
        let json = r#"[{"id":0,"is_processing":true,"n_prompt_tokens":10,"next_token":[{"n_decoded":1,"n_remain":1023}]},{"id":1,"is_processing":false}]"#;
        let slots: Vec<Slot> = serde_json::from_str(json).unwrap();
        assert_eq!(slots[0].fingerprint(), (0, 10, 0, 0, 1, 1023));
        assert_eq!(slots[1].fingerprint(), (1, 0, 0, 0, 0, 0));
    }
}
