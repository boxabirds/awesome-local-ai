//! Discovery of runs, the part rule and the ranking of copies (lakelib.layout.discover).

use crate::absent::{Absent, Item, Reason};
use crate::{read_regular, FileProblem};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::fs;
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
pub const NODE_SEPARATOR: char = '@';

pub const CODE_NOT_A_FOLDER: &str = "E-LAKE-NOT-A-FOLDER";
pub const CODE_STRAY: &str = "E-LAKE-STRAY";
pub const CODE_SHALLOW: &str = "E-LAKE-SHALLOW";
pub const CODE_BAD_PART: &str = "E-LAKE-BAD-PART";
pub const CODE_NO_MARKER: &str = "E-LAKE-NO-MARKER";
pub const CODE_UNREADABLE: &str = "E-LAKE-UNREADABLE";

/// The part rule: 1 to 64 characters of `[A-Za-z0-9._-]`, not only dots.
pub fn is_valid_part(part: &str) -> bool {
    !part.is_empty()
        && part.len() <= MAX_PART_LEN
        && part.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        && !part.bytes().all(|b| b == b'.')
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
        match self {
            Kind::Combination => "combination",
            Kind::Reference => "reference",
        }
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
    pub fn to_value(&self) -> Value {
        json!({"dir": self.label, "id": self.id, "kind": self.kind.as_str(), "node": self.node})
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
    a.has_note
        .cmp(&b.has_note)
        .then(a.complete.cmp(&b.complete))
        .then(a.files.cmp(&b.files))
        .then_with(|| match (a.settled_at, b.settled_at) {
            (Some(x), Some(y)) => x.total_cmp(&y),
            (Some(_), None) => Ordering::Greater,
            (None, Some(_)) => Ordering::Less,
            (None, None) => Ordering::Equal,
        })
        .then_with(|| b.node.as_bytes().cmp(a.node.as_bytes()))
}

/// What an entry of a folder is, without following links.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EntryKind {
    Folder,
    Other,
}

struct Entry {
    /// The name; `None` when it is not valid UTF-8.
    name: Option<String>,
    shown: String,
    kind: EntryKind,
    path: PathBuf,
}

fn list(dir: &Path) -> std::io::Result<Vec<Entry>> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir)? {
        let e = e?;
        let kind = if e.file_type()?.is_dir() { EntryKind::Folder } else { EntryKind::Other };
        let raw = e.file_name();
        out.push(Entry {
            name: raw.to_str().map(String::from),
            shown: raw.to_string_lossy().to_string(),
            kind,
            path: e.path(),
        });
    }
    out.sort_by(|a, b| a.shown.as_bytes().cmp(b.shown.as_bytes()));
    Ok(out)
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path).map(|m| m.file_type().is_file()).unwrap_or(false)
}

/// The walk of one root: which levels exist and how a run is named.
struct Walk<'a> {
    depth: usize,
    combination: bool,
    out: &'a mut Discovery,
}

impl Walk<'_> {
    fn reject(&mut self, path: &Path, label: &str, code: &'static str) {
        self.out.rejected.push(Rejected { path: path.to_path_buf(), label: label.to_string(), code });
    }

    fn name_ok(&self, level: usize, name: &str) -> bool {
        if !is_valid_part(name) {
            return false;
        }
        if self.combination {
            if level == BENCHMARKS_LEVEL {
                return name == BENCHMARKS_DIR;
            }
            if level == ENGINE_CLIENT_LEVEL {
                return name.contains('-');
            }
        }
        true
    }

    /// Walks the entries of `dir`, which are at `level` (1-based).
    fn visit(&mut self, dir: &Path, label: &str, level: usize, trail: &mut Vec<String>, node: Option<&str>, prefix: &str) {
        let entries = match list(dir) {
            Ok(e) => e,
            Err(_) => return self.reject(dir, label, CODE_UNREADABLE),
        };
        if entries.is_empty() {
            let folder_depth = level - 1;
            let is_walk_root = folder_depth == 0;
            if !is_walk_root && folder_depth < self.depth {
                self.reject(dir, label, CODE_SHALLOW);
            }
            return;
        }
        for e in entries {
            let child_label = format!("{label}/{}", e.shown);
            if e.kind != EntryKind::Folder {
                self.reject(&e.path, &child_label, CODE_NOT_A_FOLDER);
                continue;
            }
            let Some(name) = e.name.as_deref().filter(|n| self.name_ok(level, n)) else {
                self.reject(&e.path, &child_label, CODE_BAD_PART);
                continue;
            };
            trail.push(name.to_string());
            if level == self.depth {
                if is_regular_file(&e.path.join(MARKER_COLLECTION)) || is_regular_file(&e.path.join(MARKER_RUN)) {
                    let id = format!("{prefix}{}", trail.join("/"));
                    let (kind, run_label) = match node {
                        Some(n) => (Kind::Combination, format!("{COLLECTED_LABEL}/{n}/{id}")),
                        None => (Kind::Reference, format!("{REFERENCE_LABEL}/{}", trail.join("/"))),
                    };
                    self.out.runs.push(RunRef { kind, node: node.map(String::from), id, dir: e.path.clone(), label: run_label });
                } else {
                    self.reject(&e.path, &child_label, CODE_NO_MARKER);
                }
            } else {
                self.visit(&e.path, &child_label, level + 1, trail, node, prefix);
            }
            trail.pop();
        }
    }
}

impl Lake {
    pub fn new(collected: &Path, reference: &Path) -> Lake {
        Lake { collected: collected.to_path_buf(), reference: reference.to_path_buf() }
    }

    /// `dir/collected` and `dir/reference`.
    pub fn in_state_dir(dir: &Path) -> Lake {
        Lake::new(&dir.join(COLLECTED_LABEL), &dir.join(REFERENCE_LABEL))
    }

    pub fn discover(&self) -> Discovery {
        let mut d = Discovery::default();
        self.walk_collected(&mut d);
        self.walk_reference(&mut d);
        d.runs.sort_by(|a, b| {
            a.id.as_bytes().cmp(b.id.as_bytes()).then_with(|| a.node.as_deref().map(str::as_bytes).cmp(&b.node.as_deref().map(str::as_bytes)))
        });
        d.rejected.sort_by(|a, b| a.label.as_bytes().cmp(b.label.as_bytes()));
        d
    }

    fn walk_collected(&self, d: &mut Discovery) {
        let nodes = match list(&self.collected) {
            Ok(n) => n,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                d.missing_roots.push(COLLECTED_LABEL);
                return;
            }
            Err(_) => {
                d.rejected.push(Rejected { path: self.collected.clone(), label: COLLECTED_LABEL.to_string(), code: CODE_UNREADABLE });
                return;
            }
        };
        for node in nodes {
            let label = format!("{COLLECTED_LABEL}/{}", node.shown);
            if node.kind != EntryKind::Folder {
                d.rejected.push(Rejected { path: node.path, label, code: CODE_NOT_A_FOLDER });
                continue;
            }
            let Some(node_name) = node.name.as_deref().filter(|n| is_valid_part(n)) else {
                d.rejected.push(Rejected { path: node.path, label, code: CODE_BAD_PART });
                continue;
            };
            let inside = match list(&node.path) {
                Ok(i) => i,
                Err(_) => {
                    d.rejected.push(Rejected { path: node.path, label, code: CODE_UNREADABLE });
                    continue;
                }
            };
            for e in inside {
                let child_label = format!("{label}/{}", e.shown);
                if e.name.as_deref() != Some(COMBINATIONS_DIR) {
                    d.rejected.push(Rejected { path: e.path, label: child_label, code: CODE_STRAY });
                } else if e.kind != EntryKind::Folder {
                    d.rejected.push(Rejected { path: e.path, label: child_label, code: CODE_NOT_A_FOLDER });
                } else {
                    let prefix = format!("{COMBINATIONS_DIR}/");
                    let mut walk = Walk { depth: COMBINATION_DEPTH, combination: true, out: d };
                    walk.visit(&e.path, &child_label, 1, &mut Vec::new(), Some(node_name), &prefix);
                }
            }
        }
    }

    fn walk_reference(&self, d: &mut Discovery) {
        match fs::symlink_metadata(&self.reference) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                d.missing_roots.push(REFERENCE_LABEL);
                return;
            }
            _ => {}
        }
        let mut walk = Walk { depth: REFERENCE_DEPTH, combination: false, out: d };
        walk.visit(&self.reference, REFERENCE_LABEL, 1, &mut Vec::new(), None, REFERENCE_ID_PREFIX);
    }

    pub fn copies<'a>(&self, d: &'a Discovery, id: &str) -> Vec<&'a RunRef> {
        d.runs.iter().filter(|r| r.id == id).collect()
    }

    pub fn preferred<'a>(&self, d: &'a Discovery, id: &str) -> Option<&'a RunRef> {
        let mut best: Option<(&RunRef, CopyNote)> = None;
        for run in self.copies(d, id) {
            let note = self.copy_note(run);
            let better = match &best {
                None => true,
                Some((_, b)) => compare_copies(&note, b) == Ordering::Greater,
            };
            if better {
                best = Some((run, note));
            }
        }
        best.map(|(r, _)| r)
    }

    /// `preferred`, or `E-LAKE-NO-RUN`.
    pub fn preferred_or_absent<'a>(&self, d: &'a Discovery, id: &str) -> Result<&'a RunRef, Absent> {
        self.preferred(d, id).ok_or_else(|| Absent::new(id, None, Item::Run, Reason::NoRun))
    }

    /// A run given as `<id>` (preferred copy) or `<node>@<id>`.
    pub fn find_run<'a>(&self, d: &'a Discovery, spec: &str) -> Result<&'a RunRef, Absent> {
        match spec.split_once(NODE_SEPARATOR) {
            None => self.preferred_or_absent(d, spec),
            Some((node, id)) => d
                .runs
                .iter()
                .find(|r| r.id == id && r.node.as_deref() == Some(node))
                .ok_or_else(|| Absent::new(id, Some(node), Item::Run, Reason::NoRun)),
        }
    }

    /// The ranking facts of one copy, read from its note alone.
    pub fn copy_note(&self, run: &RunRef) -> CopyNote {
        let node = run.node.clone().unwrap_or_default();
        let none = CopyNote { node: node.clone(), has_note: false, complete: false, files: 0, settled_at: None };
        let bytes = match read_regular(&run.dir, Path::new(MARKER_COLLECTION)) {
            Ok(b) => b,
            Err(FileProblem::Missing | FileProblem::NotAFile | FileProblem::Unreadable(_)) => return none,
        };
        let Ok(Value::Object(note)) = crate::records::parse_json(&bytes) else { return none };
        CopyNote {
            node,
            has_note: true,
            complete: note.get("complete").and_then(Value::as_bool).unwrap_or(false),
            files: note.get("files").and_then(Value::as_object).map_or(0, |f| f.len()),
            settled_at: note.get("settled_at").and_then(Value::as_f64),
        }
    }
}
