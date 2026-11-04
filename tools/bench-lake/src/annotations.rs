//! The operator's decisions about runs (story 23, annotations.store): a run is invalid, a run is archived, a story is
//! not comparable. They are kept apart from the records, which never change after the harness wrote them, in one
//! append-only log beside the lake: `<state>/annotations/log.jsonl`, one event per line. The state of a (run, story,
//! kind) is its last event; nothing is rewritten or deleted. Private by design: the folder is the owner's alone, and
//! nothing here publishes it.
//!
//! This is the one place in bench-lake that writes, and it writes only below `<state>/annotations`. Every reading
//! question stays read-only (tests/readonly.rs).

use crate::canonical;
use crate::layout::is_run_id;
use crate::records::{MAX_STORY, MIN_STORY};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

pub const ANNOTATIONS_DIR: &str = "annotations";
pub const LOG_FILE: &str = "log.jsonl";
pub const LOCK_FILE: &str = "log.jsonl.lock";
/// The version of the event's shape.
pub const EVENT_VERSION: i64 = 1;
/// The folder and the log are the owner's alone: decisions are private unless the operator publishes them.
pub const DIR_MODE: u32 = 0o700;
pub const FILE_MODE: u32 = 0o600;
const FIRST_SEQ: i64 = 1;
const BY_IMPORT: &str = "import";
const BY_UNKNOWN: &str = "unknown";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Kind {
    Invalid,
    Archived,
    NotComparable,
}

impl Kind {
    pub const ALL: [Kind; 3] = [Kind::Invalid, Kind::Archived, Kind::NotComparable];

    pub fn as_str(&self) -> &'static str {
        match self {
            Kind::Invalid => "invalid",
            Kind::Archived => "archived",
            Kind::NotComparable => "not_comparable",
        }
    }

    pub fn parse(text: &str) -> Option<Kind> {
        Kind::ALL.into_iter().find(|k| k.as_str() == text)
    }

    /// A not-comparable decision is about one story; the others are about the whole run.
    pub fn takes_story(&self) -> bool {
        *self == Kind::NotComparable
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Set,
    Clear,
}

impl Op {
    pub fn as_str(&self) -> &'static str {
        match self {
            Op::Set => "set",
            Op::Clear => "clear",
        }
    }

    pub fn parse(text: &str) -> Option<Op> {
        [Op::Set, Op::Clear]
            .into_iter()
            .find(|o| o.as_str() == text)
    }
}

/// One line of the log.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub v: i64,
    pub seq: i64,
    /// UTC, `YYYY-MM-DDTHH:MM:SSZ`.
    pub at: String,
    pub by: String,
    pub op: Op,
    pub kind: Kind,
    pub run: String,
    pub story: Option<i64>,
    pub reason: String,
}

impl Event {
    pub fn to_value(&self) -> Value {
        json!({
            "v": self.v, "seq": self.seq, "at": self.at, "by": self.by, "op": self.op.as_str(),
            "kind": self.kind.as_str(), "run": self.run, "story": self.story, "reason": self.reason,
        })
    }

    /// The event a line holds, or why it is not one.
    pub fn from_value(v: &Value) -> Result<Event, String> {
        let text = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .map(String::from)
                .ok_or_else(|| format!("{k} is not text"))
        };
        let int = |k: &str| {
            v.get(k)
                .and_then(Value::as_i64)
                .ok_or_else(|| format!("{k} is not a whole number"))
        };
        let version = int("v")?;
        if version != EVENT_VERSION {
            return Err(format!("version {version} is not {EVENT_VERSION}"));
        }
        let op = Op::parse(&text("op")?).ok_or("op is neither set nor clear")?;
        let kind = Kind::parse(&text("kind")?).ok_or("unknown kind")?;
        let story = match v.get("story") {
            None | Some(Value::Null) => None,
            Some(s) => Some(s.as_i64().ok_or("story is not a whole number")?),
        };
        let e = Event {
            v: version,
            seq: int("seq")?,
            at: text("at")?,
            by: text("by")?,
            op,
            kind,
            run: text("run")?,
            story,
            reason: text("reason")?,
        };
        check_decision(e.kind, &e.run, e.story, &e.reason)?;
        Ok(e)
    }
}

/// The rules every decision keeps, whether asked for or read back.
fn check_decision(kind: Kind, run: &str, story: Option<i64>, reason: &str) -> Result<(), String> {
    if !is_run_id(run) {
        return Err(format!("{run:?} is not a run id (combinations/<9 parts> or benchmarks/reference/<pack>/<stack>/<run>)"));
    }
    match (kind.takes_story(), story) {
        (true, None) => return Err(format!("{} needs --story", kind.as_str())),
        (true, Some(s)) if !(MIN_STORY..=MAX_STORY).contains(&s) => {
            return Err(format!("story {s} is outside {MIN_STORY} to {MAX_STORY}"));
        }
        (false, Some(_)) => {
            return Err(format!(
                "{} is about a whole run and takes no story",
                kind.as_str()
            ))
        }
        _ => {}
    }
    if reason.trim().is_empty() {
        return Err("a decision needs a reason (--reason, not empty)".to_string());
    }
    Ok(())
}

/// A decision in force.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Decision {
    pub reason: String,
    pub at: String,
    pub by: String,
    pub seq: i64,
}

impl Decision {
    fn of(e: &Event) -> Decision {
        Decision {
            reason: e.reason.clone(),
            at: e.at.clone(),
            by: e.by.clone(),
            seq: e.seq,
        }
    }

    pub fn to_value(&self) -> Value {
        json!({"reason": self.reason, "at": self.at, "by": self.by, "seq": self.seq})
    }
}

/// The decisions in force about one run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RunAnnotations {
    pub invalid: Option<Decision>,
    pub archived: Option<Decision>,
    pub not_comparable: BTreeMap<i64, Decision>,
}

impl RunAnnotations {
    pub fn to_value(&self) -> Value {
        let stories: serde_json::Map<String, Value> = self
            .not_comparable
            .iter()
            .map(|(s, d)| (s.to_string(), d.to_value()))
            .collect();
        json!({
            "invalid": self.invalid.as_ref().map(Decision::to_value),
            "archived": self.archived.as_ref().map(Decision::to_value),
            "not_comparable": stories,
        })
    }

    fn is_empty(&self) -> bool {
        self.invalid.is_none() && self.archived.is_none() && self.not_comparable.is_empty()
    }

    fn current(&self, kind: Kind, story: Option<i64>) -> Option<&Decision> {
        match kind {
            Kind::Invalid => self.invalid.as_ref(),
            Kind::Archived => self.archived.as_ref(),
            Kind::NotComparable => story.and_then(|s| self.not_comparable.get(&s)),
        }
    }
}

/// Every decision in force, by run id.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct State {
    pub runs: BTreeMap<String, RunAnnotations>,
}

impl State {
    /// The decisions about `run` (none: the empty set).
    pub fn of(&self, run: &str) -> RunAnnotations {
        self.runs.get(run).cloned().unwrap_or_default()
    }

    pub fn invalid(&self, run: &str) -> Option<&Decision> {
        self.runs.get(run).and_then(|r| r.invalid.as_ref())
    }

    pub fn archived(&self, run: &str) -> Option<&Decision> {
        self.runs.get(run).and_then(|r| r.archived.as_ref())
    }

    pub fn to_value(&self) -> Value {
        let runs: serde_json::Map<String, Value> = self
            .runs
            .iter()
            .map(|(id, r)| (id.clone(), r.to_value()))
            .collect();
        json!({"runs": runs})
    }
}

/// The decisions in force after `events`, in order: the last event of each (run, story, kind) wins; a clear removes.
pub fn fold(events: &[Event]) -> State {
    let mut state = State::default();
    for e in events {
        let run = state.runs.entry(e.run.clone()).or_default();
        let decision = (e.op == Op::Set).then(|| Decision::of(e));
        match e.kind {
            Kind::Invalid => run.invalid = decision,
            Kind::Archived => run.archived = decision,
            Kind::NotComparable => {
                let story = e.story.unwrap_or_default();
                match decision {
                    Some(d) => {
                        run.not_comparable.insert(story, d);
                    }
                    None => {
                        run.not_comparable.remove(&story);
                    }
                }
            }
        }
    }
    state.runs.retain(|_, r| !r.is_empty());
    state
}

/// Why the store could not be read.
#[derive(Debug)]
pub enum StoreError {
    Unreadable {
        path: PathBuf,
        message: String,
    },
    Malformed {
        path: PathBuf,
        line: usize,
        message: String,
    },
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            StoreError::Unreadable { path, message } => write!(
                f,
                "the annotation log {} cannot be read: {message}",
                path.display()
            ),
            StoreError::Malformed {
                path,
                line,
                message,
            } => {
                write!(
                    f,
                    "the annotation log {} is malformed at line {line}: {message}",
                    path.display()
                )
            }
        }
    }
}

/// Why a decision was not recorded.
#[derive(Debug)]
pub enum AnnotateError {
    /// The decision breaks a rule: nothing was written.
    Refused(String),
    /// The store could not be read or written.
    Store(StoreError),
}

/// A decision to record.
#[derive(Debug, Clone)]
pub struct Request {
    pub op: Op,
    pub kind: Kind,
    pub run: String,
    pub story: Option<i64>,
    pub reason: String,
    pub by: String,
}

impl Request {
    /// The rules a request keeps before the store is opened.
    pub fn check(&self) -> Result<(), String> {
        check_decision(self.kind, &self.run, self.story, &self.reason)
    }
}

/// The log of one lake.
#[derive(Debug, Clone)]
pub struct Store {
    pub dir: PathBuf,
}

impl Store {
    pub fn in_state_dir(state: &Path) -> Store {
        Store {
            dir: state.join(ANNOTATIONS_DIR),
        }
    }

    pub fn log_path(&self) -> PathBuf {
        self.dir.join(LOG_FILE)
    }

    /// Every event, in order. A missing log is an empty store; anything else that cannot be read is an error, so
    /// that no reader ever takes an unreadable store for one with no decisions.
    pub fn events(&self) -> Result<Vec<Event>, StoreError> {
        let path = self.log_path();
        let text = match fs::read(&path) {
            Ok(bytes) => String::from_utf8(bytes).map_err(|_| StoreError::Malformed {
                path: path.clone(),
                line: 0,
                message: "not UTF-8".into(),
            })?,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => {
                return Err(StoreError::Unreadable {
                    path,
                    message: e.to_string(),
                })
            }
        };
        let mut out: Vec<Event> = Vec::new();
        for (i, line) in text.lines().enumerate() {
            let n = i + 1;
            let bad = |message: String| StoreError::Malformed {
                path: path.clone(),
                line: n,
                message,
            };
            let value: Value =
                serde_json::from_str(line).map_err(|e| bad(format!("not JSON: {e}")))?;
            let e = Event::from_value(&value).map_err(bad)?;
            let want = out.last().map_or(FIRST_SEQ, |p| p.seq + 1);
            if e.seq != want {
                return Err(bad(format!("seq {} where {want} was due", e.seq)));
            }
            out.push(e);
        }
        Ok(out)
    }

    /// The decisions in force.
    pub fn state(&self) -> Result<State, StoreError> {
        Ok(fold(&self.events()?))
    }

    /// Records one decision: under the store's lock, checks it against the decisions in force, and appends it.
    pub fn append(&self, req: &Request, at: &str) -> Result<Event, AnnotateError> {
        req.check().map_err(AnnotateError::Refused)?;
        let mut written = self.write_locked(|events| {
            let state = fold(events);
            let current = state
                .runs
                .get(&req.run)
                .and_then(|r| r.current(req.kind, req.story));
            let what = match req.story {
                Some(s) => format!("{} story {s} of {}", req.kind.as_str(), req.run),
                None => format!("{} {}", req.kind.as_str(), req.run),
            };
            match (req.op, current) {
                (Op::Clear, None) => return Err(format!("nothing to clear: no {what} in force")),
                (Op::Set, Some(d)) if d.reason == req.reason => {
                    return Err(format!(
                        "already set with that reason: {what} (seq {})",
                        d.seq
                    ));
                }
                _ => {}
            }
            Ok(vec![(
                req.op,
                req.kind,
                req.run.clone(),
                req.story,
                req.reason.clone(),
                at.to_string(),
                req.by.clone(),
            )])
        })?;
        Ok(written.remove(0))
    }

    /// Imports the decisions a checkout's working tree holds (run.json `invalid`, `archived.json` markers,
    /// metrics.json stories' `not_comparable`), read as the benchmarker read them. A decision whose (run, story, kind)
    /// has any event in the store already is not imported again, so the import can be repeated and never brings back
    /// a decision the operator withdrew.
    pub fn import(&self, checkout: &Path, now: &str) -> Result<Imported, AnnotateError> {
        if !checkout.is_dir() {
            return Err(AnnotateError::Refused(format!(
                "{} is not a folder: give the host checkout",
                checkout.display()
            )));
        }
        let mut found = Vec::new();
        let mut skipped = Vec::new();
        for dir in run_folders(checkout) {
            read_decisions(checkout, &dir, now, &mut found, &mut skipped);
        }
        let appended = self.write_locked(|events| {
            let known: std::collections::BTreeSet<(String, Option<i64>, Kind)> = events
                .iter()
                .map(|e| (e.run.clone(), e.story, e.kind))
                .collect();
            Ok(found
                .iter()
                .filter(|f| !known.contains(&(f.run.clone(), f.story, f.kind)))
                .map(|f| {
                    (
                        Op::Set,
                        f.kind,
                        f.run.clone(),
                        f.story,
                        f.reason.clone(),
                        f.at.clone(),
                        BY_IMPORT.to_string(),
                    )
                })
                .collect())
        })?;
        Ok(Imported { appended, skipped })
    }

    /// Under the store's lock: reads the events, asks `decide` what to append (or why not), appends and syncs.
    #[allow(clippy::type_complexity)]
    fn write_locked(
        &self,
        decide: impl FnOnce(
            &[Event],
        ) -> Result<
            Vec<(Op, Kind, String, Option<i64>, String, String, String)>,
            String,
        >,
    ) -> Result<Vec<Event>, AnnotateError> {
        let io_err = |e: io::Error| {
            AnnotateError::Store(StoreError::Unreadable {
                path: self.log_path(),
                message: e.to_string(),
            })
        };
        create_private_dir(&self.dir).map_err(io_err)?;
        let lock = open_private(&self.dir.join(LOCK_FILE), false).map_err(io_err)?;
        lock.lock().map_err(io_err)?;
        let events = self.events().map_err(AnnotateError::Store)?;
        let wanted = decide(&events).map_err(AnnotateError::Refused)?;
        let first = events.last().map_or(FIRST_SEQ, |e| e.seq + 1);
        let mut out = Vec::new();
        let mut text = String::new();
        for (seq, (op, kind, run, story, reason, at, by)) in (first..).zip(wanted) {
            let e = Event { v: EVENT_VERSION, seq, at, by, op, kind, run, story, reason };
            text.push_str(&canonical(&e.to_value()));
            text.push('\n');
            out.push(e);
        }
        if !out.is_empty() {
            let mut log = open_private(&self.log_path(), true).map_err(io_err)?;
            log.write_all(text.as_bytes()).map_err(io_err)?;
            log.sync_all().map_err(io_err)?;
        }
        Ok(out)
    }
}

/// What an import appended, and what it could not read (path relative to the checkout, why).
#[derive(Debug, Clone)]
pub struct Imported {
    pub appended: Vec<Event>,
    pub skipped: Vec<(String, String)>,
}

/// A decision found in a checkout.
struct Found {
    kind: Kind,
    run: String,
    story: Option<i64>,
    reason: String,
    at: String,
}

const RUN_FILE: &str = "run.json";
const METRICS_FILE: &str = "metrics.json";
const ARCHIVED_FILE: &str = "archived.json";
const NO_INVALID_REASON: &str = "marked invalid with no reason given";
const NO_ARCHIVED_REASON: &str = "archived with no reason given";
const NO_COMPARABLE_REASON: &str = "no reason recorded";

/// The run folders of a checkout: every folder at run depth below `combinations` and `benchmarks/reference`, links
/// not followed. Names are checked later, against the run id rule, only where a folder holds a decision.
fn run_folders(checkout: &Path) -> Vec<PathBuf> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
            .map(|e| e.path())
            .collect();
        dirs.sort();
        for d in dirs {
            if depth == 1 {
                out.push(d);
            } else {
                walk(&d, depth - 1, out);
            }
        }
    }
    let mut out = Vec::new();
    walk(
        &checkout.join(crate::layout::COMBINATIONS_DIR),
        crate::layout::COMBINATION_DEPTH,
        &mut out,
    );
    walk(
        &checkout.join(crate::layout::REFERENCE_ID_PREFIX.trim_end_matches('/')),
        crate::layout::REFERENCE_DEPTH,
        &mut out,
    );
    out
}

/// A JSON document of the folder: None when absent (or not a regular file); Err when it is there but not JSON.
fn read_json(dir: &Path, name: &str) -> Option<Result<Value, String>> {
    match crate::read_regular(dir, Path::new(name)) {
        Ok(bytes) => Some(serde_json::from_slice(&bytes).map_err(|e| format!("not JSON: {e}"))),
        Err(crate::FileProblem::Missing | crate::FileProblem::NotAFile) => None,
        Err(crate::FileProblem::Unreadable(e)) => Some(Err(e.to_string())),
    }
}

fn read_decisions(
    checkout: &Path,
    dir: &Path,
    now: &str,
    found: &mut Vec<Found>,
    skipped: &mut Vec<(String, String)>,
) {
    let rel = dir
        .strip_prefix(checkout)
        .unwrap_or(dir)
        .to_string_lossy()
        .to_string();
    let mut here: Vec<Found> = Vec::new();
    let mut doc = |name: &str| match read_json(dir, name) {
        None => None,
        Some(Ok(v)) => Some(v),
        Some(Err(why)) => {
            skipped.push((format!("{rel}/{name}"), why));
            None
        }
    };
    if let Some(run) = doc(RUN_FILE) {
        let mark = run.get("invalid").cloned().unwrap_or(Value::Null);
        let reason = match &mark {
            Value::Null | Value::Bool(false) => None,
            Value::String(t) => Some(non_empty(t, NO_INVALID_REASON)),
            Value::Object(o) => Some(non_empty(
                o.get("reason").and_then(Value::as_str).unwrap_or(""),
                NO_INVALID_REASON,
            )),
            _ => Some(NO_INVALID_REASON.to_string()),
        };
        if let Some(reason) = reason {
            let since = mark.get("since").and_then(Value::as_str).and_then(to_utc);
            here.push(Found {
                kind: Kind::Invalid,
                run: rel.clone(),
                story: None,
                reason,
                at: since.unwrap_or_else(|| now.to_string()),
            });
        }
    }
    if let Some(marker) = doc(ARCHIVED_FILE) {
        let reason = non_empty(
            marker.get("reason").and_then(Value::as_str).unwrap_or(""),
            NO_ARCHIVED_REASON,
        );
        let at = marker
            .get("archived_at")
            .and_then(Value::as_str)
            .and_then(to_utc);
        here.push(Found {
            kind: Kind::Archived,
            run: rel.clone(),
            story: None,
            reason,
            at: at.unwrap_or_else(|| now.to_string()),
        });
    }
    if let Some(metrics) = doc(METRICS_FILE) {
        let stories: Vec<(Option<i64>, &Value)> = match metrics.get("stories") {
            Some(Value::Object(m)) => m.iter().map(|(k, v)| (k.parse::<i64>().ok(), v)).collect(),
            Some(Value::Array(a)) => a
                .iter()
                .map(|v| (v.get("id").and_then(story_number), v))
                .collect(),
            _ => Vec::new(),
        };
        for (story, record) in stories {
            let reason = match record.get("not_comparable") {
                Some(Value::String(t)) if !t.trim().is_empty() => Some(t.trim().to_string()),
                Some(Value::String(_)) | Some(Value::Null) | Some(Value::Bool(false)) | None => {
                    None
                }
                Some(_) => Some(NO_COMPARABLE_REASON.to_string()),
            };
            if let Some(reason) = reason {
                match story.filter(|s| (MIN_STORY..=MAX_STORY).contains(s)) {
                    Some(s) => here.push(Found {
                        kind: Kind::NotComparable,
                        run: rel.clone(),
                        story: Some(s),
                        reason,
                        at: now.to_string(),
                    }),
                    None => skipped.push((
                        format!("{rel}/{METRICS_FILE}"),
                        "a not-comparable story without a story number 0 to 999".into(),
                    )),
                }
            }
        }
    }
    if here.is_empty() {
        return;
    }
    if !is_run_id(&rel) {
        skipped.push((rel, "not a run id: its decisions are not imported".into()));
        return;
    }
    here.sort_by_key(|f| (f.kind, f.story));
    found.extend(here);
}

fn story_number(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn non_empty(text: &str, otherwise: &str) -> String {
    let t = text.trim();
    if t.is_empty() {
        otherwise.to_string()
    } else {
        t.to_string()
    }
}

fn create_private_dir(dir: &Path) -> io::Result<()> {
    if !dir.is_dir() {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(DIR_MODE)
            .create(dir)?;
        fs::set_permissions(dir, fs::Permissions::from_mode(DIR_MODE))?;
    }
    Ok(())
}

fn open_private(path: &Path, append: bool) -> io::Result<File> {
    let mut o = OpenOptions::new();
    o.create(true).mode(FILE_MODE);
    if append {
        o.append(true);
    } else {
        o.write(true);
    }
    o.open(path)
}

/// Who is recording: `--by`, else the login name, else "unknown".
pub fn default_by() -> String {
    std::env::var("USER")
        .ok()
        .filter(|u| !u.is_empty())
        .unwrap_or_else(|| BY_UNKNOWN.to_string())
}

/// The author of imported decisions.
pub fn import_by() -> &'static str {
    BY_IMPORT
}

const SECS_PER_DAY: u64 = 86_400;
/// Days from 0000-03-01 to 1970-01-01, and the lengths of the 400-year cycle and its parts (Hinnant's algorithm).
const EPOCH_SHIFT_DAYS: i64 = 719_468;
const DAYS_PER_ERA: i64 = 146_097;
const YEARS_PER_ERA: i64 = 400;
const DAYS_PER_YEAR: i64 = 365;
const DAYS_PER_4_YEARS: i64 = 1_460;
const DAYS_PER_CENTURY: i64 = 36_524;
const LAST_DAY_OF_ERA: i64 = 146_096;
/// Months counted from March: 153 days in each 5 months, and the shift back to January-first numbering.
const DAYS_PER_5_MONTHS: i64 = 153;
const MONTHS_PER_5: i64 = 5;
const MARCH_BASED_SHIFT: i64 = 3;
const MONTHS_PER_YEAR_LESS_MARCH_SHIFT: i64 = 9;
const FIRST_MONTH_OF_NEXT_YEAR: i64 = 10;
const LAST_MONTH_OF_PREVIOUS_YEAR_RANGE: i64 = 2;
const SECS_PER_HOUR: u64 = 3_600;
const SECS_PER_MINUTE: u64 = 60;

/// Now, in UTC, as `YYYY-MM-DDTHH:MM:SSZ`.
pub fn utc_now() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    utc_text(secs)
}

/// Seconds since 1970 as `YYYY-MM-DDTHH:MM:SSZ` (the civil-from-days algorithm of H. Hinnant).
pub fn utc_text(secs: u64) -> String {
    let days = (secs / SECS_PER_DAY) as i64;
    let rem = secs % SECS_PER_DAY;
    let z = days + EPOCH_SHIFT_DAYS;
    let era = z.div_euclid(DAYS_PER_ERA);
    let doe = z.rem_euclid(DAYS_PER_ERA);
    let yoe = (doe - doe / DAYS_PER_4_YEARS + doe / DAYS_PER_CENTURY - doe / LAST_DAY_OF_ERA)
        / DAYS_PER_YEAR;
    let doy = doe - (DAYS_PER_YEAR * yoe + yoe / 4 - yoe / 100);
    let mp = (MONTHS_PER_5 * doy + 2) / DAYS_PER_5_MONTHS;
    let day = doy - (DAYS_PER_5_MONTHS * mp + 2) / MONTHS_PER_5 + 1;
    let month = if mp < FIRST_MONTH_OF_NEXT_YEAR {
        mp + MARCH_BASED_SHIFT
    } else {
        mp - MONTHS_PER_YEAR_LESS_MARCH_SHIFT
    };
    let year = yoe + era * YEARS_PER_ERA + i64::from(month <= LAST_MONTH_OF_PREVIOUS_YEAR_RANGE);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        rem / SECS_PER_HOUR,
        rem % SECS_PER_HOUR / SECS_PER_MINUTE,
        rem % SECS_PER_MINUTE
    )
}

/// A time as the checkout's files write it, in UTC as the log keeps it: `YYYY-MM-DD` (midnight UTC), or
/// `YYYY-MM-DDTHH:MM[:SS[.fraction]]` with `Z` or a `+HH:MM`/`-HH:MM` offset. None for anything else.
pub fn to_utc(text: &str) -> Option<String> {
    let t = text.trim();
    let num = |a: usize, b: usize| {
        t.get(a..b)
            .filter(|x| x.bytes().all(|c| c.is_ascii_digit()))
            .and_then(|x| x.parse::<i64>().ok())
    };
    let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    if t.get(4..5) != Some("-")
        || t.get(7..8) != Some("-")
        || !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if t.len() == DATE_LEN {
        return Some(utc_text(u64::try_from(days * SECS_PER_DAY as i64).ok()?));
    }
    if t.get(10..11) != Some("T") || t.get(13..14) != Some(":") {
        return None;
    }
    let (hour, minute) = (num(11, 13)?, num(14, 16)?);
    let mut rest = &t[16..];
    let mut second = 0;
    if let Some(r) = rest.strip_prefix(':') {
        second = r
            .get(0..2)
            .filter(|x| x.bytes().all(|c| c.is_ascii_digit()))?
            .parse::<i64>()
            .ok()?;
        rest = &r[2..];
        if let Some(r) = rest.strip_prefix('.') {
            rest = r.trim_start_matches(|c: char| c.is_ascii_digit());
        }
    }
    let offset = match rest {
        "Z" => 0,
        o if o.len() == OFFSET_LEN
            && (o.starts_with('+') || o.starts_with('-'))
            && o.get(3..4) == Some(":") =>
        {
            let h = o.get(1..3)?.parse::<i64>().ok()?;
            let m = o.get(4..6)?.parse::<i64>().ok()?;
            let sign = if o.starts_with('-') { -1 } else { 1 };
            sign * (h * SECS_PER_HOUR as i64 + m * SECS_PER_MINUTE as i64)
        }
        _ => return None,
    };
    let secs = days * SECS_PER_DAY as i64
        + hour * SECS_PER_HOUR as i64
        + minute * SECS_PER_MINUTE as i64
        + second
        - offset;
    Some(utc_text(u64::try_from(secs).ok()?))
}

const DATE_LEN: usize = 10;
const OFFSET_LEN: usize = 6;

/// Days since 1970-01-01 of a civil date (Hinnant's days_from_civil).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= LAST_MONTH_OF_PREVIOUS_YEAR_RANGE {
        year - 1
    } else {
        year
    };
    let era = y.div_euclid(YEARS_PER_ERA);
    let yoe = y - era * YEARS_PER_ERA;
    let m = if month > LAST_MONTH_OF_PREVIOUS_YEAR_RANGE {
        month - MARCH_BASED_SHIFT
    } else {
        month + MONTHS_PER_YEAR_LESS_MARCH_SHIFT
    };
    let doy = (DAYS_PER_5_MONTHS * m + 2) / MONTHS_PER_5 + day - 1;
    let doe = yoe * DAYS_PER_YEAR + yoe / 4 - yoe / 100 + doy;
    era * DAYS_PER_ERA + doe - EPOCH_SHIFT_DAYS
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utc_text_matches_known_instants() {
        assert_eq!(utc_text(0), "1970-01-01T00:00:00Z");
        assert_eq!(utc_text(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(utc_text(1_793_718_131), "2026-11-03T15:02:11Z");
    }

    #[test]
    fn to_utc_reads_the_checkouts_times() {
        assert_eq!(
            to_utc("2026-10-01").as_deref(),
            Some("2026-10-01T00:00:00Z")
        );
        assert_eq!(
            to_utc("2026-10-04T00:13:17+01:00").as_deref(),
            Some("2026-10-03T23:13:17Z")
        );
        assert_eq!(
            to_utc("2026-11-04T14:09:26+00:00").as_deref(),
            Some("2026-11-04T14:09:26Z")
        );
        assert_eq!(
            to_utc("2026-03-01T01:00:00-02:30").as_deref(),
            Some("2026-03-01T03:30:00Z")
        );
        assert_eq!(
            to_utc("2024-02-29T23:59:59.250Z").as_deref(),
            Some("2024-02-29T23:59:59Z")
        );
        assert_eq!(
            to_utc("2026-09-25T16:10Z").as_deref(),
            Some("2026-09-25T16:10:00Z")
        );
        for bad in [
            "",
            "yesterday",
            "2026-13-01",
            "2026-10-01T25",
            "2026-10-01 10:00:00Z",
            "2026-10-01T10:00:00+0100",
        ] {
            assert_eq!(to_utc(bad), None, "{bad}");
        }
    }
}
