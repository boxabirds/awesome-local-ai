//! Comparison of the library with the file system and with the repository's blobs (lakelib.equal.old_reads).
//! The comparison with the repository runs git read-only (`ls-tree`, `cat-file`); the library proper never does.
//!
//! Comparison A: for every record and log of a run's preferred copy, the library's bytes equal a direct read of the
//! file. A difference is a defect of the library. Comparison B: for every record file the repository or the lake has
//! for a run the repository tracks, the bytes are equal. Logs are not in B (the repository does not keep them).

use crate::layout::{Lake, RunRef};
use crate::logs::{COMPACT_LOG, RAW_LOG};
use crate::records::Record;
use crate::{bundle::git_command, Completeness};
use flate2::read::MultiGzDecoder;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs;
use std::io::Read;
use std::path::Path;

pub const DEFAULT_REV: &str = "origin/main";
const KIND_DIFFERS: &str = "differs";
const KIND_LAKE_ABSENT: &str = "lake-absent";
const KIND_REPOSITORY_ABSENT: &str = "repository-absent";

/// The report: library defects (comparison A) and data differences (comparison B).
#[derive(Debug, Clone, PartialEq)]
pub struct Report {
    pub value: Value,
    pub defects: usize,
    pub differences: usize,
    pub runs_compared: usize,
}

fn git_output(repo: &Path, args: &[&str]) -> Result<Vec<u8>, String> {
    let ceiling = repo.canonicalize().ok().and_then(|p| p.parent().map(|p| p.to_path_buf()));
    let mut cmd = git_command();
    if let Some(c) = ceiling {
        cmd.env("GIT_CEILING_DIRECTORIES", c);
    }
    let out = cmd.arg("-C").arg(repo).args(args).output().map_err(|e| format!("git could not be started: {e}"))?;
    if out.status.success() {
        Ok(out.stdout)
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn files_below(dir: &Path, base: &Path, out: &mut BTreeSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        match e.file_type() {
            Ok(t) if t.is_dir() => files_below(&p, base, out),
            Ok(t) if t.is_file() => {
                if let Ok(rel) = p.strip_prefix(base) {
                    out.insert(rel.to_string_lossy().to_string());
                }
            }
            _ => {}
        }
    }
}

fn stream_hash(mut r: impl Read) -> Option<String> {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 64 * 1024];
    loop {
        let n = r.read(&mut buf).ok()?;
        if n == 0 {
            return Some(crate::hex(&h.finalize()));
        }
        h.update(&buf[..n]);
    }
}

/// Comparison A for the logs of one run; returns the defects found.
fn check_logs(lake: &Lake, run: &RunRef, files: &BTreeSet<String>, defects: &mut Vec<Value>) {
    for rel in files {
        let Some(story) = rel.strip_prefix("stories/").and_then(|r| r.split('/').next()).and_then(|s| s.parse::<i64>().ok()) else { continue };
        let is_raw = rel.ends_with(&format!("/{RAW_LOG}"));
        let is_compact = rel.ends_with(&format!("/{COMPACT_LOG}"));
        if !is_raw && !is_compact {
            continue;
        }
        let has_raw = files.contains(&format!("stories/{story:02}/{RAW_LOG}"));
        if is_compact && has_raw {
            continue; // the raw log is the one the library returns
        }
        let direct = fs::File::open(run.dir.join(rel)).ok().and_then(|f| if is_raw { stream_hash(f) } else { stream_hash(MultiGzDecoder::new(f)) });
        let library = lake.log(run, story).ok().and_then(|l| l.digest().ok()).map(|d| d.sha256);
        if direct != library {
            defects.push(json!({"detail": "log differs from a direct read", "file": rel, "run": run.id}));
        }
    }
}

/// `Err(reason)` is "not run": the lake or the repository could not be looked at. It is never a pass.
pub fn compare_git(lake: &Lake, repo: &Path, rev: &str) -> Result<Report, String> {
    let d = lake.discover();
    if !d.missing_roots.is_empty() {
        return Err(format!("the lake has no {} folder", d.missing_roots.join(" and no ")));
    }
    if !repo.is_dir() {
        return Err(format!("{} is not a folder", repo.display()));
    }
    let spec = format!("{rev}^{{commit}}");
    let sha = git_output(repo, &["rev-parse", "--verify", "--quiet", &spec]).map_err(|m| {
        format!("{} cannot be looked at as a repository with revision {rev}{}", repo.display(), if m.is_empty() { String::new() } else { format!(": {m}") })
    })?;
    let sha = String::from_utf8_lossy(&sha).trim().to_string();
    if sha.is_empty() {
        return Err(format!("revision {rev} not found in {}", repo.display()));
    }
    let mut ids: Vec<&str> = d.runs.iter().map(|r| r.id.as_str()).collect();
    ids.dedup();
    let (mut defects, mut differences, mut not_compared) = (Vec::new(), Vec::new(), Vec::new());
    let mut runs_compared = 0;
    for id in ids {
        let run = lake.preferred(&d, id).ok_or_else(|| format!("no preferred copy of {id}"))?;
        let listing = git_output(repo, &["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", &sha, "--", id])?;
        let prefix = format!("{id}/");
        let repo_files: BTreeSet<String> = String::from_utf8_lossy(&listing)
            .split('\0')
            .filter_map(|p| p.strip_prefix(&prefix))
            .filter(|rel| Record::from_relative_path(rel).is_some())
            .map(String::from)
            .collect();
        let mut lake_files = BTreeSet::new();
        files_below(&run.dir, &run.dir, &mut lake_files);
        if String::from_utf8_lossy(&listing).split('\0').all(|p| p.is_empty()) {
            not_compared.push(id.to_string());
            continue;
        }
        runs_compared += 1;
        check_logs(lake, run, &lake_files, &mut defects);
        let lake_complete = match lake.completeness(run) {
            Ok(Completeness::Complete { .. }) => json!(true),
            Ok(Completeness::Incomplete { .. }) => json!(false),
            _ => Value::Null,
        };
        let mut union: BTreeSet<&String> = repo_files.iter().collect();
        let lake_records: BTreeSet<String> = lake_files.iter().filter(|f| Record::from_relative_path(f).is_some()).cloned().collect();
        union.extend(lake_records.iter());
        for rel in union {
            let record = Record::from_relative_path(rel).expect("filtered above");
            let library = lake.bytes(run, &record);
            let direct = fs::symlink_metadata(run.dir.join(rel)).ok().filter(|m| m.is_file()).and_then(|_| fs::read(run.dir.join(rel)).ok());
            match (&library, &direct) {
                (Ok(l), Some(d)) if l != d => defects.push(json!({"detail": "record differs from a direct read", "file": rel, "run": id})),
                (Err(_), Some(_)) => defects.push(json!({"detail": "a readable regular file that the library cannot read", "file": rel, "run": id})),
                _ => {}
            }
            let blob = if repo_files.contains(rel) { git_output(repo, &["cat-file", "blob", &format!("{sha}:{id}/{rel}")]).ok() } else { None };
            let kind = match (&library, &blob) {
                (Ok(l), Some(b)) if l == b => None,
                (Ok(_), Some(_)) => Some(KIND_DIFFERS),
                (Ok(_), None) => Some(KIND_REPOSITORY_ABSENT),
                (Err(_), Some(_)) => Some(KIND_LAKE_ABSENT),
                (Err(_), None) => None,
            };
            if let Some(kind) = kind {
                differences.push(json!({
                    "file": rel, "kind": kind, "lake_complete": lake_complete, "node": run.node, "run": id
                }));
            }
        }
    }
    if runs_compared == 0 {
        return Err("no run of the lake is tracked in the repository: nothing was compared".to_string());
    }
    let value = json!({
        "defects": defects, "differences": differences, "not_compared": not_compared,
        "rev": rev, "runs_compared": runs_compared
    });
    Ok(Report { defects: defects.len(), differences: differences.len(), runs_compared, value })
}
