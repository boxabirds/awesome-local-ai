//! The analytics layer's thinking features, layers 0 and 1 (docs/designs/thinking-analytics.md): derived from the
//! warehouse, read-only, into analytics.db. A story run is recomputed only when its warehouse inputs or this
//! version changed.

pub mod context;
pub mod store;
pub mod text;

use anyhow::{Context, Result};
use context::{CallIn, ToolIn};
use rusqlite::{params, Connection, OptionalExtension};
use std::collections::HashSet;
use std::path::Path;
use store::{Store, StoryMeta};
use text::{jaccard, overlap, shingles, text_features, Shingles, TextFeatures};

/// Bumped when what is computed for the same warehouse inputs changes; every story run is then recomputed.
pub const ANALYTICS_VERSION: i64 = 1;
/// Stacks whose names start with this are the reference models (Claude Opus, Sonnet): the quality yardstick the
/// benchmark scores against, never a subject of conversation analysis, so their conversations are not analysed
/// (owner, 3 October 2026: including them muddies the optimisation paths).
pub const REFERENCE_STACK_PREFIX: &str = "reference/";
/// Every table that holds rows keyed by a story run's `rel`.
const REL_TABLES: [&str; 5] = ["analytics_story", "call_context", "think_text", "theme_story", "theme_share"];

/// Remove what an earlier version (or a script) wrote for a reference story run.
fn purge_references(store: &Store) -> Result<()> {
    let like = "rel in (select rel from analytics_story where stack like ?1) or rel like '%benchmarks/reference/%'";
    for t in REL_TABLES {
        store.conn.execute(&format!("delete from {t} where {like}"), params![format!("{REFERENCE_STACK_PREFIX}%")])?;
    }
    Ok(())
}

/// Remove what was computed for a story run the warehouse no longer holds (an archived run's, say): the analytics file
/// follows the warehouse, and never outlives what it was computed from.
fn purge_orphans(wh: &Connection, store: &Store) -> Result<usize> {
    let held: HashSet<String> = wh.prepare("select rel from stories where rel is not null")?.query_map([], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
    let mut gone = std::collections::BTreeSet::new();
    for t in REL_TABLES {
        let mut q = store.conn.prepare(&format!("select distinct rel from {t}"))?;
        for rel in q.query_map([], |r| r.get::<_, String>(0))? {
            let rel = rel?;
            if !held.contains(&rel) {
                gone.insert(rel);
            }
        }
    }
    for rel in &gone {
        for t in REL_TABLES {
            store.conn.execute(&format!("delete from {t} where rel = ?1"), params![rel])?;
        }
    }
    Ok(gone.len())
}

/// A block's `max_prev_sim` looks back over this many earlier thinking blocks of the story run.
pub const PREV_WINDOW: usize = 10;

/// The layer-1 row of one call that has thinking.
#[derive(Debug, Clone, PartialEq)]
pub struct ThinkRow {
    pub idx: i64,
    pub features: TextFeatures,
    pub prompt_overlap: Option<f64>,
    pub result_overlap: Option<f64>,
    pub prev_sim: Option<f64>,
    pub max_prev_sim: Option<f64>,
}

/// The layer-1 rows of a story run: each call's thinking as text, against the task, the previous call's tool results
/// and the story run's earlier thinking.
pub fn think_rows(calls: &[CallIn], tools: &[ToolIn], prompt: &str) -> Vec<ThinkRow> {
    let task = shingles(prompt);
    let mut earlier: Vec<Shingles> = Vec::new();
    let mut out = Vec::new();
    for (n, c) in calls.iter().enumerate() {
        let Some(think) = c.think_full.as_deref().filter(|t| !t.trim().is_empty()) else { continue };
        let own = shingles(think);
        let results = n.checked_sub(1).map(|p| calls[p].idx).map(|p| {
            tools.iter().filter(|t| t.call_idx == p).filter_map(|t| t.res_full.as_deref()).collect::<Vec<_>>().join("\n")
        });
        let sims: Vec<f64> = earlier.iter().rev().take(PREV_WINDOW).filter_map(|e| jaccard(&own, e)).collect();
        out.push(ThinkRow {
            idx: c.idx,
            features: text_features(think),
            prompt_overlap: overlap(&own, &task),
            result_overlap: results.filter(|r| !r.trim().is_empty()).and_then(|r| overlap(&own, &shingles(&r))),
            prev_sim: earlier.last().and_then(|e| jaccard(&own, e)),
            max_prev_sim: sims.into_iter().max_by(f64::total_cmp),
        });
        earlier.push(own);
    }
    out
}

/// Which story runs to compute.
#[derive(Debug, Clone, Default)]
pub struct Selection {
    /// Every story run, changed or not.
    pub all: bool,
    /// Only these story runs (`<run dir>/stories/NN`).
    pub only: Vec<String>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Summary {
    pub stories: usize,
    pub computed: usize,
    pub unchanged: usize,
    pub calls: usize,
    pub think_blocks: usize,
    pub seconds: f64,
}

fn load_calls(wh: &Connection, sk: i64) -> Result<Vec<CallIn>> {
    let mut q = wh.prepare("select idx, rx, sent, attempt, in_tok, cache_tok, out_tok, n_tools, stop, think_full from calls where sk = ?1 order by idx")?;
    let rows = q.query_map(params![sk], |r| {
        Ok(CallIn { idx: r.get(0)?, rx: r.get(1)?, sent: r.get(2)?, attempt: r.get(3)?, in_tok: r.get(4)?, cache_tok: r.get(5)?, out_tok: r.get(6)?, n_tools: r.get(7)?, stop: r.get(8)?, think_full: r.get(9)? })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn load_tools(wh: &Connection, sk: i64) -> Result<Vec<ToolIn>> {
    let mut q = wh.prepare("select call_idx, kind, name, arg, start, end, error, res_chars, passed, failed, res_full from tools where sk = ?1 order by idx")?;
    let rows = q.query_map(params![sk], |r| {
        Ok(ToolIn { call_idx: r.get(0)?, kind: r.get(1)?, name: r.get(2)?, arg: r.get(3)?, start: r.get(4)?, end: r.get(5)?, error: r.get(6)?, res_chars: r.get(7)?, passed: r.get(8)?, failed: r.get(9)?, res_full: r.get(10)? })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// What a story run is computed from, in one string: the warehouse's own digest of its inputs, how many calls it has
/// (a story still being appended to grows), and the version of this code.
fn digest(wh: &Connection, sk: i64, n_calls: i64) -> Result<String> {
    let inputs: Option<String> = wh.query_row("select inputs_digest from collection where sk = ?1", params![sk], |r| r.get(0)).optional()?.flatten();
    Ok(format!("{}|{}|v{}", inputs.unwrap_or_default(), n_calls, ANALYTICS_VERSION))
}

/// Compute the selected story runs of `wh` into `store`.
pub fn run_on(wh: &Connection, store: &mut Store, sel: &Selection, now: f64) -> Result<Summary> {
    let started = std::time::Instant::now();
    let mut summary = Summary::default();
    purge_references(store)?;
    purge_orphans(wh, store)?;
    let mut q = wh.prepare("select sk, rel, run_id, stack, run, story from stories where rel is not null and coalesce(stack, '') not like ?1 order by sk")?;
    type Row = (i64, String, Option<String>, Option<String>, Option<String>, Option<i64>);
    let stories: Vec<Row> = q.query_map(params![format!("{REFERENCE_STACK_PREFIX}%")], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?.collect::<std::result::Result<_, _>>()?;
    let only: HashSet<&str> = sel.only.iter().map(String::as_str).collect();
    for (sk, rel, run_id, stack, run, story) in stories {
        if !only.is_empty() && !only.contains(rel.as_str()) && !only.iter().any(|o| rel.starts_with(&format!("{o}/stories/"))) {
            continue;
        }
        summary.stories += 1;
        let calls = load_calls(wh, sk)?;
        let source_digest = digest(wh, sk, calls.len() as i64)?;
        if !sel.all && store.computed(&rel)? == Some((source_digest.clone(), ANALYTICS_VERSION)) {
            summary.unchanged += 1;
            continue;
        }
        let tools = load_tools(wh, sk)?;
        let ends: Vec<f64> = {
            let mut q = wh.prepare("select end from compactions where sk = ?1 and end is not null")?;
            let v = q.query_map(params![sk], |r| r.get(0))?.collect::<std::result::Result<_, _>>()?;
            v
        };
        let prompt: String = wh
            .query_row("select coalesce(text_full, text_head, '') from msgs where sk = ?1 order by idx limit 1", params![sk], |r| r.get(0))
            .optional()?
            .unwrap_or_default();
        let recorded: Option<i64> = wh
            .query_row("select conversation_json from stories where sk = ?1", params![sk], |r| r.get::<_, Option<String>>(0))?
            .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
            .and_then(|v| v["thinking_chars"].as_i64());
        let ctx = context::context_rows(&calls, &tools, &ends);
        let think = think_rows(&calls, &tools, &prompt);
        let meta = StoryMeta {
            rel: rel.clone(), run_id, stack, run, story, n_calls: calls.len() as i64,
            think_chars: think.iter().map(|t| t.features.chars).sum(), think_chars_recorded: recorded, source_digest, version: ANALYTICS_VERSION, computed_at: now,
        };
        store.replace_story(&meta, &ctx, &think).with_context(|| format!("store {rel}"))?;
        summary.computed += 1;
        summary.calls += ctx.len();
        summary.think_blocks += think.len();
    }
    summary.seconds = started.elapsed().as_secs_f64();
    Ok(summary)
}

/// Compute from the warehouse file into the analytics file (read-only on the warehouse).
pub fn run(warehouse: &Path, out: &Path, sel: &Selection, now: f64) -> Result<Summary> {
    let wh = Connection::open_with_flags(warehouse, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .with_context(|| format!("open {} read-only", warehouse.display()))?;
    if let Some(dir) = out.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut store = Store::open(out)?;
    run_on(&wh, &mut store, sel, now)
}

const REBUILD_SUFFIX: &str = ".new";
/// The analytics database sits beside the warehouse.
pub const ANALYTICS_FILE: &str = "analytics.db";

/// The collector's hook: after an ingest, bring the analytics file beside the warehouse up to date. It is made when
/// absent (the backfill, whatever was ingested) and otherwise only after something was ingested. Never fails the
/// caller: the result is a line to log, or None when there is nothing to say.
pub fn after_ingest(warehouse: &Path, ingested: usize, now: f64) -> Option<String> {
    let out = warehouse.with_file_name(ANALYTICS_FILE);
    if ingested == 0 && out.exists() {
        return None;
    }
    match run(warehouse, &out, &Selection::default(), now) {
        Ok(s) if s.computed > 0 => Some(format!("analysed {} story runs, {} calls, {} thinking blocks ({:.1} s)", s.computed, s.calls, s.think_blocks, s.seconds)),
        Ok(_) => None,
        Err(e) => Some(format!("analytics: {e:#}")),
    }
}

/// The tables the insights scripts write and `dbench analyse` does not compute.
const FOREIGN_TABLES: [&str; 3] = ["theme", "theme_story", "theme_share"];

/// A rebuild replaces the file; what the scripts wrote to it goes into the new one first.
fn carry_over(old: &Path, new: &Path) -> Result<()> {
    if !old.exists() {
        return Ok(());
    }
    let c = Connection::open(new)?;
    c.execute("attach database ?1 as old", params![old.to_string_lossy()])?;
    for t in FOREIGN_TABLES {
        let there: i64 = c.query_row("select count(*) from old.sqlite_master where type = 'table' and name = ?1", params![t], |r| r.get(0))?;
        if there > 0 {
            c.execute_batch(&format!("insert or replace into main.{t} select * from old.{t}"))?;
        }
    }
    c.execute("detach database old", [])?;
    Ok(())
}

/// `dbench analyse`.
pub fn cmd_analyse(args: &crate::cli::AnalyseArgs, json: bool) -> Result<()> {
    let target = if args.rebuild {
        let mut p = args.out.clone().into_os_string();
        p.push(REBUILD_SUFFIX);
        let p = std::path::PathBuf::from(p);
        let _ = std::fs::remove_file(&p);
        p
    } else {
        args.out.clone()
    };
    let sel = Selection { all: args.all || args.rebuild, only: args.only.clone() };
    let now = crate::timefmt::now_secs() as f64;
    let summary = run(&args.db, &target, &sel, now)?;
    if args.rebuild {
        carry_over(&args.out, &target)?;
        std::fs::rename(&target, &args.out).with_context(|| format!("rename {} over {}", target.display(), args.out.display()))?;
    }
    if json {
        println!("{}", serde_json::to_string_pretty(&summary)?);
    } else {
        println!(
            "analysed {} of {} story runs ({} unchanged): {} calls, {} thinking blocks, {:.1} s",
            summary.computed, summary.stories, summary.unchanged, summary.calls, summary.think_blocks, summary.seconds
        );
    }
    Ok(())
}
