//! The conversation database (the warehouse): schema.sql, and every read and write the ingest and
//! the conversation API make. One writer (the collector); readers open it read-only in WAL mode.

use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

pub const SCHEMA: &str = include_str!("schema.sql");
pub const SCHEMA_VERSION: i64 = 2;
/// A text column's head and tail, kept beside the whole text for a quick look (build_full.py's H and T).
pub const HEAD_CHARS: usize = 400;
pub const TAIL_CHARS: usize = 700;
pub const MSG_HEAD_CHARS: usize = 600;

pub struct Db {
    pub conn: Connection,
}

/// One row of the events stream.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    pub ord: i64,
    pub t_ms: i64,
    pub kind: String,
    pub ref_idx: Option<i64>,
    pub payload: Value,
}

/// An event before it has its ord.
#[derive(Debug, Clone, PartialEq)]
pub struct NewEvent {
    pub t_ms: i64,
    pub kind: String,
    pub ref_idx: Option<i64>,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Default)]
pub struct Collection {
    pub node: Option<String>,
    pub collected_at: Option<f64>,
    pub complete: bool,
    pub events_source: String,
    pub events_path: Option<String>,
    pub events_bytes: i64,
    pub events_consumed: i64,
    pub has_server_log: bool,
    pub has_proxy_log: bool,
    pub has_egress: bool,
    pub has_progress: bool,
    pub has_conditions: bool,
    pub inputs_digest: String,
    pub ingested_at: f64,
    pub ingest_version: i64,
    pub ingest_s: f64,
}

fn head(s: &str) -> &str {
    super::py::head_chars(s, HEAD_CHARS)
}

fn tail(s: &str) -> &str {
    super::py::tail_chars(s, TAIL_CHARS)
}

fn join(flags: &[&str]) -> String {
    flags.join(",")
}

fn num_i64(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_f64().map(|f| f as i64))
}

fn text_or_null(v: &Value) -> Option<String> {
    match v {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        other => Some(other.to_string()),
    }
}

impl Db {
    /// Open (creating the schema when the file is new). The writer's handle.
    pub fn open(path: &Path) -> Result<Db> {
        let conn = Connection::open(path).with_context(|| format!("open {}", path.display()))?;
        let db = Db { conn };
        db.init()?;
        Ok(db)
    }

    /// A read-only handle: the conversation API's, beside the writer.
    pub fn open_read_only(path: &Path) -> Result<Db> {
        let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)
            .with_context(|| format!("open {} read-only", path.display()))?;
        Ok(Db { conn })
    }

    pub fn open_memory() -> Result<Db> {
        let db = Db { conn: Connection::open_in_memory()? };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        self.conn.execute_batch(SCHEMA).context("create the schema")?;
        let version: i64 = self.conn.query_row("pragma user_version", [], |r| r.get(0))?;
        anyhow::ensure!(version == SCHEMA_VERSION, "schema version {version}, expected {SCHEMA_VERSION}");
        self.conn.execute("insert or replace into meta(key, value) values ('schema_version', ?1)", params![SCHEMA_VERSION.to_string()])?;
        Ok(())
    }

    pub fn set_meta(&self, key: &str, value: &str) -> Result<()> {
        self.conn.execute("insert or replace into meta(key, value) values (?1, ?2)", params![key, value])?;
        Ok(())
    }

    pub fn meta(&self, key: &str) -> Result<Option<String>> {
        Ok(self.conn.query_row("select value from meta where key = ?1", params![key], |r| r.get(0)).optional()?)
    }

    // ---- runs and stories ----

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_run(&self, id: &str, parts: &super::RunParts, run_json: &Value, status_json: &Value, node: Option<&str>, now: f64) -> Result<()> {
        let g = |k: &str| run_json.get(k).and_then(Value::as_str).map(String::from);
        let started_at = run_json.get("started_at").and_then(Value::as_str).and_then(super::epoch_of);
        self.conn.execute(
            "insert into runs(id, pack, stack, family, variant, engine, client, machine, run, node, host, pack_version, harness_commit,
                harness_release, model_id, started_at, ended_at, state, state_at, invalid, known_good, run_json, run_status_json, ingested_at)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24)
             on conflict(id) do update set pack = excluded.pack, stack = excluded.stack, family = excluded.family, variant = excluded.variant,
                engine = excluded.engine, client = excluded.client, machine = excluded.machine, run = excluded.run,
                node = coalesce(excluded.node, runs.node), host = excluded.host, pack_version = excluded.pack_version,
                harness_commit = excluded.harness_commit, harness_release = excluded.harness_release, model_id = excluded.model_id,
                started_at = excluded.started_at, ended_at = excluded.ended_at, state = excluded.state, state_at = excluded.state_at,
                invalid = excluded.invalid, known_good = excluded.known_good, run_json = excluded.run_json,
                run_status_json = excluded.run_status_json, ingested_at = excluded.ingested_at",
            params![
                id, parts.pack, parts.stack, parts.family, parts.variant, parts.engine, parts.client, parts.machine, parts.run, node,
                run_json.get("host").map(|h| h.to_string()), g("pack_version"), g("harness_commit"), g("harness_release"), g("model_id"),
                started_at, status_json.get("at").and_then(Value::as_str).and_then(super::epoch_of),
                status_json.get("state").and_then(Value::as_str), status_json.get("at").and_then(Value::as_str),
                i64::from(super::py::truthy(run_json.get("invalid"))), i64::from(g("known_good_from").is_some_and(|s| !s.is_empty())),
                run_json.to_string(), status_json.to_string(), now
            ],
        )?;
        Ok(())
    }

    pub fn story_sk(&self, rel: &str) -> Result<Option<i64>> {
        Ok(self.conn.query_row("select sk from stories where rel = ?1", params![rel], |r| r.get(0)).optional()?)
    }

    /// The story's row, inserted or updated; its sk never changes once given.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_story(&self, rel: &str, run_id: &str, story: i64, parts: &super::RunParts, rec: &Value, run_json: &Value, rows: &super::events::Rows, source: &str) -> Result<i64> {
        let acc = rec.get("accept").cloned().unwrap_or(Value::Null);
        let agent = rec.get("agent").cloned().unwrap_or(Value::Null);
        let tokens = agent.get("tokens").cloned().unwrap_or(Value::Null);
        let json_or_null = |k: &str| rec.get(k).filter(|v| !v.is_null()).map(|v| v.to_string());
        let n = |v: Option<&Value>| v.and_then(num_i64);
        let f = |v: Option<&Value>| v.and_then(Value::as_f64);
        self.conn.execute(
            "insert into stories(pack, stack, family, variant, engine, client, machine, run, story, rel, status, passed, total, wall, fmt, source,
                truncated_strings, truncated_chars, v2, invalid, nudges, started, finished,
                run_id, title, ended_by, attempts, first_started, agent_seconds, out_tok, in_tok, cache_tok, not_comparable,
                time_split_json, conversation_json, conditions_json, requests_json, provenance_json)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23,
                ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32, ?33, ?34, ?35, ?36, ?37, ?38)
             on conflict(rel) do update set status = excluded.status, passed = excluded.passed, total = excluded.total, wall = excluded.wall,
                fmt = excluded.fmt, source = excluded.source, truncated_strings = excluded.truncated_strings, truncated_chars = excluded.truncated_chars,
                v2 = excluded.v2, invalid = excluded.invalid, nudges = excluded.nudges, started = excluded.started, finished = excluded.finished,
                run_id = excluded.run_id, title = excluded.title, ended_by = excluded.ended_by, attempts = excluded.attempts,
                first_started = excluded.first_started, agent_seconds = excluded.agent_seconds, out_tok = excluded.out_tok, in_tok = excluded.in_tok,
                cache_tok = excluded.cache_tok, not_comparable = excluded.not_comparable, time_split_json = excluded.time_split_json,
                conversation_json = excluded.conversation_json, conditions_json = excluded.conditions_json, requests_json = excluded.requests_json,
                provenance_json = excluded.provenance_json",
            params![
                parts.pack, parts.stack, parts.family, parts.variant, parts.engine, parts.client, parts.machine, parts.run, story, rel,
                rec.get("status").and_then(Value::as_str), n(acc.get("passed")), n(acc.get("total")),
                f(rec.get("time_split").and_then(|t| t.get("wall_s"))), rows.fmt, source,
                rows.truncated_strings, rows.truncated_chars, i64::from(parts.run.starts_with("v2-")), i64::from(super::py::truthy(run_json.get("invalid"))),
                n(agent.get("nudges")), f(rec.get("first_started")).or_else(|| f(rec.get("started"))), f(rec.get("agent_finished")),
                run_id, rec.get("title").and_then(Value::as_str), rec.get("ended_by").and_then(Value::as_str),
                agent.get("attempts").and_then(Value::as_array).map(|a| a.len() as i64), f(rec.get("first_started")), f(agent.get("seconds")),
                n(tokens.get("output")), n(tokens.get("input")), n(tokens.get("cache_read")),
                rec.get("not_comparable").and_then(text_or_null),
                json_or_null("time_split"), json_or_null("conversation"), json_or_null("conditions"), json_or_null("requests"), json_or_null("provenance")
            ],
        )?;
        self.story_sk(rel)?.context("story just written has no sk")
    }

    /// The story's calls, tools, messages, compactions, attempts and sessions, replaced whole.
    pub fn replace_story_rows(&mut self, sk: i64, rows: &super::events::Rows, timing: &super::timing::Parsed, rec: &Value) -> Result<()> {
        let tx = self.conn.transaction()?;
        for table in ["calls", "tools", "msgs", "compactions", "attempts", "sessions"] {
            tx.execute(&format!("delete from {table} where sk = ?1"), params![sk])?;
        }
        let timed = super::join_call_timing(rows, timing);
        for (c, t) in rows.calls.iter().zip(timed.iter()) {
            tx.execute(
                "insert into calls(sk, idx, rx, think, text, n_tools, out_tok, in_tok, cache_tok, stop, sub, think_flags, text_flags, think_full, text_full,
                    think_head, think_tail, text_head, text_tail, sent, first, attempt)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
                params![
                    sk, c.idx as i64, c.rx.as_f64(), c.think as i64, c.text as i64, c.n_tools as i64, num_i64(&c.out_tok), num_i64(&c.in_tok), num_i64(&c.cache_tok),
                    text_or_null(&c.stop), c.sub, join(&c.think_flags), join(&c.text_flags), c.think_full, c.text_full,
                    head(&c.think_full), tail(&c.think_full), head(&c.text_full), tail(&c.text_full),
                    t.as_ref().map(|t| t.sent), t.as_ref().map(|t| t.first), Option::<i64>::None
                ],
            )?;
        }
        for t in &rows.tools {
            let res = t.res.as_deref().unwrap_or("");
            tx.execute(
                "insert into tools(sk, call_idx, idx, tid, name, arg, arg_full, arg_chars, start, end, error, res_chars, sub, arg_flags, res_flags, n_edits,
                    old_chars, new_chars, passed, failed, flaky, skipped, args_json, res_full, res_head, res_tail, kind)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)",
                params![
                    sk, t.call as i64, t.idx as i64, text_or_null(&t.tid), text_or_null(&t.name), t.arg, super::py::chars(&t.arg) as i64, t.arg_chars as i64,
                    t.start.as_f64(), t.end.as_f64(), t.error, t.res_chars.map(|n| n as i64), t.sub, join(&t.arg_flags), join(&t.res_flags), t.n_edits,
                    t.old_chars as i64, t.new_chars as i64, t.passed, t.failed, t.flaky, t.skipped, t.args_json, t.res, head(res), tail(res), t.kind
                ],
            )?;
        }
        for m in &rows.msgs {
            tx.execute(
                "insert into msgs(sk, idx, rx, role, chars, text_full, text_head) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![sk, m.idx as i64, m.rx.as_f64(), m.role, m.chars as i64, m.text, super::py::head_chars(&m.text, MSG_HEAD_CHARS)],
            )?;
        }
        for c in &rows.compactions {
            tx.execute(
                "insert into compactions(sk, start, end, reason, summary_chars, summary) values (?1, ?2, ?3, ?4, ?5, ?6)",
                params![sk, c.start.as_f64(), c.end.as_f64(), text_or_null(&c.reason), c.summary_chars as i64, c.summary],
            )?;
        }
        let agent = rec.get("agent").cloned().unwrap_or(Value::Null);
        if let Some(attempts) = agent.get("attempts").and_then(Value::as_array) {
            for (i, a) in attempts.iter().enumerate() {
                let n = a.get("attempt").and_then(num_i64).unwrap_or(i as i64 + 1);
                let g = |k: &str| a.get(k).and_then(num_i64);
                tx.execute(
                    "insert into attempts(sk, n, source, started, ended, seconds, steps, tool_calls, compactions, nudges, resumes, tokens_json, time_split_json)
                     values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    params![
                        sk, n, a.get("source").and_then(Value::as_str), a.get("started").and_then(Value::as_f64), a.get("ended").and_then(Value::as_f64),
                        a.get("seconds").and_then(Value::as_f64), g("steps"), g("tool_calls"), g("compactions"), g("nudges"), g("resumes"),
                        a.get("tokens").map(|v| v.to_string()), a.get("time_split").map(|v| v.to_string())
                    ],
                )?;
                for (j, s) in a.get("sessions").and_then(Value::as_array).into_iter().flatten().enumerate() {
                    tx.execute("insert into sessions(sk, attempt, idx, session_id) values (?1, ?2, ?3, ?4)", params![sk, n, j as i64, text_or_null(s)])?;
                }
            }
        } else if let Some(sessions) = agent.get("sessions").and_then(Value::as_array) {
            for (j, s) in sessions.iter().enumerate() {
                tx.execute("insert into sessions(sk, attempt, idx, session_id) values (?1, 1, ?2, ?3)", params![sk, j as i64, text_or_null(s)])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn replace_requests(&mut self, run_id: &str, source: &str, reqs: &[super::RequestRow]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("delete from requests where run_id = ?1 and source = ?2", params![run_id, source])?;
        for (i, r) in reqs.iter().enumerate() {
            tx.execute(
                "insert into requests(run_id, source, idx, sk, call_idx, ts, server_start, prompt_tok, prefill_tok, generated_tok, cached_tok,
                    prefill_s, decode_s, ttft_s, prefill_tok_s, decode_tok_s, draft_accepted, draft_proposed, rounds, mean_len, context_len, finish, status)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
                params![
                    run_id, source, i as i64, r.sk, r.call_idx, r.ts, r.server_start.filter(|s| s.is_finite()), r.prompt_tok, r.prefill_tok, r.generated_tok,
                    r.cached_tok, r.prefill_s, r.decode_s, r.ttft_s, r.prefill_tok_s, r.decode_tok_s, r.draft_accepted, r.draft_proposed, r.rounds,
                    r.mean_len, r.context_len, r.finish, r.status
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn replace_conditions(&mut self, run_id: &str, rows: &[super::ConditionRow]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("delete from conditions where run_id = ?1", params![run_id])?;
        for c in rows {
            tx.execute(
                "insert or replace into conditions(run_id, at, sk, ac, low_power, thermal, swap_gb, free_pct, footprint_gb, footprint_peak_gb,
                    gpu_busy_pct, gpu_sclk_mhz, gpu_mem_gb, gpu_temp_c, gpu_power_w, gpu_throttle)
                 values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    run_id, c.at, c.sk, c.ac, c.low_power, c.thermal, c.swap_gb, c.free_pct, c.footprint_gb, c.footprint_peak_gb,
                    c.gpu_busy_pct, c.gpu_sclk_mhz, c.gpu_mem_gb, c.gpu_temp_c, c.gpu_power_w, c.gpu_throttle
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn set_collection(&self, sk: i64, c: &Collection) -> Result<()> {
        self.conn.execute(
            "insert or replace into collection(sk, node, collected_at, complete, events_source, events_path, events_bytes, events_consumed,
                has_server_log, has_proxy_log, has_egress, has_progress, has_conditions, inputs_digest, ingested_at, ingest_version, ingest_s)
             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                sk, c.node, c.collected_at, i64::from(c.complete), c.events_source, c.events_path, c.events_bytes, c.events_consumed,
                i64::from(c.has_server_log), i64::from(c.has_proxy_log), i64::from(c.has_egress), i64::from(c.has_progress), i64::from(c.has_conditions),
                c.inputs_digest, c.ingested_at, c.ingest_version, c.ingest_s
            ],
        )?;
        Ok(())
    }

    /// The digest the story was last ingested from, and whether that ingest saw the story complete.
    pub fn collection_digest(&self, sk: i64) -> Result<Option<(String, bool)>> {
        Ok(self
            .conn
            .query_row("select inputs_digest, complete from collection where sk = ?1", params![sk], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? != 0)))
            .optional()?)
    }

    // ---- the events stream ----

    /// Replace a story's whole stream: the rows in the order given get ord 0, 1, 2, … (a finished story,
    /// whose time order and ingest order are then the same).
    pub fn replace_events(&mut self, sk: i64, events: &[NewEvent]) -> Result<()> {
        let tx = self.conn.transaction()?;
        tx.execute("delete from events where sk = ?1", params![sk])?;
        for (ord, e) in events.iter().enumerate() {
            tx.execute(
                "insert into events(sk, ord, t_ms, kind, ref_idx, payload_json) values (?1, ?2, ?3, ?4, ?5, ?6)",
                params![sk, ord as i64, e.t_ms, e.kind, e.ref_idx, e.payload.to_string()],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Append the rows not yet in the story's stream (by kind, ref_idx and time), each with the next
    /// ord; rows already there keep theirs. Returns how many were added.
    pub fn append_events(&mut self, sk: i64, events: &[NewEvent]) -> Result<usize> {
        let tx = self.conn.transaction()?;
        let mut have = std::collections::HashSet::new();
        {
            let mut q = tx.prepare("select kind, ref_idx, t_ms from events where sk = ?1")?;
            for row in q.query_map(params![sk], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, i64>(2)?)))? {
                have.insert(row?);
            }
        }
        let mut next: i64 = tx.query_row("select coalesce(max(ord), -1) + 1 from events where sk = ?1", params![sk], |r| r.get(0))?;
        let mut added = 0;
        for e in events {
            let key = (e.kind.clone(), e.ref_idx, e.t_ms);
            if have.contains(&key) {
                continue;
            }
            tx.execute(
                "insert into events(sk, ord, t_ms, kind, ref_idx, payload_json) values (?1, ?2, ?3, ?4, ?5, ?6)",
                params![sk, next, e.t_ms, e.kind, e.ref_idx, e.payload.to_string()],
            )?;
            have.insert(key);
            next += 1;
            added += 1;
        }
        tx.commit()?;
        Ok(added)
    }

    fn event_from_row(r: &rusqlite::Row) -> rusqlite::Result<Event> {
        Ok(Event {
            ord: r.get(0)?,
            t_ms: r.get(1)?,
            kind: r.get(2)?,
            ref_idx: r.get(3)?,
            payload: serde_json::from_str(&r.get::<_, String>(4)?).unwrap_or(Value::Null),
        })
    }

    /// Events with from_ms <= t_ms < to_ms, in (t_ms, ord) order, after the cursor (t_ms, ord) if one, at most `limit`.
    pub fn events_in_range(&self, sk: i64, from_ms: i64, to_ms: i64, after: Option<(i64, i64)>, limit: usize) -> Result<Vec<Event>> {
        let (c_t, c_ord) = after.unwrap_or((i64::MIN, i64::MIN));
        let mut q = self.conn.prepare(
            "select ord, t_ms, kind, ref_idx, payload_json from events
             where sk = ?1 and t_ms >= ?2 and t_ms < ?3 and (t_ms > ?4 or (t_ms = ?4 and ord > ?5))
             order by t_ms, ord limit ?6",
        )?;
        let rows = q.query_map(params![sk, from_ms, to_ms, c_t, c_ord, limit as i64], Self::event_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Events with ord > after, in ord order, at most `limit`: everything ingested since.
    pub fn events_after(&self, sk: i64, after: i64, limit: usize) -> Result<Vec<Event>> {
        let mut q = self.conn.prepare("select ord, t_ms, kind, ref_idx, payload_json from events where sk = ?1 and ord > ?2 order by ord limit ?3")?;
        let rows = q.query_map(params![sk, after, limit as i64], Self::event_from_row)?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// (first t_ms, last t_ms, latest ord, count) of a story's stream, or None when it has none.
    pub fn events_range(&self, sk: i64) -> Result<Option<(i64, i64, i64, i64)>> {
        let row: (Option<i64>, Option<i64>, Option<i64>, i64) = self.conn.query_row(
            "select min(t_ms), max(t_ms), max(ord), count(*) from events where sk = ?1",
            params![sk],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )?;
        Ok(match row {
            (Some(a), Some(b), Some(o), n) => Some((a, b, o, n)),
            _ => None,
        })
    }

    pub fn count(&self, table: &str, sk: i64) -> Result<i64> {
        Ok(self.conn.query_row(&format!("select count(*) from {table} where sk = ?1"), params![sk], |r| r.get(0))?)
    }

    pub fn story_fmt(&self, sk: i64) -> Result<Option<String>> {
        Ok(self.conn.query_row("select fmt from stories where sk = ?1", params![sk], |r| r.get(0)).optional()?)
    }

    /// Every story run id whose collection is complete.
    pub fn complete_story_ids(&self) -> Result<Vec<String>> {
        let mut q = self.conn.prepare("select s.rel from stories s join collection c on c.sk = s.sk where c.complete = 1 order by s.rel")?;
        let rows = q.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// Every story run id with any ingested events (complete or still growing).
    pub fn story_ids_with_events(&self) -> Result<Vec<String>> {
        let mut q = self.conn.prepare("select rel from stories where sk in (select distinct sk from events) order by rel")?;
        let rows = q.query_map([], |r| r.get::<_, String>(0))?;
        Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
    }

    /// One call in full: the row as JSON with its tools.
    pub fn call(&self, sk: i64, idx: i64) -> Result<Option<Value>> {
        let call = self
            .conn
            .query_row(
                "select idx, rx, think, text, n_tools, out_tok, in_tok, cache_tok, stop, sub, think_flags, text_flags, think_full, text_full, sent, first
                 from calls where sk = ?1 and idx = ?2",
                params![sk, idx],
                |r| {
                    Ok(serde_json::json!({
                        "idx": r.get::<_, i64>(0)?, "rx": r.get::<_, Option<f64>>(1)?, "think": r.get::<_, i64>(2)?, "text": r.get::<_, i64>(3)?,
                        "nTools": r.get::<_, i64>(4)?, "outTok": r.get::<_, Option<i64>>(5)?, "inTok": r.get::<_, Option<i64>>(6)?,
                        "cacheTok": r.get::<_, Option<i64>>(7)?, "stop": r.get::<_, Option<String>>(8)?, "sub": r.get::<_, i64>(9)?,
                        "thinkFlags": r.get::<_, String>(10)?, "textFlags": r.get::<_, String>(11)?, "thinking": r.get::<_, String>(12)?,
                        "text": r.get::<_, String>(13)?, "sent": r.get::<_, Option<f64>>(14)?, "first": r.get::<_, Option<f64>>(15)?,
                    }))
                },
            )
            .optional()?;
        let Some(mut call) = call else { return Ok(None) };
        let mut q = self.conn.prepare("select idx from tools where sk = ?1 and call_idx = ?2 order by idx")?;
        let ids: Vec<i64> = q.query_map(params![sk, idx], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        let mut tools = Vec::new();
        for i in ids {
            if let Some(t) = self.tool(sk, i)? {
                tools.push(t);
            }
        }
        call["tools"] = Value::Array(tools);
        Ok(Some(call))
    }

    /// One tool call in full, its result whole.
    pub fn tool(&self, sk: i64, idx: i64) -> Result<Option<Value>> {
        Ok(self
            .conn
            .query_row(
                "select idx, call_idx, tid, name, kind, arg, arg_chars, start, end, error, res_chars, sub, arg_flags, res_flags, n_edits, old_chars, new_chars,
                    passed, failed, flaky, skipped, args_json, res_full
                 from tools where sk = ?1 and idx = ?2",
                params![sk, idx],
                |r| {
                    Ok(serde_json::json!({
                        "idx": r.get::<_, i64>(0)?, "callIdx": r.get::<_, i64>(1)?, "id": r.get::<_, Option<String>>(2)?, "name": r.get::<_, Option<String>>(3)?,
                        "kind": r.get::<_, Option<String>>(4)?, "arg": r.get::<_, String>(5)?, "argChars": r.get::<_, i64>(6)?,
                        "start": r.get::<_, Option<f64>>(7)?, "end": r.get::<_, Option<f64>>(8)?, "error": r.get::<_, Option<i64>>(9)?,
                        "resChars": r.get::<_, Option<i64>>(10)?, "sub": r.get::<_, i64>(11)?, "argFlags": r.get::<_, String>(12)?,
                        "resFlags": r.get::<_, String>(13)?, "nEdits": r.get::<_, i64>(14)?, "oldChars": r.get::<_, i64>(15)?, "newChars": r.get::<_, i64>(16)?,
                        "passed": r.get::<_, Option<i64>>(17)?, "failed": r.get::<_, Option<i64>>(18)?, "flaky": r.get::<_, Option<i64>>(19)?,
                        "skipped": r.get::<_, Option<i64>>(20)?, "args": serde_json::from_str::<Value>(&r.get::<_, String>(21)?).unwrap_or(Value::Null),
                        "result": r.get::<_, Option<String>>(22)?,
                    }))
                },
            )
            .optional()?)
    }
}
