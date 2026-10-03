//! The insights scripts' flag tables (benchmarks/docs/insights/scripts/reduce_lib.py): patterns looked
//! for in a tool's result, in a tool call's arguments, and in the model's thinking or text; the test
//! summary read from a result's tail; the size of an edit; home paths replaced by `~`.

use regex::Regex;
use serde_json::{Map, Value};
use std::sync::OnceLock;

use super::py::{chars, tail_chars};

type Table = &'static [(&'static str, &'static str)];

/// Looked for anywhere in a tool result.
pub const RES_FLAGS: Table = &[
    ("perm_denied", r"[Pp]ermission denied|EACCES|EPERM|Operation not permitted|Read-only file system|EROFS"),
    ("not_found_cmd", r"command not found|not recognized as an internal"),
    ("no_such_file", r"No such file or directory|ENOENT"),
    ("addr_in_use", r"EADDRINUSE|address already in use"),
    ("timed_out", r"[Tt]imed out|[Tt]imeout of \d+|Test timeout|exceeded.{0,20}time|ETIMEDOUT|timeout \d+ms"),
    ("edit_mismatch", r"Could not find|oldText|old_string|not found in file|must be unique|matches multiple|No match"),
    ("ts_error", r"error TS\d+"),
    ("syntax_error", r"SyntaxError|Unexpected token|Parse error"),
    ("module_missing", r"Cannot find module|Cannot find package|ERR_MODULE_NOT_FOUND|Module not found"),
    ("npm_error", r"npm ERR!|npm error"),
    ("killed", r"\bKilled\b|Terminated|SIGKILL|SIGTERM|interrupted|aborted"),
    ("oom", r"heap out of memory|out of memory|ENOMEM|Cannot allocate"),
    ("no_space", r"ENOSPC|No space left"),
    ("crash", r"Segmentation fault|core dumped|panicked at"),
    ("net_fail", r"ENOTFOUND|ECONNREFUSED|ECONNRESET|getaddrinfo|Could not resolve host|network is unreachable|403 Forbidden|407 Proxy"),
    ("tests_failed", r"\b\d+ failed\b|Tests? +\d+ failed|✘|✗|FAIL "),
    ("tests_passed", r"\b\d+ passed\b"),
    ("flaky", r"\b\d+ flaky\b"),
    ("browser_missing", r"Executable doesn't exist|playwright install|Host system is missing dependencies|browserType.launch"),
    ("sandbox", r"sandbox|deny\(|Seatbelt|bwrap"),
    ("truncated_output", r"\[\.\.\. ?truncated|output truncated|Full output|\d+ more lines|truncated\]"),
];

/// Looked for anywhere in a tool call's arguments (the command, or the file content written).
pub const ARG_FLAGS: Table = &[
    ("test_skip", r"\b(?:test|it|describe)\.(?:skip|fixme|todo)\b|\bx(?:it|describe)\(|\.skip\("),
    ("test_only", r"\b(?:test|it|describe)\.only\b"),
    ("ts_suppress", r"@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|as any\b|as unknown as"),
    ("timeout_raise", r"setTimeout\(|timeout:\s*\d|--timeout[ =]\d|testTimeout|waitForTimeout"),
    ("console_log", r"console\.(?:log|error|warn|debug)\("),
    ("todo_marker", r"\bTODO\b|\bFIXME\b|\bHACK\b"),
    ("retries", r"retries:\s*[1-9]|--retries[ =][1-9]"),
    ("no_verify", r"--no-verify|--force\b|-f\b.*push"),
    ("cjk", r"[\x{4e00}-\x{9fff}]"),
];

/// In the model's thinking or visible text (case-insensitive).
pub const TEXT_FLAGS: Table = &[
    ("cjk", r"[\x{4e00}-\x{9fff}]"),
    ("eval_aware", r"benchmark|being (?:evaluated|tested|graded)|held[- ]out|hidden tests?|the harness|the grader|evaluator|acceptance (?:suite|tests)"),
    ("gives_up", r"I(?: a|')m stuck|give up|cannot proceed|can't proceed|unable to (?:continue|proceed|complete)|not possible to"),
    ("question", r"\?\s*$"),
    ("claims_done", r"complete|all (?:checks|tests|suites) pass|fully implemented|nothing left|is done"),
    ("shortcut", r"for now|work ?around|skip (?:this|the) test|simplif|hack|stub|placeholder|temporarily|good enough|pragmatic"),
    ("blames_env", r"pre-?existing|flaky|environment|not related to (?:my|our|this)|unrelated|infrastructure|out of scope"),
];

const SUMMARY_TAIL_CHARS: usize = 4000;

pub struct Compiled(Vec<(&'static str, Regex)>);

fn compile(table: Table, case_insensitive: bool) -> Compiled {
    Compiled(
        table
            .iter()
            .map(|(k, p)| {
                let p = if case_insensitive { format!("(?i){p}") } else { (*p).to_string() };
                (*k, Regex::new(&p).unwrap_or_else(|e| panic!("flag {k}: {e}")))
            })
            .collect(),
    )
}

pub fn res_rx() -> &'static Compiled {
    static RX: OnceLock<Compiled> = OnceLock::new();
    RX.get_or_init(|| compile(RES_FLAGS, false))
}

pub fn arg_rx() -> &'static Compiled {
    static RX: OnceLock<Compiled> = OnceLock::new();
    RX.get_or_init(|| compile(ARG_FLAGS, false))
}

pub fn text_rx() -> &'static Compiled {
    static RX: OnceLock<Compiled> = OnceLock::new();
    RX.get_or_init(|| compile(TEXT_FLAGS, true))
}

/// The flags found in `s`, in the table's order; none for an empty string.
pub fn flags(rx: &Compiled, s: &str) -> Vec<&'static str> {
    if s.is_empty() {
        return Vec::new();
    }
    rx.0.iter().filter(|(_, r)| r.is_match(s)).map(|(k, _)| *k).collect()
}

fn summary_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(r"(\d+) (passed|failed|flaky|skipped|did not run)").unwrap())
}

/// The test counts a result's last 4,000 characters print (`3 passed, 1 failed`); a later count of
/// the same kind replaces an earlier one.
pub fn summary(res: &str) -> Map<String, Value> {
    let mut out = Map::new();
    for c in summary_rx().captures_iter(tail_chars(res, SUMMARY_TAIL_CHARS)) {
        let n: i64 = c[1].parse().unwrap_or(0);
        out.insert(c[2].to_string(), Value::from(n));
    }
    out
}

fn first_str(a: &Map<String, Value>, keys: &[&str]) -> Option<Value> {
    keys.iter()
        .map(|k| a.get(*k))
        .find(|v| super::py::truthy(*v))
        .flatten()
        .cloned()
}

fn len_of(v: &Option<Value>) -> usize {
    match v {
        Some(v) => chars(&super::py::str_of(v)),
        None => 0,
    }
}

/// (edits, old characters, new characters) of a tool call's arguments: an `edits` list, or one
/// `oldText`/`old_string` and `newText`/`new_string`/`content`.
pub fn edit_sizes(a: &Map<String, Value>) -> (i64, usize, usize) {
    if let Some(Value::Array(eds)) = a.get("edits") {
        if !eds.is_empty() {
            let (mut old, mut new) = (0, 0);
            for x in eds.iter().filter_map(|x| x.as_object()) {
                old += len_of(&first_str(x, &["oldText", "old_string"]));
                new += len_of(&first_str(x, &["newText", "new_string"]));
            }
            return (eds.len() as i64, old, new);
        }
    }
    let old = first_str(a, &["oldText", "old_string"]);
    let new = first_str(a, &["newText", "new_string", "content"]);
    let n = i64::from(old.is_some() || new.is_some());
    (n, len_of(&old), len_of(&new))
}

fn home_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(r"/(?:home|Users)/[A-Za-z0-9_.-]+").unwrap())
}

/// Home directories replaced by `~`.
pub fn clean(s: &str) -> String {
    home_rx().replace_all(s, "~").into_owned()
}

fn trunc_rx() -> &'static Regex {
    static RX: OnceLock<Regex> = OnceLock::new();
    RX.get_or_init(|| Regex::new(r"(?:\x{2026}|\\u2026)\[truncated (\d+) chars\]").unwrap())
}

/// How many strings a line's `…[truncated N chars]` marks say were cut, and how many characters.
pub fn truncated(line: &str) -> (i64, i64) {
    trunc_rx()
        .captures_iter(line)
        .fold((0, 0), |(n, c), m| (n + 1, c + m[1].parse::<i64>().unwrap_or(0)))
}
