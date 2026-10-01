//! Path handling shared by both enforcers: every path in a policy is absolute and free of symlinks,
//! because that is the form the kernel checks (Seatbelt matches the resolved path; bubblewrap mounts
//! at the resolved path).

use anyhow::{bail, Context, Result};
use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

/// More hops than any real chain of symlinks; a loop ends here instead of spinning.
const MAX_SYMLINK_HOPS: usize = 40;

/// The path with every symlink resolved, or None if nothing is there.
pub fn normalise(path: &Path) -> Result<Option<PathBuf>> {
    if !path.is_absolute() {
        bail!("{} is not an absolute path", path.display());
    }
    match path.canonicalize() {
        Ok(p) => Ok(Some(p)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("resolving {}", path.display())),
    }
}

/// `path` is `root` or lies under it, compared by whole components ("/a/bc" is not within "/a/b").
pub fn within(path: &Path, root: &Path) -> bool {
    path.starts_with(root)
}

/// Every directory above `path`, outermost first, without the filesystem root and without `path`.
pub fn strict_ancestors(path: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = path
        .ancestors()
        .skip(1)
        .filter(|a| a.parent().is_some())
        .map(Path::to_path_buf)
        .collect();
    out.reverse();
    out
}

/// Each symlink met while resolving `path`, in the order met: where the link is (its parent already
/// resolved) and the target as written in the link. Empty when the path has no symlinks or is missing.
pub fn symlinks_on(path: &Path) -> Vec<(PathBuf, PathBuf)> {
    let mut found = Vec::new();
    let mut todo: VecDeque<OsString> = components(path);
    let mut resolved = PathBuf::from("/");
    while let Some(part) = todo.pop_front() {
        if part == ".." {
            resolved.pop();
            continue;
        }
        let candidate = resolved.join(&part);
        match std::fs::read_link(&candidate) {
            Ok(target) => {
                if found.len() >= MAX_SYMLINK_HOPS {
                    break;
                }
                if target.is_absolute() {
                    resolved = PathBuf::from("/");
                }
                for c in components(&target).into_iter().rev() {
                    todo.push_front(c);
                }
                found.push((candidate, target));
            }
            Err(_) => resolved = candidate,
        }
    }
    found
}

/// The named parts of a path: no root, no ".", ".." kept.
fn components(path: &Path) -> VecDeque<OsString> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(n) => Some(n.to_os_string()),
            Component::ParentDir => Some(OsString::from("..")),
            _ => None,
        })
        .collect()
}
