//! One attempt of the reproducer: the long lane and the short lane at once, with `/slots` polled until both
//! answer or a slot freezes.

use crate::slots::{Slot, Wedge, WedgeTracker};
use crate::text::{fresh_text, CHARS_PER_TOKEN};
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

/// Paragraphs of one attempt's turn are numbered from `attempt * PARAGRAPHS_PER_TURN`, so no two turns overlap.
const PARAGRAPHS_PER_TURN: usize = 1_000;
/// Paragraphs before any attempt's, so the calibration text shares nothing with a turn.
const CALIBRATION_FIRST_PARAGRAPH: usize = 900_000;
const CALIBRATION_TOKENS: usize = 4_000;
const SYSTEM_PROMPT: &str = "You are a helpful assistant for a coding session.";
const LONG_LANE_QUESTION: &str = "Continue the plan with the next three steps.";
const PROBE_PROMPT: &str = "Reply with the single word ready.";
const PROBE_MAX_TOKENS: u32 = 8;
const PROBE_TIMEOUT: Duration = Duration::from_secs(120);
/// Time past the attempt timeout that the watcher waits for the lanes to report their own timeout.
const TIMEOUT_GRACE: Duration = Duration::from_secs(20);

#[derive(Debug, Clone)]
pub struct Config {
    pub base_url: String,
    pub model: String,
    pub turn_tokens: usize,
    /// The server's tokenizer's figure for the filler text, from `calibrate`
    pub chars_per_token: f64,
    pub max_tokens: u32,
    pub stall: Duration,
    pub poll: Duration,
    pub attempt_timeout: Duration,
}

#[derive(Debug)]
pub enum Outcome {
    Clean { seconds: f64, long_prompt_tokens: Option<u64> },
    Wedge { wedge: Wedge, slots: String, seconds: f64 },
    LaneError { lane: &'static str, message: String, seconds: f64 },
}

/// The conversation so far, as the chat API takes it.
pub struct Conversation {
    messages: Vec<Value>,
}

impl Default for Conversation {
    fn default() -> Self {
        Self { messages: vec![json!({"role": "system", "content": SYSTEM_PROMPT})] }
    }
}

impl Conversation {
    /// Adds this attempt's novel turn and returns the long lane's messages: the whole conversation plus the question.
    pub fn grow(&mut self, attempt: u32, turn_tokens: usize, chars_per_token: f64) -> Vec<Value> {
        let text = fresh_text(attempt as usize * PARAGRAPHS_PER_TURN, turn_tokens, chars_per_token);
        self.messages.push(json!({"role": "user", "content": text}));
        let mut long = self.messages.clone();
        long.push(json!({"role": "user", "content": LONG_LANE_QUESTION}));
        long
    }
}

pub fn short_lane_messages(attempt: u32) -> Vec<Value> {
    vec![json!({"role": "user", "content": format!("attempt {attempt}: answer in two words")})]
}

async fn post_chat(client: &reqwest::Client, cfg: &Config, messages: Vec<Value>, max_tokens: u32, timeout: Duration) -> Result<Value> {
    let body = json!({"model": cfg.model, "messages": messages, "max_tokens": max_tokens});
    let resp = client
        .post(format!("{}/v1/chat/completions", cfg.base_url))
        .timeout(timeout)
        .json(&body)
        .send()
        .await
        .context("request")?;
    let status = resp.status();
    let text = resp.text().await.context("body")?;
    if !status.is_success() {
        return Err(anyhow!("HTTP {status}: {}", text.chars().take(200).collect::<String>()));
    }
    serde_json::from_str(&text).context("response is not JSON")
}

/// Says whether the server answers at all before any attempt is spent.
pub async fn probe(client: &reqwest::Client, cfg: &Config) -> Result<()> {
    let messages = vec![json!({"role": "user", "content": PROBE_PROMPT})];
    post_chat(client, cfg, messages, PROBE_MAX_TOKENS, PROBE_TIMEOUT).await.map(|_| ())
}

/// Characters of the filler per token as the server counts them: one request of a known size, `max_tokens` 1, the
/// prompt tokens read back from `usage`.
pub async fn calibrate(client: &reqwest::Client, cfg: &Config) -> Result<f64> {
    let text = fresh_text(CALIBRATION_FIRST_PARAGRAPH, CALIBRATION_TOKENS, CHARS_PER_TOKEN);
    let chars = text.len() as f64;
    let reply = post_chat(client, cfg, vec![json!({"role": "user", "content": text})], 1, PROBE_TIMEOUT).await?;
    let tokens = reply["usage"]["prompt_tokens"].as_u64().ok_or_else(|| anyhow!("the reply has no usage.prompt_tokens"))?;
    Ok(chars / tokens as f64)
}

async fn read_slots(client: &reqwest::Client, base_url: &str) -> Option<(String, Vec<Slot>)> {
    let text = client.get(format!("{base_url}/slots")).timeout(Duration::from_secs(10)).send().await.ok()?.text().await.ok()?;
    let slots = serde_json::from_str(&text).ok()?;
    Some((text, slots))
}

pub async fn run_attempt(client: &reqwest::Client, cfg: &Config, conv: &mut Conversation, attempt: u32) -> Outcome {
    let long_messages = conv.grow(attempt, cfg.turn_tokens, cfg.chars_per_token);
    let started = Instant::now();
    let (c1, cfg1) = (client.clone(), cfg.clone());
    let long = tokio::spawn(async move { post_chat(&c1, &cfg1, long_messages, cfg1.max_tokens, cfg1.attempt_timeout).await });
    let (c2, cfg2) = (client.clone(), cfg.clone());
    let short_messages = short_lane_messages(attempt);
    let short = tokio::spawn(async move { post_chat(&c2, &cfg2, short_messages, cfg2.max_tokens, cfg2.attempt_timeout).await });

    let mut tracker = WedgeTracker::new(cfg.stall);
    let give_up = cfg.attempt_timeout + TIMEOUT_GRACE;
    let outcome = loop {
        tokio::time::sleep(cfg.poll).await;
        let elapsed = started.elapsed();
        if long.is_finished() && short.is_finished() {
            break None;
        }
        if let Some((text, slots)) = read_slots(client, &cfg.base_url).await {
            if let Some(wedge) = tracker.observe(elapsed, &slots) {
                break Some(Outcome::Wedge { wedge, slots: text, seconds: elapsed.as_secs_f64() });
            }
        }
        if elapsed > give_up {
            break Some(Outcome::LaneError { lane: "both", message: "no answer within the attempt timeout".into(), seconds: elapsed.as_secs_f64() });
        }
    };
    if let Some(outcome) = outcome {
        long.abort();
        short.abort();
        return outcome;
    }
    let seconds = started.elapsed().as_secs_f64();
    let mut long_prompt_tokens = None;
    for (lane, task) in [("long", long), ("short", short)] {
        match task.await {
            Ok(Ok(reply)) => {
                if lane == "long" {
                    long_prompt_tokens = reply["usage"]["prompt_tokens"].as_u64();
                }
            }
            Ok(Err(e)) => return Outcome::LaneError { lane, message: format!("{e:#}"), seconds },
            Err(e) => return Outcome::LaneError { lane, message: e.to_string(), seconds },
        }
    }
    Outcome::Clean { seconds, long_prompt_tokens }
}
