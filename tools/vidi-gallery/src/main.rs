//! vidi-gallery: review every Vidi build side by side. Scores, judging and cost in one table, and
//! any final build running in its own window with a banner naming its setup and run. See README.md.

mod builds;
mod proxy;
mod record;
mod reviews;
mod runs;
mod stories;

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
const REVIEW_PAGE: &str = include_str!("review.html");
/// The blind banner's colour: neutral, so it says nothing about the setup.
const BLIND_COLOUR: &str = "hsl(0 0% 30%)";
const LETTERS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
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
    /// Story review: show each build's setup and run instead of a letter (default: blind).
    #[arg(long)]
    labelled: bool,
}

struct App {
    repo: PathBuf,
    builds: Builds,
    cache: PathBuf,
    blind: bool,
    /// The builds under story review, in their (shuffled, when blind) order: key i is letter i.
    review_builds: Vec<runs::Run>,
    reviews: reviews::Store,
    /// The stories in review order, each with its prerequisites and the build it's reviewed on.
    stories: Vec<stories::Story>,
    /// Background preparation of every story's builds: slug -> "queued" / step / "failed: …".
    prep: tokio::sync::Mutex<std::collections::HashMap<String, String>>,
    /// The held-out suite, and where recorded walkthroughs go (git-ignored state/ in the private repo).
    acceptance: PathBuf,
    recordings: PathBuf,
    record_config: PathBuf,
    /// Recording of each (run, story): "queued" / "recording" / "done" / "failed: …".
    rec: tokio::sync::Mutex<std::collections::HashMap<String, String>>,
    /// App ports for recordings running at once (each also uses port + 1 for the suite's control server).
    rec_ports: tokio::sync::Mutex<Vec<u16>>,
    /// Story ids in the order they were built (the scope's order), for PROCESSED_STORIES.
    build_order: Vec<u64>,
}

/// Recording app ports: clear of the benchmark (8787, 18787-8, 19787) and the gallery (78xx-79xx).
const REC_PORT_BASE: u16 = 19811;
/// A recording that fails (e.g. an agent on this machine killed its server) is retried this often.
const REC_ATTEMPTS: usize = 3;

fn rec_key(run: &runs::Run, story: u64) -> String {
    format!("{}#{story:02}", run.slug)
}

fn rec_dir(app: &App, run: &runs::Run, story: u64) -> PathBuf {
    app.recordings.join(&run.slug).join(format!("story-{story:02}"))
}

/// Record one story's held-out tests on its prepared review build, retrying a failed attempt.
async fn record_story(app: &App, run: &runs::Run, story: u64, ws: &std::path::Path) {
    let key = rec_key(run, story);
    let out = rec_dir(app, run, story);
    if out.join("report.json").is_file() && record::app_never_started(&record::paths(&out, &out)).is_none() {
        app.rec.lock().await.insert(key, "done".into());
        return;
    }
    let build = review_build(app, story);
    let processed = record::processed(&app.build_order, &run.story_status, build);
    // One recording at a time: the suite's app server (wrangler dev) shares machine-wide settings,
    // such as its inspector port, so parallel recordings starve each other and record nothing.
    let port = loop {
        if let Some(p) = app.rec_ports.lock().await.pop() {
            break p;
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    };
    let mut last = String::new();
    for attempt in 1..=REC_ATTEMPTS {
        app.rec.lock().await.insert(key.clone(), format!("recording (attempt {attempt})"));
        match record::record(&app.acceptance, &app.record_config, ws, story, &processed, &out, port).await {
            Ok(()) => {
                last.clear();
                break;
            }
            Err(e) => last = format!("{e:#}"),
        }
    }
    app.rec_ports.lock().await.push(port);
    let status = if last.is_empty() { "done".to_string() } else { format!("failed: {last}") };
    app.rec.lock().await.insert(key, status);
}

/// The build a story is reviewed on (its own, or a later one that has its prerequisites).
fn review_build(app: &App, story: u64) -> u64 {
    app.stories.iter().find(|s| s.id == story).map(|s| s.review_build).unwrap_or(story)
}

/// How many builds are prepared at once at startup.
const PREPARE_PARALLEL: usize = 3;

/// Check out and build every (story, build) the review can open, story 1 first, a few at a time,
/// so that opening one only starts its server.
async fn prepare_all(app: Arc<App>) {
    let stories = app.stories.clone();
    let mut jobs = Vec::new();
    let mut builds_needed: Vec<u64> = Vec::new();
    for s in &stories {
        if !builds_needed.contains(&s.review_build) {
            builds_needed.push(s.review_build); // in review order, so the first story's builds come first
        }
    }
    for s in &stories {
        for r in &app.review_builds {
            app.rec.lock().await.insert(rec_key(r, s.id), "queued".into());
        }
    }
    for b in builds_needed {
        for r in &app.review_builds {
            jobs.push((b, r.clone()));
            app.prep.lock().await.insert(story_slug(r, b), "queued".into());
        }
    }
    let gate = Arc::new(tokio::sync::Semaphore::new(PREPARE_PARALLEL));
    let mut tasks = Vec::new();
    for (story, run) in jobs {
        let (app, gate) = (app.clone(), gate.clone());
        tasks.push(tokio::spawn(async move {
            let _permit = gate.acquire().await;
            let slug = story_slug(&run, story);
            app.prep.lock().await.insert(slug.clone(), "preparing".into());
            let result = match story_checkout(&app.cache, &run, story).await {
                Ok(ws) => builds::prepare(&ws, &app.cache.join("modules")).await.map(|_| ws),
                Err(e) => Err(e),
            };
            let status = match &result { Ok(_) => "ready".to_string(), Err(e) => format!("failed: {e:#}") };
            app.prep.lock().await.insert(slug, status);
            if let Ok(ws) = result {
                // then record the walkthroughs of every story reviewed on this build
                let reviewed: Vec<u64> = app.stories.iter().filter(|s| s.review_build == story).map(|s| s.id).collect();
                for s in reviewed {
                    record_story(&app, &run, s, &ws).await;
                }
            }
        }));
    }
    for t in tasks {
        let _ = t.await;
    }
    println!("all review builds prepared");
}

fn private_repo(repo: &std::path::Path) -> PathBuf {
    repo.parent().map(|p| p.join("awesome-local-ai-bench-private")).unwrap_or_default()
}

/// Whether a run is a whole build worth reviewing story by story: every story in scope done (an
/// A/B run that built two stories on seeded code isn't), and a valid final score.
fn is_reviewable(r: &runs::Run) -> bool {
    !r.in_progress
        && !r.score.void
        && r.score.total.is_some()
        && r.stories_in_scope.is_some_and(|n| r.stories_finished >= n)
        && r.has_history // each story is reviewed on the build as it was after that story
}

/// The build slug for one story's state of a run.
fn story_slug(run: &runs::Run, story: u64) -> String {
    format!("{}@{story:02}", run.slug)
}

/// A checkout of the run's code as it was after `story`, from the record's git bundle, under the
/// gallery cache. Reused if it exists.
async fn story_checkout(cache: &std::path::Path, run: &runs::Run, story: u64) -> anyhow::Result<PathBuf> {
    let commit = run.story_commits.get(&story).ok_or_else(|| anyhow::anyhow!("no recorded commit for story {story}"))?;
    let dir = cache.join("checkouts").join(story_slug(run, story));
    if dir.join(".git").is_dir() {
        return Ok(dir);
    }
    let _ = tokio::fs::remove_dir_all(&dir).await;
    tokio::fs::create_dir_all(dir.parent().unwrap_or(cache)).await?;
    let bundle = run.path.join("workspace.bundle");
    let ok = tokio::process::Command::new("git")
        .args(["clone", "-q", "--no-checkout"]).arg(&bundle).arg(&dir)
        .status().await?.success()
        && tokio::process::Command::new("git").arg("-C").arg(&dir)
            .args(["-c", "advice.detachedHead=false", "checkout", "-q", commit])
            .status().await?.success();
    if !ok {
        let _ = tokio::fs::remove_dir_all(&dir).await;
        anyhow::bail!("could not check out {commit} from {}", bundle.display());
    }
    Ok(dir)
}

/// Finished, validly scored runs: the builds a story review compares.
fn reviewable(repo: &std::path::Path) -> Vec<runs::Run> {
    let mut list: Vec<runs::Run> = runs::load(repo).into_iter().filter(is_reviewable).collect();
    list.sort_by(|a, b| a.slug.cmp(&b.slug));
    list
}

/// A per-session shuffle (xorshift on the clock), so blind letters don't stick to a setup across sessions.
fn shuffle<T>(items: &mut [T]) {
    let mut x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(1) | 1;
    for i in (1..items.len()).rev() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        items.swap(i, (x % (i as u64 + 1)) as usize);
    }
}

fn letter(i: usize) -> String {
    LETTERS.chars().nth(i).map(String::from).unwrap_or_else(|| format!("#{}", i + 1))
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
    let private = private_repo(&app.repo);
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
    let state = app.builds.open(Spec { slug: slug.clone(), workspace: run.path.join("workspace"), banner, in_place: false }).await;
    Json(serde_json::json!(state)).into_response()
}

async fn api_stop(State(app): State<Arc<App>>, UrlPath(slug): UrlPath<String>) -> impl IntoResponse {
    app.builds.stop(&slug).await;
    StatusCode::NO_CONTENT
}

// ---------- story review ----------

async fn review_page() -> Html<&'static str> {
    Html(REVIEW_PAGE)
}

fn build_label(app: &App, i: usize) -> String {
    let r = &app.review_builds[i];
    if app.blind { format!("Build {}", letter(i)) } else { format!("{} · {}", r.setup, r.run) }
}

async fn api_review_state(State(app): State<Arc<App>>) -> impl IntoResponse {
    let stories = app.stories.clone();
    let index: std::collections::HashMap<&str, usize> =
        app.review_builds.iter().enumerate().map(|(i, r)| (r.slug.as_str(), i)).collect();
    // Reviews are stored by slug; the page only ever sees keys, so blind stays blind.
    let reviews: Vec<serde_json::Value> = app
        .reviews
        .all()
        .into_iter()
        .filter_map(|r| {
            let key = *index.get(r.build.as_str())?;
            Some(serde_json::json!({"story": r.story, "key": key, "path": r.path, "verdict": r.verdict, "notes": r.notes}))
        })
        .collect();
    let builds: Vec<serde_json::Value> =
        (0..app.review_builds.len()).map(|i| serde_json::json!({"key": i, "label": build_label(&app, i)})).collect();
    Json(serde_json::json!({
        "blind": app.blind, "stories": stories, "builds": builds, "reviews": reviews,
        "file": app.reviews.path().display().to_string(),
    }))
}

async fn api_review_status(State(app): State<Arc<App>>, UrlPath(story): UrlPath<u64>) -> impl IntoResponse {
    let story = review_build(&app, story);
    let states = app.builds.states().await;
    let prep = app.prep.lock().await.clone();
    let by_key: Vec<serde_json::Value> = app
        .review_builds
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let slug = story_slug(r, story);
            let status = match states.get(&slug) {
                Some(s) => serde_json::json!(s),
                None => match prep.get(&slug).map(String::as_str) {
                    Some("ready") => serde_json::json!({"state": "ready"}),
                    Some("queued") => serde_json::json!({"state": "queued"}),
                    Some("preparing") => serde_json::json!({"state": "preparing", "step": "installing and building"}),
                    Some(f) => serde_json::json!({"state": "failed", "error": f}),
                    None => serde_json::Value::Null,
                },
            };
            serde_json::json!({"key": i, "status": status})
        })
        .collect();
    Json(by_key)
}

/// Moving to another story: stop the builds of every other story, so only one story's builds
/// hold ports and memory at a time.
async fn api_review_story(State(app): State<Arc<App>>, UrlPath(story): UrlPath<u64>) -> impl IntoResponse {
    let story = review_build(&app, story);
    let keep: std::collections::HashSet<String> = app.review_builds.iter().map(|r| story_slug(r, story)).collect();
    for slug in app.builds.states().await.into_keys() {
        if slug.contains('@') && !keep.contains(&slug) {
            app.builds.stop(&slug).await;
        }
    }
    StatusCode::NO_CONTENT
}

async fn api_review_open(State(app): State<Arc<App>>, UrlPath((story, key)): UrlPath<(u64, usize)>) -> impl IntoResponse {
    let Some(run) = app.review_builds.get(key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    let reviewed = story;
    let story = review_build(&app, story);
    let workspace = match story_checkout(&app.cache, run, story).await {
        Ok(dir) => dir,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"state": "failed", "error": e.to_string()}))).into_response(),
    };
    let label = if story == reviewed {
        format!("{} · after story {story}", build_label(&app, key))
    } else {
        format!("{} · story {reviewed}, on the build after story {story}", build_label(&app, key))
    };
    let banner = if app.blind {
        proxy::Banner { text: label.clone(), colour: BLIND_COLOUR.to_string(), title: label }
    } else {
        let colours = setup_colours(&runs::load(&app.repo));
        proxy::Banner {
            text: label,
            colour: colours.iter().find(|(s, _)| *s == run.setup).map(|(_, c)| c.clone()).unwrap_or_else(|| colour(0)),
            title: format!("{} {}", short_name(&run.setup), run.run),
        }
    };
    let state = app.builds.open(Spec { slug: story_slug(run, story), workspace, banner, in_place: true }).await;
    Json(serde_json::json!(state)).into_response()
}

#[derive(serde::Deserialize)]
struct ReviewIn {
    story: u64,
    key: usize,
    #[serde(default)]
    path: String,
    verdict: String,
    notes: String,
}

async fn api_review_set(State(app): State<Arc<App>>, Json(body): Json<ReviewIn>) -> impl IntoResponse {
    let Some(run) = app.review_builds.get(body.key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    let now = utc_now();
    match app.reviews.set(body.story, &run.slug, &body.path, &body.verdict, &body.notes, &now) {
        Ok(_) => Json(serde_json::json!({"saved": now})).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

/// Which build is which, for one story, only once every build has a verdict on it: seeing names
/// earlier would bias the rest of that story's review.
async fn api_review_reveal(State(app): State<Arc<App>>, UrlPath(story): UrlPath<u64>) -> impl IntoResponse {
    let done: std::collections::HashSet<String> = app
        .reviews
        .all()
        .into_iter()
        .filter(|r| r.story == story && r.path.is_empty() && !r.verdict.is_empty())
        .map(|r| r.build)
        .collect();
    if app.review_builds.iter().any(|r| !done.contains(&r.slug)) {
        return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "give every build a verdict on this story first"}))).into_response();
    }
    let names: Vec<serde_json::Value> = app
        .review_builds
        .iter()
        .enumerate()
        .map(|(i, r)| serde_json::json!({"key": i, "setup": r.setup, "run": r.run}))
        .collect();
    Json(serde_json::json!(names)).into_response()
}

/// One build's recorded walkthroughs of a story: each path (held-out test) with its result and links.
async fn api_review_paths(State(app): State<Arc<App>>, UrlPath((story, key)): UrlPath<(u64, usize)>) -> impl IntoResponse {
    let Some(run) = app.review_builds.get(key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    let state = app.rec.lock().await.get(&rec_key(run, story)).cloned().unwrap_or_else(|| "not recorded".into());
    // Only a finished, valid recording is shown; a queued or failed one may hold a stale bad attempt.
    let paths = if state == "done" { record::paths(&rec_dir(&app, run, story), &app.recordings) } else { Vec::new() };
    Json(serde_json::json!({"state": state, "paths": paths})).into_response()
}

fn content_type(path: &std::path::Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript",
        "css" => "text/css",
        "json" | "webmanifest" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ttf" => "font/ttf",
        "zip" => "application/zip",
        "webm" => "video/webm",
        _ => "application/octet-stream",
    }
}

/// A file under `root`, refusing anything that resolves outside it.
async fn serve_under(root: &std::path::Path, rel: &str) -> axum::response::Response {
    let Ok(root) = root.canonicalize() else { return StatusCode::NOT_FOUND.into_response() };
    let Ok(path) = root.join(rel).canonicalize() else { return StatusCode::NOT_FOUND.into_response() };
    if !path.starts_with(&root) || !path.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    match tokio::fs::read(&path).await {
        Ok(bytes) => ([(axum::http::header::CONTENT_TYPE, content_type(&path))], bytes).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn recordings_file(State(app): State<Arc<App>>, UrlPath(rel): UrlPath<String>) -> impl IntoResponse {
    serve_under(&app.recordings, &rel).await
}

/// Playwright's own trace viewer, from the held-out suite's installed Playwright: local, so the
/// traces (which show held-out tests) never leave this machine.
async fn trace_viewer(State(app): State<Arc<App>>, UrlPath(rel): UrlPath<String>) -> impl IntoResponse {
    serve_under(&app.acceptance.join("node_modules/playwright-core/lib/vite/traceViewer"), &rel).await
}

fn utc_now() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let out = std::process::Command::new("date").args(["-u", "-r", &secs.to_string(), "+%Y-%m-%dT%H:%M:%SZ"]).output();
    out.ok().and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string()).unwrap_or_else(|| secs.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let repo = cli
        .repo
        .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
        .canonicalize()?;
    let cache = home().join(".cache/awesome-local-ai/vidi-gallery");
    let builds = Builds::new(cache.clone());
    let blind = !cli.labelled;
    let mut review_builds = reviewable(&repo);
    if blind {
        shuffle(&mut review_builds);
    }
    let reviews = reviews::Store::new(private_repo(&repo).join("analysis/story-reviews.csv"));
    let pack = private_repo(&repo).join("packs/vidi");
    let stories = stories::load_for_review(&pack, "canvas");
    let build_order: Vec<u64> = stories::load(&pack, "canvas").iter().map(|s| s.id).collect();
    let acceptance = pack.join("acceptance");
    let recordings = private_repo(&repo).join("state/recordings");
    let record_config = record::write_config(&acceptance, &cache)?;
    let rec_ports = vec![REC_PORT_BASE]; // one recording at a time
    let app = Arc::new(App {
        repo: repo.clone(), builds: builds.clone(), cache, blind, review_builds, reviews, stories,
        prep: Default::default(), acceptance, recordings, record_config, rec: Default::default(),
        rec_ports: tokio::sync::Mutex::new(rec_ports), build_order,
    });
    tokio::spawn(prepare_all(app.clone()));
    let router = Router::new()
        .route("/", get(page))
        .route("/api/runs", get(api_runs))
        .route("/api/status", get(api_status))
        .route("/api/open/{slug}", post(api_open))
        .route("/api/stop/{slug}", post(api_stop))
        .route("/review", get(review_page))
        .route("/api/review/state", get(api_review_state))
        .route("/api/review/status/{story}", get(api_review_status))
        .route("/api/review/story/{story}", post(api_review_story))
        .route("/api/review/open/{story}/{key}", post(api_review_open))
        .route("/api/review/set", post(api_review_set))
        .route("/api/review/reveal/{story}", get(api_review_reveal))
        .route("/api/review/paths/{story}/{key}", get(api_review_paths))
        .route("/recordings/{*path}", get(recordings_file))
        .route("/trace/{*path}", get(trace_viewer))
        .with_state(app.clone());
    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("vidi-gallery: http://{addr}/  (repo {})", repo.display());
    println!("story review: http://{addr}/review  ({} builds, {})", app.review_builds.len(), if blind { "blind" } else { "labelled" });
    // Ctrl-C or a plain `kill` (SIGTERM): either way, stop every build first, or their wrangler
    // processes outlive the gallery and hold its ports.
    let shutdown = async {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    };
    axum::serve(listener, router).with_graceful_shutdown(shutdown).await?;
    println!("stopping the builds that are running");
    builds.stop_all().await;
    Ok(())
}
