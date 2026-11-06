//! A varied, reproducible set of texts to count: the repository's own tracked files (prose, code in several
//! languages, JSON, configuration) and the long strings inside the runs' agent logs (thinking, replies, tool-call
//! inputs, tool results) from every client the harness drives. The logs come from the lake (story 23), through the
//! bench-lake library: every run's preferred copy, a story's raw `agent-events.jsonl` where the lake has it, else its
//! compact copy; stream deltas are skipped. A log is named `<run id>/stories/<NN>/<file>`.
//!
//! Of the repository, only files git tracks are read, and never a run's: a path at or below a run folder
//! (`combinations/<six parts>/benchmarks/<pack>/<run>/...`, `benchmarks/reference/<pack>/<stack>/<run>/...`) is run data,
//! which the lake holds. Anything that touches the held-out suite is left out. Every choice is by a hash of the text's
//! name, so the same repository and lake give the same corpus.

use anyhow::{Context, Result};
use bench_lake::{Form, Lake, Log};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

pub const MIN_CHARS: usize = 200;
pub const MAX_CHARS: usize = 6000;
/// A string inside a log is only a sample if it is at least this long.
pub const MIN_STRING_CHARS: usize = 300;
const MAX_FILE_BYTES: u64 = 3 * 1024 * 1024;
/// Below `combinations/`: family, version, variant, os, machine, engine-client, the literal `benchmarks`, pack, run.
const COMBINATION_RUN_DEPTH: usize = 9;
const COMBINATION_BENCHMARKS_LEVEL: usize = 6;
/// Below `benchmarks/reference/`: pack, stack, run.
const REFERENCE_RUN_DEPTH: usize = 3;
/// Per-token stream events: the raw log has one for every chunk, carrying partial text and partial tool output.
/// The compact copy kept only the first of each model call; none is a sample.
const STREAM_DELTA_EVENTS: [&str; 2] = ["message_update", "tool_execution_update"];
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

/// Whether a tracked path is a run's (at or below a run folder): run data, which the corpus reads from the lake only.
pub fn in_run_folder(path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    match parts.as_slice() {
        ["combinations", rest @ ..] => rest.len() > COMBINATION_RUN_DEPTH && rest[COMBINATION_BENCHMARKS_LEVEL] == "benchmarks",
        ["benchmarks", "reference", rest @ ..] => rest.len() > REFERENCE_RUN_DEPTH,
        _ => false,
    }
}

/// Every story log in the lake at `state` (its state folder), from each run's preferred copy, in run id and story
/// order: (name, log). A story with no log is skipped; a lake with neither root is an error naming it.
fn lake_logs(state: &Path) -> Result<Vec<(String, Log)>> {
    let lake = Lake::in_state_dir(state);
    let found = lake.discover();
    anyhow::ensure!(
        found.missing_roots.len() < 2,
        "no lake at {}: neither collected/ nor reference/ is there",
        state.display()
    );
    let ids: std::collections::BTreeSet<&str> = found.runs.iter().map(|r| r.id.as_str()).collect();
    let mut logs = Vec::new();
    for id in ids {
        let Some(run) = lake.preferred(&found, id) else { continue };
        let Ok(entries) = std::fs::read_dir(run.dir.join(bench_lake::records::STORIES_DIR)) else { continue };
        let mut stories: Vec<(i64, String)> = entries
            .filter_map(|e| e.ok()?.file_name().into_string().ok())
            .filter_map(|name| {
                let story = bench_lake::records::parse_story_arg(&name).ok()?;
                (bench_lake::records::story_dir(story).ok()? == name).then_some((story, name))
            })
            .collect();
        stories.sort();
        for (story, dir) in stories {
            let Ok(log) = lake.log(run, story) else { continue };
            let file = match log.form() {
                Form::Raw => bench_lake::logs::RAW_LOG,
                Form::Compact => bench_lake::logs::COMPACT_LOG,
            };
            logs.push((format!("{id}/stories/{dir}/{file}"), log));
        }
    }
    Ok(logs)
}

/// The corpus for `repo` and the lake at `lake` (its state folder), leaving out any source whose name starts with one
/// of `skip_prefixes`.
pub fn build(repo: &Path, lake: &Path, plan: Plan, skip_prefixes: &[String]) -> Result<Vec<Sample>> {
    let wanted = |p: &str| !excluded(p) && !skip_prefixes.iter().any(|s| p.starts_with(s.as_str()));
    let paths: Vec<String> = tracked(repo)?.into_iter().filter(|p| wanted(p) && !in_run_folder(p)).collect();
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

    let logs: Vec<(String, (String, Log))> = lake_logs(lake)?.into_iter().filter(|(name, _)| wanted(name)).map(|(name, log)| (name.clone(), (name, log))).collect();
    let mut strings: std::collections::BTreeMap<String, Vec<(String, Sample)>> = Default::default();
    for (rel, log) in pick(logs, plan.logs) {
        let Ok(bytes) = log.bytes() else { continue };
        let Ok(text) = String::from_utf8(bytes) else { continue };
        for (n, line) in text.lines().enumerate() {
            let Ok(value) = serde_json::from_str::<Value>(line) else { continue };
            if value.get("type").and_then(Value::as_str).is_some_and(|t| STREAM_DELTA_EVENTS.contains(&t)) {
                continue;
            }
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

    // ---- the corpus of a real git repository ----

    const ALL: Plan = Plan { files_per_kind: 100, chunks_per_file: 100, logs: 100, strings_per_kind: 100 };
    /// Lines of prose in a fixture file: enough characters to be a chunk of its own.
    const FIXTURE_LINES: usize = 12;
    const GIT_IDENTITY: [&str; 4] = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];

    fn scratch(tag: &str) -> std::path::PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!("token-counter-corpus-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A run's id in the scratch lakes: a combination run, nine parts below `combinations/` as the lake lays it out.
    const RUN_ID: &str = "combinations/fam/1/size/linux/hw/eng-cli/benchmarks/vidi/r1";

    /// A lake (its state folder) holding one run, RUN_ID, collected from one machine: (state folder, run folder).
    fn lake(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let state = scratch(tag);
        std::fs::create_dir_all(state.join("reference")).unwrap();
        let run = state.join("collected").join("node-t").join(RUN_ID);
        write(&run, "run.json", b"{}");
        (state, run)
    }

    fn git(dir: &Path, args: &[&str]) {
        let out = std::process::Command::new("git").arg("-C").arg(dir).args(GIT_IDENTITY).args(args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    }

    fn prose(tag: &str) -> String {
        (0..FIXTURE_LINES).map(|i| format!("{tag} line {i}: the quick brown fox jumps over the lazy dog again and again\n")).collect()
    }

    fn write(dir: &Path, rel: &str, bytes: &[u8]) {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn gz(text: &str) -> Vec<u8> {
        use std::io::Write;
        let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(text.as_bytes()).unwrap();
        enc.finish().unwrap()
    }

    #[test]
    fn the_tracked_files_are_the_ones_git_lists_and_a_directory_that_is_not_a_repository_is_an_error() {
        let dir = scratch("tracked");
        git(&dir, &["init", "-q"]);
        write(&dir, "a/one.md", b"x");
        write(&dir, "two.txt", b"y");
        write(&dir, "untracked.md", b"z");
        git(&dir, &["add", "a/one.md", "two.txt"]);
        let mut files = tracked(&dir).unwrap();
        files.sort();
        assert_eq!(files, vec!["a/one.md".to_string(), "two.txt".to_string()]);
        let outside = scratch("tracked-outside");
        assert_eq!(tracked(&outside).unwrap_err().to_string(), "git ls-files failed");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&outside);
    }

    #[test]
    fn a_repository_gives_one_sample_per_chunk_of_each_readable_file_and_per_long_log_string_without_repeats() {
        let dir = scratch("build");
        git(&dir, &["init", "-q"]);
        write(&dir, "README.md", prose("readme").as_bytes());
        write(&dir, "src/lib.rs", prose("rust").as_bytes());
        // The same text under another name is one sample.
        write(&dir, "copy/README.md", prose("readme").as_bytes());
        // Left out: held-out material, a skipped prefix, an unknown extension.
        write(&dir, "acceptance/story.md", prose("heldout").as_bytes());
        write(&dir, "skipped/notes.md", prose("skipped").as_bytes());
        write(&dir, "image.png", b"not text");
        // Tracked but not samples: too big, not UTF-8, removed from the working copy.
        write(&dir, "big.md", &vec![b'a'; MAX_FILE_BYTES as usize + 1]);
        write(&dir, "binary.md", &[0xff, 0xfe, 0xfd]);
        write(&dir, "gone.md", prose("gone").as_bytes());
        // Logs: one with long strings, a short one, a line that is not JSON; and a log that is not gzip.
        let long = "z".repeat(MIN_STRING_CHARS + MIN_CHARS);
        let log = format!(
            "{}\nnot json\n{}\n",
            serde_json::json!({"message": {"content": [{"type": "thinking", "thinking": long.clone()}, {"type": "text", "text": "short"}]}}),
            serde_json::json!({"result": long.clone()})
        );
        let (state, run) = lake("build-lake");
        write(&run, "stories/01/agent-events.compact.jsonl.gz", &gz(&log));
        write(&run, "stories/02/agent-events.compact.jsonl.gz", b"not gzip");
        git(&dir, &["add", "."]);
        std::fs::remove_file(dir.join("gone.md")).unwrap();

        let samples = build(&dir, &state, ALL, &["skipped/".to_string()]).unwrap();
        let got: Vec<(&str, &str)> = samples.iter().map(|s| (s.kind.as_str(), s.source.as_str())).collect();
        // The copy of README.md has the same text as README.md and is dropped, whichever is met second.
        assert_eq!(got.iter().filter(|(k, _)| *k == "markdown").count(), 1, "{got:?}");
        assert!(got.iter().any(|(k, s)| *k == "rust" && *s == "src/lib.rs"), "{got:?}");
        // The thinking string and the result string have the same text, so one of them is dropped as a repeat.
        let logs: Vec<&&str> = got.iter().filter(|(k, _)| k.starts_with("log:")).map(|(k, _)| k).collect();
        assert_eq!(logs.len(), 1, "{got:?}");
        for left_out in ["acceptance", "skipped", "image.png", "big.md", "binary.md", "gone.md", "stories/02"] {
            assert!(!got.iter().any(|(_, s)| s.contains(left_out)), "{left_out} should not be a sample: {got:?}");
        }
        assert!(samples.iter().all(|s| s.text.chars().count() >= MIN_CHARS));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&state);
    }

    #[test]
    fn long_strings_of_different_kinds_in_one_log_are_each_a_sample_and_the_plan_limits_them() {
        let dir = scratch("kinds");
        git(&dir, &["init", "-q"]);
        let thinking = "t".repeat(MIN_STRING_CHARS);
        let result = "r".repeat(MIN_STRING_CHARS);
        let log = format!("{}\n", serde_json::json!({"thinking": thinking, "result": result}));
        let (state, run) = lake("kinds-lake");
        write(&run, "stories/01/agent-events.compact.jsonl.gz", &gz(&log));
        let samples = build(&dir, &state, ALL, &[]).unwrap();
        let mut kinds: Vec<&str> = samples.iter().map(|s| s.kind.as_str()).collect();
        kinds.sort();
        assert_eq!(kinds, vec!["log:result", "log:thinking"]);
        let none = build(&dir, &state, Plan { logs: 0, ..ALL }, &[]).unwrap();
        assert!(none.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&state);
    }

    // ---- a story's raw log and its compact copy ----

    /// A real excerpt of a pi story (lake: mtplx-pi v2-mtplx2122-r1 story 12) in both forms: the raw log with its
    /// per-token deltas, and the compact copy the harness used to publish. Beside the harness's other fixtures.
    fn excerpt(client: &str, file: &str) -> Vec<u8> {
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/spec-bench/harness/fixtures/events").join(client).join(file)).unwrap()
    }

    fn texts_of(samples: &[Sample]) -> Vec<(String, String)> {
        let mut v: Vec<(String, String)> = samples.iter().filter(|s| s.kind.starts_with("log:")).map(|s| (s.kind.clone(), s.text.clone())).collect();
        v.sort();
        v
    }

    #[test]
    fn a_story_gives_the_same_log_samples_from_its_raw_log_and_from_its_compact_copy() {
        for client in ["pi", "opencode", "claude"] {
            let repo = scratch("repo");
            git(&repo, &["init", "-q"]);
            let (raw, raw_run) = lake("raw-log");
            write(&raw_run, "stories/01/agent-events.jsonl", &excerpt(client, "agent-events.jsonl"));
            let (compact, compact_run) = lake("compact-log");
            write(&compact_run, "stories/01/agent-events.compact.jsonl.gz", &excerpt(client, "agent-events.compact.jsonl.gz"));
            let from_raw = texts_of(&build(&repo, &raw, ALL, &[]).unwrap());
            let from_compact = texts_of(&build(&repo, &compact, ALL, &[]).unwrap());
            assert!(!from_raw.is_empty(), "{client}: no samples");
            assert_eq!(from_raw, from_compact, "{client}");
            for d in [&repo, &raw, &compact] {
                let _ = std::fs::remove_dir_all(d);
            }
        }
    }

    #[test]
    fn a_stream_delta_is_not_a_sample_and_a_story_with_both_forms_is_read_once_from_the_raw_log() {
        let dir = scratch("both-forms");
        git(&dir, &["init", "-q"]);
        let partial = "p".repeat(MIN_STRING_CHARS + MIN_CHARS);
        let final_result = "f".repeat(MIN_STRING_CHARS + MIN_CHARS);
        let raw = format!(
            "{}\n{}\n",
            serde_json::json!({"_rx": 1.0, "type": "tool_execution_update", "partialResult": partial}),
            serde_json::json!({"_rx": 2.0, "type": "tool_execution_end", "result": final_result})
        );
        let compact_only = format!("{}\n", serde_json::json!({"_rx": 2.0, "type": "tool_execution_end", "result": "c".repeat(MIN_STRING_CHARS + MIN_CHARS)}));
        let (state, run) = lake("both-forms-lake");
        write(&run, "stories/01/agent-events.jsonl", raw.as_bytes());
        write(&run, "stories/01/agent-events.compact.jsonl.gz", &gz(&compact_only));
        write(&run, "stories/02/agent-events.compact.jsonl.gz", &gz(&compact_only));
        let samples = build(&dir, &state, ALL, &[]).unwrap();
        let got: Vec<(&str, char)> = samples.iter().map(|s| (s.source.as_str(), s.text.chars().next().unwrap())).collect();
        let source = |s: &str, f: &str| format!("{RUN_ID}/stories/{s}/{f}");
        let got: Vec<(String, char)> = got.into_iter().map(|(s, c)| (s.to_string(), c)).collect();
        assert!(got.contains(&(source("01", "agent-events.jsonl"), 'f')), "{got:?}");
        assert!(!got.iter().any(|(_, c)| *c == 'p'), "a delta's partial result is not a sample: {got:?}");
        assert!(!got.iter().any(|(s, _)| s.contains("stories/01/agent-events.compact")), "story 1 is read from its raw log only: {got:?}");
        assert!(got.contains(&(source("02", "agent-events.compact.jsonl.gz"), 'c')), "story 2 has only the compact copy: {got:?}");
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&state);
    }

    #[test]
    fn a_directory_that_is_not_a_repository_has_no_corpus() {
        let dir = scratch("not-a-repo");
        let (state, _) = lake("not-a-repo-lake");
        assert!(build(&dir, &state, ALL, &[]).is_err());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&state);
    }

    // ---- story 23: run data comes from the lake, never from a checkout ----

    #[test]
    fn a_runs_files_and_logs_are_read_from_the_lake_and_never_from_the_checkout() {
        let dir = scratch("runs-from-lake");
        git(&dir, &["init", "-q"]);
        write(&dir, "docs/guide.md", prose("guide").as_bytes());
        // A combination's own files sit above its runs: they are the repository's, and samples.
        write(&dir, "combinations/fam/1/size/linux/hw/eng-cli/config.sh", prose("config").as_bytes());
        // A run that git carried into this checkout: neither its files nor its log is read.
        let tracked_run = "combinations/fam/1/size/linux/hw/eng-cli/benchmarks/vidi/r0";
        write(&dir, &format!("{tracked_run}/summary.md"), prose("checkout-run-file").as_bytes());
        write(&dir, &format!("{tracked_run}/stories/01/agent-events.jsonl"), format!("{}\n", serde_json::json!({"result": "k".repeat(MIN_STRING_CHARS)})).as_bytes());
        write(&dir, "benchmarks/reference/vidi/opus/run-1/README.md", prose("checkout-reference-run").as_bytes());
        write(&dir, "benchmarks/reference/vidi/opus/NOTES.md", prose("stack").as_bytes());
        git(&dir, &["add", "."]);
        let (state, run) = lake("runs-from-lake-lake");
        write(&run, "stories/01/agent-events.jsonl", format!("{}\n", serde_json::json!({"result": "l".repeat(MIN_STRING_CHARS)})).as_bytes());
        // The same run collected from a second machine: one run, read once, from the copy the lake prefers.
        write(&state.join("collected/node-u").join(RUN_ID), "run.json", b"{}");

        let samples = build(&dir, &state, ALL, &[]).unwrap();
        let mut sources: Vec<&str> = samples.iter().map(|s| s.source.as_str()).collect();
        sources.sort();
        let lake_log = format!("{RUN_ID}/stories/01/agent-events.jsonl");
        assert_eq!(
            sources,
            vec!["benchmarks/reference/vidi/opus/NOTES.md", lake_log.as_str(), "combinations/fam/1/size/linux/hw/eng-cli/config.sh", "docs/guide.md"]
        );
        assert!(samples.iter().any(|s| s.text.starts_with('l')) && !samples.iter().any(|s| s.text.starts_with('k')));
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&state);
    }

    #[test]
    fn the_held_out_story_is_left_out_of_the_lakes_logs_by_its_run_id() {
        let dir = scratch("held-out-lake");
        git(&dir, &["init", "-q"]);
        let state = scratch("held-out-lake-state");
        std::fs::create_dir_all(state.join("collected")).unwrap();
        let run = state.join("reference/vidi/opus/r1");
        write(&run, "run.json", b"{}");
        for (story, c) in [("04", "h"), ("05", "o")] {
            write(&run, &format!("stories/{story}/agent-events.jsonl"), format!("{}\n", serde_json::json!({"result": c.repeat(MIN_STRING_CHARS)})).as_bytes());
        }
        let samples = build(&dir, &state, ALL, &["benchmarks/reference/vidi/opus/r1/stories/04/".to_string()]).unwrap();
        let sources: Vec<&str> = samples.iter().map(|s| s.source.as_str()).collect();
        assert_eq!(sources, vec!["benchmarks/reference/vidi/opus/r1/stories/05/agent-events.jsonl"]);
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&state);
    }

    #[test]
    fn a_lake_that_is_not_there_is_an_error_naming_it() {
        let dir = scratch("no-lake");
        git(&dir, &["init", "-q"]);
        let missing = dir.join("no-such-state");
        let err = build(&dir, &missing, ALL, &[]).unwrap_err().to_string();
        assert_eq!(err, format!("no lake at {}: neither collected/ nor reference/ is there", missing.display()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
