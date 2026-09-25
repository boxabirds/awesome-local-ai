//! Every recorded Vidi run in the repo, with its final held-out score, its audit (judging) and its
//! cost. Pure reads of the committed records; missing data is `None`, never an error.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

/// Folders never searched for runs: build output, dependencies, per-story records, git internals.
const SKIP_DIRS: &[&str] = &["workspace", "node_modules", "stories", ".git", "target", "dist"];
/// How deep under combinations/ a run can be (combination path + benchmarks/vidi/<run>).
const MAX_DEPTH: usize = 12;
/// A test that failed because the scoring machine had no browser: the score says nothing.
const VOID_MARKER: &str = "Executable doesn't exist";
const SECONDS_PER_MINUTE: f64 = 60.0;
const SEVERITIES: [&str; 3] = ["high", "medium", "low"];

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct StoryScore {
    pub story: String,
    pub passed: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Score {
    pub passed: Option<u64>,
    pub total: Option<u64>,
    pub by_story: Vec<StoryScore>,
    /// The machine couldn't score it (e.g. no browser): the numbers are meaningless.
    pub void: bool,
    /// Which file the score came from, relative to the run folder.
    pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Judging {
    pub rows: usize,
    pub functional: BTreeMap<String, usize>,
    pub by_category: BTreeMap<String, usize>,
    pub own_way: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct Cost {
    pub agent_minutes: Option<f64>,
    pub calls: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Run {
    /// Unique, URL- and file-safe: the setup and run joined with "__".
    pub slug: String,
    pub setup: String,
    pub run: String,
    #[serde(skip)]
    pub path: PathBuf,
    pub stories_finished: usize,
    pub stories_in_scope: Option<usize>,
    pub in_progress: bool,
    pub score: Score,
    pub judging: Option<Judging>,
    pub cost: Cost,
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&std::fs::read_to_string(p).ok()?).ok()
}

pub fn slug(setup: &str, run: &str) -> String {
    format!("{setup}/{run}")
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' })
        .collect()
}

/// Run folders: `combinations/**/benchmarks/vidi/<run>/` and `benchmarks/reference/vidi/<stack>/<run>/`
/// that have both a metrics.json and a workspace/.
pub fn discover(repo: &Path) -> Vec<(String, String, PathBuf)> {
    let mut out = Vec::new();
    let combos = repo.join("combinations");
    walk(&combos, 0, &mut |dir| {
        let parent = dir.parent();
        if dir.file_name().is_some_and(|n| n == "vidi")
            && parent.and_then(|p| p.file_name()).is_some_and(|n| n == "benchmarks")
        {
            let setup = parent
                .and_then(|p| p.parent())
                .and_then(|c| c.strip_prefix(&combos).ok())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            for run in run_dirs(dir) {
                out.push((setup.clone(), name(&run), run));
            }
            return false;
        }
        true
    });
    let reference = repo.join("benchmarks/reference/vidi");
    for stack in subdirs(&reference) {
        for run in run_dirs(&stack) {
            out.push((format!("reference/{}", name(&stack)), name(&run), run));
        }
    }
    out.sort();
    out
}

fn name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    v.sort();
    v
}

fn run_dirs(dir: &Path) -> Vec<PathBuf> {
    subdirs(dir).into_iter().filter(|r| r.join("metrics.json").is_file() && r.join("workspace").is_dir()).collect()
}

/// Depth-first walk; `visit` returns false to stop descending into that folder.
fn walk(dir: &Path, depth: usize, visit: &mut dyn FnMut(&Path) -> bool) {
    if depth > MAX_DEPTH || !visit(dir) {
        return;
    }
    for sub in subdirs(dir) {
        if !SKIP_DIRS.iter().any(|s| sub.file_name().is_some_and(|n| n == *s)) {
            walk(&sub, depth + 1, visit);
        }
    }
}

/// The final held-out result: accept-final.json, else the last story's accept.json (the whole suite
/// run after it), else the run-level accept.json (a build scored once at the end).
pub fn score(run: &Path) -> Score {
    let last_story = subdirs(&run.join("stories"))
        .into_iter()
        .filter(|d| d.join("accept.json").is_file())
        .max_by_key(|d| name(d).parse::<u64>().unwrap_or(0))
        .map(|d| d.join("accept.json"));
    let candidates = [Some(run.join("accept-final.json")), last_story, Some(run.join("accept.json"))];
    for file in candidates.into_iter().flatten() {
        if let Some(doc) = read_json(&file) {
            return score_from(&doc, file.strip_prefix(run).ok().map(|p| p.to_string_lossy().to_string()));
        }
    }
    Score::default()
}

pub fn score_from(doc: &Value, source: Option<String>) -> Score {
    let mut by_story: Vec<StoryScore> = doc
        .get("by_story")
        .and_then(Value::as_object)
        .map(|m| {
            m.iter()
                .map(|(k, v)| StoryScore {
                    story: k.clone(),
                    passed: v.get("passed").and_then(Value::as_u64).unwrap_or(0),
                    total: v.get("total").and_then(Value::as_u64).unwrap_or(0),
                })
                .collect()
        })
        .unwrap_or_default();
    by_story.sort_by_key(|s| s.story.parse::<u64>().unwrap_or(u64::MAX));
    Score {
        passed: doc.get("passed").and_then(Value::as_u64),
        total: doc.get("total").and_then(Value::as_u64),
        by_story,
        void: is_void(doc),
        source,
    }
}

pub fn is_void(doc: &Value) -> bool {
    if doc.get("harness_fault").is_some_and(|f| !f.is_null()) {
        return true;
    }
    doc.get("tests").and_then(Value::as_array).is_some_and(|tests| {
        tests.iter().any(|t| t.get("error").and_then(Value::as_str).is_some_and(|e| e.contains(VOID_MARKER)))
    })
}

/// Audit rows (one JSON object per line); only rows that count: status "counted" or none.
pub fn judging(jsonl: &str) -> Judging {
    let mut j = Judging::default();
    for sev in SEVERITIES {
        j.functional.insert(sev.to_string(), 0);
    }
    for row in jsonl.lines().filter(|l| !l.trim().is_empty()).filter_map(|l| serde_json::from_str::<Value>(l).ok()) {
        if row.get("status").and_then(Value::as_str).is_some_and(|s| s != "counted") {
            continue;
        }
        j.rows += 1;
        let cat = row.get("category").and_then(Value::as_str).unwrap_or("?").to_string();
        if cat == "functional" {
            let sev = row.get("severity").and_then(Value::as_str).unwrap_or("?").to_string();
            *j.functional.entry(sev).or_default() += 1;
        }
        *j.by_category.entry(cat).or_default() += 1;
        if let Some(w) = row.get("own_way").and_then(Value::as_str) {
            *j.own_way.entry(w.to_string()).or_default() += 1;
        }
    }
    j
}

/// Time, model calls and output tokens over finished stories, in either metrics format:
/// the harness's (`agent.seconds`, `agent.steps`, `agent.tokens.output`) or a subagent build's
/// (`agent_minutes`, `api_calls`, `output_tokens`).
pub fn cost(metrics: &Value) -> (Cost, usize) {
    let stories: Vec<&Value> = metrics
        .get("stories")
        .and_then(Value::as_object)
        .map(|m| m.values().filter(|s| s.get("finished").is_some_and(|f| !f.is_null() && f != &Value::Bool(false))).collect())
        .unwrap_or_default();
    let mut c = Cost::default();
    for s in &stories {
        let agent = s.get("agent");
        let minutes = s
            .get("agent_minutes")
            .and_then(Value::as_f64)
            .or_else(|| agent.and_then(|a| a.get("seconds")).and_then(Value::as_f64).map(|x| x / SECONDS_PER_MINUTE));
        let calls = agent.and_then(|a| a.get("steps")).and_then(Value::as_u64).or_else(|| s.get("api_calls").and_then(Value::as_u64));
        let out = agent
            .and_then(|a| a.get("tokens"))
            .and_then(|t| t.get("output"))
            .and_then(Value::as_u64)
            .or_else(|| s.get("output_tokens").and_then(Value::as_u64));
        if let Some(m) = minutes {
            *c.agent_minutes.get_or_insert(0.0) += m;
        }
        if let Some(n) = calls {
            *c.calls.get_or_insert(0) += n;
        }
        if let Some(n) = out {
            *c.output_tokens.get_or_insert(0) += n;
        }
    }
    (c, stories.len())
}

/// Number of stories in a scope, from the private pack (next to the repo) or an in-repo copy.
pub fn scope_size(repo: &Path, scope: &str) -> Option<usize> {
    let candidates = [
        repo.parent().map(|p| p.join("awesome-local-ai-bench-private/packs/vidi/scope").join(format!("{scope}.json"))),
        Some(repo.join("benchmarks/vidi/scope").join(format!("{scope}.json"))),
    ];
    candidates
        .into_iter()
        .flatten()
        .find_map(|p| read_json(&p))
        .and_then(|d| d.get("stories").and_then(Value::as_array).map(Vec::len))
}

pub fn load(repo: &Path) -> Vec<Run> {
    discover(repo)
        .into_iter()
        .map(|(setup, run, path)| {
            let metrics = read_json(&path.join("metrics.json")).unwrap_or(Value::Null);
            let (cost, finished) = cost(&metrics);
            let scope = metrics.get("scope").and_then(Value::as_str).unwrap_or("canvas");
            let in_scope = scope_size(repo, scope);
            let status_finished = read_json(&path.join("run-status.json"))
                .and_then(|s| s.get("state").and_then(Value::as_str).map(|x| x == "finished"))
                .unwrap_or(false);
            Run {
                slug: slug(&setup, &run),
                in_progress: !status_finished && in_scope.is_some_and(|n| finished < n),
                stories_finished: finished,
                stories_in_scope: in_scope,
                score: score(&path),
                judging: std::fs::read_to_string(path.join("audit.jsonl")).ok().map(|t| judging(&t)),
                cost,
                setup,
                run,
                path,
            }
        })
        .collect()
}

// ---------- independent judges ----------

#[derive(Debug, Clone, Serialize)]
pub struct JudgeResult {
    pub package: String,
    pub judge: String,
    pub letter: String,
    /// The build's name from the key, or None while the key isn't on this machine (still blinded).
    pub build: Option<String>,
    pub judging: Judging,
}

/// Results pushed by judge-submit.sh: `<private>/gradings/<package>/results/<judge>/build-{A,B}.jsonl`,
/// un-blinded with `<keys>/<package>.json` where that key exists.
pub fn judges(private_repo: &Path, keys: &Path) -> Vec<JudgeResult> {
    let mut out = Vec::new();
    for package in subdirs(&private_repo.join("gradings")) {
        let key = read_json(&keys.join(format!("{}.json", name(&package))));
        for judge in subdirs(&package.join("results")) {
            for letter in ["A", "B"] {
                if let Ok(text) = std::fs::read_to_string(judge.join(format!("build-{letter}.jsonl"))) {
                    out.push(JudgeResult {
                        package: name(&package),
                        judge: name(&judge),
                        letter: letter.into(),
                        build: key.as_ref().and_then(|k| k.get(letter)).and_then(Value::as_str).map(String::from),
                        judging: judging(&text),
                    });
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("vidi-gallery-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write(p: &Path, v: &Value) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, v.to_string()).unwrap();
    }

    #[test]
    fn runs_are_discovered_in_combinations_and_reference_stacks() {
        let repo = tmp("discover");
        let a = repo.join("combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/benchmarks/vidi/canvas-pi-01");
        let b = repo.join("benchmarks/reference/vidi/opus-5.5/run-1");
        let no_ws = repo.join("combinations/x/benchmarks/vidi/smoke");
        for d in [&a, &b] {
            write(&d.join("metrics.json"), &json!({"stories": {}}));
            std::fs::create_dir_all(d.join("workspace")).unwrap();
        }
        write(&no_ws.join("metrics.json"), &json!({}));
        let found = discover(&repo);
        assert_eq!(
            found.iter().map(|(s, r, _)| (s.as_str(), r.as_str())).collect::<Vec<_>>(),
            vec![("qwen/3.8/flash-next/macos/128GB/mtplx-opencode", "canvas-pi-01"), ("reference/opus-5.5", "run-1")]
        );
    }

    #[test]
    fn the_final_score_prefers_accept_final_then_the_last_story_then_the_run() {
        let run = tmp("score");
        write(&run.join("stories/03/accept.json"), &json!({"passed": 20, "total": 27, "by_story": {"01": {"passed": 10, "total": 10}}}));
        write(&run.join("stories/12/accept.json"), &json!({"passed": 62, "total": 75, "by_story": {"12": {"passed": 1, "total": 5}, "02": {"passed": 9, "total": 10}}}));
        let s = score(&run);
        assert_eq!((s.passed, s.total, s.source.as_deref()), (Some(62), Some(75), Some("stories/12/accept.json")));
        assert_eq!(s.by_story.iter().map(|b| b.story.as_str()).collect::<Vec<_>>(), vec!["02", "12"]);
        write(&run.join("accept-final.json"), &json!({"passed": 71, "total": 75}));
        assert_eq!(score(&run).passed, Some(71));
        let only_run = tmp("score-run");
        write(&only_run.join("accept.json"), &json!({"passed": 71, "total": 75}));
        assert_eq!(score(&only_run).source.as_deref(), Some("accept.json"));
        assert_eq!(score(&tmp("score-none")), Score::default());
    }

    #[test]
    fn void_scores_are_flagged() {
        assert!(is_void(&json!({"harness_fault": "Playwright's browser is missing"})));
        assert!(is_void(&json!({"tests": [{"error": "browserType.launch: Executable doesn't exist at ~/x"}]})));
        assert!(!is_void(&json!({"harness_fault": null, "tests": [{"error": "net::ERR_CONNECTION_REFUSED"}]})));
    }

    #[test]
    fn judging_counts_only_counted_rows() {
        let rows = [
            json!({"category": "functional", "severity": "high", "own_way": "works"}),
            json!({"category": "functional", "severity": "medium", "status": "counted"}),
            json!({"category": "weak-test", "severity": "low"}),
            json!({"category": "functional", "severity": "high", "status": "fixed-later"}),
        ];
        let j = judging(&rows.iter().map(Value::to_string).collect::<Vec<_>>().join("\n"));
        assert_eq!(j.rows, 3);
        assert_eq!(j.functional.get("high"), Some(&1));
        assert_eq!(j.functional.get("medium"), Some(&1));
        assert_eq!(j.by_category.get("weak-test"), Some(&1));
        assert_eq!(j.own_way.get("works"), Some(&1));
    }

    #[test]
    fn cost_reads_both_metrics_formats() {
        let harness = json!({"stories": {"1": {"finished": 1.0, "agent": {"seconds": 600.0, "steps": 20, "tokens": {"output": 1000}}},
                                         "2": {"started": 1.0}}});
        let (c, n) = cost(&harness);
        assert_eq!((n, c.agent_minutes, c.calls, c.output_tokens), (1, Some(10.0), Some(20), Some(1000)));
        let subagent = json!({"stories": {"3": {"finished": 2.0, "agent_minutes": 22.1, "api_calls": 62, "output_tokens": 94890}}});
        let (c, _) = cost(&subagent);
        assert_eq!((c.agent_minutes, c.calls, c.output_tokens), (Some(22.1), Some(62), Some(94890)));
    }

    #[test]
    fn independent_judges_are_unblinded_only_with_a_key() {
        let private = tmp("judges");
        let keys = tmp("keys");
        let dir = private.join("gradings/vidi-v1/results/gpt-5.6");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("build-A.jsonl"), json!({"category": "functional", "severity": "low"}).to_string()).unwrap();
        let blinded = judges(&private, &keys);
        assert_eq!((blinded.len(), blinded[0].build.clone()), (1, None));
        write(&keys.join("vidi-v1.json"), &json!({"A": "opus", "B": "flash-next"}));
        assert_eq!(judges(&private, &keys)[0].build.as_deref(), Some("opus"));
    }
}
