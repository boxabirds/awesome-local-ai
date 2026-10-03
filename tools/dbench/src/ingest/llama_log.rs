//! llama-server's own log, one finished request at a time (benchmarks/spec-bench/harness/llama_log.py).
//! Its clock is minutes.seconds.ms.us since the server started; run.sh writes `=== server start <epoch>`
//! before each start, so a request's end is the marker's time plus the stamp. A segment with no marker
//! has no wall clock and gives no requests.

use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

use super::py::round_to;

pub const MARKER: &str = "=== server start ";
const SECONDS_PER_MINUTE: i64 = 60;
const MS_PER_S: f64 = 1000.0;
const US_PER_S: f64 = 1_000_000.0;
const STAMP: &str = r"^\s*(\d+)\.(\d{2})\.(\d{3})\.(\d{3}) I slot print_timing: id\s+\d+ \| task (\d+) \|\s*";
const PRINT_TIMING: &str = "print_timing";
const RATE_DECIMALS: usize = 1;
const RATIO_DECIMALS: usize = 3;
const LEN_DECIMALS: usize = 2;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Request {
    pub task: i64,
    pub end: f64,
    pub prompt_ms: f64,
    pub prompt_n: i64,
    pub gen_ms: f64,
    pub gen_n: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_accepted: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub draft_generated: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_len: Option<f64>,
}

pub fn marker_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(&format!(r"^{}([\d.]+)", regex::escape(MARKER))).unwrap())
}

fn prompt_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(&format!(r"{STAMP}prompt eval time =\s*([\d.]+) ms /\s*(\d+) tokens")).unwrap())
}

fn eval_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(&format!(r"{STAMP}eval time =\s*([\d.]+) ms /\s*(\d+) tokens")).unwrap())
}

fn draft_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| {
        Regex::new(&format!(
            r"{STAMP}draft acceptance = [\d.]+ \(\s*(\d+) accepted /\s*(\d+) generated\), mean len =\s*([\d.]+)"
        ))
        .unwrap()
    })
}

/// The start marker's text for a server started at `epoch`.
pub fn start_marker(epoch: f64) -> String {
    format!("{MARKER}{epoch:.3} ===\n")
}

/// Every server start in the log, as epoch seconds.
pub fn server_starts(text: &str) -> Vec<f64> {
    text.lines()
        .filter_map(|l| marker_rx().captures(l))
        .filter_map(|m| m[1].parse().ok())
        .collect()
}

fn since_start(m: &regex::Captures) -> f64 {
    let n = |i: usize| m[i].parse::<i64>().unwrap_or(0);
    (n(1) * SECONDS_PER_MINUTE + n(2)) as f64 + n(3) as f64 / MS_PER_S + n(4) as f64 / US_PER_S
}

/// Finished requests, in order: end (epoch s), prompt_n/ms (prefill), gen_n/ms (decode), and the
/// draft figures when MTP drafted. A request is finished once its eval line has been seen.
pub fn parse(text: &str) -> Vec<Request> {
    let mut reqs: Vec<Request> = Vec::new();
    let mut finished: Vec<bool> = Vec::new();
    let mut base: Option<f64> = None;
    let mut cur: Option<usize> = None;
    for line in text.lines() {
        if let Some(m) = marker_rx().captures(line) {
            base = m[1].parse().ok();
            cur = None;
            continue;
        }
        let Some(b) = base else { continue };
        if !line.contains(PRINT_TIMING) {
            continue;
        }
        if let Some(m) = prompt_rx().captures(line) {
            reqs.push(Request {
                task: m[5].parse().unwrap_or(0),
                end: b + since_start(&m),
                prompt_ms: m[6].parse().unwrap_or(0.0),
                prompt_n: m[7].parse().unwrap_or(0),
                gen_ms: 0.0,
                gen_n: 0,
                draft_accepted: None,
                draft_generated: None,
                mean_len: None,
            });
            finished.push(false);
            cur = Some(reqs.len() - 1);
        } else if let Some(m) = eval_rx().captures(line) {
            if let Some(i) = cur.filter(|&i| reqs[i].task == m[5].parse::<i64>().unwrap_or(-1)) {
                reqs[i].gen_ms = m[6].parse().unwrap_or(0.0);
                reqs[i].gen_n = m[7].parse().unwrap_or(0);
                reqs[i].end = b + since_start(&m);
                finished[i] = true;
            }
        } else if let Some(m) = draft_rx().captures(line) {
            if let Some(i) = cur.filter(|&i| reqs[i].task == m[5].parse::<i64>().unwrap_or(-1)) {
                reqs[i].draft_accepted = m[6].parse().ok();
                reqs[i].draft_generated = m[7].parse().ok();
                reqs[i].mean_len = m[8].parse().ok();
                reqs[i].end = b + since_start(&m);
            }
        }
    }
    reqs.into_iter().zip(finished).filter(|(_, f)| *f).map(|(r, _)| r).collect()
}

/// Totals for the requests that finished in [t_from, t_to], as llama_log.summarise.
pub fn summarise(reqs: &[Request], t_from: f64, t_to: f64) -> serde_json::Value {
    let rs: Vec<&Request> = reqs.iter().filter(|r| t_from <= r.end && r.end <= t_to).collect();
    let prefill_ms: f64 = rs.iter().map(|r| r.prompt_ms).sum();
    let decode_ms: f64 = rs.iter().map(|r| r.gen_ms).sum();
    let gen_n: i64 = rs.iter().map(|r| r.gen_n).sum();
    let prompt_n: i64 = rs.iter().map(|r| r.prompt_n).sum();
    let acc: i64 = rs.iter().filter_map(|r| r.draft_accepted).sum();
    let drafted: i64 = rs.iter().filter_map(|r| r.draft_generated).sum();
    let lens: Vec<(f64, i64)> = rs.iter().filter_map(|r| r.mean_len.map(|l| (l, r.gen_n))).collect();
    let made: i64 = lens.iter().map(|(_, n)| n).sum();
    let rate = |n: i64, ms: f64| (ms != 0.0).then(|| round_to(n as f64 / (ms / MS_PER_S), RATE_DECIMALS));
    serde_json::json!({
        "requests": rs.len(),
        "prefill_s": round_to(prefill_ms / MS_PER_S, RATE_DECIMALS),
        "prefill_tokens": prompt_n,
        "prefill_tok_s": rate(prompt_n, prefill_ms),
        "decode_s": round_to(decode_ms / MS_PER_S, RATE_DECIMALS),
        "decode_tokens": gen_n,
        "decode_tok_s": rate(gen_n, decode_ms),
        "draft_acceptance": (drafted != 0).then(|| round_to(acc as f64 / drafted as f64, RATIO_DECIMALS)),
        "mean_accepted_len": (!lens.is_empty() && made != 0)
            .then(|| round_to(lens.iter().map(|(l, n)| l * *n as f64).sum::<f64>() / made as f64, LEN_DECIMALS)),
    })
}
