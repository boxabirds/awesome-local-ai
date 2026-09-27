//! Story reviews: one row per (story, build, path) with a verdict and a note, kept as a CSV in the private
//! repo (analysis/story-reviews.csv). Rewritten atomically on every change, so stopping the gallery
//! at any point loses nothing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// A path's verdict is whether the reviewer agrees with its automated result; "skip" defers it.
/// "pass"/"fail" are the earlier build-level verdicts, still read and accepted.
pub const VERDICTS: [&str; 5] = ["agree", "disagree", "skip", "pass", "fail"];
const HEADER: &str = "story,build,path,verdict,notes,updated_at";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Review {
    pub story: u64,
    /// The run's slug (setup and run), never the blind letter: letters change every session.
    pub build: String,
    /// One recorded path (a held-out test's title) through the story, or empty for the build as a whole.
    pub path: String,
    pub verdict: String,
    pub notes: String,
    pub updated_at: String,
}

fn quote(field: &str) -> String {
    if field.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

/// Split one CSV record, honouring quoted fields (with "" escapes and embedded newlines).
fn records(text: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let (mut row, mut field, mut quoted) = (Vec::new(), String::new(), false);
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            ('"', _) => quoted = !quoted,
            (',', false) => row.push(std::mem::take(&mut field)),
            ('\n', false) => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            ('\r', false) => {}
            (c, _) => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

pub struct Store {
    path: PathBuf,
}

impl Store {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn all(&self) -> Vec<Review> {
        let Ok(text) = std::fs::read_to_string(&self.path) else { return Vec::new() };
        records(&text)
            .into_iter()
            .skip(1)
            .filter_map(|r| {
                Some(Review {
                    story: r.first()?.parse().ok()?,
                    build: r.get(1)?.clone(),
                    path: r.get(2).cloned().unwrap_or_default(),
                    verdict: r.get(3).cloned().unwrap_or_default(),
                    notes: r.get(4).cloned().unwrap_or_default(),
                    updated_at: r.get(5).cloned().unwrap_or_default(),
                })
            })
            .collect()
    }

    /// Set one (story, build) row. An empty verdict keeps a note without a verdict yet.
    pub fn set(&self, story: u64, build: &str, path: &str, verdict: &str, notes: &str, now: &str) -> anyhow::Result<Review> {
        if !verdict.is_empty() && !VERDICTS.contains(&verdict) {
            anyhow::bail!("verdict must be one of {VERDICTS:?}");
        }
        let mut rows: BTreeMap<(u64, String, String), Review> =
            self.all().into_iter().map(|r| ((r.story, r.build.clone(), r.path.clone()), r)).collect();
        let review = Review {
            story, build: build.to_string(), path: path.to_string(), verdict: verdict.to_string(),
            notes: notes.to_string(), updated_at: now.to_string(),
        };
        rows.insert((story, build.to_string(), path.to_string()), review.clone());
        let mut out = String::from(HEADER);
        out.push('\n');
        for r in rows.values() {
            out.push_str(&format!("{},{},{},{},{},{}\n", r.story, quote(&r.build), quote(&r.path), quote(&r.verdict), quote(&r.notes), quote(&r.updated_at)));
        }
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("csv.tmp");
        std::fs::write(&tmp, out)?;
        std::fs::rename(&tmp, &self.path)?; // atomic: a crash never leaves half a file
        Ok(review)
    }
}

/// Whether every recorded path of every build has a verdict on `story` (a build with no recorded
/// paths needs one on the build itself). `builds`: each build's slug and its paths' titles.
pub fn story_reviewed(story: u64, builds: &[(String, Vec<String>)], rows: &[Review]) -> bool {
    let judged = |build: &str, path: &str| rows.iter().any(|r| r.story == story && r.build == build && r.path == path && !r.verdict.is_empty());
    builds.iter().all(|(build, paths)| {
        if paths.is_empty() { judged(build, "") } else { paths.iter().all(|p| judged(build, p)) }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!("vidi-gallery-reviews-{}-{}", std::process::id(), rand_suffix()));
        (Store::new(dir.join("analysis/story-reviews.csv")), dir)
    }

    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    }

    #[test]
    fn reviews_are_saved_updated_and_survive_awkward_notes() {
        let (s, dir) = store();
        s.set(2, "a/run-1", "", "skip", "does \"drag\" mean pan,\nor move?", "t1").unwrap();
        s.set(2, "b/run-1", "", "fail", "", "t2").unwrap();
        s.set(2, "a/run-1", "", "pass", "moves, as the PRD says", "t3").unwrap();
        let all = s.all();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], Review { story: 2, build: "a/run-1".into(), path: String::new(), verdict: "pass".into(), notes: "moves, as the PRD says".into(), updated_at: "t3".into() });
        s.set(3, "a/run-1", "", "", "note first, verdict later", "t4").unwrap();
        assert_eq!(s.all().iter().find(|r| r.story == 3).unwrap().notes, "note first, verdict later");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_note_with_quotes_and_newlines_round_trips() {
        let (s, dir) = store();
        s.set(1, "x", "golden path", "fail", "line one, \"quoted\"\nline two", "t").unwrap();
        assert_eq!(s.all()[0].notes, "line one, \"quoted\"\nline two");
        // a path's note and the build's own note are separate rows
        s.set(1, "x", "", "pass", "whole build", "t").unwrap();
        assert_eq!(s.all().len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_path_is_judged_agree_or_disagree_with_its_automated_result() {
        let (s, dir) = store();
        s.set(5, "x", "a made-up path title", "agree", "", "t").unwrap();
        s.set(5, "x", "distinct links", "disagree", "the test passed but two links were equal", "t").unwrap();
        assert_eq!(s.all().iter().map(|r| r.verdict.as_str()).collect::<Vec<_>>(), ["disagree", "agree"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    fn row(story: u64, build: &str, path: &str, verdict: &str) -> Review {
        Review { story, build: build.into(), path: path.into(), verdict: verdict.into(), notes: String::new(), updated_at: String::new() }
    }

    #[test]
    fn a_story_is_reviewed_when_every_path_of_every_build_has_a_verdict() {
        let builds = vec![("a".to_string(), vec!["p1".to_string(), "p2".to_string()]), ("b".to_string(), vec!["p1".to_string()])];
        let mut rows = vec![row(5, "a", "p1", "agree"), row(5, "a", "p2", "skip")];
        assert!(!story_reviewed(5, &builds, &rows), "build b's path has no verdict");
        rows.push(row(5, "b", "p1", ""));
        assert!(!story_reviewed(5, &builds, &rows), "a note alone is not a verdict");
        rows.push(row(5, "b", "p1", "disagree"));
        assert!(story_reviewed(5, &builds, &rows));
        assert!(!story_reviewed(6, &builds, &rows), "verdicts on another story don't count");
    }

    #[test]
    fn a_build_with_no_recorded_paths_needs_a_verdict_on_the_build_itself() {
        let builds = vec![("a".to_string(), vec![])];
        assert!(!story_reviewed(5, &builds, &[]));
        assert!(story_reviewed(5, &builds, &[row(5, "a", "", "skip")]));
    }

    #[test]
    fn unknown_verdicts_are_refused() {
        let (s, dir) = store();
        assert!(s.set(1, "x", "", "maybe", "", "t").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
