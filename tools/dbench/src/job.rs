//! Job spec, job state, and the idempotent-submit rule.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::ids::{valid_id, valid_pack, valid_run_dir};

/// Repo-relative path of the generic harness. When it exists it takes the pack
/// as `--pack`; otherwise each pack carries its own `harness/run.sh`.
pub const SPEC_BENCH_ENTRY: &str = "benchmarks/spec-bench/harness/run.sh";
/// Path of a pack's own entry point, relative to the pack directory.
pub const PACK_ENTRY: &str = "harness/run.sh";
/// What a partial rerun reads from the run it starts from (drive.py known_good_base): the run's
/// whole workspace history, and its record, which names the commit each story ended on.
pub const REFERENCE_BUNDLE: &str = "workspace.bundle";
pub const REFERENCE_METRICS: &str = "metrics.json";

/// Environment a job may set for its harness, and through it the model server
/// run.sh starts: which GPU backend a multi-backend build runs on, and the
/// speculation and profile settings the launchers read at run time. Only these
/// keys, each with its values checked, so a job still names what it runs and
/// can't reach PATH, LD_PRELOAD or the like.
pub const SERVER_ENV_KEYS: [&str; 5] = [
    "GPU_BACKEND",
    "SPEC_MTP",
    "SPEC_DRAFT_N_MAX",
    "SPEC_DRAFT_P_MIN",
    "PROFILE",
];
pub const GPU_BACKENDS: [&str; 2] = ["vulkan", "rocm"];
pub const MAX_DRAFT_N: u32 = 16;

fn valid_server_env(key: &str, value: &str) -> Result<(), String> {
    let ok = match key {
        "GPU_BACKEND" => GPU_BACKENDS.contains(&value),
        "SPEC_MTP" => value == "0" || value == "1",
        "SPEC_DRAFT_N_MAX" => value
            .parse::<u32>()
            .is_ok_and(|n| (1..=MAX_DRAFT_N).contains(&n)),
        "SPEC_DRAFT_P_MIN" => {
            value.chars().all(|c| c.is_ascii_digit() || c == '.')
                && value.parse::<f64>().is_ok_and(|p| (0.0..=1.0).contains(&p))
        }
        "PROFILE" => valid_id(value),
        _ => {
            return Err(format!(
                "server_env key {key:?} is not allowed (allowed: {})",
                SERVER_ENV_KEYS.join(", ")
            ))
        }
    };
    if ok {
        Ok(())
    } else {
        Err(format!("invalid server_env value {key}={value:?}"))
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentClient {
    Pi,
    Opencode,
    /// Claude Code headless (cloud model); the node needs `claude` on PATH and a subscription token.
    Claude,
}

impl AgentClient {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentClient::Pi => "pi",
            AgentClient::Opencode => "opencode",
            AgentClient::Claude => "claude",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct JobSpec {
    /// The install to run, as `<share-dir>/<install-id>/install.env` names it.
    /// Either this or `combination`.
    #[serde(default)]
    pub install_id: String,
    /// Input alias for `install_id`: a combination's directory under
    /// `<repo>/combinations/`, whose config.sh sets the install id. The node
    /// resolves it at submit time and clears it, so a stored spec is always
    /// keyed by install id however it was submitted -- which keeps the two
    /// forms idempotent with each other.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combination: Option<String>,
    pub pack: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    /// Passed to the harness as `--only 1,2,...`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stories: Option<Vec<u32>>,
    pub run_id: String,
    pub client: AgentClient,
    pub record: bool,
    /// Set in the harness's environment (see SERVER_ENV_KEYS). Part of the
    /// job's identity: the same id with a different server_env is a conflict.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub server_env: BTreeMap<String, String>,
    /// A partial rerun: a finished run to start from, as a run directory relative to the repo
    /// (e.g. `combinations/…/benchmarks/vidi/v2-r1`). The harness runs `stories` on that run's code
    /// as it was when the story before ended (`--from-run`). Part of the job's identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_run: Option<String>,
    /// With `from_run`: run this story and every later story of the scope, each built on the one
    /// before in this run (`--from-story`), instead of `stories`. Part of the job's identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_story: Option<u32>,
}

impl JobSpec {
    /// Checks that only depend on the spec itself (no filesystem).
    pub fn validate(&self) -> Result<(), String> {
        match (self.install_id.as_str(), self.combination.as_deref()) {
            ("", None | Some("")) => return Err("give install_id or combination".into()),
            (id, Some(c)) if !id.is_empty() => {
                return Err(format!(
                    "give install_id or combination, not both (got {id:?} and {c:?})"
                ))
            }
            (id, None) if !valid_id(id) => return Err(format!("invalid install_id {id:?}")),
            // A combination is a path; the node checks it against its repo checkout.
            _ => {}
        }
        if !valid_id(&self.run_id) {
            return Err(format!("invalid run_id {:?}", self.run_id));
        }
        if !valid_pack(&self.pack) {
            return Err(format!(
                "invalid pack {:?} (a repo-relative directory)",
                self.pack
            ));
        }
        if let Some(scope) = &self.scope {
            if !valid_id(scope) {
                return Err(format!("invalid scope {scope:?}"));
            }
        }
        if let Some(stories) = &self.stories {
            if stories.is_empty() || stories.contains(&0) {
                return Err("stories must be a non-empty list of story numbers from 1".into());
            }
        }
        for (k, v) in &self.server_env {
            valid_server_env(k, v)?;
        }
        if let Some(from_run) = &self.from_run {
            if !valid_run_dir(from_run) {
                return Err(format!(
                    "invalid from_run {from_run:?} (a run directory relative to the repo, without `..`)"
                ));
            }
            // Which stories, and how many, is the harness's rule; that there are some is ours.
            if self.stories.is_none() && self.from_story.is_none() {
                return Err("from_run needs stories (--stories: the stories to run on the reference run's \
                            code) or from_story (--from-story: that story and every later one)"
                    .into());
            }
        }
        if let Some(n) = self.from_story {
            if n == 0 {
                return Err("from_story must be a story number from 1".into());
            }
            if self.from_run.is_none() {
                return Err("from_story needs from_run (--from-run): the finished run whose code the stories build on".into());
            }
            if self.stories.is_some() {
                return Err("from_story is for story N and every later one; it cannot be given with stories (--stories)".into());
            }
        }
        Ok(())
    }

    /// `basename(pack)`: the benchmark's directory name under a combination.
    pub fn pack_name(&self) -> &str {
        self.pack.rsplit('/').next().unwrap_or(&self.pack)
    }
}

/// The harness entry point for a pack in a repo, and the arguments that go
/// before the common ones.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub script: PathBuf,
    pub uses_pack_flag: bool,
}

pub fn resolve_entry(repo: &Path, pack: &str) -> Option<Entry> {
    let generic = repo.join(SPEC_BENCH_ENTRY);
    if generic.is_file() {
        return Some(Entry {
            script: generic,
            uses_pack_flag: true,
        });
    }
    let own = repo.join(pack).join(PACK_ENTRY);
    own.is_file().then_some(Entry {
        script: own,
        uses_pack_flag: false,
    })
}

/// Why a reference run can't be started from, or None when it has what a partial rerun reads.
/// `from_run` is relative to `results_root`, the node's checkout: a finished run is a result, and a
/// harness release's own directory holds none.
pub fn reference_run_problem(results_root: &Path, from_run: &str) -> Option<String> {
    let dir = results_root.join(from_run);
    let root = results_root.display();
    let (Ok(real_root), Ok(real_dir)) = (results_root.canonicalize(), dir.canonicalize()) else {
        return Some(format!("reference run {from_run}: no such directory in {root}"));
    };
    if !real_dir.is_dir() {
        return Some(format!("reference run {from_run}: no such directory in {root}"));
    }
    if !real_dir.starts_with(&real_root) {
        return Some(format!("reference run {from_run} is outside {root}"));
    }
    let missing: Vec<&str> = [REFERENCE_BUNDLE, REFERENCE_METRICS]
        .into_iter()
        .filter(|f| !real_dir.join(f).is_file())
        .collect();
    if missing.is_empty() {
        return None;
    }
    Some(format!(
        "reference run {from_run} has no {}: a job can only start from a finished run that kept them",
        missing.join(" and no ")
    ))
}

/// Arguments for `bash`:
/// `<run.sh> <install_id> [--pack P] --run-id R [--scope X] [--only 1,2] [--from-run DIR [--from-story N]] --client C [--record]`.
/// The reference run is given as an absolute path in `results_root` (the node's checkout), so it
/// names the same directory whether the harness runs from that checkout or from a release.
pub fn harness_args(entry: &Entry, spec: &JobSpec, results_root: &Path) -> Vec<OsString> {
    let mut a: Vec<OsString> = vec![entry.script.clone().into(), spec.install_id.clone().into()];
    if entry.uses_pack_flag {
        a.push("--pack".into());
        a.push(spec.pack.clone().into());
    }
    a.push("--run-id".into());
    a.push(spec.run_id.clone().into());
    if let Some(scope) = &spec.scope {
        a.push("--scope".into());
        a.push(scope.clone().into());
    }
    if let Some(stories) = &spec.stories {
        let list: Vec<String> = stories.iter().map(u32::to_string).collect();
        a.push("--only".into());
        a.push(list.join(",").into());
    }
    if let Some(from_run) = &spec.from_run {
        a.push("--from-run".into());
        a.push(results_root.join(from_run).into());
    }
    if let Some(n) = spec.from_story {
        a.push("--from-story".into());
        a.push(n.to_string().into());
    }
    a.push("--client".into());
    a.push(spec.client.as_str().into());
    if spec.record {
        a.push("--record".into());
    }
    a
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum JobState {
    Queued,
    Running {
        pid: i32,
        pgid: i32,
        attempt: u32,
        started_at: u64,
        /// Boot time of the machine when the job started, so a recycled pid
        /// after a reboot is not mistaken for the job.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        boot_time: Option<u64>,
    },
    Done {
        exit_code: i32,
    },
    Failed {
        reason: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
    Cancelled,
}

impl JobState {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            JobState::Done { .. } | JobState::Failed { .. } | JobState::Cancelled
        )
    }

    pub fn label(&self) -> &'static str {
        match self {
            JobState::Queued => "queued",
            JobState::Running { .. } => "running",
            JobState::Done { .. } => "done",
            JobState::Failed { .. } => "failed",
            JobState::Cancelled => "cancelled",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Note {
    pub at: u64,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct PullRecord {
    pub at: u64,
    pub ok: bool,
    pub detail: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Job {
    pub id: String,
    pub spec: JobSpec,
    pub state: JobState,
    /// How many times the harness has been started for this job.
    pub attempt: u32,
    pub submitted_at: u64,
    /// Submission order on this node: jobs submitted in the same second keep their order, also
    /// after a server restart (0 for jobs submitted before this field existed).
    #[serde(default)]
    pub seq: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub cancel_requested: bool,
    /// Why it was cancelled, as the canceller gave it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_pull: Option<PullRecord>,
    /// The harness the job runs, chosen at its first start and kept for every restart: a run never
    /// changes harness part-way. None until it starts (and for jobs from before releases).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harness: Option<crate::harness::Harness>,
    /// Server-side interventions: restarts, recoveries, cancels, pull failures.
    #[serde(default)]
    pub history: Vec<Note>,
    /// The last failed attempt that was restarted: the next failure is compared with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_failure: Option<crate::failure::FailureMark>,
}

impl Job {
    pub fn new(id: String, spec: JobSpec, now: u64) -> Job {
        Job {
            id,
            spec,
            state: JobState::Queued,
            attempt: 0,
            submitted_at: now,
            seq: 0,
            updated_at: now,
            cancel_requested: false,
            cancel_reason: None,
            last_pull: None,
            harness: None,
            history: Vec::new(),
            last_failure: None,
        }
    }

    pub fn note(&mut self, now: u64, text: impl Into<String>) {
        self.history.push(Note {
            at: now,
            text: text.into(),
        });
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitOutcome {
    /// New id: create and queue it (201).
    Create,
    /// Same id, same spec: return the existing job (200).
    Existing,
    /// Same id, different spec (409).
    Conflict,
}

pub fn submit_decision(existing: Option<&JobSpec>, new: &JobSpec) -> SubmitOutcome {
    match existing {
        None => SubmitOutcome::Create,
        Some(old) if old == new => SubmitOutcome::Existing,
        Some(_) => SubmitOutcome::Conflict,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn spec() -> JobSpec {
        JobSpec {
            install_id: "mtplx-qwen38-27b".into(),
            combination: None,
            pack: "benchmarks/vidi".into(),
            scope: Some("canvas".into()),
            stories: None,
            run_id: "canvas-pi-01".into(),
            client: AgentClient::Pi,
            record: true,
            server_env: Default::default(),
            from_run: None,
            from_story: None,
        }
    }

    const RESULTS_ROOT: &str = "/node/checkout";
    const REFERENCE_RUN: &str = "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r3";

    fn known_good() -> JobSpec {
        let mut s = spec();
        s.stories = Some(vec![2]);
        s.from_run = Some(REFERENCE_RUN.into());
        s
    }

    fn args_of(entry: &Entry, spec: &JobSpec) -> Vec<String> {
        harness_args(entry, spec, Path::new(RESULTS_ROOT))
            .into_iter()
            .map(|a| a.into_string().unwrap())
            .collect()
    }

    #[test]
    fn a_spec_round_trips_with_and_without_a_reference_run() {
        let plain = spec();
        let text = serde_json::to_string(&plain).unwrap();
        assert!(!text.contains("from_run"), "{text}");
        assert_eq!(serde_json::from_str::<JobSpec>(&text).unwrap(), plain);
        // A spec stored before the field existed is a job with no reference run.
        let old: JobSpec = serde_json::from_str(
            r#"{"install_id":"x","pack":"p","run_id":"r","client":"pi","record":true}"#,
        )
        .unwrap();
        assert_eq!(old.from_run, None);

        let kg = known_good();
        let text = serde_json::to_string(&kg).unwrap();
        assert!(text.contains(&format!(r#""from_run":"{REFERENCE_RUN}""#)), "{text}");
        let back: JobSpec = serde_json::from_str(&text).unwrap();
        assert_eq!(back, kg);
        assert_eq!(back.validate(), Ok(()));
    }

    #[test]
    fn the_reference_run_reaches_the_harness_as_a_path_in_the_results_checkout() {
        let generic = Entry {
            script: "/release/benchmarks/spec-bench/harness/run.sh".into(),
            uses_pack_flag: true,
        };
        assert_eq!(
            args_of(&generic, &known_good()),
            [
                "/release/benchmarks/spec-bench/harness/run.sh",
                "mtplx-qwen38-27b",
                "--pack",
                "benchmarks/vidi",
                "--run-id",
                "canvas-pi-01",
                "--scope",
                "canvas",
                "--only",
                "2",
                "--from-run",
                &format!("{RESULTS_ROOT}/{REFERENCE_RUN}"),
                "--client",
                "pi",
                "--record"
            ]
        );
        // Several stories pass through as given: how many a partial rerun takes is the harness's rule.
        let mut several = known_good();
        several.stories = Some(vec![10, 11, 12]);
        let got = args_of(&generic, &several);
        let only = got.iter().position(|a| a == "--only").unwrap();
        assert_eq!(got[only + 1], "10,11,12");
        assert_eq!(got[only + 2], "--from-run");
        assert!(!args_of(&generic, &spec()).contains(&"--from-run".to_string()));
    }

    #[test]
    fn a_reference_run_must_be_a_path_inside_the_repo() {
        for bad in [
            "..",
            "../outside",
            "combinations/../../outside",
            "combinations/x/..",
            "/etc",
            "/node/checkout/combinations/x",
            "combinations//x",
            "combinations/x/",
            "./combinations/x",
            "",
            "combinations/a b",
        ] {
            let mut s = known_good();
            s.from_run = Some(bad.into());
            let e = s.validate().expect_err(bad);
            assert!(e.contains("from_run"), "{bad:?}: {e}");
        }
    }

    #[test]
    fn a_reference_run_needs_the_stories_to_run() {
        let mut s = known_good();
        s.stories = None;
        let e = s.validate().unwrap_err();
        assert!(e.contains("from_run") && e.contains("stories"), "{e}");
    }

    #[test]
    fn the_reference_run_is_part_of_the_job_identity() {
        let a = known_good();
        assert_eq!(submit_decision(Some(&a), &a.clone()), SubmitOutcome::Existing);
        let mut other = a.clone();
        other.from_run = Some(format!("{REFERENCE_RUN}-other"));
        assert_eq!(submit_decision(Some(&a), &other), SubmitOutcome::Conflict);
        let mut none = a.clone();
        none.from_run = None;
        assert_eq!(submit_decision(Some(&a), &none), SubmitOutcome::Conflict);
        assert_eq!(submit_decision(Some(&none), &a), SubmitOutcome::Conflict);
    }

    #[test]
    fn a_reference_run_without_its_bundle_or_metrics_is_a_problem_with_a_plain_reason() {
        let root = std::env::temp_dir().join(format!("dbench-job-ref-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        let run = |name: &str, files: &[&str]| {
            let rel = format!("combinations/c/benchmarks/vidi/{name}");
            std::fs::create_dir_all(root.join(&rel)).unwrap();
            for f in files {
                std::fs::write(root.join(&rel).join(f), "{}").unwrap();
            }
            rel
        };
        let whole = run("whole", &[REFERENCE_BUNDLE, REFERENCE_METRICS]);
        assert_eq!(reference_run_problem(&root, &whole), None);

        let no_bundle = run("no-bundle", &[REFERENCE_METRICS]);
        let why = reference_run_problem(&root, &no_bundle).expect("no bundle");
        assert!(why.contains(REFERENCE_BUNDLE) && why.contains(&no_bundle), "{why}");
        assert!(!why.contains(REFERENCE_METRICS), "{why}");

        let no_metrics = run("no-metrics", &[REFERENCE_BUNDLE]);
        let why = reference_run_problem(&root, &no_metrics).expect("no metrics");
        assert!(why.contains(REFERENCE_METRICS) && !why.contains(REFERENCE_BUNDLE), "{why}");

        let empty = run("empty", &[]);
        let why = reference_run_problem(&root, &empty).expect("empty");
        assert!(why.contains(REFERENCE_BUNDLE) && why.contains(REFERENCE_METRICS), "{why}");

        let why = reference_run_problem(&root, "combinations/c/benchmarks/vidi/absent").expect("absent");
        assert!(why.contains("no such directory"), "{why}");

        // A link out of the checkout is not a run in the checkout, whatever it points at.
        let outside = root.with_extension("outside");
        let _ = std::fs::remove_dir_all(&outside);
        std::fs::create_dir_all(&outside).unwrap();
        for f in [REFERENCE_BUNDLE, REFERENCE_METRICS] {
            std::fs::write(outside.join(f), "{}").unwrap();
        }
        std::os::unix::fs::symlink(&outside, root.join("combinations/c/benchmarks/vidi/link")).unwrap();
        let why = reference_run_problem(&root, "combinations/c/benchmarks/vidi/link").expect("link");
        assert!(why.contains("outside"), "{why}");

        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);
    }

    fn from_story_spec() -> JobSpec {
        let mut s = spec();
        s.from_run = Some(REFERENCE_RUN.into());
        s.from_story = Some(FROM_STORY);
        s
    }

    const FROM_STORY: u32 = 2;

    #[test]
    fn a_spec_round_trips_with_and_without_a_first_story() {
        let text = serde_json::to_string(&spec()).unwrap();
        assert!(!text.contains("from_story"), "{text}");
        let old: JobSpec = serde_json::from_str(
            r#"{"install_id":"x","pack":"p","run_id":"r","client":"pi","record":true}"#,
        )
        .unwrap();
        assert_eq!(old.from_story, None);
        let fs = from_story_spec();
        let text = serde_json::to_string(&fs).unwrap();
        assert!(text.contains(r#""from_story":2"#), "{text}");
        let back: JobSpec = serde_json::from_str(&text).unwrap();
        assert_eq!(back, fs);
        assert_eq!(back.validate(), Ok(()));
    }

    #[test]
    fn a_first_story_reaches_the_harness_instead_of_only() {
        let generic = Entry {
            script: "/release/benchmarks/spec-bench/harness/run.sh".into(),
            uses_pack_flag: true,
        };
        let got = args_of(&generic, &from_story_spec());
        assert!(!got.contains(&"--only".to_string()), "{got:?}");
        let at = got.iter().position(|a| a == "--from-run").unwrap();
        assert_eq!(got[at + 1], format!("{RESULTS_ROOT}/{REFERENCE_RUN}"));
        assert_eq!(got[at + 2], "--from-story");
        assert_eq!(got[at + 3], FROM_STORY.to_string());
        assert_eq!(got[at + 4], "--client");
        assert!(!args_of(&generic, &known_good()).contains(&"--from-story".to_string()));
    }

    #[test]
    fn a_first_story_needs_a_reference_run_and_excludes_stories() {
        let mut no_run = from_story_spec();
        no_run.from_run = None;
        let e = no_run.validate().unwrap_err();
        assert!(e.contains("from_story") && e.contains("from_run"), "{e}");

        let mut with_stories = from_story_spec();
        with_stories.stories = Some(vec![FROM_STORY]);
        let e = with_stories.validate().unwrap_err();
        assert!(e.contains("from_story") && e.contains("stories"), "{e}");

        let mut zero = from_story_spec();
        zero.from_story = Some(0);
        let e = zero.validate().unwrap_err();
        assert!(e.contains("from_story"), "{e}");

        // A reference run alone, with neither stories nor a first story, is still refused.
        let mut neither = from_story_spec();
        neither.from_story = None;
        assert!(neither.validate().is_err());
    }

    #[test]
    fn the_first_story_is_part_of_the_job_identity() {
        let a = from_story_spec();
        assert_eq!(submit_decision(Some(&a), &a.clone()), SubmitOutcome::Existing);
        let mut other = a.clone();
        other.from_story = Some(FROM_STORY + 1);
        assert_eq!(submit_decision(Some(&a), &other), SubmitOutcome::Conflict);
        let mut none = a.clone();
        none.from_story = None;
        none.stories = Some(vec![FROM_STORY]);
        assert_eq!(submit_decision(Some(&a), &none), SubmitOutcome::Conflict);
    }

    #[test]
    fn idempotent_submit() {
        let a = spec();
        assert_eq!(submit_decision(None, &a), SubmitOutcome::Create);
        assert_eq!(
            submit_decision(Some(&a.clone()), &a),
            SubmitOutcome::Existing
        );
        let mut b = a.clone();
        b.record = false;
        assert_eq!(submit_decision(Some(&a), &b), SubmitOutcome::Conflict);
        let mut c = a.clone();
        c.stories = Some(vec![1, 2]);
        assert_eq!(submit_decision(Some(&a), &c), SubmitOutcome::Conflict);
    }

    #[test]
    fn spec_json_equality_ignores_key_order_and_absent_options() {
        let a: JobSpec = serde_json::from_str(
            r#"{"install_id":"x","pack":"p","run_id":"r","client":"pi","record":true}"#,
        )
        .unwrap();
        let b: JobSpec = serde_json::from_str(
            r#"{"record":true,"client":"pi","run_id":"r","scope":null,"pack":"p","install_id":"x"}"#,
        )
        .unwrap();
        assert_eq!(submit_decision(Some(&a), &b), SubmitOutcome::Existing);
    }

    #[test]
    fn server_env_allows_listed_keys_with_valid_values() {
        let mut s = spec();
        s.server_env = [
            ("GPU_BACKEND", "rocm"),
            ("SPEC_MTP", "0"),
            ("SPEC_DRAFT_N_MAX", "4"),
            ("SPEC_DRAFT_P_MIN", "0.75"),
            ("PROFILE", "agents"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(s.validate(), Ok(()));
        for (k, v) in [
            ("LD_PRELOAD", "/tmp/x.so"),
            ("PATH", "/tmp"),
            ("GPU_BACKEND", "cuda"),
            ("GPU_BACKEND", "rocm; rm -rf /"),
            ("SPEC_MTP", "2"),
            ("SPEC_DRAFT_N_MAX", "0"),
            ("SPEC_DRAFT_N_MAX", "17"),
            ("SPEC_DRAFT_N_MAX", "x"),
            ("SPEC_DRAFT_P_MIN", "1.5"),
            ("SPEC_DRAFT_P_MIN", "-0.1"),
            ("PROFILE", "a b"),
        ] {
            let mut s = spec();
            s.server_env.insert(k.into(), v.into());
            assert!(s.validate().is_err(), "{k}={v} should be refused");
        }
    }

    #[test]
    fn server_env_is_part_of_the_job_identity() {
        let a = spec();
        let mut b = a.clone();
        b.server_env.insert("GPU_BACKEND".into(), "rocm".into());
        assert_eq!(submit_decision(Some(&a), &b), SubmitOutcome::Conflict);
        // Absent and empty are the same job, so older clients stay idempotent.
        let c: JobSpec = serde_json::from_str(
            r#"{"install_id":"x","pack":"p","run_id":"r","client":"pi","record":true}"#,
        )
        .unwrap();
        let d: JobSpec = serde_json::from_str(
            r#"{"install_id":"x","pack":"p","run_id":"r","client":"pi","record":true,"server_env":{}}"#,
        )
        .unwrap();
        assert_eq!(submit_decision(Some(&c), &d), SubmitOutcome::Existing);
        assert!(!serde_json::to_string(&c).unwrap().contains("server_env"));
    }

    #[test]
    fn spec_rejects_unknown_fields_and_bad_names() {
        assert!(serde_json::from_str::<JobSpec>(
            r#"{"install_id":"x","pack":"p","run_id":"r","client":"pi","record":true,"cmd":"rm -rf /"}"#
        )
        .is_err());
        let mut s = spec();
        s.pack = "../etc".into();
        assert!(s.validate().is_err());
        let mut s = spec();
        s.run_id = "a b".into();
        assert!(s.validate().is_err());
        let mut s = spec();
        s.stories = Some(vec![]);
        assert!(s.validate().is_err());
        assert!(spec().validate().is_ok());
    }

    #[test]
    fn args() {
        let own = Entry {
            script: "/r/benchmarks/vidi/harness/run.sh".into(),
            uses_pack_flag: false,
        };
        let mut s = spec();
        s.stories = Some(vec![3, 4]);
        let got = args_of(&own, &s);
        assert_eq!(
            got,
            [
                "/r/benchmarks/vidi/harness/run.sh",
                "mtplx-qwen38-27b",
                "--run-id",
                "canvas-pi-01",
                "--scope",
                "canvas",
                "--only",
                "3,4",
                "--client",
                "pi",
                "--record"
            ]
        );
        let generic = Entry {
            script: "/r/g.sh".into(),
            uses_pack_flag: true,
        };
        let mut s = spec();
        s.record = false;
        s.scope = None;
        let got = args_of(&generic, &s);
        assert_eq!(
            got,
            [
                "/r/g.sh",
                "mtplx-qwen38-27b",
                "--pack",
                "benchmarks/vidi",
                "--run-id",
                "canvas-pi-01",
                "--client",
                "pi"
            ]
        );
        assert_eq!(spec().pack_name(), "vidi");
    }
}
