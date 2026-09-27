//! Story reviews: one row per (story, build) with a verdict and a note, kept as a CSV in the private
//! repo (analysis/story-reviews.csv). Rewritten atomically on every change, so stopping the gallery
//! at any point loses nothing.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const VERDICTS: [&str; 3] = ["pass", "fail", "skip"];
const HEADER: &str = "story,build,verdict,notes,updated_at";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Review {
    pub story: u64,
    /// The run's slug (setup and run), never the blind letter: letters change every session.
    pub build: String,
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
                    verdict: r.get(2).cloned().unwrap_or_default(),
                    notes: r.get(3).cloned().unwrap_or_default(),
                    updated_at: r.get(4).cloned().unwrap_or_default(),
                })
            })
            .collect()
    }

    /// Set one (story, build) row. An empty verdict keeps a note without a verdict yet.
    pub fn set(&self, story: u64, build: &str, verdict: &str, notes: &str, now: &str) -> anyhow::Result<Review> {
        if !verdict.is_empty() && !VERDICTS.contains(&verdict) {
            anyhow::bail!("verdict must be one of {VERDICTS:?}");
        }
        let mut rows: BTreeMap<(u64, String), Review> =
            self.all().into_iter().map(|r| ((r.story, r.build.clone()), r)).collect();
        let review = Review { story, build: build.to_string(), verdict: verdict.to_string(), notes: notes.to_string(), updated_at: now.to_string() };
        rows.insert((story, build.to_string()), review.clone());
        let mut out = String::from(HEADER);
        out.push('\n');
        for r in rows.values() {
            out.push_str(&format!("{},{},{},{},{}\n", r.story, quote(&r.build), quote(&r.verdict), quote(&r.notes), quote(&r.updated_at)));
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
        s.set(2, "a/run-1", "skip", "does \"drag\" mean pan,\nor move?", "t1").unwrap();
        s.set(2, "b/run-1", "fail", "", "t2").unwrap();
        s.set(2, "a/run-1", "pass", "moves, as the PRD says", "t3").unwrap();
        let all = s.all();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0], Review { story: 2, build: "a/run-1".into(), verdict: "pass".into(), notes: "moves, as the PRD says".into(), updated_at: "t3".into() });
        s.set(3, "a/run-1", "", "note first, verdict later", "t4").unwrap();
        assert_eq!(s.all().iter().find(|r| r.story == 3).unwrap().notes, "note first, verdict later");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_note_with_quotes_and_newlines_round_trips() {
        let (s, dir) = store();
        s.set(1, "x", "fail", "line one, \"quoted\"\nline two", "t").unwrap();
        assert_eq!(s.all()[0].notes, "line one, \"quoted\"\nline two");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unknown_verdicts_are_refused() {
        let (s, dir) = store();
        assert!(s.set(1, "x", "maybe", "", "t").is_err());
        let _ = std::fs::remove_dir_all(dir);
    }
}
