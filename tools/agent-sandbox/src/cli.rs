//! Command-line definitions.

use clap::{Args, Parser, Subcommand, ValueEnum};
use std::ffi::OsString;
use std::path::PathBuf;

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
    /// Run only the allow-listing proxy; prints its port on the first line of stdout.
    Proxy(ProxyArgs),
    /// Inside an isolated-network sandbox: open the bridged ports, then run the command.
    #[command(hide = true)]
    Inner(InnerArgs),
}

#[derive(Args, Debug)]
pub struct SandboxArgs {
    /// The run's directory: the only place the command can write. Holds workspace/, tmp/ and agent-home/.
    #[arg(long)]
    pub own_dir: PathBuf,
    /// A file or directory the command may read and execute, never write. Repeatable.
    #[arg(long)]
    pub ro: Vec<PathBuf>,
    #[command(flatten)]
    pub hosts: HostArgs,
    /// Where the proxy logs each request (JSON lines). The command cannot read it unless it is in own_dir.
    #[arg(long)]
    pub proxy_log: Option<PathBuf>,
    /// A loopback port on the host the command must reach (the model server). Repeatable.
    /// Linux: carried into the sandbox's private network. macOS: all loopback is reachable anyway.
    #[arg(long)]
    pub host_port: Vec<u16>,
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
    /// The directory of bridge sockets, as seen inside the sandbox.
    #[arg(long)]
    pub sockets: PathBuf,
    /// A port to listen on here and carry to the host. Repeatable.
    #[arg(long)]
    pub forward: Vec<u16>,
    #[arg(last = true, required = true)]
    pub command: Vec<OsString>,
}
