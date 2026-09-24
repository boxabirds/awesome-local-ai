//! The HTTP API and the shared job table.

use anyhow::{Context, Result};
use axum::body::{Body, Bytes};
use axum::extract::{Path as UrlPath, Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::io::Write;
use std::os::unix::fs::OpenOptionsExt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Notify;

use crate::cli::ServerConfig;
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
    jobs.sort_by(|a, b| (a.submitted_at, &a.id).cmp(&(b.submitted_at, &b.id)));

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
    let shared = Arc::new(Shared {
        cfg,
        token,
        boot_time,
        inner: Mutex::new(Inner {
            jobs: table,
            queue,
            current: None,
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
        .route("/v1/jobs", get(list_jobs))
        .route("/v1/jobs/{id}", get(get_job).put(submit))
        .route("/v1/jobs/{id}/cancel", post(cancel))
        .route("/v1/jobs/{id}/log", get(log))
        .route("/v1/jobs/{id}/events", get(events))
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
    Json(
        crate::node::gather(
            &st.cfg.repo,
            &st.cfg.share_dir,
            &st.cfg.child_path(),
            current,
        )
        .await,
    )
}

async fn list_jobs(State(st): State<Arc<Shared>>) -> Json<Vec<JobView>> {
    let mut jobs: Vec<Job> = st.lock().jobs.values().cloned().collect();
    jobs.sort_by(|a, b| (b.submitted_at, &b.id).cmp(&(a.submitted_at, &a.id)));
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
    UrlPath(id): UrlPath<String>,
    Json(spec): Json<JobSpec>,
) -> Response {
    if !valid_id(&id) {
        return err(StatusCode::BAD_REQUEST, format!("invalid job id {id:?}"));
    }
    if let Err(e) = spec.validate() {
        return err(StatusCode::BAD_REQUEST, e);
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
        let job = Job::new(id.clone(), spec, now_secs());
        st.persist(&job);
        inner.jobs.insert(id.clone(), job.clone());
        inner.queue.push_back(id.clone());
        job
    };
    st.log_line(&id, "submitted");
    st.wake.notify_one();
    (StatusCode::CREATED, Json(st.view(job))).into_response()
}

async fn cancel(State(st): State<Arc<Shared>>, UrlPath(id): UrlPath<String>) -> Response {
    let Some(job) = st.job(&id) else {
        return err(StatusCode::NOT_FOUND, format!("no job {id}"));
    };
    match job.state {
        JobState::Queued => {
            let j = st.update(&id, |j, inner| {
                j.state = JobState::Cancelled;
                j.note(now_secs(), "cancelled while queued");
                inner.queue.retain(|q| q != &id);
            });
            st.log_line(&id, "cancelled while queued");
            (StatusCode::OK, Json(st.view(j.expect("job")))).into_response()
        }
        JobState::Running { pgid, .. } => {
            let j = st.update(&id, |j, _| {
                if !j.cancel_requested {
                    j.note(now_secs(), "cancel requested");
                }
                j.cancel_requested = true;
            });
            st.log_line(&id, &format!("cancel: SIGTERM to process group {pgid}"));
            tokio::spawn(crate::runner::terminate_group(pgid, st.cfg.cancel_grace));
            (StatusCode::ACCEPTED, Json(st.view(j.expect("job")))).into_response()
        }
        JobState::Cancelled => (StatusCode::OK, Json(st.view(job))).into_response(),
        JobState::Done { .. } | JobState::Failed { .. } => err(
            StatusCode::CONFLICT,
            format!("job {id} already finished ({})", job.state.label()),
        ),
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

async fn read_chunk(path: &std::path::Path, offset: u64) -> std::io::Result<Vec<u8>> {
    let mut f = match tokio::fs::File::open(path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    f.seek(std::io::SeekFrom::Start(offset)).await?;
    let mut buf = vec![0u8; LOG_CHUNK_BYTES];
    let n = f.read(&mut buf).await?;
    buf.truncate(n);
    Ok(buf)
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
        r = axum::serve(listener, router(shared)) => r?,
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
