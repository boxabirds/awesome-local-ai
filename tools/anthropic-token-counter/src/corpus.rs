//! A varied, reproducible set of texts to count: the repository's own tracked files (prose, code in several
//! languages, JSON, configuration) and the long strings inside its tracked compact agent logs (thinking, replies,
//! tool-call inputs, tool results) from every client the harness drives.
//!
//! Only files git tracks in the public repository are read, and anything that touches the held-out suite is left out.
//! Every choice is by a hash of the text's name, so the same repository gives the same corpus.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Read;
use std::path::Path;

pub const MIN_CHARS: usize = 200;
pub const MAX_CHARS: usize = 6000;
/// A string inside a log is only a sample if it is at least this long.
pub const MIN_STRING_CHARS: usize = 300;
const MAX_FILE_BYTES: u64 = 3 * 1024 * 1024;
const LOG_SUFFIX: &str = ".compact.jsonl.gz";
/// Path fragments that mark held-out, private or generated material. Nothing under them is read.
const EXCLUDED: [&str; 9] = ["acceptance", "accept-", "accept.", "heldout", "audit", "node_modules", "/private", "package-lock", "pnpm-lock"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    pub kind: String,
    pub source: String,
    pub text: String,
}

#[derive(Debug, Clone, Copy)]
pub struct Plan {
    pub files_per_kind: usize,
    pub chunks_per_file: usize,
    pub logs: usize,
    pub strings_per_kind: usize,
}

pub fn fnv1a(s: &str) -> u64 {
    s.bytes().fold(0xcbf29ce484222325, |h, b| (h ^ u64::from(b)).wrapping_mul(0x100000001b3))
}

pub fn id_of(text: &str) -> String {
    format!("{:016x}-{}", fnv1a(text), text.len())
}

pub fn kind_of_path(path: &str) -> Option<&'static str> {
    let ext = path.rsplit('.').next()?;
    Some(match ext {
        "md" => "markdown",
        "ts" | "tsx" | "js" | "mjs" | "cjs" | "jsx" => "js-ts",
        "py" => "python",
        "rs" => "rust",
        "sh" => "shell",
        "css" => "css",
        "html" => "html",
        "json" | "jsonc" => "json",
        "toml" | "yaml" | "yml" => "config",
        "txt" => "text",
        _ => return None,
    })
}

pub fn excluded(path: &str) -> bool {
    EXCLUDED.iter().any(|e| path.contains(e))
}

/// Pieces of `text` of at most `max` characters, cut at line ends where there is one, and in order. A piece shorter
/// than `min` is dropped.
pub fn chunks(text: &str, min: usize, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut current_chars = 0;
    let flush = |current: &mut String, current_chars: &mut usize, out: &mut Vec<String>| {
        if *current_chars >= min {
            out.push(std::mem::take(current));
        } else {
            current.clear();
        }
        *current_chars = 0;
    };
    for line in text.split_inclusive('\n') {
        let line_chars = line.chars().count();
        if line_chars > max {
            flush(&mut current, &mut current_chars, &mut out);
            let all: Vec<char> = line.chars().collect();
            for piece in all.chunks(max) {
                if piece.len() >= min {
                    out.push(piece.iter().collect());
                }
            }
            continue;
        }
        if current_chars + line_chars > max {
            flush(&mut current, &mut current_chars, &mut out);
        }
        current.push_str(line);
        current_chars += line_chars;
    }
    flush(&mut current, &mut current_chars, &mut out);
    out
}

/// `n` of `items`, chosen by the hash of each item's key, so the choice does not depend on the order given.
pub fn pick<T>(mut items: Vec<(String, T)>, n: usize) -> Vec<T> {
    items.sort_by_key(|(key, _)| (fnv1a(key), key.clone()));
    items.into_iter().take(n).map(|(_, v)| v).collect()
}

/// The strings of at least `MIN_STRING_CHARS` characters in a JSON value, each with the kind its nearest key suggests.
pub fn strings_in(value: &Value, hint: &str, out: &mut Vec<(String, String)>) {
    match value {
        Value::String(s) if s.chars().count() >= MIN_STRING_CHARS => out.push((format!("log:{}", log_kind(hint)), s.clone())),
        Value::Array(a) => a.iter().for_each(|v| strings_in(v, hint, out)),
        Value::Object(o) => o.iter().for_each(|(k, v)| strings_in(v, k, out)),
        _ => {}
    }
}

fn log_kind(key: &str) -> &'static str {
    match key {
        "thinking" | "reasoning" => "thinking",
        "text" | "delta" | "message" => "text",
        "input" | "arguments" | "args" | "newText" | "new_string" | "old_string" | "command" => "input",
        "content" | "result" | "output" | "partialResult" | "stdout" => "result",
        _ => "other",
    }
}

fn tracked(repo: &Path) -> Result<Vec<String>> {
    let out = std::process::Command::new("git").arg("-C").arg(repo).args(["ls-files", "-z"]).output().context("git ls-files")?;
    anyhow::ensure!(out.status.success(), "git ls-files failed");
    Ok(String::from_utf8_lossy(&out.stdout).split('\0').filter(|p| !p.is_empty()).map(String::from).collect())
}

fn read_gz(path: &Path) -> Result<String> {
    let mut text = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path)?).read_to_string(&mut text)?;
    Ok(text)
}

/// The corpus for `repo`, leaving out any source whose path starts with one of `skip_prefixes`.
pub fn build(repo: &Path, plan: Plan, skip_prefixes: &[String]) -> Result<Vec<Sample>> {
    let paths: Vec<String> = tracked(repo)?.into_iter().filter(|p| !excluded(p) && !skip_prefixes.iter().any(|s| p.starts_with(s.as_str()))).collect();
    let mut samples = Vec::new();

    let mut by_kind: std::collections::BTreeMap<&'static str, Vec<(String, String)>> = Default::default();
    for p in &paths {
        if let Some(kind) = kind_of_path(p) {
            by_kind.entry(kind).or_default().push((p.clone(), p.clone()));
        }
    }
    for (kind, files) in by_kind {
        for rel in pick(files, plan.files_per_kind) {
            let path = repo.join(&rel);
            if std::fs::metadata(&path).map_or(true, |m| m.len() > MAX_FILE_BYTES) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let pieces: Vec<(String, String)> = chunks(&text, MIN_CHARS, MAX_CHARS).into_iter().enumerate().map(|(i, c)| (format!("{rel}#{i}"), c)).collect();
            for text in pick(pieces, plan.chunks_per_file) {
                samples.push(Sample { kind: kind.to_string(), source: rel.clone(), text });
            }
        }
    }

    let logs: Vec<(String, String)> = paths.iter().filter(|p| p.ends_with(LOG_SUFFIX)).map(|p| (p.clone(), p.clone())).collect();
    let mut strings: std::collections::BTreeMap<String, Vec<(String, Sample)>> = Default::default();
    for rel in pick(logs, plan.logs) {
        let Ok(text) = read_gz(&repo.join(&rel)) else { continue };
        for (n, line) in text.lines().enumerate() {
            let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
            let mut found = Vec::new();
            strings_in(&value, "", &mut found);
            for (i, (kind, s)) in found.into_iter().enumerate() {
                for (j, piece) in chunks(&s, MIN_CHARS, MAX_CHARS).into_iter().enumerate() {
                    let key = format!("{rel}:{n}:{i}:{j}");
                    strings.entry(kind.clone()).or_default().push((key, Sample { kind: kind.clone(), source: rel.clone(), text: piece }));
                }
            }
        }
    }
    for (_, candidates) in strings {
        samples.extend(pick(candidates, plan.strings_per_kind));
    }

    let mut seen = std::collections::HashSet::new();
    samples.retain(|s| seen.insert(id_of(&s.text)));
    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunks_are_in_order_within_the_limit_and_lose_no_line() {
        let text: String = (0..200).map(|i| format!("line number {i}\n")).collect();
        let pieces = chunks(&text, 10, 300);
        assert!(pieces.len() > 3);
        assert!(pieces.iter().all(|p| p.chars().count() <= 300));
        assert_eq!(pieces.concat(), text);
    }

    #[test]
    fn a_piece_shorter_than_the_minimum_is_dropped() {
        assert!(chunks("short", 200, 6000).is_empty());
    }

    #[test]
    fn a_single_line_longer_than_the_limit_is_cut_without_splitting_a_character() {
        let line = "é".repeat(1000);
        let pieces = chunks(&line, 10, 300);
        assert_eq!(pieces.iter().map(|p| p.chars().count()).collect::<Vec<_>>(), vec![300, 300, 300, 100]);
    }

    #[test]
    fn paths_are_classified_by_extension_and_unknown_ones_are_not_samples() {
        assert_eq!(kind_of_path("a/b.tsx"), Some("js-ts"));
        assert_eq!(kind_of_path("x.rs"), Some("rust"));
        assert_eq!(kind_of_path("docs/a.md"), Some("markdown"));
        assert_eq!(kind_of_path("image.png"), None);
    }

    #[test]
    fn held_out_and_generated_paths_are_excluded() {
        assert!(excluded("benchmarks/vidi/acceptance/tests/story-01.spec.ts"));
        assert!(excluded("combinations/x/stories/01/accept-summary.json"));
        assert!(excluded("a/audit.jsonl"));
        assert!(excluded("tools/benchmarker/package-lock.json"));
        assert!(!excluded("docs/dataflow.md"));
    }

    #[test]
    fn the_pick_does_not_depend_on_the_order_it_is_given() {
        let items = |order: &[usize]| order.iter().map(|i| (format!("key{i}"), *i)).collect::<Vec<_>>();
        let a = pick(items(&[1, 2, 3, 4, 5, 6, 7, 8]), 3);
        let b = pick(items(&[8, 7, 6, 5, 4, 3, 2, 1]), 3);
        assert_eq!(a, b);
        assert_eq!(a.len(), 3);
    }

    #[test]
    fn long_strings_are_found_with_a_kind_from_their_nearest_key() {
        let long = "x".repeat(MIN_STRING_CHARS);
        let v = serde_json::json!({"message": {"content": [{"type": "thinking", "thinking": long.clone()}, {"type": "tool_use", "input": {"command": long.clone()}}]}, "short": "no"});
        let mut out = Vec::new();
        strings_in(&v, "", &mut out);
        let kinds: Vec<&str> = out.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(kinds, vec!["log:thinking", "log:input"]);
    }

    #[test]
    fn a_short_string_is_not_a_sample() {
        let mut out = Vec::new();
        strings_in(&serde_json::json!({"text": "hello"}), "", &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn the_same_text_has_the_same_id() {
        assert_eq!(id_of("abc"), id_of("abc"));
        assert_ne!(id_of("abc"), id_of("abd"));
    }
}
