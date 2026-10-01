//! The policy: which paths a command may write, read, or only see the existence of.

mod common;

use agent_sandbox::paths::{normalise, strict_ancestors, symlinks_on, within};
use agent_sandbox::policy::{Link, Policy, ReadOnly};
use common::TempDir;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

fn ro_paths(p: &Policy) -> Vec<PathBuf> {
    p.read_only.iter().map(|r| r.path.clone()).collect()
}

#[test]
fn normalise_resolves_symlinks_and_reports_missing_paths() {
    let t = TempDir::new();
    let real = t.dir("real");
    symlink(&real, t.path().join("link")).unwrap();
    assert_eq!(
        normalise(&t.path().join("link")).unwrap(),
        Some(real.clone())
    );
    assert_eq!(
        normalise(&t.path().join("link/../real")).unwrap(),
        Some(real)
    );
    assert_eq!(normalise(&t.path().join("absent")).unwrap(), None);
}

#[test]
fn normalise_refuses_a_relative_path() {
    assert!(normalise(Path::new("relative/dir")).is_err());
}

#[cfg(target_os = "macos")]
#[test]
fn normalise_follows_the_macos_root_symlinks() {
    assert_eq!(
        normalise(Path::new("/tmp")).unwrap(),
        Some(PathBuf::from("/private/tmp"))
    );
    assert_eq!(
        normalise(Path::new("/var")).unwrap(),
        Some(PathBuf::from("/private/var"))
    );
    assert_eq!(
        normalise(Path::new("/etc/hosts")).unwrap(),
        Some(PathBuf::from("/private/etc/hosts"))
    );
}

#[test]
fn within_is_by_component_not_by_prefix_text() {
    assert!(within(Path::new("/a/b"), Path::new("/a/b")));
    assert!(within(Path::new("/a/b/c"), Path::new("/a/b")));
    assert!(!within(Path::new("/a/bc"), Path::new("/a/b")));
    assert!(!within(Path::new("/a"), Path::new("/a/b")));
}

#[test]
fn strict_ancestors_leave_out_the_root_and_the_path_itself() {
    assert_eq!(
        strict_ancestors(Path::new("/a/b/c")),
        vec![PathBuf::from("/a"), PathBuf::from("/a/b")]
    );
    assert!(strict_ancestors(Path::new("/a")).is_empty());
}

#[test]
fn symlinks_on_lists_every_link_met_on_the_way() {
    let t = TempDir::new();
    let real = t.dir("store/v1");
    symlink("store/v1", t.path().join("current")).unwrap();
    symlink(t.path().join("current"), t.path().join("alias")).unwrap();
    std::fs::write(real.join("tool"), "x").unwrap();
    let found = symlinks_on(&t.path().join("alias/tool"));
    assert_eq!(
        found,
        vec![
            (t.path().join("alias"), t.path().join("current")),
            (t.path().join("current"), PathBuf::from("store/v1")),
        ]
    );
    assert!(symlinks_on(&real.join("tool")).is_empty());
}

#[test]
fn own_dir_must_be_an_existing_directory() {
    let t = TempDir::new();
    assert!(Policy::new(&t.path().join("absent"), &[], None).is_err());
    let file = t.file("file", "x");
    assert!(Policy::new(&file, &[], None).is_err());
}

#[test]
fn own_dir_may_not_be_the_root_the_home_or_above_the_home() {
    let t = TempDir::new();
    let home = t.dir("users/someone");
    assert!(Policy::new(Path::new("/"), &[], None).is_err());
    assert!(Policy::new(&home, &[], Some(&home)).is_err());
    assert!(Policy::new(&t.path().join("users"), &[], Some(&home)).is_err());
    let own = t.dir("users/someone/work/run");
    assert!(Policy::new(&own, &[], Some(&home)).is_ok());
}

#[test]
fn own_dir_and_read_only_paths_are_normalised() {
    let t = TempDir::new();
    let own = t.dir("work/run");
    let tools = t.dir("tools-v2");
    symlink(&own, t.path().join("own-link")).unwrap();
    symlink(&tools, t.path().join("tools")).unwrap();
    let p = Policy::new(&t.path().join("own-link"), &[t.path().join("tools")], None).unwrap();
    assert_eq!(p.own_dir, own);
    assert_eq!(
        p.read_only,
        vec![ReadOnly {
            path: tools.clone(),
            is_dir: true
        }]
    );
    assert_eq!(
        p.links,
        vec![
            Link {
                at: t.path().join("own-link"),
                target: own.clone()
            },
            Link {
                at: t.path().join("tools"),
                target: tools
            },
        ],
        "the links are kept so the paths still resolve as they were written"
    );
    assert_eq!(p.own_tmp(), own.join("tmp"));
}

#[test]
fn a_read_only_file_is_marked_as_a_file() {
    let t = TempDir::new();
    let own = t.dir("run");
    let exe = t.file("opt/agent", "#!/bin/sh\n");
    let p = Policy::new(&own, std::slice::from_ref(&exe), None).unwrap();
    assert_eq!(
        p.read_only,
        vec![ReadOnly {
            path: exe,
            is_dir: false
        }]
    );
}

#[test]
fn a_missing_read_only_path_is_recorded_and_not_allowed() {
    let t = TempDir::new();
    let own = t.dir("run");
    let absent = t.path().join("tools-not-installed");
    let p = Policy::new(&own, std::slice::from_ref(&absent), None).unwrap();
    assert!(p.read_only.is_empty());
    assert_eq!(p.missing, vec![absent]);
}

#[test]
fn read_only_paths_are_sorted_deduplicated_and_not_nested() {
    let t = TempDir::new();
    let own = t.dir("run");
    let b = t.dir("b");
    let a = t.dir("a");
    let inner = t.dir("a/inner");
    let p = Policy::new(&own, &[b.clone(), inner, a.clone(), b.clone()], None).unwrap();
    assert_eq!(ro_paths(&p), vec![a, b]);
}

#[test]
fn a_read_only_path_inside_own_dir_is_dropped_because_own_dir_is_writable() {
    let t = TempDir::new();
    let own = t.dir("run");
    let inside = t.dir("run/workspace/vendor");
    let p = Policy::new(&own, &[inside], None).unwrap();
    assert!(p.read_only.is_empty());
}

#[test]
fn a_read_only_path_that_would_expose_other_runs_or_the_home_is_refused() {
    let t = TempDir::new();
    let home = t.dir("home");
    let own = t.dir("home/work/run-a");
    t.dir("home/work/run-b");
    for bad in [
        PathBuf::from("/"),
        t.path().join("home/work"),
        home.clone(),
        t.path().to_path_buf(),
    ] {
        let err = Policy::new(&own, std::slice::from_ref(&bad), Some(&home)).unwrap_err();
        assert!(err.to_string().contains("--ro"), "{bad:?}: {err}");
    }
    let fine = t.dir("home/.toolchain");
    assert!(Policy::new(&own, &[fine], Some(&home)).is_ok());
}

#[test]
fn metadata_only_paths_are_the_ancestors_of_what_is_allowed_and_nothing_beside_them() {
    let t = TempDir::new();
    let own = t.dir("home/work/run-a");
    let sibling = t.dir("home/work/run-b");
    let tools = t.dir("home/tools/node");
    let p = Policy::new(&own, std::slice::from_ref(&tools), None).unwrap();
    let meta = p.metadata_only();
    for expected in [
        t.path().join("home"),
        t.path().join("home/work"),
        t.path().join("home/tools"),
    ] {
        assert!(
            meta.contains(&expected),
            "{expected:?} missing from {meta:?}"
        );
    }
    assert!(!meta.contains(&PathBuf::from("/")));
    assert!(!meta.contains(&own));
    assert!(!meta.contains(&tools));
    assert!(!meta.contains(&sibling));
    assert!(!meta.contains(&t.path().join("home/node_modules")));
    let mut sorted = meta.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(meta, sorted, "sorted, no duplicates");
}
