//! `dbench stalls`: does an agent that repeats itself do worse?
//!
//! For each story with a held-out result, the longest run of identical consecutive tool calls (same tool, same
//! arguments), the share of calls that repeat an earlier one in the story, and whether the story was compacted;
//! then how the held-out result varies with each. Read-only on the conversation database. The finding it tests
//! comes from outside (SWE-Marathon, 2606.07682: pass rate falls as runs of identical calls get longer), so what
//! this prints for our stacks is a measurement, not an assumption.

use anyhow::Result;
use rusqlite::{params, Connection};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};

/// Run lengths the summary bins stories by: label, first, last (inclusive).
pub const RUN_BINS: [(&str, usize, usize); 5] = [("1", 1, 1), ("2-4", 2, 4), ("5-9", 5, 9), ("10-19", 10, 19), ("20+", 20, usize::MAX)];
/// Compactions per story the summary bins stories by: label, first, last (inclusive). A compaction is routine in these runs
/// (most stories have one), so the number of them is what can tell stories apart.
pub const COMPACTION_BINS: [(&str, usize, usize); 4] = [("0", 0, 0), ("1", 1, 1), ("2-3", 2, 3), ("4+", 4, usize::MAX)];
/// A stack's rank correlation is reported only with at least this many stories behind it.
pub const MIN_STORIES_FOR_CORRELATION: usize = 5;

#[derive(Debug, Clone, Serialize)]
pub struct StoryStall {
    pub rel: String,
    pub stack: String,
    pub status: String,
    pub passed: i64,
    pub total: i64,
    pub tool_calls: usize,
    pub longest_run: usize,
    pub repeated_calls: usize,
    pub compactions: usize,
}

impl StoryStall {
    /// The story's held-out result as a fraction of its own tests.
    pub fn held_out(&self) -> f64 {
        self.passed as f64 / self.total as f64
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct BinRow {
    pub label: String,
    pub stories: usize,
    pub mean_held_out: f64,
    pub done_share: f64,
    pub mean_repeated_share: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Report {
    pub stories: Vec<StoryStall>,
    pub excluded: usize,
    pub by_longest_run: Vec<BinRow>,
    pub by_compaction: Vec<BinRow>,
    /// Rank correlation of longest run against held-out fraction, per stack with enough stories, and the mean of those
    /// weighted by story count.
    pub within_stack: Vec<(String, usize, f64)>,
    pub within_stack_mean: Option<f64>,
}

/// Calls make a run when the tool and its arguments are both the same. Keys are 64-bit hashes of tool and arguments; a
/// collision would count two different calls as one and is far too unlikely to matter here.
fn call_key(name: &str, args: &str) -> u64 {
    let mut bytes = Vec::with_capacity(name.len() + 1 + args.len());
    bytes.extend_from_slice(name.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(args.as_bytes());
    crate::collect::fnv1a64(&bytes)
}

/// The longest stretch of equal neighbours (0 for no calls).
pub fn longest_identical_run(keys: &[u64]) -> usize {
    let (mut best, mut run) = (0, 0);
    for (i, k) in keys.iter().enumerate() {
        run = if i > 0 && keys[i - 1] == *k { run + 1 } else { 1 };
        best = best.max(run);
    }
    best
}

/// How many calls repeat one that came earlier in the same list.
pub fn repeated_calls(keys: &[u64]) -> usize {
    let mut seen = HashSet::new();
    keys.iter().filter(|k| !seen.insert(**k)).count()
}

/// Ranks from 1, equal values sharing the mean of the ranks they span.
fn ranks(xs: &[f64]) -> Vec<f64> {
    let mut order: Vec<usize> = (0..xs.len()).collect();
    order.sort_by(|a, b| xs[*a].total_cmp(&xs[*b]));
    let mut out = vec![0.0; xs.len()];
    let mut start = 0;
    while start < order.len() {
        let mut end = start;
        while end + 1 < order.len() && xs[order[end + 1]] == xs[order[start]] {
            end += 1;
        }
        let mean_rank = (start + end) as f64 / 2.0 + 1.0;
        for k in start..=end {
            out[order[k]] = mean_rank;
        }
        start = end + 1;
    }
    out
}

/// Spearman rank correlation, with ties given their average rank; None for fewer than 3 pairs or no spread.
pub fn spearman(xs: &[f64], ys: &[f64]) -> Option<f64> {
    const MIN_PAIRS: usize = 3;
    if xs.len() != ys.len() || xs.len() < MIN_PAIRS {
        return None;
    }
    let (rx, ry) = (ranks(xs), ranks(ys));
    let n = xs.len() as f64;
    let (mx, my) = (rx.iter().sum::<f64>() / n, ry.iter().sum::<f64>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (a, b) in rx.iter().zip(&ry) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx).powi(2);
        syy += (b - my).powi(2);
    }
    if sxx == 0.0 || syy == 0.0 {
        return None;
    }
    Some(sxy / (sxx * syy).sqrt())
}

fn mean(xs: impl Iterator<Item = f64>) -> f64 {
    let (sum, n) = xs.fold((0.0, 0usize), |(s, n), x| (s + x, n + 1));
    if n == 0 { 0.0 } else { sum / n as f64 }
}

fn bin_row(label: &str, stories: &[&StoryStall]) -> BinRow {
    BinRow {
        label: label.to_string(),
        stories: stories.len(),
        mean_held_out: mean(stories.iter().map(|s| s.held_out())),
        done_share: mean(stories.iter().map(|s| f64::from(u8::from(s.status == "DONE")))),
        mean_repeated_share: mean(stories.iter().map(|s| s.repeated_calls as f64 / s.tool_calls as f64)),
    }
}

/// Every story with a held-out total and at least one tool call, in a run not marked invalid; the rest are counted.
pub fn analyse(conn: &Connection) -> Result<Report> {
    let mut report = Report::default();
    let mut listing = conn.prepare(
        "select sk, rel, coalesce(stack, ''), coalesce(status, ''), passed, total, coalesce(invalid, 0) from stories where rel is not null order by sk",
    )?;
    type Row = (i64, String, String, String, Option<i64>, Option<i64>, i64);
    let rows: Vec<Row> = listing.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)))?.collect::<std::result::Result<_, _>>()?;
    let mut calls = conn.prepare("select name, coalesce(args_json, '') from tools where sk = ?1 order by idx")?;
    let mut compacted = conn.prepare("select count(*) from compactions where sk = ?1")?;
    for (sk, rel, stack, status, passed, total, invalid) in rows {
        let (Some(passed), Some(total)) = (passed, total) else {
            report.excluded += 1;
            continue;
        };
        if total <= 0 || invalid != 0 {
            report.excluded += 1;
            continue;
        }
        let keys: Vec<u64> = calls.query_map(params![sk], |r| Ok(call_key(&r.get::<_, String>(0)?, &r.get::<_, String>(1)?)))?.collect::<std::result::Result<_, _>>()?;
        if keys.is_empty() {
            report.excluded += 1;
            continue;
        }
        let compactions: i64 = compacted.query_row(params![sk], |r| r.get(0))?;
        report.stories.push(StoryStall {
            rel, stack, status, passed, total,
            tool_calls: keys.len(),
            longest_run: longest_identical_run(&keys),
            repeated_calls: repeated_calls(&keys),
            compactions: compactions as usize,
        });
    }
    for (label, lo, hi) in RUN_BINS {
        let in_bin: Vec<&StoryStall> = report.stories.iter().filter(|s| s.longest_run >= lo && s.longest_run <= hi).collect();
        report.by_longest_run.push(bin_row(label, &in_bin));
    }
    for (label, lo, hi) in COMPACTION_BINS {
        let in_bin: Vec<&StoryStall> = report.stories.iter().filter(|s| s.compactions >= lo && s.compactions <= hi).collect();
        report.by_compaction.push(bin_row(label, &in_bin));
    }
    let mut by_stack: BTreeMap<&str, Vec<&StoryStall>> = BTreeMap::new();
    for s in &report.stories {
        by_stack.entry(s.stack.as_str()).or_default().push(s);
    }
    for (stack, stories) in by_stack {
        if stories.len() < MIN_STORIES_FOR_CORRELATION {
            continue;
        }
        let runs: Vec<f64> = stories.iter().map(|s| s.longest_run as f64).collect();
        let held: Vec<f64> = stories.iter().map(|s| s.held_out()).collect();
        if let Some(r) = spearman(&runs, &held) {
            report.within_stack.push((stack.to_string(), stories.len(), r));
        }
    }
    let weight: usize = report.within_stack.iter().map(|(_, n, _)| n).sum();
    if weight > 0 {
        report.within_stack_mean = Some(report.within_stack.iter().map(|(_, n, r)| *n as f64 * r).sum::<f64>() / weight as f64);
    }
    Ok(report)
}

fn percent(x: f64) -> String {
    format!("{:.0}%", x * 100.0)
}

impl Report {
    pub fn text(&self, per_story: bool) -> String {
        let mut out = format!(
            "{} stories with a held-out result and tool calls ({} left out: no held-out total, no tool calls, or a run marked invalid)\n\n",
            self.stories.len(),
            self.excluded
        );
        let table = |title: &str, rows: &[BinRow]| -> String {
            let mut t = format!("{title}\n{:<8} {:>8} {:>14} {:>7} {:>16}\n", "", "stories", "mean held-out", "done", "calls repeated");
            for b in rows {
                if b.stories == 0 {
                    t.push_str(&format!("{:<8} {:>8} {:>14} {:>7} {:>16}\n", b.label, 0, "-", "-", "-"));
                } else {
                    t.push_str(&format!("{:<8} {:>8} {:>14} {:>7} {:>16}\n", b.label, b.stories, percent(b.mean_held_out), percent(b.done_share), percent(b.mean_repeated_share)));
                }
            }
            t
        };
        out.push_str(&table("longest run of identical consecutive tool calls", &self.by_longest_run));
        out.push('\n');
        out.push_str(&table("compactions during the story", &self.by_compaction));
        out.push_str("\nwithin a stack: rank correlation of the longest run against the held-out result\n");
        for (stack, n, r) in &self.within_stack {
            out.push_str(&format!("  {r:+.2}  {n:>4} stories  {stack}\n"));
        }
        match self.within_stack_mean {
            Some(m) => out.push_str(&format!(
                "mean {m:+.2}, weighted by stories, over {} stacks (a stack with under {MIN_STORIES_FOR_CORRELATION} stories, or none varying, is not shown)\n",
                self.within_stack.len()
            )),
            None => out.push_str("no stack has enough stories to say\n"),
        }
        if per_story {
            out.push_str("\nstory                                                      run  repeated  compactions  held-out  status\n");
            for s in &self.stories {
                out.push_str(&format!(
                    "{}  {:>3}  {:>3}/{:<4}  {:>11}  {:>3}/{:<4}  {}\n",
                    s.rel, s.longest_run, s.repeated_calls, s.tool_calls, s.compactions, s.passed, s.total, s.status
                ));
            }
        }
        out
    }
}

/// `dbench stalls`.
pub fn cmd_stalls(args: &crate::cli::StallsArgs, json: bool) -> Result<()> {
    let db = crate::ingest::db::Db::open_read_only(&args.db)?;
    let report = analyse(&db.conn)?;
    if json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        print!("{}", report.text(args.per_story));
    }
    Ok(())
}
