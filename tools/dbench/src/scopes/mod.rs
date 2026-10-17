//! The scope API (docs/design/dbench-scopes/api.md): events, stories and runs, readable at any stage, each with an explicit
//! `final` flag. Each submodule owns its routes; the router in server.rs merges `routes()` once.

use axum::Router;
use std::sync::Arc;

use crate::server::Shared;

pub mod file;
pub mod finality;
pub mod listing;
pub mod stream;

pub fn routes() -> Router<Arc<Shared>> {
    Router::new()
        .merge(listing::routes())
        .merge(stream::routes())
        .merge(file::routes())
}
