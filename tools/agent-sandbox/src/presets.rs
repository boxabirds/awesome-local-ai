//! Named sets of hosts for the proxy's allow-list, read from presets.toml (built into the binary).

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::collections::BTreeMap;

const PRESETS_TOML: &str = include_str!("../presets.toml");

#[derive(Debug, Clone, Deserialize)]
struct Entry {
    why: String,
    hosts: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Preset {
    pub name: String,
    pub why: String,
    pub hosts: Vec<String>,
}

/// Every preset, in name order.
pub fn all() -> Result<Vec<Preset>> {
    let table: BTreeMap<String, Entry> =
        toml::from_str(PRESETS_TOML).context("reading presets.toml")?;
    Ok(table
        .into_iter()
        .map(|(name, e)| Preset {
            name,
            why: e.why,
            hosts: e.hosts,
        })
        .collect())
}

/// The hosts of one preset.
pub fn hosts(name: &str) -> Result<Vec<String>> {
    let presets = all()?;
    let known = presets
        .iter()
        .map(|p| p.name.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    presets
        .iter()
        .find(|p| p.name == name)
        .map(|p| p.hosts.clone())
        .ok_or_else(|| anyhow!("no preset named {name:?}; presets.toml has: {known}"))
}
