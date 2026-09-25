//! On-disk job store: `<home>/jobs/<id>.json` (written atomically) and `<home>/jobs/<id>.log`.

use anyhow::{Context, Result};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::job::Job;

const JSON_EXT: &str = "json";
const TMP_SUFFIX: &str = ".tmp";

pub fn job_path(jobs_dir: &Path, id: &str) -> PathBuf {
    jobs_dir.join(format!("{id}.{JSON_EXT}"))
}

pub fn log_path(jobs_dir: &Path, id: &str) -> PathBuf {
    jobs_dir.join(format!("{id}.log"))
}

/// Write to a temp file in the same directory, fsync it, then rename over the
/// target, so a reader or a crash sees either the old file or the new one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().context("path has no parent")?;
    let name = path
        .file_name()
        .context("path has no file name")?
        .to_string_lossy();
    let tmp = dir.join(format!(".{name}.{}{TMP_SUFFIX}", std::process::id()));
    {
        let mut f = fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("rename to {}", path.display()))?;
    Ok(())
}

pub fn save_job(jobs_dir: &Path, job: &Job) -> Result<()> {
    let bytes = serde_json::to_vec_pretty(job)?;
    write_atomic(&job_path(jobs_dir, &job.id), &bytes)
}

pub fn load_job(path: &Path) -> Result<Job> {
    let bytes = fs::read(path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_slice(&bytes).with_context(|| format!("parse {}", path.display()))
}

/// Every `<id>.json` in the directory. Unreadable files are reported and skipped.
pub fn load_jobs(jobs_dir: &Path) -> Result<Vec<Job>> {
    let mut jobs = Vec::new();
    for entry in fs::read_dir(jobs_dir)? {
        let path = entry?.path();
        let is_json = path.extension().is_some_and(|e| e == JSON_EXT);
        let hidden = path
            .file_name()
            .is_some_and(|n| n.to_string_lossy().starts_with('.'));
        if !is_json || hidden {
            continue;
        }
        match load_job(&path) {
            Ok(job) => jobs.push(job),
            Err(e) => eprintln!("dbench: skipping {}: {e:#}", path.display()),
        }
    }
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::job::{AgentClient, JobSpec, JobState};

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("dbench-store-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_round_trip() {
        let dir = temp_dir("rt");
        let spec = JobSpec {
            install_id: "i".into(),
            combination: None,
            pack: "benchmarks/vidi".into(),
            scope: Some("canvas".into()),
            stories: Some(vec![1, 2]),
            run_id: "r".into(),
            client: AgentClient::Opencode,
            record: false,
            server_env: Default::default(),
        };
        let mut job = Job::new("j1".into(), spec, 100);
        job.attempt = 2;
        job.state = JobState::Running {
            pid: 42,
            pgid: 42,
            attempt: 2,
            started_at: 101,
            boot_time: Some(7),
        };
        job.note(102, "restarted");
        save_job(&dir, &job).unwrap();
        assert_eq!(load_job(&job_path(&dir, "j1")).unwrap(), job);

        // Overwrite: the new content replaces the old, and no temp file is left behind.
        job.state = JobState::Failed {
            reason: "x".into(),
            exit_code: Some(1),
        };
        save_job(&dir, &job).unwrap();
        let all = load_jobs(&dir).unwrap();
        assert_eq!(all, vec![job]);
        let names: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(names.len(), 1, "{names:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn load_skips_garbage_and_temp_files() {
        let dir = temp_dir("skip");
        fs::write(dir.join("bad.json"), b"{not json").unwrap();
        fs::write(dir.join(".x.json.1.tmp"), b"{}").unwrap();
        fs::write(dir.join("x.log"), b"log").unwrap();
        assert!(load_jobs(&dir).unwrap().is_empty());
        fs::remove_dir_all(&dir).unwrap();
    }
}
