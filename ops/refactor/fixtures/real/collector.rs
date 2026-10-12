// Unchanged excerpt of tools/dbench/src/collector.rs, pinned to commit f76e6a167. Refresh deliberately, with the pin.

fn archived_runs(cfg: &Config) -> BTreeSet<String> {
    let Some(repo) = cfg.repo.as_ref() else { return BTreeSet::new() };
    let published: Box<dyn crate::ingest::inputs::Published> = if cfg.worktree {
        Box::new(crate::ingest::inputs::TreeSource { root: repo.clone() })
    } else {
        Box::new(crate::ingest::inputs::GitSource::new(repo, "origin/main"))
    };
    published.archived().unwrap_or_else(|e| {
        eprintln!("dbench collect: the archived runs can't be read: {e:#}");
        BTreeSet::new()
    })
}

pub async fn pass(ctx: &Ctx, cfg: &Config, cadence: &Cadence, fetch: bool, now: u64) -> Result<Vec<NodeSummary>> {
    let names: Vec<String> = if cfg.nodes.is_empty() { ctx.nodes.keys().cloned().collect() } else { cfg.nodes.clone() };
    let archived = archived_runs(cfg);
    let futs = names.iter().map(|n| collect_node(ctx, n, &cfg.store, &cfg.runs, &archived, cadence, now));
    let summaries = futures_util::future::join_all(futs).await;
    for s in &summaries {
        for p in &s.problems {
            eprintln!("dbench collect: {}: {p}", s.node);
        }
    }
    if let Some(repo) = cfg.repo.as_ref().filter(|_| !cfg.no_ingest) {
        let changed = summaries.iter().any(|s| s.runs.iter().any(|r| r.changed));
        if changed || fetch {
            let store = cfg.store.clone();
            let db_path = cfg.db.clone();
            let repo = repo.clone();
            let worktree = cfg.worktree;
            let summary = tokio::task::spawn_blocking(move || -> Result<crate::ingest::inputs::Summary> {
                let published: Box<dyn crate::ingest::inputs::Published> = if worktree {
                    Box::new(crate::ingest::inputs::TreeSource { root: repo })
                } else {
                    let g = crate::ingest::inputs::GitSource::new(&repo, "origin/main");
                    if fetch {
                        g.fetch()?;
                    }
                    Box::new(g)
                };
                if let Some(dir) = db_path.parent() {
                    std::fs::create_dir_all(dir)?;
                }
                let mut db = crate::ingest::db::Db::open(&db_path)?;
                crate::ingest::inputs::run(&mut db, published.as_ref(), &store, &Default::default(), now as f64)
            })
            .await??;
            if summary.ingested > 0 || summary.requests > 0 {
                eprintln!("dbench collect: ingested {} story runs, {} requests placed ({:.1} s)", summary.ingested, summary.requests, summary.seconds);
            }
            // The analytics layer is derived from the warehouse; its failure never stops collection.
            let warehouse = cfg.db.clone();
            let ingested = summary.ingested;
            match tokio::task::spawn_blocking(move || crate::analytics::after_ingest(&warehouse, ingested, now as f64)).await {
                Ok(Some(line)) => eprintln!("dbench collect: {line}"),
                Ok(None) => {}
                Err(e) => eprintln!("dbench collect: analytics: {e}"),
            }
        }
    }
    Ok(summaries)
}

/// The resolved settings of a collect command.
#[derive(Debug, Clone)]
pub struct Config {
    pub store: PathBuf,
    pub db: PathBuf,
    pub repo: Option<PathBuf>,
    pub worktree: bool,
    pub api: Option<String>,
    pub nodes: Vec<String>,
    pub runs: Vec<String>,
    pub no_ingest: bool,
}
