//! `GET /v1/node`: what this machine is and what it has installed.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;

use crate::progress::{parse_env, INSTALL_ENV};

/// Longest a `<tool> --version` or nvidia-smi probe may take.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(10);
pub const TOOLS: [&str; 4] = ["node", "pi", "git", "uv"];
const MIB: u64 = 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Gpu {
    pub name: String,
    pub memory_mib: Option<u64>,
    /// Memory shared with the CPU (Apple silicon), so `memory_mib` is total RAM.
    pub unified: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Combination {
    pub install_id: Option<String>,
    pub combination: Option<String>,
    pub backend: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NodeInfo {
    pub hostname: String,
    pub os: String,
    pub arch: String,
    pub cpus: usize,
    pub total_ram_bytes: Option<u64>,
    pub cpu_brand: Option<String>,
    pub gpus: Vec<Gpu>,
    pub combinations: Vec<Combination>,
    /// First line of `<tool> --version`, or null when missing.
    pub tools: BTreeMap<String, Option<String>>,
    pub dbench_version: String,
    pub repo_head: Option<String>,
    pub current_job: Option<String>,
}

/// Run a probe with the harness PATH; first line of stdout on success.
pub async fn probe(program: &str, args: &[&str], path: &OsString) -> Option<String> {
    let text = full_output(program, args, path).await?;
    let first = text.lines().next().unwrap_or("").trim().to_string();
    (!first.is_empty()).then_some(first)
}

pub fn installed_combinations(share_dir: &Path) -> Vec<Combination> {
    let Ok(entries) = std::fs::read_dir(share_dir) else {
        return Vec::new();
    };
    let mut out: Vec<Combination> = entries
        .filter_map(|e| e.ok())
        .filter_map(|e| std::fs::read_to_string(e.path().join(INSTALL_ENV)).ok())
        .map(|t| {
            let env = parse_env(&t);
            Combination {
                install_id: env.get("INSTALL_ID").cloned(),
                combination: env.get("COMBINATION").cloned(),
                backend: env.get("BACKEND").cloned(),
            }
        })
        .collect();
    out.sort_by(|a, b| a.install_id.cmp(&b.install_id));
    out
}

/// `nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits` output.
pub fn parse_nvidia_smi(text: &str) -> Vec<Gpu> {
    text.lines()
        .filter_map(|l| {
            let (name, mem) = l.rsplit_once(',')?;
            Some(Gpu {
                name: name.trim().to_string(),
                memory_mib: mem.trim().parse().ok(),
                unified: false,
            })
        })
        .collect()
}

async fn gpus(path: &OsString) -> (Option<String>, Vec<Gpu>) {
    #[allow(unused_mut)]
    let mut gpus = full_output(
        "nvidia-smi",
        &[
            "--query-gpu=name,memory.total",
            "--format=csv,noheader,nounits",
        ],
        path,
    )
    .await
    .map(|t| parse_nvidia_smi(&t))
    .unwrap_or_default();
    #[cfg(target_os = "macos")]
    {
        let brand = crate::sys::sysctl_string("machdep.cpu.brand_string");
        if let Some(b) = &brand {
            gpus.push(Gpu {
                name: b.clone(),
                memory_mib: crate::sys::total_ram_bytes().map(|m| m / MIB),
                unified: true,
            });
        }
        (brand, gpus)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let brand = std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|t| {
            t.lines().find_map(|l| {
                l.strip_prefix("model name")
                    .map(|r| r.trim_start_matches([' ', '\t', ':']).to_string())
            })
        });
        let _ = MIB;
        (brand, gpus)
    }
}

async fn full_output(program: &str, args: &[&str], path: &OsString) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .env("PATH", path)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let out = tokio::time::timeout(PROBE_TIMEOUT, cmd.output())
        .await
        .ok()?
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

pub async fn gather(
    repo: &Path,
    share_dir: &Path,
    path: &OsString,
    current_job: Option<String>,
) -> NodeInfo {
    let tool_probes = TOOLS
        .iter()
        .map(|t| async move { (t.to_string(), probe(t, &["--version"], path).await) });
    let repo_s = repo.display().to_string();
    let head_args = ["-C", repo_s.as_str(), "rev-parse", "HEAD"];
    let head = probe("git", &head_args, path);
    let ((cpu_brand, gpus), tools, repo_head) = tokio::join!(
        gpus(path),
        futures_util::future::join_all(tool_probes),
        head
    );
    NodeInfo {
        hostname: crate::sys::hostname(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        cpus: std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(0),
        total_ram_bytes: crate::sys::total_ram_bytes(),
        cpu_brand,
        gpus,
        combinations: installed_combinations(share_dir),
        tools: tools.into_iter().collect(),
        dbench_version: crate::VERSION.into(),
        repo_head,
        current_job,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nvidia() {
        let g = parse_nvidia_smi("NVIDIA GeForce RTX 4090, 24564\nNVIDIA A, B, 100\n");
        assert_eq!(
            g[0],
            Gpu {
                name: "NVIDIA GeForce RTX 4090".into(),
                memory_mib: Some(24564),
                unified: false
            }
        );
        assert_eq!(g[1].name, "NVIDIA A, B");
    }
}
