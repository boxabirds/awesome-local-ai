//! The logs of the servers that aren't llama.cpp (benchmarks/spec-bench/harness/engine_log.py): gufo's
//! one line per finished request, mlx-serve's block per request, Strata's line per request. None of
//! them places a request in time, so a request is matched to the agent's call for it by its tokens:
//! the prompt (read or cached) and the tokens generated are what the client recorded for that call,
//! in order, within the server run that was up when the call was sent.

use regex_lite::Regex;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::OnceLock;

use super::py::round_to;
use super::Call;

/// A server run that began before the log's first start marker.
pub const NO_RUN_START: f64 = f64::NEG_INFINITY;
const MLX_REQUEST: &str = "POST ";
const RATIO_DECIMALS: usize = 3;
const LEN_DECIMALS: usize = 2;

/// A float as the goldens write it: JSON has no infinities, so NO_RUN_START is the string "-inf".
fn serialize_start<S: serde::Serializer>(x: &f64, s: S) -> Result<S::Ok, S::Error> {
    if x.is_finite() {
        s.serialize_f64(*x)
    } else {
        s.serialize_str(if *x > 0.0 { "inf" } else { "-inf" })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Request {
    /// When the server run it is in started (epoch s), or NO_RUN_START.
    #[serde(serialize_with = "serialize_start")]
    pub start: f64,
    pub prompt: i64,
    pub gen: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_accepted: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_generated: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_len: Option<f64>,
}

fn rx(cell: &'static OnceLock<Regex>, pattern: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pattern).unwrap())
}

fn gufo_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    rx(&RX, r"\[http\] request=\S+ event=completed method=POST path=/v1/chat/completions ")
}

fn field_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    rx(&RX, r"(\w+)=(\S+)")
}

fn mlx_stats_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    rx(&RX, r"^\s*\[spec-stats\] mode=\S+ (.*)")
}

fn mlx_tokens_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    rx(&RX, r"^\s*<- (\d+)\+(\d+) tokens streamed")
}

fn strata_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    rx(
        &RX,
        r"^strata serve: prompt (\d+) tokens = \d+ reused \+ \d+ read in .*?, (\d+) generated in (?:.*?, drafts accepted (\d+) of (\d+))?",
    )
}

/// `key=value` pairs anywhere in a line; a later key replaces an earlier one.
fn fields(text: &str) -> HashMap<String, String> {
    field_rx()
        .captures_iter(text)
        .map(|c| (c[1].to_string(), c[2].to_string()))
        .collect()
}

fn int(f: &HashMap<String, String>, key: &str) -> Option<i64> {
    f.get(key).and_then(|v| v.parse().ok())
}

/// Finished requests, in order, with the draft figures where the server gave them.
pub fn parse(text: &str) -> Vec<Request> {
    let mut reqs = Vec::new();
    let mut start = NO_RUN_START;
    let mut stats: Option<HashMap<String, String>> = None;
    for line in text.lines() {
        if let Some(m) = super::llama_log::marker_rx().captures(line) {
            start = m[1].parse().unwrap_or(NO_RUN_START);
            stats = None;
        } else if let Some(m) = strata_rx().captures(line) {
            let (accepted, generated) = match (m.get(3), m.get(4)) {
                (Some(a), Some(g)) => (a.as_str().parse().ok(), g.as_str().parse().ok()),
                _ => (None, None),
            };
            reqs.push(Request {
                start,
                prompt: m[1].parse().unwrap_or(0),
                gen: m[2].parse().unwrap_or(0),
                draft_accepted: accepted,
                draft_generated: generated,
                mean_len: None,
            });
        } else if gufo_rx().is_match(line) {
            let f = fields(line);
            let (Some(prompt), Some(gen)) = (int(&f, "prompt_tokens"), int(&f, "generated_tokens")) else {
                continue;
            };
            let (accepted, generated) = match (int(&f, "draft_accepted"), int(&f, "draft_proposed")) {
                (Some(a), Some(p)) => (Some(a), Some(p)),
                _ => (None, None),
            };
            reqs.push(Request { start, prompt, gen, draft_accepted: accepted, draft_generated: generated, mean_len: None });
        } else if line.starts_with(MLX_REQUEST) {
            stats = None;
        } else if let Some(m) = mlx_stats_rx().captures(line) {
            stats = Some(fields(&m[1]));
        } else if let Some(m) = mlx_tokens_rx().captures(line) {
            let s = stats.take().unwrap_or_default();
            let (acc, drafted, rounds) = (int(&s, "accepts"), int(&s, "drafted"), int(&s, "attempts"));
            let mut r = Request {
                start,
                prompt: m[1].parse().unwrap_or(0),
                gen: m[2].parse().unwrap_or(0),
                draft_accepted: None,
                draft_generated: None,
                mean_len: None,
            };
            if let (Some(a), Some(d)) = (acc, drafted) {
                r.draft_accepted = Some(a);
                r.draft_generated = Some(d);
                if let Some(n) = rounds.filter(|&n| n != 0) {
                    r.mean_len = Some(1.0 + a as f64 / n as f64);
                }
            }
            reqs.push(r);
        }
    }
    reqs
}

fn tokens(c: &Call) -> Option<(i64, i64)> {
    c.out.map(|out| (c.fresh + c.cached, out))
}

/// Each wanted pair's request index (ascending lists per pair), from `at` on, in order; None for a
/// pair the run doesn't have after the one before.
fn in_order(where_: &HashMap<(i64, i64), Vec<usize>>, wants: &[Option<(i64, i64)>], mut at: usize) -> Vec<Option<usize>> {
    let mut out = Vec::with_capacity(wants.len());
    for want in wants {
        let j = want
            .and_then(|w| where_.get(&w))
            .and_then(|idx| idx[idx.partition_point(|&j| j < at)..].first().copied());
        if let Some(j) = j {
            at = j + 1;
        }
        out.push(j);
    }
    out
}

/// How well a placement fits: the most calls matched, then the tightest stretch of the run.
fn fit(got: &[Option<usize>]) -> (usize, i64) {
    let hit: Vec<usize> = got.iter().flatten().copied().collect();
    match (hit.first(), hit.last()) {
        (Some(&a), Some(&b)) => (hit.len(), -((b as i64) - (a as i64))),
        _ => (0, 0),
    }
}

/// The request (its index in `reqs`) for each call, or None: in order, by tokens, in the server run
/// up when it was sent. A story's calls start at whichever request with its first call's tokens
/// lets the most of them match in order, closest together.
pub fn match_calls(reqs: &[Request], calls: &[Call]) -> Vec<Option<usize>> {
    let mut runs: Vec<f64> = reqs.iter().map(|r| r.start).collect();
    runs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    runs.dedup();
    let mut found: HashMap<usize, usize> = HashMap::new();
    for &s in &runs {
        let run: Vec<usize> = (0..reqs.len()).filter(|&j| reqs[j].start == s).collect();
        let mine: Vec<usize> = (0..calls.len())
            .filter(|&i| {
                runs.iter().filter(|&&u| u <= calls[i].sent).copied().fold(None, |m: Option<f64>, u| Some(m.map_or(u, |m| m.max(u))))
                    == Some(s)
            })
            .collect();
        let wants: Vec<Option<(i64, i64)>> = mine.iter().map(|&i| tokens(&calls[i])).collect();
        let mut where_: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
        for (local, &j) in run.iter().enumerate() {
            where_.entry((reqs[j].prompt, reqs[j].gen)).or_default().push(local);
        }
        let first = wants.iter().flatten().find(|w| where_.contains_key(w)).copied();
        let candidates: Vec<usize> = first.and_then(|f| where_.get(&f).cloned()).unwrap_or_else(|| vec![0]);
        let mut best: Option<Vec<Option<usize>>> = None;
        for j in candidates {
            let got = in_order(&where_, &wants, j);
            if best.as_ref().is_none_or(|b| fit(&got) > fit(b)) {
                best = Some(got);
            }
        }
        for (i, j) in mine.iter().zip(best.unwrap_or_default()) {
            if let Some(j) = j {
                found.insert(*i, run[j]);
            }
        }
    }
    (0..calls.len()).map(|i| found.get(&i).copied()).collect()
}

/// draft_acceptance and mean_accepted_len over the requests, None where nothing was drafted or no
/// rounds are known.
pub fn summarise(reqs: &[&Request]) -> serde_json::Value {
    let acc: i64 = reqs.iter().filter_map(|r| r.draft_accepted).sum();
    let drafted: i64 = reqs.iter().filter_map(|r| r.draft_generated).sum();
    let lens: Vec<(f64, i64)> = reqs.iter().filter_map(|r| r.mean_len.map(|l| (l, r.gen))).collect();
    let made: i64 = lens.iter().map(|(_, n)| n).sum();
    serde_json::json!({
        "draft_acceptance": (drafted != 0).then(|| round_to(acc as f64 / drafted as f64, RATIO_DECIMALS)),
        "mean_accepted_len": (made != 0).then(|| round_to(lens.iter().map(|(l, n)| l * *n as f64).sum::<f64>() / made as f64, LEN_DECIMALS)),
    })
}
