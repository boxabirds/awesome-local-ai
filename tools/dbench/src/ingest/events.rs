//! The warehouse rows of one story's event log: every model call (its thinking and text whole), every
//! tool call (arguments and result whole), every message the harness sent, every compaction. The port
//! of the reader behind the conversation database (benchmarks/docs/insights/scripts/build_full.py,
//! kept in export_goldens.py). Both pi's log and Claude Code's stream-json are read.
//!
//! The parser takes one line at a time, so a log still being appended to can be read as far as it
//! goes and continued later: `push_line` for each complete line, `rows()` for what has been read.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

use super::flags::{self, arg_rx, clean, edit_sizes, flags as find_flags, res_rx, summary, text_rx};
use super::py::{chars, dumps, head_chars, str_of, truthy};

/// A line whose type is one of these within its first characters is a stream delta or a bare
/// marker: skipped without parsing (most of a full log is deltas).
const SKIP: [&str; 6] = [
    "\"message_update\"",
    "\"agent_end\"",
    "\"turn_end\"",
    "\"message_start\"",
    "\"tool_execution_update\"",
    "\"stream_event\"",
];
const SKIP_PREFIX_CHARS: usize = 90;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CallRow {
    pub idx: usize,
    pub rx: Value,
    pub think: usize,
    pub text: usize,
    pub n_tools: usize,
    pub out_tok: Value,
    pub in_tok: Value,
    pub cache_tok: Value,
    pub stop: Value,
    pub sub: i64,
    pub think_flags: Vec<&'static str>,
    pub text_flags: Vec<&'static str>,
    pub think_full: String,
    pub text_full: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ToolRow {
    pub idx: usize,
    pub tid: Value,
    pub call: usize,
    pub name: Value,
    pub arg: String,
    pub arg_chars: usize,
    pub start: Value,
    pub end: Value,
    pub error: Option<i64>,
    pub res_chars: Option<usize>,
    pub sub: i64,
    pub arg_flags: Vec<&'static str>,
    pub res_flags: Vec<&'static str>,
    pub n_edits: i64,
    pub old_chars: usize,
    pub new_chars: usize,
    pub passed: Option<i64>,
    pub failed: Option<i64>,
    pub flaky: Option<i64>,
    pub skipped: Option<i64>,
    pub args_json: String,
    pub res: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MsgRow {
    pub idx: usize,
    pub rx: Value,
    pub role: &'static str,
    pub chars: usize,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompactionRow {
    pub start: Value,
    pub end: Value,
    pub reason: Value,
    pub summary_chars: usize,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct Rows {
    pub fmt: Option<&'static str>,
    pub truncated_strings: i64,
    pub truncated_chars: i64,
    pub calls: Vec<CallRow>,
    pub tools: Vec<ToolRow>,
    pub msgs: Vec<MsgRow>,
    pub compactions: Vec<CompactionRow>,
}

#[derive(Debug, Clone)]
struct ToolBuild {
    call: usize,
    name: Value,
    arg: String,
    aj: String,
    start: Value,
    end: Value,
    err: Option<i64>,
    res: Option<String>,
    sub: i64,
    ne: i64,
    oc: usize,
    nc: usize,
}

/// Reads a log line by line; `rows()` is what has been read so far.
#[derive(Debug, Default)]
pub struct Parser {
    fmt: Option<&'static str>,
    ntr: i64,
    ctr: i64,
    calls: Vec<CallRow>,
    tools: HashMap<Option<String>, ToolBuild>,
    order: Vec<Option<String>>,
    msgs: Vec<MsgRow>,
    comps: Vec<CompactionRow>,
    comp_start: Value,
    by_mid: HashMap<Option<String>, usize>,
}

/// The text of a content value: a string as it is, else its text blocks joined.
pub fn text_of(content: Option<&Value>) -> String {
    match content {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|b| b.as_object())
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .map(|b| b.get("text").and_then(Value::as_str).unwrap_or(""))
            .collect(),
        _ => String::new(),
    }
}

fn blocks(m: &Map<String, Value>) -> Vec<&Map<String, Value>> {
    match m.get("content") {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_object).collect(),
        _ => Vec::new(),
    }
}

fn block_type(b: &Map<String, Value>) -> Option<&str> {
    b.get("type").and_then(Value::as_str)
}

fn obj(v: Option<&Value>) -> Option<&Map<String, Value>> {
    v.and_then(Value::as_object)
}

fn opt_string(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).map(String::from)
}

fn get(m: &Map<String, Value>, k: &str) -> Value {
    m.get(k).cloned().unwrap_or(Value::Null)
}

/// `a.get(k) or fallback`, as the text of the argument the tool call is about.
fn arg_of(a: &Map<String, Value>, keys: &[&str], aj: &str) -> String {
    let found = keys.iter().map(|k| a.get(*k)).find(|v| truthy(*v)).flatten();
    match found {
        Some(v) if !v.is_null() => clean(&str_of(v)),
        _ => clean(aj),
    }
}

impl Parser {
    pub fn new() -> Self {
        Self::default()
    }

    /// One complete line of the log.
    pub fn push_line(&mut self, line: &str) {
        let head = head_chars(line, SKIP_PREFIX_CHARS);
        if SKIP.iter().any(|s| head.contains(s)) {
            return;
        }
        let (n, c) = flags::truncated(line);
        self.ntr += n;
        self.ctr += c;
        let Ok(Value::Object(e)) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let t = e.get("type").and_then(Value::as_str);
        let rx = get(&e, "_rx");
        match t {
            Some("message_end") => {
                self.fmt = Some("pi");
                let msg = obj(e.get("message")).cloned().unwrap_or_default();
                match msg.get("role").and_then(Value::as_str) {
                    Some("assistant") => self.pi_assistant(&msg, rx),
                    Some("user") => {
                        let tx = clean(&text_of(msg.get("content")));
                        self.msgs.push(MsgRow { idx: self.msgs.len(), rx, role: "user", chars: chars(&tx), text: tx });
                    }
                    _ => {}
                }
            }
            Some("tool_execution_start") => {
                if let Some(d) = self.tools.get_mut(&opt_string(e.get("toolCallId"))) {
                    d.start = rx;
                }
            }
            Some("tool_execution_end") => {
                if let Some(d) = self.tools.get_mut(&opt_string(e.get("toolCallId"))) {
                    d.end = rx;
                    d.err = Some(i64::from(truthy(e.get("isError"))));
                    d.res = Some(clean(&text_of(obj(e.get("result")).and_then(|r| r.get("content")))));
                }
            }
            Some("compaction_start") => self.comp_start = rx,
            Some("compaction_end") => {
                let r = obj(e.get("result")).cloned().unwrap_or_default();
                let summary = r.get("summary").and_then(Value::as_str).unwrap_or("");
                self.comps.push(CompactionRow {
                    start: std::mem::replace(&mut self.comp_start, Value::Null),
                    end: rx,
                    reason: get(&e, "reason"),
                    summary_chars: chars(summary),
                    summary: clean(summary),
                });
            }
            Some("assistant") if e.get("message").is_some_and(Value::is_object) => self.claude_assistant(&e, rx),
            Some("user") if e.get("message").is_some_and(Value::is_object) => self.claude_user(&e, rx),
            _ => {}
        }
    }

    fn pi_assistant(&mut self, msg: &Map<String, Value>, rx: Value) {
        let content = blocks(msg);
        let th = clean(&content.iter().filter(|b| block_type(b) == Some("thinking")).map(|b| b.get("thinking").and_then(Value::as_str).unwrap_or("")).collect::<String>());
        let tx = clean(&text_of(msg.get("content")));
        let tcs: Vec<&Map<String, Value>> = content.iter().copied().filter(|b| block_type(b) == Some("toolCall")).collect();
        let u = obj(msg.get("usage")).cloned().unwrap_or_default();
        let idx = self.calls.len();
        self.calls.push(CallRow {
            idx,
            rx,
            think: chars(&th),
            text: chars(&tx),
            n_tools: tcs.len(),
            out_tok: get(&u, "output"),
            in_tok: get(&u, "input"),
            cache_tok: get(&u, "cacheRead"),
            stop: get(msg, "stopReason"),
            sub: 0,
            think_flags: find_flags(text_rx(), &th),
            text_flags: find_flags(text_rx(), &tx),
            think_full: th,
            text_full: tx,
        });
        for b in tcs {
            let a = obj(b.get("arguments")).cloned().unwrap_or_default();
            let aj = clean(&dumps(&Value::Object(a.clone())));
            let arg = if b.get("name").and_then(Value::as_str) == Some("bash") { arg_of(&a, &["command"], &aj) } else { arg_of(&a, &["path"], &aj) };
            let (ne, oc, nc) = edit_sizes(&a);
            let tid = opt_string(b.get("id"));
            self.tools.insert(tid.clone(), ToolBuild { call: idx, name: get(b, "name"), arg, aj, start: Value::Null, end: Value::Null, err: None, res: None, sub: 0, ne, oc, nc });
            self.order.push(tid);
        }
    }

    fn claude_assistant(&mut self, e: &Map<String, Value>, rx: Value) {
        self.fmt = Some("claude");
        let msg = obj(e.get("message")).cloned().unwrap_or_default();
        let mid = opt_string(msg.get("id"));
        let sub = i64::from(truthy(e.get("parent_tool_use_id")));
        let row = match self.by_mid.get(&mid) {
            Some(&i) => i,
            None => {
                let u = obj(msg.get("usage")).cloned().unwrap_or_default();
                let i = self.calls.len();
                self.by_mid.insert(mid.clone(), i);
                self.calls.push(CallRow {
                    idx: i,
                    rx: rx.clone(),
                    think: 0,
                    text: 0,
                    n_tools: 0,
                    out_tok: get(&u, "output_tokens"),
                    in_tok: get(&u, "input_tokens"),
                    cache_tok: get(&u, "cache_read_input_tokens"),
                    stop: get(&msg, "stop_reason"),
                    sub,
                    think_flags: Vec::new(),
                    text_flags: Vec::new(),
                    think_full: String::new(),
                    text_full: String::new(),
                });
                i
            }
        };
        for b in blocks(&msg) {
            match block_type(b) {
                Some("text") => {
                    let tx = clean(b.get("text").and_then(Value::as_str).unwrap_or(""));
                    let call = &mut self.calls[row];
                    call.text_full.push_str(&tx);
                    call.text = chars(&call.text_full);
                    call.text_flags = find_flags(text_rx(), &call.text_full);
                }
                Some("tool_use") => {
                    self.calls[row].n_tools += 1;
                    let a = obj(b.get("input")).cloned().unwrap_or_default();
                    let aj = clean(&dumps(&Value::Object(a.clone())));
                    let arg = if b.get("name").and_then(Value::as_str) == Some("Bash") {
                        arg_of(&a, &["command"], &aj)
                    } else {
                        arg_of(&a, &["file_path", "path", "pattern"], &aj)
                    };
                    let (ne, oc, nc) = edit_sizes(&a);
                    let tid = opt_string(b.get("id"));
                    self.tools.insert(tid.clone(), ToolBuild { call: row, name: get(b, "name"), arg, aj, start: rx.clone(), end: Value::Null, err: None, res: None, sub, ne, oc, nc });
                    self.order.push(tid);
                }
                _ => {}
            }
        }
    }

    fn claude_user(&mut self, e: &Map<String, Value>, rx: Value) {
        let msg = obj(e.get("message")).cloned().unwrap_or_default();
        match msg.get("content") {
            Some(Value::String(c)) => {
                self.msgs.push(MsgRow { idx: self.msgs.len(), rx, role: "user", chars: chars(c), text: clean(c) });
            }
            Some(Value::Array(a)) => {
                for b in a.iter().filter_map(Value::as_object) {
                    match block_type(b) {
                        Some("tool_result") => {
                            if let Some(d) = self.tools.get_mut(&opt_string(b.get("tool_use_id"))) {
                                let res = match b.get("content") {
                                    Some(Value::String(s)) => s.clone(),
                                    other => text_of(other),
                                };
                                d.end = rx.clone();
                                d.err = Some(i64::from(truthy(b.get("is_error"))));
                                d.res = Some(clean(&res));
                            }
                        }
                        Some("text") if !truthy(e.get("parent_tool_use_id")) => {
                            let tx = clean(b.get("text").and_then(Value::as_str).unwrap_or(""));
                            self.msgs.push(MsgRow { idx: self.msgs.len(), rx: rx.clone(), role: "user", chars: chars(&tx), text: tx });
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    /// Everything read so far.
    pub fn rows(&self) -> Rows {
        let tools = self
            .order
            .iter()
            .enumerate()
            .filter_map(|(i, tid)| self.tools.get(tid).map(|d| (i, tid, d)))
            .map(|(i, tid, d)| {
                let res = d.res.as_deref();
                let sm = res.filter(|r| !r.is_empty()).map(summary).unwrap_or_default();
                let count = |k: &str| sm.get(k).and_then(Value::as_i64);
                ToolRow {
                    idx: i,
                    tid: tid.clone().map_or(Value::Null, Value::String),
                    call: d.call,
                    name: d.name.clone(),
                    arg: d.arg.clone(),
                    arg_chars: chars(&d.aj),
                    start: d.start.clone(),
                    end: d.end.clone(),
                    error: d.err,
                    res_chars: res.map(chars),
                    sub: d.sub,
                    arg_flags: find_flags(arg_rx(), &d.aj),
                    res_flags: res.map(|r| find_flags(res_rx(), r)).unwrap_or_default(),
                    n_edits: d.ne,
                    old_chars: d.oc,
                    new_chars: d.nc,
                    passed: count("passed"),
                    failed: count("failed"),
                    flaky: count("flaky"),
                    skipped: count("skipped"),
                    args_json: d.aj.clone(),
                    res: d.res.clone(),
                }
            })
            .collect();
        Rows {
            fmt: self.fmt,
            truncated_strings: self.ntr,
            truncated_chars: self.ctr,
            calls: self.calls.clone(),
            tools,
            msgs: self.msgs.clone(),
            compactions: self.comps.clone(),
        }
    }
}

/// The rows of a whole log.
pub fn parse(text: &str) -> Rows {
    let mut p = Parser::new();
    for line in text.lines() {
        p.push_line(line);
    }
    p.rows()
}
