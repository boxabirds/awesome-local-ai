//! analytics.db: the derived tables (schema.sql) and every write to them.

use super::context::ContextRow;
use super::ThinkRow;
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

pub const SCHEMA: &str = include_str!("schema.sql");

/// What was computed for one story run, and from what.
#[derive(Debug, Clone, PartialEq)]
pub struct StoryMeta {
    pub rel: String,
    pub run_id: Option<String>,
    pub stack: Option<String>,
    pub run: Option<String>,
    pub story: Option<i64>,
    pub n_calls: i64,
    pub think_chars: i64,
    pub think_chars_recorded: Option<i64>,
    pub source_digest: String,
    pub version: i64,
    pub computed_at: f64,
}

pub struct Store {
    pub conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> Result<Store> {
        let conn = Connection::open(path).with_context(|| format!("open {}", path.display()))?;
        // Not WAL: one writer, passes seconds long, and a reader opening the idle file read-only (the sqlite3 CLI, DuckDB)
        // needs no -shm file. A file an earlier version made in WAL mode is converted.
        conn.query_row("pragma journal_mode = delete", [], |r| r.get::<_, String>(0))?;
        Self::init(conn)
    }

    pub fn open_memory() -> Result<Store> {
        Self::init(Connection::open_in_memory()?)
    }

    fn init(conn: Connection) -> Result<Store> {
        conn.execute_batch(SCHEMA).context("create the analytics schema")?;
        Ok(Store { conn })
    }

    /// The digest and version a story run was last computed from.
    pub fn computed(&self, rel: &str) -> Result<Option<(String, i64)>> {
        Ok(self.conn.query_row("select source_digest, version from analytics_story where rel = ?1", params![rel], |r| Ok((r.get(0)?, r.get(1)?))).optional()?)
    }

    /// Replace everything held for a story run, in one transaction.
    pub fn replace_story(&mut self, meta: &StoryMeta, context: &[ContextRow], think: &[ThinkRow]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("delete from call_context where rel = ?1", params![meta.rel])?;
        tx.execute("delete from think_text where rel = ?1", params![meta.rel])?;
        {
            let mut c = tx.prepare(
                "insert into call_context(rel, idx, attempt, frac, t_s, gap_s, dur_s, in_tok, cache_tok, out_tok, context_tok, n_tools, stop,
                   compactions_before, since_compaction, after_compaction, prev_tool_kinds, prev_tool_errors, prev_tests_passed,
                   prev_tests_failed, prev_res_chars, commits_before, since_commit_s)
                 values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23)",
            )?;
            for r in context {
                c.execute(params![
                    meta.rel, r.idx, r.attempt, r.frac, r.t_s, r.gap_s, r.dur_s, r.in_tok, r.cache_tok, r.out_tok, r.context_tok, r.n_tools, r.stop,
                    r.compactions_before, r.since_compaction, r.after_compaction, r.prev_tool_kinds, r.prev_tool_errors, r.prev_tests_passed,
                    r.prev_tests_failed, r.prev_res_chars, r.commits_before, r.since_commit_s
                ])?;
            }
            let mut t = tx.prepare(
                "insert into think_text(rel, idx, chars, words, lines, gzip_ratio, repeat5, max_line_repeat, n_wait, n_hmm, n_actually, n_but_wait,
                   n_alternatively, n_verify, code_share, prompt_overlap, result_overlap, prev_sim, max_prev_sim)
                 values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            )?;
            for r in think {
                let f = &r.features;
                t.execute(params![
                    meta.rel, r.idx, f.chars, f.words, f.lines, f.gzip_ratio, f.repeat5, f.max_line_repeat, f.n_wait, f.n_hmm, f.n_actually,
                    f.n_but_wait, f.n_alternatively, f.n_verify, f.code_share, r.prompt_overlap, r.result_overlap, r.prev_sim, r.max_prev_sim
                ])?;
            }
        }
        tx.execute(
            "insert or replace into analytics_story(rel, run_id, stack, run, story, n_calls, think_chars, think_chars_recorded, think_complete,
               source_digest, version, computed_at)
             values (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                meta.rel, meta.run_id, meta.stack, meta.run, meta.story, meta.n_calls, meta.think_chars, meta.think_chars_recorded,
                meta.think_chars_recorded.map(|r| i64::from(r == meta.think_chars)), meta.source_digest, meta.version, meta.computed_at
            ],
        )?;
        tx.commit()?;
        Ok(())
    }

    pub fn count(&self, table: &str) -> Result<i64> {
        anyhow::ensure!(["analytics_story", "call_context", "think_text"].contains(&table), "unknown table {table}");
        Ok(self.conn.query_row(&format!("select count(*) from {table}"), [], |r| r.get(0))?)
    }
}
