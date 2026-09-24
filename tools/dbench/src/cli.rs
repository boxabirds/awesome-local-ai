//! Command-line definitions shared by `main` and `service-unit`.

use anyhow::{Context, Result};
use clap::{Args, Parser, Subcommand, ValueEnum};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::job::AgentClient;

pub const DEFAULT_MAX_RESTARTS: u32 = 3;
/// Wait between a failed harness exit and its restart.
pub const DEFAULT_RESTART_BACKOFF_MS: u64 = 30_000;
/// Time between SIGTERM and SIGKILL when cancelling.
pub const DEFAULT_CANCEL_GRACE_MS: u64 = 20_000;
/// How often a running harness's process tree is sampled (see `runner::track_tree`).
pub const DEFAULT_TREE_POLL_MS: u64 = 3_000;
pub const DEFAULT_HOME_DIR: &str = ".dbench";
pub const DEFAULT_SHARE_DIR: &str = ".local/share";

#[derive(Parser, Debug)]
#[command(
    name = "dbench",
    version = crate::VERSION,
    about = "Run and watch benchmark harness jobs on remote machines"
)]
pub struct Cli {
    /// Node list (default ~/.config/dbench/nodes.toml).
    #[arg(long, global = true)]
    pub config: Option<PathBuf>,
    /// Machine-readable output.
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Run the node server.
    Serve(ServeArgs),
    /// Print a systemd user unit or launchd plist that runs `dbench serve` with these arguments.
    ServiceUnit {
        #[arg(long, value_enum)]
        kind: UnitKind,
        #[command(flatten)]
        serve: ServeArgs,
    },
    /// Every configured node: capabilities and current job (queried in parallel).
    Nodes,
    /// Submit a job (idempotent for the same id and spec).
    Submit {
        node: String,
        #[arg(long)]
        id: String,
        /// The install to run, as it is named on the node. Either this or --combination.
        #[arg(
            long,
            required_unless_present = "combination",
            conflicts_with = "combination"
        )]
        install_id: Option<String>,
        /// The combination to run: its directory under combinations/ in the repo,
        /// e.g. qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode. The node reads the
        /// install id from that directory's config.sh.
        #[arg(long)]
        combination: Option<String>,
        /// Repo-relative pack directory, e.g. benchmarks/vidi.
        #[arg(long)]
        pack: String,
        #[arg(long)]
        scope: Option<String>,
        /// Only these stories, e.g. 1,2,3.
        #[arg(long, value_delimiter = ',')]
        stories: Option<Vec<u32>>,
        #[arg(long)]
        run_id: String,
        #[arg(long, value_enum, default_value = "pi")]
        client: ClientArg,
        /// Don't commit and push each story.
        #[arg(long)]
        no_record: bool,
    },
    /// Jobs on every node, one node, or one job in detail.
    Status {
        node: Option<String>,
        id: Option<String>,
    },
    /// A job's log.
    Logs {
        node: String,
        id: String,
        /// Keep following while the job runs.
        #[arg(short, long)]
        follow: bool,
        /// Start at this byte offset.
        #[arg(long, default_value_t = 0)]
        from: u64,
    },
    /// Typed events parsed from a job's log.
    Events { node: String, id: String },
    /// Cancel a job (SIGTERM, then SIGKILL, to its process group).
    Cancel { node: String, id: String },
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum UnitKind {
    Systemd,
    Launchd,
}

#[derive(ValueEnum, Clone, Copy, Debug)]
pub enum ClientArg {
    Pi,
    Opencode,
}

impl From<ClientArg> for AgentClient {
    fn from(c: ClientArg) -> Self {
        match c {
            ClientArg::Pi => AgentClient::Pi,
            ClientArg::Opencode => AgentClient::Opencode,
        }
    }
}

#[derive(Args, Debug, Clone)]
pub struct ServeArgs {
    /// Address to listen on, e.g. 100.64.0.5:7717 (a LAN/Tailscale address, not 0.0.0.0 on a public network).
    #[arg(long)]
    pub bind: String,
    /// Checkout of the benchmark repo.
    #[arg(long)]
    pub repo: PathBuf,
    /// State directory (token, jobs). Default ~/.dbench.
    #[arg(long)]
    pub home: Option<PathBuf>,
    /// Where installs keep `<install-id>/install.env`. Default ~/.local/share.
    #[arg(long)]
    pub share_dir: Option<PathBuf>,
    /// Directory put in front of PATH for the harness and tool probes (repeatable).
    #[arg(long = "path-prepend")]
    pub path_prepend: Vec<PathBuf>,
    #[arg(long, default_value_t = DEFAULT_MAX_RESTARTS)]
    pub max_restarts: u32,
    /// Don't `git pull --ff-only` before each job.
    #[arg(long)]
    pub no_pull: bool,
    #[arg(long, default_value_t = DEFAULT_RESTART_BACKOFF_MS, hide = true)]
    pub restart_backoff_ms: u64,
    #[arg(long, default_value_t = DEFAULT_CANCEL_GRACE_MS, hide = true)]
    pub cancel_grace_ms: u64,
    #[arg(long, default_value_t = DEFAULT_TREE_POLL_MS, hide = true)]
    pub tree_poll_ms: u64,
}

fn home_dir() -> Result<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .context("HOME is not set")
}

fn absolute(p: &Path) -> Result<PathBuf> {
    if p.is_absolute() {
        Ok(p.to_path_buf())
    } else {
        Ok(std::env::current_dir()?.join(p))
    }
}

/// Resolved server settings.
#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub bind: String,
    pub repo: PathBuf,
    pub home: PathBuf,
    pub jobs_dir: PathBuf,
    pub share_dir: PathBuf,
    pub path_prepend: Vec<PathBuf>,
    pub max_restarts: u32,
    pub pull: bool,
    pub restart_backoff: Duration,
    pub cancel_grace: Duration,
    pub tree_poll: Duration,
}

impl ServeArgs {
    pub fn resolve(&self) -> Result<ServerConfig> {
        let user_home = home_dir()?;
        let home = absolute(
            &self
                .home
                .clone()
                .unwrap_or_else(|| user_home.join(DEFAULT_HOME_DIR)),
        )?;
        let repo = std::fs::canonicalize(&self.repo)
            .with_context(|| format!("repo {}", self.repo.display()))?;
        Ok(ServerConfig {
            bind: self.bind.clone(),
            jobs_dir: home.join("jobs"),
            home,
            repo,
            share_dir: absolute(
                &self
                    .share_dir
                    .clone()
                    .unwrap_or_else(|| user_home.join(DEFAULT_SHARE_DIR)),
            )?,
            path_prepend: self
                .path_prepend
                .iter()
                .map(|p| absolute(p))
                .collect::<Result<_>>()?,
            max_restarts: self.max_restarts,
            pull: !self.no_pull,
            restart_backoff: Duration::from_millis(self.restart_backoff_ms),
            cancel_grace: Duration::from_millis(self.cancel_grace_ms),
            tree_poll: Duration::from_millis(self.tree_poll_ms),
        })
    }
}

impl ServerConfig {
    /// `serve` arguments that reproduce this configuration (for service units).
    pub fn to_serve_argv(&self) -> Vec<OsString> {
        let mut a: Vec<OsString> = vec!["serve".into(), "--bind".into(), self.bind.clone().into()];
        a.extend(["--repo".into(), self.repo.clone().into_os_string()]);
        a.extend(["--home".into(), self.home.clone().into_os_string()]);
        a.extend([
            "--share-dir".into(),
            self.share_dir.clone().into_os_string(),
        ]);
        for p in &self.path_prepend {
            a.extend(["--path-prepend".into(), p.clone().into_os_string()]);
        }
        a.extend([
            "--max-restarts".into(),
            self.max_restarts.to_string().into(),
        ]);
        if !self.pull {
            a.push("--no-pull".into());
        }
        if self.restart_backoff != Duration::from_millis(DEFAULT_RESTART_BACKOFF_MS) {
            a.extend([
                "--restart-backoff-ms".into(),
                self.restart_backoff.as_millis().to_string().into(),
            ]);
        }
        if self.cancel_grace != Duration::from_millis(DEFAULT_CANCEL_GRACE_MS) {
            a.extend([
                "--cancel-grace-ms".into(),
                self.cancel_grace.as_millis().to_string().into(),
            ]);
        }
        if self.tree_poll != Duration::from_millis(DEFAULT_TREE_POLL_MS) {
            a.extend([
                "--tree-poll-ms".into(),
                self.tree_poll.as_millis().to_string().into(),
            ]);
        }
        a
    }

    /// PATH for the harness: the prepends, then the server's own PATH.
    pub fn child_path(&self) -> OsString {
        let mut parts: Vec<PathBuf> = self.path_prepend.clone();
        if let Some(p) = std::env::var_os("PATH") {
            parts.extend(std::env::split_paths(&p));
        }
        std::env::join_paths(parts).unwrap_or_default()
    }
}
