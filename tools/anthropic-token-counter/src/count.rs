//! The two counters: Anthropic's `count_tokens` endpoint, and the Xenova/claude-tokenizer vocabulary.

use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::time::Duration;

const COUNT_TOKENS_URL: &str = "https://api.anthropic.com/v1/messages/count_tokens";
const API_VERSION: &str = "2023-06-01";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

pub fn input_tokens_of(response: &Value) -> Result<u64> {
    if let Some(n) = response.get("input_tokens").and_then(Value::as_u64) {
        return Ok(n);
    }
    let message = response["error"].get("message").and_then(Value::as_str).unwrap_or("no input_tokens in the response");
    Err(anyhow!("count_tokens: {message}"))
}

/// What the endpoint says `text` costs as the content of one user message for `model`. The figure includes the
/// message framing, which the caller measures separately with `api_tokens` on a one-word text.
pub fn api_tokens(key: &str, model: &str, text: &str) -> Result<u64> {
    let client = reqwest::blocking::Client::builder().timeout(REQUEST_TIMEOUT).build()?;
    let response = client
        .post(COUNT_TOKENS_URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .json(&json!({"model": model, "messages": [{"role": "user", "content": text}]}))
        .send()
        .context("calling count_tokens")?;
    let status = response.status();
    let body: Value = response.json().with_context(|| format!("count_tokens answered {status} with a body that is not JSON"))?;
    input_tokens_of(&body).map_err(|e| anyhow!("count_tokens ({}): {e:#}", status.as_u16()))
}

/// Attempts at one count before giving up, and the wait before the next, which grows with each.
const ATTEMPTS: u32 = 6;
const RETRY_WAIT: Duration = Duration::from_secs(3);

/// `api_tokens`, tried again when the endpoint says it is busy (429) or failed on its side (5xx).
pub fn api_tokens_retrying(key: &str, model: &str, text: &str) -> Result<u64> {
    for attempt in 1..=ATTEMPTS {
        match api_tokens(key, model, text) {
            Err(e) if attempt < ATTEMPTS && should_retry(&format!("{e:#}")) => std::thread::sleep(RETRY_WAIT * attempt),
            other => return other,
        }
    }
    unreachable!("the last attempt returns")
}

/// Whether an error message from `api_tokens` is one worth another try.
pub fn should_retry(message: &str) -> bool {
    message.contains("count_tokens (429)") || message.contains("count_tokens (5") || message.contains("calling count_tokens")
}

/// The Xenova/claude-tokenizer vocabulary (a `tokenizer.json` file), loaded once.
pub struct Vocabulary(tokenizers::Tokenizer);

impl Vocabulary {
    pub fn load(path: &Path) -> Result<Self> {
        tokenizers::Tokenizer::from_file(path).map(Self).map_err(|e| anyhow!("loading {}: {e}", path.display()))
    }

    pub fn tokens(&self, text: &str) -> Result<usize> {
        self.0.encode(text, false).map(|e| e.len()).map_err(|e| anyhow!("tokenizing: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_count_is_read_from_input_tokens() {
        assert_eq!(input_tokens_of(&serde_json::json!({"input_tokens": 184})).unwrap(), 184);
    }

    #[test]
    fn an_error_body_is_an_error_naming_its_message_not_a_zero() {
        let body = serde_json::json!({"type": "error", "error": {"type": "invalid_request_error", "message": "bad model"}});
        let err = input_tokens_of(&body).unwrap_err();
        assert!(format!("{err:#}").contains("bad model"));
    }

    #[test]
    fn a_busy_or_failing_endpoint_is_retried_and_a_bad_request_is_not() {
        assert!(should_retry("count_tokens (429): rate limited"));
        assert!(should_retry("count_tokens (529): overloaded"));
        assert!(should_retry("calling count_tokens: connection reset"));
        assert!(!should_retry("count_tokens (400): bad model"));
    }

    #[test]
    fn a_body_with_neither_is_an_error() {
        assert!(input_tokens_of(&serde_json::json!({})).is_err());
    }
}
