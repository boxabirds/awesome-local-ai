//! Finding the read-only toolchain a command needs: the tool's own install, never a broad parent.

mod common;

use agent_sandbox::run::{exit_code, path_with, proxy_env};
use agent_sandbox::toolchain::{developer_tools, discover, find_on_path, tool_root, Discovered};
use common::TempDir;
use std::ffi::{OsStr, OsString};
use std::os::unix::fs::{symlink, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::Command;

const EXECUTABLE: u32 = 0o755;
const PROXY_PORT: u16 = 41234;

fn exe(t: &TempDir, rel: &str) -> PathBuf {
    let p = t.file(rel, "#!/bin/sh\n");
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(EXECUTABLE)).unwrap();
    p
}

fn path_var(dirs: &[PathBuf]) -> OsString {
    std::env::join_paths(dirs).unwrap()
}

fn nothing_forbidden(_: &Path) -> bool {
    false
}

#[test]
fn find_on_path_takes_the_first_executable_and_skips_directories_and_plain_files() {
    let t = TempDir::new();
    t.dir("a/node");
    t.file("b/node", "not executable");
    let want = exe(&t, "c/node");
    exe(&t, "d/node");
    let path = path_var(&["a", "b", "c", "d"].map(|d| t.path().join(d)));
    assert_eq!(find_on_path(OsStr::new("node"), &path), Some(want.clone()));
    assert_eq!(find_on_path(OsStr::new("absent"), &path), None);
    assert_eq!(
        find_on_path(want.as_os_str(), OsStr::new("")),
        Some(want),
        "a path is taken as it is"
    );
}

#[test]
fn a_tool_in_a_bin_directory_brings_its_whole_install() {
    let t = TempDir::new();
    let node = exe(&t, "versions/v24/bin/node");
    t.file("versions/v24/lib/node_modules/npm/package.json", "{}");
    assert_eq!(
        tool_root(&node, &nothing_forbidden),
        Some(t.path().join("versions/v24"))
    );
}

#[test]
fn a_tool_reached_through_symlinks_is_resolved_first() {
    let t = TempDir::new();
    let real = exe(&t, "share/agent/versions/2.0.1");
    t.dir("bin");
    symlink(&real, t.path().join("bin/agent")).unwrap();
    assert_eq!(
        tool_root(&t.path().join("bin/agent"), &nothing_forbidden),
        Some(real),
        "the file, not the directory of versions"
    );
}

#[test]
fn an_install_root_that_is_too_broad_narrows_to_the_one_file() {
    let t = TempDir::new();
    let home = t.dir("home");
    let tool = exe(&t, "home/bin/tool");
    let forbidden = |p: &Path| p == home;
    assert_eq!(tool_root(&tool, &forbidden), Some(tool.clone()));
    assert_eq!(tool_root(&t.path().join("absent"), &forbidden), None);
}

#[test]
fn discover_collects_each_named_tool_once_and_ignores_the_missing() {
    let t = TempDir::new();
    exe(&t, "node-v24/bin/node");
    exe(&t, "node-v24/bin/npm");
    let agent = exe(&t, "opt/agent");
    let path = path_var(&[t.path().join("node-v24/bin"), t.path().join("opt")]);
    let names = ["node", "npm", "agent", "absent"].map(OsStr::new);
    let found = discover(&names, &path, &nothing_forbidden);
    assert_eq!(
        found.read_only,
        vec![t.path().join("node-v24"), agent.clone()]
    );
    assert_eq!(
        found.entry_points,
        vec![
            t.path().join("node-v24/bin/node"),
            t.path().join("node-v24/bin/npm"),
            agent
        ],
        "each tool as PATH names it"
    );
    assert!(found.path_prepend.is_empty());
}

#[test]
fn developer_tools_are_the_usr_tree_with_its_bin_first_on_path_when_it_has_git() {
    let t = TempDir::new();
    exe(&t, "Developer/usr/bin/git");
    let dev = t.path().join("Developer");
    assert_eq!(
        developer_tools(&dev),
        Discovered {
            read_only: vec![dev.join("usr")],
            entry_points: vec![],
            path_prepend: vec![dev.join("usr/bin")]
        }
    );
    let python = t.dir("Developer/Library/Frameworks/Python3.framework");
    assert_eq!(
        developer_tools(&dev).read_only,
        vec![dev.join("usr"), python],
        "python3 in usr/bin is a stub for this framework"
    );
    assert_eq!(
        developer_tools(&t.path().join("absent")),
        Discovered::default()
    );
}

#[test]
fn the_proxy_environment_sends_https_and_http_through_the_proxy_but_not_loopback() {
    let env = proxy_env(PROXY_PORT);
    let get = |k: &str| {
        env.iter()
            .find(|(name, _)| name == k)
            .map(|(_, v)| v.as_str())
    };
    for name in ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"] {
        assert_eq!(get(name), Some("http://127.0.0.1:41234"), "{name}");
    }
    for name in ["NO_PROXY", "no_proxy"] {
        assert_eq!(get(name), Some("localhost,127.0.0.1"), "{name}");
    }
    assert_eq!(get("NODE_USE_ENV_PROXY"), Some("1"));
}

#[test]
fn path_with_puts_directories_just_ahead_of_the_one_they_stand_in_for() {
    let usr_bin = Path::new("/usr/bin");
    let dev = [PathBuf::from("/dev/usr/bin")];
    let old = OsString::from("/own/bin:/usr/bin:/dev/usr/bin:/bin");
    assert_eq!(
        path_with(&dev, usr_bin, &old),
        OsString::from("/own/bin:/dev/usr/bin:/usr/bin:/bin"),
        "what was ahead of /usr/bin stays ahead: a tool of the caller's is never shadowed"
    );
    assert_eq!(
        path_with(&dev, usr_bin, OsStr::new("/own/bin:/bin")),
        OsString::from("/own/bin:/bin:/dev/usr/bin")
    );
    assert_eq!(path_with(&[], usr_bin, &old), old);
}

#[test]
fn exit_code_is_the_commands_code_or_128_plus_its_signal() {
    let status = Command::new("/bin/sh")
        .args(["-c", "exit 7"])
        .status()
        .unwrap();
    assert_eq!(exit_code(status), 7);
    let status = Command::new("/bin/sh")
        .args(["-c", "kill -TERM $$"])
        .status()
        .unwrap();
    assert_eq!(exit_code(status), 128 + libc::SIGTERM);
}
