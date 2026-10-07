//! The ingest: the warehouse half of the collector. It reads what the lake holds for a story (the
//! agent's event log, the model server's log) and the published record, and writes the conversation
//! database (db.rs). The parsers are ports of the harness's own (benchmarks/spec-bench/harness):
//! their output on the fixture logs is held equal to the Python parsers' by tests/ingest.rs against
//! tests/golden, which benchmarks/spec-bench/harness/export_goldens.py writes.

pub mod db;
pub mod engine_log;
pub mod events;
pub mod flags;
pub mod inputs;
pub mod llama_log;
pub mod py;
pub mod timing;

use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::{json, Value};

/// One model call as the agent's client streamed it: request sent, prefill ends (first streamed
/// chunk), decode ends; its prompt tokens (fresh and cached) and output tokens. accounting.Call.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Call {
    pub sent: f64,
    pub first: f64,
    pub end: f64,
    pub fresh: i64,
    pub cached: i64,
    pub out: Option<i64>,
    /// Claude Code's message id; None for pi.
    #[serde(skip)]
    pub id: Option<String>,
}

/// Bumped when what the ingest writes for the same inputs changes; the collection row says which made it.
pub const INGEST_VERSION: i64 = 1;
/// A text in an event's payload is cut to this many characters (the whole text is in the entity tables).
pub const INLINE_CHARS: usize = 4000;
const MS_PER_S: f64 = 1000.0;
/// Request sources, as the requests table names them.
pub const SOURCE_LLAMA: &str = "llama-log";
pub const SOURCE_ENGINE: &str = "engine-log";
pub const EVENTS_FULL: &str = "full";
pub const EVENTS_COMPACT: &str = "compact";
pub const EVENTS_NONE: &str = "none";

/// The parts of a run directory's path (build_full.py's reading of it).
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct RunParts {
    pub pack: String,
    pub stack: String,
    pub family: String,
    pub variant: String,
    pub engine: String,
    pub client: String,
    pub machine: String,
    pub run: String,
}

/// `combinations/<family>/<version>/<variant>/<os>/<machine>/<engine>-<client>/benchmarks/<pack>/<run>` or
/// `benchmarks/reference/<pack>/<stack>/<run>`; None for anything else.
pub fn run_parts(run_dir: &str) -> Option<RunParts> {
    let p: Vec<&str> = run_dir.split('/').collect();
    if p.first() == Some(&"combinations") {
        let i = p.iter().position(|s| *s == "benchmarks")?;
        if i < 4 || p.len() != i + 3 {
            return None;
        }
        // The last segment is <engine>-<client>; a combination named without the dash is its engine alone.
        let (engine, client) = p[i - 1].rsplit_once('-').unwrap_or((p[i - 1], ""));
        Some(RunParts {
            stack: p[1..i].join("/"),
            pack: p[i + 1].to_string(),
            run: p[i + 2].to_string(),
            family: format!("{} {}", p[1], p[2]),
            variant: p[3].to_string(),
            machine: format!("{}/{}", p[i - 3], p[i - 2]),
            engine: engine.to_string(),
            client: client.to_string(),
        })
    } else if p.len() == 5 && p[0] == "benchmarks" && p[1] == "reference" {
        Some(RunParts {
            pack: p[2].to_string(),
            stack: format!("reference/{}", p[3]),
            run: p[4].to_string(),
            family: "claude".into(),
            variant: p[3].to_string(),
            engine: "anthropic".into(),
            client: "claude-code".into(),
            machine: "cloud".into(),
        })
    } else {
        None
    }
}

/// `<run dir>/stories/<NN>` split into the run dir and the story number.
pub fn split_story_rel(rel: &str) -> Option<(&str, i64)> {
    let (run_dir, n) = rel.rsplit_once("/stories/")?;
    Some((run_dir, n.parse().ok()?))
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// An ISO 8601 stamp (`2026-10-02T09:00:00Z`, `…+01:00`, `…​.123456`) as epoch seconds; None for anything else.
pub fn epoch_of(s: &str) -> Option<f64> {
    let s = s.trim();
    let (date, rest) = s.split_once(['T', ' '])?;
    let mut d = date.split('-').map(|x| x.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let (time, offset) = match rest.find(['Z', '+']).or_else(|| rest.rfind('-').filter(|&i| i > 0)) {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, ""),
    };
    let mut t = time.split(':');
    let (hh, mm) = (t.next()?.parse::<i64>().ok()?, t.next()?.parse::<i64>().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    let off = match offset {
        "" | "Z" => 0,
        o => {
            let sign = if o.starts_with('-') { -1 } else { 1 };
            let mut p = o[1..].split(':');
            let oh: i64 = p.next()?.parse().ok()?;
            let om: i64 = p.next().unwrap_or("0").parse().ok()?;
            sign * (oh * 3600 + om * 60)
        }
    };
    Some((days_from_civil(y, m, day) * 86_400 + hh * 3600 + mm * 60 - off) as f64 + sec)
}

/// Each row call's timing (sent, first, end) from the stream: pi's by the end stamp in order, Claude
/// Code's by message id. None where the log has no timing for it.
pub fn join_call_timing(rows: &events::Rows, timing: &timing::Parsed) -> Vec<Option<Call>> {
    let mut next = 0;
    rows.calls
        .iter()
        .map(|c| match &c.mid {
            Some(mid) => timing.calls.iter().find(|t| t.id.as_ref() == Some(mid)).cloned(),
            None => {
                let rx = c.rx.as_f64()?;
                let i = timing.calls[next..].iter().position(|t| t.end == rx)? + next;
                next = i + 1;
                Some(timing.calls[i].clone())
            }
        })
        .collect()
}

/// A model server's finished request, placed in a story and matched to a call where possible.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct RequestRow {
    pub sk: Option<i64>,
    pub call_idx: Option<i64>,
    pub ts: Option<f64>,
    pub server_start: Option<f64>,
    pub prompt_tok: Option<i64>,
    pub prefill_tok: Option<i64>,
    pub generated_tok: Option<i64>,
    pub cached_tok: Option<i64>,
    pub prefill_s: Option<f64>,
    pub decode_s: Option<f64>,
    pub ttft_s: Option<f64>,
    pub prefill_tok_s: Option<f64>,
    pub decode_tok_s: Option<f64>,
    pub draft_accepted: Option<i64>,
    pub draft_proposed: Option<i64>,
    pub rounds: Option<i64>,
    pub mean_len: Option<f64>,
    pub context_len: Option<i64>,
    pub finish: Option<String>,
    pub status: Option<i64>,
}

/// One story's calls with their timing, for placing a run's requests.
#[derive(Debug, Clone)]
pub struct StoryCalls {
    pub sk: i64,
    pub t_from: f64,
    pub t_to: f64,
    /// (call idx, its timing)
    pub calls: Vec<(i64, Call)>,
}

fn rate(n: i64, secs: f64) -> Option<f64> {
    (secs > 0.0).then(|| py::round_to(n as f64 / secs, 1))
}

/// llama-server's requests placed by time: the story whose window holds the end, the call whose
/// span holds it.
pub fn llama_requests(text: &str, stories: &[StoryCalls]) -> Vec<RequestRow> {
    let starts = llama_log::server_starts(text);
    llama_log::parse(text)
        .into_iter()
        .map(|r| {
            let story = stories.iter().find(|s| s.t_from <= r.end && r.end <= s.t_to);
            let call = story.and_then(|s| s.calls.iter().find(|(_, c)| c.sent <= r.end && r.end <= c.end + 0.5));
            RequestRow {
                sk: story.map(|s| s.sk),
                call_idx: call.map(|(i, _)| *i),
                ts: Some(r.end),
                server_start: starts.iter().filter(|&&s| s <= r.end).copied().last(),
                prompt_tok: Some(r.prompt_n),
                prefill_tok: Some(r.prompt_n),
                generated_tok: Some(r.gen_n),
                cached_tok: None,
                prefill_s: Some(py::round_to(r.prompt_ms / MS_PER_S, 3)),
                decode_s: Some(py::round_to(r.gen_ms / MS_PER_S, 3)),
                ttft_s: None,
                prefill_tok_s: rate(r.prompt_n, r.prompt_ms / MS_PER_S),
                decode_tok_s: rate(r.gen_n, r.gen_ms / MS_PER_S),
                draft_accepted: r.draft_accepted,
                draft_proposed: r.draft_generated,
                rounds: None,
                mean_len: r.mean_len,
                ..Default::default()
            }
        })
        .collect()
}

/// gufo's, mlx-serve's and Strata's requests, matched to the run's calls by tokens; a matched request
/// takes its call's time and the client's own prefill and decode seconds.
pub fn engine_requests(text: &str, stories: &[StoryCalls]) -> Vec<RequestRow> {
    let reqs = engine_log::parse(text);
    let mut all: Vec<(i64, i64, Call)> = stories.iter().flat_map(|s| s.calls.iter().map(move |(i, c)| (s.sk, *i, c.clone()))).collect();
    all.sort_by(|a, b| a.2.sent.partial_cmp(&b.2.sent).unwrap_or(std::cmp::Ordering::Equal));
    let calls: Vec<Call> = all.iter().map(|(_, _, c)| c.clone()).collect();
    let matched = engine_log::match_calls(&reqs, &calls);
    let mut by_req: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for (ci, rj) in matched.iter().enumerate() {
        if let Some(rj) = rj {
            by_req.insert(*rj, ci);
        }
    }
    reqs.iter()
        .enumerate()
        .map(|(j, r)| {
            let call = by_req.get(&j).map(|&ci| &all[ci]);
            let (prefill_s, decode_s) = call.map_or((None, None), |(_, _, c)| (Some(py::round_to(c.first - c.sent, 3)), Some(py::round_to(c.end - c.first, 3))));
            RequestRow {
                sk: call.map(|(sk, _, _)| *sk),
                call_idx: call.map(|(_, i, _)| *i),
                ts: call.map(|(_, _, c)| c.end),
                server_start: Some(r.start).filter(|s| s.is_finite()),
                prompt_tok: Some(r.prompt),
                prefill_tok: call.map(|(_, _, c)| c.fresh),
                generated_tok: Some(r.gen),
                cached_tok: call.map(|(_, _, c)| c.cached),
                prefill_s,
                decode_s,
                ttft_s: prefill_s,
                prefill_tok_s: call.and_then(|(_, _, c)| rate(c.fresh, c.first - c.sent)),
                decode_tok_s: decode_s.and_then(|d| rate(r.gen, d)),
                draft_accepted: r.draft_accepted,
                draft_proposed: r.draft_generated,
                rounds: None,
                mean_len: r.mean_len,
                ..Default::default()
            }
        })
        .collect()
}

/// One of the harness's 30 s readings of the machine.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
pub struct ConditionRow {
    pub at: f64,
    pub sk: Option<i64>,
    pub ac: Option<i64>,
    pub low_power: Option<i64>,
    pub thermal: Option<String>,
    pub swap_gb: Option<f64>,
    pub free_pct: Option<f64>,
    pub footprint_gb: Option<f64>,
    pub footprint_peak_gb: Option<f64>,
    pub gpu_busy_pct: Option<f64>,
    pub gpu_sclk_mhz: Option<i64>,
    pub gpu_mem_gb: Option<f64>,
    pub gpu_temp_c: Option<f64>,
    pub gpu_power_w: Option<f64>,
    pub gpu_throttle: Option<String>,
}

/// What the model server was holding when a story began, from the record's `memory_start`. Every figure is optional:
/// an engine says only what it says, and what it does not say is NULL, never 0.
#[derive(Debug, Clone, Default)]
pub struct MemoryRow {
    pub at: Option<f64>,
    pub resident_mib: Option<f64>,
    pub model_bytes: Option<i64>,
    pub engine: Option<String>,
    pub cache_retained_mib: Option<f64>,
    pub cache_capacity_mib: Option<f64>,
    pub cache_skipped_for_capacity: Option<i64>,
    pub cache_last_snapshot_mib: Option<f64>,
    pub cache_evictions: Option<i64>,
    pub cache_evicted_mib: Option<f64>,
    pub cache_last_evicted_mib: Option<f64>,
    pub cache_checkpoints_erased: Option<i64>,
    pub extras_json: Option<String>,
}

/// The story's snapshot, or None when the record has none (a story recorded before it existed): no snapshot is not
/// a reading of zero, so there is no row.
pub fn memory(rec: &Value) -> Option<MemoryRow> {
    let m = rec.get("memory_start")?;
    if !m.is_object() {
        return None;
    }
    let f = |v: &Value, k: &str| v.get(k).and_then(Value::as_f64);
    let i = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64);
    let cache = m.get("prompt_cache").filter(|c| c.is_object()).cloned().unwrap_or(Value::Null);
    let extras = m.get("extras").filter(|e| e.as_object().is_some_and(|o| !o.is_empty())).map(|e| e.to_string());
    Some(MemoryRow {
        at: f(m, "t").or_else(|| f(m, "at")),
        resident_mib: f(m, "resident_mib"),
        model_bytes: i(m, "model_bytes"),
        engine: m.get("engine").and_then(Value::as_str).map(String::from),
        cache_retained_mib: f(&cache, "retained_mib"),
        cache_capacity_mib: f(&cache, "capacity_mib"),
        cache_skipped_for_capacity: i(&cache, "skipped_for_capacity"),
        cache_last_snapshot_mib: f(&cache, "last_snapshot_mib"),
        cache_evictions: i(&cache, "evictions"),
        cache_evicted_mib: f(&cache, "evicted_mib"),
        cache_last_evicted_mib: f(&cache, "last_evicted_mib"),
        cache_checkpoints_erased: i(&cache, "checkpoints_erased"),
        extras_json: extras,
    })
}

fn condition_of(v: &Value, sk: Option<i64>) -> Option<ConditionRow> {
    let at = v.get("t").and_then(Value::as_f64)?;
    let gpu = v.get("gpu").and_then(Value::as_object);
    let gf = |k: &str| gpu.and_then(|g| g.get(k)).and_then(Value::as_f64);
    let b = |k: &str| v.get(k).map(|x| i64::from(py::truthy(Some(x))));
    Some(ConditionRow {
        at,
        sk,
        ac: b("ac"),
        low_power: b("low_power"),
        thermal: v.get("thermal").and_then(Value::as_str).map(String::from),
        swap_gb: v.get("swap_gb").and_then(Value::as_f64),
        free_pct: v.get("free_pct").and_then(Value::as_f64),
        footprint_gb: v.get("footprint_gb").and_then(Value::as_f64),
        footprint_peak_gb: v.get("footprint_peak_gb").and_then(Value::as_f64),
        gpu_busy_pct: gf("busy_pct"),
        gpu_sclk_mhz: gpu.and_then(|g| g.get("sclk_mhz")).and_then(Value::as_i64),
        gpu_mem_gb: gf("mem_gb").or_else(|| gf("vram_gb")).or_else(|| gf("gtt_gb")),
        gpu_temp_c: gf("temp_c"),
        gpu_power_w: gf("power_w"),
        gpu_throttle: gpu.and_then(|g| g.get("throttle")).and_then(Value::as_str).map(String::from),
    })
}

/// `conditions.jsonl` (one reading per line), or the record's `conditions.bad_samples`, as rows of one story.
pub fn conditions(text: Option<&str>, rec: &Value, sk: i64) -> Vec<ConditionRow> {
    let mut out: Vec<ConditionRow> = match text {
        Some(t) => t.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).filter_map(|v| condition_of(&v, Some(sk))).collect(),
        None => Vec::new(),
    };
    if out.is_empty() {
        if let Some(bad) = rec.get("conditions").and_then(|c| c.get("bad_samples")).and_then(Value::as_array) {
            out = bad.iter().filter_map(|v| condition_of(v, Some(sk))).collect();
        }
    }
    out
}

fn ms(t: f64) -> i64 {
    (t * MS_PER_S).round() as i64
}

fn cut(s: &str) -> Value {
    if py::chars(s) <= INLINE_CHARS {
        json!({ "text": s })
    } else {
        json!({ "head": py::head_chars(s, db::HEAD_CHARS), "tail": py::tail_chars(s, db::TAIL_CHARS), "chars": py::chars(s) })
    }
}

/// The order of kinds at the same millisecond.
fn kind_rank(kind: &str) -> u8 {
    match kind {
        "session_start" => 0,
        "compaction_start" => 1,
        "msg" => 2,
        "tool_end" => 3,
        "request" => 4,
        "call" => 5,
        "tool_start" => 6,
        "compaction_end" => 7,
        "between_sessions" => 8,
        "condition" => 9,
        _ => 10,
    }
}

/// The events stream of a story, in (time, kind, index) order: one immutable row per happening.
pub fn stream_events(rows: &events::Rows, timing: &timing::Parsed, timed: &[Option<Call>], requests: &[(usize, &RequestRow)], conditions: &[ConditionRow]) -> Vec<db::NewEvent> {
    let mut out = Vec::new();
    let mut push = |t: f64, kind: &str, ref_idx: Option<i64>, payload: Value| {
        out.push(db::NewEvent { t_ms: ms(t), kind: kind.to_string(), ref_idx, payload });
    };
    for (c, t) in rows.calls.iter().zip(timed) {
        let Some(at) = c.rx.as_f64() else { continue };
        push(
            at,
            "call",
            Some(c.idx as i64),
            json!({
                "idx": c.idx, "think": c.think, "text": c.text, "nTools": c.n_tools, "outTok": c.out_tok, "inTok": c.in_tok, "cacheTok": c.cache_tok,
                "stop": c.stop, "sub": c.sub, "thinkFlags": c.think_flags, "textFlags": c.text_flags,
                "sentMs": t.as_ref().map(|t| ms(t.sent)), "firstMs": t.as_ref().map(|t| ms(t.first)),
                "thinking": cut(&c.think_full), "textBody": cut(&c.text_full),
            }),
        );
    }
    for tl in &rows.tools {
        if let Some(start) = tl.start.as_f64() {
            push(
                start,
                "tool_start",
                Some(tl.idx as i64),
                // toolKind, not kind: an event's own kind is tool_start; the tool's (read, unit, bash) rides beside it.
                json!({ "idx": tl.idx, "callIdx": tl.call, "name": tl.name, "toolKind": tl.kind, "arg": py::head_chars(&tl.arg, db::HEAD_CHARS), "argChars": tl.arg_chars, "sub": tl.sub, "argFlags": tl.arg_flags }),
            );
        }
        if let Some(end) = tl.end.as_f64() {
            push(
                end,
                "tool_end",
                Some(tl.idx as i64),
                json!({
                    "idx": tl.idx, "callIdx": tl.call, "name": tl.name, "toolKind": tl.kind, "error": tl.error, "resChars": tl.res_chars, "resFlags": tl.res_flags,
                    "passed": tl.passed, "failed": tl.failed, "flaky": tl.flaky, "skipped": tl.skipped, "seconds": tl.start.as_f64().map(|s| py::round_to(end - s, 1)),
                    "result": tl.res.as_deref().map(cut),
                }),
            );
        }
    }
    for m in &rows.msgs {
        if let Some(at) = m.rx.as_f64() {
            push(at, "msg", Some(m.idx as i64), json!({ "idx": m.idx, "role": m.role, "chars": m.chars, "textBody": cut(&m.text) }));
        }
    }
    for (i, c) in rows.compactions.iter().enumerate() {
        if let Some(a) = c.start.as_f64() {
            push(a, "compaction_start", Some(i as i64), json!({ "idx": i, "reason": c.reason }));
        }
        if let Some(b) = c.end.as_f64() {
            push(b, "compaction_end", Some(i as i64), json!({ "idx": i, "reason": c.reason, "summaryChars": c.summary_chars, "seconds": c.start.as_f64().map(|a| py::round_to(b - a, 1)) }));
        }
    }
    for (i, (a, b)) in timing.between.iter().enumerate() {
        push(*a, "between_sessions", Some(i as i64), json!({ "idx": i, "endMs": ms(*b), "seconds": py::round_to(b - a, 1) }));
    }
    for (i, r) in requests {
        if let Some(ts) = r.ts {
            push(
                ts,
                "request",
                Some(*i as i64),
                json!({
                    "idx": i, "callIdx": r.call_idx, "promptTok": r.prompt_tok, "prefillTok": r.prefill_tok, "generatedTok": r.generated_tok, "cachedTok": r.cached_tok,
                    "prefillS": r.prefill_s, "decodeS": r.decode_s, "ttftS": r.ttft_s, "prefillTokS": r.prefill_tok_s, "decodeTokS": r.decode_tok_s,
                    "draftAccepted": r.draft_accepted, "draftProposed": r.draft_proposed, "meanLen": r.mean_len,
                }),
            );
        }
    }
    for (i, c) in conditions.iter().enumerate() {
        push(
            c.at,
            "condition",
            Some(i as i64),
            json!({
                "ac": c.ac, "lowPower": c.low_power, "thermal": c.thermal, "swapGb": c.swap_gb, "freePct": c.free_pct, "footprintGb": c.footprint_gb,
                "gpu": { "busyPct": c.gpu_busy_pct, "sclkMhz": c.gpu_sclk_mhz, "memGb": c.gpu_mem_gb, "tempC": c.gpu_temp_c, "powerW": c.gpu_power_w, "throttle": c.gpu_throttle },
            }),
        );
    }
    out.sort_by_key(|e| (e.t_ms, kind_rank(&e.kind), e.ref_idx));
    out
}

/// What one story is ingested from.
#[derive(Debug, Clone, Default)]
pub struct StoryInputs {
    /// `<run dir>/stories/NN`
    pub rel: String,
    pub run_dir: String,
    pub story: i64,
    /// The event log's text, and where it came from (full | compact | none).
    pub events_text: Option<String>,
    pub events_source: String,
    pub events_path: Option<String>,
    pub events_bytes: i64,
    /// metrics.json's record of the story (`{}` when none yet).
    pub rec: Value,
    pub run_json: Value,
    pub status_json: Value,
    pub conditions_text: Option<String>,
    pub node: Option<String>,
    pub collected_at: Option<f64>,
    /// The collector saw the run settled and every file at eof.
    pub complete: bool,
    pub has_server_log: bool,
    pub has_proxy_log: bool,
    pub has_egress: bool,
    pub has_progress: bool,
    pub inputs_digest: String,
}

/// What ingesting one story left for the run-level pass (its calls, for placing the server's requests).
#[derive(Debug, Clone)]
pub struct StoryOutcome {
    pub sk: i64,
    pub calls: StoryCalls,
    pub events_written: usize,
}

/// The window a story's happenings fall in: the record's start and end, else the log's.
fn story_window(rec: &Value, rows: &events::Rows, timing: &timing::Parsed, now: f64) -> (f64, f64) {
    let first_rx = rows.calls.first().and_then(|c| c.rx.as_f64()).or_else(|| timing.calls.first().map(|c| c.sent));
    let t_from = rec.get("first_started").and_then(Value::as_f64).or_else(|| rec.get("started").and_then(Value::as_f64)).or(first_rx).unwrap_or(0.0);
    let t_to = rec.get("agent_finished").and_then(Value::as_f64).unwrap_or(now);
    (t_from, t_to.max(t_from))
}

/// Ingest one story: its rows, its stream, its collection record. The run's requests are placed
/// afterwards, from every story's calls (`ingest_run_requests`).
pub fn ingest_story(db: &mut db::Db, parts: &RunParts, inp: &StoryInputs, now: f64) -> Result<StoryOutcome> {
    let started = std::time::Instant::now();
    let text = inp.events_text.as_deref().unwrap_or("");
    let rows = events::parse(text);
    let t_to_guess = inp.rec.get("agent_finished").and_then(Value::as_f64).unwrap_or(now);
    let timing = timing::parse(text, t_to_guess);
    db.upsert_run(&inp.run_dir, parts, &inp.run_json, &inp.status_json, inp.node.as_deref(), now)?;
    let sk = db.upsert_story(&inp.rel, &inp.run_dir, inp.story, parts, &inp.rec, &inp.run_json, &rows, &inp.events_source)?;
    db.replace_story_rows(sk, &rows, &timing, &inp.rec)?;
    let timed = join_call_timing(&rows, &timing);
    let conds = conditions(inp.conditions_text.as_deref(), &inp.rec, sk);
    db.replace_conditions(&inp.run_dir, sk, &conds)?;
    db.replace_memory(&inp.run_dir, sk, memory(&inp.rec).as_ref())?;
    let stream = stream_events(&rows, &timing, &timed, &[], &conds);
    let events_written = if inp.complete {
        db.replace_events(sk, &stream)?;
        stream.len()
    } else {
        db.append_events(sk, &stream)?
    };
    let (t_from, t_to) = story_window(&inp.rec, &rows, &timing, now);
    db.set_collection(
        sk,
        &db::Collection {
            node: inp.node.clone(),
            collected_at: inp.collected_at,
            complete: inp.complete,
            events_source: inp.events_source.clone(),
            events_path: inp.events_path.clone(),
            events_bytes: inp.events_bytes,
            events_consumed: text.len() as i64,
            has_server_log: inp.has_server_log,
            has_proxy_log: inp.has_proxy_log,
            has_egress: inp.has_egress,
            has_progress: inp.has_progress,
            has_conditions: inp.conditions_text.is_some(),
            inputs_digest: inp.inputs_digest.clone(),
            ingested_at: now,
            ingest_version: INGEST_VERSION,
            ingest_s: started.elapsed().as_secs_f64(),
        },
    )?;
    let calls = StoryCalls {
        sk,
        t_from,
        t_to,
        calls: rows.calls.iter().zip(&timed).filter_map(|(c, t)| t.clone().map(|t| (c.idx as i64, t))).collect(),
    };
    Ok(StoryOutcome { sk, calls, events_written })
}

/// The run's requests from its server log, placed in its stories; each placed request also joins
/// its story's stream.
pub fn ingest_run_requests(db: &mut db::Db, run_dir: &str, server_log: Option<&str>, stories: &[StoryCalls], complete: &std::collections::HashMap<i64, bool>) -> Result<usize> {
    let Some(text) = server_log else { return Ok(0) };
    let llama = llama_requests(text, stories);
    let engine = engine_requests(text, stories);
    db.replace_requests(run_dir, SOURCE_LLAMA, &llama)?;
    db.replace_requests(run_dir, SOURCE_ENGINE, &engine)?;
    let mut n = 0;
    for s in stories {
        let mine: Vec<(usize, &RequestRow)> = llama.iter().enumerate().chain(engine.iter().enumerate()).filter(|(_, r)| r.sk == Some(s.sk)).collect();
        if mine.is_empty() {
            continue;
        }
        let empty = events::Rows::default();
        let none = timing::Parsed::default();
        let stream = stream_events(&empty, &none, &[], &mine, &[]);
        // A finished story's stream was rebuilt whole by ingest_story; its requests are appended in time order after it,
        // which keeps ord append-only either way.
        let _ = complete;
        n += db.append_events(s.sk, &stream)?;
    }
    Ok(n)
}

const REBUILD_SUFFIX: &str = ".new";

/// `dbench ingest`.
pub fn cmd_ingest(args: &crate::cli::IngestArgs, json: bool) -> Result<()> {
    use std::io::Write;
    if args.schema {
        return inputs::write_schema(std::io::stdout().lock());
    }
    let published: Box<dyn inputs::Published> = if args.worktree {
        Box::new(inputs::TreeSource { root: args.repo.clone() })
    } else {
        let g = inputs::GitSource::new(&args.repo, &args.rev);
        if !args.no_fetch {
            g.fetch()?;
        }
        Box::new(g)
    };
    let target = if args.rebuild {
        let mut p = args.db.clone().into_os_string();
        p.push(REBUILD_SUFFIX);
        let p = std::path::PathBuf::from(p);
        let _ = std::fs::remove_file(&p);
        p
    } else {
        args.db.clone()
    };
    if let Some(dir) = target.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut db = db::Db::open(&target)?;
    let sel = inputs::Selection { all: args.all || args.rebuild, only: args.only.clone() };
    let now = crate::timefmt::now_secs() as f64;
    let summary = inputs::run(&mut db, published.as_ref(), &args.store, &sel, now)?;
    drop(db);
    if args.rebuild {
        std::fs::rename(&target, &args.db).with_context(|| format!("rename {} over {}", target.display(), args.db.display()))?;
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&summary)?);
    } else {
        println!(
            "ingested {} of {} story runs in {} runs ({} unchanged), {} requests placed, {:.1} s",
            summary.ingested, summary.candidates, summary.runs, summary.unchanged, summary.requests, summary.seconds
        );
    }
    let _ = std::io::stdout().flush();
    Ok(())
}
