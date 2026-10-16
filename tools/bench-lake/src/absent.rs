//! Typed absence and refusal (lakelib.absence.typed).

use crate::canonical;
use crate::layout::RunRef;
use serde_json::Value;
use std::io;

pub const DETAIL_NO_RUN: &str = "no run with this id";
pub const DETAIL_NOT_COLLECTED: &str = "no such file";
pub const DETAIL_NOT_A_FILE: &str = "not a regular file";
pub const DETAIL_PERMISSION: &str = "permission denied";
pub const DETAIL_IO: &str = "io error";
pub const DETAIL_NOT_JSON: &str = "not valid JSON";
pub const DETAIL_NOT_UTF8: &str = "not valid UTF-8";
pub const DETAIL_NOT_GZIP: &str = "not valid gzip";
pub const TEXT_NO_NODE: &str = "-";
pub const CODE_NO_RUN: &str = "E-LAKE-NO-RUN";
pub const CODE_NOT_COLLECTED: &str = "E-LAKE-NOT-COLLECTED";
pub const CODE_NOT_A_FILE: &str = "E-LAKE-NOT-A-FILE";
pub const CODE_UNREADABLE: &str = "E-LAKE-UNREADABLE";
pub const CODE_MALFORMED: &str = "E-LAKE-MALFORMED";
pub const CODE_BAD_NAME: &str = "E-LAKE-BAD-NAME";
pub const CODE_DEST_INSIDE_ROOT: &str = "E-LAKE-DEST-INSIDE-ROOT";
pub const CODE_DEST_NOT_EMPTY: &str = "E-LAKE-DEST-NOT-EMPTY";
pub const CODE_GIT_FAILED: &str = "E-LAKE-GIT-FAILED";

/// What was asked for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Item {
    Run,
    /// The canonical item text after `record:` (for example `accept:1`).
    Record(String),
    Log(i64),
    Bundle,
    Workspace(i64),
}

/// Why it is not there, with the fixed detail text that both languages print.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reason {
    NoRun,
    NotCollected,
    NotAFile,
    /// The detail: `permission denied` or `io error`.
    Unreadable(String),
    /// The detail, one of the fixed malformed texts of CANONICAL.md.
    Malformed(String),
    /// The detail: `story out of range` or `version not valid`.
    BadName(String),
}

impl Reason {
    pub fn code(&self) -> &'static str {
        match self {
            Reason::NoRun => CODE_NO_RUN,
            Reason::NotCollected => CODE_NOT_COLLECTED,
            Reason::NotAFile => CODE_NOT_A_FILE,
            Reason::Unreadable(_) => CODE_UNREADABLE,
            Reason::Malformed(_) => CODE_MALFORMED,
            Reason::BadName(_) => CODE_BAD_NAME,
        }
    }
    pub fn detail(&self) -> String {
        match self {
            Reason::NoRun => DETAIL_NO_RUN.to_string(),
            Reason::NotCollected => DETAIL_NOT_COLLECTED.to_string(),
            Reason::NotAFile => DETAIL_NOT_A_FILE.to_string(),
            Reason::Unreadable(d) | Reason::Malformed(d) | Reason::BadName(d) => d.clone(),
        }
    }
    /// The reason for an operating system error: `permission denied` for a refusal, `io error` otherwise.
    pub fn from_io(error: &io::Error) -> Reason {
        if error.kind() == io::ErrorKind::PermissionDenied {
            Reason::Unreadable(DETAIL_PERMISSION.to_string())
        } else {
            Reason::Unreadable(DETAIL_IO.to_string())
        }
    }
}

/// A thing that is not there or cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Absent {
    pub run: String,
    pub node: Option<String>,
    pub item: Item,
    pub reason: Reason,
    /// The parser's or the operating system's own message. Not part of the canonical form.
    pub message: Option<String>,
}

impl Absent {
    pub fn new(run: &str, node: Option<&str>, item: Item, reason: Reason) -> Absent {
        Absent { run: run.to_string(), node: node.map(String::from), item, reason, message: None }
    }
    pub fn for_run(run: &RunRef, item: Item, reason: Reason) -> Absent {
        Absent::new(&run.id, run.node.as_deref(), item, reason)
    }
    pub fn code(&self) -> &'static str {
        self.reason.code()
    }
    pub fn detail(&self) -> String {
        self.reason.detail()
    }
    /// `record:accept:1`, `log:2`, `bundle`, `run`, `workspace:1`.
    pub fn item_text(&self) -> String {
        item_text(&self.item)
    }
    /// `run=<id> node=<node or -> item=<item> code=<code> detail=<detail>`.
    pub fn to_text(&self) -> String {
        format!(
            "run={} node={} item={} code={} detail={}",
            self.run,
            self.node.as_deref().unwrap_or(TEXT_NO_NODE),
            self.item_text(),
            self.code(),
            self.detail()
        )
    }
    /// The object `{"code","detail","item","node","run"}`.
    pub fn to_value(&self) -> Value {
        object(&self.run, self.node.as_deref(), &self.item, self.code(), &self.detail())
    }
    /// The canonical JSON of the object (the four-plus-one fields, keys sorted).
    pub fn to_json(&self) -> String {
        canonical(&self.to_value())
    }
}

/// Why a request was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefusedReason {
    DestInsideRoot,
    DestNotEmpty,
    GitClone,
    GitCheckout,
}

impl RefusedReason {
    pub fn code(&self) -> &'static str {
        match self {
            RefusedReason::DestInsideRoot => CODE_DEST_INSIDE_ROOT,
            RefusedReason::DestNotEmpty => CODE_DEST_NOT_EMPTY,
            RefusedReason::GitClone | RefusedReason::GitCheckout => CODE_GIT_FAILED,
        }
    }
    pub fn detail(&self) -> &'static str {
        match self {
            RefusedReason::DestInsideRoot => "destination is inside the lake",
            RefusedReason::DestNotEmpty => "destination is not empty",
            RefusedReason::GitClone => "git clone failed",
            RefusedReason::GitCheckout => "git checkout failed",
        }
    }
}

/// A caller's mistake or a tool failure; never returned for missing data.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refused {
    pub run: String,
    pub node: Option<String>,
    pub item: Item,
    pub reason: RefusedReason,
    /// git's own message for a failure. Not part of the canonical form.
    pub message: Option<String>,
}

impl Refused {
    pub fn code(&self) -> &'static str {
        self.reason.code()
    }
    pub fn to_value(&self) -> Value {
        object(&self.run, self.node.as_deref(), &self.item, self.code(), self.reason.detail())
    }
    pub fn to_json(&self) -> String {
        canonical(&self.to_value())
    }
}

/// An answer that is not a value.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Error {
    Absent(Absent),
    Refused(Refused),
}

impl From<Absent> for Error {
    fn from(a: Absent) -> Error {
        Error::Absent(a)
    }
}

fn item_text(item: &Item) -> String {
    match item {
        Item::Run => "run".to_string(),
        Item::Record(name) => format!("record:{name}"),
        Item::Log(story) => format!("log:{story}"),
        Item::Bundle => "bundle".to_string(),
        Item::Workspace(story) => format!("workspace:{story}"),
    }
}

fn object(run: &str, node: Option<&str>, item: &Item, code: &str, detail: &str) -> Value {
    let mut map = serde_json::Map::new();
    map.insert("code".to_string(), Value::String(code.to_string()));
    map.insert("detail".to_string(), Value::String(detail.to_string()));
    map.insert("item".to_string(), Value::String(item_text(item)));
    map.insert("node".to_string(), node.map_or(Value::Null, |n| Value::String(n.to_string())));
    map.insert("run".to_string(), Value::String(run.to_string()));
    Value::Object(map)
}
