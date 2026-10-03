//! The ingest's parsers against the harness's own: tests/golden holds what the Python parsers say
//! about the fixture logs (benchmarks/spec-bench/harness/export_goldens.py); each test asserts the
//! Rust port says the same.

use dbench::ingest::{engine_log, flags, llama_log, py, Call};
use serde_json::{json, Value};
use std::path::PathBuf;

fn golden(name: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden").join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap()
}

/// A float as the goldens write it: a non-finite one is a string.
fn finite(v: Value) -> Value {
    match v {
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.is_infinite() => Value::String(if f > 0.0 { "inf" } else { "-inf" }.into()),
            Some(f) if f.is_nan() => Value::String("nan".into()),
            _ => Value::Number(n),
        },
        Value::Array(a) => Value::Array(a.into_iter().map(finite).collect()),
        Value::Object(m) => Value::Object(m.into_iter().map(|(k, v)| (k, finite(v))).collect()),
        other => other,
    }
}

fn to_value<T: serde::Serialize>(v: &T) -> Value {
    finite(serde_json::to_value(v).unwrap())
}

fn call(v: &Value) -> Call {
    let f = |i: usize| v[i].as_f64().unwrap();
    Call { sent: f(0), first: f(1), end: f(2), fresh: v[3].as_i64().unwrap(), cached: v[4].as_i64().unwrap(), out: v[5].as_i64() }
}

#[test]
fn flags_tables_and_helpers_agree_with_reduce_lib() {
    let g = golden("flags.json");
    for p in g["probes"].as_array().unwrap() {
        let s = p["text"].as_str().unwrap();
        assert_eq!(json!(flags::flags(flags::res_rx(), s)), p["res"], "res flags of {s:?}");
        assert_eq!(json!(flags::flags(flags::arg_rx(), s)), p["arg"], "arg flags of {s:?}");
        assert_eq!(json!(flags::flags(flags::text_rx(), s)), p["text_flags"], "text flags of {s:?}");
        let summary = if s.is_empty() { json!({}) } else { Value::Object(flags::summary(s)) };
        assert_eq!(summary, p["summary"], "summary of {s:?}");
        assert_eq!(json!(flags::clean(s)), p["home"], "home of {s:?}");
    }
    for e in g["edits"].as_array().unwrap() {
        let (n, old, new) = flags::edit_sizes(e["args"].as_object().unwrap());
        assert_eq!(json!([n, old, new]), e["sizes"], "edit sizes of {}", e["args"]);
    }
    assert_eq!(flags::truncated("a …[truncated 12 chars] b \\u2026[truncated 3 chars]"), (2, 15));
    assert_eq!(py::chars("…"), 1);
}

#[test]
fn llama_log_agrees() {
    let g = golden("llama.json");
    for (name, case) in g.as_object().unwrap() {
        let reqs = llama_log::parse(case["text"].as_str().unwrap());
        assert_eq!(to_value(&reqs), case["requests"], "{name}: requests");
        let (lo, hi) = match name.as_str() {
            "two-starts" => (1_790_390_000.0 + 9000.0, 1e12),
            _ => (0.0, 1e12),
        };
        assert_eq!(llama_log::summarise(&reqs, lo, hi), case["summary"], "{name}: summary");
    }
    assert_eq!(llama_log::start_marker(1_790_390_000.0), "=== server start 1790390000.000 ===\n");
}

#[test]
fn engine_log_agrees() {
    let g = golden("engine.json");
    let texts = &g["texts"];
    let text_of = |name: &str| -> String {
        match name {
            "gufo-no-marker" => texts["gufo-excerpt.txt"].as_str().unwrap().trim_start_matches(|c| c != '\n').trim_start_matches('\n').to_string(),
            "mlx-no-draft" => format!("{}  <- 10+2 tokens streamed [prefill: 1 tok/s, decode: 1 tok/s] [stop]\n", llama_log::start_marker(1_790_390_000.0)),
            "two-runs" => g["matches"]["gufo-two-runs"]["text"].as_str().unwrap().to_string(),
            other => texts[other].as_str().unwrap().to_string(),
        }
    };
    for (name, parsed) in g["parsed"].as_object().unwrap() {
        let reqs = engine_log::parse(&text_of(name));
        assert_eq!(to_value(&reqs), *parsed, "{name}: parsed");
        let all: Vec<&engine_log::Request> = reqs.iter().collect();
        assert_eq!(engine_log::summarise(&all), g["summaries"][name], "{name}: summary");
    }
    for (name, case) in g["matches"].as_object().unwrap() {
        let reqs = engine_log::parse(case["text"].as_str().unwrap());
        let calls: Vec<Call> = case["calls"].as_array().unwrap().iter().map(call).collect();
        assert_eq!(json!(engine_log::match_calls(&reqs, &calls)), case["matched"], "{name}: matched");
    }
}

fn fixture(name: &str) -> String {
    // rows/accounting__pi-nudged.json came from fixtures/accounting/pi-nudged.jsonl
    let rel = name.replace("__", "/");
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/spec-bench/harness/fixtures").join(format!("{rel}.jsonl"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn golden_names(dir: &str) -> Vec<String> {
    let mut names: Vec<String> = std::fs::read_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/golden").join(dir))
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().trim_end_matches(".json").to_string())
        .collect();
    names.sort();
    assert!(names.len() >= 7, "{names:?}");
    names
}

#[test]
fn event_rows_agree_with_the_conversation_database_reader() {
    for name in golden_names("rows") {
        let g = golden(&format!("rows/{name}.json"));
        let rows = dbench::ingest::events::parse(&fixture(&name));
        assert_eq!(to_value(&rows), g, "{name}");
    }
}

#[test]
fn timing_agrees_with_accounting_parse() {
    for name in golden_names("timing") {
        let g = golden(&format!("timing/{name}.json"));
        let t_to = g["t_to"].as_f64().unwrap();
        let parsed = dbench::ingest::timing::parse(&fixture(&name), t_to);
        let mut want = g.clone();
        want.as_object_mut().unwrap().remove("t_to");
        // accounting.Call is a dataclass; the goldens write each call as [sent, first, end, fresh, cached, out].
        let mut got = to_value(&parsed);
        got["calls"] = Value::Array(
            parsed.calls.iter().map(|c| json!([c.sent, c.first, c.end, c.fresh, c.cached, c.out])).collect(),
        );
        assert_eq!(got, want, "{name}");
    }
}
