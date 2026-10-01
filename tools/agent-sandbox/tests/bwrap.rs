//! The bubblewrap command line built from a policy. Pure: the host's layout is faked, so these run
//! on any platform; tests/sandbox.rs runs the real thing on Linux.

mod common;

use agent_sandbox::bwrap::{
    command, socket_name, HostFs, Kind, Net, BWRAP, INNER_ARGV0, INNER_ENV, INNER_EXE, INNER_SOCKETS,
    SANDBOX_HOSTNAME,
};
use agent_sandbox::policy::Policy;
use common::TempDir;
use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

const MODEL_PORT: u16 = 18010;
const PROXY_PORT: u16 = 41234;

/// A made-up host: a merged-/usr distribution unless a test says otherwise.
struct FakeFs(HashMap<PathBuf, Kind>);

impl FakeFs {
    fn merged_usr() -> FakeFs {
        let mut m = HashMap::new();
        for d in ["/usr", "/etc/ssl", "/etc/alternatives", "/etc/fonts"] {
            m.insert(PathBuf::from(d), Kind::Dir);
        }
        for f in [
            "/etc/hosts",
            "/etc/passwd",
            "/etc/group",
            "/etc/nsswitch.conf",
            "/etc/ld.so.cache",
        ] {
            m.insert(PathBuf::from(f), Kind::File);
        }
        for (link, target) in [
            ("/bin", "usr/bin"),
            ("/sbin", "usr/sbin"),
            ("/lib", "usr/lib"),
            ("/lib64", "usr/lib64"),
        ] {
            m.insert(PathBuf::from(link), Kind::Symlink(PathBuf::from(target)));
        }
        m.insert(
            PathBuf::from("/etc/localtime"),
            Kind::Symlink(PathBuf::from("/usr/share/zoneinfo/Etc/UTC")),
        );
        FakeFs(m)
    }
}

impl HostFs for FakeFs {
    fn kind(&self, path: &Path) -> Kind {
        self.0.get(path).cloned().unwrap_or(Kind::Missing)
    }
}

struct Fixture {
    _t: TempDir,
    policy: Policy,
    own: PathBuf,
    tools: PathBuf,
    agent: PathBuf,
}

fn fixture() -> Fixture {
    let t = TempDir::new();
    let own = t.dir("work/run-a");
    t.dir("work/run-a/tmp");
    let tools = t.dir("toolchain/node");
    let agent = t.file("opt/agent", "x");
    let policy = Policy::new(
        &own,
        &[tools.clone(), agent.clone(), t.path().join("absent")],
        None,
    )
    .unwrap();
    Fixture {
        _t: t,
        policy,
        own,
        tools,
        agent,
    }
}

fn strings(argv: &[OsString]) -> Vec<String> {
    argv.iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

fn build(f: &Fixture, net: &Net, cmd: &[&str]) -> Vec<String> {
    let cmd: Vec<OsString> = cmd.iter().map(OsString::from).collect();
    strings(&command(&f.policy, &FakeFs::merged_usr(), net, &cmd))
}

/// Index of the first place `needle` appears as a run of consecutive arguments.
fn position(argv: &[String], needle: &[&str]) -> Option<usize> {
    argv.windows(needle.len())
        .position(|w| w.iter().map(String::as_str).eq(needle.iter().copied()))
}

fn has(argv: &[String], needle: &[&str]) -> bool {
    position(argv, needle).is_some()
}

fn s(p: &Path) -> &str {
    p.to_str().unwrap()
}

#[test]
fn it_starts_from_an_empty_root_and_never_binds_the_real_one() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["true"]);
    assert_eq!(argv[0], BWRAP);
    let root = position(&argv, &["--tmpfs", "/"]).expect("an empty root");
    for (i, a) in argv.iter().enumerate() {
        if [
            "--bind",
            "--ro-bind",
            "--symlink",
            "--proc",
            "--dev",
            "--dir",
        ]
        .contains(&a.as_str())
        {
            assert!(i > root, "{a} at {i} comes before the empty root");
        }
    }
    assert!(!has(&argv, &["--bind", "/", "/"]));
    assert!(!has(&argv, &["--ro-bind", "/", "/"]));
    assert!(!has(&argv, &["--dev-bind", "/dev", "/dev"]));
}

#[test]
fn it_isolates_processes_ipc_and_hostname_and_dies_with_its_parent() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["true"]);
    for flag in [
        "--die-with-parent",
        "--new-session",
        "--unshare-pid",
        "--unshare-ipc",
        "--unshare-uts",
    ] {
        assert!(argv.iter().any(|a| a == flag), "{flag} missing");
    }
    assert!(has(&argv, &["--hostname", SANDBOX_HOSTNAME]));
    assert!(has(&argv, &["--proc", "/proc"]));
    assert!(has(&argv, &["--dev", "/dev"]));
}

#[test]
fn system_directories_are_read_only_and_root_symlinks_are_recreated() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["true"]);
    assert!(has(&argv, &["--ro-bind", "/usr", "/usr"]));
    assert!(has(&argv, &["--symlink", "usr/bin", "/bin"]));
    assert!(has(&argv, &["--symlink", "usr/lib64", "/lib64"]));
    assert!(has(&argv, &["--ro-bind", "/etc/ssl", "/etc/ssl"]));
    assert!(has(&argv, &["--ro-bind", "/etc/hosts", "/etc/hosts"]));
    assert!(has(
        &argv,
        &["--symlink", "/usr/share/zoneinfo/Etc/UTC", "/etc/localtime"]
    ));
    assert!(!argv.iter().any(|a| a == "/etc"), "never the whole of /etc");
    assert!(
        !argv.iter().any(|a| a == "/lib32"),
        "a path this host lacks is not bound"
    );
    assert!(
        !argv.iter().any(|a| a == "/etc/resolv.conf"),
        "no name resolution: outbound goes through the proxy"
    );
    assert!(!argv.iter().any(|a| a == "/home"
        || a == "/root"
        || a == "/var"
        || a == "/mnt"
        || a == "/media"
        || a == "/srv"));
}

#[test]
fn a_real_bin_directory_is_bound_instead_of_linked() {
    let f = fixture();
    let mut fs = FakeFs::merged_usr();
    fs.0.insert(PathBuf::from("/bin"), Kind::Dir);
    let argv = strings(&command(
        &f.policy,
        &fs,
        &Net::Shared,
        &[OsString::from("true")],
    ));
    assert!(has(&argv, &["--ro-bind", "/bin", "/bin"]));
}

#[test]
fn read_only_paths_are_bound_read_only_and_missing_ones_are_left_out() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["true"]);
    assert!(has(&argv, &["--ro-bind", s(&f.tools), s(&f.tools)]));
    assert!(has(&argv, &["--ro-bind", s(&f.agent), s(&f.agent)]));
    assert!(!argv.iter().any(|a| a.ends_with("/absent")));
}

#[test]
fn a_symlink_on_the_way_to_a_read_only_path_is_recreated() {
    let t = TempDir::new();
    let own = t.dir("run");
    let real = t.dir("browsers-v1");
    std::os::unix::fs::symlink(&real, t.path().join("browsers")).unwrap();
    let policy = Policy::new(&own, &[t.path().join("browsers")], None).unwrap();
    let argv = strings(&command(
        &policy,
        &FakeFs::merged_usr(),
        &Net::Shared,
        &[OsString::from("true")],
    ));
    assert!(has(&argv, &["--ro-bind", s(&real), s(&real)]));
    assert!(has(
        &argv,
        &["--symlink", s(&real), s(&t.path().join("browsers"))]
    ));
}

#[test]
fn the_shared_temp_directories_are_the_runs_own_and_own_dir_is_mounted_last() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["npm", "install"]);
    let own_tmp = f.own.join("tmp");
    let tmp = position(&argv, &["--bind", s(&own_tmp), "/tmp"]).expect("/tmp is the run's own");
    assert!(has(&argv, &["--bind", s(&own_tmp), "/var/tmp"]));
    let own = position(&argv, &["--bind", s(&f.own), s(&f.own)]).expect("own_dir is writable");
    assert!(
        own > tmp,
        "own_dir is mounted after /tmp so a run directory under /tmp stays visible"
    );
    let tail: Vec<&str> = argv[own..].iter().map(String::as_str).collect();
    assert_eq!(
        tail,
        ["--bind", s(&f.own), s(&f.own), "--remount-ro", "/", "--", "npm", "install"],
        "nothing is mounted after own_dir, and the root that was built around it is then made read-only"
    );
    assert_eq!(
        argv.iter().filter(|a| *a == "--bind").count(),
        3,
        "the only writable mounts are own_dir and its tmp"
    );
}

#[test]
fn a_shared_network_namespace_is_only_used_when_asked_for() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["true"]);
    assert!(!argv.iter().any(|a| a == "--unshare-net"));
    assert!(!argv.iter().any(|a| a.starts_with("/run/agent-sandbox")));
}

#[test]
fn an_isolated_network_starts_the_bridge_program_as_the_first_process_and_lists_no_command() {
    let f = fixture();
    let net = Net::Isolated {
        bridge_dir: PathBuf::from("/tmp/agent-sandbox-bridge-1"),
        self_exe: PathBuf::from("/opt/tools/agent-sandbox"),
        ports: vec![MODEL_PORT, PROXY_PORT],
    };
    let argv = build(&f, &net, &["npm", "install", "--a-secret-prompt"]);
    assert!(argv.iter().any(|a| a == "--unshare-net"));
    assert!(has(
        &argv,
        &["--ro-bind", "/opt/tools/agent-sandbox", INNER_EXE]
    ));
    assert!(has(
        &argv,
        &["--ro-bind", "/tmp/agent-sandbox-bridge-1", INNER_SOCKETS]
    ));
    let own = position(&argv, &["--bind", s(&f.own), s(&f.own)]).unwrap();
    let tail: Vec<&str> = argv[own + 3..].iter().map(String::as_str).collect();
    assert_eq!(
        tail,
        [
            "--remount-ro",
            "/",
            "--as-pid-1",
            "--setenv",
            INNER_ENV,
            "1",
            "--argv0",
            INNER_ARGV0,
            "--",
            INNER_EXE
        ]
    );
    // Neither bwrap's mounts nor the command's arguments are left on any command line inside.
    assert!(!argv.iter().any(|a| a == "npm" || a == "--a-secret-prompt"));
}

#[test]
fn a_shared_network_runs_the_command_directly_after_the_mounts() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["npm", "install"]);
    let own = position(&argv, &["--bind", s(&f.own), s(&f.own)]).unwrap();
    let tail: Vec<&str> = argv[own + 3..].iter().map(String::as_str).collect();
    assert_eq!(tail, ["--remount-ro", "/", "--", "npm", "install"]);
}

#[test]
fn no_capability_is_kept() {
    let f = fixture();
    let argv = build(&f, &Net::Shared, &["true"]);
    assert!(has(&argv, &["--cap-drop", "ALL"]));
}

#[test]
fn own_dir_can_be_shown_at_a_short_path_with_the_spec_mounted_read_only_over_it_and_a_start_directory() {
    let t = TempDir::new();
    let own = t.dir("work/run-a");
    t.dir("work/run-a/tmp");
    t.dir("work/run-a/workspace/spec");
    let policy = Policy::new(&own, &[], None)
        .unwrap()
        .shown_at(Path::new("/w"))
        .unwrap()
        .read_only_inside(&[PathBuf::from("workspace/spec")])
        .unwrap()
        .starting_in(Path::new("workspace"))
        .unwrap();
    let argv = strings(&command(
        &policy,
        &FakeFs::merged_usr(),
        &Net::Shared,
        &[OsString::from("true")],
    ));
    let spec = policy.own_dir.join("workspace/spec");
    let bind = position(&argv, &["--bind", s(&policy.own_dir), "/w"]).expect("own_dir at /w");
    let ro = position(&argv, &["--ro-bind", s(&spec), "/w/workspace/spec"]).expect("spec read-only");
    assert!(ro > bind, "a later mount covers an earlier one: the spec goes after own_dir");
    assert!(has(&argv, &["--chdir", "/w/workspace"]));
    // The run's real path appears nowhere as a destination: only as the source of its own mounts.
    assert!(!has(&argv, &["--bind", s(&policy.own_dir), s(&policy.own_dir)]));
}

#[test]
fn socket_names_are_short_and_one_per_port() {
    assert_eq!(socket_name(MODEL_PORT), "18010.sock");
    assert_ne!(socket_name(MODEL_PORT), socket_name(PROXY_PORT));
}
