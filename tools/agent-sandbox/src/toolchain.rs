//! Finding the read-only toolchain: the install each needed tool lives in, and nothing wider.
//!
//! The harness names its own tool directories with --ro. What is found here is what the command
//! line itself implies: the program being run, and node (npm, npx and globally installed agent
//! clients live in node's install). On macOS git is added, because /usr/bin/git is a stub.

use std::ffi::OsStr;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const BIN_DIR: &str = "bin";
const ANY_EXECUTE_BIT: u32 = 0o111;
/// Inside an Xcode or Command Line Tools developer directory.
const DEVELOPER_USR: &str = "usr";
const DEVELOPER_GIT: &str = "usr/bin/git";
const DEVELOPER_BIN: &str = "usr/bin";
const DEVELOPER_PYTHON: &str = "Library/Frameworks/Python3.framework";

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Discovered {
    pub read_only: Vec<PathBuf>,
    /// Each tool as it was found on PATH, before symlinks were followed: the command is started
    /// by that name, so the links from there to its install must stay resolvable.
    pub entry_points: Vec<PathBuf>,
    /// Directories to put on the command's PATH just ahead of /usr/bin.
    pub path_prepend: Vec<PathBuf>,
}

impl Discovered {
    pub fn merge(&mut self, other: Discovered) {
        for p in other.read_only {
            if !self.read_only.contains(&p) {
                self.read_only.push(p);
            }
        }
        for p in other.entry_points {
            if !self.entry_points.contains(&p) {
                self.entry_points.push(p);
            }
        }
        for p in other.path_prepend {
            if !self.path_prepend.contains(&p) {
                self.path_prepend.push(p);
            }
        }
    }
}

fn is_executable_file(path: &Path) -> bool {
    std::fs::metadata(path)
        .is_ok_and(|m| m.is_file() && m.permissions().mode() & ANY_EXECUTE_BIT != 0)
}

/// Where the shell would find `name`: the first executable file of that name on `path_var`.
/// A name with a slash in it is a path already and is returned if it is an executable file.
pub fn find_on_path(name: &OsStr, path_var: &OsStr) -> Option<PathBuf> {
    let as_path = Path::new(name);
    if as_path.components().count() > 1 {
        return is_executable_file(as_path).then(|| as_path.to_path_buf());
    }
    std::env::split_paths(path_var)
        .map(|dir| dir.join(name))
        .find(|p| is_executable_file(p))
}

/// What must be readable for `exe` to run: its install root when it sits in a `bin` directory
/// (the root holds its libraries and modules), otherwise the one resolved file. A root that
/// `forbidden` rejects (the home, a directory above the run) narrows to the file. None if missing.
pub fn tool_root(exe: &Path, forbidden: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    let real = exe.canonicalize().ok()?;
    let in_bin = real
        .parent()
        .filter(|dir| dir.file_name() == Some(OsStr::new(BIN_DIR)));
    match in_bin.and_then(Path::parent) {
        Some(root) if root.parent().is_some() && !forbidden(root) => Some(root.to_path_buf()),
        _ => Some(real),
    }
}

/// An Apple developer directory's command-line tools, if it has git: /usr/bin/git, python3 and the
/// rest are stubs that look these up through xcrun, which needs the per-user temp directory, the
/// Xcode licence state and several services. Putting the real programs ahead of /usr/bin on PATH
/// needs none of that.
pub fn developer_tools(developer_dir: &Path) -> Discovered {
    if !is_executable_file(&developer_dir.join(DEVELOPER_GIT)) {
        return Discovered::default();
    }
    let mut read_only = vec![developer_dir.join(DEVELOPER_USR)];
    let python = developer_dir.join(DEVELOPER_PYTHON);
    if python.is_dir() {
        read_only.push(python);
    }
    Discovered {
        read_only,
        entry_points: Vec::new(),
        path_prepend: vec![developer_dir.join(DEVELOPER_BIN)],
    }
}

/// The install of each named tool found on `path_var`, in the order given, each once.
pub fn discover(
    names: &[&OsStr],
    path_var: &OsStr,
    forbidden: &dyn Fn(&Path) -> bool,
) -> Discovered {
    let mut found = Discovered::default();
    for name in names {
        let Some(exe) = find_on_path(name, path_var) else {
            continue;
        };
        if let Some(root) = tool_root(&exe, forbidden) {
            found.merge(Discovered {
                read_only: vec![root],
                entry_points: vec![exe],
                path_prepend: Vec::new(),
            });
        }
    }
    found
}
