//! The conversation API: what the benchmarker proxies as /api/conversations/…, served by
//! `dbench collect` from the warehouse, read-only, on the loopback address. Every time is integer
//! milliseconds; a cursor is opaque text that names a place in a story's stream. A story the
//! warehouse doesn't have, or has nothing of yet, is 404 `{}`: no reason, ever.

use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

use crate::ingest::db::{Db, Event};

pub const EVENTS_PAGE_MAX: usize = 500;
pub const EVENTS_PAGE_DEFAULT: usize = 200;

#[derive(Clone)]
pub struct Shared {
    pub db_path: PathBuf,
}

pub fn router(shared: Arc<Shared>) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/conversations", get(available))
        .route("/v1/conversations/{id}", get(conversation))
        .route("/v1/conversations/{id}/events", get(events))
        .route("/v1/conversations/{id}/calls/{idx}", get(call))
        .route("/v1/conversations/{id}/tools/{idx}", get(tool))
        .route("/v1/activity", get(activity))
        .with_state(shared)
}

/// Thinking by activity class, per story run: what the benchmarker's activity report reads. It comes from the analytics
/// file beside the warehouse (derived, rebuildable), not from the warehouse itself; with no file, or nothing assigned
/// yet, it is empty rather than an error, like every other missing figure.
async fn activity(State(s): State<Arc<Shared>>) -> Response {
    let path = s.db_path.with_file_name(crate::analytics::ANALYTICS_FILE);
    let empty = json!({ "version": crate::analytics::ANALYTICS_VERSION, "themes": [], "rows": [] });
    let Ok(db) = rusqlite::Connection::open_with_flags(&path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return no_store(Json(empty).into_response());
    };
    let themes = db
        .prepare("select id, name, definition from theme where version = ?1 order by id")
        .and_then(|mut q| {
            q.query_map([crate::analytics::ANALYTICS_VERSION], |r| {
                Ok(json!({ "id": r.get::<_, i64>(0)?, "name": r.get::<_, String>(1)?, "definition": r.get::<_, String>(2)? }))
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        })
        .unwrap_or_default();
    let rows = db
        .prepare(
            "select h.rel, s.stack, s.run, s.story, h.theme, h.chars, h.paragraphs
             from theme_share h join analytics_story s using (rel)
             where h.version = ?1 order by s.stack, s.story, s.run, h.theme",
        )
        .and_then(|mut q| {
            q.query_map([crate::analytics::ANALYTICS_VERSION], |r| {
                Ok(json!({ "rel": r.get::<_, String>(0)?, "stack": r.get::<_, Option<String>>(1)?, "run": r.get::<_, Option<String>>(2)?,
                           "story": r.get::<_, Option<i64>>(3)?, "theme": r.get::<_, i64>(4)?,
                           "chars": r.get::<_, f64>(5)?, "paragraphs": r.get::<_, Option<i64>>(6)? }))
            })
            .and_then(|rows| rows.collect::<rusqlite::Result<Vec<_>>>())
        })
        .unwrap_or_default();
    no_store(Json(json!({ "version": crate::analytics::ANALYTICS_VERSION, "themes": themes, "rows": rows })).into_response())
}

fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({}))).into_response()
}

fn no_store(mut r: Response) -> Response {
    r.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("no-store"));
    r
}

/// A cursor names an event by its time and ord: `<t_ms>:<ord>`.
pub fn cursor_of(e: &Event) -> String {
    format!("{}:{}", e.t_ms, e.ord)
}

pub fn parse_cursor(s: &str) -> Option<(i64, i64)> {
    let (t, o) = s.split_once(':')?;
    Some((t.parse().ok()?, o.parse().ok()?))
}

fn event_json(e: &Event) -> Value {
    let mut v = json!({ "ord": e.ord, "tMs": e.t_ms, "kind": e.kind, "refIdx": e.ref_idx, "cursor": cursor_of(e) });
    if let Value::Object(p) = &e.payload {
        for (k, x) in p {
            v[k] = x.clone();
        }
    }
    v
}

/// Run a read against the warehouse off the async threads; None when the database isn't there.
async fn with_db<T: Send + 'static>(st: &Shared, f: impl FnOnce(&Db) -> anyhow::Result<T> + Send + 'static) -> Option<T> {
    let path = st.db_path.clone();
    tokio::task::spawn_blocking(move || {
        let db = Db::open_read_only(&path).ok()?;
        f(&db).ok()
    })
    .await
    .ok()
    .flatten()
}

async fn health() -> Json<Value> {
    Json(json!({ "ok": true, "version": crate::VERSION }))
}

/// Every story run the warehouse has a stream for, and which of them are complete.
async fn available(State(st): State<Arc<Shared>>) -> Response {
    let got = with_db(&st, |db| Ok((db.story_ids_with_events()?, db.complete_story_ids()?))).await;
    match got {
        Some((ids, complete)) => no_store(Json(json!({ "ids": ids, "complete": complete })).into_response()),
        None => no_store(Json(json!({ "ids": [], "complete": [] })).into_response()),
    }
}

async fn conversation(State(st): State<Arc<Shared>>, UrlPath(id): UrlPath<String>) -> Response {
    let got = with_db(&st, move |db| {
        let Some(sk) = db.story_sk(&id)? else { return Ok(None) };
        let Some((first, last, latest_ord, n)) = db.events_range(sk)? else { return Ok(None) };
        let latest = db.events_after(sk, latest_ord - 1, 1)?.first().map(cursor_of).unwrap_or_default();
        let (complete, node): (bool, Option<String>) = db
            .conn
            .query_row("select complete, node from collection where sk = ?1", [sk], |r| Ok((r.get::<_, i64>(0)? != 0, r.get(1)?)))
            .unwrap_or((false, None));
        let count = |kind: &str| -> anyhow::Result<i64> { Ok(db.conn.query_row("select count(*) from events where sk = ?1 and kind = ?2", rusqlite::params![sk, kind], |r| r.get(0))?) };
        Ok(Some(json!({
            "id": id, "fmt": db.story_fmt(sk)?, "complete": complete, "node": node,
            "range": { "fromMs": first, "toMs": last + 1 }, "latest": latest, "events": n,
            "counts": {
                "calls": db.count("calls", sk)?, "toolCalls": db.count("tools", sk)?, "msgs": db.count("msgs", sk)?,
                "compactions": db.count("compactions", sk)?, "requests": count("request")?, "conditions": count("condition")?,
            },
        })))
    })
    .await
    .flatten();
    match got {
        Some(v) => no_store(Json(v).into_response()),
        None => no_store(not_found()),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct EventsQuery {
    from_ms: Option<i64>,
    to_ms: Option<i64>,
    cursor: Option<String>,
    after: Option<String>,
    limit: Option<usize>,
}

/// The time-range form (fromMs, toMs, cursor) and the open-ended form (after): see the README.
async fn events(State(st): State<Arc<Shared>>, UrlPath(id): UrlPath<String>, Query(q): Query<EventsQuery>) -> Response {
    let limit = q.limit.unwrap_or(EVENTS_PAGE_DEFAULT);
    if limit == 0 || limit > EVENTS_PAGE_MAX {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": format!("limit is 1..={EVENTS_PAGE_MAX}") }))).into_response();
    }
    let after = match &q.after {
        Some(a) if a == "0" => Some(-1),
        Some(a) => match parse_cursor(a) {
            Some((_, ord)) => Some(ord),
            None => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "after is a cursor, or 0" }))).into_response(),
        },
        None => None,
    };
    let cursor = match &q.cursor {
        Some(c) => match parse_cursor(c) {
            Some(c) => Some(c),
            None => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "cursor is not one this API gave" }))).into_response(),
        },
        None => None,
    };
    let (from_ms, to_ms) = (q.from_ms.unwrap_or(i64::MIN), q.to_ms.unwrap_or(i64::MAX));
    let got = with_db(&st, move |db| {
        let Some(sk) = db.story_sk(&id)? else { return Ok(None) };
        let Some((first, last, _, _)) = db.events_range(sk)? else { return Ok(None) };
        let range = json!({ "fromMs": first, "toMs": last + 1 });
        if let Some(after) = after {
            let page = db.events_after(sk, after, limit)?;
            let next = page.last().map(cursor_of).or_else(|| q.after.clone());
            return Ok(Some(json!({ "events": page.iter().map(event_json).collect::<Vec<_>>(), "nextCursor": next, "range": range })));
        }
        let page = db.events_in_range(sk, from_ms, to_ms, cursor, limit)?;
        let next = if page.len() == limit { page.last().map(cursor_of) } else { None };
        Ok(Some(json!({ "events": page.iter().map(event_json).collect::<Vec<_>>(), "nextCursor": next, "range": range })))
    })
    .await
    .flatten();
    match got {
        Some(v) => no_store(Json(v).into_response()),
        None => no_store(not_found()),
    }
}

async fn call(State(st): State<Arc<Shared>>, UrlPath((id, idx)): UrlPath<(String, i64)>) -> Response {
    let got = with_db(&st, move |db| {
        let Some(sk) = db.story_sk(&id)? else { return Ok(None) };
        db.call(sk, idx)
    })
    .await
    .flatten();
    match got {
        Some(v) => no_store(Json(v).into_response()),
        None => no_store(not_found()),
    }
}

async fn tool(State(st): State<Arc<Shared>>, UrlPath((id, idx)): UrlPath<(String, i64)>) -> Response {
    let got = with_db(&st, move |db| {
        let Some(sk) = db.story_sk(&id)? else { return Ok(None) };
        db.tool(sk, idx)
    })
    .await
    .flatten();
    match got {
        Some(v) => no_store(Json(v).into_response()),
        None => no_store(not_found()),
    }
}

/// Serve the API on `bind` until the process ends. The address is printed once bound.
pub async fn serve(bind: &str, db_path: PathBuf) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(bind).await?;
    eprintln!("dbench collect: conversation API on http://{}", listener.local_addr()?);
    axum::serve(listener, router(Arc::new(Shared { db_path }))).await?;
    Ok(())
}
