//! The HTTP API and the shared job table.

use anyhow::{Context, Result};
use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, Path as UrlPath, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::net::SocketAddr;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Notify;

use crate::cli::ServerConfig;
use crate::collect::{self, FileKind, FileName, Manifest, RunListing};
use crate::control::{self, SkipStory, SkipStoryRequest};
use crate::events::parse_log;
use crate::ids::valid_id;
use crate::job::{resolve_entry, submit_decision, Job, JobSpec, JobState, SubmitOutcome};
use crate::progress::{self, install_env_path, Progress};
use crate::recovery::{self, ProcessCheck, Recovery};
use crate::store;
use crate::sys;
use crate::timefmt::{fmt_utc, now_secs};

pub const TOKEN_FILE: &str = "token";
const TOKEN_MODE: u32 = 0o600;
const DIR_MODE: u32 = 0o700;
/// How often a followed log is checked for new bytes.
pub const LOG_FOLLOW_POLL: Duration = Duration::from_millis(500);
/// Largest chunk sent at once when streaming a log.
const LOG_CHUNK_BYTES: usize = 64 * 1024;
/// Printed on stdout once the listener is bound; tests and scripts read the address from it.
pub const LISTENING_PREFIX: &str = "dbench listening on ";

pub struct Inner {
    pub jobs: HashMap<String, Job>,
    pub queue: VecDeque<String>,
    pub current: Option<String>,
    /// While set, no new job starts (control::Hold).
    pub hold: Option<crate::control::Hold>,
}

pub struct Shared {
    pub cfg: ServerConfig,
    pub token: String,
    pub boot_time: Option<u64>,
    pub inner: Mutex<Inner>,
    pub wake: Notify,
}

impl Shared {
    pub fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn persist(&self, job: &Job) {
        if let Err(e) = store::save_job(&self.cfg.jobs_dir, job) {
            eprintln!("dbench: saving job {}: {e:#}", job.id);
        }
    }

    /// Mutate a job under the lock, stamp and save it, and return a copy.
    pub fn update(&self, id: &str, f: impl FnOnce(&mut Job, &mut Inner)) -> Option<Job> {
        let mut inner = self.lock();
        let mut job = inner.jobs.remove(id)?;
        f(&mut job, &mut inner);
        job.updated_at = now_secs();
        self.persist(&job);
        inner.jobs.insert(id.to_string(), job.clone());
        Some(job)
    }

    pub fn log_path(&self, id: &str) -> PathBuf {
        store::log_path(&self.cfg.jobs_dir, id)
    }

    /// Append a `[dbench <time>] ...` line to a job's log.
    pub fn log_line(&self, id: &str, msg: &str) {
        let res = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.log_path(id))
            .and_then(|mut f| writeln!(f, "[dbench {}] {msg}", fmt_utc(now_secs())));
        if let Err(e) = res {
            eprintln!("dbench: writing log for {id}: {e}");
        }
    }

    fn job(&self, id: &str) -> Option<Job> {
        self.lock().jobs.get(id).cloned()
    }

    fn view(&self, job: Job) -> JobView {
        let progress = progress::compute(
            &self.cfg.repo,
            &self.cfg.share_dir,
            &job.spec,
            &self.log_path(&job.id),
        );
        JobView { job, progress }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JobView {
    #[serde(flatten)]
    pub job: Job,
    pub progress: Progress,
}

fn err(status: StatusCode, msg: impl Into<String>) -> Response {
    (status, Json(json!({ "error": msg.into() }))).into_response()
}

/// Read `<home>/token`, or create it (0600) if it's missing.
pub fn load_or_create_token(home: &std::path::Path) -> Result<String> {
    let path = home.join(TOKEN_FILE);
    if let Ok(t) = std::fs::read_to_string(&path) {
        let t = t.trim().to_string();
        anyhow::ensure!(!t.is_empty(), "{} is empty", path.display());
        return Ok(t);
    }
    let token = sys::random_token()?;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(TOKEN_MODE)
        .open(&path)
        .with_context(|| format!("create {}", path.display()))?;
    writeln!(f, "{token}")?;
    eprintln!("dbench: created a new token in {}", path.display());
    Ok(token)
}

/// Load jobs from disk and apply the recovery rule to any left `running`.
/// Returns the state plus the jobs to adopt (still running from a previous server).
/// A job left running by the previous server, still alive: (job id, process group).
pub type Adopted = (String, i32);

pub fn recover(cfg: ServerConfig, token: String) -> Result<(Arc<Shared>, Vec<Adopted>)> {
    let boot_time = sys::boot_time();
    let now = now_secs();
    let mut jobs = store::load_jobs(&cfg.jobs_dir)?;
    jobs.sort_by(|a, b| (a.submitted_at, a.seq, &a.id).cmp(&(b.submitted_at, b.seq, &b.id)));

    let mut front: Vec<String> = Vec::new();
    let mut back: Vec<String> = Vec::new();
    let mut adopt: Vec<Adopted> = Vec::new();
    let mut table = HashMap::new();
    for mut job in jobs {
        let check = match job.state {
            JobState::Running {
                pid,
                pgid,
                boot_time: started_boot,
                ..
            } => ProcessCheck {
                alive: sys::leads_group(pid, pgid) || sys::group_alive(pgid),
                same_boot: match (started_boot, boot_time) {
                    (Some(a), Some(b)) => a == b,
                    _ => true,
                },
            },
            _ => ProcessCheck {
                alive: false,
                same_boot: true,
            },
        };
        let decision = recovery::decide(
            &job.state,
            job.attempt,
            cfg.max_restarts,
            job.cancel_requested,
            check,
        );
        let adopted = matches!(decision, Recovery::Adopt { .. });
        let mut changed = true;
        match decision {
            Recovery::Keep => {
                changed = false;
                if job.state == JobState::Queued {
                    back.push(job.id.clone());
                }
            }
            Recovery::Adopt { pid, pgid } => {
                job.note(
                    now,
                    format!("server restarted; adopted running harness pid {pid}"),
                );
                adopt.push((job.id.clone(), pgid));
            }
            Recovery::Requeue => {
                job.note(now, "server restarted and the harness was gone (crash or reboot); requeued to resume");
                job.state = JobState::Queued;
                front.push(job.id.clone());
            }
            Recovery::Cancelled => {
                job.note(now, "harness gone after a cancel; marked cancelled");
                job.state = JobState::Cancelled;
            }
            Recovery::Fail { reason } => {
                job.note(now, reason.clone());
                job.state = JobState::Failed {
                    reason,
                    exit_code: None,
                };
            }
        }
        if changed || adopted {
            job.updated_at = now;
            store::save_job(&cfg.jobs_dir, &job)?;
        }
        table.insert(job.id.clone(), job);
    }
    let queue: VecDeque<String> = front.into_iter().chain(back).collect();
    let cfg_home = cfg.home.clone();
    let shared = Arc::new(Shared {
        cfg,
        token,
        boot_time,
        inner: Mutex::new(Inner {
            jobs: table,
            queue,
            current: None,
            hold: crate::control::load_hold(&cfg_home),
        }),
        wake: Notify::new(),
    });
    for (id, _) in &adopt {
        shared.log_line(id, "server restarted; adopted the running harness");
    }
    Ok((shared, adopt))
}

pub fn router(shared: Arc<Shared>) -> Router {
    let protected = Router::new()
        .route("/v1/node", get(node))
        .route("/v1/hold", post(hold))
        .route("/v1/release", post(release))
        .route("/v1/jobs", get(list_jobs))
        .route("/v1/jobs/{id}", get(get_job).put(submit))
        .route("/v1/jobs/{id}/cancel", post(cancel))
        .route("/v1/jobs/{id}/skip-story", post(skip_story))
        .route("/v1/jobs/{id}/log", get(log))
        .route("/v1/jobs/{id}/events", get(events))
        .route("/v1/jobs/{id}/files", get(job_files))
        .route("/v1/jobs/{id}/file", get(job_file))
        .route("/v1/runs", get(list_runs))
        .route("/v1/runs/files", get(run_files))
        .route("/v1/runs/file", get(run_file))
        .route_layer(middleware::from_fn_with_state(shared.clone(), auth));
    Router::new()
        .route("/v1/health", get(health))
        .merge(protected)
        .with_state(shared)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn auth(
    State(st): State<Arc<Shared>>,
    headers: HeaderMap,
    req: Request,
    next: Next,
) -> Response {
    let given = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    if !constant_time_eq(given.trim().as_bytes(), st.token.as_bytes()) {
        return err(StatusCode::UNAUTHORIZED, "missing or wrong bearer token");
    }
    next.run(req).await
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "ok": true, "version": crate::VERSION }))
}

async fn node(State(st): State<Arc<Shared>>) -> Json<crate::node::NodeInfo> {
    let current = st.lock().current.clone();
    let mut info = crate::node::gather(&st.cfg.repo, &st.cfg.share_dir, &st.cfg.child_path(), current).await;
    info.hold = st.lock().hold.clone();
    Json(info)
}

/// Hold the node: the running job carries on; no queued job starts until a release. Needs a reason.
async fn hold(
    State(st): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    body: Bytes,
) -> Response {
    let reason = serde_json::from_slice::<crate::control::HoldRequest>(&body)
        .map(|r| r.reason.trim().to_string())
        .unwrap_or_default();
    if reason.is_empty() {
        return err(
            StatusCode::BAD_REQUEST,
            "give a reason ({\"reason\": \"...\"}): it is shown while the node is held",
        );
    }
    let h = crate::control::Hold { reason, by: peer.ip().to_string(), at: now_secs() };
    let bytes = match serde_json::to_vec_pretty(&h) {
        Ok(b) => b,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    if let Err(e) = store::write_atomic(&st.cfg.home.join(crate::control::HOLD_FILE), &bytes) {
        return err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"));
    }
    let current = {
        let mut inner = st.lock();
        inner.hold = Some(h.clone());
        inner.current.clone()
    };
    if let Some(id) = &current {
        st.log_line(id, &format!("node held by {}: {}; no new job starts until a release", h.by, h.reason));
    }
    (StatusCode::OK, Json(json!({ "hold": h, "current_job": current }))).into_response()
}

/// Release a hold: queued jobs start again. Releasing a node that isn't held is fine.
async fn release(State(st): State<Arc<Shared>>) -> Response {
    match std::fs::remove_file(st.cfg.home.join(crate::control::HOLD_FILE)) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
    st.lock().hold = None;
    st.wake.notify_one();
    (StatusCode::OK, Json(json!({ "hold": null }))).into_response()
}

async fn list_jobs(State(st): State<Arc<Shared>>) -> Json<Vec<JobView>> {
    let mut jobs: Vec<Job> = st.lock().jobs.values().cloned().collect();
    jobs.sort_by(|a, b| (b.submitted_at, b.seq, &b.id).cmp(&(a.submitted_at, a.seq, &a.id)));
    Json(jobs.into_iter().map(|j| st.view(j)).collect())
}

async fn get_job(State(st): State<Arc<Shared>>, UrlPath(id): UrlPath<String>) -> Response {
    match st.job(&id) {
        Some(j) => Json(st.view(j)).into_response(),
        None => err(StatusCode::NOT_FOUND, format!("no job {id}")),
    }
}

async fn submit(
    State(st): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    UrlPath(id): UrlPath<String>,
    Json(mut spec): Json<JobSpec>,
) -> Response {
    if !valid_id(&id) {
        return err(StatusCode::BAD_REQUEST, format!("invalid job id {id:?}"));
    }
    if let Err(e) = spec.validate() {
        return err(StatusCode::BAD_REQUEST, e);
    }
    // Before the idempotency check, so the same job submitted by combination and
    // by install id compares equal instead of conflicting.
    if let Some(combination) = spec.combination.take() {
        let found = match progress::repo_combination(&st.cfg.repo, &combination) {
            Ok(found) => found,
            Err(e) => return err(StatusCode::BAD_REQUEST, e),
        };
        // Results are filed under the COMBINATION in install.env; if the install
        // is of a different one, they would land somewhere other than asked.
        if let Some(env) = progress::read_install_env(&st.cfg.share_dir, &found.install_id) {
            if env.get("COMBINATION") != Some(&found.combination) {
                return err(
                    StatusCode::BAD_REQUEST,
                    format!(
                        "{} is installed as {:?}, not {:?}",
                        found.install_id,
                        env.get("COMBINATION")
                            .map_or("(no COMBINATION)", String::as_str),
                        found.combination
                    ),
                );
            }
        }
        spec.install_id = found.install_id;
    }
    let existing = st.job(&id);
    match submit_decision(existing.as_ref().map(|j| &j.spec), &spec) {
        SubmitOutcome::Existing => {
            return (StatusCode::OK, Json(st.view(existing.expect("existing")))).into_response()
        }
        SubmitOutcome::Conflict => {
            return err(
                StatusCode::CONFLICT,
                format!("job {id} exists with a different spec"),
            );
        }
        SubmitOutcome::Create => {}
    }
    let env = install_env_path(&st.cfg.share_dir, &spec.install_id);
    if !env.is_file() {
        return err(
            StatusCode::BAD_REQUEST,
            format!(
                "{} is not installed ({} missing)",
                spec.install_id,
                env.display()
            ),
        );
    }
    if resolve_entry(&st.cfg.repo, &spec.pack).is_none() {
        return err(
            StatusCode::BAD_REQUEST,
            format!(
                "no harness for pack {} in {}",
                spec.pack,
                st.cfg.repo.display()
            ),
        );
    }
    let job = {
        let mut inner = st.lock();
        // Re-check under the lock: two identical submits may race.
        if let Some(j) = inner.jobs.get(&id) {
            let j = j.clone();
            drop(inner);
            return match submit_decision(Some(&j.spec), &spec) {
                SubmitOutcome::Conflict => err(
                    StatusCode::CONFLICT,
                    format!("job {id} exists with a different spec"),
                ),
                _ => (StatusCode::OK, Json(st.view(j))).into_response(),
            };
        }
        let mut job = Job::new(id.clone(), spec, now_secs());
        job.seq = inner.jobs.values().map(|j| j.seq).max().unwrap_or(0) + 1;
        st.persist(&job);
        inner.jobs.insert(id.clone(), job.clone());
        inner.queue.push_back(id.clone());
        job
    };
    st.log_line(&id, &format!("submitted by {}", peer.ip()));
    st.wake.notify_one();
    (StatusCode::CREATED, Json(st.view(job))).into_response()
}

async fn cancel(
    State(st): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    UrlPath(id): UrlPath<String>,
    body: Bytes,
) -> Response {
    let by = peer.ip();
    let Some(job) = st.job(&id) else {
        return err(StatusCode::NOT_FOUND, format!("no job {id}"));
    };
    // Parsed by hand so a missing or malformed body gets the same plain 400 as a blank reason.
    let reason = serde_json::from_slice::<crate::control::CancelRequest>(&body)
        .map(|r| r.reason.trim().to_string())
        .unwrap_or_default();
    if reason.is_empty() {
        return err(
            StatusCode::BAD_REQUEST,
            "give a reason ({\"reason\": \"...\"}): it is kept with the job",
        );
    }
    match job.state {
        JobState::Queued => {
            let line = format!("cancelled while queued by {by}: {reason}");
            let j = st.update(&id, |j, inner| {
                j.state = JobState::Cancelled;
                j.cancel_reason = Some(reason.clone());
                j.note(now_secs(), line.clone());
                inner.queue.retain(|q| q != &id);
            });
            st.log_line(&id, &line);
            (StatusCode::OK, Json(st.view(j.expect("job")))).into_response()
        }
        JobState::Running { pgid, .. } => {
            let line = format!("cancel requested by {by}: {reason}");
            let j = st.update(&id, |j, _| {
                if !j.cancel_requested {
                    j.note(now_secs(), line.clone());
                    j.cancel_reason = Some(reason.clone());
                }
                j.cancel_requested = true;
            });
            st.log_line(&id, &line);
            st.log_line(&id, &format!("cancel: SIGTERM to process group {pgid}"));
            tokio::spawn(crate::runner::terminate_group(pgid, st.cfg.cancel_grace));
            (StatusCode::ACCEPTED, Json(st.view(j.expect("job")))).into_response()
        }
        JobState::Cancelled if job.cancel_reason.is_none() => {
            // Cancelled before reasons were kept: it takes this one, noted as given afterwards.
            let line = format!("reason given after the cancel, by {by}: {reason}");
            let j = st.update(&id, |j, _| {
                j.cancel_reason = Some(reason.clone());
                j.note(now_secs(), line.clone());
            });
            st.log_line(&id, &line);
            (StatusCode::OK, Json(st.view(j.expect("job")))).into_response()
        }
        JobState::Cancelled => (StatusCode::OK, Json(st.view(job))).into_response(),
        JobState::Done { .. } | JobState::Failed { .. } => err(
            StatusCode::CONFLICT,
            format!("job {id} already finished ({})", job.state.label()),
        ),
    }
}

/// Ask the harness to end the running story as PARTIAL and go on to the next
/// one, by writing `control/skip-story.json` in its run dir. The job keeps
/// running; the harness applies the request within a few seconds.
async fn skip_story(
    State(st): State<Arc<Shared>>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    UrlPath(id): UrlPath<String>,
    Json(req): Json<SkipStoryRequest>,
) -> Response {
    let by = peer.ip();
    let Some(job) = st.job(&id) else {
        return err(StatusCode::NOT_FOUND, format!("no job {id}"));
    };
    let reason = req.reason.trim();
    if reason.is_empty() {
        return err(
            StatusCode::BAD_REQUEST,
            "give a reason: it is recorded with the PARTIAL story",
        );
    }
    if !matches!(job.state, JobState::Running { .. }) {
        return err(
            StatusCode::CONFLICT,
            format!("job {id} is not running ({})", job.state.label()),
        );
    }
    let dir = match progress::resolve_run_dir(&st.cfg.repo, &st.cfg.share_dir, &job.spec) {
        Ok((_, dir)) => dir,
        Err(e) => return err(StatusCode::CONFLICT, format!("job {id}: {e}")),
    };
    let story = req.story.to_string();
    match progress::read_current_story(&dir).filter(|c| !c.is_empty()) {
        Some(current) if current == story => {}
        Some(current) => {
            return err(
                StatusCode::CONFLICT,
                format!("story {story} is not running; the current story is {current}"),
            )
        }
        None => {
            return err(
                StatusCode::CONFLICT,
                format!("story {story} is not running; no story is running right now"),
            )
        }
    }
    let file = SkipStory {
        story: req.story,
        reason: reason.to_string(),
        by: by.to_string(),
        at: now_secs(),
    };
    if let Err(e) = control::write_skip_story(&dir, &file) {
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("writing {}: {e}", control::skip_story_path(&dir).display()),
        );
    }
    let text = format!("skip-story {story} requested by {by}: {reason}");
    let j = st.update(&id, |j, _| j.note(now_secs(), text.clone()));
    st.log_line(&id, &text);
    match j {
        Some(j) => (StatusCode::ACCEPTED, Json(st.view(j))).into_response(),
        None => err(StatusCode::NOT_FOUND, format!("no job {id}")),
    }
}

#[derive(Deserialize)]
struct LogQuery {
    follow: Option<String>,
    from: Option<u64>,
}

fn truthy(v: &Option<String>) -> bool {
    matches!(v.as_deref(), Some("1" | "true" | "yes"))
}

/// Up to `cap` bytes of a file from `offset`, never past `limit` (a size read before, so a file
/// growing under the read gives a stable end). A missing file reads as empty.
async fn read_at(
    path: &std::path::Path,
    offset: u64,
    cap: u64,
    limit: u64,
) -> std::io::Result<Vec<u8>> {
    let mut f = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    f.seek(std::io::SeekFrom::Start(offset)).await?;
    let want = cap.min(limit.saturating_sub(offset));
    let mut buf = vec![0u8; usize::try_from(want).unwrap_or(usize::MAX)];
    let mut filled = 0;
    while filled < buf.len() {
        let n = f.read(&mut buf[filled..]).await?;
        if n == 0 {
            break;
        }
        filled += n;
    }
    buf.truncate(filled);
    Ok(buf)
}

async fn read_chunk(path: &std::path::Path, offset: u64) -> std::io::Result<Vec<u8>> {
    read_at(path, offset, LOG_CHUNK_BYTES as u64, u64::MAX).await
}

struct Follow {
    st: Arc<Shared>,
    id: String,
    path: PathBuf,
    offset: u64,
    follow: bool,
}

async fn log(
    State(st): State<Arc<Shared>>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<LogQuery>,
) -> Response {
    if st.job(&id).is_none() {
        return err(StatusCode::NOT_FOUND, format!("no job {id}"));
    }
    let state = Follow {
        path: st.log_path(&id),
        st,
        id,
        offset: q.from.unwrap_or(0),
        follow: truthy(&q.follow),
    };
    let stream = futures_util::stream::unfold(Some(state), |state| async move {
        let mut s = state?;
        loop {
            // Check "finished" before reading, so bytes written just before the end are not lost.
            let finished = s.st.job(&s.id).is_none_or(|j| j.state.is_terminal());
            match read_chunk(&s.path, s.offset).await {
                Ok(bytes) if !bytes.is_empty() => {
                    s.offset += bytes.len() as u64;
                    return Some((Ok::<Bytes, std::io::Error>(Bytes::from(bytes)), Some(s)));
                }
                Ok(_) if !s.follow || finished => return None,
                Ok(_) => tokio::time::sleep(LOG_FOLLOW_POLL).await,
                Err(e) => return Some((Err(e), None)),
            }
        }
    });
    Response::builder()
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "response"))
}

async fn events(State(st): State<Arc<Shared>>, UrlPath(id): UrlPath<String>) -> Response {
    if st.job(&id).is_none() {
        return err(StatusCode::NOT_FOUND, format!("no job {id}"));
    }
    let bytes = tokio::fs::read(st.log_path(&id)).await.unwrap_or_default();
    Json(json!({ "events": parse_log(&String::from_utf8_lossy(&bytes)) })).into_response()
}

// ---- Collecting a run's machine-only files (collect.rs) ----

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RunQuery {
    run: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileQuery {
    run: Option<String>,
    name: String,
    from: Option<u64>,
    check: Option<String>,
}

impl Shared {
    /// A job's run directory, relative to the repo, when the install it names still resolves.
    fn job_run_rel(&self, job: &Job) -> Option<String> {
        let (_, dir) =
            progress::resolve_run_dir(&self.cfg.repo, &self.cfg.share_dir, &job.spec).ok()?;
        dir.strip_prefix(&self.cfg.repo)
            .ok()?
            .to_str()
            .map(String::from)
    }

    /// Every job by its run directory: (job id, state label). Resolved at request time; jobs are few.
    fn jobs_by_run(&self) -> HashMap<String, (String, String)> {
        let mut jobs: Vec<Job> = self.lock().jobs.values().cloned().collect();
        // Oldest first, so the newest job for a run dir (a resumed run has several) is the one kept.
        jobs.sort_by_key(|j| (j.submitted_at, j.seq));
        let mut out = HashMap::new();
        for j in jobs {
            if let Some(rel) = self.job_run_rel(&j) {
                out.insert(rel, (j.id.clone(), j.state.label().to_string()));
            }
        }
        out
    }
}

/// Every run directory on this node, newest run-status first, with the job (if any) that wrote it.
async fn list_runs(State(st): State<Arc<Shared>>) -> Json<Vec<RunListing>> {
    let jobs = st.jobs_by_run();
    let mut out: Vec<RunListing> = collect::list_runs(&st.cfg.repo, &st.cfg.share_dir)
        .into_iter()
        .map(|run| {
            let (job, job_state) = jobs.get(&run).cloned().unzip();
            let run_status = collect::run_status(&st.cfg.repo.join(&run));
            RunListing {
                run,
                job,
                run_status,
                job_state,
            }
        })
        .collect();
    out.sort_by(|a, b| {
        let at = |r: &RunListing| r.run_status.as_ref().and_then(|s| s.at.clone());
        at(b).cmp(&at(a)).then_with(|| a.run.cmp(&b.run))
    });
    Json(out)
}

fn manifest_of(st: &Shared, run: String, job: Option<(String, String)>) -> Manifest {
    let dir = st.cfg.repo.join(&run);
    let (job, job_state) = job.unzip();
    Manifest {
        files: collect::manifest(&dir, &st.cfg.bench_home),
        run_status: collect::run_status(&dir),
        run,
        job,
        job_state,
    }
}

/// The run directory a job writes, relative to the repo; 404 for no such job, 409 when its install is gone.
fn job_run(st: &Shared, id: &str) -> Result<(String, Job), (StatusCode, String)> {
    let Some(job) = st.job(id) else {
        return Err((StatusCode::NOT_FOUND, format!("no job {id}")));
    };
    match st.job_run_rel(&job) {
        Some(rel) => Ok((rel, job)),
        None => Err((
            StatusCode::CONFLICT,
            format!("job {id}: its run directory does not resolve on this node"),
        )),
    }
}

/// A run directory named by its repo-relative path; 400 for a path that isn't one, 404 when it has no run.json.
fn named_run(st: &Shared, run: &str) -> Result<String, (StatusCode, String)> {
    if !crate::ids::valid_run_dir(run) {
        return Err((
            StatusCode::BAD_REQUEST,
            format!("not a run directory path: {run:?}"),
        ));
    }
    match collect::is_run_dir(&st.cfg.repo, run) {
        Some(_) => Ok(run.to_string()),
        None => Err((StatusCode::NOT_FOUND, format!("no run {run} on this node"))),
    }
}

async fn job_files(State(st): State<Arc<Shared>>, UrlPath(id): UrlPath<String>) -> Response {
    match job_run(&st, &id) {
        Ok((rel, job)) => {
            Json(manifest_of(&st, rel, Some((id, job.state.label().to_string())))).into_response()
        }
        Err((status, msg)) => err(status, msg),
    }
}

async fn run_files(State(st): State<Arc<Shared>>, Query(q): Query<RunQuery>) -> Response {
    match named_run(&st, &q.run) {
        Ok(rel) => {
            let job = st.jobs_by_run().remove(&rel);
            Json(manifest_of(&st, rel, job)).into_response()
        }
        Err((status, msg)) => err(status, msg),
    }
}

async fn job_file(
    State(st): State<Arc<Shared>>,
    UrlPath(id): UrlPath<String>,
    Query(q): Query<FileQuery>,
) -> Response {
    match job_run(&st, &id) {
        Ok((rel, _)) => file_of(&st, &rel, q).await,
        Err((status, msg)) => err(status, msg),
    }
}

async fn run_file(State(st): State<Arc<Shared>>, Query(q): Query<FileQuery>) -> Response {
    let Some(run) = q.run.clone() else {
        return err(StatusCode::BAD_REQUEST, "run= names the run directory");
    };
    match named_run(&st, &run) {
        Ok(rel) => file_of(&st, &rel, q).await,
        Err((status, msg)) => err(status, msg),
    }
}

fn hex64(h: u64) -> String {
    format!("{h:016x}")
}

fn conflict(reason: &str, size: u64) -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({ "error": reason, "size": size })),
    )
        .into_response()
}

/// Bytes of one allow-listed file of a run: from `from`, at most `COLLECT_CHUNK_BYTES`, never past the
/// size seen at the start. An append-only file read from past 0 needs `check`, the FNV-1a-64 of the
/// last `PREFIX_CHECK_BYTES` bytes before `from` as the client holds them: 409 when they differ or the
/// file is shorter than `from`, so the client knows to fetch the whole file again. A whole file is
/// read from 0 only, and refused (413) when it is larger than one chunk.
async fn file_of(st: &Shared, run: &str, q: FileQuery) -> Response {
    let Some(name): Option<FileName> = collect::parse_name(&q.name) else {
        return err(
            StatusCode::NOT_FOUND,
            format!("{:?} is not a file the node serves", q.name),
        );
    };
    let Some(path) = collect::resolve(&st.cfg.repo.join(run), &st.cfg.bench_home, &name) else {
        return err(
            StatusCode::NOT_FOUND,
            format!("{} is not on this node", name.name()),
        );
    };
    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) if m.is_file() => m,
        _ => {
            return err(
                StatusCode::NOT_FOUND,
                format!("{} is not on this node", name.name()),
            )
        }
    };
    let size = meta.len();
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0.0, |d| d.as_secs_f64());
    let from = q.from.unwrap_or(0);
    match name.kind() {
        FileKind::Whole => {
            if from != 0 {
                return err(
                    StatusCode::BAD_REQUEST,
                    format!("{} is served whole: from must be 0", name.name()),
                );
            }
            if size > collect::COLLECT_CHUNK_BYTES {
                return err(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    format!(
                        "{} is {size} bytes, over the {} byte limit",
                        name.name(),
                        collect::COLLECT_CHUNK_BYTES
                    ),
                );
            }
        }
        FileKind::Append => {
            if from > size {
                return conflict("file is shorter than from", size);
            }
            if from > 0 {
                let Some(check) = q.check.as_deref() else {
                    return err(
                        StatusCode::BAD_REQUEST,
                        "check= is needed when from > 0: the hash of the bytes before from",
                    );
                };
                let (start, end) = collect::check_window(from);
                let held = match read_at(&path, start, end - start, end).await {
                    Ok(b) if b.len() as u64 == end - start => b,
                    Ok(_) => return conflict("prefix mismatch", size),
                    Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
                };
                if hex64(collect::fnv1a64(&held)) != check.trim().to_ascii_lowercase() {
                    return conflict("prefix mismatch", size);
                }
            }
        }
    }
    let bytes = match read_at(&path, from, collect::COLLECT_CHUNK_BYTES, size).await {
        Ok(b) => b,
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };
    let eof = from + bytes.len() as u64 >= size;
    Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(collect::HDR_FROM, from.to_string())
        .header(collect::HDR_SIZE, size.to_string())
        .header(collect::HDR_MTIME, format!("{mtime:.3}"))
        .header(collect::HDR_EOF, if eof { "1" } else { "0" })
        .body(Body::from(bytes))
        .unwrap_or_else(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "response"))
}

fn ensure_dir(path: &std::path::Path) -> Result<()> {
    std::fs::create_dir_all(path).with_context(|| format!("create {}", path.display()))?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(DIR_MODE))?;
    Ok(())
}

pub async fn serve(cfg: ServerConfig) -> Result<()> {
    ensure_dir(&cfg.home)?;
    ensure_dir(&cfg.jobs_dir)?;
    let token = load_or_create_token(&cfg.home)?;
    let listener = tokio::net::TcpListener::bind(&cfg.bind)
        .await
        .with_context(|| format!("bind {}", cfg.bind))?;
    let addr = listener.local_addr()?;
    let (shared, adopt) = recover(cfg, token)?;
    println!("{LISTENING_PREFIX}{addr}");
    let _ = std::io::stdout().flush();
    tokio::spawn(crate::runner::run(shared.clone(), adopt));
    // No graceful drain: followed logs would hold it open forever, and the harness
    // is unaffected either way.
    tokio::select! {
        r = axum::serve(
            listener,
            router(shared).into_make_service_with_connect_info::<SocketAddr>(),
        ) => r?,
        _ = shutdown_signal() => eprintln!("dbench: stopping; any running harness keeps running and is adopted on restart"),
    }
    Ok(())
}

/// Exit on SIGTERM/SIGINT without touching the harness: it runs in its own
/// process group and is adopted by the next server.
async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let (Ok(mut term), Ok(mut int)) = (
        signal(SignalKind::terminate()),
        signal(SignalKind::interrupt()),
    ) else {
        return std::future::pending().await;
    };
    tokio::select! {
        _ = term.recv() => {},
        _ = int.recv() => {},
    }
}
