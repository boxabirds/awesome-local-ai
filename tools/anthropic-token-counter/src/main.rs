//! Counts the output of one Claude Code story two ways and sets both beside the total Claude Code reported.
//!
//!   anthropic-token-counter <agent-events.jsonl> --env-file <.env> --tokenizer-json <tokenizer.json>
//!
//! The visible text is only part of what the model wrote (its thinking is encrypted in the log), so neither count is
//! expected to reach the reported total. The gap is the finding.

mod count;
mod env;
mod stream;

use anyhow::{Context, Result};
use clap::Parser;
use std::io::BufRead;
use std::path::PathBuf;

const DEFAULT_MODEL: &str = "claude-opus-5-5";
const KEY_VARIABLE: &str = "ANTHROPIC_API_KEY";
/// A one-word text, sent to learn what the endpoint adds around any message.
const FRAMING_PROBE: &str = "a";

#[derive(Parser)]
struct Args {
    /// A Claude Code `agent-events.jsonl`.
    events: PathBuf,
    /// The `.env` file holding ANTHROPIC_API_KEY. Not needed with --skip-api.
    #[arg(long, default_value = ".env")]
    env_file: PathBuf,
    #[arg(long, default_value = DEFAULT_MODEL)]
    model: String,
    /// The Xenova/claude-tokenizer `tokenizer.json`. Without it only the API count is made.
    #[arg(long)]
    tokenizer_json: Option<PathBuf>,
    #[arg(long)]
    skip_api: bool,
}

fn main() -> Result<()> {
    let args = Args::parse();
    let file = std::fs::File::open(&args.events).with_context(|| format!("opening {}", args.events.display()))?;
    let lines = std::io::BufReader::new(file).lines().map_while(Result::ok);
    let e = stream::extract(lines);

    println!("source                     {}", args.events.display());
    println!("result events              {}", e.result_events);
    println!("reported output tokens     {}   (Claude Code's result.usage, summed)", e.reported_output_tokens);
    println!("  of which thinking        {}   (not on disk: the log keeps a signature)", e.reported_thinking_tokens);
    println!("thinking blocks            {}   ({} empty, {} text chars, {} signature chars)", e.thinking_blocks, e.empty_thinking_blocks, e.thinking_chars, e.signature_chars);
    println!("reply blocks               {}   ({} chars)", e.text_blocks, e.text_chars);
    println!("tool-call blocks           {}   ({} chars of name and input)", e.tool_blocks, e.tool_input_chars);
    println!("visible text               {} chars", e.visible.chars().count());

    if let Some(path) = &args.tokenizer_json {
        let n = count::vocabulary_tokens(path, &e.visible)?;
        println!("claude-tokenizer (Xenova)  {n} tokens");
    }
    if !args.skip_api {
        let key = env::read_var(&args.env_file, KEY_VARIABLE)?;
        let with_text = count::api_tokens(&key, &args.model, &e.visible)?;
        let framing = count::api_tokens(&key, &args.model, FRAMING_PROBE)?;
        println!("count_tokens ({})   {with_text} tokens   (a one-word message counts {framing}, so the framing is at most that)", args.model);
    }
    Ok(())
}
