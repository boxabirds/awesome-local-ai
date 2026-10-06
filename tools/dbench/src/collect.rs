//! What a node lets the host collect from a run directory, and how it names it.
//!
//! The host pulls the files that git does not carry (the full agent transcript, the model server's
//! log, the live progress file, the egress log) with `GET /v1/runs/files` and `/v1/runs/file`
//! (server.rs). This module is the allow-list behind them: a request names a file, the name is
//! matched against the table here, and the path is built from the table's own literals. A request
//! never contributes a path segment longer than a story number, so a path outside the run
//! directory (or the egress directory) cannot be asked for.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::ids::{valid_id, valid_run_dir};
use crate::progress::{self, BENCHMARKS_DIR, COMBINATIONS_DIR, COMBINATION_CONFIG, INSTALL_ENV};

/// Most bytes one `/file` response carries; the client loops until `eof`.
pub const COLLECT_CHUNK_BYTES: u64 = 4 * 1024 * 1024;
/// How many bytes before `from` the client proves it holds (the prefix check), at most.
pub const PREFIX_CHECK_BYTES: u64 = 4096;
/// A story directory is `stories/NN`; the harness numbers them with up to this many digits.
pub const MAX_STORY_DIGITS: usize = 3;
/// How deep under `combinations/` a combination directory (one with `config.sh`) may sit.
const MAX_COMBINATION_DEPTH: usize = 8;
/// A run directory is one with this file, written by run.sh at every start.
pub const RUN_MARKER: &str = "run.json";
pub const RUN_STATUS_FILE: &str = "run-status.json";
/// Written by the harness once the agent's work directory is made; its basename is the egress log's name.
pub const WORK_DIR_FILE: &str = "work_dir.txt";
pub const STORIES_DIR: &str = "stories";
pub const EVENTS_FILE: &str = "agent-events.jsonl";
pub const CONDITIONS_FILE: &str = "conditions.jsonl";
pub const SERVER_LOG: &str = "server.log";
pub const PROXY_LOG: &str = "proxy.log";
pub const EGRESS_DIR: &str = "egress";
/// The virtual name under which the run's egress log is served.
pub const EGRESS_NAME: &str = "egress.jsonl";
/// A run's published records: tracked in git, so the lake is their only other copy before the push lands.
pub const METRICS_FILE: &str = "metrics.json";
pub const RUN_FILE: &str = "run.json";
pub const INTERVENTIONS_FILE: &str = "interventions.md";
pub const ACCEPT_SUMMARY_FILE: &str = "accept-summary.json";
pub const GATE_FILE: &str = "gate.json";
pub const BASE_COMMIT_FILE: &str = "base-commit";
pub const BENCH_HOME_ENV: &str = "VIDI_BENCH_HOME";
pub const DEFAULT_BENCH_HOME: &str = ".vidi-bench";

pub const HDR_FROM: &str = "x-dbench-from";
pub const HDR_SIZE: &str = "x-dbench-size";
pub const HDR_MTIME: &str = "x-dbench-mtime";
pub const HDR_EOF: &str = "x-dbench-eof";

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// How a file grows: appended to (served by byte range) or rewritten whole (served whole).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Append,
    Whole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Source {
    RunDir,
    Egress,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pattern {
    Fixed(&'static str),
    /// `stories/<digits>/<file>`
    Story(&'static str),
}

#[derive(Debug, Clone, Copy)]
struct Collectable {
    pattern: Pattern,
    kind: FileKind,
    source: Source,
}

/// The whole allow-list. Nothing outside it is ever served.
const COLLECTABLE: [Collectable; 13] = [
    Collectable {
        pattern: Pattern::Story(EVENTS_FILE),
        kind: FileKind::Append,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Story(CONDITIONS_FILE),
        kind: FileKind::Append,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(SERVER_LOG),
        kind: FileKind::Append,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(PROXY_LOG),
        kind: FileKind::Append,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(progress::PROGRESS_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(EGRESS_NAME),
        kind: FileKind::Append,
        source: Source::Egress,
    },
    // The run's published records. These are tracked in git, unlike everything above, so until the harness's push
    // lands they exist only in the machine's checkout -- one destructive git command or one dead disk from being
    // gone, while the raw data describing them sits safe here. Taking them makes the lake a complete second copy.
    Collectable {
        pattern: Pattern::Fixed(METRICS_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(RUN_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(RUN_STATUS_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Fixed(INTERVENTIONS_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Story(ACCEPT_SUMMARY_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Story(GATE_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
    Collectable {
        pattern: Pattern::Story(BASE_COMMIT_FILE),
        kind: FileKind::Whole,
        source: Source::RunDir,
    },
];

/// A collectable file, named: only `parse_name` makes one, so holding one proves the name was allowed.
#[derive(Debug, Clone)]
pub struct FileName {
    entry: Collectable,
    story: Option<String>,
}

impl FileName {
    pub fn kind(&self) -> FileKind {
        self.entry.kind
    }

    /// The name as the manifest lists it.
    pub fn name(&self) -> String {
        match (self.entry.pattern, &self.story) {
            (Pattern::Fixed(f), _) => f.to_string(),
            (Pattern::Story(f), Some(n)) => format!("{STORIES_DIR}/{n}/{f}"),
            (Pattern::Story(f), None) => format!("{STORIES_DIR}/?/{f}"),
        }
    }
}

fn story_number(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_STORY_DIGITS && s.bytes().all(|b| b.is_ascii_digit())
}

/// The allow-list entry a name means, or None for anything else.
pub fn parse_name(name: &str) -> Option<FileName> {
    for entry in COLLECTABLE {
        match entry.pattern {
            Pattern::Fixed(f) if f == name => return Some(FileName { entry, story: None }),
            Pattern::Fixed(_) => {}
            Pattern::Story(f) => {
                let mut parts = name.split('/');
                if let (Some(STORIES_DIR), Some(n), Some(file), None) =
                    (parts.next(), parts.next(), parts.next(), parts.next())
                {
                    if file == f && story_number(n) {
                        return Some(FileName {
                            entry,
                            story: Some(n.to_string()),
                        });
                    }
                }
            }
        }
    }
    None
}

/// `<bench_home>/egress/<basename of work_dir.txt>.jsonl`, or None when the run has no work dir
/// recorded (runs before 1 Oct 2026) or its basename isn't a plain id.
pub fn egress_path(run_dir: &Path, bench_home: &Path) -> Option<PathBuf> {
    let work = std::fs::read_to_string(run_dir.join(WORK_DIR_FILE)).ok()?;
    let id = Path::new(work.trim()).file_name()?.to_str()?.to_string();
    if !valid_id(&id) {
        return None;
    }
    Some(bench_home.join(EGRESS_DIR).join(format!("{id}.jsonl")))
}

/// Where a named file is on this machine. Built from the table's literals and the story number only.
pub fn resolve(run_dir: &Path, bench_home: &Path, name: &FileName) -> Option<PathBuf> {
    match (name.entry.source, name.entry.pattern, &name.story) {
        (Source::Egress, _, _) => egress_path(run_dir, bench_home),
        (Source::RunDir, Pattern::Fixed(f), _) => Some(run_dir.join(f)),
        (Source::RunDir, Pattern::Story(f), Some(n)) => {
            Some(run_dir.join(STORIES_DIR).join(n).join(f))
        }
        (Source::RunDir, Pattern::Story(_), None) => None,
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct FileEntry {
    pub name: String,
    pub kind: FileKind,
    pub size: u64,
    /// Modification time, seconds since the epoch.
    pub mtime: f64,
}

/// `run-status.json`'s state and time (record_event.py); anything else in it is left alone.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
pub struct RunStatus {
    pub state: String,
    #[serde(default)]
    pub at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct Manifest {
    /// The run directory, relative to the repo.
    pub run: String,
    pub job: Option<String>,
    pub run_status: Option<RunStatus>,
    pub job_state: Option<String>,
    pub files: Vec<FileEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct RunListing {
    pub run: String,
    pub job: Option<String>,
    pub run_status: Option<RunStatus>,
    pub job_state: Option<String>,
}

/// What a `/file` response says about the bytes it carries (its headers).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChunkMeta {
    pub from: u64,
    pub size: u64,
    pub mtime: f64,
    pub eof: bool,
}

/// Modification time in seconds, to the millisecond: the same text the `/file` headers carry, so a
/// manifest's mtime and a chunk's compare equal.
pub fn mtime_secs(m: &std::fs::Metadata) -> f64 {
    let secs = m
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0);
    format!("{secs:.3}").parse().unwrap_or(secs)
}

fn entry_for(path: &Path, name: String, kind: FileKind) -> Option<FileEntry> {
    let m = std::fs::metadata(path).ok()?;
    if !m.is_file() {
        return None;
    }
    Some(FileEntry {
        name,
        kind,
        size: m.len(),
        mtime: mtime_secs(&m),
    })
}

/// Every allow-listed file that exists for this run, with its size and mtime (from `stat` only;
/// no file is opened). Story files are listed for every all-digit story directory.
pub fn manifest(run_dir: &Path, bench_home: &Path) -> Vec<FileEntry> {
    let mut stories: Vec<String> = std::fs::read_dir(run_dir.join(STORIES_DIR))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .filter(|n| story_number(n))
                .collect()
        })
        .unwrap_or_default();
    stories.sort();
    let mut out = Vec::new();
    for entry in COLLECTABLE {
        match entry.pattern {
            Pattern::Story(_) => {
                for n in &stories {
                    let name = FileName {
                        entry,
                        story: Some(n.clone()),
                    };
                    if let Some(p) = resolve(run_dir, bench_home, &name) {
                        out.extend(entry_for(&p, name.name(), entry.kind));
                    }
                }
            }
            Pattern::Fixed(_) => {
                let name = FileName { entry, story: None };
                if let Some(p) = resolve(run_dir, bench_home, &name) {
                    out.extend(entry_for(&p, name.name(), entry.kind));
                }
            }
        }
    }
    out
}

/// `run-status.json`, read leniently: None when missing or not an object with a string `state`.
pub fn run_status(run_dir: &Path) -> Option<RunStatus> {
    let bytes = std::fs::read(run_dir.join(RUN_STATUS_FILE)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The absolute run directory a repo-relative path names, if it is a valid path and a run dir.
pub fn is_run_dir(repo: &Path, rel: &str) -> Option<PathBuf> {
    if !valid_run_dir(rel) {
        return None;
    }
    let dir = repo.join(rel);
    dir.join(RUN_MARKER).is_file().then_some(dir)
}

fn rel_of(repo: &Path, dir: &Path) -> Option<String> {
    let rel = dir.strip_prefix(repo).ok()?;
    let s = rel.to_str()?.to_string();
    valid_run_dir(&s).then_some(s)
}

fn runs_under(repo: &Path, benchmarks: &Path, out: &mut Vec<String>) {
    let Ok(packs) = std::fs::read_dir(benchmarks) else {
        return;
    };
    for pack in packs.filter_map(|e| e.ok()) {
        let Ok(runs) = std::fs::read_dir(pack.path()) else {
            continue;
        };
        for run in runs.filter_map(|e| e.ok()) {
            if run.path().join(RUN_MARKER).is_file() {
                out.extend(rel_of(repo, &run.path()));
            }
        }
    }
}

fn walk_combinations(repo: &Path, dir: &Path, depth: usize, out: &mut Vec<String>) {
    if dir.join(COMBINATION_CONFIG).is_file() {
        runs_under(repo, &dir.join(BENCHMARKS_DIR), out);
        return;
    }
    if depth >= MAX_COMBINATION_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.filter_map(|e| e.ok()) {
        if e.file_type().is_ok_and(|t| t.is_dir()) {
            walk_combinations(repo, &e.path(), depth + 1, out);
        }
    }
}

/// Every run directory on this machine, relative to the repo: under each combination (a directory
/// under `combinations/` with `config.sh`) its `benchmarks/<pack>/<run>/`, and for each install
/// with a `RUN_BASE` (a reference stack) `<RUN_BASE>/<run>/`. A run dir's own contents (the
/// workspace, node_modules) are never walked.
pub fn list_runs(repo: &Path, share_dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    walk_combinations(repo, &repo.join(COMBINATIONS_DIR), 0, &mut out);
    if let Ok(installs) = std::fs::read_dir(share_dir) {
        for e in installs.filter_map(|e| e.ok()) {
            let Ok(text) = std::fs::read_to_string(e.path().join(INSTALL_ENV)) else {
                continue;
            };
            let env = progress::parse_env(&text);
            let Some(base) = env
                .get("RUN_BASE")
                .filter(|b| !b.is_empty() && valid_run_dir(b))
            else {
                continue;
            };
            let Ok(runs) = std::fs::read_dir(repo.join(base)) else {
                continue;
            };
            for run in runs.filter_map(|e| e.ok()) {
                if run.path().join(RUN_MARKER).is_file() {
                    out.extend(rel_of(repo, &run.path()));
                }
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// FNV-1a, 64-bit: the prefix check's hash. Small, dependency-free, and not a security measure
/// (it tells a client its copy has diverged; it doesn't authenticate anything).
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(FNV_OFFSET, |h, b| {
        (h ^ u64::from(*b)).wrapping_mul(FNV_PRIME)
    })
}

/// The byte window `[start, from)` a client proves it holds before reading from `from`.
pub fn check_window(from: u64) -> (u64, u64) {
    (from.saturating_sub(PREFIX_CHECK_BYTES), from)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dbench-collect-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn only_allow_listed_names_parse() {
        for ok in [
            "server.log",
            "proxy.log",
            "progress.json",
            "egress.jsonl",
            "stories/03/agent-events.jsonl",
            "stories/123/agent-events.jsonl",
            "stories/7/conditions.jsonl",
        ] {
            let n = parse_name(ok).unwrap_or_else(|| panic!("{ok}"));
            assert_eq!(n.name(), ok);
        }
        for bad in [
            "",
            "../server.log",
            "/server.log",
            "server.log/",
            "stories/../agent-events.jsonl",
            "stories/03/accept.json",
            "stories/03/../../server.log",
            "stories/3x/agent-events.jsonl",
            "stories//agent-events.jsonl",
            "stories/1234/agent-events.jsonl",
            "stories/03/agent-events.jsonl/x",
            "work_dir.txt",
            "SERVER.LOG",
        ] {
            assert!(parse_name(bad).is_none(), "{bad:?}");
        }
        // The records are allow-listed too, and whole-file: a half-written score is no score.
        for name in ["metrics.json", "run.json", "run-status.json", "stories/01/accept-summary.json"] {
            assert_eq!(parse_name(name).unwrap().kind(), FileKind::Whole, "{name}");
        }
        assert_eq!(parse_name("progress.json").unwrap().kind(), FileKind::Whole);
        assert_eq!(parse_name("server.log").unwrap().kind(), FileKind::Append);
    }

    #[test]
    fn every_accepted_name_resolves_under_the_run_dir_or_the_egress_dir() {
        let root = temp_dir("resolve");
        let run_dir = root.join("repo/combinations/a/b/benchmarks/p/r1");
        let bench_home = root.join("bench");
        std::fs::create_dir_all(&run_dir).unwrap();
        std::fs::write(run_dir.join(WORK_DIR_FILE), "/home/x/.w/abc123/workspace\n").unwrap();
        for name in [
            "server.log",
            "proxy.log",
            "progress.json",
            "stories/02/agent-events.jsonl",
            "stories/02/conditions.jsonl",
        ] {
            let p = resolve(&run_dir, &bench_home, &parse_name(name).unwrap()).unwrap();
            assert!(p.starts_with(&run_dir), "{name}: {}", p.display());
            assert!(p
                .strip_prefix(&run_dir)
                .unwrap()
                .components()
                .all(|c| matches!(c, std::path::Component::Normal(_))));
        }
        // work_dir.txt names the agent's working copy; the egress log takes its basename.
        let p = resolve(&run_dir, &bench_home, &parse_name(EGRESS_NAME).unwrap()).unwrap();
        assert_eq!(p, bench_home.join(EGRESS_DIR).join("workspace.jsonl"));
        // A basename that isn't a plain id gives nothing rather than a path.
        std::fs::write(run_dir.join(WORK_DIR_FILE), "/home/x/.w/..\n").unwrap();
        assert!(resolve(&run_dir, &bench_home, &parse_name(EGRESS_NAME).unwrap()).is_none());
        std::fs::remove_file(run_dir.join(WORK_DIR_FILE)).unwrap();
        assert!(resolve(&run_dir, &bench_home, &parse_name(EGRESS_NAME).unwrap()).is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// A run's published records -- its scores -- lived only in the machine's git checkout between the harness
    /// committing them and the push landing, so a destructive git command or a dead disk lost them while the raw
    /// data they describe sat safe in the lake. The lake takes them too now.
    #[test]
    fn the_lake_takes_a_runs_records_as_well_as_its_logs_so_scores_are_never_single_copy() {
        let root = temp_dir("manifest-records");
        let run_dir = root.join("run");
        let bench_home = root.join("bench");
        std::fs::create_dir_all(run_dir.join("stories/01")).unwrap();
        std::fs::create_dir_all(bench_home.join(EGRESS_DIR)).unwrap();
        for (name, body) in [
            ("metrics.json", "{}"),
            ("run.json", "{}"),
            (RUN_STATUS_FILE, "{}"),
            ("interventions.md", "-"),
        ] {
            std::fs::write(run_dir.join(name), body).unwrap();
        }
        for (name, body) in [
            ("accept-summary.json", "{}"),
            ("gate.json", "{}"),
            ("base-commit", "abc"),
        ] {
            std::fs::write(run_dir.join("stories/01").join(name), body).unwrap();
        }
        let got: Vec<String> = manifest(&run_dir, &bench_home).iter().map(|f| f.name.clone()).collect();
        for want in [
            "metrics.json",
            "run.json",
            "run-status.json",
            "interventions.md",
            "stories/01/accept-summary.json",
            "stories/01/gate.json",
            "stories/01/base-commit",
        ] {
            assert!(got.iter().any(|g| g == want), "{want} is not offered: {got:?}");
        }
    }

    #[test]
    fn manifest_lists_existing_files_with_size_and_mtime_and_the_egress_log_from_work_dir_txt() {
        let root = temp_dir("manifest");
        let run_dir = root.join("run");
        let bench_home = root.join("bench");
        std::fs::create_dir_all(run_dir.join("stories/01")).unwrap();
        std::fs::create_dir_all(run_dir.join("stories/02")).unwrap();
        std::fs::create_dir_all(run_dir.join("stories/notastory")).unwrap();
        std::fs::create_dir_all(bench_home.join(EGRESS_DIR)).unwrap();
        std::fs::write(run_dir.join("stories/01/agent-events.jsonl"), "abc\n").unwrap();
        std::fs::write(run_dir.join("stories/02/agent-events.jsonl"), "").unwrap();
        std::fs::write(run_dir.join("stories/notastory/agent-events.jsonl"), "x").unwrap();
        std::fs::write(run_dir.join(SERVER_LOG), "0123456789").unwrap();
        std::fs::write(run_dir.join("progress.json"), "{}").unwrap();
        std::fs::write(run_dir.join("metrics.json"), "{}").unwrap();
        assert_eq!(
            manifest(&run_dir, &bench_home)
                .iter()
                .map(|f| (f.name.as_str(), f.size))
                .collect::<Vec<_>>(),
            [
                ("stories/01/agent-events.jsonl", 4),
                ("stories/02/agent-events.jsonl", 0),
                ("server.log", 10),
                ("progress.json", 2),
                ("metrics.json", 2),
            ]
        );
        let m = manifest(&run_dir, &bench_home);
        assert!(m.iter().all(|f| f.mtime > 0.0));
        assert_eq!(m[2].kind, FileKind::Append);
        assert_eq!(m[3].kind, FileKind::Whole);
        // The egress log appears once work_dir.txt names it and the log exists.
        std::fs::write(run_dir.join(WORK_DIR_FILE), "/w/run-7\n").unwrap();
        assert!(!manifest(&run_dir, &bench_home)
            .iter()
            .any(|f| f.name == EGRESS_NAME));
        std::fs::write(bench_home.join(EGRESS_DIR).join("run-7.jsonl"), "{}\n").unwrap();
        let m = manifest(&run_dir, &bench_home);
        assert_eq!(
            m.iter().find(|f| f.name == EGRESS_NAME).map(|f| (f.name.as_str(), f.size)),
            Some((EGRESS_NAME, 3))
        );
        // Nothing under stories/ is listed when it isn't a directory of all-digit names.
        assert!(!m.iter().any(|f| f.name.contains("notastory")));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn run_listing_finds_combination_runs_and_run_base_runs_and_skips_workspaces() {
        let root = temp_dir("runs");
        let repo = root.join("repo");
        let share = root.join("share");
        let comb = repo.join("combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi");
        std::fs::create_dir_all(&comb).unwrap();
        std::fs::write(comb.join(COMBINATION_CONFIG), "INSTALL_ID=\"x\"\n").unwrap();
        for run in ["v2-r1", "v2-r2"] {
            let d = comb.join("benchmarks/vidi").join(run);
            std::fs::create_dir_all(d.join("workspace/node_modules/deep")).unwrap();
            std::fs::write(d.join(RUN_MARKER), "{}").unwrap();
            // A nested run.json inside the workspace must not be taken for a run.
            std::fs::write(d.join("workspace/node_modules/deep").join(RUN_MARKER), "{}").unwrap();
        }
        // A run dir without the marker (a stray directory) is not a run.
        std::fs::create_dir_all(comb.join("benchmarks/vidi/stray")).unwrap();
        // A reference stack filed under RUN_BASE.
        std::fs::create_dir_all(share.join("opus/")).unwrap();
        std::fs::write(
            share.join("opus").join(INSTALL_ENV),
            "INSTALL_ID=\"opus\"\nRUN_BASE=\"benchmarks/reference/vidi/opus-5.5\"\n",
        )
        .unwrap();
        let base = repo.join("benchmarks/reference/vidi/opus-5.5/run-3");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::write(base.join(RUN_MARKER), "{}").unwrap();
        // An install with a RUN_BASE that isn't a valid relative path is ignored.
        std::fs::create_dir_all(share.join("bad")).unwrap();
        std::fs::write(share.join("bad").join(INSTALL_ENV), "RUN_BASE=\"../etc\"\n").unwrap();
        assert_eq!(
            list_runs(&repo, &share),
            [
                "benchmarks/reference/vidi/opus-5.5/run-3",
                "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1",
                "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r2",
            ]
        );
        assert!(is_run_dir(
            &repo,
            "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1"
        )
        .is_some());
        assert!(is_run_dir(
            &repo,
            "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/stray"
        )
        .is_none());
        assert!(is_run_dir(&repo, "../etc").is_none());
        assert!(is_run_dir(&repo, "/etc").is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn run_status_is_lenient() {
        let root = temp_dir("status");
        assert!(run_status(&root).is_none());
        std::fs::write(root.join(RUN_STATUS_FILE), "not json").unwrap();
        assert!(run_status(&root).is_none());
        std::fs::write(
            root.join(RUN_STATUS_FILE),
            r#"{"state":"finished","reason":"","at":"2026-10-02T09:00:00Z","host":{"cpu":"x"}}"#,
        )
        .unwrap();
        assert_eq!(
            run_status(&root),
            Some(RunStatus {
                state: "finished".into(),
                at: Some("2026-10-02T09:00:00Z".into())
            })
        );
        std::fs::write(root.join(RUN_STATUS_FILE), r#"{"state":"started"}"#).unwrap();
        assert_eq!(run_status(&root).unwrap().at, None);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn fnv1a64_known_vectors() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x85944171f73967e8);
    }

    #[test]
    fn check_window_bounds() {
        assert_eq!(check_window(0), (0, 0));
        assert_eq!(check_window(10), (0, 10));
        assert_eq!(check_window(PREFIX_CHECK_BYTES), (0, PREFIX_CHECK_BYTES));
        assert_eq!(
            check_window(PREFIX_CHECK_BYTES + 5),
            (5, PREFIX_CHECK_BYTES + 5)
        );
    }
}
