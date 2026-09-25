//! Running a build on demand: copy its committed workspace to a cache, install (no install scripts:
//! this is agent-written code), build, start `wrangler dev` on a private port, and put the
//! banner proxy in front of it. Stopped by the gallery, and all stopped when the gallery exits.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::proxy::{self, Banner};

/// Port layout, clear of the benchmark's own ports (8787, 18010, 18787-8, 19787):
/// build n (0-based) gets proxy PROXY_BASE+n, wrangler UPSTREAM_BASE+n, inspector INSPECTOR_BASE+n.
pub const PROXY_BASE: u16 = 7801;
pub const UPSTREAM_BASE: u16 = 7851;
pub const INSPECTOR_BASE: u16 = 7901;
/// At most this many builds at once (each wrangler takes a few hundred MB).
pub const MAX_BUILDS: u16 = 40;
const READY_TIMEOUT: Duration = Duration::from_secs(180);
const READY_POLL: Duration = Duration::from_millis(500);
const STOP_GRACE: Duration = Duration::from_secs(3);
const LOG_TAIL_BYTES: usize = 1500;
const HTTP_SERVER_ERROR: u16 = 500;
const LOCALHOST: [u8; 4] = [127, 0, 0, 1];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "state", rename_all = "lowercase")]
pub enum State {
    Preparing { step: String },
    Running { url: String },
    Failed { error: String },
}

struct Live {
    pgid: i32,
    proxy: JoinHandle<()>,
    slot: u16,
}

#[derive(Default)]
struct Inner {
    states: HashMap<String, State>,
    live: HashMap<String, Live>,
    slots: HashMap<u16, String>,
}

#[derive(Clone)]
pub struct Builds {
    cache: PathBuf,
    inner: Arc<Mutex<Inner>>,
}

pub struct Spec {
    pub slug: String,
    pub workspace: PathBuf,
    pub banner: Banner,
}

impl Builds {
    pub fn new(cache: PathBuf) -> Self {
        Self { cache, inner: Arc::new(Mutex::new(Inner::default())) }
    }

    pub async fn states(&self) -> HashMap<String, State> {
        self.inner.lock().await.states.clone()
    }

    /// Start a build if it isn't running or starting; returns its state now.
    pub async fn open(&self, spec: Spec) -> State {
        let mut inner = self.inner.lock().await;
        if let Some(s @ (State::Running { .. } | State::Preparing { .. })) = inner.states.get(&spec.slug) {
            return s.clone();
        }
        let Some(slot) = (0..MAX_BUILDS).find(|n| !inner.slots.contains_key(n)) else {
            let s = State::Failed { error: format!("{MAX_BUILDS} builds are already running; stop some first") };
            inner.states.insert(spec.slug.clone(), s.clone());
            return s;
        };
        inner.slots.insert(slot, spec.slug.clone());
        let s = State::Preparing { step: "copying the workspace".into() };
        inner.states.insert(spec.slug.clone(), s.clone());
        drop(inner);
        let me = self.clone();
        tokio::spawn(async move {
            let slug = spec.slug.clone();
            if let Err(e) = me.start(spec, slot).await {
                let mut inner = me.inner.lock().await;
                inner.states.insert(slug.clone(), State::Failed { error: format!("{e:#}") });
                if !inner.live.contains_key(&slug) {
                    inner.slots.remove(&slot);
                }
            }
        });
        s
    }

    async fn step(&self, slug: &str, step: &str) {
        self.inner.lock().await.states.insert(slug.into(), State::Preparing { step: step.into() });
    }

    async fn start(&self, spec: Spec, slot: u16) -> anyhow::Result<()> {
        let dir = self.cache.join(&spec.slug);
        let ws = dir.join("ws");
        std::fs::create_dir_all(&ws)?;
        let log = dir.join("wrangler.log");
        run(
            "rsync",
            &["-a", "--delete", "--exclude", "node_modules", "--exclude", "dist", "--exclude", ".wrangler",
              &format!("{}/", spec.workspace.display()), &format!("{}/", ws.display())],
            &dir,
        )
        .await?;
        self.step(&spec.slug, "installing dependencies (no install scripts)").await;
        run("npm", &["ci", "--ignore-scripts", "--no-audit", "--no-fund"], &ws).await?;
        self.step(&spec.slug, "building").await;
        run("npm", &["run", "build"], &ws).await?;
        self.step(&spec.slug, "starting wrangler dev").await;

        let upstream_port = UPSTREAM_BASE + slot;
        let log_file = std::fs::File::create(&log)?;
        let child = tokio::process::Command::new("npx")
            .args(["wrangler", "dev", "--ip", "127.0.0.1", "--port", &upstream_port.to_string(),
                   "--inspector-port", &(INSPECTOR_BASE + slot).to_string(),
                   "--persist-to", &dir.join("state").display().to_string(),
                   "--log-level", "warn", "--show-interactive-dev-session=false"])
            .current_dir(&ws)
            .env("CI", "1")
            .env("WRANGLER_SEND_METRICS", "false")
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file.try_clone()?))
            .stderr(Stdio::from(log_file))
            .process_group(0)
            .kill_on_drop(false)
            .spawn()?;
        let pgid = child.id().map(|p| p as i32).unwrap_or(0);
        let upstream = SocketAddr::from((LOCALHOST, upstream_port));
        if let Err(e) = wait_ready(upstream, &log).await {
            kill_group(pgid).await;
            return Err(e);
        }

        let proxy_port = PROXY_BASE + slot;
        let listener = TcpListener::bind(SocketAddr::from((LOCALHOST, proxy_port))).await?;
        let proxy = tokio::spawn(proxy::serve(listener, upstream, spec.banner));
        let mut inner = self.inner.lock().await;
        inner.live.insert(spec.slug.clone(), Live { pgid, proxy, slot });
        inner.states.insert(spec.slug, State::Running { url: format!("http://127.0.0.1:{proxy_port}/") });
        Ok(())
    }

    pub async fn stop(&self, slug: &str) {
        let live = {
            let mut inner = self.inner.lock().await;
            inner.states.remove(slug);
            let live = inner.live.remove(slug);
            if let Some(l) = &live {
                inner.slots.remove(&l.slot);
            }
            live
        };
        if let Some(l) = live {
            l.proxy.abort();
            kill_group(l.pgid).await;
        }
    }

    pub async fn stop_all(&self) {
        let slugs: Vec<String> = self.inner.lock().await.live.keys().cloned().collect();
        for s in slugs {
            self.stop(&s).await;
        }
    }
}

async fn run(cmd: &str, args: &[&str], cwd: &Path) -> anyhow::Result<()> {
    let out = tokio::process::Command::new(cmd).args(args).current_dir(cwd).stdin(Stdio::null()).output().await?;
    if !out.status.success() {
        let text = String::from_utf8_lossy(&[out.stdout, out.stderr].concat()).to_string();
        let tail = &text[text.len().saturating_sub(LOG_TAIL_BYTES)..];
        anyhow::bail!("{cmd} {} failed: {tail}", args.join(" "));
    }
    Ok(())
}

async fn wait_ready(upstream: SocketAddr, log: &Path) -> anyhow::Result<()> {
    let started = Instant::now();
    while started.elapsed() < READY_TIMEOUT {
        if let Ok(code) = status_of(upstream).await {
            if code < HTTP_SERVER_ERROR {
                return Ok(());
            }
        }
        tokio::time::sleep(READY_POLL).await;
    }
    let text = std::fs::read_to_string(log).unwrap_or_default();
    anyhow::bail!("wrangler dev didn't answer within {}s: {}", READY_TIMEOUT.as_secs(), &text[text.len().saturating_sub(LOG_TAIL_BYTES)..])
}

/// Status code of GET / (a bare HTTP/1.0 request; enough to know the server is up).
async fn status_of(addr: SocketAddr) -> anyhow::Result<u16> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut s = tokio::net::TcpStream::connect(addr).await?;
    s.write_all(b"GET / HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").await?;
    let mut head = [0u8; 16];
    let n = s.read(&mut head).await?;
    let line = String::from_utf8_lossy(&head[..n]);
    Ok(line.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0))
}

async fn kill_group(pgid: i32) {
    if pgid <= 0 {
        return;
    }
    // SAFETY: plain libc calls on a process group this program started.
    unsafe { libc::killpg(pgid, libc::SIGTERM) };
    tokio::time::sleep(STOP_GRACE).await;
    unsafe { libc::killpg(pgid, libc::SIGKILL) };
}
