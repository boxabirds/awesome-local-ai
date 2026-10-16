//! A story's conversation log in the form the lake holds (lakelib.logs.read).

use crate::absent::Absent;
use crate::layout::{Lake, RunRef};
use std::io::Read;
use std::path::PathBuf;

pub const RAW_LOG: &str = "agent-events.jsonl";
pub const COMPACT_LOG: &str = "agent-events.compact.jsonl.gz";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Raw,
    Compact,
}

impl Form {
    pub fn as_str(&self) -> &'static str {
        todo!("Form::as_str")
    }
}

#[derive(Debug, Clone)]
pub struct Log {
    pub(crate) run_id: String,
    pub(crate) node: Option<String>,
    pub(crate) story: i64,
    pub(crate) form: Form,
    pub(crate) path: PathBuf,
}

/// Length, line count and SHA-256 of the decoded stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Digest {
    pub length: u64,
    pub lines: u64,
    pub sha256: String,
}

impl Log {
    pub fn form(&self) -> Form {
        todo!("Log::form")
    }
    /// A reader of the decoded bytes (the file as it is, or the gunzipped file).
    pub fn reader(&self) -> Result<Box<dyn Read>, Absent> {
        todo!("Log::reader")
    }
    /// All decoded bytes.
    pub fn bytes(&self) -> Result<Vec<u8>, Absent> {
        todo!("Log::bytes")
    }
    /// The lines, without their line feed, one at a time; memory use is one line. A damaged compacted file ends
    /// the stream with an `E-LAKE-MALFORMED` item after the lines already delivered.
    pub fn lines(&self) -> Lines {
        todo!("Log::lines")
    }
    /// Length, lines and SHA-256, streamed.
    pub fn digest(&self) -> Result<Digest, Absent> {
        todo!("Log::digest")
    }
}

/// The iterator of `Log::lines`.
pub struct Lines {
    pub(crate) _private: (),
}

impl Iterator for Lines {
    type Item = Result<Vec<u8>, Absent>;
    fn next(&mut self) -> Option<Self::Item> {
        todo!("Lines::next")
    }
}

impl Lake {
    pub fn log(&self, run: &RunRef, story: i64) -> Result<Log, Absent> {
        let _ = (run, story);
        todo!("Lake::log")
    }
}
