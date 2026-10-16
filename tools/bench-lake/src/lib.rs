//! bench-lake: a read-only library that reads benchmark runs from the lake (story 21).
//!
//! The lake is two folders, a collected folder and a reference folder (`Lake`). Nothing here writes into them; the
//! one thing that creates files is `Lake::workspace` (bundle.rs), and only in a destination outside both roots.
//! Every function answers with a value or an `Absent`/`Refused`; none stops the program (decision 7 of the design).
//! The exact output of the command is in CANONICAL.md.

// An absence is the library's answer, not a rare fault: the design's signatures return it by value (128 bytes), and
// nothing here is on a hot path.
#![allow(clippy::result_large_err)]

pub mod absent;
pub mod bundle;
pub mod cli;
pub mod compare;
pub mod complete;
pub mod layout;
pub mod logs;
pub mod records;

use serde_json::Value;
use std::fs::File;
use sha2::{Digest, Sha256};
use std::io::{self, Read};
use std::path::Path;

pub use absent::{Absent, Error, Item, Reason, Refused, RefusedReason};
pub use bundle::Workspace;
pub use complete::Completeness;
pub use layout::{Discovery, Kind, Lake, Rejected, RunRef};
pub use logs::{Form, Log};
pub use records::Record;

/// Why a file could not be opened as a regular file.
#[derive(Debug)]
pub enum FileProblem {
    /// Nothing is there.
    Missing,
    /// A link or a folder is there (also a link in a folder of the path).
    NotAFile,
    /// The operating system refused.
    Unreadable(io::Error),
}

/// Opens `base/rel` for reading only if it is a regular file and no folder of `rel` is a link.
pub fn open_regular(base: &Path, rel: &Path) -> Result<File, FileProblem> {
    let mut current = base.to_path_buf();
    let mut components = rel.components().peekable();
    while let Some(component) = components.next() {
        current.push(component);
        let meta = std::fs::symlink_metadata(&current).map_err(classify_io)?;
        let is_last = components.peek().is_none();
        if is_last {
            if !meta.file_type().is_file() {
                return Err(FileProblem::NotAFile);
            }
        } else if !meta.file_type().is_dir() {
            return Err(FileProblem::NotAFile);
        }
    }
    File::open(&current).map_err(classify_io)
}

fn classify_io(e: io::Error) -> FileProblem {
    if e.kind() == io::ErrorKind::NotFound {
        FileProblem::Missing
    } else {
        FileProblem::Unreadable(e)
    }
}

/// Reads all bytes of `base/rel` under the rules of `open_regular`.
pub fn read_regular(base: &Path, rel: &Path) -> Result<Vec<u8>, FileProblem> {
    let mut file = open_regular(base, rel)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).map_err(FileProblem::Unreadable)?;
    Ok(bytes)
}

/// The absence for a file problem on `item` of `run`.
pub fn absent_for(run: &RunRef, item: Item, problem: FileProblem) -> Absent {
    match problem {
        FileProblem::Missing => Absent::for_run(run, item, Reason::NotCollected),
        FileProblem::NotAFile => Absent::for_run(run, item, Reason::NotAFile),
        FileProblem::Unreadable(e) => {
            let mut a = Absent::for_run(run, item, Reason::from_io(&e));
            a.message = Some(e.to_string());
            a
        }
    }
}

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(char::from_digit(u32::from(b >> NIBBLE_BITS), HEX_RADIX).unwrap());
        out.push(char::from_digit(u32::from(b & NIBBLE_MASK), HEX_RADIX).unwrap());
    }
    out
}

const NIBBLE_BITS: u8 = 4;
const NIBBLE_MASK: u8 = 0x0f;
const HEX_RADIX: u32 = 16;

/// The canonical text of a JSON value (CANONICAL.md section 2): sorted keys, no whitespace, minimal escapes.
/// Written here, not taken from the JSON library, because that library's key order depends on features another
/// crate of the workspace switches on.
pub fn canonical(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push('{');
            for (i, key) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_canonical(&map[key], out);
            }
            out.push('}');
        }
    }
}

const FIRST_PRINTABLE: char = '\u{20}';

fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if c < FIRST_PRINTABLE => {
                out.push_str("\\u00");
                out.push_str(&hex(&[c as u8]));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}
