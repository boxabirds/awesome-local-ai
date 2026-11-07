//! A partial rerun's inputs (story 23, partial.job_inputs): the reference run's code up to the story before the first
//! one to run, and its record. The host takes both from the lake at submit and sends them with the job; the node keeps
//! them in the job's folder and gives their paths to the harness. A node never reads another run from its checkout.
//!
//! On the wire they are the `inputs` member of the PUT body, beside the job spec's own fields. They are not part of
//! the job's identity and not stored in the job's JSON: the job names the run (`from_run`), the inputs are its files.

use base64::Engine;
use bench_lake::code::{node_of, story_ref};
use bench_lake::Lake;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::job::JobSpec;

/// Largest code bundle plus record a job may carry. The largest run bundle seen in the lake is 12 MiB.
pub const JOB_INPUT_LIMIT_BYTES: u64 = 32 * 1024 * 1024;
/// The PUT body that carries them: base64 grows the bundle by a third, the spec and the record are small.
pub const SUBMIT_BODY_LIMIT_BYTES: usize = 2 * JOB_INPUT_LIMIT_BYTES as usize;
/// The member of the PUT body that holds them.
pub const INPUTS_FIELD: &str = "inputs";
/// Their folder beside the job's JSON: `<jobs>/<id>.inputs/`.
const INPUTS_DIR_SUFFIX: &str = ".inputs";
pub const CODE_FILE: &str = "code.bundle";
pub const METRICS_FILE: &str = "metrics.json";
/// The record is held-out detail's neighbour: only the owner reads it.
const PRIVATE_FILE_MODE: u32 = 0o600;
const PRIVATE_DIR_MODE: u32 = 0o700;

/// What the host sends: the code bundle (base64) and the record's text.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct JobInputs {
    pub code_bundle: String,
    pub metrics: String,
}

/// The story the partial rerun builds first: `from_story`, else the lowest of `stories`.
pub fn first_story(spec: &JobSpec) -> Option<u32> {
    spec.from_story
        .or_else(|| spec.stories.as_ref().and_then(|s| s.iter().copied().min()))
}

fn over_limit(from_run: &str, size: u64) -> String {
    format!(
        "reference run {from_run}: its code and record are {size} bytes, over the job-input limit of \
         {JOB_INPUT_LIMIT_BYTES} bytes"
    )
}

/// R's code up to story `first - 1` and R's metrics.json, from the lake at `state`. A copy of R qualifies when the
/// lake's code repository has its ref for story `first - 1` and the copy holds metrics.json; bench-lake's preferred
/// copy goes first. Every refusal names the run, and the story where it is about one.
pub fn from_lake(state: &Path, from_run: &str, first: u32) -> Result<JobInputs, String> {
    if first <= 1 {
        return Err(format!(
            "reference run {from_run}: story {first} is the first story, so there is no code before it to build on"
        ));
    }
    let base = first - 1;
    let lake = Lake::in_state_dir(state);
    let d = lake.discover();
    let mut copies = lake.copies(&d, from_run);
    if copies.is_empty() {
        return Err(format!(
            "reference run {from_run}: no such run in the lake at {}",
            state.display()
        ));
    }
    let preferred = lake.preferred(&d, from_run).map(|r| r.dir.clone());
    copies.sort_by_key(|r| Some(&r.dir) != preferred.as_ref());
    let code = lake.code_stories();
    let with_code: Vec<_> = copies
        .into_iter()
        .filter(|r| {
            code.get(&(node_of(r).to_string(), r.id.clone()))
                .is_some_and(|s| s.contains(&base))
        })
        .collect();
    if with_code.is_empty() {
        return Err(format!(
            "reference run {from_run} has no code for story {base} in the lake"
        ));
    }
    let Some((run, metrics)) = with_code.into_iter().find_map(|r| {
        bench_lake::read_regular(&r.dir, Path::new(METRICS_FILE))
            .ok()
            .map(|m| (r, m))
    }) else {
        return Err(format!("reference run {from_run} has no {METRICS_FILE} in the lake"));
    };
    let metrics =
        String::from_utf8(metrics).map_err(|_| format!("reference run {from_run}: {METRICS_FILE} is not text"))?;
    // Every story ref of that copy up to the base: the harness takes the base commit from the record.
    let node = node_of(run);
    let refs: Vec<String> = code[&(node.to_string(), run.id.clone())]
        .iter()
        .filter(|s| **s <= base)
        .map(|s| story_ref(node, &run.id, *s))
        .collect();
    let tmp = tempfile_path("code-bundle");
    let out = bench_lake::code::git_command()
        .arg("--git-dir")
        .arg(lake.code_repo())
        .args(["bundle", "create", "--quiet"])
        .arg(&tmp)
        .args(&refs)
        .output()
        .map_err(|e| format!("reference run {from_run}: git bundle: {e}"))?;
    let bytes = std::fs::read(&tmp);
    let _ = std::fs::remove_file(&tmp);
    if !out.status.success() {
        return Err(format!(
            "reference run {from_run}: git bundle of its code to story {base} failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let bytes = bytes.map_err(|e| format!("reference run {from_run}: reading its code bundle: {e}"))?;
    let size = bytes.len() as u64 + metrics.len() as u64;
    if size > JOB_INPUT_LIMIT_BYTES {
        return Err(over_limit(from_run, size));
    }
    Ok(JobInputs {
        code_bundle: base64::engine::general_purpose::STANDARD.encode(bytes),
        metrics,
    })
}

fn tempfile_path(tag: &str) -> PathBuf {
    let n = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    std::env::temp_dir().join(format!("dbench-{tag}-{}-{n}.bundle", std::process::id()))
}

/// The job's inputs folder.
pub fn dir(jobs_dir: &Path, id: &str) -> PathBuf {
    jobs_dir.join(format!("{id}{INPUTS_DIR_SUFFIX}"))
}

/// The two files the harness is given, when both are there.
pub fn stored(jobs_dir: &Path, id: &str) -> Result<(PathBuf, PathBuf), String> {
    let d = dir(jobs_dir, id);
    let (code, metrics) = (d.join(CODE_FILE), d.join(METRICS_FILE));
    for f in [&code, &metrics] {
        if !f.is_file() {
            return Err(format!("the partial rerun's input {} is missing", f.display()));
        }
    }
    Ok((code, metrics))
}

/// Checks what the node was sent against the spec: a partial rerun needs inputs, a full run has none, and the
/// decoded inputs fit the limit. Returns the bundle's bytes.
pub fn check(spec: &JobSpec, inputs: Option<&JobInputs>) -> Result<Option<Vec<u8>>, String> {
    match (spec.from_run.as_deref(), inputs) {
        (None, None) => Ok(None),
        (None, Some(_)) => Err(format!("{INPUTS_FIELD} go only with from_run (a partial rerun)")),
        (Some(r), None) => Err(format!(
            "a partial rerun of {r} needs its {INPUTS_FIELD}: the reference run's code and record, which `dbench \
             submit` takes from the host's lake"
        )),
        (Some(r), Some(i)) => {
            let code = base64::engine::general_purpose::STANDARD
                .decode(&i.code_bundle)
                .map_err(|e| format!("{INPUTS_FIELD}.code_bundle is not base64: {e}"))?;
            let size = code.len() as u64 + i.metrics.len() as u64;
            if size > JOB_INPUT_LIMIT_BYTES {
                return Err(over_limit(r, size));
            }
            Ok(Some(code))
        }
    }
}

/// Writes the inputs into the job's folder (owner-only), each file atomically.
pub fn store(jobs_dir: &Path, id: &str, code: &[u8], metrics: &str) -> anyhow::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let d = dir(jobs_dir, id);
    std::fs::create_dir_all(&d)?;
    std::fs::set_permissions(&d, std::fs::Permissions::from_mode(PRIVATE_DIR_MODE))?;
    for (name, bytes) in [(CODE_FILE, code), (METRICS_FILE, metrics.as_bytes())] {
        let f = d.join(name);
        crate::store::write_atomic(&f, bytes)?;
        std::fs::set_permissions(&f, std::fs::Permissions::from_mode(PRIVATE_FILE_MODE))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::AgentClient;

    fn spec(from_run: Option<&str>, stories: Option<Vec<u32>>, from_story: Option<u32>) -> JobSpec {
        JobSpec {
            install_id: "x".into(),
            combination: None,
            pack: "benchmarks/vidi".into(),
            scope: None,
            stories,
            run_id: "r".into(),
            client: AgentClient::Pi,
            record: true,
            server_env: Default::default(),
            from_run: from_run.map(str::to_string),
            from_story,
        }
    }

    #[test]
    fn the_first_story_is_from_story_else_the_lowest_listed() {
        assert_eq!(first_story(&spec(Some("r"), None, Some(4))), Some(4));
        assert_eq!(first_story(&spec(Some("r"), Some(vec![6, 3, 5]), None)), Some(3));
        assert_eq!(first_story(&spec(None, None, None)), None);
    }

    #[test]
    fn tc94_inputs_are_checked_against_the_spec_and_the_limit() {
        let small = JobInputs {
            code_bundle: base64::engine::general_purpose::STANDARD.encode(b"b"),
            metrics: "{}".into(),
        };
        assert_eq!(check(&spec(None, None, None), None), Ok(None));
        assert!(check(&spec(None, None, None), Some(&small))
            .unwrap_err()
            .contains("only with from_run"));
        let e = check(&spec(Some("R"), Some(vec![3]), None), None).unwrap_err();
        assert!(e.contains("partial rerun of R needs its inputs"), "{e}");
        assert_eq!(
            check(&spec(Some("R"), Some(vec![3]), None), Some(&small)),
            Ok(Some(b"b".to_vec()))
        );
        let bad = JobInputs {
            code_bundle: "not base64!".into(),
            metrics: "{}".into(),
        };
        assert!(check(&spec(Some("R"), Some(vec![3]), None), Some(&bad))
            .unwrap_err()
            .contains("not base64"));
        // At the limit is accepted; one byte over is refused, naming the size and the limit.
        let at = |extra: u64| {
            let code = vec![0u8; (JOB_INPUT_LIMIT_BYTES - 2 + extra) as usize];
            JobInputs {
                code_bundle: base64::engine::general_purpose::STANDARD.encode(code),
                metrics: "{}".into(),
            }
        };
        assert!(check(&spec(Some("R"), Some(vec![3]), None), Some(&at(0))).is_ok());
        let e = check(&spec(Some("R"), Some(vec![3]), None), Some(&at(1))).unwrap_err();
        assert_eq!(e, over_limit("R", JOB_INPUT_LIMIT_BYTES + 1));
        assert!(e.contains(&(JOB_INPUT_LIMIT_BYTES + 1).to_string()) && e.contains(&JOB_INPUT_LIMIT_BYTES.to_string()));
    }

    #[test]
    fn story_one_has_nothing_before_it() {
        let e = from_lake(Path::new("/nonexistent"), "R", 1).unwrap_err();
        assert!(e.contains("story 1 is the first story"), "{e}");
    }
}
