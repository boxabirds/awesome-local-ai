//! Reads a Claude Code `stream-json` log (the harness's `agent-events.jsonl`) and pulls out what the agent
//! wrote that is visible on disk, and the totals Claude Code reported for it.
//!
//! Claude Code writes one content block per `assistant` line, so a message of several blocks spans several
//! lines. Every block is kept in log order; only a tool call seen twice under one id counts once. Thinking text is
//! mostly absent (the log carries an encrypted signature in its place), so the visible text is a lower bound on
//! what the model wrote.

use serde_json::Value;
use std::collections::HashSet;

/// What was written between blocks of the visible text.
const BLOCK_SEPARATOR: &str = "\n";

#[derive(Debug, Default, PartialEq)]
pub struct Extract {
    /// Thinking text, reply text and tool-call inputs (as compact JSON, after the tool's name), in order.
    pub visible: String,
    pub thinking_blocks: usize,
    pub empty_thinking_blocks: usize,
    pub thinking_chars: usize,
    pub signature_chars: usize,
    pub text_blocks: usize,
    pub text_chars: usize,
    pub tool_blocks: usize,
    pub tool_input_chars: usize,
    /// Summed over the log's `result` events: `usage.output_tokens` and its `thinking_tokens`.
    pub reported_output_tokens: u64,
    pub reported_thinking_tokens: u64,
    pub result_events: usize,
}

enum Kind {
    Thinking { signature_chars: usize },
    Text,
    ToolUse,
}

struct Block {
    kind: Kind,
    text: String,
}

fn block_of(b: &Value) -> Option<Block> {
    let str_of = |key: &str| b.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    match b.get("type")?.as_str()? {
        "thinking" => Some(Block { kind: Kind::Thinking { signature_chars: str_of("signature").chars().count() }, text: str_of("thinking") }),
        "text" => Some(Block { kind: Kind::Text, text: str_of("text") }),
        "tool_use" => {
            let input = b.get("input").map_or_else(String::new, Value::to_string);
            Some(Block { kind: Kind::ToolUse, text: format!("{} {}", str_of("name"), input) })
        }
        _ => None,
    }
}

pub fn extract<I: IntoIterator<Item = String>>(lines: I) -> Extract {
    let mut out = Extract::default();
    let mut blocks: Vec<Block> = Vec::new();
    let mut tool_ids: HashSet<String> = HashSet::new();
    for line in lines {
        let Ok(event) = serde_json::from_str::<Value>(&line) else { continue };
        match event.get("type").and_then(Value::as_str) {
            Some("assistant") => {
                for b in event["message"].get("content").and_then(Value::as_array).into_iter().flatten() {
                    // Only a tool call has an id; a repeat of one is the same call written again.
                    let repeated_call = b.get("type").and_then(Value::as_str) == Some("tool_use")
                        && b.get("id").and_then(Value::as_str).is_some_and(|id| !tool_ids.insert(id.to_string()));
                    if let (false, Some(block)) = (repeated_call, block_of(b)) {
                        blocks.push(block);
                    }
                }
            }
            Some("result") => {
                out.result_events += 1;
                let usage = &event["usage"];
                out.reported_output_tokens += usage.get("output_tokens").and_then(Value::as_u64).unwrap_or(0);
                out.reported_thinking_tokens += usage["output_tokens_details"].get("thinking_tokens").and_then(Value::as_u64).unwrap_or(0);
            }
            _ => {}
        }
    }
    let mut parts: Vec<&str> = Vec::new();
    for block in &blocks {
        let chars = block.text.chars().count();
        match block.kind {
            Kind::Thinking { signature_chars } => {
                out.thinking_blocks += 1;
                out.thinking_chars += chars;
                out.signature_chars += signature_chars;
                if chars == 0 {
                    out.empty_thinking_blocks += 1;
                }
            }
            Kind::Text => {
                out.text_blocks += 1;
                out.text_chars += chars;
            }
            Kind::ToolUse => {
                out.tool_blocks += 1;
                out.tool_input_chars += chars;
            }
        }
        if chars > 0 {
            parts.push(&block.text);
        }
    }
    out.visible = parts.join(BLOCK_SEPARATOR);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(v: &[Value]) -> Vec<String> {
        v.iter().map(Value::to_string).collect()
    }

    fn assistant(id: &str, content: Value) -> Value {
        serde_json::json!({"type": "assistant", "message": {"id": id, "usage": {"output_tokens": 3}, "content": content}})
    }

    #[test]
    fn two_thinking_blocks_of_one_message_are_two_blocks_not_a_rewrite() {
        // Claude Code writes one block per line. In a real log a message holds an empty thinking block with a long
        // signature and then a second one with text: both are the model's, neither replaces the other.
        let log = lines(&[
            assistant("m1", serde_json::json!([{"type": "thinking", "thinking": "", "signature": "SIGSIGSIG"}])),
            assistant("m1", serde_json::json!([{"type": "thinking", "thinking": "plan", "signature": "SIG"}])),
            assistant("m1", serde_json::json!([{"type": "tool_use", "id": "t1", "name": "Read", "input": {"path": "a.md"}}])),
        ]);
        let e = extract(log);
        assert_eq!((e.thinking_blocks, e.empty_thinking_blocks), (2, 1));
        assert_eq!((e.thinking_chars, e.signature_chars), (4, 12));
        assert_eq!((e.tool_blocks, e.tool_input_chars), (1, r#"Read {"path":"a.md"}"#.len()));
        assert_eq!(e.visible, format!("plan{BLOCK_SEPARATOR}Read {{\"path\":\"a.md\"}}"));
    }

    #[test]
    fn a_tool_call_written_twice_under_one_id_counts_once() {
        let call = || assistant("m1", serde_json::json!([{"type": "tool_use", "id": "t1", "name": "Bash", "input": {"cmd": "ls"}}]));
        let e = extract(lines(&[call(), call()]));
        assert_eq!(e.tool_blocks, 1);
    }

    #[test]
    fn an_empty_thinking_block_is_counted_as_empty_and_adds_no_text() {
        let log = lines(&[assistant("m1", serde_json::json!([
            {"type": "thinking", "thinking": "", "signature": "XXXX"},
            {"type": "text", "text": "hello"}
        ]))]);
        let e = extract(log);
        assert_eq!((e.thinking_blocks, e.empty_thinking_blocks, e.signature_chars), (1, 1, 4));
        assert_eq!((e.text_blocks, e.text_chars), (1, 5));
        assert_eq!(e.visible, "hello");
    }

    #[test]
    fn the_reported_totals_are_the_results_usage_summed_over_result_events() {
        let result = |out: u64, think: u64| serde_json::json!({"type": "result", "usage": {"output_tokens": out, "output_tokens_details": {"thinking_tokens": think}}});
        let e = extract(lines(&[result(100, 40), result(20, 5)]));
        assert_eq!((e.result_events, e.reported_output_tokens, e.reported_thinking_tokens), (2, 120, 45));
    }

    #[test]
    fn per_message_usage_snapshots_are_not_taken_as_the_total() {
        let e = extract(lines(&[assistant("m1", serde_json::json!([{"type": "text", "text": "x"}]))]));
        assert_eq!((e.result_events, e.reported_output_tokens), (0, 0));
    }

    #[test]
    fn lines_that_are_not_json_are_skipped() {
        let e = extract(vec!["not json".to_string(), assistant("m1", serde_json::json!([{"type": "text", "text": "ok"}])).to_string()]);
        assert_eq!(e.visible, "ok");
    }

    #[test]
    fn blocks_keep_the_order_of_the_log() {
        let log = lines(&[
            assistant("m1", serde_json::json!([{"type": "text", "text": "one"}])),
            assistant("m2", serde_json::json!([{"type": "text", "text": "two"}])),
            assistant("m1", serde_json::json!([{"type": "text", "text": "three"}])),
        ]);
        assert_eq!(extract(log).visible, format!("one{BLOCK_SEPARATOR}two{BLOCK_SEPARATOR}three"));
    }
}
