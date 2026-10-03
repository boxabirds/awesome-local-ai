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
    Call { sent: f(0), first: f(1), end: f(2), fresh: v[3].as_i64().unwrap(), cached: v[4].as_i64().unwrap(), out: v[5].as_i64(), id: None }
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

// ---- the warehouse: schema, the write path, the stream ----

use dbench::ingest::{self, db::Db};

/// build_full.py's version-1 columns, in order: the insights scripts read these by name and by `select *`.
const V1_COLUMNS: [(&str, &str); 5] = [
    ("stories", "sk,pack,stack,family,variant,engine,client,machine,run,story,rel,status,passed,total,wall,fmt,source,truncated_strings,truncated_chars,v2,invalid,nudges,started,finished"),
    ("calls", "sk,idx,rx,think,text,n_tools,out_tok,in_tok,cache_tok,stop,sub,think_flags,text_flags,think_full,text_full,think_head,think_tail,text_head,text_tail"),
    ("tools", "sk,call_idx,idx,tid,name,arg,arg_full,arg_chars,start,end,error,res_chars,sub,arg_flags,res_flags,n_edits,old_chars,new_chars,passed,failed,flaky,skipped,args_json,res_full,res_head,res_tail"),
    ("msgs", "sk,idx,rx,role,chars,text_full,text_head"),
    ("compactions", "sk,start,end,reason,summary_chars,summary"),
];

#[test]
fn the_v1_columns_are_an_exact_prefix_of_every_table_the_detect_scripts_read() {
    let db = Db::open_memory().unwrap();
    for (table, cols) in V1_COLUMNS {
        let mut q = db.conn.prepare(&format!("pragma table_info({table})")).unwrap();
        let names: Vec<String> = q.query_map([], |r| r.get::<_, String>(1)).unwrap().map(|r| r.unwrap()).collect();
        let want: Vec<&str> = cols.split(',').collect();
        assert!(names.len() >= want.len(), "{table}: {names:?}");
        assert_eq!(&names[..want.len()], &want[..], "{table}: v1 prefix");
    }
    assert_eq!(db.meta("schema_version").unwrap().as_deref(), Some("2"));
}

#[test]
fn run_paths_and_iso_stamps_are_read() {
    let p = ingest::run_parts("combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1").unwrap();
    assert_eq!(
        (p.stack.as_str(), p.pack.as_str(), p.run.as_str(), p.family.as_str(), p.variant.as_str(), p.machine.as_str(), p.engine.as_str(), p.client.as_str()),
        ("qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi", "vidi", "v2-r1", "qwen 3.8-swift-1.5", "27b", "ubuntu/nvidia4090", "llamacpp", "pi")
    );
    let r = ingest::run_parts("benchmarks/reference/vidi/opus-5.5/run-3").unwrap();
    assert_eq!((r.stack.as_str(), r.pack.as_str(), r.run.as_str(), r.machine.as_str(), r.client.as_str()), ("reference/opus-5.5", "vidi", "run-3", "cloud", "claude-code"));
    assert!(ingest::run_parts("combinations/x/benchmarks/vidi/r1").is_none());
    assert!(ingest::run_parts("docs/x").is_none());
    assert_eq!(ingest::split_story_rel("a/b/stories/07"), Some(("a/b", 7)));
    assert_eq!(ingest::epoch_of("2026-10-02T09:00:00Z"), Some(1_790_931_600.0));
    assert_eq!(ingest::epoch_of("2026-10-02T10:00:00+01:00"), Some(1_790_931_600.0));
    assert_eq!(ingest::epoch_of("2026-10-02T09:00:00.5"), Some(1_790_931_600.5));
    assert_eq!(ingest::epoch_of("nope"), None);
}

fn story_inputs(rel: &str, text: &str, rec: Value, complete: bool) -> ingest::StoryInputs {
    let (run_dir, story) = ingest::split_story_rel(rel).unwrap();
    ingest::StoryInputs {
        rel: rel.to_string(),
        run_dir: run_dir.to_string(),
        story,
        events_text: Some(text.to_string()),
        events_source: ingest::EVENTS_FULL.to_string(),
        events_path: Some("x".into()),
        events_bytes: text.len() as i64,
        rec,
        run_json: json!({"pack_version": "vidi-v2", "started_at": "2026-10-02T09:00:00Z"}),
        status_json: json!({"state": "finished", "at": "2026-10-02T10:00:00Z"}),
        complete,
        inputs_digest: "d1".into(),
        ..Default::default()
    }
}

const RUN: &str = "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1";

#[test]
fn a_story_is_written_whole_its_stream_in_time_order_and_read_back_by_range_and_by_cursor() {
    let mut db = Db::open_memory().unwrap();
    let parts = ingest::run_parts(RUN).unwrap();
    let text = fixture("accounting__pi-nudged");
    let g = golden("rows/accounting__pi-nudged.json");
    let rel = format!("{RUN}/stories/01");
    let rec = json!({"title": "One", "status": "DONE", "accept": {"passed": 3, "total": 4}, "started": 1790000000.0, "agent_finished": 1790000122.0,
                     "agent": {"seconds": 12.5, "nudges": 1, "tokens": {"input": 10, "output": 20, "cache_read": 30},
                               "attempts": [{"attempt": 1, "source": "harness", "started": 1790000000.0, "ended": 1790000122.0, "seconds": 12.5, "steps": 5, "tool_calls": 4, "sessions": ["s1"]}]},
                     "time_split": {"wall_s": 900.0}, "conversation": {"version": 4, "calls": 5}});
    db.upsert_run(RUN, &parts, &json!({"pack_version": "vidi-v2", "started_at": "2026-10-02T09:00:00Z"}), &json!({"state": "finished"}), Some("node-a"), 1.0).unwrap();
    let out = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &text, rec.clone(), true), 1_790_001_000.0).unwrap();
    let sk = out.sk;
    assert_eq!(db.count("calls", sk).unwrap(), g["calls"].as_array().unwrap().len() as i64);
    assert_eq!(db.count("tools", sk).unwrap(), g["tools"].as_array().unwrap().len() as i64);
    assert_eq!(db.count("msgs", sk).unwrap(), g["msgs"].as_array().unwrap().len() as i64);
    assert_eq!(db.count("attempts", sk).unwrap(), 1);
    assert_eq!(db.count("sessions", sk).unwrap(), 1);
    let (status, passed, title, fmt, out_tok): (String, i64, String, String, i64) = db
        .conn
        .query_row("select status, passed, title, fmt, out_tok from stories where sk = ?1", [sk], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .unwrap();
    assert_eq!((status.as_str(), passed, title.as_str(), fmt.as_str(), out_tok), ("DONE", 3, "One", "pi", 20));
    // Every call has its timing from the stream, and every tool its kind.
    let untimed: i64 = db.conn.query_row("select count(*) from calls where sk = ?1 and sent is null", [sk], |r| r.get(0)).unwrap();
    assert_eq!(untimed, 0);
    let kinds: Vec<String> = db.conn.prepare("select kind from tools where sk = ?1 order by idx").unwrap().query_map([sk], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
    assert!(kinds.iter().all(|k| !k.is_empty()), "{kinds:?}");

    // The stream: time order, ords 0.., and the time-range form pages it without loss or repeat.
    let (first, last, latest, n) = db.events_range(sk).unwrap().unwrap();
    assert!(first <= last && latest == n - 1 && n as usize == out.events_written);
    let all = db.events_in_range(sk, i64::MIN, i64::MAX, None, 10_000).unwrap();
    assert_eq!(all.len(), n as usize);
    assert!(all.windows(2).all(|w| (w[0].t_ms, w[0].ord) < (w[1].t_ms, w[1].ord)));
    let mut paged = Vec::new();
    let mut cursor = None;
    loop {
        let page = db.events_in_range(sk, i64::MIN, i64::MAX, cursor, 3).unwrap();
        if page.is_empty() {
            break;
        }
        cursor = page.last().map(|e| (e.t_ms, e.ord));
        paged.extend(page);
    }
    assert_eq!(paged, all);
    // A half-open window.
    let mid = all[all.len() / 2].t_ms;
    let before = db.events_in_range(sk, i64::MIN, mid, None, 10_000).unwrap();
    assert!(before.iter().all(|e| e.t_ms < mid) && !before.is_empty());
    // The open-ended form from the latest cursor: nothing new.
    assert!(db.events_after(sk, latest, 100).unwrap().is_empty());
    assert_eq!(db.events_after(sk, -1, 100).unwrap().len(), n as usize);
    // The synthetic pi log has tool executions but no toolCall blocks, so its rows (as the Python reader has them)
    // carry no tools; its stream has the calls, the compaction and the wait between sessions.
    let kinds: std::collections::BTreeSet<String> = all.iter().map(|e| e.kind.clone()).collect();
    assert!(["call", "compaction_start", "compaction_end", "between_sessions"].iter().all(|k| kinds.contains(*k)), "{kinds:?}");

    // Ingesting the same story again keeps its sk and its stream.
    let again = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &text, rec, true), 1_790_001_001.0).unwrap();
    assert_eq!(again.sk, sk);
    assert_eq!(db.events_range(sk).unwrap().unwrap().3, n);
    assert_eq!(db.collection_digest(sk).unwrap(), Some(("d1".into(), true)));
    assert_eq!(db.complete_story_ids().unwrap(), vec![rel.clone()]);
    // One call in full (this log's rows carry no tools: see above).
    let c = db.call(sk, 0).unwrap().unwrap();
    assert!(c["tools"].is_array() && c["sent"].is_number());
    assert!(db.tool(sk, 0).unwrap().is_none());
    assert!(db.call(sk, 999).unwrap().is_none());
}

#[test]
fn a_story_still_growing_only_ever_gains_ords_and_the_cursor_form_sees_the_growth() {
    let mut db = Db::open_memory().unwrap();
    let parts = ingest::run_parts(RUN).unwrap();
    let text = fixture("accounting__claude-background-and-nudge");
    let lines: Vec<&str> = text.lines().collect();
    let half = lines[..lines.len() / 2].join("\n") + "\n";
    let rel = format!("{RUN}/stories/02");
    let rec = json!({});
    let a = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &half, rec.clone(), false), 1_790_001_000.0).unwrap();
    let (_, _, latest_a, n_a) = db.events_range(a.sk).unwrap().unwrap();
    assert!(n_a > 0);
    let before: Vec<(i64, i64, String)> = db.events_after(a.sk, -1, 1000).unwrap().into_iter().map(|e| (e.ord, e.t_ms, e.kind)).collect();
    // More of the log arrives: the earlier rows keep their ords; the new ones follow, whatever their time.
    let b = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &text, rec.clone(), false), 1_790_001_010.0).unwrap();
    assert_eq!(b.sk, a.sk);
    let after: Vec<(i64, i64, String)> = db.events_after(a.sk, -1, 1000).unwrap().into_iter().map(|e| (e.ord, e.t_ms, e.kind)).collect();
    assert_eq!(&after[..before.len()], &before[..]);
    assert!(after.len() > before.len());
    let new = db.events_after(a.sk, latest_a, 1000).unwrap();
    assert_eq!(new.len(), after.len() - before.len());
    assert!(new.iter().all(|e| e.ord > latest_a));
    assert_eq!(db.collection_digest(a.sk).unwrap(), Some(("d1".into(), false)));
    assert!(db.complete_story_ids().unwrap().is_empty());
    assert_eq!(db.story_ids_with_events().unwrap(), vec![rel.clone()]);
    // Then the story completes: the stream is rebuilt in time order, with everything in it.
    let c = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &text, rec, true), 1_790_001_020.0).unwrap();
    let all = db.events_after(c.sk, -1, 1000).unwrap();
    assert!(all.windows(2).all(|w| (w[0].t_ms, w[0].ord) < (w[1].t_ms, w[1].ord)));
    assert_eq!(all.len(), after.len());
    assert_eq!(db.story_fmt(c.sk).unwrap().as_deref(), Some("claude"));
    let kinds: std::collections::BTreeSet<String> = all.iter().map(|e| e.kind.clone()).collect();
    assert!(["call", "tool_start", "tool_end"].iter().all(|k| kinds.contains(*k)), "{kinds:?}");
    let tool_end = all.iter().find(|e| e.kind == "tool_end").unwrap();
    assert!(tool_end.payload["toolKind"].is_string() && tool_end.payload["seconds"].is_number(), "{}", tool_end.payload);
    assert!(tool_end.payload.get("kind").is_none(), "a payload field must not shadow the event's kind: {}", tool_end.payload);
    // One tool in full, with its call.
    let t = db.tool(c.sk, 0).unwrap().unwrap();
    assert!(t["args"].is_object() && t["kind"].is_string(), "{t}");
    let call = db.call(c.sk, t["callIdx"].as_i64().unwrap()).unwrap().unwrap();
    assert!(call["tools"].as_array().unwrap().iter().any(|x| x["idx"] == 0), "{call}");
}

#[test]
fn llama_server_requests_are_placed_in_the_story_and_call_whose_time_holds_them() {
    let mut db = Db::open_memory().unwrap();
    let parts = ingest::run_parts(RUN).unwrap();
    let text = fixture("accounting__pi-nudged");
    let rel = format!("{RUN}/stories/03");
    let rec = json!({"started": 1790000000.0, "agent_finished": 1790000122.0});
    let out = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &text, rec, true), 1_790_001_000.0).unwrap();
    let n_before = db.events_range(out.sk).unwrap().unwrap().3;
    // A server log whose one request ends inside the story's second call.
    let call = &out.calls.calls[1].1;
    let g = golden("llama.json");
    let smoke = g["smoke"]["text"].as_str().unwrap();
    let body = smoke.split_once('\n').unwrap().1;
    // The marker so that the request's end (41.76 s after the start) lands inside the call.
    let server_log = format!("{}{}", llama_log::start_marker(call.end - 41.76 - 0.1), body);
    let mut complete = std::collections::HashMap::new();
    complete.insert(out.sk, true);
    let added = ingest::ingest_run_requests(&mut db, RUN, Some(&server_log), std::slice::from_ref(&out.calls), &complete).unwrap();
    assert_eq!(added, 1);
    let (sk, call_idx, prompt, decode_tok_s): (Option<i64>, Option<i64>, i64, f64) = db
        .conn
        .query_row("select sk, call_idx, prompt_tok, decode_tok_s from requests where run_id = ?1 and source = 'llama-log'", [RUN], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap();
    assert_eq!((sk, call_idx, prompt, decode_tok_s), (Some(out.sk), Some(1), 45, 28.7));
    // The request joined the stream, after the story's own rows (ord append-only) and at its own time.
    let all = db.events_after(out.sk, -1, 10_000).unwrap();
    assert_eq!(all.len() as i64, n_before + 1);
    let r = all.last().unwrap();
    assert_eq!(r.kind, "request");
    assert!(r.t_ms < all[all.len() - 2].t_ms, "placed earlier in time than the row before it in ord");
    // A second pass with the same log adds nothing.
    assert_eq!(ingest::ingest_run_requests(&mut db, RUN, Some(&server_log), std::slice::from_ref(&out.calls), &complete).unwrap(), 0);
}


// ---- the binary: dbench ingest over a published tree and a lake ----

fn gzip(text: &str) -> Vec<u8> {
    use std::io::Write;
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    enc.write_all(text.as_bytes()).unwrap();
    enc.finish().unwrap()
}

fn ingest_cmd(args: &[&str]) -> (bool, String) {
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_dbench")).arg("--json").arg("ingest").args(args).output().unwrap();
    (out.status.success(), format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr)))
}

#[test]
fn dbench_ingest_builds_the_database_from_the_published_tree_and_the_lake_and_redoes_only_what_changed() {
    let root = std::env::temp_dir().join(format!("dbench-ingest-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let tree = root.join("repo");
    let store = root.join("store");
    let db_path = root.join("insights/conversations.db");
    let run = tree.join(RUN);
    // Published: a run with two stories; story 1 has its compact log, story 2 only its record (its full log is in the lake).
    std::fs::create_dir_all(run.join("stories/01")).unwrap();
    std::fs::write(run.join("stories/01/agent-events.compact.jsonl.gz"), gzip(&fixture("accounting__claude-slept"))).unwrap();
    std::fs::write(run.join("run.json"), r#"{"pack_version": "vidi-v2", "model_id": "m", "started_at": "2026-10-02T09:00:00Z"}"#).unwrap();
    std::fs::write(run.join("run-status.json"), r#"{"state": "finished", "at": "2026-10-02T10:00:00Z"}"#).unwrap();
    std::fs::write(
        run.join("metrics.json"),
        r#"{"stories": {"1": {"title": "One", "status": "DONE", "started": 1790000000.0, "agent_finished": 1790000140.7, "accept": {"passed": 2, "total": 2}},
                        "2": {"title": "Two", "status": "DONE", "started": 1790000000.0, "agent_finished": 1790000122.0, "accept": {"passed": 1, "total": 3}}}}"#,
    )
    .unwrap();
    // A re-score's copy is not a conversation.
    std::fs::create_dir_all(run.join("rescore/v1/stories/01")).unwrap();
    std::fs::write(run.join("rescore/v1/stories/01/agent-events.compact.jsonl.gz"), gzip("")).unwrap();
    // The lake: node-a holds the run's full log for story 2, a server log, and the collector's record.
    let lake = store.join("node-a").join(RUN);
    std::fs::create_dir_all(lake.join("stories/02")).unwrap();
    std::fs::write(lake.join("stories/02/agent-events.jsonl"), fixture("accounting__pi-nudged")).unwrap();
    std::fs::write(lake.join("server.log"), golden("llama.json")["smoke"]["text"].as_str().unwrap()).unwrap();
    std::fs::write(lake.join("collection.json"), r#"{"node": "node-a", "complete": true, "collected_at": 1790001000.0}"#).unwrap();

    let common = [
        "--db", db_path.to_str().unwrap(), "--repo", tree.to_str().unwrap(), "--store", store.to_str().unwrap(), "--worktree",
    ];
    let (ok, out) = ingest_cmd(&[&common[..], &["--rebuild"]].concat());
    assert!(ok, "{out}");
    let summary: Value = serde_json::from_str(&out).unwrap();
    assert_eq!((summary["candidates"].as_u64(), summary["ingested"].as_u64(), summary["runs"].as_u64()), (Some(2), Some(2), Some(1)));
    assert!(db_path.is_file() && !db_path.with_extension("db.new").exists());

    let db = Db::open_read_only(&db_path).unwrap();
    let rows: Vec<(String, String, String, Option<String>, i64)> = db
        .conn
        .prepare("select s.rel, s.source, s.status, c.node, c.complete from stories s join collection c on c.sk = s.sk order by s.rel")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(
        rows,
        vec![
            // Story 1's log came from git, but the run itself was collected from node-a, so that is its node too.
            (format!("{RUN}/stories/01"), "compact".into(), "DONE".into(), Some("node-a".into()), 1),
            (format!("{RUN}/stories/02"), "full".into(), "DONE".into(), Some("node-a".into()), 1),
        ]
    );
    let (node, state): (Option<String>, Option<String>) = db.conn.query_row("select node, state from runs where id = ?1", [RUN], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    assert_eq!((node.as_deref(), state.as_deref()), (Some("node-a"), Some("finished")));
    assert_eq!(db.meta("source").unwrap().unwrap(), format!("tree {}", tree.display()));
    let n_req: i64 = db.conn.query_row("select count(*) from requests where run_id = ?1", [RUN], |r| r.get(0)).unwrap();
    assert_eq!(n_req, 1);
    drop(db);

    // Nothing changed: nothing is redone. A grown log is.
    let (ok, out) = ingest_cmd(&common);
    assert!(ok, "{out}");
    let summary: Value = serde_json::from_str(&out).unwrap();
    assert_eq!((summary["ingested"].as_u64(), summary["unchanged"].as_u64()), (Some(0), Some(2)));
    std::fs::write(lake.join("collection.json"), r#"{"node": "node-a", "complete": false, "collected_at": 1790001100.0}"#).unwrap();
    let (ok, out) = ingest_cmd(&common);
    assert!(ok, "{out}");
    let summary: Value = serde_json::from_str(&out).unwrap();
    // The run's collection record is an input of both its stories.
    assert_eq!(summary["ingested"].as_u64(), Some(2));
    // --only narrows to one story; --schema prints the schema.
    let (ok, out) = ingest_cmd(&[&common[..], &["--all", "--only", &format!("{RUN}/stories/01")]].concat());
    assert!(ok, "{out}");
    assert_eq!(serde_json::from_str::<Value>(&out).unwrap()["candidates"].as_u64(), Some(1));
    let (ok, out) = ingest_cmd(&[&common[..], &["--schema"]].concat());
    assert!(ok && out.contains("create table if not exists events"), "{out}");
    std::fs::remove_dir_all(&root).unwrap();
}

// ---- the conversation API over the warehouse ----

async fn api_server(db_path: PathBuf) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let router = dbench::conversation_api::router(std::sync::Arc::new(dbench::conversation_api::Shared { db_path }));
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}")
}

async fn get_json(url: &str) -> (u16, Value) {
    let r = reqwest::get(url).await.unwrap();
    let status = r.status().as_u16();
    let text = r.text().await.unwrap();
    (status, serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

#[tokio::test(flavor = "multi_thread")]
async fn the_conversation_api_pages_a_story_by_time_range_and_by_cursor_without_loss_or_repeat() {
    let root = std::env::temp_dir().join(format!("dbench-api-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    let db_path = root.join("conversations.db");
    let parts = ingest::run_parts(RUN).unwrap();
    let rel = format!("{RUN}/stories/05");
    {
        let mut db = Db::open(&db_path).unwrap();
        let rec = json!({"started": 1790000000.0, "agent_finished": 1790000140.7});
        // A finished story, then a late-placed request (earlier in time, later in ord).
        let out = ingest::ingest_story(&mut db, &parts, &story_inputs(&rel, &fixture("accounting__claude-slept"), rec, true), 1_790_001_000.0).unwrap();
        let late = ingest::RequestRow { sk: Some(out.sk), call_idx: Some(0), ts: Some(1_790_000_003.0), prompt_tok: Some(10), ..Default::default() };
        let empty = ingest::events::Rows::default();
        let none = ingest::timing::Parsed::default();
        let stream = ingest::stream_events(&empty, &none, &[], &[(0, &late)], &[]);
        db.append_events(out.sk, &stream).unwrap();
    }
    let base = api_server(db_path).await;
    let id = urlencoding(&rel);
    let (code, v) = get_json(&format!("{base}/v1/conversations/{id}")).await;
    assert_eq!(code, 200, "{v}");
    let total = v["events"].as_u64().unwrap() as usize;
    assert!(total > 5 && v["range"]["fromMs"].is_i64() && v["complete"] == true && v["fmt"] == "claude", "{v}");
    assert_eq!(v["counts"]["requests"], 1);
    // Time-range form, pages of 3: every event exactly once, in (tMs, ord) order.
    let mut got: Vec<(i64, i64)> = Vec::new();
    let mut cursor: Option<String> = None;
    loop {
        let url = match &cursor {
            Some(c) => format!("{base}/v1/conversations/{id}/events?limit=3&cursor={c}"),
            None => format!("{base}/v1/conversations/{id}/events?limit=3"),
        };
        let (code, page) = get_json(&url).await;
        assert_eq!(code, 200, "{page}");
        for e in page["events"].as_array().unwrap() {
            got.push((e["tMs"].as_i64().unwrap(), e["ord"].as_i64().unwrap()));
        }
        match page["nextCursor"].as_str() {
            Some(c) => cursor = Some(c.to_string()),
            None => break,
        }
    }
    assert_eq!(got.len(), total);
    assert!(got.windows(2).all(|w| w[0] < w[1]), "{got:?}");
    let mut sorted = got.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(sorted.len(), total, "no event twice");
    // The same span in one page is the same list; a half-open window holds what it should.
    let (_, all) = get_json(&format!("{base}/v1/conversations/{id}/events?limit=500")).await;
    let all_pairs: Vec<(i64, i64)> = all["events"].as_array().unwrap().iter().map(|e| (e["tMs"].as_i64().unwrap(), e["ord"].as_i64().unwrap())).collect();
    assert_eq!(all_pairs, got);
    assert!(all["nextCursor"].is_null());
    let mid = got[got.len() / 2].0;
    let (_, before) = get_json(&format!("{base}/v1/conversations/{id}/events?toMs={mid}&limit=500")).await;
    assert!(before["events"].as_array().unwrap().iter().all(|e| e["tMs"].as_i64().unwrap() < mid));
    let (_, from) = get_json(&format!("{base}/v1/conversations/{id}/events?fromMs={mid}&limit=500")).await;
    assert_eq!(before["events"].as_array().unwrap().len() + from["events"].as_array().unwrap().len(), total);
    // The open-ended form: after=0 is everything in ord order; the late request is last by ord though early in time.
    let (_, stream) = get_json(&format!("{base}/v1/conversations/{id}/events?after=0&limit=500")).await;
    let evs = stream["events"].as_array().unwrap();
    assert_eq!(evs.len(), total);
    assert_eq!(evs.last().unwrap()["kind"], "request");
    assert!(evs.last().unwrap()["tMs"].as_i64().unwrap() < evs[evs.len() - 2]["tMs"].as_i64().unwrap());
    let latest = stream["nextCursor"].as_str().unwrap().to_string();
    assert_eq!(v["latest"].as_str().unwrap(), latest);
    let (_, nothing) = get_json(&format!("{base}/v1/conversations/{id}/events?after={latest}")).await;
    assert!(nothing["events"].as_array().unwrap().is_empty());
    assert_eq!(nothing["nextCursor"].as_str().unwrap(), latest);
    // Refusals and the not-available case: 404 with an empty object, no reason.
    let (code, v) = get_json(&format!("{base}/v1/conversations/{id}/events?limit=0")).await;
    assert_eq!(code, 400, "{v}");
    let (code, v) = get_json(&format!("{base}/v1/conversations/{id}/events?cursor=garbage")).await;
    assert_eq!(code, 400, "{v}");
    let (code, v) = get_json(&format!("{base}/v1/conversations/{id}/events?unknown=1")).await;
    assert_eq!(code, 400, "{v}");
    let (code, v) = get_json(&format!("{base}/v1/conversations/{}", urlencoding("nope/stories/01"))).await;
    assert_eq!((code, v), (404, json!({})));
    let (code, v) = get_json(&format!("{base}/v1/conversations/{id}/calls/0")).await;
    assert_eq!(code, 200);
    assert!(v["tools"].is_array());
    // A tool event keeps its own kind over the API, with the tool's kind beside it.
    let (_, stream) = get_json(&format!("{base}/v1/conversations/{id}/events?after=0&limit=500")).await;
    let ts = stream["events"].as_array().unwrap().iter().find(|e| e["kind"] == "tool_start").unwrap();
    assert!(ts["toolKind"].is_string(), "{ts}");
    let (code, _) = get_json(&format!("{base}/v1/conversations/{id}/tools/0")).await;
    assert_eq!(code, 200);
    let (code, v) = get_json(&format!("{base}/v1/conversations/{id}/calls/99")).await;
    assert_eq!((code, v), (404, json!({})));
    let (_, avail) = get_json(&format!("{base}/v1/conversations")).await;
    assert_eq!(avail["ids"], json!([rel.clone()]));
    assert_eq!(avail["complete"], json!([rel.clone()]));
    std::fs::remove_dir_all(&root).unwrap();
}

fn urlencoding(s: &str) -> String {
    dbench::client::urlencode(s)
}

#[test]
fn the_lake_run_that_counts_is_the_node_that_holds_the_files_not_the_newest_empty_copy() {
    let root = std::env::temp_dir().join(format!("dbench-lake-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    let store = root.join("store");
    // Two nodes hold the same run directory: the one that ran it (with the files, collected earlier) and another
    // whose checkout merely has the published files (nothing collectable, collected later).
    let ran = store.join("node-ran").join(RUN);
    let other = store.join("node-other").join(RUN);
    std::fs::create_dir_all(ran.join("stories/01")).unwrap();
    std::fs::create_dir_all(&other).unwrap();
    std::fs::write(ran.join("stories/01/agent-events.jsonl"), "{}\n").unwrap();
    std::fs::write(ran.join("collection.json"), r#"{"node": "node-ran", "complete": true, "collected_at": 100.0, "files": {"stories/01/agent-events.jsonl": {"bytes": 3}}}"#).unwrap();
    std::fs::write(other.join("collection.json"), r#"{"node": "node-other", "complete": true, "collected_at": 200.0, "files": {}}"#).unwrap();
    let lake = ingest::inputs::lake_runs(&store).unwrap();
    assert_eq!(lake.get(RUN).map(|l| l.node.as_str()), Some("node-ran"));
    std::fs::remove_dir_all(&root).unwrap();
}

// ---- the warehouse holds no reference model's conversations (owner, 3 Oct 2026) ----

#[test]
fn ingest_never_sees_a_reference_models_runs() {
    use dbench::ingest::inputs::{candidates, Published, TreeSource};
    let root = std::env::temp_dir().join(format!("dbench-ingest-ref-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    for dir in ["combinations/q/w/v/os/m/llamacpp-pi/benchmarks/vidi/v2-r1/stories/01", "benchmarks/reference/vidi/opus-5.5/run-9/stories/01"] {
        std::fs::create_dir_all(root.join(dir)).unwrap();
        std::fs::write(root.join(dir).join("agent-events.compact.jsonl.gz"), b"").unwrap();
    }
    let src = TreeSource { root: root.clone() };
    assert!(src.paths().unwrap().keys().all(|p| !p.contains("reference")), "the published tree must not list reference runs");
    let got = candidates(&src, &Default::default()).unwrap();
    assert_eq!(got.len(), 1, "{got:?}");
    assert!(got.iter().next().unwrap().starts_with("combinations/"));
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_reference_models_rows_already_in_the_warehouse_are_purged_from_every_table() {
    use dbench::ingest::db::Db;
    use rusqlite::params;
    let mut db = Db::open_memory().unwrap();
    for (run_id, stack, rel) in [
        ("combinations/q/run", "q/w/v/os/m/llamacpp-pi", "combinations/q/run/stories/01"),
        ("benchmarks/reference/vidi/opus-5.5/run-9", "reference/opus-5.5", "benchmarks/reference/vidi/opus-5.5/run-9/stories/01"),
    ] {
        let c = &db.conn;
        c.execute("insert or ignore into runs(id) values (?1)", params![run_id]).unwrap();
        c.execute("insert into stories(rel, run_id, stack, run, story) values (?1, ?2, ?3, 'r', 1)", params![rel, run_id, stack]).unwrap();
        let sk = c.last_insert_rowid();
        c.execute("insert into calls(sk, idx) values (?1, 0)", params![sk]).unwrap();
        c.execute("insert into tools(sk, idx) values (?1, 0)", params![sk]).unwrap();
        c.execute("insert into msgs(sk, idx) values (?1, 0)", params![sk]).unwrap();
        c.execute("insert into compactions(sk) values (?1)", params![sk]).unwrap();
        c.execute("insert into collection(sk) values (?1)", params![sk]).unwrap();
        c.execute("insert into events(sk, ord, t_ms, kind) values (?1, 0, 1, 'call')", params![sk]).unwrap();
        c.execute("insert into requests(run_id, source, idx, sk) values (?1, 'engine-log', 0, ?2)", params![run_id, sk]).unwrap();
        c.execute("insert into conditions(run_id, at, sk) values (?1, 1.0, ?2)", params![run_id, sk]).unwrap();
    }
    let removed = db.purge_reference().unwrap();
    let c = &db.conn;
    assert_eq!(removed, 1);
    for (table, expect) in [("runs", 1), ("stories", 1), ("calls", 1), ("tools", 1), ("msgs", 1), ("compactions", 1), ("collection", 1), ("events", 1), ("requests", 1), ("conditions", 1)] {
        let n: i64 = c.query_row(&format!("select count(*) from {table}"), [], |r| r.get(0)).unwrap();
        assert_eq!(n, expect, "{table}");
    }
    let left: i64 = c.query_row("select count(*) from stories where stack like 'reference/%'", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
    let again = db.purge_reference().unwrap();
    assert_eq!(again, 0); // idempotent
}
