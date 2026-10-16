//! A run's records as bytes and parsed values (lakelib.records.read).

use crate::absent::{Absent, Item, Reason, DETAIL_NOT_JSON, DETAIL_NOT_UTF8};
use crate::layout::{is_valid_part, Lake, RunRef};
use crate::{absent_for, read_regular};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub const MAX_STORY: i64 = 999;
pub const MIN_STORY: i64 = 0;
pub const DETAIL_STORY_RANGE: &str = "story out of range";
pub const DETAIL_VERSION: &str = "version not valid";
pub const RESCORE_DIR: &str = "rescore";
pub const STORIES_DIR: &str = "stories";
pub const ITEM_RESCORE_VERSIONS: &str = "rescore-versions";
const STORY_MIN_DIGITS: usize = 2;

/// A record, named by a value and never by a path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Record {
    RunDescription,
    Status,
    Metrics,
    Finalize,
    Progress,
    Collection,
    Rescore(String),
    RescoreAccept(String, i64),
    Accept(i64),
    Prompt(i64),
    BaseCommit(i64),
    Gate(i64),
}

const FILE_RUN: &str = "run.json";
const FILE_STATUS: &str = "run-status.json";
const FILE_METRICS: &str = "metrics.json";
const FILE_FINALIZE: &str = "finalize.json";
const FILE_PROGRESS: &str = "progress.json";
const FILE_COLLECTION: &str = "collection.json";
const FILE_RESCORE: &str = "rescore.json";
const FILE_ACCEPT: &str = "accept-summary.json";
const FILE_PROMPT: &str = "prompt.md";
const FILE_BASE_COMMIT: &str = "base-commit";
const FILE_GATE: &str = "gate.json";

impl Record {
    /// The command-line name (`run-description`, `rescore-accept`, ...).
    pub fn name(&self) -> &'static str {
        match self {
            Record::RunDescription => "run-description",
            Record::Status => "status",
            Record::Metrics => "metrics",
            Record::Finalize => "finalize",
            Record::Progress => "progress",
            Record::Collection => "collection",
            Record::Rescore(_) => "rescore",
            Record::RescoreAccept(..) => "rescore-accept",
            Record::Accept(_) => "accept",
            Record::Prompt(_) => "prompt",
            Record::BaseCommit(_) => "base-commit",
            Record::Gate(_) => "gate",
        }
    }

    /// The canonical item text after `record:` (`accept:1`).
    pub fn item_name(&self) -> String {
        match self {
            Record::Rescore(v) => format!("{}:{v}", self.name()),
            Record::RescoreAccept(v, s) => format!("{}:{v}:{s}", self.name()),
            Record::Accept(s) | Record::Prompt(s) | Record::BaseCommit(s) | Record::Gate(s) => format!("{}:{s}", self.name()),
            _ => self.name().to_string(),
        }
    }

    /// The file relative to the run folder; `Err(detail)` for a story or version out of range.
    pub fn relative_path(&self) -> Result<PathBuf, &'static str> {
        let story_file = |s: i64, f: &str| -> Result<PathBuf, &'static str> { Ok(Path::new(STORIES_DIR).join(story_dir(s)?).join(f)) };
        let version = |v: &str| -> Result<PathBuf, &'static str> {
            if is_valid_version(v) {
                Ok(Path::new(RESCORE_DIR).join(v))
            } else {
                Err(DETAIL_VERSION)
            }
        };
        match self {
            Record::RunDescription => Ok(PathBuf::from(FILE_RUN)),
            Record::Status => Ok(PathBuf::from(FILE_STATUS)),
            Record::Metrics => Ok(PathBuf::from(FILE_METRICS)),
            Record::Finalize => Ok(PathBuf::from(FILE_FINALIZE)),
            Record::Progress => Ok(PathBuf::from(FILE_PROGRESS)),
            Record::Collection => Ok(PathBuf::from(FILE_COLLECTION)),
            Record::Rescore(v) => Ok(version(v)?.join(FILE_RESCORE)),
            Record::RescoreAccept(v, s) => Ok(version(v)?.join(STORIES_DIR).join(story_dir(*s)?).join(FILE_ACCEPT)),
            Record::Accept(s) => story_file(*s, FILE_ACCEPT),
            Record::Prompt(s) => story_file(*s, FILE_PROMPT),
            Record::BaseCommit(s) => story_file(*s, FILE_BASE_COMMIT),
            Record::Gate(s) => story_file(*s, FILE_GATE),
        }
    }

    /// True for `prompt` and `base-commit`.
    pub fn is_text(&self) -> bool {
        matches!(self, Record::Prompt(_) | Record::BaseCommit(_))
    }

    /// The record a run-relative path names, if any (`stories/01/gate.json` is `Gate(1)`).
    pub fn from_relative_path(path: &str) -> Option<Record> {
        let parts: Vec<&str> = path.split('/').collect();
        let story_record = |story: &str, file: &str| -> Option<Record> {
            let n = parse_story_dir(story)?;
            match file {
                FILE_ACCEPT => Some(Record::Accept(n)),
                FILE_PROMPT => Some(Record::Prompt(n)),
                FILE_BASE_COMMIT => Some(Record::BaseCommit(n)),
                FILE_GATE => Some(Record::Gate(n)),
                _ => None,
            }
        };
        match parts.as_slice() {
            [FILE_RUN] => Some(Record::RunDescription),
            [FILE_STATUS] => Some(Record::Status),
            [FILE_METRICS] => Some(Record::Metrics),
            [FILE_FINALIZE] => Some(Record::Finalize),
            [FILE_PROGRESS] => Some(Record::Progress),
            [FILE_COLLECTION] => Some(Record::Collection),
            [STORIES_DIR, story, file] => story_record(story, file),
            [RESCORE_DIR, v, FILE_RESCORE] if is_valid_version(v) => Some(Record::Rescore((*v).to_string())),
            [RESCORE_DIR, v, STORIES_DIR, story, FILE_ACCEPT] if is_valid_version(v) => {
                Some(Record::RescoreAccept((*v).to_string(), parse_story_dir(story)?))
            }
            _ => None,
        }
    }

    /// The record named by a command's words, `Err(message)` for a malformed question.
    pub fn from_words(name: &str, args: &[String]) -> Result<Record, String> {
        let wrong = |n: usize| format!("record {name} takes {n} argument(s), got {}", args.len());
        let story = |s: &str| parse_story_arg(s);
        match (name, args) {
            ("run-description", []) => Ok(Record::RunDescription),
            ("status", []) => Ok(Record::Status),
            ("metrics", []) => Ok(Record::Metrics),
            ("finalize", []) => Ok(Record::Finalize),
            ("progress", []) => Ok(Record::Progress),
            ("collection", []) => Ok(Record::Collection),
            ("rescore", [v]) => Ok(Record::Rescore(v.clone())),
            ("rescore-accept", [v, s]) => Ok(Record::RescoreAccept(v.clone(), story(s)?)),
            ("accept", [s]) => Ok(Record::Accept(story(s)?)),
            ("prompt", [s]) => Ok(Record::Prompt(story(s)?)),
            ("base-commit", [s]) => Ok(Record::BaseCommit(story(s)?)),
            ("gate", [s]) => Ok(Record::Gate(story(s)?)),
            ("run-description" | "status" | "metrics" | "finalize" | "progress" | "collection", _) => Err(wrong(0)),
            ("rescore" | "accept" | "prompt" | "base-commit" | "gate", _) => Err(wrong(1)),
            ("rescore-accept", _) => Err(wrong(2)),
            _ => Err(format!("unknown record name {name}")),
        }
    }
}

/// A story argument of the command: `^-?[0-9]+$`, clamped to the 64-bit range (anything outside 0 to 999 is a bad
/// name later, whatever its size).
pub fn parse_story_arg(text: &str) -> Result<i64, String> {
    let digits = text.strip_prefix('-').unwrap_or(text);
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("{text:?} is not a story number"));
    }
    Ok(text.parse::<i64>().unwrap_or(if text.starts_with('-') { i64::MIN } else { i64::MAX }))
}

/// The folder name of a story: at least two digits.
pub fn story_dir(story: i64) -> Result<String, &'static str> {
    if (MIN_STORY..=MAX_STORY).contains(&story) {
        Ok(format!("{story:0width$}", width = STORY_MIN_DIGITS))
    } else {
        Err(DETAIL_STORY_RANGE)
    }
}

/// The story a folder name stands for, only for the exact spelling `story_dir` writes.
fn parse_story_dir(name: &str) -> Option<i64> {
    if !name.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let n: i64 = name.parse().ok()?;
    (story_dir(n).ok()? == name).then_some(n)
}

/// A version: 1 to 64 characters of `[A-Za-z0-9._-]`, not only dots.
pub fn is_valid_version(version: &str) -> bool {
    is_valid_part(version)
}

/// Parses a JSON record: strict UTF-8, one document. `Err((detail, parser message))`.
pub fn parse_json(bytes: &[u8]) -> Result<Value, (String, String)> {
    let text = std::str::from_utf8(bytes).map_err(|e| (DETAIL_NOT_UTF8.to_string(), e.to_string()))?;
    serde_json::from_str(text).map_err(|e| (DETAIL_NOT_JSON.to_string(), e.to_string()))
}

fn malformed(run: &RunRef, record: &Record, detail: String, message: String) -> Absent {
    let mut a = Absent::for_run(run, Item::Record(record.item_name()), Reason::Malformed(detail));
    a.message = Some(message);
    a
}

impl Lake {
    /// The exact bytes of a record's file.
    pub fn bytes(&self, run: &RunRef, record: &Record) -> Result<Vec<u8>, Absent> {
        let item = Item::Record(record.item_name());
        let rel = record.relative_path().map_err(|d| Absent::for_run(run, item.clone(), Reason::BadName(d.to_string())))?;
        read_regular(&run.dir, &rel).map_err(|p| absent_for(run, item, p))
    }

    /// The parsed value of a structured record, the text of a text record (`Value::String`).
    pub fn value(&self, run: &RunRef, record: &Record) -> Result<Value, Absent> {
        let bytes = self.bytes(run, record)?;
        if record.is_text() {
            match String::from_utf8(bytes) {
                Ok(text) => Ok(Value::String(text)),
                Err(e) => Err(malformed(run, record, DETAIL_NOT_UTF8.to_string(), e.to_string())),
            }
        } else {
            parse_json(&bytes).map_err(|(detail, message)| malformed(run, record, detail, message))
        }
    }

    /// The folders of `rescore/` with a valid version name, in byte order; empty when there is no `rescore/`.
    pub fn rescore_versions(&self, run: &RunRef) -> Result<Vec<String>, Absent> {
        let item = Item::Record(ITEM_RESCORE_VERSIONS.to_string());
        let dir = run.dir.join(RESCORE_DIR);
        match std::fs::symlink_metadata(&dir) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(absent_for(run, item, crate::FileProblem::Unreadable(e))),
            Ok(m) if !m.file_type().is_dir() => return Err(Absent::for_run(run, item, Reason::NotAFile)),
            Ok(_) => {}
        }
        let mut out = Vec::new();
        let entries = std::fs::read_dir(&dir).map_err(|e| absent_for(run, item.clone(), crate::FileProblem::Unreadable(e)))?;
        for e in entries {
            let e = e.map_err(|e| absent_for(run, item.clone(), crate::FileProblem::Unreadable(e)))?;
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if let (true, Some(name)) = (is_dir, e.file_name().to_str()) {
                if is_valid_version(name) {
                    out.push(name.to_string());
                }
            }
        }
        out.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
        Ok(out)
    }
}
