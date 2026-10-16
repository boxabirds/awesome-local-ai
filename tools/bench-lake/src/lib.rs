//! bench-lake: a read-only library that reads benchmark runs from the lake (story 21).
//!
//! The lake is two folders, a collected folder and a reference folder (`Lake`). Nothing here writes into them; the
//! one thing that creates files is `Lake::workspace` (bundle.rs), and only in a destination outside both roots.
//! Every function answers with a value or an `Absent`/`Refused`; none stops the program (decision 7 of the design).
//! The exact output of the command is in CANONICAL.md.

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
use std::io;
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
    let _ = (base, rel);
    todo!("open_regular")
}

/// Reads all bytes of `base/rel` under the rules of `open_regular`.
pub fn read_regular(base: &Path, rel: &Path) -> Result<Vec<u8>, FileProblem> {
    let _ = (base, rel);
    todo!("read_regular")
}

/// Lower-case hex SHA-256 of `bytes`.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let _ = bytes;
    todo!("sha256_hex")
}

/// The canonical text of a JSON value (CANONICAL.md section 2): sorted keys, no whitespace, minimal escapes.
pub fn canonical(value: &Value) -> String {
    let _ = value;
    todo!("canonical")
}
