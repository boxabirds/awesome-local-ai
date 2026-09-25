//! Operator requests to the harness, written as files in its run directory.
//! The contract is `benchmarks/vidi/harness/CONTROL.md`.

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};

/// Under the run dir: where the harness looks for requests.
pub const CONTROL_DIR: &str = "control";
/// End the running story as PARTIAL. The harness renames it to
/// `skip-story-<N>.applied.json` once applied.
pub const SKIP_STORY_FILE: &str = "skip-story.json";

/// `POST /v1/jobs/{id}/skip-story` body.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct SkipStoryRequest {
    pub story: u32,
    /// Required and non-empty; missing reads as empty so it gets the same 400.
    #[serde(default)]
    pub reason: String,
}

/// What `control/skip-story.json` holds.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct SkipStory {
    pub story: u32,
    pub reason: String,
    /// The caller's IP address.
    pub by: String,
    /// Unix seconds.
    pub at: u64,
}

pub fn skip_story_path(run_dir: &Path) -> PathBuf {
    run_dir.join(CONTROL_DIR).join(SKIP_STORY_FILE)
}

/// Write `control/skip-story.json` atomically (temp file, then rename), so the
/// harness never reads half of it. An existing, unapplied request is replaced.
pub fn write_skip_story(run_dir: &Path, req: &SkipStory) -> std::io::Result<PathBuf> {
    let dir = run_dir.join(CONTROL_DIR);
    std::fs::create_dir_all(&dir)?;
    let path = skip_story_path(run_dir);
    let tmp = dir.join(format!(".{SKIP_STORY_FILE}.{}.tmp", std::process::id()));
    let body = serde_json::to_vec(req).map_err(std::io::Error::other)?;
    let res = std::fs::File::create(&tmp).and_then(|mut f| {
        f.write_all(&body)?;
        f.write_all(b"\n")?;
        f.sync_all()
    });
    if let Err(e) = res.and_then(|_| std::fs::rename(&tmp, &path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skip_story_is_written_and_replaced() {
        let dir = std::env::temp_dir().join(format!("dbench-control-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut req = SkipStory {
            story: 3,
            reason: "no commit for 107 min".into(),
            by: "100.71.150.106".into(),
            at: 1_790_303_000,
        };
        let path = write_skip_story(&dir, &req).unwrap();
        assert_eq!(path, dir.join("control/skip-story.json"));
        let got: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(
            got,
            serde_json::json!({"story": 3, "reason": "no commit for 107 min", "by": "100.71.150.106", "at": 1_790_303_000u64})
        );
        req.reason = "second thoughts".into();
        write_skip_story(&dir, &req).unwrap();
        let got: SkipStory = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(got, req);
        // Only the request is left behind, no temp file.
        assert_eq!(std::fs::read_dir(dir.join(CONTROL_DIR)).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn request_body() {
        let r: SkipStoryRequest = serde_json::from_str(r#"{"story": 3}"#).unwrap();
        assert_eq!(r.reason, "");
        assert!(serde_json::from_str::<SkipStoryRequest>(r#"{"story": 3, "x": 1}"#).is_err());
    }
}
