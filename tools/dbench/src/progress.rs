//! Job progress, read from the harness's run directory and the job log.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use crate::ids::valid_id;
use crate::job::JobSpec;

pub const INSTALL_ENV: &str = "install.env";
/// Where the repo keeps its combinations: `<repo>/combinations/<combination>/`.
pub const COMBINATIONS_DIR: &str = "combinations";
/// A combination's own settings, including the `INSTALL_ID` it installs as.
pub const COMBINATION_CONFIG: &str = "config.sh";
/// Under a combination: `benchmarks/<pack>/<run-id>/`.
pub const BENCHMARKS_DIR: &str = "benchmarks";
pub const LOG_TAIL_LINES: usize = 20;
/// How much of the end of the log to read when looking for the last lines.
const LOG_TAIL_BYTES: u64 = 64 * 1024;

pub fn install_env_path(share_dir: &Path, install_id: &str) -> PathBuf {
    share_dir.join(install_id).join(INSTALL_ENV)
}

/// `KEY="value"` / `KEY=value` lines of an install.env or a combination's
/// config.sh. Comments and other lines are ignored.
pub fn parse_env(text: &str) -> BTreeMap<String, String> {
    text.lines()
        .filter(|l| !l.trim_start().starts_with('#'))
        .filter_map(|l| l.split_once('='))
        .filter(|(k, _)| !k.is_empty() && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
        .map(|(k, v)| (k.to_string(), env_value(v).to_string()))
        .collect()
}

/// The value of a `KEY=value` line as the shell reads it: a double-quoted
/// string up to its closing quote, or a bare word up to whitespace. Whatever
/// follows -- config.sh has `INSTALL_ID="x"   # install dir, ...` -- is not part of it.
fn env_value(raw: &str) -> &str {
    let raw = raw.trim_start();
    match raw.strip_prefix('"') {
        Some(rest) => rest.split_once('"').map_or(rest, |(v, _)| v),
        None => raw.split_whitespace().next().unwrap_or(""),
    }
}

/// A combination found in the repo: its path under `combinations/`, and the
/// install id its config.sh gives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepoCombination {
    pub combination: String,
    pub install_id: String,
}

/// Look a combination up in the repo, where it is a directory:
/// `<repo>/combinations/<combination>/config.sh`, which sets `INSTALL_ID`.
///
/// The filesystem decides what exists. The path must resolve (following
/// symlinks) to a directory strictly inside `<repo>/combinations` that has a
/// config.sh, which also rules out a partial path such as `qwen/3.8`. A leading
/// `combinations/` and a trailing `/` are accepted, so a tab-completed path works.
pub fn repo_combination(repo: &Path, combination: &str) -> Result<RepoCombination, String> {
    let root = repo.join(COMBINATIONS_DIR);
    let root = root
        .canonicalize()
        .map_err(|e| format!("{}: {e}", root.display()))?;
    let rel = combination.trim_end_matches('/');
    let rel = rel
        .strip_prefix(COMBINATIONS_DIR)
        .and_then(|r| r.strip_prefix('/'))
        .unwrap_or(rel);
    let dir = root
        .join(rel)
        .canonicalize()
        .map_err(|_| format!("no combination {combination:?} in {}", root.display()))?;
    let Some(rel) = dir.strip_prefix(&root).ok().filter(|r| !r.as_os_str().is_empty()) else {
        return Err(format!("{combination:?} is not a combination in {}", root.display()));
    };
    let config = dir.join(COMBINATION_CONFIG);
    let text = std::fs::read_to_string(&config).map_err(|_| {
        format!("{combination:?} has no {COMBINATION_CONFIG}; give the whole combination path")
    })?;
    let install_id = parse_env(&text)
        .remove("INSTALL_ID")
        .ok_or_else(|| format!("{} sets no INSTALL_ID", config.display()))?;
    // It becomes a path under the share dir and a harness argument.
    if !valid_id(&install_id) {
        return Err(format!("{}: invalid INSTALL_ID {install_id:?}", config.display()));
    }
    Ok(RepoCombination {
        combination: rel.to_string_lossy().into_owned(),
        install_id,
    })
}

pub fn read_install_env(share_dir: &Path, install_id: &str) -> Option<BTreeMap<String, String>> {
    std::fs::read_to_string(install_env_path(share_dir, install_id))
        .ok()
        .map(|t| parse_env(&t))
}

/// `<repo>/combinations/<COMBINATION>/benchmarks/<basename(pack)>/<run_id>/`
pub fn run_dir(repo: &Path, combination: &str, spec: &JobSpec) -> PathBuf {
    repo.join(COMBINATIONS_DIR)
        .join(combination)
        .join(BENCHMARKS_DIR)
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
    fn env_value_stops_at_the_closing_quote_or_whitespace() {
        // The real line from combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/config.sh.
        let env = parse_env(
            "INSTALL_ID=\"qwen38-27b\"                   # install dir, command prefix, service name\nBARE=word # note\nEMPTY=\n",
        );
        assert_eq!(env["INSTALL_ID"], "qwen38-27b");
        assert_eq!(env["BARE"], "word");
        assert_eq!(env["EMPTY"], "");
    }

    /// A throwaway repo with `combinations/` and a directory outside it.
    fn temp_repo(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("dbench-combo-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let combo = root.join("repo/combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode");
        std::fs::create_dir_all(&combo).unwrap();
        std::fs::write(
            combo.join(COMBINATION_CONFIG),
            "# settings\nINSTALL_ID=\"qwen38-27b\"   # install dir\nOUTPUT_LIMIT=32768\n",
        )
        .unwrap();
        let bad = root.join("repo/combinations/bad/id");
        std::fs::create_dir_all(&bad).unwrap();
        std::fs::write(bad.join(COMBINATION_CONFIG), "INSTALL_ID=\"a/../b\"\n").unwrap();
        let outside = root.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join(COMBINATION_CONFIG), "INSTALL_ID=\"escaped\"\n").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("repo/combinations/link")).unwrap();
        root
    }

    #[test]
    fn combination_is_found_by_its_directory() {
        let root = temp_repo("ok");
        let repo = root.join("repo");
        let want = RepoCombination {
            combination: "qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode".into(),
            install_id: "qwen38-27b".into(),
        };
        for given in [
            "qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode",
            "qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/",
            "combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/",
        ] {
            assert_eq!(repo_combination(&repo, given), Ok(want.clone()), "{given}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn combination_must_be_a_whole_directory_inside_the_repo() {
        let root = temp_repo("bad");
        let repo = root.join("repo");
        let outside = root.join("outside");
        for (given, why) in [
            ("", "is not a combination"),
            ("combinations", "no combination"),
            ("qwen/3.8", "has no config.sh"),
            ("qwen/3.9/27b", "no combination"),
            // Exists, has a config.sh, and is outside: only containment stops it.
            ("../../outside", "is not a combination"),
            (outside.to_str().unwrap(), "is not a combination"),
            ("link", "is not a combination"),
            ("bad/id", "invalid INSTALL_ID"),
        ] {
            let e = repo_combination(&repo, given).unwrap_err();
            assert!(e.contains(why), "{given:?}: {e}");
        }
        std::fs::remove_dir_all(&root).unwrap();
    }

    /// Every combination in this repo resolves: if a config.sh is ever written
    /// in a shape the parser can't read, this fails here rather than at submit.
    #[test]
    fn every_combination_in_this_repo_resolves() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let root = repo.join(COMBINATIONS_DIR);
        let mut found = 0;
        let mut stack = vec![root.clone()];
        while let Some(dir) = stack.pop() {
            if dir.join(COMBINATION_CONFIG).is_file() {
                let rel = dir.strip_prefix(&root).unwrap().to_str().unwrap().to_string();
                let got = repo_combination(&repo, &rel).unwrap_or_else(|e| panic!("{rel}: {e}"));
                assert_eq!(got.combination, rel);
                found += 1;
                continue; // a combination's own subdirectories are its benchmarks
            }
            for e in std::fs::read_dir(&dir).unwrap().flatten() {
                if e.file_type().unwrap().is_dir() {
                    stack.push(e.path());
                }
            }
        }
        assert!(found > 0, "no combinations under {}", root.display());
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
