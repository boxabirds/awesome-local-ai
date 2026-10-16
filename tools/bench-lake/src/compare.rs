//! Comparison of the library with the file system and with the repository's blobs (lakelib.equal.old_reads).
//! The comparison with the repository runs git read-only (`ls-tree`, `cat-file`); the library proper never does.

use crate::layout::Lake;
use serde_json::Value;
use std::path::Path;

pub const DEFAULT_REV: &str = "origin/main";

/// The report: library defects (comparison A) and data differences (comparison B).
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub value: Value,
    pub defects: usize,
    pub differences: usize,
    pub runs_compared: usize,
}

/// `Err(reason)` is "not run": the lake or the repository could not be looked at. It is never a pass.
pub fn compare_git(lake: &Lake, repo: &Path, rev: &str) -> Result<Report, String> {
    let _ = (lake, repo, rev);
    todo!("compare_git")
}
