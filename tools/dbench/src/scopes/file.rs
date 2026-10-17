//! GET /v1/runs/scope-file (docs/design/dbench-scopes/api.md, "Routes" 3): the bytes of one listed file, by the same code
//! as `/v1/runs/file` (`server::file_of`), plus `x-dbench-final`: 1 when the file's scope (its story, else the run) is
//! final, else 0.

use axum::extract::{Query, State};
use axum::http::{HeaderValue, StatusCode};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::sync::Arc;

use crate::collect;
use crate::scopes::finality::Assessment;
use crate::scopes::listing::{err, run_of, story_of_name};
use crate::server::{self, FileQuery, Shared, E_NAME_NOT_ALLOWED};

/// Answered on a served file: 1 when the file's scope is final.
pub const FINAL_HEADER: &str = "x-dbench-final";
const QUERY_FROM: &str = "from";
const QUERY_NAME: &str = "name";
const QUERY_RUN: &str = "run";

pub fn routes() -> Router<Arc<Shared>> {
    Router::new().route("/v1/runs/scope-file", get(scope_file))
}

async fn scope_file(State(st): State<Arc<Shared>>, Query(q): Query<HashMap<String, String>>) -> Response {
    let rel = match run_of(&st, q.get(QUERY_RUN).map(String::as_str)) {
        Ok(rel) => rel,
        Err((status, msg)) => return err(status, msg),
    };
    let Some(name) = q.get(QUERY_NAME) else {
        return err(StatusCode::BAD_REQUEST, "name= names the file");
    };
    // Only names the allow-list groups into a scope: the run's, a story's, or a stream's.
    if collect::parse_name(name).is_none() {
        return err(StatusCode::NOT_FOUND, format!("{E_NAME_NOT_ALLOWED}: {name:?} is not a file the node serves"));
    }
    let mut fields = Map::new();
    for (k, v) in &q {
        let value = if k == QUERY_FROM {
            match v.parse::<u64>() {
                Ok(n) => Value::from(n),
                Err(_) => return err(StatusCode::BAD_REQUEST, format!("{QUERY_FROM}= is a byte offset, not {v:?}")),
            }
        } else {
            Value::String(v.clone())
        };
        fields.insert(k.clone(), value);
    }
    let fq: FileQuery = match serde_json::from_value(Value::Object(fields)) {
        Ok(fq) => fq,
        Err(e) => return err(StatusCode::BAD_REQUEST, format!("bad query: {e}")),
    };
    let job_label = st.jobs_by_run().remove(&rel).map(|(_, label)| label);
    let a = Assessment::read(&st.cfg.repo.join(&rel), job_label.as_deref());
    let final_ = story_of_name(name).map_or(a.run_final, |n| a.story(n).final_);
    let mut resp = server::file_of(&st, &rel, fq).await;
    if resp.status().is_success() {
        resp.headers_mut().insert(FINAL_HEADER, HeaderValue::from_static(if final_ { "1" } else { "0" }));
    }
    resp
}
