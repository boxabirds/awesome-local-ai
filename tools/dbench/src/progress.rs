//! Job progress, read from the harness's run directory and the job log.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::job::JobSpec;

pub const INSTALL_ENV: &str = "install.env";
pub const LOG_TAIL_LINES: usize = 20;
/// How much of the end of the log to read when looking for the last lines.
const LOG_TAIL_BYTES: u64 = 64 * 1024;

pub fn install_env_path(share_dir: &Path, install_id: &str) -> PathBuf {
    share_dir.join(install_id).join(INSTALL_ENV)
}

/// `KEY="value"` / `KEY=value` lines of an install.env. Comments and other lines are ignored.
pub fn parse_env(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .filter(|(k, _)| !k.is_empty() && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .map(|(k, v)| (k.to_string(), v.trim().trim_matches('"').to_string()))
        .collect()
}

pub fn read_install_env(share_dir: &Path, install_id: &str) -> Option<BTreeMap<String, String>> {
    std::fs::read_to_string(install_env_path(share_dir, install_id))
        .ok()
        .map(|t| parse_env(&t))
}

/// `<repo>/combinations/<COMBINATION>/benchmarks/<basename(pack)>/<run_id>/`
pub fn run_dir(repo: &Path, combination: &str, spec: &JobSpec) -> PathBuf {
    repo.join("combinations")
        .join(combination)
        .join("benchmarks")
        .join(spec.pack_name())
        .join(&spec.run_id)
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct StoryProgress {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub passed: Option<u64>,
    pub total: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Progress {
    pub combination: Option<String>,
    pub run_dir: Option<String>,
    pub current_story: Option<String>,
    /// Stories with an acceptance result, in story order.
    pub stories: Vec<StoryProgress>,
    pub log_tail: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Finished stories from a metrics.json value: those with an `accept` result.
pub fn finished_stories(metrics: &serde_json::Value) -> Vec<StoryProgress> {
    let Some(stories) = metrics.get("stories").and_then(|s| s.as_object()) else {
        return Vec::new();
    };
    let mut out: Vec<StoryProgress> = stories
        .iter()
        .filter_map(|(id, s)| {
            let accept = s.get("accept")?;
            Some(StoryProgress {
                id: id.clone(),
                title: s.get("title").and_then(|t| t.as_str()).map(String::from),
                passed: accept.get("passed").and_then(|v| v.as_u64()),
                total: accept.get("total").and_then(|v| v.as_u64()),
            })
        })
        .collect();
    out.sort_by_key(|s| (s.id.parse::<u64>().unwrap_or(u64::MAX), s.id.clone()));
    out
}

/// The last `n` lines of a file, reading at most `LOG_TAIL_BYTES` from its end.
pub fn tail_lines(path: &Path, n: usize) -> Vec<String> {
    let Ok(mut f) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let start = len.saturating_sub(LOG_TAIL_BYTES);
    if f.seek(SeekFrom::Start(start)).is_err() {
        return Vec::new();
    }
    let mut buf = Vec::new();
    if f.read_to_end(&mut buf).is_err() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0); // probably a partial line
    }
    let skip = lines.len().saturating_sub(n);
    lines[skip..].iter().map(|l| l.to_string()).collect()
}

pub fn compute(repo: &Path, share_dir: &Path, spec: &JobSpec, log: &Path) -> Progress {
    let mut p = Progress {
        log_tail: tail_lines(log, LOG_TAIL_LINES),
        ..Default::default()
    };
    let Some(env) = read_install_env(share_dir, &spec.install_id) else {
        p.error = Some(format!(
            "{} not found",
            install_env_path(share_dir, &spec.install_id).display()
        ));
        return p;
    };
    let Some(combination) = env.get("COMBINATION").cloned() else {
        p.error = Some("install.env has no COMBINATION".into());
        return p;
    };
    let dir = run_dir(repo, &combination, spec);
    p.current_story = std::fs::read_to_string(dir.join("current_story"))
        .ok()
        .map(|s| s.trim().to_string());
    if let Ok(bytes) = std::fs::read(dir.join("metrics.json")) {
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) => p.stories = finished_stories(&v),
            Err(e) => p.error = Some(format!("metrics.json: {e}")),
        }
    }
    p.combination = Some(combination);
    p.run_dir = Some(dir.display().to_string());
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_parsing() {
        let env = parse_env(
            "# Written by awesome-local-ai.\nINSTALL_ID=\"mtplx-qwen38-27b\"\nCOMBINATION=\"qwen/3.8/27b/macos/64GB/mtplx-opencode\"\nBACKEND=mtplx\nSAMPLING=\"--a 0.6 --b=1\"\n",
        );
        assert_eq!(env["INSTALL_ID"], "mtplx-qwen38-27b");
        assert_eq!(env["COMBINATION"], "qwen/3.8/27b/macos/64GB/mtplx-opencode");
        assert_eq!(env["BACKEND"], "mtplx");
        assert_eq!(env["SAMPLING"], "--a 0.6 --b=1");
    }

    #[test]
    fn stories_from_metrics() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"stories":{"10":{"title":"ten","accept":{"passed":1,"total":2}},
                           "2":{"title":"two","accept":{"passed":5,"total":5}},
                           "3":{"title":"running, no accept yet"}}}"#,
        )
        .unwrap();
        let s = finished_stories(&v);
        assert_eq!(
            s.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["2", "10"]
        );
        assert_eq!((s[0].passed, s[0].total), (Some(5), Some(5)));
    }

    #[test]
    fn tail() {
        let p = std::env::temp_dir().join(format!("dbench-tail-{}", std::process::id()));
        let text: String = (1..=30).map(|i| format!("line {i}\n")).collect();
        std::fs::write(&p, text).unwrap();
        let t = tail_lines(&p, LOG_TAIL_LINES);
        assert_eq!(t.len(), LOG_TAIL_LINES);
        assert_eq!(t[0], "line 11");
        assert_eq!(t.last().unwrap(), "line 30");
        std::fs::remove_file(&p).unwrap();
        assert!(tail_lines(&p, LOG_TAIL_LINES).is_empty());
    }
}
