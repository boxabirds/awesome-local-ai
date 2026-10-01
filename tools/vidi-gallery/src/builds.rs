//! Running a build on demand: copy its committed workspace to a cache, install (no install scripts:
//! this is agent-written code), build, start `wrangler dev` on a private port, and put the
//! banner proxy in front of it. Stopped by the gallery, and all stopped when the gallery exits.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, LazyLock};
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
/// A running build is checked this often, and marked stopped after this many missed checks in a row.
const WATCH_EVERY: Duration = Duration::from_secs(3);
const WATCH_MISSES: u32 = 2;
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
    /// Builds whose recording still needs their prepared checkout (see `pin`).
    pinned: HashSet<String>,
    /// Builds served from a checkout in place, by slug: stripped when they stop (see `release`).
    in_place: HashMap<String, PathBuf>,
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
    /// Serve `workspace` where it is, already prepared (see `prepare`), instead of copying,
    /// installing and building it on open.
    pub in_place: bool,
}

/// Marks a workspace that `prepare` finished: dependencies installed and built.
const PREPARED_MARKER: &str = ".gallery-prepared";

pub fn is_prepared(ws: &Path) -> bool {
    ws.join(PREPARED_MARKER).is_file()
}

/// The gallery cache's parts: shared node_modules stores, checkouts, and what is being deleted.
pub const MODULES: &str = "modules";
pub const CHECKOUTS: &str = "checkouts";
const TRASH: &str = "trash";
/// How many module stores (one node_modules per package-lock.json; measured 0.33-1.0 GB each) are
/// kept, by most recent use. A store a prepared checkout was cloned from, or one a prepare is using
/// now, is never evicted; those count towards the N, so at most max(N, those) stores remain.
pub const MODULE_STORES_KEPT: usize = 6;
/// Next to each store `<key>`, a file `<key>.used` whose modification time is the store's last use.
const USED_SUFFIX: &str = ".used";
/// A store being made: `<key>.tmp`, renamed to `<key>` when complete.
const TMP_SUFFIX: &str = ".tmp";
/// What preparing adds to a checkout and stripping removes. The rest, its source and .git, stays:
/// a few MB, and the review's task list reads its history.
const PREPARED_PARTS: [&str; 3] = ["node_modules", "dist", ".wrangler"];

/// Stores a prepare is using right now (key -> how many prepares), so eviction never takes one
/// between choosing it and cloning it.
static IN_PREPARE: LazyLock<std::sync::Mutex<HashMap<String, usize>>> = LazyLock::new(Default::default);

/// Marks a store busy for as long as it lives.
struct Busy(String);
impl Busy {
    fn new(key: &str) -> Self {
        *IN_PREPARE.lock().expect("store lock").entry(key.to_string()).or_default() += 1;
        Busy(key.to_string())
    }
}
impl Drop for Busy {
    fn drop(&mut self) {
        let mut busy = IN_PREPARE.lock().expect("store lock");
        if let Some(n) = busy.get_mut(&self.0) {
            *n -= 1;
            if *n == 0 {
                busy.remove(&self.0);
            }
        }
    }
}

/// Install and build a workspace so that opening it only has to start wrangler. Starts from clean
/// (no dist/ or .wrangler/, which can hold a stale config). node_modules is shared between
/// workspaces with the same package-lock.json: installed once into `<cache>/modules/<hash>`, then
/// cloned (APFS copy-on-write, `cp -c`), so 99 builds don't need 99 copies of ~500 MB. Each use of
/// a store is recorded, and stores beyond MODULE_STORES_KEPT are evicted, least recently used first.
pub async fn prepare(ws: &Path, cache: &Path) -> anyhow::Result<()> {
    if is_prepared(ws) {
        return Ok(());
    }
    for leftover in PREPARED_PARTS {
        let _ = std::fs::remove_dir_all(ws.join(leftover));
    }
    let lock = std::fs::read(ws.join("package-lock.json")).unwrap_or_default();
    let key = format!("{:016x}", fnv1a(&lock));
    let modules = cache.join(MODULES);
    let shared = modules.join(&key);
    {
        let _busy = Busy::new(&key);
        std::fs::create_dir_all(&modules)?;
        if !shared.is_dir() {
            run("npm", &["ci", "--ignore-scripts", "--no-audit", "--no-fund"], ws).await?;
            let tmp = modules.join(format!("{key}{TMP_SUFFIX}"));
            let _ = std::fs::remove_dir_all(&tmp);
            run("cp", &["-Rc", "node_modules", &tmp.display().to_string()], ws).await?;
            let _ = std::fs::rename(&tmp, &shared); // another prepare may have won the race; either copy is fine
        } else {
            run("cp", &["-Rc", &shared.display().to_string(), "node_modules"], ws).await?;
        }
        touch_store(&modules, &key);
        run("npm", &["run", "build"], ws).await?;
        std::fs::write(ws.join(PREPARED_MARKER), &key)?;
    }
    tidy(cache.to_path_buf()).await;
    Ok(())
}

/// Record a use of the store `key`.
fn touch_store(modules: &Path, key: &str) {
    let _ = std::fs::write(modules.join(format!("{key}{USED_SUFFIX}")), b"");
}

/// Move `path` into the cache's trash (a rename: instant, and on the same volume).
fn to_trash(path: &Path, cache: &Path) {
    static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    if !path.exists() {
        return;
    }
    let trash = cache.join(TRASH);
    let _ = std::fs::create_dir_all(&trash);
    let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let name = path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    if std::fs::rename(path, trash.join(format!("{}-{n}-{name}", std::process::id()))).is_err() {
        let _ = std::fs::remove_dir_all(path);
    }
}

/// Take a checkout back to its source: drop what `prepare` added (node_modules, the build output,
/// wrangler's state) into the trash, and the marker first, so it never looks prepared without them.
/// Fast (renames only); `empty_trash` does the slow part.
pub fn strip(ws: &Path, cache: &Path) {
    let _ = std::fs::remove_file(ws.join(PREPARED_MARKER));
    for part in PREPARED_PARTS {
        to_trash(&ws.join(part), cache);
    }
}

/// The store keys that prepared checkouts were cloned from (their markers name them).
fn stores_in_use(checkouts: &Path) -> HashSet<String> {
    let Ok(dirs) = std::fs::read_dir(checkouts) else { return HashSet::new() };
    dirs.flatten()
        .filter_map(|d| std::fs::read_to_string(d.path().join(PREPARED_MARKER)).ok())
        .map(|k| k.trim().to_string())
        .collect()
}

/// Evict module stores beyond `keep`, least recently used first, never one a prepared checkout or a
/// prepare in progress uses (evicting a store a checkout was cloned from would free nothing while
/// that checkout exists anyway: they share their blocks). Returns the evicted keys.
pub fn evict_modules(cache: &Path, keep: usize) -> Vec<String> {
    let modules = cache.join(MODULES);
    let Ok(dirs) = std::fs::read_dir(&modules) else { return Vec::new() };
    let last_use = |key: &str| {
        std::fs::metadata(modules.join(format!("{key}{USED_SUFFIX}")))
            .or_else(|_| std::fs::metadata(modules.join(key)))
            .and_then(|m| m.modified())
            .unwrap_or(std::time::UNIX_EPOCH)
    };
    let mut stores: Vec<(std::time::SystemTime, String)> = dirs
        .flatten()
        .filter(|d| d.path().is_dir())
        .map(|d| d.file_name().to_string_lossy().into_owned())
        .filter(|k| !k.ends_with(TMP_SUFFIX))
        .map(|k| (last_use(&k), k))
        .collect();
    stores.sort(); // least recently used first
    let mut protected = stores_in_use(&cache.join(CHECKOUTS));
    protected.extend(IN_PREPARE.lock().expect("store lock").keys().cloned());
    let held = stores.iter().filter(|(_, k)| protected.contains(k)).count();
    let free = stores.len() - held; // unprotected stores; the most recent of them fill the rest of `keep`
    let to_evict = free.saturating_sub(keep.saturating_sub(held));
    let evicted: Vec<String> =
        stores.into_iter().map(|(_, k)| k).filter(|k| !protected.contains(k)).take(to_evict).collect();
    for key in &evicted {
        to_trash(&modules.join(key), cache);
        let _ = std::fs::remove_file(modules.join(format!("{key}{USED_SUFFIX}")));
    }
    empty_trash(cache);
    evicted
}

/// Delete what was moved to the trash.
pub fn empty_trash(cache: &Path) {
    let Ok(entries) = std::fs::read_dir(cache.join(TRASH)) else { return };
    for e in entries.flatten() {
        let _ = std::fs::remove_dir_all(e.path()).or_else(|_| std::fs::remove_file(e.path()));
    }
}

/// Empty the trash and evict stores beyond MODULE_STORES_KEPT, off the async threads.
pub async fn tidy(cache: PathBuf) {
    let _ = tokio::task::spawn_blocking(move || {
        empty_trash(&cache);
        evict_modules(&cache, MODULE_STORES_KEPT);
    })
    .await;
}

/// A stable 64-bit hash (FNV-1a) of the lockfile, to name its shared node_modules.
pub(crate) fn fnv1a(bytes: &[u8]) -> u64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;
    bytes.iter().fold(OFFSET, |h, b| (h ^ u64::from(*b)).wrapping_mul(PRIME))
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
        if spec.in_place {
            inner.in_place.insert(spec.slug.clone(), spec.workspace.clone());
        }
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

    /// Keep a build's checkout prepared until `release`, even if it is served and stopped meanwhile:
    /// its recording still needs it.
    pub async fn pin(&self, slug: &str) {
        self.inner.lock().await.pinned.insert(slug.to_string());
    }

    /// A build's recording is finished: strip its checkout now, or, while it is being served, when
    /// it stops.
    pub async fn release(&self, slug: &str, ws: &Path) {
        {
            let mut inner = self.inner.lock().await;
            inner.pinned.remove(slug);
            if serving(&inner, slug) {
                return; // `stop` strips it
            }
            strip(ws, &self.cache); // under the lock, so an open can't start preparing it meanwhile
        }
        tidy(self.cache.clone()).await;
    }

    async fn step(&self, slug: &str, step: &str) {
        self.inner.lock().await.states.insert(slug.into(), State::Preparing { step: step.into() });
    }

    async fn start(&self, spec: Spec, slot: u16) -> anyhow::Result<()> {
        let dir = self.cache.join(&spec.slug);
        std::fs::create_dir_all(&dir)?;
        let log = dir.join("wrangler.log");
        let ws = if spec.in_place {
            if !is_prepared(&spec.workspace) {
                self.step(&spec.slug, "installing and building").await;
                prepare(&spec.workspace, &self.cache).await?;
            }
            spec.workspace.clone()
        } else {
            let ws = dir.join("ws");
            std::fs::create_dir_all(&ws)?;
            self.copy_install_build(&spec.slug, &spec.workspace, &ws, &dir).await?;
            ws
        };
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
        inner.states.insert(spec.slug.clone(), State::Running { url: format!("http://127.0.0.1:{proxy_port}/") });
        drop(inner);
        drop(child); // its process group is tracked by pgid; the watch below notices if it dies
        let me = self.clone();
        tokio::spawn(async move { me.watch(spec.slug, pgid, upstream, log).await });
        Ok(())
    }

    /// Mark a running build stopped as soon as its server stops answering, whatever killed it, so
    /// the page never shows "running" for a dead build. Open restarts it.
    async fn watch(&self, slug: String, pgid: i32, upstream: SocketAddr, log: PathBuf) {
        let mut misses = 0;
        loop {
            tokio::time::sleep(WATCH_EVERY).await;
            let still_ours = self.inner.lock().await.live.get(&slug).is_some_and(|l| l.pgid == pgid);
            if !still_ours {
                return; // stopped by the gallery, or restarted
            }
            misses = if status_of(upstream).await.is_ok() { 0 } else { misses + 1 };
            if misses < WATCH_MISSES {
                continue;
            }
            let text = std::fs::read_to_string(&log).unwrap_or_default();
            let tail = text[text.len().saturating_sub(LOG_TAIL_BYTES)..].trim().to_string();
            self.stop(&slug).await;
            let why = if tail.is_empty() { "no error in its log, so something outside the gallery probably killed it".to_string() } else { tail };
            self.inner.lock().await.states.insert(
                slug.clone(),
                State::Failed { error: format!("the build's server stopped ({why}). Open restarts it.") },
            );
            return;
        }
    }

    /// The gallery's final-build view: copy the record's workspace, then install and build it.
    async fn copy_install_build(&self, slug: &str, src: &Path, ws: &Path, dir: &Path) -> anyhow::Result<()> {
        run(
            "rsync",
            &["-a", "--delete", "--exclude", "node_modules", "--exclude", "dist", "--exclude", ".wrangler",
              &format!("{}/", src.display()), &format!("{}/", ws.display())],
            &dir,
        )
        .await?;
        // Build from clean, like the held-out suite: a `.wrangler/` or `dist/` left by an earlier start
        // can redirect wrangler to a stale config ("assets-only Worker" errors on a build that works).
        for leftover in [".wrangler", "dist"] {
            let _ = std::fs::remove_dir_all(ws.join(leftover));
        }
        self.step(slug, "installing dependencies (no install scripts)").await;
        run("npm", &["ci", "--ignore-scripts", "--no-audit", "--no-fund"], &ws).await?;
        self.step(slug, "building").await;
        run("npm", &["run", "build"], &ws).await?;
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
        // A checkout served in place goes back to its source once nothing needs it prepared: its
        // recording is done (not pinned) and it hasn't been opened again meanwhile.
        let stripped = {
            let inner = self.inner.lock().await;
            match inner.in_place.get(slug) {
                Some(ws) if !inner.pinned.contains(slug) && !serving(&inner, slug) => {
                    strip(ws, &self.cache);
                    true
                }
                _ => false,
            }
        };
        if stripped {
            tidy(self.cache.clone()).await;
        }
    }

    pub async fn stop_all(&self) {
        let slugs: Vec<String> = self.inner.lock().await.live.keys().cloned().collect();
        for s in slugs {
            self.stop(&s).await;
        }
    }
}

/// Whether a build is being prepared or served right now.
fn serving(inner: &Inner, slug: &str) -> bool {
    matches!(inner.states.get(slug), Some(State::Preparing { .. } | State::Running { .. }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, SystemTime};

    const SLUG: &str = "setup__run-1@04";
    /// Source files a stripped checkout keeps.
    const SOURCE: [&str; 2] = [".git/HEAD", "src/main.ts"];

    fn tmp(tag: &str) -> PathBuf {
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("vidi-gallery-builds-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn put(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    /// A checkout as `prepare` leaves it: source, .git, node_modules cloned from store `key`, a build
    /// and wrangler state, and the marker naming the store.
    fn prepared_checkout(cache: &Path, slug: &str, key: &str) -> PathBuf {
        let ws = cache.join(CHECKOUTS).join(slug);
        for f in SOURCE {
            put(&ws.join(f));
        }
        for part in PREPARED_PARTS {
            put(&ws.join(part).join("file"));
        }
        std::fs::write(ws.join(PREPARED_MARKER), key).unwrap();
        ws
    }

    fn assert_stripped(ws: &Path) {
        assert!(!is_prepared(ws), "the marker must go with node_modules");
        for part in PREPARED_PARTS {
            assert!(!ws.join(part).exists(), "{part} should be gone from {}", ws.display());
        }
        for f in SOURCE {
            assert!(ws.join(f).is_file(), "{f} should stay");
        }
    }

    fn assert_prepared(ws: &Path) {
        assert!(is_prepared(ws));
        for part in PREPARED_PARTS {
            assert!(ws.join(part).join("file").is_file(), "{part} should still be there");
        }
    }

    async fn serve_in_place(b: &Builds, slug: &str, ws: &Path) {
        let mut inner = b.inner.lock().await;
        inner.states.insert(slug.into(), State::Running { url: "http://127.0.0.1:1/".into() });
        inner.in_place.insert(slug.into(), ws.to_path_buf());
    }

    #[tokio::test]
    async fn a_released_checkout_loses_node_modules_and_its_build_but_keeps_its_source() {
        let cache = tmp("release");
        let ws = prepared_checkout(&cache, SLUG, "k1");
        let b = Builds::new(cache.clone());
        b.pin(SLUG).await;
        b.release(SLUG, &ws).await;
        assert_stripped(&ws);
        assert!(!cache.join(TRASH).exists() || std::fs::read_dir(cache.join(TRASH)).unwrap().next().is_none(), "the trash is emptied");
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[tokio::test]
    async fn a_checkout_being_served_is_stripped_only_when_it_stops() {
        let cache = tmp("served");
        let ws = prepared_checkout(&cache, SLUG, "k1");
        let b = Builds::new(cache.clone());
        serve_in_place(&b, SLUG, &ws).await;
        b.release(SLUG, &ws).await;
        assert_prepared(&ws);
        b.stop(SLUG).await;
        assert_stripped(&ws);
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[tokio::test]
    async fn a_checkout_still_to_be_recorded_keeps_node_modules_when_its_server_stops() {
        let cache = tmp("pinned");
        let ws = prepared_checkout(&cache, SLUG, "k1");
        let b = Builds::new(cache.clone());
        b.pin(SLUG).await;
        serve_in_place(&b, SLUG, &ws).await;
        b.stop(SLUG).await;
        assert_prepared(&ws);
        b.release(SLUG, &ws).await;
        assert_stripped(&ws);
        let _ = std::fs::remove_dir_all(&cache);
    }

    /// n stores, least recently used first, named after the test's cache (busy stores are process-wide).
    fn stores(cache: &Path, n: usize) -> Vec<String> {
        let modules = cache.join(MODULES);
        let tag = cache.file_name().unwrap().to_string_lossy().into_owned();
        let base = SystemTime::now() - Duration::from_secs(3600);
        (0..n)
            .map(|i| {
                let key = format!("{tag}-s{i}");
                put(&modules.join(&key).join("pkg/index.js"));
                let used = std::fs::File::create(modules.join(format!("{key}{USED_SUFFIX}"))).unwrap();
                used.set_modified(base + Duration::from_secs(i as u64)).unwrap();
                key
            })
            .collect()
    }

    fn present(cache: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(cache.join(MODULES))
            .unwrap()
            .flatten()
            .filter(|e| e.path().is_dir())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        v.sort();
        v
    }

    #[test]
    fn with_one_store_too_many_the_least_recently_used_is_evicted() {
        let cache = tmp("evict");
        let keys = stores(&cache, MODULE_STORES_KEPT + 1);
        assert_eq!(evict_modules(&cache, MODULE_STORES_KEPT), vec![keys[0].clone()]);
        let mut left = keys[1..].to_vec();
        left.sort();
        assert_eq!(present(&cache), left);
        assert!(!cache.join(MODULES).join(format!("{}{USED_SUFFIX}", keys[0])).exists(), "its use marker goes too");
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[test]
    fn using_a_store_makes_it_the_most_recent() {
        let cache = tmp("touch");
        let keys = stores(&cache, MODULE_STORES_KEPT + 1);
        touch_store(&cache.join(MODULES), &keys[0]);
        assert_eq!(evict_modules(&cache, MODULE_STORES_KEPT), vec![keys[1].clone()]);
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[test]
    fn a_store_a_prepared_checkout_was_cloned_from_is_never_evicted() {
        let cache = tmp("protect");
        let keys = stores(&cache, MODULE_STORES_KEPT + 2);
        let ws = prepared_checkout(&cache, SLUG, &keys[0]);
        // The protected store takes one of the N places: two others go.
        assert_eq!(evict_modules(&cache, MODULE_STORES_KEPT), vec![keys[1].clone(), keys[2].clone()]);
        assert!(present(&cache).contains(&keys[0]));
        // Once the checkout is stripped, it is the least recently used: the next store in evicts it.
        strip(&ws, &cache);
        assert!(evict_modules(&cache, MODULE_STORES_KEPT).is_empty(), "exactly N stores are within the limit");
        let newest = format!("{}-new", keys[0]);
        put(&cache.join(MODULES).join(&newest).join("pkg/index.js"));
        touch_store(&cache.join(MODULES), &newest);
        assert_eq!(evict_modules(&cache, MODULE_STORES_KEPT), vec![keys[0].clone()]);
        let _ = std::fs::remove_dir_all(&cache);
    }

    #[test]
    fn a_store_a_prepare_is_using_is_never_evicted() {
        let cache = tmp("busy");
        let keys = stores(&cache, MODULE_STORES_KEPT + 1);
        let busy = Busy::new(&keys[0]);
        assert_eq!(evict_modules(&cache, MODULE_STORES_KEPT), vec![keys[1].clone()]);
        drop(busy);
        let _ = std::fs::remove_dir_all(&cache);
    }
}
