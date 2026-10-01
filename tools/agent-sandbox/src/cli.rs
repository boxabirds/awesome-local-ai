//! Command-line definitions.

use clap::{Args, Parser, Subcommand, ValueEnum};
use std::ffi::OsString;
use std::path::PathBuf;

use crate::ports::PortRange;

#[derive(Parser, Debug)]
#[command(
    name = "agent-sandbox",
    version,
    about = "Run a command with the least access it needs: its own directory, a read-only toolchain, loopback, and an allow-listing proxy"
)]
pub struct Cli {
    #[command(subcommand)]
    pub cmd: Cmd,
}

#[derive(Subcommand, Debug)]
pub enum Cmd {
    /// Run a command in the sandbox and exit with its status.
    Run(SandboxArgs),
    /// Print what `run` would execute: the Seatbelt profile (macOS) or the bwrap command line (Linux).
    Print(SandboxArgs),
    /// Print this build's identity as JSON: version, platform and a hash of the policy it enforces.
    Identity,
    /// Run only the allow-listing proxy; prints its port on the first line of stdout.
    Proxy(ProxyArgs),
    /// The sandbox's first process on Linux (it runs itself as this through AGENT_SANDBOX_INNER):
    /// open the bridged ports found in the sockets directory, run the command written beside them,
    /// reap everything that is left, pass the command's status on.
    #[command(hide = true)]
    Inner(InnerArgs),
}

#[derive(Args, Debug)]
pub struct SandboxArgs {
    /// The run's directory: the only place the command can write. Holds workspace/, tmp/ and agent-home/.
    #[arg(long)]
    pub own_dir: PathBuf,
    /// Linux: show --own-dir at this path inside (the harness uses /w), so the command never sees
    /// where the run really lives. macOS cannot remap a path and refuses this.
    #[arg(long)]
    pub own_at: Option<PathBuf>,
    /// A path inside --own-dir, relative to it, that the command may read and never write (the
    /// spec). A mount on Linux, a deny on macOS: `chmod` cannot open it. Repeatable.
    #[arg(long)]
    pub own_ro: Vec<PathBuf>,
    /// The directory the command starts in, relative to --own-dir.
    #[arg(long)]
    pub workdir: Option<PathBuf>,
    /// The only environment variables the command gets: these names, if this process has them, and
    /// the proxy's and PATH, which are set here. Without it the command inherits everything.
    #[arg(long, value_delimiter = ',', value_name = "NAME,NAME…")]
    pub keep_env: Option<Vec<String>>,
    /// A file or directory the command may read and execute, never write. Repeatable.
    #[arg(long)]
    pub ro: Vec<PathBuf>,
    #[command(flatten)]
    pub hosts: HostArgs,
    /// Where the proxy logs each request (JSON lines). The command cannot read it unless it is in own_dir.
    #[arg(long)]
    pub proxy_log: Option<PathBuf>,
    /// A loopback port outside the sandbox the command must reach (the model server). Repeatable.
    /// Linux: carried into the sandbox's private network. macOS: the command may connect to it.
    #[arg(long)]
    pub host_port: Vec<u16>,
    /// Loopback ports for the command's own servers, as PORT or FIRST-LAST. Repeatable. macOS: the
    /// only ports it may bind, listen on and connect to. Linux: not needed, its loopback is its own.
    #[arg(long, value_name = "PORT|FIRST-LAST")]
    pub agent_ports: Vec<PortRange>,
    /// Let the command bind to port 0 ("any free port") and connect to what it got; `wrangler dev`
    /// needs it. macOS: it may then bind any loopback port and connect to every port of the
    /// kernel's ephemeral range, its own or not, and starting takes seconds longer. Linux: no effect.
    #[arg(long)]
    pub ephemeral_ports: bool,
    /// Linux only: `shared` leaves the command in the host's network, where nothing is enforced.
    #[arg(long, value_enum, default_value_t = LinuxNet::Isolated)]
    pub linux_net: LinuxNet,
    /// The command and its arguments, after `--`.
    #[arg(last = true, required = true)]
    pub command: Vec<OsString>,
}

#[derive(Args, Debug)]
pub struct HostArgs {
    /// A host the command may reach through the proxy, with its subdomains: host or host:port
    /// (port 443 unless given). Repeatable. With none (and no --preset) there is no way out.
    #[arg(long = "allow-host", visible_alias = "allow")]
    pub allow_host: Vec<String>,
    /// A named set of hosts from presets.toml (npm, playwright, claude). Repeatable.
    #[arg(long)]
    pub preset: Vec<String>,
}

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinuxNet {
    Isolated,
    Shared,
}

#[derive(Args, Debug)]
pub struct ProxyArgs {
    #[command(flatten)]
    pub hosts: HostArgs,
    /// Log each request here (JSON lines).
    #[arg(long)]
    pub log: Option<PathBuf>,
    /// Port on 127.0.0.1; 0 picks a free one.
    #[arg(long, default_value_t = 0)]
    pub port: u16,
}

#[derive(Args, Debug)]
pub struct InnerArgs {
    /// The directory of bridge sockets and the command file, as seen inside the sandbox.
    #[arg(long)]
    pub sockets: PathBuf,
}
