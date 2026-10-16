//! Typed absence and refusal (lakelib.absence.typed).

use crate::layout::RunRef;
use serde_json::Value;
use std::io;

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
        todo!("Reason::code")
    }
    pub fn detail(&self) -> String {
        todo!("Reason::detail")
    }
    /// The reason for an operating system error: `permission denied` for a refusal, `io error` otherwise.
    pub fn from_io(error: &io::Error) -> Reason {
        let _ = error;
        todo!("Reason::from_io")
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
        let _ = (run, node, item, reason);
        todo!("Absent::new")
    }
    pub fn for_run(run: &RunRef, item: Item, reason: Reason) -> Absent {
        let _ = (run, item, reason);
        todo!("Absent::for_run")
    }
    pub fn code(&self) -> &'static str {
        todo!("Absent::code")
    }
    pub fn detail(&self) -> String {
        todo!("Absent::detail")
    }
    /// `record:accept:1`, `log:2`, `bundle`, `run`, `workspace:1`.
    pub fn item_text(&self) -> String {
        todo!("Absent::item_text")
    }
    /// `run=<id> node=<node or -> item=<item> code=<code> detail=<detail>`.
    pub fn to_text(&self) -> String {
        todo!("Absent::to_text")
    }
    /// The object `{"code","detail","item","node","run"}`.
    pub fn to_value(&self) -> Value {
        todo!("Absent::to_value")
    }
    /// The canonical JSON of the object (the four-plus-one fields, keys sorted).
    pub fn to_json(&self) -> String {
        todo!("Absent::to_json")
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
        todo!("RefusedReason::code")
    }
    pub fn detail(&self) -> &'static str {
        todo!("RefusedReason::detail")
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
        todo!("Refused::code")
    }
    pub fn to_value(&self) -> Value {
        todo!("Refused::to_value")
    }
    pub fn to_json(&self) -> String {
        todo!("Refused::to_json")
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
