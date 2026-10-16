//! A story's conversation log in the form the lake holds (lakelib.logs.read).

use crate::absent::{Absent, Item, Reason, DETAIL_NOT_GZIP};
use crate::layout::{Lake, RunRef};
use crate::records::{story_dir, STORIES_DIR};
use crate::{hex, open_regular, FileProblem};
use flate2::read::MultiGzDecoder;
use sha2::{Digest as _, Sha256};
use std::io::{self, BufRead, BufReader, Read};
use std::path::{Path, PathBuf};

pub const RAW_LOG: &str = "agent-events.jsonl";
pub const COMPACT_LOG: &str = "agent-events.compact.jsonl.gz";
const CHUNK_BYTES: usize = 64 * 1024;
const LINE_FEED: u8 = b'\n';

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Raw,
    Compact,
}

impl Form {
    pub fn as_str(&self) -> &'static str {
        match self {
            Form::Raw => "raw",
            Form::Compact => "compact",
        }
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
        self.form
    }

    fn absent(&self, reason: Reason, message: Option<String>) -> Absent {
        let mut a = Absent::new(&self.run_id, self.node.as_deref(), Item::Log(self.story), reason);
        a.message = message;
        a
    }

    fn read_error(&self, e: &io::Error) -> Absent {
        let damaged = matches!(e.kind(), io::ErrorKind::InvalidInput | io::ErrorKind::InvalidData | io::ErrorKind::UnexpectedEof);
        if self.form == Form::Compact && damaged {
            self.absent(Reason::Malformed(DETAIL_NOT_GZIP.to_string()), Some(e.to_string()))
        } else {
            self.absent(Reason::from_io(e), Some(e.to_string()))
        }
    }

    /// A reader of the decoded bytes (the file as it is, or the gunzipped file).
    pub fn reader(&self) -> Result<Box<dyn Read>, Absent> {
        let file = std::fs::File::open(&self.path).map_err(|e| self.read_error(&e))?;
        Ok(match self.form {
            Form::Raw => Box::new(BufReader::with_capacity(CHUNK_BYTES, file)),
            Form::Compact => Box::new(MultiGzDecoder::new(BufReader::with_capacity(CHUNK_BYTES, file))),
        })
    }

    /// All decoded bytes.
    pub fn bytes(&self) -> Result<Vec<u8>, Absent> {
        let mut out = Vec::new();
        self.reader()?.read_to_end(&mut out).map_err(|e| self.read_error(&e))?;
        Ok(out)
    }

    /// The lines, without their line feed, one at a time; memory use is one line. A damaged compacted file ends
    /// the stream with an `E-LAKE-MALFORMED` item after the lines already delivered.
    pub fn lines(&self) -> Lines {
        Lines { log: self.clone(), reader: None, done: false }
    }

    /// Length, lines and SHA-256, streamed.
    pub fn digest(&self) -> Result<Digest, Absent> {
        let mut reader = self.reader()?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; CHUNK_BYTES];
        let (mut length, mut feeds, mut last) = (0u64, 0u64, LINE_FEED);
        loop {
            let n = reader.read(&mut buf).map_err(|e| self.read_error(&e))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            length += n as u64;
            feeds += buf[..n].iter().filter(|b| **b == LINE_FEED).count() as u64;
            last = buf[n - 1];
        }
        let lines = if length > 0 && last != LINE_FEED { feeds + 1 } else { feeds };
        Ok(Digest { length, lines, sha256: hex(&hasher.finalize()) })
    }
}

/// The iterator of `Log::lines`.
pub struct Lines {
    log: Log,
    reader: Option<BufReader<Box<dyn Read>>>,
    done: bool,
}

impl Iterator for Lines {
    type Item = Result<Vec<u8>, Absent>;

    fn next(&mut self) -> Option<Self::Item> {
        if self.done {
            return None;
        }
        if self.reader.is_none() {
            match self.log.reader() {
                Ok(r) => self.reader = Some(BufReader::with_capacity(CHUNK_BYTES, r)),
                Err(e) => {
                    self.done = true;
                    return Some(Err(e));
                }
            }
        }
        let mut line = Vec::new();
        match self.reader.as_mut()?.read_until(LINE_FEED, &mut line) {
            Ok(0) => {
                self.done = true;
                None
            }
            Ok(_) => {
                if line.last() == Some(&LINE_FEED) {
                    line.pop();
                }
                Some(Ok(line))
            }
            Err(e) => {
                self.done = true;
                Some(Err(self.log.read_error(&e)))
            }
        }
    }
}

impl Lake {
    pub fn log(&self, run: &RunRef, story: i64) -> Result<Log, Absent> {
        let item = Item::Log(story);
        let dir = story_dir(story).map_err(|d| Absent::for_run(run, item.clone(), Reason::BadName(d.to_string())))?;
        let rel = |file: &str| Path::new(STORIES_DIR).join(&dir).join(file);
        let make = |form: Form, file: &str| Log {
            run_id: run.id.clone(),
            node: run.node.clone(),
            story,
            form,
            path: run.dir.join(rel(file)),
        };
        let fail = |p: FileProblem| crate::absent_for(run, item.clone(), p);
        let raw_blocked = match open_regular(&run.dir, &rel(RAW_LOG)) {
            Ok(_) => return Ok(make(Form::Raw, RAW_LOG)),
            Err(FileProblem::Missing) => false,
            Err(FileProblem::NotAFile) => true,
            Err(other) => return Err(fail(other)),
        };
        match open_regular(&run.dir, &rel(COMPACT_LOG)) {
            Ok(_) => Ok(make(Form::Compact, COMPACT_LOG)),
            Err(FileProblem::Missing) if raw_blocked => Err(fail(FileProblem::NotAFile)),
            Err(other) => Err(fail(other)),
        }
    }
}
