//! What a node lets the host collect from a run directory, and how it names it.
//!
//! The host pulls a run's full record with `GET /v1/runs/files` and `/v1/runs/file` (server.rs): the files git
//! does not carry (the full agent transcript, the model server's log, the live progress file, the egress log) and
//! the files git does (the scores, the held-out detail, the workspace bundle, the compact conversation logs, the
//! re-scores). This module is the allow-list behind them: a request names a file, the name is matched against the
//! rules here, and the path is built only from segments that passed the same rules. A name no rule accepts is never
//! served and never listed. What is left out on purpose is named too (`NOT_COLLECTED`), and a test at the end of this
//! file requires every file name the harness can write to be in exactly one of the two lists.

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
/// Longest segment of a name below a tree rule (artifacts, re-scores and the like).
pub const MAX_SEGMENT_CHARS: usize = 128;
/// Deepest name, in segments from the run directory, a tree rule accepts. The deepest name in the recorded corpus
/// (tests/fixtures/run-file-names.txt) has 8; the test `the_deepest_corpus_name_is_within_the_tree_depth` pins it.
pub const MAX_TREE_DEPTH: usize = 12;
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
/// Folders under a run directory whose whole content is on the list (any file below, valid names only).
pub const RESCORE_DIR: &str = "rescore";
pub const RESCORE_SPOILED_DIR: &str = "rescore-spoiled";
pub const SUPERSEDED_DIR: &str = "superseded";
pub const BASE_DIR: &str = "base";
pub const PROMPTS_DIR: &str = "prompts";
pub const AGENT_REPORTS_DIR: &str = "agent-reports";
/// Folders under `stories/NN/` likewise.
pub const ARTIFACTS_DIR: &str = "artifacts";
pub const SCREENSHOTS_DIR: &str = "screenshots";
pub const PRE_SUITE_FIX_DIR: &str = "pre-suite-fix";
pub const SCORING_PREFIX: &str = "scoring-";
/// Not collected, by name.
pub const WORKSPACE_DIR: &str = "workspace";
pub const CONTROL_DIR: &str = "control";
pub const CURRENT_STORY_FILE: &str = "current_story";
pub const GITIGNORE_FILE: &str = ".gitignore";
pub const ARCHIVED_FILE: &str = "archived.json";
/// An in-flight temporary: a dot, the name, then one of these.
pub const TMP_SUFFIX: &str = ".tmp";
pub const PARTIAL_SUFFIX: &str = ".partial";

pub const HDR_FROM: &str = "x-dbench-from";
pub const HDR_SIZE: &str = "x-dbench-size";
pub const HDR_MTIME: &str = "x-dbench-mtime";
pub const HDR_EOF: &str = "x-dbench-eof";

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// How a file is transferred: appended to (served by byte range, with a prefix check), rewritten whole (served in
/// one chunk), or a blob (any size, in chunks, held to the identity of the file it started from).
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileKind {
    Append,
    Whole,
    Blob,
}

/// A record is what the harness publishes; raw is the full uncompacted streams and machine readings.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Class {
    Record,
    Raw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    RunDir,
    Egress,
}

/// A folder whose files are on the list as a tree.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeRoot {
    /// `rescore/<version>/<files...>`
    Rescore,
    /// `rescore-spoiled/<version>/<files...>`
    RescoreSpoiled,
    /// `superseded/<name>/<files...>`
    Superseded,
    /// `base/<files...>`
    Base,
    /// `prompts/<files...>` (a record of an older layout)
    Prompts,
    /// `agent-reports/<files...>` (a record of an older layout)
    AgentReports,
    /// `stories/<NN>/<folder>/<files...>`
    StoryDir(&'static str),
    /// `stories/<NN>/scoring-<N>/<files...>`
    StoryScoring,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pattern {
    Fixed(&'static str),
    /// `stories/<digits>/<file>`
    Story(&'static str),
    Tree(TreeRoot),
}

#[derive(Debug, Clone, Copy)]
pub struct Collectable {
    /// The rule's name, as `--list-rules` prints it and the checks report it.
    pub id: &'static str,
    pub pattern: Pattern,
    pub kind: FileKind,
    pub class: Class,
    pub source: Source,
}

const fn fixed(name: &'static str, kind: FileKind, class: Class) -> Collectable {
    Collectable { id: name, pattern: Pattern::Fixed(name), kind, class, source: Source::RunDir }
}

const fn story(id: &'static str, file: &'static str, kind: FileKind, class: Class) -> Collectable {
    Collectable { id, pattern: Pattern::Story(file), kind, class, source: Source::RunDir }
}

const fn tree(id: &'static str, root: TreeRoot) -> Collectable {
    Collectable { id, pattern: Pattern::Tree(root), kind: FileKind::Blob, class: Class::Record, source: Source::RunDir }
}

/// How many rules the full record has: 19 fixed record names, 4 fixed raw names, 9 story record names, 2 story raw
/// names and 8 tree rules.
pub const COLLECTED_RULES: usize = 42;
/// How many more the corpus of recorded run directories needed (an older layout's records, one older file).
pub const LEGACY_RULES: usize = 8;

/// The allow-list. Nothing outside it is ever served. The first thirteen keep the order of the list this replaced.
pub const COLLECTABLE: [Collectable; COLLECTED_RULES] = [
    story("stories/NN/agent-events.jsonl", EVENTS_FILE, FileKind::Append, Class::Raw),
    story("stories/NN/conditions.jsonl", CONDITIONS_FILE, FileKind::Append, Class::Raw),
    fixed(SERVER_LOG, FileKind::Append, Class::Raw),
    fixed(PROXY_LOG, FileKind::Append, Class::Raw),
    fixed(progress::PROGRESS_FILE, FileKind::Whole, Class::Record),
    Collectable { id: EGRESS_NAME, pattern: Pattern::Fixed(EGRESS_NAME), kind: FileKind::Append, class: Class::Raw, source: Source::Egress },
    // The run's published records. These are tracked in git, unlike everything above, so until the harness's push
    // lands they exist only in the machine's checkout -- one destructive git command or one dead disk from being
    // gone, while the raw data describing them sits safe here. Taking them makes the lake a complete second copy.
    fixed(METRICS_FILE, FileKind::Whole, Class::Record),
    fixed(RUN_FILE, FileKind::Whole, Class::Record),
    fixed(RUN_STATUS_FILE, FileKind::Whole, Class::Record),
    fixed(INTERVENTIONS_FILE, FileKind::Whole, Class::Record),
    story("stories/NN/accept-summary.json", ACCEPT_SUMMARY_FILE, FileKind::Whole, Class::Record),
    story("stories/NN/gate.json", GATE_FILE, FileKind::Whole, Class::Record),
    story("stories/NN/base-commit", BASE_COMMIT_FILE, FileKind::Whole, Class::Record),
    // The rest of the full record.
    fixed("run-history.jsonl", FileKind::Whole, Class::Record),
    fixed("summary.md", FileKind::Whole, Class::Record),
    fixed("summary-detail.md", FileKind::Whole, Class::Record),
    fixed("finalize.json", FileKind::Whole, Class::Record),
    fixed("server-health.json", FileKind::Whole, Class::Record),
    fixed("flow-counts.json", FileKind::Whole, Class::Record),
    fixed("machine-unfit.json", FileKind::Whole, Class::Record),
    fixed("metrics.subagent.json", FileKind::Blob, Class::Record),
    fixed("heldout-detail.json", FileKind::Blob, Class::Record),
    fixed("workspace-git-log.txt", FileKind::Blob, Class::Record),
    fixed("AUDIT.md", FileKind::Blob, Class::Record),
    fixed("audit.jsonl", FileKind::Blob, Class::Record),
    fixed("publish-refused.json", FileKind::Blob, Class::Record),
    fixed("workspace.bundle", FileKind::Blob, Class::Record),
    fixed("requests.jsonl", FileKind::Append, Class::Raw),
    story("stories/NN/prompt.md", "prompt.md", FileKind::Whole, Class::Record),
    story("stories/NN/accept-final-summary.json", "accept-final-summary.json", FileKind::Whole, Class::Record),
    story("stories/NN/accept.json", "accept.json", FileKind::Blob, Class::Record),
    story("stories/NN/accept-report.json", "accept-report.json", FileKind::Blob, Class::Record),
    story("stories/NN/accept-final.json", "accept-final.json", FileKind::Blob, Class::Record),
    story("stories/NN/agent-events.compact.jsonl.gz", "agent-events.compact.jsonl.gz", FileKind::Blob, Class::Record),
    tree("rescore/V/**", TreeRoot::Rescore),
    tree("rescore-spoiled/V/**", TreeRoot::RescoreSpoiled),
    tree("superseded/NAME/**", TreeRoot::Superseded),
    tree("base/**", TreeRoot::Base),
    tree("stories/NN/artifacts/**", TreeRoot::StoryDir(ARTIFACTS_DIR)),
    tree("stories/NN/screenshots/**", TreeRoot::StoryDir(SCREENSHOTS_DIR)),
    tree("stories/NN/pre-suite-fix/**", TreeRoot::StoryDir(PRE_SUITE_FIX_DIR)),
    tree("stories/NN/scoring-N/**", TreeRoot::StoryScoring),
];

/// File names the design's rules did not cover but the recorded run directories hold: the records of the older
/// layout of a hand-built reference run (prompts, agent reports, a README, an omitted-files note, run-level
/// acceptance files) and one older story file. Collected like any record, because the lake must hold every tracked
/// file of a run before the run leaves git.
pub const LEGACY_RECORDS: [Collectable; LEGACY_RULES] = [
    fixed("OMITTED.txt", FileKind::Whole, Class::Record),
    fixed("README.md", FileKind::Whole, Class::Record),
    fixed("accept-summary.json", FileKind::Blob, Class::Record),
    fixed("accept-final.json", FileKind::Blob, Class::Record),
    fixed("accept-final-summary.json", FileKind::Blob, Class::Record),
    story("stories/NN/gate.original.json", "gate.original.json", FileKind::Whole, Class::Record),
    tree("prompts/**", TreeRoot::Prompts),
    tree("agent-reports/**", TreeRoot::AgentReports),
];

/// Every collected rule, the full record first and the legacy records after it.
pub fn rules() -> impl Iterator<Item = &'static Collectable> {
    COLLECTABLE.iter().chain(LEGACY_RECORDS.iter())
}

/// A collectable file, named: only `parse_name` makes one, so holding one proves the name was allowed.
#[derive(Debug, Clone)]
pub struct FileName {
    entry: Collectable,
    name: String,
}

impl FileName {
    pub fn kind(&self) -> FileKind {
        self.entry.kind
    }

    pub fn class(&self) -> Class {
        self.entry.class
    }

    /// The rule that accepted the name.
    pub fn rule(&self) -> &'static str {
        self.entry.id
    }

    /// Where the file is read from: the run directory, or the egress folder.
    pub fn source(&self) -> Source {
        self.entry.source
    }

    /// The name as the manifest lists it.
    pub fn name(&self) -> String {
        self.name.clone()
    }
}

fn story_number(s: &str) -> bool {
    !s.is_empty() && s.len() <= MAX_STORY_DIGITS && s.bytes().all(|b| b.is_ascii_digit())
}

/// One segment of a name below a tree rule: 1 to `MAX_SEGMENT_CHARS` characters of `[A-Za-z0-9._+@=-]`, and not `.` or
/// `..`. ASCII only, so no separator, space, backslash or letter outside the alphabet gets through.
fn segment_ok(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= MAX_SEGMENT_CHARS
        && s != "."
        && s != ".."
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'@' | b'=' | b'-'))
}

/// An in-flight temporary: a dot, the name, then `.tmp` or `.partial`.
pub fn is_temporary(last_segment: &str) -> bool {
    last_segment.starts_with('.') && (last_segment.ends_with(TMP_SUFFIX) || last_segment.ends_with(PARTIAL_SUFFIX))
}

fn scoring_dir(s: &str) -> bool {
    s.strip_prefix(SCORING_PREFIX).is_some_and(story_number)
}

fn tree_matches(root: TreeRoot, segs: &[&str]) -> bool {
    let all_ok = |s: &[&str]| s.len() <= MAX_TREE_DEPTH && s.iter().all(|x| segment_ok(x));
    match root {
        TreeRoot::Rescore => segs.len() >= 3 && segs[0] == RESCORE_DIR && all_ok(segs),
        TreeRoot::RescoreSpoiled => segs.len() >= 3 && segs[0] == RESCORE_SPOILED_DIR && all_ok(segs),
        TreeRoot::Superseded => segs.len() >= 3 && segs[0] == SUPERSEDED_DIR && all_ok(segs),
        TreeRoot::Base => segs.len() >= 2 && segs[0] == BASE_DIR && all_ok(segs),
        TreeRoot::Prompts => segs.len() >= 2 && segs[0] == PROMPTS_DIR && all_ok(segs),
        TreeRoot::AgentReports => segs.len() >= 2 && segs[0] == AGENT_REPORTS_DIR && all_ok(segs),
        TreeRoot::StoryDir(dir) => segs.len() >= 4 && segs[0] == STORIES_DIR && story_number(segs[1]) && segs[2] == dir && all_ok(segs),
        TreeRoot::StoryScoring => segs.len() >= 4 && segs[0] == STORIES_DIR && story_number(segs[1]) && scoring_dir(segs[2]) && all_ok(segs),
    }
}

fn matches_rule(entry: &Collectable, segs: &[&str]) -> bool {
    match entry.pattern {
        Pattern::Fixed(f) => segs.len() == 1 && segs[0] == f,
        Pattern::Story(f) => segs.len() == 3 && segs[0] == STORIES_DIR && story_number(segs[1]) && segs[2] == f,
        Pattern::Tree(root) => tree_matches(root, segs),
    }
}

/// The allow-list entry a name means, or None for anything else (and for an in-flight temporary, always).
pub fn parse_name(name: &str) -> Option<FileName> {
    let segs: Vec<&str> = name.split('/').collect();
    if segs.len() > MAX_TREE_DEPTH || segs.last().is_none_or(|last| is_temporary(last)) {
        return None;
    }
    let entry = rules().find(|e| matches_rule(e, &segs))?;
    Some(FileName { entry: *entry, name: name.to_string() })
}

/// What is left out on purpose.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NcPattern {
    /// A folder and everything below it.
    Tree(&'static str),
    Fixed(&'static str),
    /// A dot, a name and this suffix, at any depth.
    Temporary(&'static str),
}

#[derive(Debug, Clone, Copy)]
pub struct NotCollected {
    pub id: &'static str,
    pub pattern: NcPattern,
    /// Why it is left out, in one line.
    pub reason: &'static str,
}

/// The named list of what the collector never takes. Every file name the harness can write is in this list or in
/// `COLLECTABLE` (or `LEGACY_RECORDS`), and never in both.
pub const NOT_COLLECTED: [NotCollected; 8] = [
    NotCollected { id: "workspace/**", pattern: NcPattern::Tree(WORKSPACE_DIR), reason: "the agent's working tree: rebuildable from workspace.bundle" },
    NotCollected { id: "control/**", pattern: NcPattern::Tree(CONTROL_DIR), reason: "live control files such as the operator's skip request" },
    NotCollected { id: CURRENT_STORY_FILE, pattern: NcPattern::Fixed(CURRENT_STORY_FILE), reason: "the live marker of the story now running" },
    NotCollected { id: WORK_DIR_FILE, pattern: NcPattern::Fixed(WORK_DIR_FILE), reason: "the work folder note: a machine path (the egress log is reached through it, the note is not taken)" },
    NotCollected { id: GITIGNORE_FILE, pattern: NcPattern::Fixed(GITIGNORE_FILE), reason: "written only by the old harness, for git" },
    NotCollected { id: ARCHIVED_FILE, pattern: NcPattern::Fixed(ARCHIVED_FILE), reason: "a marker the host writes into the lake, never a node" },
    NotCollected { id: ".NAME.PID.tmp", pattern: NcPattern::Temporary(TMP_SUFFIX), reason: "an in-flight temporary: it exists for a moment" },
    NotCollected { id: ".NAME.partial", pattern: NcPattern::Temporary(PARTIAL_SUFFIX), reason: "an in-flight temporary: a file part-way through its transfer" },
];

fn nc_matches(rule: &NotCollected, segs: &[&str]) -> bool {
    match rule.pattern {
        NcPattern::Tree(dir) => segs.len() >= 2 && segs[0] == dir,
        NcPattern::Fixed(f) => segs.len() == 1 && segs[0] == f,
        NcPattern::Temporary(suffix) => segs.last().is_some_and(|last| last.starts_with('.') && last.ends_with(suffix)),
    }
}

/// The not-collected rule a name falls under, if any.
pub fn not_collected_rule(name: &str) -> Option<&'static NotCollected> {
    let segs: Vec<&str> = name.split('/').collect();
    NOT_COLLECTED.iter().find(|r| nc_matches(r, &segs))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Classification {
    Collected(&'static str),
    NotCollected(&'static str, &'static str),
    Unclassified,
}

/// Where a name stands: collected (by which rule), left out (by which rule, and why), or neither. In-flight
/// temporaries are tested first and win, which keeps the two lists disjoint.
pub fn classify(name: &str) -> Classification {
    let segs: Vec<&str> = name.split('/').collect();
    if let Some(r) = NOT_COLLECTED.iter().find(|r| matches!(r.pattern, NcPattern::Temporary(_)) && nc_matches(r, &segs)) {
        return Classification::NotCollected(r.id, r.reason);
    }
    if let Some(f) = parse_name(name) {
        return Classification::Collected(f.rule());
    }
    match not_collected_rule(name) {
        Some(r) => Classification::NotCollected(r.id, r.reason),
        None => Classification::Unclassified,
    }
}

fn kind_label(k: FileKind) -> &'static str {
    match k {
        FileKind::Append => "append",
        FileKind::Whole => "whole",
        FileKind::Blob => "blob",
    }
}

fn class_label(c: Class) -> &'static str {
    match c {
        Class::Record => "record",
        Class::Raw => "raw",
    }
}

/// `dbench collect --list-rules`: the collected rules, then the ones left out with their reasons, one line each.
pub fn list_rules() -> String {
    let mut out = String::from("collected rules (kind, class):\n");
    for e in rules() {
        out.push_str(&format!("  {:<42} {:<6} {}\n", e.id, kind_label(e.kind), class_label(e.class)));
    }
    out.push_str("not collected (reason):\n");
    for r in NOT_COLLECTED {
        out.push_str(&format!("  {:<42} {}\n", r.id, r.reason));
    }
    out
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

/// Where a named file is on this machine. Built only from segments that passed the rules. The egress log is the one
/// named in work_dir.txt when that file exists, else a file of that name in the run directory itself.
pub fn resolve(run_dir: &Path, bench_home: &Path, name: &FileName) -> Option<PathBuf> {
    match name.entry.source {
        Source::Egress => {
            let logged = egress_path(run_dir, bench_home).filter(|p| p.is_file());
            Some(logged.unwrap_or_else(|| run_dir.join(EGRESS_NAME)))
        }
        Source::RunDir => Some(name.name.split('/').fold(run_dir.to_path_buf(), |p, seg| p.join(seg))),
    }
}

/// Whether `path` is, once every link in it is followed, below `run_dir`. A path that does not exist is not.
pub fn is_inside_run(run_dir: &Path, path: &Path) -> bool {
    match (run_dir.canonicalize(), path.canonicalize()) {
        (Ok(root), Ok(target)) => target.starts_with(root),
        _ => false,
    }
}

/// Whether any component of `path` below `run_dir` is a symbolic link (the file itself included).
pub fn has_link_below(run_dir: &Path, path: &Path) -> bool {
    let Ok(rel) = path.strip_prefix(run_dir) else { return true };
    let mut cur = run_dir.to_path_buf();
    for comp in rel.components() {
        cur.push(comp);
        if std::fs::symlink_metadata(&cur).is_ok_and(|m| m.file_type().is_symlink()) {
            return true;
        }
    }
    false
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
    /// Files below a tree rule whose names fail the rules (a character outside the alphabet, too long, too deep): a
    /// fact, not a fault. They are not listed and not served, and they never delay completeness.
    #[serde(default)]
    pub unlisted: u64,
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

/// A regular file, never a link: its size and mtime from `stat` alone.
fn entry_for(path: &Path, name: String, kind: FileKind) -> Option<FileEntry> {
    let m = std::fs::symlink_metadata(path).ok()?;
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

fn story_dirs(run_dir: &Path) -> Vec<String> {
    let mut stories: Vec<String> = std::fs::read_dir(run_dir.join(STORIES_DIR))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
                .filter_map(|e| e.file_name().to_str().map(String::from))
                .filter(|n| story_number(n))
                .collect()
        })
        .unwrap_or_default();
    stories.sort();
    stories
}

/// What a walk below a tree root found: the files that pass the rules and a count of those that do not.
#[derive(Default)]
struct Walk {
    files: Vec<FileEntry>,
    unlisted: u64,
}

/// Every regular file below `dir`, its name `prefix` plus its path under `dir`. Links are never followed or listed;
/// a name that fails the rules is counted; a temporary is ignored. Folders deeper than the rules allow are not entered.
fn walk(dir: &Path, prefix: &str, entry: &Collectable, depth: usize, out: &mut Walk) {
    // The folder itself must be a real folder: a link to another one is not followed.
    if !std::fs::symlink_metadata(dir).is_ok_and(|m| m.file_type().is_dir()) {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut items: Vec<_> = rd.filter_map(|e| e.ok()).collect();
    items.sort_by_key(|e| e.file_name());
    for item in items {
        let Ok(ft) = item.file_type() else { continue };
        if ft.is_symlink() {
            continue;
        }
        let Some(fname) = item.file_name().to_str().map(String::from) else {
            out.unlisted += 1;
            continue;
        };
        let name = format!("{prefix}{fname}");
        if ft.is_dir() {
            if depth + 1 > MAX_TREE_DEPTH {
                out.unlisted += 1;
            } else {
                walk(&item.path(), &format!("{name}/"), entry, depth + 1, out);
            }
        } else if ft.is_file() {
            if is_temporary(&fname) {
                continue;
            }
            match parse_name(&name).filter(|f| f.entry.id == entry.id) {
                Some(f) => out.files.extend(entry_for(&item.path(), f.name(), entry.kind)),
                None => out.unlisted += 1,
            }
        }
    }
}

fn walk_tree(run_dir: &Path, entry: &Collectable, root: TreeRoot, stories: &[String], out: &mut Walk) {
    let top_dir = match root {
        TreeRoot::Rescore => Some(RESCORE_DIR),
        TreeRoot::RescoreSpoiled => Some(RESCORE_SPOILED_DIR),
        TreeRoot::Superseded => Some(SUPERSEDED_DIR),
        TreeRoot::Base => Some(BASE_DIR),
        TreeRoot::Prompts => Some(PROMPTS_DIR),
        TreeRoot::AgentReports => Some(AGENT_REPORTS_DIR),
        TreeRoot::StoryDir(_) | TreeRoot::StoryScoring => None,
    };
    if let Some(dir) = top_dir {
        walk(&run_dir.join(dir), &format!("{dir}/"), entry, 1, out);
        return;
    }
    match root {
        TreeRoot::Rescore | TreeRoot::RescoreSpoiled | TreeRoot::Superseded | TreeRoot::Base | TreeRoot::Prompts | TreeRoot::AgentReports => {}
        TreeRoot::StoryDir(dir) => {
            for n in stories {
                let base = run_dir.join(STORIES_DIR).join(n);
                walk(&base.join(dir), &format!("{STORIES_DIR}/{n}/{dir}/"), entry, 3, out);
            }
        }
        TreeRoot::StoryScoring => {
            for n in stories {
                let base = run_dir.join(STORIES_DIR).join(n);
                let Ok(rd) = std::fs::read_dir(&base) else { continue };
                let mut dirs: Vec<String> = rd
                    .filter_map(|e| e.ok())
                    .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
                    .filter_map(|e| e.file_name().to_str().map(String::from))
                    .filter(|d| scoring_dir(d))
                    .collect();
                dirs.sort();
                for d in dirs {
                    walk(&base.join(&d), &format!("{STORIES_DIR}/{n}/{d}/"), entry, 3, out);
                }
            }
        }
    }
}

/// What a run directory offers: every allow-listed file that exists, with its size and mtime (from `stat` only; no
/// file is opened), and a count of tree files whose names the rules refuse.
pub struct Listing {
    pub files: Vec<FileEntry>,
    pub unlisted: u64,
}

pub fn manifest_listing(run_dir: &Path, bench_home: &Path) -> Listing {
    let stories = story_dirs(run_dir);
    let mut out = Vec::new();
    let mut tree_walk = Walk::default();
    for entry in rules() {
        match entry.pattern {
            Pattern::Story(f) => {
                for n in &stories {
                    let name = FileName { entry: *entry, name: format!("{STORIES_DIR}/{n}/{f}") };
                    if let Some(p) = resolve(run_dir, bench_home, &name) {
                        out.extend(entry_for(&p, name.name(), entry.kind));
                    }
                }
            }
            Pattern::Fixed(f) => {
                let name = FileName { entry: *entry, name: f.to_string() };
                if let Some(p) = resolve(run_dir, bench_home, &name) {
                    out.extend(entry_for(&p, name.name(), entry.kind));
                }
            }
            Pattern::Tree(root) => walk_tree(run_dir, entry, root, &stories, &mut tree_walk),
        }
    }
    out.extend(tree_walk.files);
    Listing { files: out, unlisted: tree_walk.unlisted }
}

/// The files of `manifest_listing`, for callers that do not need the unlisted count.
pub fn manifest(run_dir: &Path, bench_home: &Path) -> Vec<FileEntry> {
    manifest_listing(run_dir, bench_home).files
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
    fn run_listing_skips_installs_that_file_no_runs_and_works_without_a_share_dir() {
        let root = temp_dir("runs-skips");
        let repo = root.join("repo");
        let share = root.join("share");
        std::fs::create_dir_all(&repo).unwrap();
        // No share dir at all: only the combinations are listed (here none).
        assert_eq!(list_runs(&repo, &share), Vec::<String>::new());
        // An install directory without an install.env.
        std::fs::create_dir_all(share.join("half-installed")).unwrap();
        // A RUN_BASE that is empty, and one whose directory does not exist on this machine.
        std::fs::create_dir_all(share.join("empty-base")).unwrap();
        std::fs::write(share.join("empty-base").join(INSTALL_ENV), "RUN_BASE=\"\"\n").unwrap();
        std::fs::create_dir_all(share.join("absent-base")).unwrap();
        std::fs::write(share.join("absent-base").join(INSTALL_ENV), "RUN_BASE=\"benchmarks/reference/vidi/never-run\"\n").unwrap();
        // A RUN_BASE with one run and one directory that is not a run (no run.json).
        std::fs::create_dir_all(share.join("opus")).unwrap();
        std::fs::write(share.join("opus").join(INSTALL_ENV), "RUN_BASE=\"benchmarks/reference/vidi/opus-5.5\"\n").unwrap();
        let base = repo.join("benchmarks/reference/vidi/opus-5.5");
        std::fs::create_dir_all(base.join("run-1")).unwrap();
        std::fs::write(base.join("run-1").join(RUN_MARKER), "{}").unwrap();
        std::fs::create_dir_all(base.join("stray")).unwrap();
        // A file in the share dir beside the installs is no install either.
        std::fs::write(share.join("README"), "x").unwrap();
        assert_eq!(list_runs(&repo, &share), ["benchmarks/reference/vidi/opus-5.5/run-1"]);
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

/// The classification check (lake.allowlist.file_name_check): every file name the harness can write is in exactly one of
/// the two lists, and a rule that matches nothing recorded is named. The corpus (tests/fixtures/run-file-names.txt) is the
/// recorded names; the scan reads the harness sources for the names they write. A new name fails the build until it is
/// classified, so a harness release cannot be cut with a file the lake would miss.
#[cfg(test)]
mod name_check {
    use super::*;
    use std::collections::BTreeSet;

    pub const E_CLASS_UNLISTED: &str = "E-CLASS-UNLISTED";
    pub const E_CLASS_OVERLAP: &str = "E-CLASS-OVERLAP";
    pub const E_RULE_UNUSED: &str = "E-RULE-UNUSED";

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub struct Problem {
        pub code: &'static str,
        pub subject: String,
        pub detail: String,
    }

    /// Rules no recorded run exercises, each with the reason: they are on the list on purpose.
    pub const UNOBSERVED: [(&str, &str); 10] = [
        ("requests.jsonl", "only a metered run writes it"),
        ("proxy.log", "only a metered run writes it"),
        ("control/**", "exists only while a story is running"),
        (".NAME.PID.tmp", "in flight for a moment; the corpus leaves temporaries out"),
        (".NAME.partial", "in flight for a moment; the corpus leaves temporaries out"),
        ("flow-counts.json", "the harness does not write it yet (story 4 adds it)"),
        ("stories/NN/accept-final.json", "written by the final scoring of a run that has no held-out final suite yet"),
        ("stories/NN/accept-final-summary.json", "written beside accept-final.json"),
        ("stories/NN/scoring-N/**", "present only on a node while a story is scored"),
        ("publish-refused.json", "written only by a refusal path that is being retired"),
    ];

    /// The recorded names, as the corpus holds them (placeholders NN, V, NAME, scoring-N).
    pub fn corpus() -> Vec<String> {
        include_str!("../tests/fixtures/run-file-names.txt")
            .lines()
            .filter(|l| !l.trim().is_empty() && !l.starts_with('#'))
            .map(String::from)
            .collect()
    }

    /// A corpus name made concrete: each placeholder segment becomes a name the rules accept.
    pub fn concrete(name: &str) -> String {
        name.split('/')
            .map(|seg| match seg {
                "NN" => "01".to_string(),
                "V" => "vidi-v2.0-pre2".to_string(),
                "scoring-N" => "scoring-2".to_string(),
                s if s.starts_with("NAME") => format!("x{}", &s["NAME".len()..]),
                s => s.to_string(),
            })
            .collect::<Vec<_>>()
            .join("/")
    }

    /// Every rule of both lists that accepts the name, by id. A collected rule never accepts a temporary.
    pub fn matching_rules(name: &str, collected: &[Collectable], not_collected: &[NotCollected]) -> Vec<&'static str> {
        let segs: Vec<&str> = name.split('/').collect();
        let mut out: Vec<&'static str> = Vec::new();
        if !segs.last().is_some_and(|l| is_temporary(l)) {
            out.extend(collected.iter().filter(|e| matches_rule(e, &segs)).map(|e| e.id));
        }
        out.extend(not_collected.iter().filter(|r| nc_matches(r, &segs)).map(|r| r.id));
        out
    }

    /// E-CLASS-UNLISTED for a name no rule accepts, E-CLASS-OVERLAP for a name more than one rule accepts.
    pub fn check_names(names: &[String], collected: &[Collectable], not_collected: &[NotCollected]) -> Vec<Problem> {
        let mut problems = Vec::new();
        for name in names {
            let hits = matching_rules(&concrete(name), collected, not_collected);
            match hits.len() {
                0 => problems.push(Problem { code: E_CLASS_UNLISTED, subject: name.clone(), detail: "no rule accepts it".into() }),
                1 => {}
                _ => problems.push(Problem { code: E_CLASS_OVERLAP, subject: name.clone(), detail: hits.join(" and ") }),
            }
        }
        problems
    }

    /// E-RULE-UNUSED for a rule that no recorded name matches and that is not on the unobserved list.
    pub fn check_unused(names: &[String], collected: &[Collectable], not_collected: &[NotCollected], unobserved: &[(&str, &str)]) -> Vec<Problem> {
        let used: BTreeSet<&str> = names.iter().flat_map(|n| matching_rules(&concrete(n), collected, not_collected)).collect();
        let allowed: BTreeSet<&str> = unobserved.iter().filter(|(_, why)| !why.is_empty()).map(|(id, _)| *id).collect();
        collected
            .iter()
            .map(|e| e.id)
            .chain(not_collected.iter().map(|r| r.id))
            .filter(|id| !used.contains(id) && !allowed.contains(id))
            .map(|id| Problem { code: E_RULE_UNUSED, subject: id.to_string(), detail: "no recorded name matches it".into() })
            .collect()
    }

    /// File-name literals the harness sources hold: (file, line, literal). A literal is a quoted string of the shape
    /// `[A-Za-z0-9_.-]+` then `.json`, `.jsonl`, `.md`, `.txt`, `.log`, `.gz` or `.bundle`; a comment or docstring is read too.
    pub fn harness_literals(dir: &Path) -> Vec<(String, usize, String)> {
        let re = regex_lite::Regex::new(r#"["'/]([A-Za-z0-9_.-]+\.(?:jsonl|json|md|txt|log|gz|bundle))["'\s]"#).unwrap();
        let mut files: Vec<PathBuf> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                (name.ends_with(".py") || name.ends_with(".sh")) && !name.starts_with("test_") && !name.ends_with("_test.py") && name != "conftest.py"
            })
            .collect();
        files.sort();
        let mut out = Vec::new();
        for f in files {
            let text = std::fs::read_to_string(&f).unwrap_or_default();
            for (i, line) in text.lines().enumerate() {
                for c in re.captures_iter(line) {
                    out.push((f.file_name().unwrap().to_string_lossy().into_owned(), i + 1, c[1].to_string()));
                }
            }
        }
        out
    }

    /// The literals that are not run files, and the run files only a tree rule covers, from run-nonrun-literals.toml.
    pub fn nonrun_literals() -> (BTreeSet<String>, BTreeSet<String>) {
        let text = include_str!("../tests/fixtures/run-nonrun-literals.toml");
        let v: toml::Value = toml::from_str(text).expect("run-nonrun-literals.toml");
        let names = |table: &str| -> BTreeSet<String> {
            v.get(table)
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .map(|e| {
                            assert!(!e["reason"].as_str().unwrap_or("").is_empty(), "{table} entry without a reason: {:?}", e["name"]);
                            e["name"].as_str().unwrap().to_string()
                        })
                        .collect()
                })
                .unwrap_or_default()
        };
        (names("literal"), names("tree_covered"))
    }

    /// E-CLASS-UNLISTED, naming the file and line, for each literal that is not a non-run literal and that no rule explains,
    /// read at the run root or at a story's root.
    pub fn check_sources(dir: &Path, nonrun: &BTreeSet<String>, tree_covered: &BTreeSet<String>) -> Vec<Problem> {
        harness_literals(dir)
            .into_iter()
            .filter(|(_, _, lit)| !nonrun.contains(lit) && !tree_covered.contains(lit))
            .filter(|(_, _, lit)| classify(lit) == Classification::Unclassified && classify(&format!("stories/01/{lit}")) == Classification::Unclassified)
            .map(|(file, line, lit)| Problem { code: E_CLASS_UNLISTED, subject: format!("{file}:{line}"), detail: lit })
            .collect()
    }

    fn harness_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../benchmarks/spec-bench/harness")
    }

    fn rules_as_slices() -> (Vec<Collectable>, Vec<NotCollected>) {
        (rules().copied().collect(), NOT_COLLECTED.to_vec())
    }

    #[test]
    fn every_recorded_name_is_classified_by_exactly_one_rule() {
        // TC-35, TC-36
        let (c, n) = rules_as_slices();
        let names = corpus();
        assert!(names.len() > 50, "the corpus is read: {}", names.len());
        let problems = check_names(&names, &c, &n);
        assert!(problems.is_empty(), "{problems:#?}");
    }

    #[test]
    fn a_collected_and_a_not_collected_rule_that_accept_one_name_are_an_overlap() {
        // TC-38: plant a pair.
        let (mut c, mut n) = rules_as_slices();
        let planted = Collectable { id: "planted", pattern: Pattern::Fixed("planted.json"), kind: FileKind::Whole, class: Class::Record, source: Source::RunDir };
        c.push(planted);
        n.push(NotCollected { id: "planted-out", pattern: NcPattern::Fixed("planted.json"), reason: "planted" });
        let problems = check_names(&["planted.json".to_string()], &c, &n);
        assert_eq!(problems.len(), 1);
        assert_eq!((problems[0].code, problems[0].subject.as_str()), (E_CLASS_OVERLAP, "planted.json"));
        assert!(problems[0].detail.contains("planted") && problems[0].detail.contains("planted-out"));
        // A name no rule accepts is unlisted.
        let unlisted = check_names(&["new-thing.json".to_string()], &c, &n);
        assert_eq!(unlisted.iter().map(|p| p.code).collect::<Vec<_>>(), [E_CLASS_UNLISTED]);
    }

    #[test]
    fn a_rule_that_matches_no_recorded_name_is_unused_unless_it_is_on_the_unobserved_list() {
        // TC-39
        let (mut c, n) = rules_as_slices();
        c.push(Collectable { id: "never-written.json", pattern: Pattern::Fixed("never-written.json"), kind: FileKind::Whole, class: Class::Record, source: Source::RunDir });
        let problems = check_unused(&corpus(), &c, &n, &UNOBSERVED);
        assert_eq!(problems.iter().map(|p| (p.code, p.subject.as_str())).collect::<Vec<_>>(), [(E_RULE_UNUSED, "never-written.json")]);
        // The same rule, named with a reason, passes; one named without a reason does not.
        let with_reason = [UNOBSERVED.as_slice(), &[("never-written.json", "a test rule")]].concat();
        assert!(check_unused(&corpus(), &c, &n, &with_reason).is_empty());
        let no_reason = [UNOBSERVED.as_slice(), &[("never-written.json", "")]].concat();
        assert_eq!(check_unused(&corpus(), &c, &n, &no_reason).len(), 1);
    }

    #[test]
    fn every_rule_matches_a_recorded_name_or_is_unobserved_with_a_reason() {
        // TC-39, the real lists
        let (c, n) = rules_as_slices();
        let problems = check_unused(&corpus(), &c, &n, &UNOBSERVED);
        assert!(problems.is_empty(), "{problems:#?}");
    }

    #[test]
    fn the_unobserved_rules_are_rules_with_reasons() {
        // TC-40
        let ids: BTreeSet<&str> = rules().map(|e| e.id).chain(NOT_COLLECTED.iter().map(|r| r.id)).collect();
        for (id, why) in UNOBSERVED {
            assert!(ids.contains(id), "{id} is not a rule");
            assert!(why.len() > 10, "{id} has no reason");
        }
        for must in ["requests.jsonl", "stories/NN/scoring-N/**"] {
            assert!(UNOBSERVED.iter().any(|(id, _)| *id == must), "{must}");
        }
    }

    #[test]
    fn literals_that_are_not_run_files_are_named_in_the_non_run_file_and_not_reported() {
        // TC-41
        let (nonrun, _) = nonrun_literals();
        for lit in ["package.json", "tasks.md", "models.json", "settings.json", "opencode.json", "story.md", "config.json", "generation_config.json", "transcript.jsonl"] {
            assert!(nonrun.contains(lit), "{lit}");
        }
        let (nonrun, covered) = nonrun_literals();
        let problems = check_sources(&harness_dir(), &nonrun, &covered);
        assert!(!problems.iter().any(|p| ["package.json", "tasks.md", "models.json"].contains(&p.detail.as_str())), "{problems:#?}");
    }

    #[test]
    fn a_story_number_and_a_version_are_normalised_in_the_corpus() {
        // TC-44
        let names = corpus();
        assert!(names.iter().any(|n| n.starts_with("stories/NN/")));
        assert!(names.iter().any(|n| n.starts_with("rescore/V/")));
        assert!(!names.iter().any(|n| n.contains("stories/07/") || n.contains("rescore/vidi-v2.0-pre2")));
        assert_eq!(concrete("stories/NN/scoring-N/NAME/NAME.png"), "stories/01/scoring-2/x/x.png");
        assert_eq!(concrete("rescore/V/stories/NN/accept-summary.json"), "rescore/vidi-v2.0-pre2/stories/01/accept-summary.json");
    }

    #[test]
    fn the_deepest_corpus_name_is_within_the_tree_depth() {
        // TC-45: the constant is pinned by the data.
        let deepest = corpus().iter().map(|n| n.split('/').count()).max().unwrap();
        assert!(deepest <= MAX_TREE_DEPTH, "{deepest} segments");
        assert!(MAX_TREE_DEPTH - deepest <= 6, "the margin is small enough to mean something: {deepest} against {MAX_TREE_DEPTH}");
    }

    #[test]
    fn the_harness_sources_write_no_file_name_the_lists_do_not_know() {
        // TC-42, TC-46: this test is part of cargo test, so a harness release cannot be cut with a new name unclassified.
        let (nonrun, covered) = nonrun_literals();
        let problems = check_sources(&harness_dir(), &nonrun, &covered);
        assert!(problems.is_empty(), "{problems:#?}");
    }

    #[test]
    fn the_scan_finds_the_file_name_literals_of_the_design_table() {
        // TC-42
        let found: BTreeSet<String> = harness_literals(&harness_dir()).into_iter().map(|(_, _, l)| l).collect();
        for want in ["run.json", "finalize.json", "workspace.bundle", "accept-final.json", "requests.jsonl", "heldout-detail.json", "summary-detail.md", "agent-events.compact.jsonl.gz", "workspace-git-log.txt", "server-health.json", "run-history.jsonl", "audit.jsonl", "AUDIT.md", "publish-refused.json", "machine-unfit.json", "metrics.subagent.json"] {
            assert!(found.contains(want), "the scan does not find {want}");
        }
    }

    #[test]
    fn a_new_literal_in_a_scratch_copy_of_the_harness_fails_with_its_file_and_line_and_passes_again_without_it() {
        // TC-37
        let scratch = std::env::temp_dir().join(format!("dbench-name-check-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        std::fs::create_dir_all(&scratch).unwrap();
        for e in std::fs::read_dir(harness_dir()).unwrap().filter_map(|e| e.ok()) {
            let p = e.path();
            if p.is_file() && p.extension().is_some_and(|x| x == "py" || x == "sh") {
                std::fs::copy(&p, scratch.join(p.file_name().unwrap())).unwrap();
            }
        }
        let (nonrun, covered) = nonrun_literals();
        assert!(check_sources(&scratch, &nonrun, &covered).is_empty(), "the scratch copy starts clean");
        let drive = scratch.join("drive.py");
        let original = std::fs::read_to_string(&drive).unwrap();
        let lines_before = original.lines().count();
        std::fs::write(&drive, format!("{original}\nNEW_FILE = \"new-thing.json\"\n")).unwrap();
        let problems = check_sources(&scratch, &nonrun, &covered);
        assert_eq!(problems.len(), 1, "{problems:#?}");
        assert_eq!(problems[0].code, E_CLASS_UNLISTED);
        assert_eq!(problems[0].subject, format!("drive.py:{}", lines_before + 2));
        assert_eq!(problems[0].detail, "new-thing.json");
        std::fs::write(&drive, original).unwrap();
        assert!(check_sources(&scratch, &nonrun, &covered).is_empty());
        std::fs::remove_dir_all(&scratch).unwrap();
    }

    #[test]
    fn a_literal_in_a_comment_or_a_docstring_is_still_reported() {
        // TC-37, boundary
        let scratch = std::env::temp_dir().join(format!("dbench-name-check-comment-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&scratch);
        std::fs::create_dir_all(&scratch).unwrap();
        std::fs::write(scratch.join("a.py"), "# writes 'in-comment.json' somewhere\n\"\"\"docstring names \"in-doc.md\" too\"\"\"\n").unwrap();
        let problems = check_sources(&scratch, &BTreeSet::new(), &BTreeSet::new());
        let found: Vec<&str> = problems.iter().map(|p| p.detail.as_str()).collect();
        assert_eq!(found, ["in-comment.json", "in-doc.md"]);
        // A reason in the non-run file resolves it.
        let nonrun: BTreeSet<String> = ["in-comment.json".to_string(), "in-doc.md".to_string()].into();
        assert!(check_sources(&scratch, &nonrun, &BTreeSet::new()).is_empty());
        std::fs::remove_dir_all(&scratch).unwrap();
    }

    #[test]
    fn the_corpus_header_names_the_commit_and_its_counts_match_what_git_tracked_there() {
        // TC-43
        let text = include_str!("../tests/fixtures/run-file-names.txt");
        let header: Vec<&str> = text.lines().take_while(|l| l.starts_with('#')).collect();
        let commit = header.iter().find_map(|l| l.strip_prefix("# commit: ")).expect("the header names the commit");
        let want = header.iter().find_map(|l| l.strip_prefix("# tracked run records (run.json): ")).expect("the header counts run records");
        let (total, rest) = want.split_once(' ').unwrap();
        let total: usize = total.parse().unwrap();
        assert!(rest.contains("combination") && rest.contains("reference"));
        let out = std::process::Command::new("git")
            .args(["ls-tree", "-r", "--full-tree", "--name-only", commit, "--", "combinations", "benchmarks/reference"])
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .output();
        let listing = match out {
            Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).into_owned(),
            _ => {
                eprintln!("skipped: commit {commit} is not in this clone");
                return;
            }
        };
        let (mut combination, mut reference) = (0, 0);
        for line in listing.lines() {
            if line.ends_with("/run.json") && line.starts_with("combinations/") && line.contains("/benchmarks/") && line.matches('/').count() >= 5 {
                combination += 1;
            } else if line.starts_with("benchmarks/reference/") && line.ends_with("/run.json") && line.matches('/').count() == 5 {
                reference += 1;
            }
        }
        assert_eq!(combination + reference, total, "the header says {total}, git has {combination} + {reference} at {commit}");
        assert!(rest.contains(&format!("combination {combination}")) && rest.contains(&format!("reference {reference}")), "{rest}");
    }
}
