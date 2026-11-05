//! Test support (story 23): a scratch lake as dbench leaves it, for the gallery's readers. Run folders under
//! `collected/<node>/<id>/` (or `reference/...`) with run.json and metrics.json, and real code in `code.git`: one
//! commit per story, the branch under `refs/runs/<node>/<id>/heads/main` and each story's commit under
//! `refs/runs/<node>/<id>/story/NN`. Git is real.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

pub const NODE: &str = "node-t";
/// A combination vidi run id (the nine levels bench-lake accepts) and its setup and run names in the gallery.
pub const COMBO_ID: &str = "combinations/q/1/s/os/hw/eng-cli/benchmarks/vidi/r1";
pub const COMBO_SETUP: &str = "q/1/s/os/hw/eng-cli";
pub const COMBO_SLUG: &str = "q_1_s_os_hw_eng-cli_r1";
pub const REFERENCE_ID: &str = "benchmarks/reference/vidi/opus-5.5/v2-r1";
const REFERENCE_PREFIX: &str = "benchmarks/reference/";

pub struct TestLake {
    pub root: PathBuf,
    pub state: PathBuf,
    pub lake: bench_lake::Lake,
}

pub fn git(dir: &Path, args: &[&str]) -> String {
    let out = std::process::Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main"])
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

impl TestLake {
    pub fn new(tag: &str) -> TestLake {
        static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("vidi-gallery-lake-{tag}-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let state = root.join("state");
        std::fs::create_dir_all(state.join("collected")).unwrap();
        std::fs::create_dir_all(state.join("reference")).unwrap();
        git(&state, &["init", "-q", "--bare", "code.git"]);
        let lake = bench_lake::Lake::in_state_dir(&state);
        TestLake { root, state, lake }
    }

    fn node_of(node: Option<&str>) -> &str {
        node.unwrap_or(bench_lake::code::REFERENCE_NODE)
    }

    /// The run's folder in the lake, with run.json and `metrics`.
    pub fn add_run(&self, node: Option<&str>, id: &str, metrics: Value) -> PathBuf {
        let dir = match id.strip_prefix(REFERENCE_PREFIX) {
            Some(rest) => self.state.join("reference").join(rest),
            None => self.state.join("collected").join(node.expect("a combination copy is under a node")).join(id),
        };
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("run.json"), json!({"pack_version": "vidi-v2.0-pre2"}).to_string()).unwrap();
        std::fs::write(dir.join("metrics.json"), metrics.to_string()).unwrap();
        dir
    }

    /// The run's code: a repository with one commit per story (each adds `story-NN.txt`), taken into code.git with a
    /// story ref per story. Returns each story's commit.
    pub fn add_code(&self, node: Option<&str>, id: &str, stories: &[u64]) -> BTreeMap<u64, String> {
        let src = self.root.join("src").join(format!("{}@{}", Self::node_of(node), id.replace('/', "_")));
        std::fs::create_dir_all(&src).unwrap();
        git(&src, &["init", "-q"]);
        let mut commits = BTreeMap::new();
        for &story in stories {
            std::fs::write(src.join(format!("story-{story:02}.txt")), format!("{story}\n")).unwrap();
            git(&src, &["add", "-A"]);
            git(&src, &["commit", "-q", "-m", &format!("story {story}")]);
            commits.insert(story, git(&src, &["rev-parse", "HEAD"]));
        }
        let code = self.state.join("code.git");
        let node = Self::node_of(node);
        let heads = bench_lake::code::head_ref(node, id, "*");
        git(&code, &["fetch", "-q", "--no-tags", src.to_str().unwrap(), &format!("+refs/heads/*:{heads}")]);
        for (story, commit) in &commits {
            git(&code, &["update-ref", &bench_lake::code::story_ref(node, id, *story as u32), commit]);
        }
        commits
    }

    /// The operator's decision about a run, in the lake's annotation store (as `bench-lake annotate set` writes it).
    pub fn decide(&self, kind: bench_lake::annotations::Kind, id: &str) {
        let req = bench_lake::annotations::Request {
            op: bench_lake::annotations::Op::Set, kind, run: id.to_string(), story: None, reason: "test".into(), by: "test".into(),
        };
        bench_lake::annotations::Store::in_state_dir(&self.state).append(&req, &bench_lake::annotations::utc_now()).unwrap();
    }

    /// metrics.json naming each story's commit, as the harness records it.
    pub fn metrics_for(commits: &BTreeMap<u64, String>) -> Value {
        json!({"stories": commits.iter().map(|(s, c)| (s.to_string(), json!({"commit": c}))).collect::<serde_json::Map<_, _>>()})
    }
}

impl Drop for TestLake {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}
