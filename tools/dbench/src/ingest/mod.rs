//! The ingest: the warehouse half of the collector. It reads what the lake holds for a story (the
//! agent's event log, the model server's log) and the published record, and writes the conversation
//! database (db.rs). The parsers are ports of the harness's own (benchmarks/spec-bench/harness):
//! their output on the fixture logs is held equal to the Python parsers' by tests/ingest.rs against
//! tests/golden, which benchmarks/spec-bench/harness/export_goldens.py writes.

pub mod engine_log;
pub mod events;
pub mod flags;
pub mod llama_log;
pub mod py;
pub mod timing;

use serde::Serialize;

/// One model call as the agent's client streamed it: request sent, prefill ends (first streamed
/// chunk), decode ends; its prompt tokens (fresh and cached) and output tokens. accounting.Call.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Call {
    pub sent: f64,
    pub first: f64,
    pub end: f64,
    pub fresh: i64,
    pub cached: i64,
    pub out: Option<i64>,
}
