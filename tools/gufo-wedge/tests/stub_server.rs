//! The reproducer against a stub server: one that freezes (a request that never answers beside a slot whose
//! counters do not move) and one that answers at once.

use axum::{routing::{get, post}, Json, Router};
use gufo_wedge::attempt::{calibrate, probe, run_attempt, Config, Conversation, Outcome};
use serde_json::{json, Value};
use std::time::Duration;

const STUB_CHARS_PER_TOKEN: usize = 5;

fn router(frozen: bool) -> Router {
    Router::new()
        .route("/v1/chat/completions", post(move |Json(body): Json<Value>| async move {
            if frozen {
                tokio::time::sleep(Duration::from_secs(3600)).await;
            }
            let chars: usize = body["messages"].as_array().unwrap().iter().map(|m| m["content"].as_str().unwrap().len()).sum();
            Json(json!({"choices": [{"message": {"content": "ok"}}], "usage": {"prompt_tokens": chars / STUB_CHARS_PER_TOKEN}}))
        }))
        .route("/slots", get(move || async move {
            Json(json!([{"id": 0, "is_processing": frozen, "n_prompt_tokens": 106337, "n_prompt_tokens_processed": 0,
                "n_prompt_tokens_cache": 51200, "next_token": [{"n_decoded": 0, "n_remain": 1024}]}]))
        }))
}

async fn serve(frozen: bool) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router(frozen)).await.unwrap() });
    format!("http://{addr}")
}

fn cfg(base_url: String) -> Config {
    Config {
        base_url,
        model: "stub".into(),
        turn_tokens: 200,
        chars_per_token: 3.7,
        max_tokens: 16,
        stall: Duration::from_millis(300),
        poll: Duration::from_millis(50),
        attempt_timeout: Duration::from_secs(10),
    }
}

#[tokio::test]
async fn a_server_that_freezes_is_reported_as_a_wedge_with_its_frozen_slots() {
    let cfg = cfg(serve(true).await);
    let client = reqwest::Client::new();
    match run_attempt(&client, &cfg, &mut Conversation::default(), 1).await {
        Outcome::Wedge { wedge, slots, .. } => {
            assert_eq!(wedge.slot, 0);
            assert!(slots.contains("\"n_prompt_tokens_cache\": 51200") || slots.contains("\"n_prompt_tokens_cache\":51200"));
        }
        other => panic!("expected a wedge, got {other:?}"),
    }
}

#[tokio::test]
async fn a_server_that_answers_both_lanes_is_clean() {
    let cfg = cfg(serve(false).await);
    let client = reqwest::Client::new();
    probe(&client, &cfg).await.unwrap();
    match run_attempt(&client, &cfg, &mut Conversation::default(), 1).await {
        // without the long lane's prompt size a clean run cannot show that it reached the sizes the wedge needs
        Outcome::Clean { long_prompt_tokens, .. } => assert!(long_prompt_tokens.unwrap() > 0),
        other => panic!("expected clean, got {other:?}"),
    }
}

#[tokio::test]
async fn each_attempt_adds_a_new_turn_to_the_long_lane() {
    let mut conv = Conversation::default();
    let first = conv.grow(1, 200, 3.7);
    let second = conv.grow(2, 200, 3.7);
    assert_eq!(second.len(), first.len() + 1);
    assert_ne!(first[1]["content"], second[2]["content"]);
}

#[tokio::test]
async fn the_servers_own_token_count_sets_how_much_text_makes_a_turn() {
    // the filler was sized at 3.7 characters per token and came out at 14k tokens where 20k was asked,
    // so the attempts never reached the 100k+ prompts the wedge needs
    let mut cfg = cfg(serve(false).await);
    let client = reqwest::Client::new();
    cfg.chars_per_token = calibrate(&client, &cfg).await.unwrap();
    assert!((cfg.chars_per_token - STUB_CHARS_PER_TOKEN as f64).abs() < 0.1, "{}", cfg.chars_per_token);
    let mut conv = Conversation::default();
    let long = conv.grow(1, cfg.turn_tokens, cfg.chars_per_token);
    let chars: usize = long.iter().map(|m| m["content"].as_str().unwrap().len()).sum();
    let tokens = chars / STUB_CHARS_PER_TOKEN;
    assert!((200..260).contains(&tokens), "a 200-token turn came out as {tokens}");
}
