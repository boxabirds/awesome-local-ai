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
/// Wait before trying again after the harness said the machine is unfit (a swap or memory guard stop): long enough
/// for memory to settle, and the check that decides is the harness's own (machine_fit.py), done first.
pub const DEFAULT_UNFIT_BACKOFF_MS: u64 = 300_000;
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
        /// e.g. qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi. The node reads the
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
        /// Known-good mode: run --stories on a finished run's code as it was when the story before
        /// ended. A run directory relative to the repo, e.g. combinations/…/benchmarks/vidi/v2-r1;
        /// the node needs its workspace.bundle and metrics.json. The result is diagnostic.
        #[arg(long, requires = "stories")]
        from_run: Option<String>,
        #[arg(long)]
        run_id: String,
        #[arg(long, value_enum, default_value = "pi")]
        client: ClientArg,
        /// Don't commit and push each story.
        #[arg(long)]
        no_record: bool,
        /// KEY=VALUE for the harness and the model server it starts; repeatable.
        /// Allowed: GPU_BACKEND (vulkan|rocm), SPEC_MTP (0|1), SPEC_DRAFT_N_MAX (1-16),
        /// SPEC_DRAFT_P_MIN (0-1), PROFILE. Name the run for it too (e.g. canvas-rocm-01).
        #[arg(long = "server-env", value_parser = parse_key_value)]
        server_env: Vec<(String, String)>,
        /// Run the benchmark this many times, as separate queued jobs: <id>-r1… and <run-id>-r1…
        /// (each keeps its own record, resume and status). 1 keeps the ids as given.
        #[arg(long, default_value_t = 1)]
        repeat: u32,
        /// Number of the first repeat, to add runs to an existing series (e.g. --repeat 2 --repeat-from 4).
        #[arg(long, default_value_t = 1)]
        repeat_from: u32,
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
    /// Hold a node: its running job carries on, and no queued job starts until a release.
    /// The hold outlives a restart of the node's server (use it to restart on a new binary between jobs).
    Hold {
        node: String,
        /// Why, shown while the node is held.
        #[arg(long)]
        reason: String,
    },
    /// Release a held node: its queued jobs start again.
    Release { node: String },
    /// Release the harness: run every check, and only if all pass tag HEAD and push the tag.
    ///
    /// The checks are the list in tools/dbench/checks.toml of the repo. It refuses, tagging nothing, when
    /// a check fails, can't run or skips; when files under the checked paths have uncommitted changes
    /// or are untracked; or when HEAD isn't what origin/main points at (it fetches first).
    /// (`dbench release <node>` is something else: it ends a hold.)
    #[command(name = "harness-release")]
    HarnessRelease(HarnessReleaseArgs),
    /// Cancel a job (SIGTERM, then SIGKILL, to its process group).
    Cancel {
        node: String,
        id: String,
        /// Why, kept with the job and shown wherever it is.
        #[arg(long)]
        reason: String,
    },
    /// End the running story as PARTIAL; the run continues with the next story.
    ///
    /// Ends the running story's work: the harness stops the agent, records the story
    /// as PARTIAL with your reason, and the run continues with the next story (the job
    /// keeps running). Later stories may then build on incomplete work, so use with care.
    /// See benchmarks/spec-bench/harness/CONTROL.md.
    #[command(name = "skip-story")]
    SkipStory {
        node: String,
        id: String,
        /// The story to end; it must be the one running now.
        #[arg(long)]
        story: u32,
        /// Why, recorded with the PARTIAL story.
        #[arg(long)]
        reason: String,
    },
}

#[derive(Args, Debug, Clone)]
pub struct HarnessReleaseArgs {
    /// Checkout to check and tag. Default: the git repository the current directory is in.
    #[arg(long)]
    pub repo: Option<PathBuf>,
    /// Run the checks and report; tag nothing, and don't look at git state (CI uses this).
    #[arg(long, conflicts_with = "dry_run")]
    pub check_only: bool,
    /// Show the checks that would run and the tag that would be made; run nothing.
    /// With --verified-by-ci: ask GitHub (read-only) and say what would be tagged, or why nothing would.
    #[arg(long)]
    pub dry_run: bool,
    /// Run no check here: release on CI's verdict. Tags the commit for which the checks workflow's
    /// push run concluded success (asked through `gh`, read-only): HEAD, or the newest earlier commit
    /// with identical checked files (results-only commits start no run). Refuses when there is no
    /// such run, when it hasn't ended (see --wait) or didn't succeed. Git preconditions are unchanged.
    #[arg(long, conflicts_with = "check_only")]
    pub verified_by_ci: bool,
    /// With --verified-by-ci: while the CI run hasn't ended, keep asking until it has.
    #[arg(long, requires = "verified_by_ci", conflicts_with = "dry_run")]
    pub wait: bool,
    /// With --wait: give up, tagging nothing, after this many seconds.
    #[arg(long, requires = "wait", default_value_t = crate::release_ci::DEFAULT_WAIT_TIMEOUT_SECS)]
    pub wait_timeout_secs: u64,
    /// With --wait: seconds between two questions to GitHub.
    #[arg(long, requires = "wait", default_value_t = crate::release_ci::DEFAULT_POLL_SECS)]
    pub poll_secs: u64,
    /// Where each check's full output is kept. Default: a temporary directory, removed when every check passes.
    #[arg(long)]
    pub log_dir: Option<PathBuf>,
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
    Claude,
}

impl From<ClientArg> for AgentClient {
    fn from(c: ClientArg) -> Self {
        match c {
            ClientArg::Pi => AgentClient::Pi,
            ClientArg::Opencode => AgentClient::Opencode,
            ClientArg::Claude => AgentClient::Claude,
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
    /// Don't `git pull --ff-only` (or fetch release tags) before each job.
    #[arg(long)]
    pub no_pull: bool,
    /// For development: when there is no harness release (no harness-v* tag on origin/main), run the
    /// checkout's own harness instead of refusing the job. With a release, jobs run it regardless.
    #[arg(long)]
    pub allow_unreleased: bool,
    #[arg(long, default_value_t = DEFAULT_RESTART_BACKOFF_MS, hide = true)]
    pub restart_backoff_ms: u64,
    #[arg(long, default_value_t = DEFAULT_UNFIT_BACKOFF_MS, hide = true)]
    pub unfit_backoff_ms: u64,
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
    /// Where harness releases are materialised, one directory per tag (harness.rs).
    pub releases_dir: PathBuf,
    pub share_dir: PathBuf,
    pub path_prepend: Vec<PathBuf>,
    pub max_restarts: u32,
    pub pull: bool,
    pub allow_unreleased: bool,
    pub restart_backoff: Duration,
    pub unfit_backoff: Duration,
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
            releases_dir: home.join(crate::harness::RELEASES_DIR),
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
            allow_unreleased: self.allow_unreleased,
            restart_backoff: Duration::from_millis(self.restart_backoff_ms),
            unfit_backoff: Duration::from_millis(self.unfit_backoff_ms),
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
        if self.allow_unreleased {
            a.push("--allow-unreleased".into());
        }
        if self.restart_backoff != Duration::from_millis(DEFAULT_RESTART_BACKOFF_MS) {
            a.extend([
                "--restart-backoff-ms".into(),
                self.restart_backoff.as_millis().to_string().into(),
            ]);
        }
        if self.unfit_backoff != Duration::from_millis(DEFAULT_UNFIT_BACKOFF_MS) {
            a.extend([
                "--unfit-backoff-ms".into(),
                self.unfit_backoff.as_millis().to_string().into(),
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

fn parse_key_value(s: &str) -> Result<(String, String), String> {
    match s.split_once('=') {
        Some((k, v)) if !k.is_empty() => Ok((k.to_string(), v.to_string())),
        _ => Err(format!("expected KEY=VALUE, got {s:?}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allow_unreleased_is_off_unless_asked_for_and_survives_a_service_unit() {
        let serve = |extra: &[&str]| {
            let mut argv = vec!["dbench", "serve", "--bind", "127.0.0.1:0", "--repo", "/", "--home", "/h"];
            argv.extend(extra);
            match Cli::try_parse_from(argv).unwrap().cmd {
                Cmd::Serve(args) => args.resolve().unwrap(),
                other => panic!("{other:?}"),
            }
        };
        let off = serve(&[]);
        assert!(!off.allow_unreleased);
        assert!(!off.to_serve_argv().contains(&"--allow-unreleased".into()));
        assert_eq!(off.releases_dir, Path::new("/h").join(crate::harness::RELEASES_DIR));
        let on = serve(&["--allow-unreleased"]);
        assert!(on.allow_unreleased);
        assert!(on.to_serve_argv().contains(&"--allow-unreleased".into()));
    }

    #[test]
    fn harness_release_does_not_take_over_release_of_a_held_node() {
        let cli = Cli::try_parse_from(["dbench", "release", "node-a"]).unwrap();
        assert!(matches!(cli.cmd, Cmd::Release { node } if node == "node-a"));
        let cli = Cli::try_parse_from(["dbench", "harness-release", "--check-only"]).unwrap();
        assert!(matches!(cli.cmd, Cmd::HarnessRelease(a) if a.check_only && !a.dry_run));
        // A forgotten node name must not start a release.
        assert!(Cli::try_parse_from(["dbench", "release"]).is_err());
        let both = ["dbench", "harness-release", "--check-only", "--dry-run"];
        assert!(Cli::try_parse_from(both).is_err());
    }

    #[test]
    fn a_release_on_cis_verdict_parses_with_its_waiting_flags() {
        use crate::release_ci::{DEFAULT_POLL_SECS, DEFAULT_WAIT_TIMEOUT_SECS};
        let parse = |flags: &[&str]| {
            Cli::try_parse_from(["dbench", "harness-release"].iter().chain(flags))
                .map(|cli| match cli.cmd {
                    Cmd::HarnessRelease(a) => a,
                    _ => unreachable!(),
                })
        };
        let plain = parse(&[]).unwrap();
        assert!(!plain.verified_by_ci && !plain.wait);
        let ci = parse(&["--verified-by-ci"]).unwrap();
        assert!(ci.verified_by_ci && !ci.wait);
        assert_eq!((ci.wait_timeout_secs, ci.poll_secs), (DEFAULT_WAIT_TIMEOUT_SECS, DEFAULT_POLL_SECS));
        let waiting = parse(&["--verified-by-ci", "--wait", "--wait-timeout-secs", "90", "--poll-secs", "5"]).unwrap();
        assert!(waiting.wait);
        assert_eq!((waiting.wait_timeout_secs, waiting.poll_secs), (90, 5));
        assert!(parse(&["--verified-by-ci", "--dry-run"]).unwrap().dry_run);
        // CI's verdict is instead of running the checks; waiting is only for it, and a dry run doesn't wait.
        for bad in [
            &["--verified-by-ci", "--check-only"][..],
            &["--wait"],
            &["--verified-by-ci", "--wait-timeout-secs", "90"],
            &["--verified-by-ci", "--poll-secs", "5"],
            &["--verified-by-ci", "--dry-run", "--wait"],
        ] {
            assert!(parse(bad).is_err(), "{bad:?}");
        }
    }
}
