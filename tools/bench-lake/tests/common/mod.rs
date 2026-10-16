//! Helpers shared by the integration tests. Nothing here is under test.
#![allow(dead_code)]

use bench_lake::{Lake, RunRef};
use std::collections::BTreeMap;
use std::fs;
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};

pub const ID_FRESH: &str =
    "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1";
pub const ID_Q36: &str =
    "combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2";
pub const ID_DRY: &str =
    "combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2";
pub const ID_FLASH: &str = "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1";
pub const ID_TODOODLE: &str = "benchmarks/reference/todoodle/opus-5.5/run-1";
pub const ID_REFV: &str = "benchmarks/reference/vidi/sonnet-5.5/v2-r1";
pub const FIXTURE_RUN_COUNT: usize = 8;
/// Files above this size are compared by size and modification time only in a snapshot (a host lake holds GiB logs).
pub const SNAPSHOT_HASH_LIMIT: u64 = 8 * 1024 * 1024;
pub const FIXTURE_DISTINCT_IDS: usize = 6;
pub const DIR_MODE_WRITABLE: u32 = 0o755;
pub const FILE_MODE_WRITABLE: u32 = 0o644;
pub const DIR_MODE_READONLY: u32 = 0o555;
pub const FILE_MODE_READONLY: u32 = 0o444;

pub fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

pub fn fixture_state() -> PathBuf {
    manifest_dir().join("tests/fixtures/lake")
}

pub fn fixture_lake() -> Lake {
    Lake::in_state_dir(&fixture_state())
}

pub fn repo_root() -> PathBuf {
    manifest_dir().join("../..").canonicalize().expect("repo root")
}

/// The run `id` under `node` (None: the reference run, or the only copy), from a fresh discovery.
pub fn find(lake: &Lake, id: &str, node: Option<&str>) -> RunRef {
    let d = lake.discover();
    d.runs
        .iter()
        .find(|r| r.id == id && r.node.as_deref() == node)
        .unwrap_or_else(|| panic!("no run {id} node {node:?} in the lake"))
        .clone()
}

pub fn preferred(lake: &Lake, id: &str) -> RunRef {
    let d = lake.discover();
    lake.preferred(&d, id).unwrap_or_else(|| panic!("no run {id}")).clone()
}

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// A scratch folder that is removed when it goes out of scope, also when a test made parts of it read-only.
pub struct Scratch {
    root: PathBuf,
}

impl Scratch {
    pub fn new(tag: &str) -> Scratch {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let root = std::env::temp_dir().join(format!("bench-lake-test-{}-{}-{}", std::process::id(), n, tag));
        fs::create_dir_all(&root).expect("scratch");
        Scratch { root }
    }
    pub fn path(&self) -> &Path {
        &self.root
    }
    pub fn join(&self, rel: &str) -> PathBuf {
        self.root.join(rel)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        make_writable(&self.root);
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Gives every folder and file below `root` (not following links) owner write permission again.
pub fn make_writable(root: &Path) {
    set_modes(root, DIR_MODE_WRITABLE, FILE_MODE_WRITABLE);
}

pub fn make_read_only(root: &Path) {
    set_modes(root, DIR_MODE_READONLY, FILE_MODE_READONLY);
}

fn set_modes(path: &Path, dir_mode: u32, file_mode: u32) {
    let Ok(meta) = fs::symlink_metadata(path) else { return };
    if meta.file_type().is_symlink() {
        return;
    }
    if meta.is_dir() {
        // Make the folder listable before reading it, then apply the wanted mode last.
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(DIR_MODE_WRITABLE));
        if let Ok(entries) = fs::read_dir(path) {
            for e in entries.flatten() {
                set_modes(&e.path(), dir_mode, file_mode);
            }
        }
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(dir_mode));
    } else {
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(file_mode));
    }
}

/// Copies a tree; links are recreated as links.
pub fn copy_tree(src: &Path, dst: &Path) {
    let meta = fs::symlink_metadata(src).expect("copy source");
    if meta.file_type().is_symlink() {
        symlink(fs::read_link(src).unwrap(), dst).unwrap();
    } else if meta.is_dir() {
        fs::create_dir_all(dst).unwrap();
        for e in fs::read_dir(src).unwrap() {
            let e = e.unwrap();
            copy_tree(&e.path(), &dst.join(e.file_name()));
        }
    } else {
        fs::copy(src, dst).unwrap();
        fs::set_permissions(dst, fs::Permissions::from_mode(FILE_MODE_WRITABLE)).unwrap();
    }
}

/// A scratch copy of the fixture lake: (guard, state folder, lake).
pub fn scratch_lake(tag: &str) -> (Scratch, PathBuf, Lake) {
    let s = Scratch::new(tag);
    let state = s.join("state");
    copy_tree(&fixture_state(), &state);
    let lake = Lake::in_state_dir(&state);
    (s, state, lake)
}

pub fn write(path: &Path, bytes: &[u8]) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, bytes).unwrap();
}

/// Every file and folder below `root` with kind, size, permission bits, modification time and content hash.
/// Access times are not recorded.
pub fn snapshot(root: &Path) -> BTreeMap<String, String> {
    fn walk(root: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
        for e in fs::read_dir(dir).unwrap() {
            let e = e.unwrap();
            let p = e.path();
            let meta = fs::symlink_metadata(&p).unwrap();
            let rel = p.strip_prefix(root).unwrap().to_string_lossy().to_string();
            let mtime = meta.modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let kind = if meta.file_type().is_symlink() {
                format!("link->{}", fs::read_link(&p).unwrap().display())
            } else if meta.is_dir() {
                "dir".to_string()
            } else if meta.len() <= SNAPSHOT_HASH_LIMIT {
                bench_lake::sha256_hex(&fs::read(&p).unwrap())
            } else {
                "big".to_string()
            };
            out.insert(rel, format!("{kind} size={} mode={:o} mtime={mtime}", meta.len(), meta.permissions().mode()));
            if meta.is_dir() {
                walk(root, &p, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    walk(root, root, &mut out);
    out
}

pub fn bench_lake_cmd() -> Command {
    Command::new(env!("CARGO_BIN_EXE_bench-lake"))
}

/// True when running as the super-user, for whom permission tests prove nothing.
pub fn is_root() -> bool {
    Command::new("id").arg("-u").output().map(|o| String::from_utf8_lossy(&o.stdout).trim() == "0").unwrap_or(false)
}

pub fn not_run(tc: &str, why: &str) {
    eprintln!("NOT RUN {tc}: {why}");
}

/// Makes `dst` a copy of `src` compressed by the file system (APFS), if the system can. Returns false if it cannot or
/// if the copy is not marked compressed (a file that does not shrink is stored plain).
pub fn fs_compressed_copy(src: &Path, dst: &Path) -> bool {
    // ditto skips names it takes for compressed types (a `.gz` name), so the copy is made under a plain name and renamed.
    let mut plain = dst.as_os_str().to_owned();
    plain.push(".plain-name");
    let plain = PathBuf::from(plain);
    let ok = Command::new("ditto").arg("--hfsCompression").arg(src).arg(&plain).status().map(|s| s.success()).unwrap_or(false);
    if !ok || fs::rename(&plain, dst).is_err() {
        return false;
    }
    let out = Command::new("ls").arg("-lO").arg(dst).output().unwrap();
    String::from_utf8_lossy(&out.stdout).contains("compressed")
}

/// Runs git with a clean environment (for the tests' own checks).
pub fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .env_clear()
        .env("PATH", std::env::var("PATH").unwrap_or_default())
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim_end().to_string()
}
