//! `dbench-collector`: the collector under a name of its own, so a process list tells it from a benchmark node
//! (`dbench serve`). It takes the options of `dbench collect` and runs the same code.

use anyhow::Result;
use clap::Parser;
use std::path::PathBuf;

use dbench::cli::CollectArgs;
use dbench::client::Ctx;

/// Pull what git never carries from every node into the lake, keep the conversation database current, and serve
/// the conversation API. The same as `dbench collect`.
#[derive(Parser, Debug)]
#[command(name = "dbench-collector", version = env!("CARGO_PKG_VERSION"))]
struct Args {
    /// Node list (default ~/.config/dbench/nodes.toml).
    #[arg(long)]
    config: Option<PathBuf>,
    /// Machine-readable output.
    #[arg(long)]
    json: bool,
    #[command(flatten)]
    collect: CollectArgs,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    dbench::collector::cmd_collect(&Ctx::load(args.config, args.json)?, &args.collect).await
}
