//! Discovery of runs, the part rule and the ranking of copies (lakelib.layout.discover).

use crate::absent::Absent;
use crate::complete::Completeness;
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

pub const MAX_PART_LEN: usize = 64;
/// Levels below `combinations`: family, version, variant, os, machine, engine-client, benchmarks, pack, run.
pub const COMBINATION_DEPTH: usize = 9;
/// The 1-based level that must be the literal `benchmarks`.
pub const BENCHMARKS_LEVEL: usize = 7;
/// The 1-based level whose name must contain a dash (engine-client).
pub const ENGINE_CLIENT_LEVEL: usize = 6;
/// Levels below the reference folder: pack, stack, run.
pub const REFERENCE_DEPTH: usize = 3;
pub const COMBINATIONS_DIR: &str = "combinations";
pub const BENCHMARKS_DIR: &str = "benchmarks";
pub const REFERENCE_ID_PREFIX: &str = "benchmarks/reference/";
pub const COLLECTED_LABEL: &str = "collected";
pub const REFERENCE_LABEL: &str = "reference";
pub const MARKER_COLLECTION: &str = "collection.json";
pub const MARKER_RUN: &str = "run.json";

pub const CODE_NOT_A_FOLDER: &str = "E-LAKE-NOT-A-FOLDER";
pub const CODE_STRAY: &str = "E-LAKE-STRAY";
pub const CODE_SHALLOW: &str = "E-LAKE-SHALLOW";
pub const CODE_BAD_PART: &str = "E-LAKE-BAD-PART";
pub const CODE_NO_MARKER: &str = "E-LAKE-NO-MARKER";
pub const CODE_UNREADABLE: &str = "E-LAKE-UNREADABLE";

/// The part rule: 1 to 64 characters of `[A-Za-z0-9._-]`, not only dots.
pub fn is_valid_part(part: &str) -> bool {
    let _ = part;
    todo!("is_valid_part")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Lake {
    pub collected: PathBuf,
    pub reference: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Combination,
    Reference,
}

impl Kind {
    pub fn as_str(&self) -> &'static str {
        todo!("Kind::as_str")
    }
}

/// One copy of a run: one per node folder for a combination run, the only one for a reference run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunRef {
    pub kind: Kind,
    pub node: Option<String>,
    pub id: String,
    pub dir: PathBuf,
    /// The folder's place relative to its root, with the root's label first (`collected/<node>/<id>`).
    pub label: String,
}

impl RunRef {
    pub fn to_value(&self) -> serde_json::Value {
        todo!("RunRef::to_value")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rejected {
    pub path: PathBuf,
    /// The path relative to its root, with the root's label first.
    pub label: String,
    pub code: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Discovery {
    pub runs: Vec<RunRef>,
    pub rejected: Vec<Rejected>,
    /// `collected` and/or `reference`.
    pub missing_roots: Vec<&'static str>,
}

/// The facts of a copy's note that the ranking uses.
#[derive(Debug, Clone, PartialEq)]
pub struct CopyNote {
    pub node: String,
    pub has_note: bool,
    pub complete: bool,
    pub files: usize,
    pub settled_at: Option<f64>,
}

/// `Greater` when `a` is the better copy: note, complete, more files, later settled, smaller node.
pub fn compare_copies(a: &CopyNote, b: &CopyNote) -> Ordering {
    let _ = (a, b);
    todo!("compare_copies")
}

impl Lake {
    pub fn new(collected: &Path, reference: &Path) -> Lake {
        let _ = (collected, reference);
        todo!("Lake::new")
    }
    /// `dir/collected` and `dir/reference`.
    pub fn in_state_dir(dir: &Path) -> Lake {
        let _ = dir;
        todo!("Lake::in_state_dir")
    }
    pub fn discover(&self) -> Discovery {
        todo!("Lake::discover")
    }
    pub fn copies<'a>(&self, d: &'a Discovery, id: &str) -> Vec<&'a RunRef> {
        let _ = (d, id);
        todo!("Lake::copies")
    }
    pub fn preferred<'a>(&self, d: &'a Discovery, id: &str) -> Option<&'a RunRef> {
        let _ = (d, id);
        todo!("Lake::preferred")
    }
    /// `preferred`, or `E-LAKE-NO-RUN`.
    pub fn preferred_or_absent<'a>(&self, d: &'a Discovery, id: &str) -> Result<&'a RunRef, Absent> {
        let _ = (d, id);
        todo!("Lake::preferred_or_absent")
    }
    /// A run given as `<id>` (preferred copy) or `<node>@<id>`.
    pub fn find_run<'a>(&self, d: &'a Discovery, spec: &str) -> Result<&'a RunRef, Absent> {
        let _ = (d, spec);
        todo!("Lake::find_run")
    }
    /// The ranking facts of one copy, read from its note alone.
    pub fn copy_note(&self, run: &RunRef) -> CopyNote {
        let _ = run;
        todo!("Lake::copy_note")
    }
    /// Completeness without reading anything but the note.
    pub fn completeness(&self, run: &RunRef) -> Result<Completeness, Absent> {
        let _ = run;
        todo!("Lake::completeness")
    }
}
