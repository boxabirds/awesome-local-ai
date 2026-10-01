use clap::Parser;

use agent_sandbox::cli::{Cli, Cmd};
use agent_sandbox::run::{self, EXIT_CANNOT_RUN};

fn main() {
    let result = match Cli::parse().cmd {
        Cmd::Run(args) => run::run(&args),
        Cmd::Print(args) => run::print(&args).map(|text| {
            print!("{text}");
            0
        }),
        Cmd::Proxy(args) => run::serve_proxy(&args).map(|()| 0),
        Cmd::Inner(args) => run::inner(&args),
    };
    match result {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("agent-sandbox: {e:#}");
            std::process::exit(EXIT_CANNOT_RUN);
        }
    }
}
