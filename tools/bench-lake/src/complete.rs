//! Whether a run is complete, from its collection note alone (lakelib.state.complete).

use crate::absent::Absent;
use serde_json::{Number, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum Completeness {
    Complete { state: Option<String>, settled_at: Option<Number>, collected_at: Option<Number> },
    Incomplete { state: Option<String>, settled_at: Option<Number>, collected_at: Option<Number> },
    NoNote,
}

impl Completeness {
    /// `complete`, `incomplete` or `no-note`.
    pub fn as_str(&self) -> &'static str {
        todo!("Completeness::as_str")
    }
}

/// The decision over a parsed note (pure).
pub fn decide(note: &Value) -> Result<Completeness, &'static str> {
    let _ = note;
    todo!("decide")
}
