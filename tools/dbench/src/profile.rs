//! Where the time goes: the named phases of a pass, each with the seconds it took, how many times it ran and the
//! bytes it handled.
//!
//! A phase is a leaf: nothing is timed inside another phase, so the phases add up to the wall time of what they
//! describe, and what they do not cover shows as `unaccounted`. A large `unaccounted` means a stretch of code nobody
//! timed; a negative one means two phases overlap, which is a bug in the instrumentation.

use std::collections::BTreeMap;
use std::time::Instant;

const KIB: f64 = 1024.0;
const BYTE_UNITS: [&str; 4] = ["B", "KiB", "MiB", "GiB"];
const PERCENT: f64 = 100.0;
const UNACCOUNTED: &str = "unaccounted";
/// How many of the slowest phases a log line names.
pub const LOG_TOP_PHASES: usize = 6;

#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
pub struct Phase {
    pub seconds: f64,
    pub calls: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(transparent)]
pub struct Profile {
    phases: BTreeMap<&'static str, Phase>,
}

impl Profile {
    /// Run `f` and charge its time to `name`.
    pub fn time<T>(&mut self, name: &'static str, f: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let out = f();
        self.record(name, started.elapsed().as_secs_f64(), 0);
        out
    }

    /// Charge `seconds` and `bytes` to `name`, as one more run of it.
    pub fn record(&mut self, name: &'static str, seconds: f64, bytes: u64) {
        let p = self.phases.entry(name).or_default();
        p.seconds += seconds;
        p.calls += 1;
        p.bytes += bytes;
    }

    /// Count `bytes` against a phase that has just run (the size is known only after the work).
    pub fn add_bytes(&mut self, name: &'static str, bytes: u64) {
        self.phases.entry(name).or_default().bytes += bytes;
    }

    pub fn merge(&mut self, other: &Profile) {
        for (name, p) in &other.phases {
            let mine = self.phases.entry(name).or_default();
            mine.seconds += p.seconds;
            mine.calls += p.calls;
            mine.bytes += p.bytes;
        }
    }

    pub fn get(&self, name: &str) -> Option<&Phase> {
        self.phases.get(name)
    }

    pub fn is_empty(&self) -> bool {
        self.phases.is_empty()
    }

    /// The sum of every phase's seconds.
    pub fn total(&self) -> f64 {
        self.phases.values().map(|p| p.seconds).sum()
    }

    /// Phases from the slowest down; equal times in name order.
    pub fn ranked(&self) -> Vec<(&'static str, &Phase)> {
        let mut v: Vec<_> = self.phases.iter().map(|(n, p)| (*n, p)).collect();
        v.sort_by(|a, b| b.1.seconds.total_cmp(&a.1.seconds).then(a.0.cmp(b.0)));
        v
    }

    /// A table of every phase against `wall` seconds, slowest first, ending in what no phase covers.
    pub fn report(&self, wall: f64) -> String {
        let width = self.phases.keys().map(|n| n.len()).chain([UNACCOUNTED.len()]).max().unwrap_or(0);
        let mut out = format!("{:<width$}  {:>9}  {:>6}  {:>8}  {:>10}\n", "phase", "seconds", "%", "calls", "bytes");
        for (name, p) in self.ranked() {
            out.push_str(&format!("{:<width$}  {:>9.3}  {:>6.1}  {:>8}  {:>10}\n", name, p.seconds, share(p.seconds, wall), p.calls, human_bytes(p.bytes)));
        }
        let rest = wall - self.total();
        out.push_str(&format!("{:<width$}  {:>9.3}  {:>6.1}\n", UNACCOUNTED, rest, share(rest, wall)));
        out.push_str(&format!("{:<width$}  {:>9.3}  {:>6.1}\n", "wall", wall, PERCENT));
        out
    }

    /// One line for a log: the `top` slowest phases and what no phase covers.
    pub fn line(&self, wall: f64, top: usize) -> String {
        let mut parts: Vec<String> = self
            .ranked()
            .into_iter()
            .take(top)
            .map(|(name, p)| format!("{name} {:.1} s ({}x{})", p.seconds, p.calls, if p.bytes > 0 { format!(", {}", human_bytes(p.bytes)) } else { String::new() }))
            .collect();
        parts.push(format!("{UNACCOUNTED} {:.1} s", wall - self.total()));
        format!("{wall:.1} s: {}", parts.join("; "))
    }
}

fn share(part: f64, wall: f64) -> f64 {
    if wall > 0.0 { part / wall * PERCENT } else { 0.0 }
}

pub fn human_bytes(n: u64) -> String {
    let mut v = n as f64;
    let mut unit = 0;
    while v >= KIB && unit < BYTE_UNITS.len() - 1 {
        v /= KIB;
        unit += 1;
    }
    if unit == 0 { format!("{n} B") } else { format!("{v:.1} {}", BYTE_UNITS[unit]) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn time_returns_the_value_and_charges_the_phase_once_per_run() {
        let mut p = Profile::default();
        let v = p.time("sleep", || {
            std::thread::sleep(std::time::Duration::from_millis(20));
            7
        });
        p.time("sleep", || ());
        assert_eq!(v, 7);
        let s = p.get("sleep").unwrap();
        assert_eq!(s.calls, 2);
        assert!(s.seconds >= 0.02, "{}", s.seconds);
    }

    #[test]
    fn record_and_add_bytes_accumulate_and_merge_adds_phase_by_phase() {
        let mut a = Profile::default();
        a.record("read", 1.5, 100);
        a.record("read", 0.5, 50);
        a.add_bytes("read", 10);
        let mut b = Profile::default();
        b.record("read", 1.0, 5);
        b.record("parse", 2.0, 0);
        a.merge(&b);
        assert_eq!(a.get("read"), Some(&Phase { seconds: 3.0, calls: 3, bytes: 165 }));
        assert_eq!(a.get("parse"), Some(&Phase { seconds: 2.0, calls: 1, bytes: 0 }));
        assert_eq!(a.total(), 5.0);
    }

    #[test]
    fn ranked_puts_the_slowest_first_and_breaks_a_tie_by_name() {
        let mut p = Profile::default();
        p.record("b", 1.0, 0);
        p.record("a", 1.0, 0);
        p.record("slow", 9.0, 0);
        let names: Vec<_> = p.ranked().into_iter().map(|(n, _)| n).collect();
        assert_eq!(names, ["slow", "a", "b"]);
    }

    #[test]
    fn the_report_lists_phases_slowest_first_with_their_share_and_ends_in_unaccounted_and_wall() {
        let mut p = Profile::default();
        p.record("utf8_lossy", 30.0, 3 * 1024 * 1024 * 1024);
        p.record("sqlite", 10.0, 0);
        let r = p.report(50.0);
        let lines: Vec<&str> = r.lines().collect();
        assert!(lines[0].starts_with("phase"), "{r}");
        assert!(lines[1].starts_with("utf8_lossy") && lines[1].contains("60.0") && lines[1].contains("3.0 GiB"), "{r}");
        assert!(lines[2].starts_with("sqlite") && lines[2].contains("20.0"), "{r}");
        assert!(lines[3].starts_with("unaccounted") && lines[3].contains("10.000") && lines[3].contains("20.0"), "{r}");
        assert!(lines[4].starts_with("wall") && lines[4].contains("50.000") && lines[4].contains("100.0"), "{r}");
    }

    #[test]
    fn overlapping_phases_show_as_negative_unaccounted_not_hidden() {
        let mut p = Profile::default();
        p.record("a", 8.0, 0);
        p.record("b", 8.0, 0);
        assert!(p.report(10.0).contains("-6.000"));
    }

    #[test]
    fn the_line_names_only_the_top_phases_and_the_rest() {
        let mut p = Profile::default();
        p.record("a", 5.0, 2048);
        p.record("b", 3.0, 0);
        p.record("c", 1.0, 0);
        let l = p.line(10.0, 2);
        assert_eq!(l, "10.0 s: a 5.0 s (1x, 2.0 KiB); b 3.0 s (1x); unaccounted 1.0 s");
    }

    #[test]
    fn human_bytes_picks_the_unit() {
        assert_eq!(human_bytes(0), "0 B");
        assert_eq!(human_bytes(1023), "1023 B");
        assert_eq!(human_bytes(1536), "1.5 KiB");
        assert_eq!(human_bytes(5 * 1024 * 1024 * 1024), "5.0 GiB");
    }

    #[test]
    fn a_report_over_a_zero_wall_does_not_divide_by_zero() {
        let mut p = Profile::default();
        p.record("a", 0.0, 0);
        assert!(p.report(0.0).contains("0.0"));
    }
}
