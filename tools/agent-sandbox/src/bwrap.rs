//! Linux: the policy as a bubblewrap command line.
//!
//! The sandbox's filesystem starts empty (`--tmpfs /`) and gets only what the policy names, bound
//! read-only, with own_dir bound read-write last. bubblewrap applies mounts in order and a later
//! mount covers an earlier one, so own_dir comes after /tmp (a run directory may itself be under
//! /tmp). What is not bound does not exist in there: no home, no repo, no other run, no
//! node_modules above the run.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use crate::policy::Policy;

pub const BWRAP: &str = "bwrap";
/// What the sandbox sees as the machine's name, in place of the real one (--unshare-uts).
pub const SANDBOX_HOSTNAME: &str = "agent-sandbox";
/// Where this program and the bridge's sockets appear inside an isolated-network sandbox.
pub const INNER_EXE: &str = "/run/agent-sandbox/bin/agent-sandbox";
pub const INNER_SOCKETS: &str = "/run/agent-sandbox/sockets";
pub const INNER_SUBCOMMAND: &str = "inner";

/// The system: programs and libraries. On a merged-/usr distribution /bin, /sbin and /lib* are
/// symlinks into /usr and are recreated as such; otherwise they are bound.
const SYSTEM_PATHS: &[&str] = &[
    "/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/libx32",
];
/// The parts of /etc the workload reads, never the whole of it: the dynamic linker's cache and
/// search path, account and service-name lookup, `localhost`, CA certificates, the time zone,
/// Debian's alternatives links (many /usr/bin tools are links through them), and font
/// configuration for Chromium. /etc/resolv.conf is left out: there is no DNS in the sandbox.
const ETC_PATHS: &[&str] = &[
    "/etc/ld.so.cache",
    "/etc/ld.so.conf",
    "/etc/ld.so.conf.d",
    "/etc/passwd",
    "/etc/group",
    "/etc/nsswitch.conf",
    "/etc/hosts",
    "/etc/ssl",
    "/etc/ca-certificates",
    "/etc/pki",
    "/etc/localtime",
    "/etc/alternatives",
    "/etc/fonts",
];
/// The shared temp directories, replaced by the run's own.
const SHARED_TMP: &[&str] = &["/tmp", "/var/tmp"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    Missing,
    Dir,
    File,
    /// A symlink, with its target as written.
    Symlink(PathBuf),
}

/// What is at a path on the host, so the command line can be built (and tested) without one.
pub trait HostFs {
    fn kind(&self, path: &Path) -> Kind;
}

pub struct RealFs;

impl HostFs for RealFs {
    fn kind(&self, path: &Path) -> Kind {
        match std::fs::symlink_metadata(path) {
            Err(_) => Kind::Missing,
            Ok(m) if m.file_type().is_symlink() => std::fs::read_link(path)
                .map(Kind::Symlink)
                .unwrap_or(Kind::Missing),
            Ok(m) if m.is_dir() => Kind::Dir,
            Ok(_) => Kind::File,
        }
    }
}

/// How the sandbox reaches the network.
#[derive(Debug, Clone)]
pub enum Net {
    /// The host's network namespace: every address the host can reach. Enforces nothing.
    Shared,
    /// A new, empty namespace with only its own loopback. `ports` of the host's loopback are
    /// carried in by the bridge (bridge.rs): `self_exe` runs inside as the command's parent and
    /// connects them to the sockets in `bridge_dir`.
    Isolated {
        bridge_dir: PathBuf,
        self_exe: PathBuf,
        ports: Vec<u16>,
    },
}

/// The bridge's socket for a host port, inside the sockets directory.
pub fn socket_name(port: u16) -> String {
    format!("{port}.sock")
}

fn push(argv: &mut Vec<OsString>, parts: &[&dyn AsRef<std::ffi::OsStr>]) {
    argv.extend(parts.iter().map(|p| p.as_ref().to_os_string()));
}

/// Bind a host path read-only at the same place, or recreate it if it is a symlink.
fn expose(argv: &mut Vec<OsString>, fs: &dyn HostFs, path: &Path) {
    match fs.kind(path) {
        Kind::Missing => {}
        Kind::Symlink(target) => push(argv, &[&"--symlink", &target, &path]),
        Kind::Dir | Kind::File => push(argv, &[&"--ro-bind", &path, &path]),
    }
}

/// The whole command line: bwrap, its mounts, then `cmd` (under the bridge when isolated).
pub fn command(policy: &Policy, fs: &dyn HostFs, net: &Net, cmd: &[OsString]) -> Vec<OsString> {
    let mut argv: Vec<OsString> = Vec::new();
    push(&mut argv, &[&BWRAP, &"--die-with-parent", &"--new-session"]);
    push(
        &mut argv,
        &[
            &"--unshare-pid",
            &"--unshare-ipc",
            &"--unshare-uts",
            &"--hostname",
            &SANDBOX_HOSTNAME,
        ],
    );
    if matches!(net, Net::Isolated { .. }) {
        push(&mut argv, &[&"--unshare-net"]);
    }
    push(&mut argv, &[&"--tmpfs", &"/"]);
    for path in SYSTEM_PATHS.iter().chain(ETC_PATHS) {
        expose(&mut argv, fs, Path::new(path));
    }
    push(&mut argv, &[&"--proc", &"/proc", &"--dev", &"/dev"]);
    for ro in &policy.read_only {
        push(&mut argv, &[&"--ro-bind", &ro.path, &ro.path]);
    }
    for link in policy.links.iter().filter(|l| !policy.readable(&l.at)) {
        push(&mut argv, &[&"--symlink", &link.target, &link.at]);
    }
    if let Net::Isolated {
        bridge_dir,
        self_exe,
        ..
    } = net
    {
        push(&mut argv, &[&"--ro-bind", self_exe, &INNER_EXE]);
        push(&mut argv, &[&"--ro-bind", bridge_dir, &INNER_SOCKETS]);
    }
    let own_tmp = policy.own_tmp();
    for tmp in SHARED_TMP {
        push(&mut argv, &[&"--bind", &own_tmp, tmp]);
    }
    push(&mut argv, &[&"--bind", &policy.own_dir, &policy.own_dir]);
    // The root is a tmpfs that had to be writable while the mount points were made in it. Now it
    // is closed: only own_dir, its tmp (as /tmp and /var/tmp) and /dev/shm can be written.
    push(&mut argv, &[&"--remount-ro", &"/", &"--"]);
    if let Net::Isolated { ports, .. } = net {
        push(
            &mut argv,
            &[&INNER_EXE, &INNER_SUBCOMMAND, &"--sockets", &INNER_SOCKETS],
        );
        for port in ports {
            push(&mut argv, &[&"--forward", &port.to_string()]);
        }
        push(&mut argv, &[&"--"]);
    }
    argv.extend(cmd.iter().cloned());
    argv
}
