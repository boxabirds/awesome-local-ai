//! vidi-gallery: review every Vidi build side by side. Scores, judging and cost in one table, and
//! any final build running in its own window with a banner naming its setup and run. See README.md.

mod builds;
mod proxy;
mod record;
mod reviews;
mod runs;
mod stories;
mod sync;
mod trace;

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
/// The player's time maths, shared with its node tests (tests/player.test.cjs).
const PLAYER_JS: &str = include_str!("player.js");
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
    /// Story review: hide each build's setup and run behind a shuffled letter, revealed once every
    /// path of the story has a verdict (default: labelled, so the reviewer sees what they judge).
    #[arg(long)]
    blind: bool,
}

struct App {
    repo: PathBuf,
    builds: Builds,
    cache: PathBuf,
    blind: bool,
    /// The builds under story review, in their (shuffled, when blind) order: key i is letter i. Runs
    /// that become reviewable later are appended (see rescan), so a key never changes meaning.
    review_builds: std::sync::RwLock<Vec<runs::Run>>,
    /// The spec version family under review ("vidi-v2"): the private checkout's; only its runs are reviewed.
    family: String,
    /// Changes with every start: an open review page reloads itself when it sees a new one, so it never
    /// keeps running the code of a gallery that has been rebuilt.
    started: String,
    reviews: reviews::Store,
    /// The stories in review order, each with its prerequisites and the build it's reviewed on.
    stories: Vec<stories::Story>,
    /// Background preparation of every story's builds: slug -> "queued" / step / "failed: …".
    prep: tokio::sync::Mutex<std::collections::HashMap<String, String>>,
    /// The held-out suite, and where recorded walkthroughs go (git-ignored state/ in the private repo).
    acceptance: PathBuf,
    recordings: PathBuf,
    /// Names recordings' directories without naming their builds (record::blind_name).
    rec_secret: String,
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
/// How often the story review looks for runs that have become reviewable.
const RESCAN_EVERY: std::time::Duration = std::time::Duration::from_secs(60);

fn rec_key(run: &runs::Run, story: u64) -> String {
    format!("{}#{story:02}", run.slug)
}

/// What the gallery's recordings run from: its checkouts and the held-out suite (record::reap_listeners).
fn owned(app: &App) -> Vec<PathBuf> {
    [app.cache.join(builds::CHECKOUTS), app.acceptance.clone()].into_iter().map(|p| p.canonicalize().unwrap_or(p)).collect()
}

fn rec_dir(app: &App, run: &runs::Run, story: u64) -> PathBuf {
    app.recordings.join(record::blind_name(&app.rec_secret, &run.slug, story))
}

/// Whether a story of a build already has a finished, valid recording.
fn recorded(app: &App, run: &runs::Run, story: u64) -> bool {
    let out = rec_dir(app, run, story);
    out.join("report.json").is_file() && record::app_never_started(&record::paths(&out, &out)).is_none()
}

/// Record one story's held-out tests on its prepared review build, retrying a failed attempt.
async fn record_story(app: &App, run: &runs::Run, story: u64, ws: &std::path::Path) {
    let key = rec_key(run, story);
    let out = rec_dir(app, run, story);
    if recorded(app, run, story) {
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
        match record::record(&app.acceptance, &app.record_config, ws, story, &processed, &out, port, &owned(app)).await {
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

/// The stories reviewed on one build, in review order.
fn stories_on(app: &App, build: u64) -> Vec<u64> {
    app.stories.iter().filter(|s| s.review_build == build).map(|s| s.id).collect()
}

/// The checkout of one build of a run.
fn checkout_dir(app: &App, run: &runs::Run, build: u64) -> PathBuf {
    app.cache.join(builds::CHECKOUTS).join(story_slug(run, build))
}

/// How many builds are prepared at once.
const PREPARE_PARALLEL: usize = 3;
/// How many prepared builds may wait for the recorder. With the one the recorder is on and the one
/// waiting to be queued, at most PREPARE_AHEAD + 2 checkouts are prepared for recording at a time.
const PREPARE_AHEAD: usize = PREPARE_PARALLEL;

/// Check out one build and, unless every story reviewed on it is already recorded, install and build
/// it. Its checkout is always made: it is small, and the review's task list reads its history.
async fn prepare_one(app: &App, run: &runs::Run, build: u64) {
    let slug = story_slug(run, build);
    app.prep.lock().await.insert(slug.clone(), "preparing".into());
    let all_recorded = stories_on(app, build).iter().all(|&s| recorded(app, run, s));
    let result = match story_checkout(&app.cache, run, build).await {
        Ok(_) if all_recorded => Ok(()),
        Ok(ws) => builds::prepare(&ws, &app.cache).await,
        Err(e) => Err(e),
    };
    let status = match &result { Ok(_) => "ready".to_string(), Err(e) => format!("failed: {e:#}") };
    app.prep.lock().await.insert(slug, status);
}

/// Record every story reviewed on one prepared build, then release its checkout: node_modules and
/// the build output go (now, or when the build stops being served), the source stays.
async fn record_build(app: &App, run: &runs::Run, build: u64) {
    let slug = story_slug(run, build);
    let ws = checkout_dir(app, run, build);
    let ready = app.prep.lock().await.get(&slug).map(String::as_str) == Some("ready");
    for story in stories_on(app, build) {
        if ready {
            record_story(app, run, story, &ws).await;
        } else {
            app.rec.lock().await.insert(rec_key(run, story), "failed: its build could not be prepared".into());
        }
    }
    app.builds.release(&slug, &ws).await;
}

/// Prepare and record every (build, run) the review can open, story 1's builds first: a few builds
/// are prepared at a time, at most PREPARE_AHEAD ahead of the recorder, and each build's checkout is
/// released as soon as its recordings are done, so prepared checkouts (and the module stores they
/// hold) stay few. A build that is already recorded is only checked out.
async fn prepare_all(app: Arc<App>, runs: Vec<runs::Run>) {
    let mut builds_needed: Vec<u64> = Vec::new();
    for s in &app.stories {
        if !builds_needed.contains(&s.review_build) {
            builds_needed.push(s.review_build); // in review order, so the first story's builds come first
        }
    }
    for s in &app.stories {
        for r in &runs {
            app.rec.lock().await.insert(rec_key(r, s.id), "queued".into());
        }
    }
    let mut jobs = Vec::new();
    for b in builds_needed {
        for r in &runs {
            jobs.push((b, r.clone()));
            app.prep.lock().await.insert(story_slug(r, b), "queued".into());
        }
    }
    let (tx, mut rx) = tokio::sync::mpsc::channel(PREPARE_AHEAD);
    let gate = Arc::new(tokio::sync::Semaphore::new(PREPARE_PARALLEL));
    let producer = {
        let app = app.clone();
        tokio::spawn(async move {
            for (build, run) in jobs {
                app.builds.pin(&story_slug(&run, build)).await;
                let (app, gate, r) = (app.clone(), gate.clone(), run.clone());
                let task = tokio::spawn(async move {
                    let _permit = gate.acquire().await;
                    prepare_one(&app, &r, build).await;
                });
                if tx.send((build, run, task)).await.is_err() {
                    return;
                }
            }
        })
    };
    while let Some((build, run, task)) = rx.recv().await {
        let _ = task.await;
        record_build(&app, &run, build).await;
    }
    let _ = producer.await;
    println!("all walkthroughs recorded");
}

fn private_repo(repo: &std::path::Path) -> PathBuf {
    repo.parent().map(|p| p.join("awesome-local-ai-bench-private")).unwrap_or_default()
}

/// The private checkout's pack version ("vidi-v2.0-pre2"): its nearest tag.
fn private_version(private: &std::path::Path) -> String {
    std::process::Command::new("git")
        .arg("-C").arg(private).args(["describe", "--tags", "--abbrev=0"])
        .output().ok().filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Runs that became reviewable since the list was made: those in `now` not yet in `have`, in `now`'s order.
fn newly_reviewable(have: &[runs::Run], now: Vec<runs::Run>) -> Vec<runs::Run> {
    now.into_iter().filter(|r| !have.iter().any(|h| h.slug == r.slug)).collect()
}

/// Every RESCAN_EVERY, bring the checkout level with origin, then add runs that have become reviewable (finished, scored, with their bundle) to the
/// end of the list, so a run judged from the benchmarker's link appears without restarting the gallery,
/// and prepare them like the rest.
async fn rescan(app: Arc<App>) {
    loop {
        tokio::time::sleep(RESCAN_EVERY).await;
        let (repo, family) = (app.repo.clone(), app.family.clone());
        let pulled = repo.clone();
        // Take what the benchmark machines have pushed first, so the scan below sees it.
        if let Ok(Err(e)) = tokio::task::spawn_blocking(move || sync::sync_repo(&pulled)).await {
            eprintln!("sync: {e}");
        }
        let Ok(now) = tokio::task::spawn_blocking(move || reviewable(&repo, &family)).await else { continue };
        let added = {
            let mut list = app.review_builds.write().expect("review builds lock");
            let added = newly_reviewable(&list, now);
            list.extend(added.iter().cloned());
            added
        };
        if !added.is_empty() {
            println!("story review: {} more build(s): {}", added.len(), added.iter().map(|r| r.slug.as_str()).collect::<Vec<_>>().join(", "));
            tokio::spawn(prepare_all(app.clone(), added));
        }
    }
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
    let dir = cache.join(builds::CHECKOUTS).join(story_slug(run, story));
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

/// Finished, validly scored runs of one spec version family: the builds a story review compares.
/// Builds made from different specs can't be judged against one story's spec.
fn reviewable(repo: &std::path::Path, family: &str) -> Vec<runs::Run> {
    let mut list: Vec<runs::Run> =
        runs::load(repo).into_iter().filter(|r| is_reviewable(r) && runs::family(&r.pack_version) == family).collect();
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

impl App {
    /// The review builds now (a copy: the list can grow while a request uses it).
    fn rbs(&self) -> Vec<runs::Run> {
        self.review_builds.read().expect("review builds lock").clone()
    }
    fn rb(&self, key: usize) -> Option<runs::Run> {
        self.review_builds.read().expect("review builds lock").get(key).cloned()
    }
}

// ---------- story review ----------

async fn review_page() -> Html<&'static str> {
    Html(REVIEW_PAGE)
}

async fn player_js() -> impl IntoResponse {
    ([(axum::http::header::CONTENT_TYPE, "text/javascript")], PLAYER_JS)
}

fn build_label(app: &App, i: usize) -> String {
    let Some(r) = app.rb(i) else { return String::new() };
    if app.blind { format!("Build {}", letter(i)) } else { format!("{} · {}", r.setup, r.run) }
}

async fn api_review_state(State(app): State<Arc<App>>) -> impl IntoResponse {
    let stories = app.stories.clone();
    let rbs = app.rbs();
    let index: std::collections::HashMap<&str, usize> = rbs.iter().enumerate().map(|(i, r)| (r.slug.as_str(), i)).collect();
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
    // Labelled reviews also say which setup and run each build is, so a link can open one run.
    let builds: Vec<serde_json::Value> = rbs
        .iter()
        .enumerate()
        .map(|(i, r)| {
            if app.blind {
                serde_json::json!({"key": i, "label": build_label(&app, i)})
            } else {
                serde_json::json!({"key": i, "label": build_label(&app, i), "setup": r.setup, "run": r.run})
            }
        })
        .collect();
    Json(serde_json::json!({
        "blind": app.blind, "family": app.family, "started": app.started, "stories": stories, "builds": builds, "reviews": reviews,
        "file": app.reviews.path().display().to_string(),
    }))
}

async fn api_review_started(State(app): State<Arc<App>>) -> impl IntoResponse {
    Json(serde_json::json!({"started": app.started}))
}

async fn api_review_status(State(app): State<Arc<App>>, UrlPath(story): UrlPath<u64>) -> impl IntoResponse {
    let story = review_build(&app, story);
    let states = app.builds.states().await;
    let prep = app.prep.lock().await.clone();
    let by_key: Vec<serde_json::Value> = app
        .rbs()
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
    let keep: std::collections::HashSet<String> = app.rbs().iter().map(|r| story_slug(r, story)).collect();
    for slug in app.builds.states().await.into_keys() {
        if slug.contains('@') && !keep.contains(&slug) {
            app.builds.stop(&slug).await;
        }
    }
    StatusCode::NO_CONTENT
}

async fn api_review_open(State(app): State<Arc<App>>, UrlPath((story, key)): UrlPath<(u64, usize)>) -> impl IntoResponse {
    let Some(run) = app.rb(key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    let reviewed = story;
    let story = review_build(&app, story);
    let run = &run;
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
    let Some(run) = app.rb(body.key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    // A held-out test's own verdict: the judge's pass / fail becomes agree / disagree here, against the
    // result the page was never sent. A build with no recorded paths keeps its own pass / fail.
    let recorded = if body.path.is_empty() { None } else { recorded_paths(&app, &run, body.story).await.into_iter().find(|p| p.title == body.path) };
    let verdict = if !body.path.is_empty() && reviews::OWN.contains(&body.verdict.as_str()) {
        let Some(p) = &recorded else {
            return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no recording of this path"}))).into_response();
        };
        match reviews::from_own(&body.verdict, &p.status) {
            Ok(v) => v.to_string(),
            Err(e) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
        }
    } else {
        body.verdict.clone()
    };
    let now = utc_now();
    match app.reviews.set(body.story, &run.slug, &body.path, &verdict, &body.notes, &now) {
        // Answered: the reply shows the automated result beside the judge's; otherwise it says nothing of it.
        Ok(_) => {
            let path = recorded.filter(|_| reviews::answered(&verdict)).map(|p| path_json(&p, &verdict));
            Json(serde_json::json!({"saved": now, "verdict": verdict, "path": path})).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, Json(serde_json::json!({"error": e.to_string()}))).into_response(),
    }
}

/// One recorded path as the page may see it. Until the judge has given their own verdict, only its
/// title and whether it has a video: no result, no error, and no path into the recordings (a failing
/// test's folder also holds test-failed-1.png and error-context.md).
fn path_json(p: &record::Path_, verdict: &str) -> serde_json::Value {
    if reviews::answered(verdict) {
        serde_json::json!({"title": p.title, "answered": true, "status": p.status, "error": p.error, "trace": p.trace, "video": p.video.is_some()})
    } else {
        serde_json::json!({"title": p.title, "answered": false, "video": p.video.is_some()})
    }
}

/// The stored verdict of one path of one build.
fn verdict_of(app: &App, run: &runs::Run, story: u64, path: &str) -> String {
    app.reviews.all().into_iter().find(|r| r.story == story && r.build == run.slug && r.path == path).map(|r| r.verdict).unwrap_or_default()
}

/// Which build is which, for one story, only once every path of every build has a verdict on it:
/// seeing names earlier would bias the rest of that story's review.
async fn api_review_reveal(State(app): State<Arc<App>>, UrlPath(story): UrlPath<u64>) -> impl IntoResponse {
    let mut builds = Vec::new();
    let rbs = app.rbs();
    for run in &rbs {
        let titles = recorded_paths(&app, run, story).await.into_iter().map(|p| p.title).collect();
        builds.push((run.slug.clone(), titles));
    }
    if !reviews::story_reviewed(story, &builds, &app.reviews.all()) {
        return (StatusCode::CONFLICT, Json(serde_json::json!({"error": "give every path of every build a verdict on this story first"}))).into_response();
    }
    let names: Vec<serde_json::Value> = rbs
        .iter()
        .enumerate()
        .map(|(i, r)| serde_json::json!({"key": i, "setup": r.setup, "run": r.run}))
        .collect();
    Json(serde_json::json!(names)).into_response()
}

/// A build's recorded paths of a story, once its recording is finished and valid (a queued or
/// failed one may hold a stale bad attempt).
async fn recorded_paths(app: &App, run: &runs::Run, story: u64) -> Vec<record::Path_> {
    let state = app.rec.lock().await.get(&rec_key(run, story)).cloned().unwrap_or_default();
    if state == "done" { record::paths(&rec_dir(app, run, story), &app.recordings) } else { Vec::new() }
}

/// One recorded path (by its index in the build's paths), with its build.
async fn recorded_path(app: &App, story: u64, key: usize, idx: usize) -> Option<(runs::Run, record::Path_)> {
    let run = app.rb(key)?;
    let p = recorded_paths(app, &run, story).await.into_iter().nth(idx)?;
    Some((run, p))
}

/// The trace zip of one recorded path (by its index in the build's paths).
async fn trace_zip(app: &App, story: u64, key: usize, idx: usize) -> Option<PathBuf> {
    Some(app.recordings.join(recorded_path(app, story, key, idx).await?.1.trace?))
}

/// One recorded path as the player needs it: steps and each person's frames (trace::Walkthrough),
/// without its errors until the judge has given their own verdict.
async fn api_review_walkthrough(State(app): State<Arc<App>>, UrlPath((story, key, idx)): UrlPath<(u64, usize, usize)>) -> impl IntoResponse {
    let Some((run, p)) = recorded_path(&app, story, key, idx).await else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no recording of this path"}))).into_response();
    };
    let Some(zip) = p.trace.as_ref().map(|t| app.recordings.join(t)) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no recording of this path"}))).into_response();
    };
    let answered = reviews::answered(&verdict_of(&app, &run, story, &p.title));
    match tokio::task::spawn_blocking(move || trace::load(&zip)).await {
        Ok(Ok(w)) => Json(serde_json::json!(if answered { w } else { w.hidden() })).into_response(),
        // The error text is the test's; it would say how the test ended.
        Ok(Err(_)) | Err(_) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({"error": "the trace could not be read"}))).into_response(),
    }
}

/// A recorded path's video, by its position: the page is never given its path in the recordings.
async fn api_review_video(State(app): State<Arc<App>>, UrlPath((story, key, idx)): UrlPath<(u64, usize, usize)>) -> impl IntoResponse {
    match recorded_path(&app, story, key, idx).await.and_then(|(_, p)| p.video) {
        Some(rel) => serve_under(&app.recordings, &rel).await,
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn api_review_frame(State(app): State<Arc<App>>, UrlPath((story, key, idx, name)): UrlPath<(u64, usize, usize, String)>) -> impl IntoResponse {
    let Some(zip) = trace_zip(&app, story, key, idx).await else { return StatusCode::NOT_FOUND.into_response() };
    match tokio::task::spawn_blocking(move || trace::frame(&zip, &name)).await {
        Ok(Ok(bytes)) => ([(axum::http::header::CONTENT_TYPE, "image/jpeg"), (axum::http::header::CACHE_CONTROL, "max-age=86400")], bytes).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

/// A build's work on one story: the story's tasks with the status the harness recorded for this
/// build, the commits that name each task, and all of the story's commits. The spec doesn't say
/// which task implements which requirement, so this is the story's tasks, not a requirement's.
async fn api_review_tasks(State(app): State<Arc<App>>, UrlPath((story, key)): UrlPath<(u64, usize)>) -> impl IntoResponse {
    let Some(run) = app.rb(key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    let spec_tasks = app.stories.iter().find(|s| s.id == story).map(|s| s.tasks.clone()).unwrap_or_default();
    let metrics: serde_json::Value = std::fs::read_to_string(run.path.join("metrics.json")).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default();
    let status = runs::task_status(&metrics, story);
    let base = std::fs::read_to_string(run.path.join(format!("stories/{story:02}/base-commit"))).unwrap_or_default().trim().to_string();
    let head = run.story_commits.get(&story).cloned().unwrap_or_default();
    // The review build's checkout holds the whole history up to (at least) this story.
    let checkout = checkout_dir(&app, &run, review_build(&app, story));
    let mut commits: Vec<(String, String)> = Vec::new();
    if !head.is_empty() && checkout.join(".git").is_dir() {
        let range = if base.is_empty() { head.clone() } else { format!("{base}..{head}") };
        let out = tokio::process::Command::new("git").arg("-C").arg(&checkout)
            .args(["log", "--reverse", "--format=%h%x09%s", &range]).output().await;
        if let Ok(o) = out {
            commits = String::from_utf8_lossy(&o.stdout).lines().filter_map(|l| l.split_once('\t')).map(|(h, s)| (h.to_string(), s.to_string())).collect();
        }
    }
    let tasks: Vec<serde_json::Value> = spec_tasks
        .iter()
        .map(|t| {
            let named: Vec<&str> = commits.iter().filter(|(_, s)| runs::tasks_named(s).contains(&t.n)).map(|(_, s)| s.as_str()).collect();
            serde_json::json!({"n": t.n, "title": t.title, "kind": t.kind, "implements": t.implements,
                               "status": status.get(&t.n).cloned().unwrap_or_default(), "commits": named})
        })
        .collect();
    let commits: Vec<serde_json::Value> = commits.iter().map(|(h, s)| serde_json::json!({"hash": h, "subject": s})).collect();
    Json(serde_json::json!({"tasks": tasks, "commits": commits, "status_recorded": !status.is_empty()})).into_response()
}

/// One build's recorded walkthroughs of a story: each path (held-out test), with its result and trace
/// once the judge has given it their own verdict (path_json).
async fn api_review_paths(State(app): State<Arc<App>>, UrlPath((story, key)): UrlPath<(u64, usize)>) -> impl IntoResponse {
    let Some(run) = app.rb(key) else {
        return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "no such build"}))).into_response();
    };
    let state = app.rec.lock().await.get(&rec_key(&run, story)).cloned().unwrap_or_else(|| "not recorded".into());
    let paths: Vec<serde_json::Value> =
        recorded_paths(&app, &run, story).await.iter().map(|p| path_json(p, &verdict_of(&app, &run, story, &p.title))).collect();
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
    let blind = cli.blind;
    let family = runs::family(&private_version(&private_repo(&repo)));
    let mut review_builds = reviewable(&repo, &family);
    if blind {
        shuffle(&mut review_builds);
    }
    let reviews = reviews::Store::new(private_repo(&repo).join("analysis/story-reviews.csv"));
    let pack = private_repo(&repo).join("packs/vidi");
    let stories = stories::load_for_review(&pack, "canvas");
    let build_order: Vec<u64> = stories::load(&pack, "canvas").iter().map(|s| s.id).collect();
    let acceptance = pack.join("acceptance");
    let recordings = private_repo(&repo).join("state/recordings");
    let rec_secret = record::secret(&private_repo(&repo).join("state/recording-secret"))?;
    let record_config = record::write_config(&acceptance, &cache)?;
    let rec_ports = vec![REC_PORT_BASE]; // one recording at a time
    let app = Arc::new(App {
        repo: repo.clone(), builds: builds.clone(), cache, blind, review_builds: std::sync::RwLock::new(review_builds), family, started: utc_now(), reviews, stories,
        prep: Default::default(), acceptance, recordings, rec_secret, record_config, rec: Default::default(),
        rec_ports: tokio::sync::Mutex::new(rec_ports), build_order,
    });
    // What an earlier gallery left half-deleted, and module stores beyond the limit.
    builds::tidy(app.cache.clone()).await;
    tokio::spawn(prepare_all(app.clone(), app.rbs()));
    tokio::spawn(rescan(app.clone()));
    let router = Router::new()
        .route("/", get(page))
        .route("/api/runs", get(api_runs))
        .route("/api/status", get(api_status))
        .route("/api/open/{slug}", post(api_open))
        .route("/api/stop/{slug}", post(api_stop))
        .route("/review", get(review_page))
        .route("/review/player.js", get(player_js))
        .route("/api/review/state", get(api_review_state))
        .route("/api/review/started", get(api_review_started))
        .route("/api/review/status/{story}", get(api_review_status))
        .route("/api/review/story/{story}", post(api_review_story))
        .route("/api/review/open/{story}/{key}", post(api_review_open))
        .route("/api/review/set", post(api_review_set))
        .route("/api/review/reveal/{story}", get(api_review_reveal))
        .route("/api/review/paths/{story}/{key}", get(api_review_paths))
        .route("/api/review/walkthrough/{story}/{key}/{idx}", get(api_review_walkthrough))
        .route("/api/review/video/{story}/{key}/{idx}", get(api_review_video))
        .route("/api/review/frame/{story}/{key}/{idx}/{name}", get(api_review_frame))
        .route("/api/review/tasks/{story}/{key}", get(api_review_tasks))
        .route("/recordings/{*path}", get(recordings_file))
        .route("/trace/{*path}", get(trace_viewer))
        .with_state(app.clone());
    let app_for_shutdown = app.clone();
    let addr = SocketAddr::from(([127, 0, 0, 1], cli.port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("vidi-gallery: http://{addr}/  (repo {})", repo.display());
    println!("story review: http://{addr}/review  ({} {} builds, {})", app.rbs().len(), app.family, if blind { "blind" } else { "labelled" });
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
    // A recording cut off here leaves the suite's detached app server behind.
    record::reap_listeners(&[REC_PORT_BASE, REC_PORT_BASE + 1], &owned(&app_for_shutdown)).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_rescan_adds_only_runs_not_already_under_review_keeping_the_order() {
        let run = |slug: &str| runs::Run { slug: slug.into(), ..Default::default() };
        let have = vec![run("a"), run("b")];
        let added = newly_reviewable(&have, vec![run("b"), run("c"), run("a"), run("d")]);
        assert_eq!(added.iter().map(|r| r.slug.as_str()).collect::<Vec<_>>(), ["c", "d"]);
    }

    // ---------- the automated result stays hidden until the judge has answered ----------

    use std::io::Write;

    const STORY: u64 = 4;
    const KEY: usize = 0;
    const PASSING: &str = "a note can be dragged @ref prd:notes.drag";
    const FAILING: &str = "two people see the same note @ref prd:live.sync";
    /// Only the failing test's error, trace and sibling files carry these: finding one in a payload
    /// sent before the judge answers is a leak.
    const ERROR_MARK: &str = "SENTINEL-ERROR expect(locator).toBeVisible() failed";
    const FAILING_DIR: &str = "artifacts/story-04-two-people-chromium";
    const PASSING_DIR: &str = "artifacts/story-04-a-note-chromium";
    const VIDEO: &[u8] = b"WEBM";
    /// What must never reach the page for an unanswered test: the result, its error, and any path
    /// into the recordings folder (whose failing-test folders also hold test-failed-1.png and error-context.md).
    const TELLS: [&str; 7] = ["passed", "failed", "timedOut", "SENTINEL-ERROR", "artifacts/", "trace.zip", "video.webm"];

    struct Fixture {
        app: Arc<App>,
        dir: PathBuf,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn trace_zip_with(path: &std::path::Path, error: Option<&str>) {
        let l = |v: serde_json::Value| v.to_string() + "\n";
        let mut test = l(serde_json::json!({"type": "before", "callId": "expect@1", "stepId": "expect@1", "startTime": 1.0, "method": "expect", "title": "Expect \"toBeVisible\""}));
        test += &match error {
            Some(e) => l(serde_json::json!({"type": "after", "callId": "expect@1", "endTime": 2.0, "error": {"message": e}})) + &l(serde_json::json!({"type": "error", "message": e})),
            None => l(serde_json::json!({"type": "after", "callId": "expect@1", "endTime": 2.0})),
        };
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
        z.start_file("test.trace", zip::write::SimpleFileOptions::default()).unwrap();
        z.write_all(test.as_bytes()).unwrap();
        z.finish().unwrap();
    }

    /// One labelled build whose story 4 recording is done: PASSING passed (with a video), FAILING failed.
    fn fixture() -> Fixture {
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("vidi-gallery-hidden-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let run = runs::Run { slug: "setup__run-1".into(), setup: "setup".into(), run: "run-1".into(), ..Default::default() };
        let recordings = dir.join("recordings");
        let secret = "test-secret".to_string();
        let out = recordings.join(record::blind_name(&secret, &run.slug, STORY));
        trace_zip_with(&out.join(PASSING_DIR).join("trace.zip"), None);
        trace_zip_with(&out.join(FAILING_DIR).join("trace.zip"), Some(ERROR_MARK));
        std::fs::write(out.join(PASSING_DIR).join("video.webm"), VIDEO).unwrap();
        std::fs::write(out.join(FAILING_DIR).join("test-failed-1.png"), b"PNG").unwrap();
        let attach = |name: &str, d: &str, f: &str| serde_json::json!({"name": name, "path": out.join(d).join(f)});
        let report = serde_json::json!({"suites": [{"specs": [
            {"title": PASSING, "tests": [{"results": [{"status": "passed", "attachments": [attach("trace", PASSING_DIR, "trace.zip"), attach("video", PASSING_DIR, "video.webm")]}]}]},
            {"title": FAILING, "tests": [{"results": [{"status": "failed", "error": {"message": ERROR_MARK}, "attachments": [attach("trace", FAILING_DIR, "trace.zip")]}]}]},
        ]}]});
        std::fs::write(out.join("report.json"), report.to_string()).unwrap();
        let rec = std::collections::HashMap::from([(rec_key(&run, STORY), "done".to_string())]);
        let app = Arc::new(App {
            repo: dir.clone(), builds: Builds::new(dir.join("cache")), cache: dir.join("cache"), blind: false,
            review_builds: std::sync::RwLock::new(vec![run]), family: "vidi-v2".into(), started: "t0".into(),
            reviews: reviews::Store::new(dir.join("analysis/story-reviews.csv")),
            stories: vec![stories::Story { id: STORY, review_build: STORY, ..Default::default() }], prep: Default::default(),
            acceptance: dir.join("acceptance"), recordings, rec_secret: secret, record_config: dir.join("record.config.ts"),
            rec: tokio::sync::Mutex::new(rec), rec_ports: tokio::sync::Mutex::new(Vec::new()), build_order: Vec::new(),
        });
        Fixture { app, dir }
    }

    async fn body(r: axum::response::Response) -> (StatusCode, String) {
        let status = r.status();
        let bytes = axum::body::to_bytes(r.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).into_owned())
    }
    fn json(s: &str) -> serde_json::Value {
        serde_json::from_str(s).unwrap_or_else(|e| panic!("not JSON ({e}): {s}"))
    }
    async fn paths(f: &Fixture) -> String {
        body(api_review_paths(State(f.app.clone()), UrlPath((STORY, KEY))).await.into_response()).await.1
    }
    async fn walkthrough(f: &Fixture, idx: usize) -> String {
        body(api_review_walkthrough(State(f.app.clone()), UrlPath((STORY, KEY, idx))).await.into_response()).await.1
    }
    async fn set(f: &Fixture, path: &str, verdict: &str) -> (StatusCode, String) {
        let input = ReviewIn { story: STORY, key: KEY, path: path.into(), verdict: verdict.into(), notes: String::new() };
        body(api_review_set(State(f.app.clone()), Json(input)).await.into_response()).await
    }
    fn assert_no_tells(what: &str, payload: &str) {
        for tell in TELLS {
            assert!(!payload.contains(tell), "{what} gives away the automated result with {tell:?}: {payload}");
        }
    }
    fn stored(f: &Fixture, path: &str) -> String {
        f.app.reviews.all().into_iter().find(|r| r.path == path).map(|r| r.verdict).unwrap_or_default()
    }

    #[tokio::test]
    async fn unanswered_tests_are_listed_by_title_only() {
        let f = fixture();
        let p = paths(&f).await;
        assert_no_tells("the paths of an unanswered story", &p);
        let v = json(&p);
        assert_eq!(v["state"], "done");
        assert_eq!(v["paths"], serde_json::json!([
            {"title": PASSING, "answered": false, "video": true},
            {"title": FAILING, "answered": false, "video": false},
        ]));
    }

    #[tokio::test]
    async fn a_skipped_test_or_a_note_alone_keeps_the_result_hidden() {
        let f = fixture();
        assert_eq!(set(&f, FAILING, "skip").await.0, StatusCode::OK);
        assert_eq!(set(&f, PASSING, "").await.0, StatusCode::OK);
        assert_no_tells("the paths after a skip and a note", &paths(&f).await);
        assert_no_tells("the failing test's walkthrough after a skip", &walkthrough(&f, 1).await);
    }

    #[tokio::test]
    async fn an_answered_test_shows_its_automated_result_error_and_trace_the_others_stay_hidden() {
        let f = fixture();
        set(&f, FAILING, "fail").await;
        let v = json(&paths(&f).await);
        let failing = &v["paths"][1];
        assert_eq!((failing["answered"].as_bool(), failing["status"].as_str(), failing["error"].as_str()), (Some(true), Some("failed"), Some(ERROR_MARK)));
        assert!(failing["trace"].as_str().unwrap().ends_with(&format!("{FAILING_DIR}/trace.zip")));
        assert_eq!(v["paths"][0], serde_json::json!({"title": PASSING, "answered": false, "video": true}), "one answer reveals one test");
    }

    #[tokio::test]
    async fn an_unanswered_walkthrough_has_its_steps_but_no_errors_until_answered() {
        let f = fixture();
        let before = walkthrough(&f, 1).await;
        assert_no_tells("the failing test's walkthrough", &before);
        assert_eq!(json(&before)["steps"][0]["title"], "Expect \"toBeVisible\"", "the judge still sees what the test checks");
        set(&f, FAILING, "pass").await;
        assert!(walkthrough(&f, 1).await.contains("SENTINEL-ERROR"), "once answered, the failing step shows its error as before");
    }

    #[tokio::test]
    async fn the_judges_own_pass_or_fail_is_saved_as_agree_or_disagree_and_answered_with_the_result() {
        let f = fixture();
        for (path, own, want, automated) in [(FAILING, "fail", "agree", "failed"), (FAILING, "pass", "disagree", "failed"), (PASSING, "pass", "agree", "passed"), (PASSING, "fail", "disagree", "passed")] {
            let (code, b) = set(&f, path, own).await;
            assert_eq!(code, StatusCode::OK, "{b}");
            assert_eq!(stored(&f, path), want, "{own} on a test that {automated}");
            let r = json(&b);
            assert_eq!((r["verdict"].as_str(), r["path"]["status"].as_str()), (Some(want), Some(automated)), "the reply reveals the result: {b}");
        }
    }

    #[tokio::test]
    async fn an_agree_or_disagree_given_blind_is_saved_as_it_is_and_only_then_reveals_the_result() {
        // What a d and the whole-story keys send: a verdict on a test whose result the page hasn't seen.
        let f = fixture();
        assert_no_tells("the paths before", &paths(&f).await);
        for (path, v, automated) in [(FAILING, "agree", "failed"), (PASSING, "disagree", "passed")] {
            let (code, b) = set(&f, path, v).await;
            assert_eq!((code, stored(&f, path)), (StatusCode::OK, v.to_string()));
            assert_eq!(json(&b)["path"]["status"], automated, "the reply reveals it: {b}");
        }
        let v = json(&paths(&f).await);
        assert_eq!((v["paths"][0]["status"].as_str(), v["paths"][1]["status"].as_str()), (Some("passed"), Some("failed")));
        // and back to review hides them again
        set(&f, FAILING, "").await;
        set(&f, PASSING, "").await;
        assert_no_tells("the paths after clearing", &paths(&f).await);
    }

    #[tokio::test]
    async fn skip_clear_and_a_note_are_saved_as_they_are_and_reveal_nothing() {
        let f = fixture();
        for v in ["skip", ""] {
            let (code, b) = set(&f, FAILING, v).await;
            assert_eq!((code, stored(&f, FAILING)), (StatusCode::OK, v.to_string()));
            assert_no_tells(&format!("the reply to {v:?}"), &b);
            assert!(json(&b)["path"].is_null());
        }
        // A note saved on an answered test resends its stored verdict unchanged.
        set(&f, FAILING, "fail").await;
        assert_eq!(set(&f, FAILING, "agree").await.0, StatusCode::OK);
        assert_eq!(stored(&f, FAILING), "agree");
    }

    #[tokio::test]
    async fn a_pass_or_fail_on_a_test_with_no_recording_is_refused_and_the_build_itself_takes_pass_or_fail_as_before() {
        let f = fixture();
        let (code, b) = set(&f, "a test that was never recorded", "pass").await;
        assert_eq!(code, StatusCode::NOT_FOUND, "{b}");
        assert!(f.app.reviews.all().is_empty(), "nothing saved");
        assert_eq!(set(&f, "", "fail").await.0, StatusCode::OK);
        assert_eq!(stored(&f, ""), "fail", "a build with no recorded paths keeps its own pass / fail");
    }

    #[tokio::test]
    async fn the_video_is_served_by_the_tests_position_not_by_a_path_into_the_recordings() {
        let f = fixture();
        let (code, got) = body(api_review_video(State(f.app.clone()), UrlPath((STORY, KEY, 0))).await.into_response()).await;
        assert_eq!((code, got.as_bytes()), (StatusCode::OK, VIDEO));
        assert_eq!(api_review_video(State(f.app.clone()), UrlPath((STORY, KEY, 1))).await.into_response().status(), StatusCode::NOT_FOUND, "the failing test has no video");
        assert_eq!(api_review_video(State(f.app.clone()), UrlPath((STORY, KEY, 9))).await.into_response().status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn nothing_the_page_loads_before_an_answer_gives_the_result_away() {
        let f = fixture();
        set(&f, FAILING, "").await;  // a note-only row: in the state, but unanswered
        let page = review_page().await.0;
        assert!(!page.contains("SENTINEL") && !page.contains("artifacts/"), "the page is static");
        assert_no_tells("the review state", &body(api_review_state(State(f.app.clone())).await.into_response()).await.1);
        assert_no_tells("the story's paths", &paths(&f).await);
        for idx in [0, 1] {
            assert_no_tells(&format!("walkthrough {idx}"), &walkthrough(&f, idx).await);
        }
        assert_no_tells("the builds' status", &body(api_review_status(State(f.app.clone()), UrlPath(STORY)).await.into_response()).await.1);
    }

    // ---------- a checkout is released once its recordings are done ----------

    #[tokio::test]
    async fn once_a_builds_recordings_are_done_its_checkout_keeps_only_its_source() {
        let f = fixture();
        let run = f.app.rb(KEY).unwrap();
        let ws = checkout_dir(&f.app, &run, STORY);
        for file in [".git/HEAD", "src/main.ts", "node_modules/pkg/index.js", "dist/index.html", ".wrangler/state"] {
            std::fs::create_dir_all(ws.join(file).parent().unwrap()).unwrap();
            std::fs::write(ws.join(file), b"x").unwrap();
        }
        std::fs::write(ws.join(".gallery-prepared"), "k1").unwrap();
        f.app.prep.lock().await.insert(story_slug(&run, STORY), "ready".into());
        f.app.builds.pin(&story_slug(&run, STORY)).await;
        record_build(&f.app, &run, STORY).await;
        assert_eq!(f.app.rec.lock().await.get(&rec_key(&run, STORY)).map(String::as_str), Some("done"));
        for gone in ["node_modules", "dist", ".wrangler", ".gallery-prepared"] {
            assert!(!ws.join(gone).exists(), "{gone} should be gone once the recording is done");
        }
        for kept in [".git/HEAD", "src/main.ts"] {
            assert!(ws.join(kept).is_file(), "{kept} should stay");
        }
    }
}
