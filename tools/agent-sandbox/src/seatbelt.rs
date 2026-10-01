//! macOS: the policy as a Seatbelt profile (SBPL) for `sandbox-exec -p`.
//!
//! The profile starts from `(deny default)` and adds only what the benchmark workload was measured
//! to need (README.md, "How the macOS allow-list was measured"): each rule below was removed in
//! turn and kept only if git, node, npm install, vite build, wrangler dev, Chromium under
//! Playwright, or an everyday shell command then failed. SBPL applies the last matching rule, so
//! own_dir's rule is written last and wins over anything above it.

use std::ffi::OsString;
use std::fmt::Write as _;
use std::path::Path;

use crate::policy::Policy;
use crate::ports::Loopback;

pub const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";

/// System trees every program is loaded from: the dynamic linker's shared cache and frameworks
/// (/System), the libraries and standard tools (/usr), the shells and core utilities (/bin).
/// Read and execute; none holds anything of the user's. /sbin and /Library are not needed.
const SYSTEM_TREES: &[&str] = &["/usr", "/bin", "/System"];

/// Single system files and small trees, read-only, each with the failure seen without it.
const SYSTEM_FILES: &[(&str, &str)] = &[
    (
        "/private/var/select",
        "/bin/sh reads its `sh` link to pick the shell; without it every sh prints an error",
    ),
    (
        "/private/etc/hosts",
        "`localhost` resolves from here; the resolver service (mDNSResponder) stays denied",
    ),
    (
        "/private/etc/ssl",
        "the public CA bundle and openssl.cnf, for curl, git and workerd",
    ),
    (
        "/private/etc/localtime",
        "the local time zone, for dates in commits and logs",
    ),
    (
        "/private/var/db/timezone",
        "the zone data /etc/localtime points into",
    ),
];

/// Kernel devices that hold no data.
const DEVICES_READ: &[&str] = &["/dev/null", "/dev/zero", "/dev/random", "/dev/urandom"];
/// /dev/stdin, /dev/stdout and /dev/stderr are links into /dev/fd: a process's own open files.
const DEVICE_LINKS: &[&str] = &["/dev", "/dev/stdin", "/dev/stdout", "/dev/stderr"];
const DEV_FD: &str = "/dev/fd";
const DEV_NULL: &str = "/dev/null";
/// The root directory itself (dyld reads it at every start) and the root-level links that system
/// paths are written through.
const ROOT: &str = "/";
const ROOT_LINKS: &[&str] = &[
    "/etc",
    "/private",
    "/private/etc",
    "/private/var",
    "/private/var/db",
];

/// The one Apple service allowed: account lookup (getpwuid), for `whoami`, `id` and node's
/// os.userInfo(), which throws without it.
const ACCOUNT_LOOKUP_SERVICE: &str = "com.apple.system.opendirectoryd.libinfo";
/// Chromium's processes find each other through a Mach port the browser registers under its pid.
const CHROMIUM_RENDEZVOUS: &str = r"^org\.chromium\.Chromium\.MachPortRendezvousServer\.[0-9]+$";
/// Chromium asks the power manager not to idle-sleep; it exits at start without this.
const CHROMIUM_POWER_CLIENT: &str = "RootDomainUserClient";
/// Seatbelt's only host names are `*` and `localhost`; a port is one number or `*`. There are no
/// port ranges and no addresses ("127.0.0.2:*" and "localhost:8000-8010" are refused when the
/// profile is compiled), so a range is one rule per port.
const LOOPBACK_PORT_PREFIX: &str = "localhost:";
const ANY_LOOPBACK_PORT: &str = "localhost:*";
/// SBPL is Scheme: these loops add one rule per port, so a wide range stays one line here.
const CONNECT_TO: &str = "connect-to";
const LISTEN_ON: &str = "listen-on";

/// A path or name as an SBPL string literal.
pub fn quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        if c == '"' || c == '\\' {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('"');
    out
}

fn q(p: &Path) -> String {
    quote(&p.to_string_lossy())
}

fn literals<'a>(paths: impl IntoIterator<Item = &'a str>) -> String {
    paths
        .into_iter()
        .map(|p| format!("(literal {})", quote(p)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn subpaths<'a>(paths: impl IntoIterator<Item = &'a str>) -> String {
    paths
        .into_iter()
        .map(|p| format!("(subpath {})", quote(p)))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The whole profile. Comment lines (;) say why each group is there; `agent-sandbox print` shows it.
pub fn profile(policy: &Policy, net: &Loopback) -> String {
    let mut p = String::new();
    let own = q(&policy.own_dir);
    // Writing to a String cannot fail.
    let mut rule = |text: &str| {
        let _ = writeln!(p, "{text}");
    };
    rule("(version 1)");
    rule("(deny default)");

    rule("");
    rule("; Processes: start children and run programs only from the system, the toolchain and own_dir.");
    rule("; Signals reach only processes in this sandbox, and other processes cannot be inspected");
    rule("; (lsof and libproc would otherwise list every process of the user and its open files).");
    rule("(allow process-fork)");
    rule(&format!(
        "(allow process-exec {})",
        subpaths(SYSTEM_TREES.iter().copied())
    ));
    rule("(allow signal (target same-sandbox))");
    rule("(deny process-info* (target others))");

    rule("");
    rule("; Kernel facts (CPU count, memory size, OS version): node and every Apple library read them at start.");
    rule("(allow sysctl-read)");

    rule("");
    rule("; System libraries, frameworks and standard tools: read-only.");
    rule(&format!("(allow file-read* (literal {}))", quote(ROOT)));
    rule(&format!(
        "(allow file-read* {})",
        subpaths(SYSTEM_TREES.iter().copied())
    ));
    rule(&format!(
        "(allow file-read-metadata {})",
        literals(ROOT_LINKS.iter().copied())
    ));
    for (path, why) in SYSTEM_FILES {
        rule(&format!("; {why}"));
        rule(&format!("(allow file-read* (subpath {}))", quote(path)));
    }

    rule("");
    rule("; Devices that hold no data, and the process's own open files.");
    rule(&format!(
        "(allow file-read* {})",
        literals(DEVICES_READ.iter().copied())
    ));
    rule(&format!(
        "(allow file-write-data (literal {}))",
        quote(DEV_NULL)
    ));
    rule(&format!(
        "(allow file-read* file-write-data (subpath {}))",
        quote(DEV_FD)
    ));
    rule(&format!(
        "(allow file-read-metadata {})",
        literals(DEVICE_LINKS.iter().copied())
    ));

    rule("");
    rule(
        "; Account lookup: whoami, id, node's os.userInfo(). No other Apple service is reachable;",
    );
    rule("; in particular not the resolver (no DNS: outbound goes through the proxy, which resolves),");
    rule("; not dirhelper (so mktemp and confstr fall back to TMPDIR, inside own_dir) and not sysmond.");
    rule(&format!(
        "(allow mach-lookup (global-name {}))",
        quote(ACCOUNT_LOOKUP_SERVICE)
    ));

    rule("");
    rule(
        "; Chromium: its processes meet through a Mach port named after the browser's pid, and it",
    );
    rule("; holds a power assertion while it runs.");
    rule(&format!(
        "(allow mach-register (global-name-regex #{}))",
        quote_regex(CHROMIUM_RENDEZVOUS)
    ));
    rule(&format!(
        "(allow mach-lookup (global-name-regex #{}))",
        quote_regex(CHROMIUM_RENDEZVOUS)
    ));
    rule(&format!(
        "(allow iokit-open (iokit-user-client-class {}))",
        quote(CHROMIUM_POWER_CLIENT)
    ));

    network(&mut rule, net);

    let meta: Vec<String> = policy
        .metadata_only()
        .iter()
        .chain(
            policy
                .links
                .iter()
                .map(|l| &l.at)
                .filter(|at| !policy.readable(at)),
        )
        .map(|d| format!("(literal {})", q(d)))
        .collect();
    if !meta.is_empty() {
        rule("");
        rule("; The directories above what is allowed, and symlinks on the way: existence only (stat),");
        rule("; so paths resolve while nothing beside them can be listed or read.");
        rule(&format!("(allow file-read-metadata {})", meta.join(" ")));
    }

    if !policy.read_only.is_empty() {
        rule("");
        rule("; The toolchain (--ro and what was found on PATH): read and execute, never write.");
        for ro in &policy.read_only {
            let filter = if ro.is_dir { "subpath" } else { "literal" };
            rule(&format!(
                "(allow file-read* process-exec ({filter} {}))",
                q(&ro.path)
            ));
        }
    }

    rule("");
    rule("; The run's own directory: the only place that can be written. Last, so it wins.");
    rule(&format!("(allow process-exec (subpath {own}))"));
    rule(&format!("(allow file-read* file-write* (subpath {own}))"));
    if !policy.own_ro.is_empty() {
        rule("; Inside it, read-only (the spec): a deny after the allow, so it wins. It covers chmod too.");
        for ro in &policy.own_ro {
            rule(&format!("(deny file-write* (subpath {}))", q(ro)));
        }
    }
    p
}

/// A loop that applies `allowance` to "localhost:<port>" for each port from `first` to `last`.
fn port_loop(rule: &mut impl FnMut(&str), name: &str, allowance: &str) {
    rule(&format!("(define ({name} first last)"));
    rule("  (if (<= first last) (begin");
    rule(&format!(
        "    ({allowance} (string-append {} (number->string first))))",
        quote(LOOPBACK_PORT_PREFIX)
    ));
    rule(&format!("    ({name} (+ first 1) last))))"));
}

/// The network: TCP to and from named loopback ports, and nothing else.
fn network(rule: &mut impl FnMut(&str), net: &Loopback) {
    rule("");
    if net == &Loopback::default() {
        rule("; Network: none. No loopback port was named and no host is allowed, so every connection,");
        rule("; bind and listen is denied.");
        return;
    }
    rule(
        "; Network: TCP on loopback, port by port. Every other port and address is denied, in and",
    );
    rule("; out, and so is UDP. Seatbelt cannot name a range of ports or \"the ports this sandbox");
    rule("; bound\", so each port gets a rule of its own, written by these loops.");
    port_loop(rule, CONNECT_TO, "allow network-outbound (remote tcp");
    let serves = !net.own.is_empty() && net.ephemeral.is_none();
    if serves {
        port_loop(
            rule,
            LISTEN_ON,
            "allow network-bind network-inbound (local tcp",
        );
    }
    if !net.reach.is_empty() {
        rule("; Servers outside the sandbox (--host-port: the model server) and the allow-listing proxy:");
        rule("; connect only.");
        for range in &net.reach {
            rule(&format!("({CONNECT_TO} {} {})", range.first, range.last));
        }
    }
    if !net.own.is_empty() {
        rule("; The command's own servers (--agent-ports): bind, listen and connect.");
        for range in &net.own {
            if serves {
                rule(&format!("({LISTEN_ON} {} {})", range.first, range.last));
            }
            rule(&format!("({CONNECT_TO} {} {})", range.first, range.last));
        }
    }
    if let Some(range) = &net.ephemeral {
        rule("; --ephemeral-ports: a bind to port 0 (\"any free port\") is checked as port 0, which no rule");
        rule("; can name, so binding and listening are open on all of loopback. Connecting is open to the");
        rule("; range the kernel picks such ports from: the command's own, and any other process's there.");
        rule(&format!(
            "(allow network-bind network-inbound (local tcp {}))",
            quote(ANY_LOOPBACK_PORT)
        ));
        rule(&format!("({CONNECT_TO} {} {})", range.first, range.last));
    }
}

/// A regex literal's body: SBPL reads `#"..."` raw, so only a quote needs care, and none of ours has one.
fn quote_regex(re: &str) -> String {
    format!("\"{re}\"")
}

/// The command line that runs `cmd` under the profile.
pub fn command(policy: &Policy, net: &Loopback, cmd: &[OsString]) -> Vec<OsString> {
    let mut argv = vec![
        OsString::from(SANDBOX_EXEC),
        OsString::from("-p"),
        OsString::from(profile(policy, net)),
    ];
    argv.extend(cmd.iter().cloned());
    argv
}
