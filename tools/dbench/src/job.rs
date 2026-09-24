//! Job spec, job state, and the idempotent-submit rule.

use serde::{Deserialize, Serialize};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::ids::{valid_id, valid_pack};

/// Repo-relative path of the generic harness. When it exists it takes the pack
/// as `--pack`; otherwise each pack carries its own `harness/run.sh`.
pub const SPEC_BENCH_ENTRY: &str = "benchmarks/spec-bench/harness/run.sh";
/// Path of a pack's own entry point, relative to the pack directory.
pub const PACK_ENTRY: &str = "harness/run.sh";

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AgentClient {
    Pi,
    Opencode,
}

impl AgentClient {
    pub fn as_str(self) -> &'static str {
        match self {
            AgentClient::Pi => "pi",
            AgentClient::Opencode => "opencode",
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

/// Arguments for `bash`: `<run.sh> <install_id> [--pack P] --run-id R [--scope X] [--only 1,2] --client C [--record]`.
pub fn harness_args(entry: &Entry, spec: &JobSpec) -> Vec<OsString> {
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
    pub updated_at: u64,
    #[serde(default)]
    pub cancel_requested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_pull: Option<PullRecord>,
    /// Server-side interventions: restarts, recoveries, cancels, pull failures.
    #[serde(default)]
    pub history: Vec<Note>,
}

impl Job {
    pub fn new(id: String, spec: JobSpec, now: u64) -> Job {
        Job {
            id,
            spec,
            state: JobState::Queued,
            attempt: 0,
            submitted_at: now,
            updated_at: now,
            cancel_requested: false,
            last_pull: None,
            history: Vec::new(),
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
        }
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
        let got: Vec<String> = harness_args(&own, &s)
            .into_iter()
            .map(|a| a.into_string().unwrap())
            .collect();
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
        let got: Vec<String> = harness_args(&generic, &s)
            .into_iter()
            .map(|a| a.into_string().unwrap())
            .collect();
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
