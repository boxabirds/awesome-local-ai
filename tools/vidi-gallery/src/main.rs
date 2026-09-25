//! vidi-gallery: review every Vidi build side by side. Scores, judging and cost in one table, and
//! any final build running in its own window with a banner naming its setup and run. See README.md.

mod builds;
mod proxy;
mod runs;

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::{Path as UrlPath, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Json};
use axum::routing::{get, post};
use axum::Router;
use clap::Parser;

use builds::{Builds, Spec};

const DEFAULT_PORT: u16 = 7800;
const PAGE: &str = include_str!("page.html");
/// Setup colours: evenly spread hues, one per setup in discovery order.
const HUE_STEP: usize = 67;
const DEGREES: usize = 360;

#[derive(Parser)]
#[command(about = "Review every Vidi build: scores, judging, cost, and each final build in its own labelled window")]
struct Cli {
    /// The awesome-local-ai checkout (default: the one this binary was built from).
    #[arg(long)]
    repo: Option<PathBuf>,
    #[arg(long, default_value_t = DEFAULT_PORT)]
    port: u16,
}

#[derive(Clone)]
struct App {
    repo: PathBuf,
    builds: Builds,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn colour(index: usize) -> String {
    format!("hsl({} 55% 38%)", (index * HUE_STEP) % DEGREES)
}

fn setup_colours(runs: &[runs::Run]) -> Vec<(String, String)> {
    let mut setups: Vec<String> = runs.iter().map(|r| r.setup.clone()).collect();
    setups.dedup();
    setups.iter().enumerate().map(|(i, s)| (s.clone(), colour(i))).collect()
}

/// A short name for a window title: the model part of a combination (family, version, model),
/// or the stack of a reference setup.
const MODEL_PARTS: usize = 3;

fn short_name(setup: &str) -> String {
    match setup.strip_prefix("reference/") {
        Some(stack) => stack.to_string(),
        None => setup.split('/').take(MODEL_PARTS).collect::<Vec<_>>().join(" "),
    }
}

async fn page() -> Html<&'static str> {
    Html(PAGE)
}

async fn api_runs(State(app): State<Arc<App>>) -> impl IntoResponse {
    let runs = runs::load(&app.repo);
    let colours = setup_colours(&runs);
    let private = app.repo.parent().map(|p| p.join("awesome-local-ai-bench-private")).unwrap_or_default();
    let judges = runs::judges(&private, &home().join(".vidi-bench/keys"));
    Json(serde_json::json!({ "runs": runs, "colours": colours, "judges": judges }))
}

async fn api_status(State(app): State<Arc<App>>) -> impl IntoResponse {
    Json(app.builds.states().await)
}

async fn api_open(State(app): State<Arc<App>>, UrlPath(slug): UrlPath<String>) -> impl IntoResponse {
    let runs = runs::load(&app.repo);
    let colours = setup_colours(&runs);
    let Some(run) = runs.iter().find(|r| r.slug == slug) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such run"}))).into_response();
    };
    let score = match (run.score.passed, run.score.total, run.score.void) {
        (_, _, true) => "held-out VOID".to_string(),
        (Some(p), Some(t), _) => format!("held-out {p}/{t}"),
        _ => "held-out —".to_string(),
    };
    let short_setup = short_name(&run.setup);
    let banner = proxy::Banner {
        text: format!("{} · {} · {}", run.setup, run.run, score),
        colour: colours.iter().find(|(s, _)| *s == run.setup).map(|(_, c)| c.clone()).unwrap_or_else(|| colour(0)),
        title: format!("{} {}", short_setup, run.run),
    };
    let state = app.builds.open(Spec { slug: slug.clone(), workspace: run.path.join("workspace"), banner }).await;
    Json(serde_json::json!(state)).into_response()
}

async fn api_stop(State(app): State<Arc<App>>, UrlPath(slug): UrlPath<String>) -> impl IntoResponse {
    app.builds.stop(&slug).await;
    StatusCode::NO_CONTENT
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let repo = cli
        .repo
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .canonicalize()?;
    let builds = Builds::new(home().join(".cache/awesome-local-ai/vidi-gallery"));
    let app = Arc::new(App { repo: repo.clone(), builds: builds.clone() });
    let router = Router::new()
        .route("/", get(page))
        .route("/api/runs", get(api_runs))
        .route("/api/status", get(api_status))
        .route("/api/open/{slug}", post(api_open))
        .route("/api/stop/{slug}", post(api_stop))
        .with_state(app);
    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("vidi-gallery: http://{addr}/  (repo {})", repo.display());
    let shutdown = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    axum::serve(listener, router).with_graceful_shutdown(shutdown).await?;
    println!("stopping the builds that are running");
    builds.stop_all().await;
    Ok(())
}
