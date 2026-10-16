//! Whether a run is complete, from its collection note alone (lakelib.state.complete).

use crate::absent::{Absent, Item, Reason};
use crate::layout::{Lake, RunRef, MARKER_COLLECTION};
use crate::records::{parse_json, Record};
use crate::{absent_for, read_regular, FileProblem};
use serde_json::{Number, Value};
use std::path::Path;

pub const DETAIL_NOT_OBJECT: &str = "note is not an object";
pub const DETAIL_COMPLETE_NOT_BOOL: &str = "complete is not a boolean";

#[derive(Debug, Clone, PartialEq)]
pub enum Completeness {
    Complete { state: Option<String>, settled_at: Option<Number>, collected_at: Option<Number> },
    Incomplete { state: Option<String>, settled_at: Option<Number>, collected_at: Option<Number> },
    NoNote,
}

impl Completeness {
    /// `complete`, `incomplete` or `no-note`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Completeness::Complete { .. } => "complete",
            Completeness::Incomplete { .. } => "incomplete",
            Completeness::NoNote => "no-note",
        }
    }
}

/// The decision over a parsed note (pure).
pub fn decide(note: &Value) -> Result<Completeness, &'static str> {
    let object = note.as_object().ok_or(DETAIL_NOT_OBJECT)?;
    let complete = object.get("complete").and_then(Value::as_bool).ok_or(DETAIL_COMPLETE_NOT_BOOL)?;
    let state = object.get("run_status").and_then(|s| s.get("state")).and_then(Value::as_str).map(String::from);
    let number = |key: &str| match object.get(key) {
        Some(Value::Number(n)) => Some(n.clone()),
        _ => None,
    };
    let (settled_at, collected_at) = (number("settled_at"), number("collected_at"));
    Ok(if complete {
        Completeness::Complete { state, settled_at, collected_at }
    } else {
        Completeness::Incomplete { state, settled_at, collected_at }
    })
}

impl Lake {
    /// Completeness without reading anything but the note.
    pub fn completeness(&self, run: &RunRef) -> Result<Completeness, Absent> {
        let item = Item::Record(Record::Collection.item_name());
        let bytes = match read_regular(&run.dir, Path::new(MARKER_COLLECTION)) {
            Ok(b) => b,
            Err(FileProblem::Missing) => return Ok(Completeness::NoNote),
            Err(other) => return Err(absent_for(run, item, other)),
        };
        let value = parse_json(&bytes).map_err(|(detail, message)| {
            let mut a = Absent::for_run(run, item.clone(), Reason::Malformed(detail));
            a.message = Some(message);
            a
        })?;
        decide(&value).map_err(|detail| Absent::for_run(run, item, Reason::Malformed(detail.to_string())))
    }
}
