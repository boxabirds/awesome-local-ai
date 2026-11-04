//! Every run's result documents in one answer (story 23, readers.benchmarker): what a reader of results (the
//! benchmarker) shows, read from each run's preferred copy, with the operator's decisions about it, and without the
//! runs those decisions archive.

use crate::annotations::{RunAnnotations, State};
use crate::bundle::BUNDLE_FILE;
use crate::layout::{Discovery, Lake, RunRef};
use crate::records::{story_dir, RESCORE_DIR, STORIES_DIR};
use crate::{read_regular, FileProblem};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// The run's own result documents, relative to the run folder.
pub const RUN_DOCUMENTS: [&str; 6] = [
    "run.json",
    "run-status.json",
    "metrics.json",
    "finalize.json",
    "interventions.md",
    "summary.md",
];
/// A re-score's documents, relative to `rescore/<version>`.
pub const RESCORE_DOCUMENTS: [&str; 2] = ["rescore.json", "per-story.md"];
/// A re-scored story's counts, relative to `rescore/<version>/stories/<story>`: the public summary, and the full
/// result in records from before 30 Sep 2026.
pub const RESCORE_STORY_DOCUMENTS: [&str; 2] = ["accept-summary.json", "accept.json"];

/// One run's result documents.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunResults {
    pub run: RunRef,
    /// Path relative to the run folder -> text, as written (a JSON document is not parsed).
    pub files: BTreeMap<String, String>,
    /// Documents that are there but cannot be read as text: refused, not a regular file, or not UTF-8.
    pub unreadable: Vec<String>,
    /// `workspace.bundle` is a regular file in the run folder.
    pub bundle: bool,
    /// The operator's decisions in force about the run.
    pub annotations: RunAnnotations,
}

impl RunResults {
    pub fn to_value(&self) -> Value {
        let mut v = self.run.to_value();
        v["files"] = json!(self.files);
        v["unreadable"] = json!(self.unreadable);
        v["bundle"] = json!(self.bundle);
        v["annotations"] = self.annotations.to_value();
        v
    }
}

impl Lake {
    /// The preferred copy of every run id, ordered by id, with the decisions in force about it; without the runs
    /// the decisions archive.
    pub fn results(&self, d: &Discovery, decisions: &State) -> Vec<RunResults> {
        let ids: BTreeSet<&str> = d.runs.iter().map(|r| r.id.as_str()).collect();
        ids.into_iter()
            .filter(|id| decisions.archived(id).is_none())
            .filter_map(|id| self.preferred(d, id))
            .map(|run| {
                let mut r = self.run_results(run);
                r.annotations = decisions.of(&run.id);
                r
            })
            .collect()
    }

    /// One run's result documents.
    pub fn run_results(&self, run: &RunRef) -> RunResults {
        let mut out = RunResults {
            run: run.clone(),
            files: BTreeMap::new(),
            unreadable: Vec::new(),
            bundle: false,
            annotations: RunAnnotations::default(),
        };
        let mut names: Vec<String> = RUN_DOCUMENTS.iter().map(|f| f.to_string()).collect();
        for version in self.rescore_versions(run).unwrap_or_default() {
            let base = format!("{RESCORE_DIR}/{version}");
            names.extend(RESCORE_DOCUMENTS.iter().map(|f| format!("{base}/{f}")));
            for story in story_folders(&run.dir.join(&base).join(STORIES_DIR)) {
                names.extend(
                    RESCORE_STORY_DOCUMENTS
                        .iter()
                        .map(|f| format!("{base}/{STORIES_DIR}/{story}/{f}")),
                );
            }
        }
        for name in names {
            match read_regular(&run.dir, Path::new(&name)) {
                Ok(bytes) => match String::from_utf8(bytes) {
                    Ok(text) => {
                        out.files.insert(name, text);
                    }
                    Err(_) => out.unreadable.push(name),
                },
                Err(FileProblem::Missing) => {}
                Err(FileProblem::NotAFile | FileProblem::Unreadable(_)) => out.unreadable.push(name),
            }
        }
        out.unreadable.sort();
        out.bundle = read_regular_exists(&run.dir, BUNDLE_FILE);
        out
    }
}

/// The story folders of a re-score, as `story_dir` spells them, in order; none when the folder cannot be listed.
fn story_folders(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<String> = entries
        .filter_map(Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|name| {
            name.bytes().all(|b| b.is_ascii_digit())
                && name.parse::<i64>().ok().and_then(|n| story_dir(n).ok()).as_deref() == Some(name)
        })
        .collect();
    out.sort();
    out
}

fn read_regular_exists(dir: &Path, name: &str) -> bool {
    std::fs::symlink_metadata(dir.join(name)).is_ok_and(|m| m.file_type().is_file())
}
