//! dbench: a small server that controls the benchmark harness on one machine,
//! plus a CLI that talks to any number of those servers.
//!
//! The server only ever runs the harness entry point of the latest harness release
//! (harness.rs; the checkout's own only with `--allow-unreleased`, before any release
//! exists), with arguments built from validated names. It never runs a shell string
//! it was sent.

pub mod cli;
pub mod client;
pub mod control;
pub mod events;
pub mod failure;
pub mod harness;
pub mod ids;
pub mod job;
pub mod node;
pub mod progress;
pub mod recovery;
pub mod release;
pub mod release_ci;
pub mod runner;
pub mod server;
pub mod service_unit;
pub mod store;
pub mod sys;
pub mod timefmt;

pub const VERSION: &str = env!("DBENCH_VERSION");
