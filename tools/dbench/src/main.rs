use anyhow::{Context, Result};
use clap::Parser;

use dbench::cli::{Cli, Cmd, UnitKind};
use dbench::client::{self, Ctx};
use dbench::job::JobSpec;

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Serve(args) => dbench::server::serve(args.resolve()?).await,
        Cmd::ServiceUnit { kind, serve } => {
            let cfg = serve.resolve()?;
            let exe = std::env::current_exe()?.canonicalize()?;
            let argv = cfg.to_serve_argv();
            let path = cfg.child_path().to_string_lossy().into_owned();
            let text = match kind {
                UnitKind::Systemd => dbench::service_unit::systemd(&exe, &argv, &path),
                UnitKind::Launchd => {
                    dbench::service_unit::launchd(&exe, &argv, &path, &cfg.home.join("dbench.log"))
                }
            };
            print!("{text}");
            Ok(())
        }
        Cmd::Nodes => client::cmd_nodes(&Ctx::load(cli.config, cli.json)?).await,
        Cmd::Submit {
            node,
            id,
            install_id,
            combination,
            pack,
            scope,
            stories,
            run_id,
            client: c,
            no_record,
        } => {
            let spec = JobSpec {
                install_id: install_id.unwrap_or_default(),
                combination,
                pack: pack.trim_end_matches('/').to_string(),
                scope,
                stories,
                run_id,
                client: c.into(),
                record: !no_record,
            };
            spec.validate()
                .map_err(anyhow::Error::msg)
                .context("job spec")?;
            client::cmd_submit(&Ctx::load(cli.config, cli.json)?, &node, &id, spec).await
        }
        Cmd::Status { node, id } => {
            client::cmd_status(
                &Ctx::load(cli.config, cli.json)?,
                node.as_deref(),
                id.as_deref(),
            )
            .await
        }
        Cmd::Logs {
            node,
            id,
            follow,
            from,
        } => client::cmd_logs(&Ctx::load(cli.config, cli.json)?, &node, &id, follow, from).await,
        Cmd::Events { node, id } => {
            client::cmd_events(&Ctx::load(cli.config, cli.json)?, &node, &id).await
        }
        Cmd::Cancel { node, id } => {
            client::cmd_cancel(&Ctx::load(cli.config, cli.json)?, &node, &id).await
        }
    }
}
