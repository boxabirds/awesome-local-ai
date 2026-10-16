//! A run's records as bytes and parsed values (lakelib.records.read).

use crate::absent::Absent;
use crate::layout::{Lake, RunRef};
use serde_json::Value;
use std::path::PathBuf;

pub const MAX_STORY: i64 = 999;
pub const MIN_STORY: i64 = 0;
pub const MAX_VERSION_LEN: usize = 64;
pub const DETAIL_STORY_RANGE: &str = "story out of range";
pub const DETAIL_VERSION: &str = "version not valid";

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

impl Record {
    /// The command-line name (`run-description`, `rescore-accept`, ...).
    pub fn name(&self) -> &'static str {
        todo!("Record::name")
    }
    /// The canonical item text after `record:` (`accept:1`).
    pub fn item_name(&self) -> String {
        todo!("Record::item_name")
    }
    /// The file relative to the run folder; `Err(detail)` for a story or version out of range.
    pub fn relative_path(&self) -> Result<PathBuf, &'static str> {
        todo!("Record::relative_path")
    }
    /// True for `prompt` and `base-commit`.
    pub fn is_text(&self) -> bool {
        todo!("Record::is_text")
    }
    /// The record a run-relative path names, if any (`stories/01/gate.json` is `Gate(1)`).
    pub fn from_relative_path(path: &str) -> Option<Record> {
        let _ = path;
        todo!("Record::from_relative_path")
    }
    /// The record named by a command's words, `Err(message)` for a malformed question.
    pub fn from_words(name: &str, args: &[String]) -> Result<Record, String> {
        let _ = (name, args);
        todo!("Record::from_words")
    }
}

/// The folder name of a story: at least two digits.
pub fn story_dir(story: i64) -> Result<String, &'static str> {
    let _ = story;
    todo!("story_dir")
}

/// A version: 1 to 64 characters of `[A-Za-z0-9._-]`, not only dots.
pub fn is_valid_version(version: &str) -> bool {
    let _ = version;
    todo!("is_valid_version")
}

impl Lake {
    /// The exact bytes of a record's file.
    pub fn bytes(&self, run: &RunRef, record: &Record) -> Result<Vec<u8>, Absent> {
        let _ = (run, record);
        todo!("Lake::bytes")
    }
    /// The parsed value of a structured record, the text of a text record (`Value::String`).
    pub fn value(&self, run: &RunRef, record: &Record) -> Result<Value, Absent> {
        let _ = (run, record);
        todo!("Lake::value")
    }
    /// The folders of `rescore/` with a valid version name, in byte order; empty when there is no `rescore/`.
    pub fn rescore_versions(&self, run: &RunRef) -> Result<Vec<String>, Absent> {
        let _ = run;
        todo!("Lake::rescore_versions")
    }
}
