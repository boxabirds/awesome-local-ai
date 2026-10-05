//! When each thing in a story's log happened: tool calls, compactions, the model's calls (sent, first
//! chunk, end), sessions and the waits between them. The port of accounting.parse
//! (benchmarks/spec-bench/harness/accounting.py), whose rules say when a call with no end event was
//! over. Line by line, like events.rs, so a growing log can be read as far as it goes.

use regex_lite::Regex;
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::OnceLock;

use super::py::{head_chars, str_of};
use super::Call;

pub const CLIENT_STREAM: &str = "client-stream";
pub const CLAUDE_STREAM: &str = "claude-stream";
/// The line the harness writes into the log where it restarts a story.
pub const RESTART_MARK: &str = "harness_attempt";
pub const ENDED_BY_STEP: &str = "the agent's next step";
pub const ENDED_BY_SESSION_END: &str = "its session's end";
pub const ENDED_BY_RESTART: &str = "a harness restart";
pub const ENDED_BY_NEW_SESSION: &str = "the next session's start";
pub const ENDED_BY_WINDOW: &str = "the window's end";
const CLAUDE_INIT: &str = "init";
const CLAUDE_SYSTEM: [&str; 3] = [CLAUDE_INIT, "thinking_tokens", "task_notification"];
/// The tool kind of an agent waiting, its turn ended, for a command it left running.
const BACKGROUND: &str = "background";
const MS_PER_S: f64 = 1000.0;
/// A session this much longer on the wall than by its client's own clock had the machine suspended under it.
const SUSPENSION_MIN_S: f64 = 1.0;
const UPDATE_PREFIX_CHARS: usize = 80;
const UPDATE_MARKS: [&str; 2] = ["\"type\":\"message_update\"", "\"type\": \"message_update\""];
const TOOL_KINDS: [(&str, &str); 3] = [
    ("e2e", r"playwright|test:e2e"),
    ("unit", r"vitest|test:unit|test:component|test:integration|npm (run )?test"),
    ("build", r"npm (ci|install|i\b)|npm run build|vite build|\btsc\b|typecheck"),
];

fn kinds() -> &'static [(&'static str, Regex)] {
    static RX: OnceLock<Vec<(&'static str, Regex)>> = OnceLock::new();
    RX.get_or_init(|| TOOL_KINDS.iter().map(|(k, p)| (*k, Regex::new(p).unwrap())).collect())
}

fn rx_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(r#"^\{"_rx":\s*([0-9.]+)"#).unwrap())
}

/// The kind of a bash command: e2e, unit, build, or bash.
pub fn kind_of_command(cmd: &str) -> &'static str {
    kinds().iter().find(|(_, r)| r.is_match(cmd)).map_or("bash", |(k, _)| k)
}

/// e2e, unit, build for the agent's own test and build commands; the tool's name for reads and edits; bash else.
pub fn tool_kind(e: &Map<String, Value>) -> String {
    match e.get("toolName").and_then(Value::as_str) {
        Some("bash") => {
            let cmd = e.get("args").and_then(Value::as_object).and_then(|a| a.get("command")).map(str_of).unwrap_or_default();
            kind_of_command(&cmd).to_string()
        }
        Some(name) => name.to_string(),
        None => "other".to_string(),
    }
}

/// tool_kind for Claude Code's tools: Bash commands by what they run, every other tool by its name.
pub fn claude_tool_kind(name: &str, input: &Map<String, Value>) -> String {
    if name != "Bash" {
        return (if name.is_empty() { "other" } else { name }).to_lowercase();
    }
    let cmd = input.get("command").map(str_of).unwrap_or_default();
    kind_of_command(&cmd).to_string()
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct Parsed {
    /// (start, end, kind)
    pub tools: Vec<(f64, f64, String)>,
    /// Those of tools with no end event: (start, end, kind, ended by).
    pub cut_tools: Vec<(f64, f64, String, &'static str)>,
    pub compactions: Vec<(f64, f64)>,
    pub cut_compactions: Vec<(f64, f64)>,
    /// (session start, session end, seconds the machine was suspended in it)
    pub suspended: Vec<(f64, f64, f64)>,
    /// (session ended, next session started)
    pub between: Vec<(f64, f64)>,
    pub calls: Vec<Call>,
    pub problems: Vec<String>,
    pub abandoned: i64,
    pub source: &'static str,
}

/// Claude Code's stream state: the agent's last step, when the model started thinking before a
/// message's first block, when the last session ended, whether a background command finished since.
#[derive(Debug, Default)]
struct ClaudeState {
    step: Option<f64>,
    thinking_from: Option<f64>,
    ended: Option<f64>,
    background: bool,
    init: Option<f64>,
    live: bool,
}

/// An insertion-ordered map of the tool calls still open (Python's dict order matters for the output).
#[derive(Debug, Default)]
struct Open(Vec<(Option<String>, (f64, String))>);

impl Open {
    fn get(&self, id: &Option<String>) -> Option<&(f64, String)> {
        self.0.iter().find(|(k, _)| k == id).map(|(_, v)| v)
    }
    fn insert(&mut self, id: Option<String>, v: (f64, String)) {
        match self.0.iter_mut().find(|(k, _)| *k == id) {
            Some(slot) => slot.1 = v,
            None => self.0.push((id, v)),
        }
    }
    fn pop(&mut self, id: &Option<String>) -> Option<(f64, String)> {
        let i = self.0.iter().position(|(k, _)| k == id)?;
        Some(self.0.remove(i).1)
    }
    fn drain(&mut self) -> Vec<(f64, String)> {
        self.0.drain(..).map(|(_, v)| v).collect()
    }
}

#[derive(Debug, Default)]
pub struct Parser {
    out: Parsed,
    starts: Open,
    comp_open: Option<f64>,
    /// [sent, first] of the model call in flight (pi).
    call: Option<(f64, Option<f64>)>,
    /// The agent's steps (model calls, session ends and starts, restarts): a tool that never ended stopped by then.
    steps: Vec<(f64, &'static str)>,
    settled: Option<f64>,
    claude: HashMap<Option<String>, usize>,
    cs: ClaudeState,
    prev: Option<f64>,
    live: bool,
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64)
}

fn int_or_zero(m: &Map<String, Value>, k: &str) -> i64 {
    super::py::int_or_zero(m.get(k))
}

impl Parser {
    pub fn new() -> Self {
        Parser { out: Parsed { source: CLIENT_STREAM, ..Default::default() }, ..Default::default() }
    }

    fn cut_tool(&mut self, started: (f64, String), stop: f64, by: &'static str) {
        let (start, kind) = started;
        self.out.tools.push((start, start.max(stop), kind.clone()));
        self.out.cut_tools.push((start, start.max(stop), kind, by));
    }

    /// Every tool call still open is over: at the agent's first step after it started, else at `at`.
    fn cut_open(&mut self, at: f64, by: &'static str) {
        for started in self.starts.drain() {
            let stop = self
                .steps
                .iter()
                .filter(|s| s.0 > started.0)
                .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then_with(|| a.1.cmp(b.1)))
                .copied()
                .unwrap_or((at, by));
            self.cut_tool(started, stop.0, stop.1);
        }
    }

    pub fn push_line(&mut self, line: &str) {
        let head = head_chars(line, UPDATE_PREFIX_CHARS);
        if UPDATE_MARKS.iter().any(|m| head.contains(m)) {
            if let Some(m) = rx_rx().captures(line) {
                if let Ok(t) = m[1].parse::<f64>() {
                    self.prev = Some(t);
                    if let Some((_, first @ None)) = &mut self.call {
                        *first = Some(t);
                    }
                }
            }
            return;
        }
        let Ok(Value::Object(e)) = serde_json::from_str::<Value>(line) else {
            return;
        };
        let Some(rx) = number(e.get("_rx")) else {
            return;
        };
        let t = e.get("type").and_then(Value::as_str);
        let sub = e.get("subtype").and_then(Value::as_str);
        let role = e.get("message").and_then(Value::as_object).and_then(|m| m.get("role")).and_then(Value::as_str);
        let last = self.prev.unwrap_or(rx);
        self.prev = Some(rx);
        if t == Some("session") || t == Some(RESTART_MARK) || (t == Some("system") && sub == Some(CLAUDE_INIT)) {
            let by = if t == Some(RESTART_MARK) { ENDED_BY_RESTART } else { ENDED_BY_NEW_SESSION };
            self.cut_open(last, by);
            if let Some(a) = self.comp_open.take() {
                self.out.compactions.push((a, a.max(last)));
                self.out.cut_compactions.push((a, a.max(last)));
            }
            if t == Some(RESTART_MARK) {
                self.live = false;
                self.cs.live = false;
                return;
            }
        }
        match t {
            Some("tool_execution_start") => {
                let id = e.get("toolCallId").and_then(Value::as_str).map(String::from);
                if let Some(s) = self.starts.get(&id).cloned() {
                    self.cut_tool(s, rx, ENDED_BY_STEP);
                }
                self.starts.insert(id, (rx, tool_kind(&e)));
            }
            Some("tool_execution_end") => {
                let id = e.get("toolCallId").and_then(Value::as_str).map(String::from);
                match self.starts.pop(&id) {
                    None => self.out.problems.push(format!("a tool call ended without starting ({})", e.get("toolCallId").map_or("None".to_string(), str_of))),
                    Some((start, kind)) => self.out.tools.push((start, rx, kind)),
                }
            }
            Some("agent_end") | Some("agent_settled") => {
                self.settled = Some(rx);
                self.steps.push((rx, ENDED_BY_SESSION_END));
            }
            Some("session") => {
                if let Some(s) = self.settled {
                    self.out.between.push((s, s.max(rx)));
                } else if self.live {
                    self.out.between.push((last, last.max(rx)));
                }
                self.settled = None;
                self.live = true;
            }
            Some("compaction_start") => self.comp_open = Some(rx),
            Some("compaction_end") if self.comp_open.is_some() => {
                let a = self.comp_open.take().unwrap_or(rx);
                self.out.compactions.push((a, rx));
            }
            Some("message_start") if role == Some("assistant") => {
                if self.call.is_some() {
                    self.out.abandoned += 1;
                }
                self.call = Some((rx, None));
                self.steps.push((rx, ENDED_BY_STEP));
            }
            Some("assistant") | Some("user") | Some("result") => self.claude_event(&e, rx, last),
            Some("system") if sub.is_some_and(|s| CLAUDE_SYSTEM.contains(&s)) => self.claude_event(&e, rx, last),
            Some("message_end") if role == Some("assistant") && self.call.is_some() => {
                let (sent, first) = self.call.take().unwrap_or((rx, None));
                let u = e.get("message").and_then(Value::as_object).and_then(|m| m.get("usage")).and_then(Value::as_object).cloned().unwrap_or_default();
                self.out.calls.push(Call {
                    sent,
                    first: first.unwrap_or(rx),
                    end: rx,
                    fresh: int_or_zero(&u, "input"),
                    cached: int_or_zero(&u, "cacheRead"),
                    out: Some(int_or_zero(&u, "output")),
                    id: None,
                });
            }
            _ => {}
        }
    }

    fn claude_event(&mut self, e: &Map<String, Value>, rx: f64, last: f64) {
        let t = e.get("type").and_then(Value::as_str);
        let sub = e.get("subtype").and_then(Value::as_str);
        if super::py::truthy(e.get("parent_tool_use_id")) {
            if t == Some("assistant") {
                self.cs.thinking_from = None;
            }
            return;
        }
        if t == Some("system") && sub == Some("thinking_tokens") {
            if self.cs.thinking_from.is_none() {
                self.cs.thinking_from = Some(rx);
            }
            return;
        }
        if t == Some("system") && sub == Some("task_notification") {
            self.cs.background = self.cs.ended.is_some();
            return;
        }
        if t == Some("system") {
            if let Some(ended) = self.cs.ended {
                let gap = (ended, ended.max(rx));
                if self.cs.background {
                    self.out.tools.push((gap.0, gap.1, BACKGROUND.to_string()));
                } else {
                    self.out.between.push(gap);
                }
            } else if self.cs.live {
                self.out.between.push((last, last.max(rx)));
            }
            self.cs = ClaudeState { step: Some(rx), thinking_from: None, ended: None, background: false, init: Some(rx), live: true };
            return;
        }
        if t == Some("result") {
            self.steps.push((rx, ENDED_BY_SESSION_END));
            if let (Some(init), Some(own)) = (self.cs.init, e.get("duration_ms").filter(|v| v.is_number()).and_then(Value::as_f64)) {
                let asleep = rx - init - own / MS_PER_S;
                if asleep >= SUSPENSION_MIN_S {
                    self.out.suspended.push((init, rx, asleep));
                }
            }
            self.cs.init = None;
            self.cs.step = Some(rx);
            self.cs.thinking_from = None;
            self.cs.ended = Some(rx);
            self.cs.background = false;
            return;
        }
        let m = e.get("message").and_then(Value::as_object).cloned().unwrap_or_default();
        let blocks: Vec<&Map<String, Value>> = match m.get("content") {
            Some(Value::Array(a)) => a.iter().filter_map(Value::as_object).collect(),
            _ => Vec::new(),
        };
        if t == Some("user") {
            for b in blocks {
                if b.get("type").and_then(Value::as_str) == Some("tool_result") {
                    let id = b.get("tool_use_id").and_then(Value::as_str).map(String::from);
                    match self.starts.pop(&id) {
                        None => self.out.problems.push(format!("a tool call ended without starting ({})", b.get("tool_use_id").map_or("None".to_string(), str_of))),
                        Some((start, kind)) => self.out.tools.push((start, rx, kind)),
                    }
                }
            }
            self.cs.step = Some(rx);
            return;
        }
        self.out.source = CLAUDE_STREAM;
        let mid = m.get("id").and_then(Value::as_str).map(String::from);
        let ci = match self.claude.get(&mid) {
            Some(&i) => i,
            None => {
                let u = m.get("usage").and_then(Value::as_object).cloned().unwrap_or_default();
                let first = self.cs.thinking_from.map_or(rx, |t| t.min(rx));
                let c = Call {
                    sent: self.cs.step.unwrap_or(first),
                    first,
                    end: rx,
                    fresh: int_or_zero(&u, "input_tokens") + int_or_zero(&u, "cache_creation_input_tokens"),
                    cached: int_or_zero(&u, "cache_read_input_tokens"),
                    out: None,
                    id: mid.clone(),
                };
                self.out.calls.push(c);
                self.steps.push((first, ENDED_BY_STEP));
                let i = self.out.calls.len() - 1;
                self.claude.insert(mid, i);
                i
            }
        };
        self.out.calls[ci].end = rx;
        for b in blocks {
            if b.get("type").and_then(Value::as_str) == Some("tool_use") {
                let input = b.get("input").and_then(Value::as_object).cloned().unwrap_or_default();
                let id = b.get("id").and_then(Value::as_str).map(String::from);
                if let Some(s) = self.starts.get(&id).cloned() {
                    self.cut_tool(s, rx, ENDED_BY_STEP);
                }
                let kind = claude_tool_kind(b.get("name").and_then(Value::as_str).unwrap_or(""), &input);
                self.starts.insert(id, (rx, kind));
            }
        }
        self.cs.step = Some(rx);
        self.cs.thinking_from = None;
    }

    /// What the log says once it ends at `t_to`: a call still in flight is abandoned, open tool
    /// calls and a compaction end at the window's end.
    pub fn finish(mut self, t_to: f64) -> Parsed {
        if self.call.is_some() {
            self.out.abandoned += 1;
        }
        self.cut_open(t_to, ENDED_BY_WINDOW);
        if let Some(a) = self.comp_open.take() {
            self.out.compactions.push((a, a.max(t_to)));
            self.out.cut_compactions.push((a, a.max(t_to)));
        }
        self.out
    }

    /// What has been read so far, with nothing cut: for a log still growing.
    pub fn so_far(&self) -> &Parsed {
        &self.out
    }
}

/// Tool calls, compactions and streamed model calls from a whole log.
pub fn parse(text: &str, t_to: f64) -> Parsed {
    let mut p = Parser::new();
    for line in text.lines() {
        p.push_line(line);
    }
    p.finish(t_to)
}
