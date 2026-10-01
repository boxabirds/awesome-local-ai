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
const LOOPBACK: &str = "localhost:*";

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
pub fn profile(policy: &Policy) -> String {
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

    rule("");
    rule("; Network: loopback only (the model server, the allow-listing proxy, the command's own dev");
    rule("; servers). Every other address is denied, in and out.");
    rule(&format!(
        "(allow network-outbound (remote ip {}))",
        quote(LOOPBACK)
    ));
    rule(&format!(
        "(allow network-inbound (local ip {}))",
        quote(LOOPBACK)
    ));
    rule(&format!(
        "(allow network-bind (local ip {}))",
        quote(LOOPBACK)
    ));

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
    p
}

/// A regex literal's body: SBPL reads `#"..."` raw, so only a quote needs care, and none of ours has one.
fn quote_regex(re: &str) -> String {
    format!("\"{re}\"")
}

/// The command line that runs `cmd` under the profile.
pub fn command(policy: &Policy, cmd: &[OsString]) -> Vec<OsString> {
    let mut argv = vec![
        OsString::from(SANDBOX_EXEC),
        OsString::from("-p"),
        OsString::from(profile(policy)),
    ];
    argv.extend(cmd.iter().cloned());
    argv
}
