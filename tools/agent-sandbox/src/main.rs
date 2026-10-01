use clap::Parser;

use agent_sandbox::cli::{Cli, Cmd};
use agent_sandbox::run::{self, EXIT_CANNOT_RUN};

fn main() {
    // The first process of an isolated Linux sandbox starts as `init`, with no arguments to list.
    if std::env::var_os(agent_sandbox::bwrap::INNER_ENV).is_some() {
        let code = match run::init(std::path::Path::new(agent_sandbox::bwrap::INNER_SOCKETS)) {
            Ok(code) => code,
            Err(e) => {
                eprintln!("agent-sandbox: {e:#}");
                EXIT_CANNOT_RUN
            }
        };
        std::process::exit(code);
    }
    let result = match Cli::parse().cmd {
        Cmd::Run(args) => run::run(&args),
        Cmd::Print(args) => run::print(&args).map(|text| {
            print!("{text}");
            0
        }),
        Cmd::Identity => {
            println!("{}", agent_sandbox::identity::json());
            Ok(0)
        }
        Cmd::Proxy(args) => run::serve_proxy(&args).map(|()| 0),
        Cmd::Inner(args) => run::init(&args.sockets),
    };
    match result {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("agent-sandbox: {e:#}");
            std::process::exit(EXIT_CANNOT_RUN);
        }
    }
}
