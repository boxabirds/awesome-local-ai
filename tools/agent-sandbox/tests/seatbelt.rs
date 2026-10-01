//! The Seatbelt (SBPL) profile built from a policy. Pure text, so these run on any platform;
//! tests/sandbox.rs runs the real thing on macOS.

mod common;

use agent_sandbox::policy::Policy;
use agent_sandbox::seatbelt::{command, profile, quote, SANDBOX_EXEC};
use common::TempDir;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

struct Fixture {
    t: TempDir,
    own: PathBuf,
    tools: PathBuf,
    agent: PathBuf,
    home: PathBuf,
    text: String,
}

fn fixture() -> Fixture {
    let t = TempDir::new();
    let home = t.dir("home");
    let own = t.dir("home/work/run-a");
    t.dir("home/work/run-b");
    let tools = t.dir("home/toolchain/node");
    let agent = t.file("home/opt/agent", "x");
    let policy = Policy::new(
        &own,
        &[tools.clone(), agent.clone(), t.path().join("absent")],
        Some(&home),
    )
    .unwrap();
    let text = profile(&policy);
    Fixture {
        t,
        own,
        tools,
        agent,
        home,
        text,
    }
}

fn s(p: &Path) -> &str {
    p.to_str().unwrap()
}

/// The profile's rules, one per line, without comments and blank lines.
fn rules(text: &str) -> Vec<&str> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with(';'))
        .collect()
}

#[test]
fn it_denies_by_default() {
    let f = fixture();
    let r = rules(&f.text);
    assert_eq!(&r[..2], ["(version 1)", "(deny default)"]);
    assert!(!f.text.contains("(allow default)"));
    for broad in [
        "(allow file-read*)",
        "(allow file-write*)",
        "(allow network*)",
        "(allow mach-lookup)",
        "(allow process-exec)",
        "(allow file*)",
    ] {
        assert!(
            !r.contains(&broad),
            "{broad} would allow everything of its kind"
        );
    }
}

#[test]
fn own_dir_is_the_only_writable_tree_and_its_rule_comes_last() {
    let f = fixture();
    let r = rules(&f.text);
    let own_rule = format!("(allow file-read* file-write* (subpath \"{}\"))", s(&f.own));
    assert_eq!(
        r.last().copied(),
        Some(own_rule.as_str()),
        "SBPL applies the last matching rule"
    );
    let writable: Vec<&&str> = r.iter().filter(|l| l.contains("file-write")).collect();
    for rule in &writable {
        assert!(
            rule.contains(s(&f.own)) || rule.contains("\"/dev/"),
            "a write rule outside own_dir and /dev: {rule}"
        );
    }
    assert!(
        !f.text.contains("run-b"),
        "another run's directory is never named"
    );
}

#[test]
fn read_only_paths_can_be_read_and_run_but_not_written() {
    let f = fixture();
    assert!(
        f.text.contains(&format!("(subpath \"{}\")", s(&f.tools))),
        "a directory is a subpath"
    );
    assert!(
        f.text.contains(&format!("(literal \"{}\")", s(&f.agent))),
        "a file is a literal"
    );
    for line in rules(&f.text) {
        if line.contains(s(&f.tools)) || line.contains(s(&f.agent)) {
            assert!(!line.contains("file-write"), "{line}");
        }
    }
    assert!(
        !f.text.contains("absent"),
        "a missing path is not allowed in advance"
    );
}

#[test]
fn ancestors_get_metadata_only_so_paths_resolve_but_nothing_beside_them_is_listed() {
    let f = fixture();
    let meta: Vec<&str> = rules(&f.text)
        .into_iter()
        .filter(|l| l.starts_with("(allow file-read-metadata"))
        .collect();
    let joined = meta.join("\n");
    for dir in [
        f.home.clone(),
        f.home.join("work"),
        f.home.join("toolchain"),
    ] {
        assert!(
            joined.contains(&format!("(literal \"{}\")", s(&dir))),
            "{dir:?}"
        );
    }
    for line in rules(&f.text) {
        assert!(
            !line.contains(&format!("(subpath \"{}\")", s(&f.home))),
            "the home is never opened as a tree: {line}"
        );
        assert!(
            !line.contains(&format!("(subpath \"{}\")", s(f.t.path()))),
            "{line}"
        );
        if line.contains(&format!("(literal \"{}\")", s(&f.home))) {
            assert!(
                line.starts_with("(allow file-read-metadata"),
                "the home itself is stat-only: {line}"
            );
        }
    }
    assert!(!f.text.contains("node_modules"));
}

#[test]
fn the_network_is_loopback_only() {
    let f = fixture();
    let net: Vec<&str> = rules(&f.text)
        .into_iter()
        .filter(|l| l.contains("network"))
        .collect();
    assert!(!net.is_empty());
    for line in &net {
        assert!(
            line.contains("\"localhost:*\""),
            "a network rule that is not loopback: {line}"
        );
        assert!(!line.contains("\"*:"), "{line}");
    }
    assert!(net
        .iter()
        .any(|l| l.starts_with("(allow network-outbound (remote ip \"localhost:*\")")));
}

#[test]
fn name_lookups_and_the_per_user_temp_directory_stay_closed() {
    let f = fixture();
    for service in [
        "com.apple.mDNSResponder",
        "com.apple.dnssd.service",
        "com.apple.bsd.dirhelper",
        "com.apple.sysmond",
    ] {
        assert!(
            !f.text.contains(&format!("\"{service}\"")),
            "{service} must stay denied"
        );
    }
    let user_temp = std::env::temp_dir().canonicalize().unwrap();
    assert!(
        !f.text.contains(&format!("(subpath \"{}\")", s(&user_temp))),
        "the shared temp directory is not opened"
    );
    assert!(!f.text.contains("(subpath \"/private/tmp\")"));
    assert!(!f.text.contains("(subpath \"/tmp\")"));
}

#[test]
fn other_processes_cannot_be_signalled_or_inspected() {
    let f = fixture();
    let r = rules(&f.text);
    assert!(r.contains(&"(allow signal (target same-sandbox))"));
    assert!(r.contains(&"(deny process-info* (target others))"));
    assert!(!r.contains(&"(allow signal)"));
}

#[test]
fn every_group_of_rules_says_why_it_is_there() {
    let f = fixture();
    let mut previous_was_comment = false;
    let mut in_group = false;
    for line in f.text.lines().skip(2) {
        let line = line.trim();
        if line.is_empty() {
            in_group = false;
        } else if line.starts_with(';') {
            previous_was_comment = true;
            in_group = true;
            continue;
        } else {
            assert!(
                in_group || previous_was_comment,
                "a rule with no reason above it: {line}"
            );
        }
        previous_was_comment = false;
    }
}

#[test]
fn quote_escapes_what_would_end_or_change_a_string() {
    assert_eq!(quote("/a/b"), "\"/a/b\"");
    assert_eq!(quote("/a \"b\"\\c"), "\"/a \\\"b\\\"\\\\c\"");
}

#[test]
fn a_path_with_a_quote_in_it_cannot_break_out_of_its_rule() {
    let t = TempDir::new();
    let own = t.dir("run\")) (allow default) ((\"");
    let text = profile(&Policy::new(&own, &[], None).unwrap());
    assert!(!rules(&text).contains(&"(allow default)"));
    assert!(text.contains("run\\\")) (allow default) ((\\\""));
}

#[test]
fn a_symlink_on_the_way_in_is_stat_only() {
    let t = TempDir::new();
    let own = t.dir("run");
    let real = t.dir("browsers-v1");
    std::os::unix::fs::symlink(&real, t.path().join("browsers")).unwrap();
    let text = profile(&Policy::new(&own, &[t.path().join("browsers")], None).unwrap());
    let link = format!("(literal \"{}\")", s(&t.path().join("browsers")));
    let naming: Vec<&str> = rules(&text)
        .into_iter()
        .filter(|l| l.contains(&link))
        .collect();
    assert!(!naming.is_empty());
    assert!(naming
        .iter()
        .all(|l| l.starts_with("(allow file-read-metadata")));
}

#[test]
fn the_command_is_sandbox_exec_with_the_profile_inline() {
    let t = TempDir::new();
    let own = t.dir("run");
    let policy = Policy::new(&own, &[], None).unwrap();
    let argv = command(&policy, &[OsString::from("npm"), OsString::from("install")]);
    assert_eq!(argv[0], OsString::from(SANDBOX_EXEC));
    assert_eq!(argv[1], OsString::from("-p"));
    assert_eq!(argv[2], OsString::from(profile(&policy)));
    assert_eq!(
        &argv[3..],
        [OsString::from("npm"), OsString::from("install")]
    );
}
