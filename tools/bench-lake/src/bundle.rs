//! A working copy of a run's code at a story, from its bundle (lakelib.code.workspace).
//! This is the only module that creates or removes anything, and the only one that starts a process (git).

use crate::absent::Error;
use crate::layout::{Lake, RunRef};
use std::path::{Path, PathBuf};

pub const BUNDLE_FILE: &str = "workspace.bundle";
pub const COMMIT_LEN: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    pub path: PathBuf,
    pub commit: String,
}

impl Lake {
    pub fn workspace(&self, run: &RunRef, story: i64, dest: &Path) -> Result<Workspace, Error> {
        let _ = (run, story, dest);
        todo!("Lake::workspace")
    }
}
