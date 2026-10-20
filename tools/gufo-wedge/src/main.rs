use anyhow::{bail, Result};
use clap::Parser;
use gufo_wedge::attempt::{calibrate, probe, run_attempt, Config, Conversation, Outcome};
use serde_json::json;
use std::path::PathBuf;
use std::time::Duration;

const EXIT_WEDGE: i32 = 1;
const DEFAULT_ATTEMPTS: u32 = 4;
// The report's attempts reached prompts of 53k, 106k, 159k and 212k tokens: each turn adds about 53k.
const DEFAULT_TURN_TOKENS: usize = 53_000;
const DEFAULT_MAX_TOKENS: u32 = 1024;
const DEFAULT_STALL_S: u64 = 45;
const DEFAULT_POLL_S: u64 = 2;
const DEFAULT_ATTEMPT_TIMEOUT_S: u64 = 360;

/// Provokes gufo issue 631 against a running server. Start the server as the report did: two sessions, a
/// context of 262144, a disk cache and the automatic RAM tier. Stops at the first wedge, saves the frozen
/// `/slots` listing, and exits 1; it never restarts the server. Exits 0 when every attempt answered.
#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "http://127.0.0.1:8080")]
    base_url: String,
    /// The model id the server lists at /v1/models
    #[arg(long)]
    model: String,
    #[arg(long, default_value_t = DEFAULT_ATTEMPTS)]
    attempts: u32,
    /// Novel tokens added to the conversation before each attempt
    #[arg(long, default_value_t = DEFAULT_TURN_TOKENS)]
    turn_tokens: usize,
    #[arg(long, default_value_t = DEFAULT_MAX_TOKENS)]
    max_tokens: u32,
    /// Seconds a processing slot may stay unchanged before it counts as a wedge
    #[arg(long, default_value_t = DEFAULT_STALL_S)]
    stall_s: u64,
    #[arg(long, default_value_t = DEFAULT_POLL_S)]
    poll_s: u64,
    #[arg(long, default_value_t = DEFAULT_ATTEMPT_TIMEOUT_S)]
    attempt_timeout_s: u64,
    /// Where a wedge's frozen /slots listing is written
    #[arg(long, default_value = ".")]
    dump_dir: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    let a = Args::parse();
    let mut cfg = Config {
        base_url: a.base_url.trim_end_matches('/').to_string(),
        model: a.model,
        turn_tokens: a.turn_tokens,
        chars_per_token: gufo_wedge::text::CHARS_PER_TOKEN,
        max_tokens: a.max_tokens,
        stall: Duration::from_secs(a.stall_s),
        poll: Duration::from_secs(a.poll_s),
        attempt_timeout: Duration::from_secs(a.attempt_timeout_s),
    };
    let client = reqwest::Client::new();
    if let Err(e) = probe(&client, &cfg).await {
        bail!("the server did not answer the probe: {e:#}");
    }
    cfg.chars_per_token = calibrate(&client, &cfg).await?;
    eprintln!("calibrated: {:.2} characters per token", cfg.chars_per_token);
    let mut conv = Conversation::default();
    for attempt in 1..=a.attempts {
        match run_attempt(&client, &cfg, &mut conv, attempt).await {
            Outcome::Clean { seconds, long_prompt_tokens } => {
                println!("{}", json!({"attempt": attempt, "outcome": "clean", "seconds": seconds, "long_prompt_tokens": long_prompt_tokens}))
            }
            Outcome::LaneError { lane, message, seconds } => {
                println!("{}", json!({"attempt": attempt, "outcome": "lane_error", "lane": lane, "message": message, "seconds": seconds}));
                bail!("attempt {attempt}: the {lane} lane failed without freezing: {message}");
            }
            Outcome::Wedge { wedge, slots, seconds } => {
                let path = a.dump_dir.join(format!("wedge-attempt-{attempt}.slots.json"));
                std::fs::write(&path, &slots)?;
                println!("{}", json!({"attempt": attempt, "outcome": "wedge", "slot": wedge.slot, "fingerprint": wedge.fingerprint,
                    "frozen_for_s": wedge.frozen_for.as_secs_f64(), "seconds": seconds, "slots_file": path}));
                std::process::exit(EXIT_WEDGE);
            }
        }
    }
    Ok(())
}
