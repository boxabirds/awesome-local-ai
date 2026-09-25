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
    let Some(rel) = dir
        .strip_prefix(&root)
        .ok()
        .filter(|r| !r.as_os_str().is_empty())
    else {
        return Err(format!(
            "{combination:?} is not a combination in {}",
            root.display()
        ));
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
        return Err(format!(
            "{}: invalid INSTALL_ID {install_id:?}",
            config.display()
        ));
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

/// The harness's live story and task status, rewritten atomically in the run dir.
/// Its shape is `benchmarks/vidi/harness/CONTROL.md`.
pub const PROGRESS_FILE: &str = "progress.json";
pub const METRICS_FILE: &str = "metrics.json";
pub const CURRENT_STORY_FILE: &str = "current_story";

/// A field of the harness's progress.json. Any field may be null, missing or of
/// an unexpected type; such a field reads as its default instead of failing the
/// whole file.
fn lenient<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    let v = serde_json::Value::deserialize(d)?;
    Ok(serde_json::from_value(v).unwrap_or_default())
}

/// A story id: a number in progress.json, a string key in metrics.json.
fn id_string<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(match serde_json::Value::deserialize(d)? {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    })
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Accept {
    #[serde(default, deserialize_with = "lenient")]
    pub passed: Option<u64>,
    #[serde(default, deserialize_with = "lenient")]
    pub total: Option<u64>,
}

/// One task of a story's plan, as the harness sees it in the workspace.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct TaskProgress {
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub n: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub title: Option<String>,
    #[serde(
        rename = "type",
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub kind: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub implements: Vec<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub tcs: Vec<String>,
    /// `not-started` | `written` | `committed` | `verified`.
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub found: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub total: Option<u64>,
}

/// The same story in an earlier run, for comparison.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Baseline {
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub source: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_minutes: Option<f64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub calls: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub output_tokens: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<String>,
}

/// A story of the run. From metrics.json only `id`, `title`, `passed` and
/// `total` are known; progress.json adds the rest. Times are Unix seconds.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct StoryProgress {
    #[serde(default, deserialize_with = "id_string")]
    pub id: String,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub title: Option<String>,
    /// Acceptance tests passed / total: from `accept`, else from metrics.json.
    #[serde(default, deserialize_with = "lenient")]
    pub passed: Option<u64>,
    #[serde(default, deserialize_with = "lenient")]
    pub total: Option<u64>,
    /// `pending` | `running` | `DONE` | `PARTIAL`.
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub status: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub ended_by: Option<String>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub reason: Option<String>,
    /// `green` | `amber` | `red`, on PARTIAL stories only.
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub verdict: Option<String>,
    /// Earlier PARTIAL stories this one was built on.
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub partial_base: Vec<serde_json::Value>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub started_at: Option<f64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub ended_at: Option<f64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_minutes: Option<f64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub calls: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub output_tokens: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub compactions: Option<u64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_commit_at: Option<f64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_task_change_at: Option<f64>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Option::is_none"
    )]
    pub accept: Option<Accept>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub tasks: Vec<TaskProgress>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub baselines: Vec<Baseline>,
    #[serde(
        default,
        deserialize_with = "lenient",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub recent_activity: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Progress {
    pub combination: Option<String>,
    pub run_dir: Option<String>,
    pub current_story: Option<String>,
    /// Every story in scope, in order, when the harness writes progress.json;
    /// otherwise only the finished ones (with an acceptance result) from metrics.json.
    pub stories: Vec<StoryProgress>,
    /// progress.json's `updated_at`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stories_updated_at: Option<f64>,
    pub log_tail: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Stories from a progress.json value, with `passed`/`total` taken from each
/// story's `accept`, or else from the same story in `finished` (metrics.json).
/// None if it isn't a JSON object.
pub fn progress_stories(
    progress: &serde_json::Value,
    finished: &[StoryProgress],
) -> Option<(Vec<StoryProgress>, Option<f64>)> {
    let obj = progress.as_object()?;
    let updated_at = obj.get("updated_at").and_then(|v| v.as_f64());
    let raw = obj.get("stories").and_then(|s| s.as_array());
    let stories = raw
        .into_iter()
        .flatten()
        .filter(|s| s.is_object())
        .filter_map(|s| serde_json::from_value::<StoryProgress>(s.clone()).ok())
        .map(|mut s| {
            let done = finished.iter().find(|f| f.id == s.id);
            let accept = s.accept.clone().unwrap_or_default();
            s.passed = accept.passed.or(done.and_then(|f| f.passed));
            s.total = accept.total.or(done.and_then(|f| f.total));
            if s.title.is_none() {
                s.title = done.and_then(|f| f.title.clone());
            }
            s
        })
        .collect();
    Some((stories, updated_at))
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
                ..Default::default()
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

/// The run dir of a job and the combination it is filed under: install.env's
/// COMBINATION, then `run_dir`.
pub fn resolve_run_dir(
    repo: &Path,
    share_dir: &Path,
    spec: &JobSpec,
) -> Result<(String, PathBuf), String> {
    let Some(env) = read_install_env(share_dir, &spec.install_id) else {
        return Err(format!(
            "{} not found",
            install_env_path(share_dir, &spec.install_id).display()
        ));
    };
    let Some(combination) = env.get("COMBINATION").cloned() else {
        return Err("install.env has no COMBINATION".into());
    };
    let dir = run_dir(repo, &combination, spec);
    Ok((combination, dir))
}

/// `<run_dir>/current_story`, trimmed. The harness leaves it empty between stories.
pub fn read_current_story(dir: &Path) -> Option<String> {
    std::fs::read_to_string(dir.join(CURRENT_STORY_FILE))
        .ok()
        .map(|s| s.trim().to_string())
}

pub fn compute(repo: &Path, share_dir: &Path, spec: &JobSpec, log: &Path) -> Progress {
    let mut p = Progress {
        log_tail: tail_lines(log, LOG_TAIL_LINES),
        ..Default::default()
    };
    let (combination, dir) = match resolve_run_dir(repo, share_dir, spec) {
        Ok(found) => found,
        Err(e) => {
            p.error = Some(e);
            return p;
        }
    };
    p.current_story = read_current_story(&dir);
    if let Ok(bytes) = std::fs::read(dir.join(METRICS_FILE)) {
        match serde_json::from_slice::<serde_json::Value>(&bytes) {
            Ok(v) => p.stories = finished_stories(&v),
            Err(e) => p.error = Some(format!("{METRICS_FILE}: {e}")),
        }
    }
    // Written atomically, so a parse error is a real fault: say so, and keep
    // the metrics.json stories.
    if let Ok(bytes) = std::fs::read(dir.join(PROGRESS_FILE)) {
        let parsed = serde_json::from_slice::<serde_json::Value>(&bytes)
            .map_err(|e| e.to_string())
            .and_then(|v| {
                progress_stories(&v, &p.stories).ok_or_else(|| "not a JSON object".to_string())
            });
        match parsed {
            Ok((stories, updated_at)) => {
                p.stories = stories;
                p.stories_updated_at = updated_at;
            }
            Err(e) => p.error = Some(format!("{PROGRESS_FILE}: {e}")),
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
                let rel = dir
                    .strip_prefix(&root)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_string();
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

    /// The example from benchmarks/vidi/harness/CONTROL.md, plus a finished and a pending story.
    const PROGRESS_JSON: &str = r#"{
      "updated_at": 1790302781.2,
      "scope": "canvas",
      "stories": [
        {"id": 2, "title": "Draw shapes", "status": "PARTIAL", "ended_by": "operator",
         "reason": "no commit for 107 min", "verdict": "amber", "partial_base": [],
         "started_at": 1790280000.0, "ended_at": 1790291500.0, "agent_minutes": 150.2,
         "calls": 400, "output_tokens": 300000, "compactions": 3,
         "accept": {"passed": 4, "total": 6}, "tasks": [], "baselines": [], "recent_activity": []},
        {
          "id": 3,
          "title": "See other people's edits appear live on the same board",
          "status": "running",
          "ended_by": null,
          "reason": null,
          "verdict": null,
          "partial_base": [2],
          "started_at": 1790291590.0,
          "ended_at": null,
          "agent_minutes": 187.4,
          "calls": 572,
          "output_tokens": 526585,
          "compactions": 8,
          "last_commit_at": 1790299920.0,
          "last_task_change_at": 1790299920.0,
          "accept": {"passed": 5, "total": 7},
          "tasks": [
            {"n": 8, "title": "E2E live collaboration with multiple browser contexts (TC-22 to TC-28)",
             "type": "test:e2e", "implements": ["sync.client"], "tcs": ["TC-22", "TC-23"],
             "status": "written", "found": 7, "total": 7}
          ],
          "baselines": [
            {"source": "qwen/3.8/flash-next/macos/128GB/mtplx-opencode canvas-pi-01",
             "agent_minutes": 58.4, "calls": 236, "output_tokens": 163933, "status": "DONE"}
          ],
          "recent_activity": ["bash: npx playwright test --config=playwright.nightly.config.ts …"]
        },
        {"id": 4, "title": "Undo", "status": "pending"}
      ]
    }"#;

    #[test]
    fn stories_from_progress_json() {
        let v: serde_json::Value = serde_json::from_str(PROGRESS_JSON).unwrap();
        let (s, updated_at) = progress_stories(&v, &[]).unwrap();
        assert_eq!(updated_at, Some(1790302781.2));
        assert_eq!(
            s.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            ["2", "3", "4"]
        );
        let run = &s[1];
        assert_eq!(run.status.as_deref(), Some("running"));
        assert_eq!((run.passed, run.total), (Some(5), Some(7)));
        assert_eq!(
            run.accept,
            Some(Accept {
                passed: Some(5),
                total: Some(7)
            })
        );
        assert_eq!(run.partial_base, [serde_json::json!(2)]);
        assert_eq!(
            (run.calls, run.output_tokens, run.compactions),
            (Some(572), Some(526585), Some(8))
        );
        assert_eq!(run.agent_minutes, Some(187.4));
        assert_eq!(run.last_commit_at, Some(1790299920.0));
        assert_eq!(run.ended_at, None);
        assert_eq!(
            run.tasks,
            [TaskProgress {
                n: Some(8),
                title: Some(
                    "E2E live collaboration with multiple browser contexts (TC-22 to TC-28)".into()
                ),
                kind: Some("test:e2e".into()),
                implements: vec!["sync.client".into()],
                tcs: vec!["TC-22".into(), "TC-23".into()],
                status: Some("written".into()),
                found: Some(7),
                total: Some(7),
            }]
        );
        assert_eq!(run.baselines[0].calls, Some(236));
        assert_eq!(run.baselines[0].status.as_deref(), Some("DONE"));
        assert_eq!(run.recent_activity.len(), 1);
        assert_eq!(s[0].verdict.as_deref(), Some("amber"));
        assert_eq!(s[0].reason.as_deref(), Some("no commit for 107 min"));

        // Served back: the task's "type" keeps its name, and empty or missing
        // fields are left out, so a pending story is as small as before.
        let out = serde_json::to_value(&s).unwrap();
        assert_eq!(out[1]["tasks"][0]["type"], "test:e2e");
        assert_eq!(
            out[2],
            serde_json::json!({"id": "4", "title": "Undo", "passed": null, "total": null, "status": "pending"})
        );
        // And the client reads what the server serves.
        let back: Vec<StoryProgress> = serde_json::from_value(out).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn progress_json_fields_are_optional_and_tolerant() {
        let finished = finished_stories(
            &serde_json::from_str(
                r#"{"stories":{"1":{"title":"from metrics","accept":{"passed":2,"total":3}}}}"#,
            )
            .unwrap(),
        );
        let v: serde_json::Value = serde_json::from_str(
            r#"{"stories": [
                 {"id": 1},
                 {"id": "2", "status": null, "calls": "many", "tasks": null, "accept": {"passed": 1},
                  "tasks": [{"n": 1, "status": "committed", "found": "x"}, {}], "partial_base": null},
                 "not a story",
                 {"title": "no id"}
               ]}"#,
        )
        .unwrap();
        let (s, updated_at) = progress_stories(&v, &finished).unwrap();
        assert_eq!(updated_at, None);
        assert_eq!(s.len(), 3);
        // Missing accept: passed/total and the title come from metrics.json.
        assert_eq!(s[0].title.as_deref(), Some("from metrics"));
        assert_eq!((s[0].passed, s[0].total), (Some(2), Some(3)));
        // Wrong types and nulls read as absent; the rest of the story survives.
        assert_eq!(s[1].id, "2");
        assert_eq!((s[1].status.as_ref(), s[1].calls), (None, None));
        assert_eq!((s[1].passed, s[1].total), (Some(1), None));
        assert_eq!(s[1].tasks.len(), 2);
        assert_eq!(s[1].tasks[0].found, None);
        assert_eq!(s[1].tasks[0].status.as_deref(), Some("committed"));
        assert!(s[1].partial_base.is_empty());
        assert_eq!(s[2].id, "");

        assert_eq!(
            progress_stories(&serde_json::json!({}), &[]),
            Some((vec![], None))
        );
        assert_eq!(progress_stories(&serde_json::json!([]), &[]), None);
    }

    /// A run dir with metrics.json, and progress.json when given.
    fn compute_with(tag: &str, progress_json: Option<&str>) -> Progress {
        let root =
            std::env::temp_dir().join(format!("dbench-progress-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let share = root.join("share");
        std::fs::create_dir_all(share.join("inst")).unwrap();
        std::fs::write(
            share.join("inst").join(INSTALL_ENV),
            "INSTALL_ID=\"inst\"\nCOMBINATION=\"a/b\"\n",
        )
        .unwrap();
        let spec = JobSpec {
            install_id: "inst".into(),
            combination: None,
            pack: "benchmarks/vidi".into(),
            scope: None,
            stories: None,
            run_id: "r1".into(),
            client: crate::job::AgentClient::Pi,
            record: false,
        };
        let repo = root.join("repo");
        let dir = run_dir(&repo, "a/b", &spec);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(CURRENT_STORY_FILE), "3\n").unwrap();
        std::fs::write(
            dir.join(METRICS_FILE),
            r#"{"stories":{"1":{"title":"one","accept":{"passed":3,"total":4}}}}"#,
        )
        .unwrap();
        if let Some(text) = progress_json {
            std::fs::write(dir.join(PROGRESS_FILE), text).unwrap();
        }
        let p = compute(&repo, &share, &spec, &root.join("no.log"));
        std::fs::remove_dir_all(&root).unwrap();
        p
    }

    #[test]
    fn compute_prefers_progress_json_and_falls_back_to_metrics() {
        let p = compute_with("full", Some(PROGRESS_JSON));
        assert_eq!(p.current_story.as_deref(), Some("3"));
        assert_eq!(p.stories.len(), 3);
        assert_eq!(p.stories_updated_at, Some(1790302781.2));
        assert_eq!(p.error, None);

        let p = compute_with("none", None);
        assert_eq!(p.stories.len(), 1);
        assert_eq!(
            (p.stories[0].id.as_str(), p.stories[0].passed),
            ("1", Some(3))
        );
        assert_eq!(p.stories_updated_at, None);
        assert_eq!(p.error, None);

        // Broken: say so, and keep what metrics.json has.
        let p = compute_with("broken", Some("{\"stories\": ["));
        assert_eq!(p.stories.len(), 1);
        assert!(
            p.error.as_deref().unwrap().starts_with("progress.json: "),
            "{p:?}"
        );
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
