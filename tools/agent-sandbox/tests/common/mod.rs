//! Shared by the test files: temp directories that remove themselves.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);
/// Every directory these tests make carries this, so a leftover is recognisable.
pub const TEST_DIR_PREFIX: &str = "agent-sandbox-test";

pub struct TempDir(PathBuf);

impl TempDir {
    /// A fresh directory under `parent`, as the system resolves it (no symlinks in its path).
    pub fn under(parent: &Path) -> TempDir {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = parent.join(format!("{TEST_DIR_PREFIX}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        TempDir(dir.canonicalize().unwrap())
    }

    pub fn new() -> TempDir {
        TempDir::under(&std::env::temp_dir())
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn dir(&self, rel: &str) -> PathBuf {
        let p = self.0.join(rel);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    pub fn file(&self, rel: &str, body: &str) -> PathBuf {
        let p = self.0.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, body).unwrap();
        p
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
