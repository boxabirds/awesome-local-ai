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
    input_tokens_of(&body)
}

/// The number of tokens the Xenova/claude-tokenizer vocabulary (a `tokenizer.json` file) makes of `text`.
pub fn vocabulary_tokens(tokenizer_json: &Path, text: &str) -> Result<usize> {
    let tokenizer = tokenizers::Tokenizer::from_file(tokenizer_json).map_err(|e| anyhow!("loading {}: {e}", tokenizer_json.display()))?;
    let encoding = tokenizer.encode(text, false).map_err(|e| anyhow!("tokenizing: {e}"))?;
    Ok(encoding.len())
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
    fn a_body_with_neither_is_an_error() {
        assert!(input_tokens_of(&serde_json::json!({})).is_err());
    }
}
