//! power-collector: record this machine's power every few seconds, to link energy to benchmark
//! activity. See README.md.

mod csvlog;
mod plugs;
mod sources;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::{Parser, Subcommand};
use futures::StreamExt;

use plugs::{normalize_mac, Lan, Plug, PlugConn, Plugs};
use sources::Values;

const INTERVAL: Duration = Duration::from_secs(2);
const ERROR_LOG_EVERY: Duration = Duration::from_secs(60);
/// The limited broadcast reaches every plug on the local network, whatever its subnet.
const DISCOVERY_TARGET: &str = "255.255.255.255";
const DISCOVERY_TIMEOUT_S: u64 = 3;
const MILLIWATTS_PER_WATT: f64 = 1000.0;

#[derive(Parser)]
#[command(about = "Record this machine's power (wall plugs by MAC, macOS telemetry, NVIDIA GPUs)")]
struct Cli {
    #[command(subcommand)]
    mode: Mode,
    /// default: ~/.config/awesome-local-ai/power.json
    #[arg(long, global = true)]
    config: Option<PathBuf>,
    /// TPLINK_EMAIL / TPLINK_PASSWORD; default ~/.config/awesome-local-ai/tapo.env
    #[arg(long, global = true)]
    env_file: Option<PathBuf>,
    /// default: ~/.local/share/awesome-local-ai/power
    #[arg(long, global = true)]
    out: Option<PathBuf>,
    #[arg(long, global = true, default_value_t = INTERVAL.as_secs_f64())]
    interval: f64,
}

#[derive(Subcommand)]
enum Mode {
    /// One reading from every configured source; exits 1 if any gave none.
    Once,
    /// Keep sampling into CSVs.
    Run,
}

#[derive(serde::Deserialize, Default)]
struct Config {
    #[serde(default)]
    tapo: Vec<Plug>,
    #[serde(default)]
    macos: bool,
    #[serde(default)]
    nvidia: bool,
}

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

fn now() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or_default()
}

fn load_env(path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .map(|(k, v)| (k.trim().to_string(), v.trim().trim_matches(|c| c == '"' || c == '\'').to_string()))
        .collect()
}

// ---------- real Tapo plugs ----------

struct TapoLan {
    client: tapo::ApiClient,
}

struct TapoConn(tapo::PlugEnergyMonitoringHandler);

impl PlugConn for TapoConn {
    async fn mac(&mut self) -> anyhow::Result<String> {
        Ok(self.0.get_device_info().await?.mac)
    }
    async fn watts(&mut self) -> anyhow::Result<f64> {
        let mw = self.0.get_energy_usage().await?.current_power.context("no current_power in the reading")?;
        Ok(mw as f64 / MILLIWATTS_PER_WATT)
    }
}

impl Lan for TapoLan {
    type Conn = TapoConn;
    async fn connect(&self, ip: &str) -> anyhow::Result<TapoConn> {
        Ok(TapoConn(self.client.clone().p110(ip).await?))
    }
    async fn discover(&self) -> anyhow::Result<HashMap<String, String>> {
        let mut found = HashMap::new();
        let mut stream = self.client.clone().discover_devices(DISCOVERY_TARGET, DISCOVERY_TIMEOUT_S).await?;
        while let Some(result) = stream.next().await {
            // A device that won't talk to us isn't one of ours.
            if let Ok(tapo::DiscoveryResult::PlugEnergyMonitoring { device_info, .. }) = result {
                found.insert(normalize_mac(&device_info.mac), device_info.ip.clone());
            }
        }
        Ok(found)
    }
}

/// Why plugs gave no reading, at most once per ERROR_LOG_EVERY.
fn eprintln_limited(why: HashMap<String, String>) {
    static LAST: std::sync::Mutex<Option<Instant>> = std::sync::Mutex::new(None);
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if !why.is_empty() && last.is_none_or(|at| at.elapsed() >= ERROR_LOG_EVERY) {
        eprintln!("tapo: no reading: {why:?}");
        *last = Some(Instant::now());
    }
}

// ---------- sources ----------

enum Source {
    Tapo(Plugs<TapoLan>),
    MacOS,
    Nvidia,
}

impl Source {
    fn name(&self) -> &'static str {
        match self {
            Source::Tapo(_) => "tapo",
            Source::MacOS => "macos",
            Source::Nvidia => "nvidia",
        }
    }

    async fn read(&self) -> anyhow::Result<Values> {
        match self {
            Source::Tapo(p) => {
                // Plugs that gave no reading are logged with the reason; the others are still written.
                let values = p.read().await;
                if values.iter().any(|(_, v)| v.is_none()) {
                    eprintln_limited(p.errors().await);
                }
                Ok(values)
            }
            Source::MacOS => sources::read_macos().await,
            Source::Nvidia => sources::read_nvidia().await,
        }
    }
}

fn which(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(cmd).is_file()))
        .unwrap_or(false)
}

fn build_sources(config: Config, env_file: &Path) -> anyhow::Result<Vec<Source>> {
    let mut out = Vec::new();
    if !config.tapo.is_empty() {
        let env = load_env(env_file);
        let get = |k: &str| std::env::var(k).ok().or_else(|| env.get(k).cloned());
        let (Some(email), Some(password)) = (get("TPLINK_EMAIL"), get("TPLINK_PASSWORD")) else {
            anyhow::bail!("tapo: TPLINK_EMAIL / TPLINK_PASSWORD not set (environment or {})", env_file.display());
        };
        let lan = TapoLan { client: tapo::ApiClient::new(email, password) };
        out.push(Source::Tapo(Plugs::new(config.tapo, lan, Box::new(now))));
    }
    if config.macos && cfg!(target_os = "macos") {
        out.push(Source::MacOS);
    }
    if config.nvidia && which("nvidia-smi") {
        out.push(Source::Nvidia);
    }
    anyhow::ensure!(!out.is_empty(), "no configured source is available on this machine");
    Ok(out)
}

fn show(values: &Values) -> String {
    values.iter().map(|(k, v)| format!("{k}={}", v.map(|x| x.to_string()).unwrap_or("-".into()))).collect::<Vec<_>>().join(" ")
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let base = home();
    let config_path = cli.config.unwrap_or_else(|| base.join(".config/awesome-local-ai/power.json"));
    let env_file = cli.env_file.unwrap_or_else(|| base.join(".config/awesome-local-ai/tapo.env"));
    let out = cli.out.unwrap_or_else(|| base.join(".local/share/awesome-local-ai/power"));
    let config: Config = serde_json::from_str(
        &std::fs::read_to_string(&config_path).with_context(|| format!("no config at {}", config_path.display()))?,
    )
    .with_context(|| format!("{} is not a valid config", config_path.display()))?;
    let sources = build_sources(config, &env_file)?;

    match cli.mode {
        Mode::Once => {
            let results = futures::future::join_all(sources.iter().map(|s| s.read())).await;
            let mut failed = false;
            for (s, r) in sources.iter().zip(results) {
                match r {
                    Ok(v) => {
                        failed |= v.is_empty() || v.iter().any(|(_, x)| x.is_none());
                        println!("  {}: {}", s.name(), show(&v));
                    }
                    Err(e) => {
                        failed = true;
                        println!("  {}: {e}", s.name());
                    }
                }
            }
            std::process::exit(i32::from(failed));
        }
        Mode::Run => {
            std::fs::create_dir_all(&out)?;
            let interval = Duration::from_secs_f64(cli.interval);
            let mut log = csvlog::CsvLog::default();
            let mut last_error: HashMap<&str, Instant> = HashMap::new();
            loop {
                let started = Instant::now();
                let t = now();
                let results = futures::future::join_all(sources.iter().map(|s| s.read())).await;
                for (s, r) in sources.iter().zip(results) {
                    match r {
                        Ok(v) if v.iter().any(|(_, x)| x.is_some()) => {
                            if let Err(e) = log.write(&out, s.name(), t, &v) {
                                eprintln!("{}: can't write: {e}", s.name());
                            }
                        }
                        Ok(_) => {}
                        Err(e) => {
                            if last_error.get(s.name()).is_none_or(|at| at.elapsed() >= ERROR_LOG_EVERY) {
                                eprintln!("{}: {e}", s.name());
                                last_error.insert(s.name(), Instant::now());
                            }
                        }
                    }
                }
                tokio::time::sleep(interval.saturating_sub(started.elapsed())).await;
            }
        }
    }
}
