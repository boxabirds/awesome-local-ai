//! Token counts for Claude text, three ways: the reported total of one Claude Code story set beside Anthropic's
//! `count_tokens` endpoint (`story`); and a fitted estimate that needs neither, calibrated against the endpoint on
//! a varied corpus of the repository's own texts (`corpus`, `calibrate`, `fit`, `estimate`).
//!
//! The endpoint is the reference. The estimate is for a harness integration whose client does not report tokens,
//! and its error is measured, per kind of text, before it is trusted.

mod corpus;
mod count;
mod env;
mod evaluate;
mod features;
mod fit;
mod stream;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, Read, Write};
use std::path::{Path, PathBuf};

use evaluate::{Method, Row};

const DEFAULT_MODEL: &str = "claude-opus-5-5";
const KEY_VARIABLE: &str = "ANTHROPIC_API_KEY";
/// A one-character text, sent to learn what the endpoint adds around any message. It is one token.
const FRAMING_PROBE: &str = "a";
const FRAMING_PROBE_TOKENS: u64 = 1;
const PROBE_ID: &str = "framing-probe";
const PROGRESS_EVERY: usize = 50;
/// The story that was counted by hand first. It is kept out of the corpus so that it can be used as the test.
const HELD_OUT_STORY: &str = "benchmarks/reference/vidi/opus-5.5/v2-r1/stories/04/";

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Count one Claude Code story's visible output, beside the total Claude Code reported.
    Story {
        /// A Claude Code `agent-events.jsonl`.
        events: PathBuf,
        #[arg(long, default_value = ".env")]
        env_file: PathBuf,
        #[arg(long, default_value = DEFAULT_MODEL)]
        model: String,
        #[arg(long)]
        tokenizer_json: Option<PathBuf>,
        /// A model file from `fit`: also print its estimate of the visible text.
        #[arg(long)]
        fitted: Option<PathBuf>,
        #[arg(long)]
        skip_api: bool,
    },
    /// Write a varied corpus of texts from the repository's tracked files and compact logs.
    Corpus {
        #[arg(long, default_value = ".")]
        repo: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[arg(long, default_value_t = 40)]
        files_per_kind: usize,
        #[arg(long, default_value_t = 2)]
        chunks_per_file: usize,
        #[arg(long, default_value_t = 60)]
        logs: usize,
        #[arg(long, default_value_t = 60)]
        strings_per_kind: usize,
        /// A path prefix to leave out (repeatable). The story used as the test is always left out.
        #[arg(long)]
        skip_prefix: Vec<String>,
    },
    /// Count every text of a corpus with the endpoint, keeping the counts in a cache file (re-runs only add).
    Calibrate {
        #[arg(long)]
        corpus: PathBuf,
        #[arg(long)]
        cache: PathBuf,
        #[arg(long, default_value = ".env")]
        env_file: PathBuf,
        #[arg(long, default_value = DEFAULT_MODEL)]
        model: String,
    },
    /// Cross-validate every method on the counted corpus, and write the chosen method's model file.
    Fit {
        #[arg(long)]
        corpus: PathBuf,
        #[arg(long)]
        cache: PathBuf,
        #[arg(long, default_value = DEFAULT_MODEL)]
        model: String,
        #[arg(long)]
        tokenizer_json: Option<PathBuf>,
        /// Which method's model to write: `features` or `features-vocab`.
        #[arg(long, default_value = "features")]
        method: String,
        #[arg(long)]
        out: PathBuf,
    },
    /// Estimate the tokens of a text file (or standard input) from a model file.
    Estimate {
        #[arg(long)]
        model_file: PathBuf,
        #[arg(long)]
        tokenizer_json: Option<PathBuf>,
        /// The text file; standard input when omitted.
        text: Option<PathBuf>,
    },
}

#[derive(Serialize, Deserialize)]
struct CacheLine {
    id: String,
    kind: String,
    source: String,
    chars: usize,
    raw_tokens: u64,
    model: String,
}

#[derive(Serialize, Deserialize)]
struct ModelFile {
    /// The Claude model whose tokenizer the counts came from. A model with another tokenizer needs its own file.
    model_id: String,
    method: String,
    framing: u64,
    feature_names: Vec<String>,
    uses_vocab: bool,
    fit: fit::Fit,
    n_samples: usize,
    cross_validated: Option<CvSummary>,
    created_unix: u64,
}

#[derive(Serialize, Deserialize, Clone, Copy)]
struct CvSummary {
    median_abs_pct: f64,
    p90_abs_pct: f64,
    bias_pct: f64,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Story { events, env_file, model, tokenizer_json, fitted, skip_api } => story(&events, &env_file, &model, tokenizer_json.as_deref(), fitted.as_deref(), skip_api),
        Command::Corpus { repo, out, files_per_kind, chunks_per_file, logs, strings_per_kind, mut skip_prefix } => {
            skip_prefix.push(HELD_OUT_STORY.to_string());
            build_corpus(&repo, &out, corpus::Plan { files_per_kind, chunks_per_file, logs, strings_per_kind }, &skip_prefix)
        }
        Command::Calibrate { corpus, cache, env_file, model } => calibrate(&corpus, &cache, &env_file, &model),
        Command::Fit { corpus, cache, model, tokenizer_json, method, out } => fit_command(&corpus, &cache, &model, tokenizer_json.as_deref(), &method, &out),
        Command::Estimate { model_file, tokenizer_json, text } => estimate_command(&model_file, tokenizer_json.as_deref(), text.as_deref()),
    }
}

fn story(events: &Path, env_file: &Path, model: &str, tokenizer_json: Option<&Path>, fitted: Option<&Path>, skip_api: bool) -> Result<()> {
    let file = std::fs::File::open(events).with_context(|| format!("opening {}", events.display()))?;
    let e = stream::extract(std::io::BufReader::new(file).lines().map_while(Result::ok));

    println!("source                     {}", events.display());
    println!("result events              {}", e.result_events);
    println!("reported output tokens     {}   (Claude Code's result.usage, summed)", e.reported_output_tokens);
    println!("  of which thinking        {}   (not on disk: the log keeps a signature)", e.reported_thinking_tokens);
    println!("thinking blocks            {}   ({} empty, {} text chars, {} signature chars)", e.thinking_blocks, e.empty_thinking_blocks, e.thinking_chars, e.signature_chars);
    println!("reply blocks               {}   ({} chars)", e.text_blocks, e.text_chars);
    println!("tool-call blocks           {}   ({} chars of name and input)", e.tool_blocks, e.tool_input_chars);
    println!("visible text               {} chars", e.visible.chars().count());

    if let Some(path) = tokenizer_json {
        println!("claude-tokenizer (Xenova)  {} tokens", count::Vocabulary::load(path)?.tokens(&e.visible)?);
    }
    if let Some(path) = fitted {
        let m: ModelFile = serde_json::from_str(&std::fs::read_to_string(path)?)?;
        let vocab = if m.uses_vocab { tokenizer_json.map(count::Vocabulary::load).transpose()? } else { None };
        println!("fitted estimate ({})  {:.0} tokens", m.method, estimate_text(&m, &e.visible, vocab.as_ref())?);
    }
    if !skip_api {
        let key = env::read_var(env_file, KEY_VARIABLE)?;
        let with_text = count::api_tokens_retrying(&key, model, &e.visible)?;
        let framing = count::api_tokens_retrying(&key, model, FRAMING_PROBE)? - FRAMING_PROBE_TOKENS;
        println!("count_tokens ({model})   {with_text} tokens, {} after the {framing} the endpoint adds around a message", with_text.saturating_sub(framing));
    }
    Ok(())
}

fn build_corpus(repo: &Path, out: &Path, plan: corpus::Plan, skip: &[String]) -> Result<()> {
    let samples = corpus::build(repo, plan, skip)?;
    let mut file = std::io::BufWriter::new(std::fs::File::create(out)?);
    let mut by_kind: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
    for s in &samples {
        writeln!(file, "{}", serde_json::to_string(s)?)?;
        let e = by_kind.entry(&s.kind).or_default();
        e.0 += 1;
        e.1 += s.text.chars().count();
    }
    println!("{} samples written to {}", samples.len(), out.display());
    for (kind, (n, chars)) in by_kind {
        println!("  {kind:<14} {n:>5} samples  {chars:>9} chars");
    }
    Ok(())
}

fn read_corpus(path: &Path) -> Result<Vec<corpus::Sample>> {
    let file = std::fs::File::open(path).with_context(|| format!("opening {}", path.display()))?;
    std::io::BufReader::new(file).lines().map(|l| Ok(serde_json::from_str(&l?)?)).collect()
}

fn read_cache(path: &Path) -> Result<Vec<CacheLine>> {
    match std::fs::File::open(path) {
        Ok(f) => std::io::BufReader::new(f).lines().map(|l| Ok(serde_json::from_str(&l?)?)).collect(),
        Err(_) => Ok(Vec::new()),
    }
}

fn calibrate(corpus_path: &Path, cache_path: &Path, env_file: &Path, model: &str) -> Result<()> {
    let samples = read_corpus(corpus_path)?;
    let mut cache = std::fs::OpenOptions::new().create(true).append(true).open(cache_path)?;
    let have: std::collections::HashSet<String> = read_cache(cache_path)?.into_iter().filter(|l| l.model == model).map(|l| l.id).collect();
    let key = env::read_var(env_file, KEY_VARIABLE)?;
    let mut append = |line: CacheLine| -> Result<()> { Ok(writeln!(cache, "{}", serde_json::to_string(&line)?)?) };

    if !have.contains(PROBE_ID) {
        let raw = count::api_tokens_retrying(&key, model, FRAMING_PROBE)?;
        append(CacheLine { id: PROBE_ID.into(), kind: "probe".into(), source: String::new(), chars: FRAMING_PROBE.len(), raw_tokens: raw, model: model.into() })?;
    }
    let todo: Vec<&corpus::Sample> = samples.iter().filter(|s| !have.contains(&corpus::id_of(&s.text))).collect();
    println!("{} samples, {} already counted for {model}, {} to count", samples.len(), samples.len() - todo.len(), todo.len());
    for (i, s) in todo.iter().enumerate() {
        let raw = count::api_tokens_retrying(&key, model, &s.text)?;
        append(CacheLine { id: corpus::id_of(&s.text), kind: s.kind.clone(), source: s.source.clone(), chars: s.text.chars().count(), raw_tokens: raw, model: model.into() })?;
        if (i + 1) % PROGRESS_EVERY == 0 {
            println!("  counted {} of {}", i + 1, todo.len());
        }
    }
    println!("done");
    Ok(())
}

/// The corpus joined to its counts, as rows ready to fit, and the framing the endpoint added.
fn rows_of(corpus_path: &Path, cache_path: &Path, model: &str, vocab: Option<&count::Vocabulary>) -> Result<(Vec<Row>, u64)> {
    let counts: BTreeMap<String, u64> = read_cache(cache_path)?.into_iter().filter(|l| l.model == model).map(|l| (l.id, l.raw_tokens)).collect();
    let probe = counts.get(PROBE_ID).with_context(|| format!("no framing probe for {model} in {}: run calibrate first", cache_path.display()))?;
    let framing = probe - FRAMING_PROBE_TOKENS;
    let mut rows = Vec::new();
    for s in read_corpus(corpus_path)? {
        let Some(raw) = counts.get(&corpus::id_of(&s.text)) else { continue };
        let tokens = raw.saturating_sub(framing);
        if tokens == 0 {
            continue;
        }
        rows.push(Row {
            kind: s.kind.clone(),
            source: s.source.clone(),
            features: features::features(&s.text),
            vocab: vocab.map(|v| v.tokens(&s.text)).transpose()?.map(|n| n as f64),
            chars: s.text.chars().count() as f64,
            tokens: tokens as f64,
        });
    }
    anyhow::ensure!(!rows.is_empty(), "no counted samples for {model}");
    Ok((rows, framing))
}

fn print_metrics(label: &str, m: &evaluate::Metrics) {
    println!("  {label:<28} n={:<5} median |err| {:>5.1}%   90th {:>5.1}%   total off by {:>+6.1}%", m.n, m.median_abs_pct, m.p90_abs_pct, m.bias_pct);
}

fn fit_command(corpus_path: &Path, cache_path: &Path, model: &str, tokenizer_json: Option<&Path>, method: &str, out: &Path) -> Result<()> {
    let vocab = tokenizer_json.map(count::Vocabulary::load).transpose()?;
    let (rows, framing) = rows_of(corpus_path, cache_path, model, vocab.as_ref())?;
    println!("{} counted samples for {model}; the endpoint adds {framing} tokens around a message, taken off", rows.len());
    println!("{}-fold cross-validation, every source file held out in turn", evaluate::FOLDS);

    let mut chosen: Option<CvSummary> = None;
    let want = match method {
        "features" => Method::Features,
        "features-vocab" => Method::FeaturesVocab,
        other => anyhow::bail!("--method is features or features-vocab, not {other}"),
    };
    for m in evaluate::ALL.into_iter().filter(|m| vocab.is_some() || !m.needs_vocab()) {
        let est = evaluate::cross_validate(m, &rows, evaluate::FOLDS);
        let pairs: Vec<(f64, f64)> = rows.iter().zip(&est).filter_map(|(r, e)| e.map(|e| (e, r.tokens))).collect();
        println!("\n{}", m.name());
        if let Some(all) = evaluate::metrics(&pairs) {
            print_metrics("all kinds", &all);
            if m == want {
                chosen = Some(CvSummary { median_abs_pct: all.median_abs_pct, p90_abs_pct: all.p90_abs_pct, bias_pct: all.bias_pct });
            }
        }
        let kinds: std::collections::BTreeSet<&str> = rows.iter().map(|r| r.kind.as_str()).collect();
        for kind in kinds {
            let by_kind: Vec<(f64, f64)> = rows.iter().zip(&est).filter(|(r, _)| r.kind == kind).filter_map(|(r, e)| e.map(|e| (e, r.tokens))).collect();
            if let Some(k) = evaluate::metrics(&by_kind) {
                print_metrics(kind, &k);
            }
        }
    }

    anyhow::ensure!(want != Method::FeaturesVocab || vocab.is_some(), "--method features-vocab needs --tokenizer-json");
    let all: Vec<&Row> = rows.iter().collect();
    let trained = evaluate::train(want, &all).context("nothing to fit")?;
    let file = ModelFile {
        model_id: model.into(),
        method: method.into(),
        framing,
        feature_names: features::names(),
        uses_vocab: want.needs_vocab(),
        fit: trained,
        n_samples: rows.len(),
        cross_validated: chosen,
        created_unix: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)?.as_secs(),
    };
    std::fs::write(out, serde_json::to_string_pretty(&file)?)?;
    println!("\nmodel written to {}", out.display());
    Ok(())
}

fn estimate_text(m: &ModelFile, text: &str, vocab: Option<&count::Vocabulary>) -> Result<f64> {
    let mut x = features::features(text);
    if m.uses_vocab {
        x.push(vocab.context("this model file needs --tokenizer-json")?.tokens(text)? as f64);
    }
    Ok(fit::predict(&m.fit, &x))
}

fn estimate_command(model_file: &Path, tokenizer_json: Option<&Path>, text: Option<&Path>) -> Result<()> {
    let m: ModelFile = serde_json::from_str(&std::fs::read_to_string(model_file)?)?;
    let mut input = String::new();
    match text {
        Some(p) => input = std::fs::read_to_string(p).with_context(|| format!("reading {}", p.display()))?,
        None => {
            std::io::stdin().read_to_string(&mut input)?;
        }
    }
    let vocab = if m.uses_vocab { tokenizer_json.map(count::Vocabulary::load).transpose()? } else { None };
    println!("{:.0}", estimate_text(&m, &input, vocab.as_ref())?);
    Ok(())
}
