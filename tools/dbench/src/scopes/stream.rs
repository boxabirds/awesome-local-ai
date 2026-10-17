//! GET /v1/runs/events (docs/design/dbench-scopes/api.md). Not built yet.

use axum::Router;
use std::sync::Arc;

use crate::server::Shared;

pub fn routes() -> Router<Arc<Shared>> {
    Router::new()
}
