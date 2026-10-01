//! The Seatbelt (SBPL) profile built from a policy. Pure text, so these run on any platform;
//! tests/sandbox.rs runs the real thing on macOS.

mod common;

use agent_sandbox::policy::Policy;
use agent_sandbox::ports::{Loopback, PortRange};
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
    let text = profile(&policy, &Loopback::default());
    Fixture {
        t,
        own,
        tools,
        agent,
        home,
        text,
    }
}

const MODEL_PORT: u16 = 18010;
const PROXY_PORT: u16 = 40123;
const OWN_PORTS: PortRange = PortRange {
    first: 18787,
    last: 18790,
};
const EPHEMERAL: PortRange = agent_sandbox::ports::IANA_DYNAMIC_PORTS;
const ANY_LOOPBACK_PORT: &str = "\"localhost:*\"";
/// Each loop is written as four lines: define, if, the rule, the next step.
const LOOP_LINES: usize = 4;
/// Every line of a loop's definition names its variable; a call names two port numbers.
const LOOP_VARIABLE: &str = "first";

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

/// The profile for the fixture's policy with this loopback access.
fn with_net(net: &Loopback) -> String {
    let t = TempDir::new();
    let own = t.dir("run");
    profile(&Policy::new(&own, &[], None).unwrap(), net)
}

/// The lines that grant something on the network: `allow` rules and calls of the two loops
/// (not the rule inside a loop's definition, which grants nothing until the loop is called).
fn network_grants(text: &str) -> Vec<&str> {
    rules(text)
        .into_iter()
        .filter(|l| !l.contains(LOOP_VARIABLE))
        .filter(|l| {
            (l.starts_with("(allow") && l.contains("network"))
                || l.starts_with("(connect-to ")
                || l.starts_with("(listen-on ")
        })
        .collect()
}

#[test]
fn with_no_port_named_there_is_no_network_rule_at_all() {
    let text = with_net(&Loopback::default());
    assert!(network_grants(&text).is_empty(), "{text}");
    for line in rules(&text) {
        assert!(
            !line.contains("network") && !line.contains("localhost:"),
            "{line}"
        );
    }
}

#[test]
fn no_rule_ever_opens_every_loopback_port_to_connect_to() {
    for net in [
        Loopback::default(),
        Loopback::new(&[MODEL_PORT], &[OWN_PORTS], None).unwrap(),
        Loopback::new(&[MODEL_PORT], &[OWN_PORTS], Some(EPHEMERAL)).unwrap(),
    ] {
        let text = with_net(&net);
        for line in rules(&text) {
            assert!(
                !(line.contains("network-outbound") && line.contains(ANY_LOOPBACK_PORT)),
                "every loopback port is reachable: {line}"
            );
            assert!(!line.contains("\"*:"), "another machine: {line}");
            assert!(
                !line.contains("(remote ip") && !line.contains("(local ip"),
                "TCP only, UDP stays closed: {line}"
            );
        }
        assert!(!rules(&text).contains(&"(allow network*)"));
    }
}

#[test]
fn a_host_port_can_be_connected_to_and_nothing_more() {
    let text = with_net(&Loopback::new(&[MODEL_PORT, PROXY_PORT], &[], None).unwrap());
    assert_eq!(
        network_grants(&text),
        ["(connect-to 18010 18010)", "(connect-to 40123 40123)"],
        "{text}"
    );
    assert!(
        !text.contains("network-bind") && !text.contains("network-inbound"),
        "nothing can be served: {text}"
    );
}

#[test]
fn agent_ports_can_be_served_on_and_connected_to() {
    let text = with_net(&Loopback::new(&[MODEL_PORT], &[OWN_PORTS], None).unwrap());
    assert_eq!(
        network_grants(&text),
        [
            "(connect-to 18010 18010)",
            "(listen-on 18787 18790)",
            "(connect-to 18787 18790)"
        ],
        "{text}"
    );
    assert!(!text.contains(ANY_LOOPBACK_PORT), "{text}");
}

#[test]
fn the_loops_name_one_tcp_loopback_port_at_a_time() {
    let text = with_net(&Loopback::new(&[MODEL_PORT], &[OWN_PORTS], None).unwrap());
    let r = rules(&text);
    let body = |name: &str| {
        let at = r
            .iter()
            .position(|l| l.starts_with(&format!("(define ({name} first last)")))
            .unwrap_or_else(|| panic!("{name} is not defined: {text}"));
        r[at..at + LOOP_LINES].join(" ")
    };
    let port = "(string-append \"localhost:\" (number->string first))";
    assert!(
        body("connect-to").contains(&format!("(allow network-outbound (remote tcp {port}))")),
        "{text}"
    );
    assert!(
        body("listen-on").contains(&format!(
            "(allow network-bind network-inbound (local tcp {port}))"
        )),
        "{text}"
    );
    for name in ["connect-to", "listen-on"] {
        assert!(body(name).contains(&format!("({name} (+ first 1) last)")));
        assert!(body(name).contains("(if (<= first last)"));
    }
}

#[test]
fn ephemeral_ports_open_binding_and_only_that_range_to_connect_to() {
    let text = with_net(&Loopback::new(&[MODEL_PORT], &[OWN_PORTS], Some(EPHEMERAL)).unwrap());
    assert_eq!(
        network_grants(&text),
        [
            "(connect-to 18010 18010)",
            "(connect-to 18787 18790)",
            "(allow network-bind network-inbound (local tcp \"localhost:*\"))",
            "(connect-to 49152 65535)"
        ],
        "{text}"
    );
    let narrowed = with_net(
        &Loopback::new(
            &[],
            &[],
            Some(PortRange {
                first: 61000,
                last: 65535,
            }),
        )
        .unwrap(),
    );
    assert!(
        network_grants(&narrowed).contains(&"(connect-to 61000 65535)"),
        "the machine's own range is used: {narrowed}"
    );
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
    let text = profile(&Policy::new(&own, &[], None).unwrap(), &Loopback::default());
    assert!(!rules(&text).contains(&"(allow default)"));
    assert!(text.contains("run\\\")) (allow default) ((\\\""));
}

#[test]
fn a_symlink_on_the_way_in_is_stat_only() {
    let t = TempDir::new();
    let own = t.dir("run");
    let real = t.dir("browsers-v1");
    std::os::unix::fs::symlink(&real, t.path().join("browsers")).unwrap();
    let text = profile(
        &Policy::new(&own, &[t.path().join("browsers")], None).unwrap(),
        &Loopback::default(),
    );
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
    let net = Loopback::new(&[MODEL_PORT], &[], None).unwrap();
    let argv = command(
        &policy,
        &net,
        &[OsString::from("npm"), OsString::from("install")],
    );
    assert_eq!(argv[0], OsString::from(SANDBOX_EXEC));
    assert_eq!(argv[1], OsString::from("-p"));
    assert_eq!(argv[2], OsString::from(profile(&policy, &net)));
    assert_eq!(
        &argv[3..],
        [OsString::from("npm"), OsString::from("install")]
    );
}

#[test]
fn a_path_inside_the_run_is_denied_for_writing_after_the_run_is_allowed() {
    let t = TempDir::new();
    let own = t.dir("home/work/run-a");
    t.dir("home/work/run-a/workspace/spec");
    let policy = Policy::new(&own, &[], None)
        .unwrap()
        .read_only_inside(&[PathBuf::from("workspace/spec")])
        .unwrap();
    let text = profile(&policy, &Loopback::default());
    let allow = text
        .find(&format!("(allow file-read* file-write* (subpath {}))", quote(policy.own_dir.to_str().unwrap())))
        .expect("the run is writable");
    let deny = text
        .find(&format!("(deny file-write* (subpath {}))", quote(policy.own_dir.join("workspace/spec").to_str().unwrap())))
        .expect("the spec is denied for writing");
    assert!(deny > allow, "SBPL applies the last matching rule: the deny comes after the allow");
    assert!(text.trim_end().ends_with(")"), "{text}");
    let plain = profile(&Policy::new(&own, &[], None).unwrap(), &Loopback::default());
    assert!(!plain.contains("(deny file-write*"), "no deny unless a path was named");
}
