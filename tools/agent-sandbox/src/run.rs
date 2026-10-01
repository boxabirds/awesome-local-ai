//! `run`, `print`, `proxy` and `inner`: build the policy, start what the command needs around it
//! (the proxy, on Linux the bridge), run it under the platform's enforcer, pass its status on.

use anyhow::{Context, Result};
use std::ffi::{CStr, OsStr, OsString};
use std::io::{Read, Write};
use std::os::unix::ffi::OsStringExt;
use std::os::unix::process::ExitStatusExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;

use crate::bwrap;
use crate::cli::{HostArgs, ProxyArgs, SandboxArgs};
use crate::paths::within;
use crate::policy::Policy;
use crate::ports::{Loopback, PortRange, IANA_DYNAMIC_PORTS};
use crate::proxy::{self, AllowList};
use crate::toolchain::{self, Discovered};
use crate::{bridge, presets, seatbelt};

/// What a shell reports for a command killed by signal N.
const SIGNAL_EXIT_BASE: i32 = 128;
/// The exit status when the sandbox itself could not be set up (as `env` and `sh` use for "cannot run").
pub const EXIT_CANNOT_RUN: i32 = 126;
/// How often the running command is checked for exit and for a signal to pass on.
const WAIT_POLL: Duration = Duration::from_millis(20);
const NO_SIGNAL: i32 = 0;
const FORWARDED_SIGNALS: [i32; 3] = [libc::SIGTERM, libc::SIGINT, libc::SIGHUP];
const LOOPBACK_HOSTS: &str = "localhost,127.0.0.1";
const PATH_VAR: &str = "PATH";
const NODE: &str = "node";
/// Where macOS keeps its stubs for developer tools; the real ones go just ahead of it on PATH.
const SYSTEM_BIN: &str = "/usr/bin";
const PASSWD_BUF_BYTES: usize = 16_384;
const RELAY_BUFFER_BYTES: usize = 65_536;
#[cfg(target_os = "macos")]
const GIT: &str = "git";
#[cfg(target_os = "macos")]
const GIT_STUB: &str = "/usr/bin/git";
#[cfg(target_os = "macos")]
const XCODE_SELECT: &str = "/usr/bin/xcode-select";
#[cfg(target_os = "macos")]
const SYSCTL_PORT_FIRST: &CStr = c"net.inet.ip.portrange.first";
#[cfg(target_os = "macos")]
const SYSCTL_PORT_LAST: &CStr = c"net.inet.ip.portrange.last";
#[cfg(target_os = "macos")]
const SYSCTL_PORT_HIFIRST: &CStr = c"net.inet.ip.portrange.hifirst";
#[cfg(target_os = "macos")]
const SYSCTL_PORT_HILAST: &CStr = c"net.inet.ip.portrange.hilast";
/// Bridge sockets live under the host's real /tmp whatever TMPDIR says: a unix socket's path is
/// limited to about a hundred bytes, and a run directory's path can be longer than that.
#[cfg(target_os = "linux")]
const BRIDGE_PARENT: &str = "/tmp";
#[cfg(target_os = "linux")]
const BRIDGE_DIR_MODE: u32 = 0o700;

/// The variables that send a program's HTTPS and HTTP through the proxy, and keep loopback direct.
/// Upper and lower case because tools differ in which they read; NODE_USE_ENV_PROXY makes node's
/// own fetch() honour them (npm already does).
pub fn proxy_env(port: u16) -> Vec<(String, String)> {
    let url = format!("http://127.0.0.1:{port}");
    let mut env: Vec<(String, String)> = ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy"]
        .iter()
        .map(|k| (k.to_string(), url.clone()))
        .collect();
    env.extend(
        ["NO_PROXY", "no_proxy"]
            .iter()
            .map(|k| (k.to_string(), LOOPBACK_HOSTS.to_string())),
    );
    env.push(("NODE_USE_ENV_PROXY".to_string(), "1".to_string()));
    env
}

/// `path_var` with `dirs` placed just ahead of `before`, each directory appearing once: they take
/// the place of `before`'s programs and of nothing that was ahead of it. At the end if `before`
/// is not on the path.
pub fn path_with(dirs: &[PathBuf], before: &Path, path_var: &OsStr) -> OsString {
    let old: Vec<PathBuf> = std::env::split_paths(path_var)
        .filter(|p| !dirs.contains(p))
        .collect();
    let at = old.iter().position(|p| p == before).unwrap_or(old.len());
    let new = old[..at].iter().chain(dirs).chain(&old[at..]);
    std::env::join_paths(new).unwrap_or_else(|_| path_var.to_os_string())
}

/// The command's exit code, or 128 + N if signal N killed it.
pub fn exit_code(status: ExitStatus) -> i32 {
    status
        .code()
        .unwrap_or_else(|| SIGNAL_EXIT_BASE + status.signal().unwrap_or_default())
}

/// The user's real home directory from the account database. HOME is not used: the harness sets
/// it to the agent's own home inside the run directory.
fn real_home() -> Option<PathBuf> {
    let mut pwd: libc::passwd = unsafe { std::mem::zeroed() };
    let mut buf = vec![0 as libc::c_char; PASSWD_BUF_BYTES];
    let mut result: *mut libc::passwd = std::ptr::null_mut();
    // SAFETY: getpwuid_r fills `pwd` with pointers into `buf`, both of which outlive the read below.
    let rc = unsafe {
        libc::getpwuid_r(
            libc::getuid(),
            &mut pwd,
            buf.as_mut_ptr(),
            buf.len(),
            &mut result,
        )
    };
    if rc != 0 || result.is_null() || pwd.pw_dir.is_null() {
        return None;
    }
    // SAFETY: pw_dir is a NUL-terminated string inside `buf`.
    let dir = unsafe { CStr::from_ptr(pwd.pw_dir) }.to_bytes().to_vec();
    Some(PathBuf::from(OsString::from_vec(dir)))
}

fn allow_list(hosts: &HostArgs) -> Result<AllowList> {
    let mut entries = hosts.allow_host.clone();
    for name in &hosts.preset {
        entries.extend(presets::hosts(name)?);
    }
    AllowList::parse(&entries)
}

/// macOS: /usr/bin/git is a stub that finds the real git through xcrun. Use the real one directly.
#[cfg(target_os = "macos")]
fn platform_tools(path_var: &OsStr) -> Discovered {
    let stub = toolchain::find_on_path(OsStr::new(GIT), path_var)
        .is_some_and(|p| p == Path::new(GIT_STUB));
    if !stub {
        return Discovered::default();
    }
    let Ok(out) = Command::new(XCODE_SELECT).arg("-p").output() else {
        return Discovered::default();
    };
    let dir = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !out.status.success() || dir.is_empty() {
        return Discovered::default();
    }
    toolchain::developer_tools(Path::new(&dir))
}

#[cfg(not(target_os = "macos"))]
fn platform_tools(_path_var: &OsStr) -> Discovered {
    Discovered::default()
}

struct Plan {
    policy: Policy,
    path: OsString,
}

/// The policy for these arguments: --ro, plus the installs of the command itself, of node and
/// (macOS) of git as found on PATH.
fn plan(args: &SandboxArgs) -> Result<Plan> {
    let home = real_home();
    let own = args
        .own_dir
        .canonicalize()
        .with_context(|| format!("--own-dir {}", args.own_dir.display()))?;
    let path_var = std::env::var_os(PATH_VAR).unwrap_or_default();
    let too_broad = |p: &Path| {
        p.parent().is_none() || within(&own, p) || home.as_deref().is_some_and(|h| within(h, p))
    };
    let program = args.command.first().context("no command given")?;
    let mut found = toolchain::discover(
        &[program.as_os_str(), OsStr::new(NODE)],
        &path_var,
        &too_broad,
    );
    found.merge(platform_tools(&path_var));
    // The entry points resolve into the roots; naming them makes the policy keep the links on the way.
    let ro: Vec<PathBuf> = args
        .ro
        .iter()
        .cloned()
        .chain(found.read_only)
        .chain(found.entry_points)
        .collect();
    let mut policy = Policy::new(&args.own_dir, &ro, home.as_deref())?
        .read_only_inside(&args.own_ro)?;
    if let Some(dir) = &args.workdir {
        policy = policy.starting_in(dir)?;
    }
    if let Some(at) = &args.own_at {
        if !cfg!(target_os = "linux") && at != &policy.own_dir {
            anyhow::bail!(
                "--own-at {}: this platform cannot show a directory at another path; \
                 put the directory there instead",
                at.display()
            );
        }
        policy = policy.shown_at(at)?;
    }
    std::fs::create_dir_all(policy.own_tmp())
        .with_context(|| format!("creating {}", policy.own_tmp().display()))?;
    for missing in &policy.missing {
        eprintln!(
            "agent-sandbox: --ro {} does not exist here; it stays closed",
            missing.display()
        );
    }
    Ok(Plan {
        policy,
        path: path_with(&found.path_prepend, Path::new(SYSTEM_BIN), &path_var),
    })
}

/// The loopback ports the command gets: `ports` (--host-port and the proxy) to connect to,
/// --agent-ports for its own servers, and with --ephemeral-ports the kernel's ephemeral range.
/// Only Seatbelt needs it spelled out; it is checked on every platform so a bad value fails alike.
fn loopback(args: &SandboxArgs, ports: &[u16]) -> Result<Loopback> {
    let ephemeral = args.ephemeral_ports.then(ephemeral_range);
    Loopback::new(ports, &args.agent_ports, ephemeral)
}

/// The ports the kernel picks from when a program binds to port 0. Both of macOS's ranges are
/// read (a socket may ask for the "high" one), so a machine whose ranges were narrowed gets a
/// narrower rule. The IANA range if they cannot be read.
#[cfg(target_os = "macos")]
fn ephemeral_range() -> PortRange {
    let read = |name: &CStr| -> Option<u16> {
        let mut value: libc::c_int = 0;
        let mut size = std::mem::size_of::<libc::c_int>();
        // SAFETY: `value` and `size` describe one c_int, which is what these sysctls hold.
        let rc = unsafe {
            libc::sysctlbyname(
                name.as_ptr(),
                (&mut value as *mut libc::c_int).cast(),
                &mut size,
                std::ptr::null_mut(),
                0,
            )
        };
        (rc == 0).then(|| u16::try_from(value).ok()).flatten()
    };
    let firsts = [SYSCTL_PORT_FIRST, SYSCTL_PORT_HIFIRST].map(read);
    let lasts = [SYSCTL_PORT_LAST, SYSCTL_PORT_HILAST].map(read);
    match (
        firsts.into_iter().collect::<Option<Vec<u16>>>(),
        lasts.into_iter().collect::<Option<Vec<u16>>>(),
    ) {
        (Some(firsts), Some(lasts)) => {
            let first = firsts.into_iter().min().unwrap_or(IANA_DYNAMIC_PORTS.first);
            let last = lasts.into_iter().max().unwrap_or(IANA_DYNAMIC_PORTS.last);
            if first == 0 || first > last {
                IANA_DYNAMIC_PORTS
            } else {
                PortRange { first, last }
            }
        }
        _ => IANA_DYNAMIC_PORTS,
    }
}

#[cfg(not(target_os = "macos"))]
fn ephemeral_range() -> PortRange {
    IANA_DYNAMIC_PORTS
}

/// What surrounds the sandboxed command on this platform, and the command line itself.
struct Enforcer {
    argv: Vec<OsString>,
    /// Removed when the command has ended.
    scratch: Option<PathBuf>,
}

#[cfg(target_os = "macos")]
fn enforcer(args: &SandboxArgs, policy: &Policy, ports: &[u16], _live: bool) -> Result<Enforcer> {
    Ok(Enforcer {
        argv: seatbelt::command(policy, &loopback(args, ports)?, &args.command),
        scratch: None,
    })
}

#[cfg(target_os = "linux")]
fn enforcer(args: &SandboxArgs, policy: &Policy, ports: &[u16], live: bool) -> Result<Enforcer> {
    use crate::cli::LinuxNet;
    use std::os::unix::fs::DirBuilderExt;
    loopback(args, ports)?;
    if args.linux_net == LinuxNet::Shared {
        eprintln!("agent-sandbox: --linux-net shared: the command is in the host's network; no address is denied");
        return Ok(Enforcer {
            argv: bwrap::command(policy, &bwrap::RealFs, &bwrap::Net::Shared, &args.command),
            scratch: None,
        });
    }
    let bridge_dir = Path::new(BRIDGE_PARENT).join(format!("agent-sandbox-{}", std::process::id()));
    if live {
        std::fs::DirBuilder::new()
            .mode(BRIDGE_DIR_MODE)
            .create(&bridge_dir)
            .with_context(|| format!("creating {}", bridge_dir.display()))?;
        for port in ports {
            bridge::host_side(&bridge_dir.join(bwrap::socket_name(*port)), *port)?;
        }
        std::fs::write(
            bridge_dir.join(bwrap::COMMAND_FILE),
            bwrap::command_file_bytes(&args.command),
        )
        .context("writing the command for the sandbox's first process")?;
    }
    let self_exe = std::env::current_exe()?.canonicalize()?;
    let net = bwrap::Net::Isolated {
        bridge_dir: bridge_dir.clone(),
        self_exe,
        ports: ports.to_vec(),
    };
    Ok(Enforcer {
        argv: bwrap::command(policy, &bwrap::RealFs, &net, &args.command),
        scratch: live.then_some(bridge_dir),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn enforcer(
    _args: &SandboxArgs,
    _policy: &Policy,
    _ports: &[u16],
    _live: bool,
) -> Result<Enforcer> {
    anyhow::bail!("agent-sandbox has no enforcer for this operating system (macOS: sandbox-exec; Linux: bubblewrap)")
}

/// `print`: the profile (macOS) or the command line, one argument per line (Linux). Nothing is
/// started, so a proxy's port, chosen at run time, does not appear.
pub fn print(args: &SandboxArgs) -> Result<String> {
    allow_list(&args.hosts)?;
    let plan = plan(args)?;
    let net = loopback(args, &args.host_port)?;
    if cfg!(target_os = "macos") {
        return Ok(seatbelt::profile(&plan.policy, &net));
    }
    let enforcer = enforcer(args, &plan.policy, &args.host_port, false)?;
    Ok(enforcer
        .argv
        .iter()
        .map(|a| a.to_string_lossy().into_owned() + "\n")
        .collect())
}

/// `run`: the command's exit status.
pub fn run(args: &SandboxArgs) -> Result<i32> {
    let allow = allow_list(&args.hosts)?;
    let plan = plan(args)?;
    let mut ports = args.host_port.clone();
    let mut env = Vec::new();
    if !allow.is_empty() {
        let proxy = proxy::spawn(allow, args.proxy_log.clone(), 0)?;
        ports.push(proxy.port);
        env = proxy_env(proxy.port);
    }
    let enforcer = enforcer(args, &plan.policy, &ports, true)?;
    let mut command = Command::new(&enforcer.argv[0]);
    command.args(&enforcer.argv[1..]);
    if let Some(keep) = &args.keep_env {
        command.env_clear();
        for name in keep {
            if let Some(value) = std::env::var_os(name) {
                command.env(name, value);
            }
        }
    }
    command.envs(env).env(PATH_VAR, &plan.path);
    if let Some(dir) = &plan.policy.workdir {
        command.current_dir(plan.policy.own_dir.join(dir));
    }
    let status = spawn_and_wait(command);
    if let Some(dir) = &enforcer.scratch {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(exit_code(status.with_context(|| {
        format!("starting {}", enforcer.argv[0].to_string_lossy())
    })?))
}

/// `proxy`: serve until killed.
pub fn serve_proxy(args: &ProxyArgs) -> Result<()> {
    let proxy = proxy::spawn(allow_list(&args.hosts)?, args.log.clone(), args.port)?;
    println!("{}", proxy.port);
    std::io::stdout().flush()?;
    loop {
        std::thread::park();
    }
}

/// The sandbox's first process (isolated Linux sandbox): opens each bridged port on the sandbox's
/// own loopback, runs the command, and, being process 1 of its pid namespace, reaps every orphan
/// until the command ends. Its status is passed on; when it ends the kernel ends everything else.
pub fn init(sockets: &Path) -> Result<i32> {
    let command = bwrap::command_from_file_bytes(
        &std::fs::read(sockets.join(bwrap::COMMAND_FILE))
            .with_context(|| format!("reading the command in {}", sockets.display()))?,
    );
    let program = command.first().context("the command file is empty")?;
    for entry in std::fs::read_dir(sockets)? {
        let name = entry?.file_name();
        if let Some(port) = name.to_str().and_then(bwrap::port_of_socket) {
            bridge::sandbox_side(port, &sockets.join(bwrap::socket_name(port)))?;
        }
    }
    let mut child = Command::new(program);
    child.args(&command[1..]).env_remove(bwrap::INNER_ENV);
    for sig in FORWARDED_SIGNALS {
        // SAFETY: the handler only stores to an atomic.
        unsafe {
            libc::signal(
                sig,
                note_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
            )
        };
    }
    let child = child
        .spawn()
        .with_context(|| format!("starting {}", program.to_string_lossy()))?;
    Ok(wait_reaping(child.id() as libc::pid_t))
}

/// Wait for `pid`, passing on SIGTERM, SIGINT and SIGHUP, and collect any other child that ends
/// (a process 1 gets the orphans of everything that exits).
fn wait_reaping(pid: libc::pid_t) -> i32 {
    loop {
        let mut status: libc::c_int = 0;
        // SAFETY: waitpid writes one c_int.
        let ended = unsafe { libc::waitpid(-1, &mut status, libc::WNOHANG) };
        if ended == pid {
            return if libc::WIFEXITED(status) {
                libc::WEXITSTATUS(status)
            } else {
                SIGNAL_EXIT_BASE + libc::WTERMSIG(status)
            };
        }
        if ended > 0 {
            continue;
        }
        if ended < 0 {
            return EXIT_CANNOT_RUN;
        }
        let sig = PENDING_SIGNAL.swap(NO_SIGNAL, Ordering::SeqCst);
        if sig != NO_SIGNAL {
            // SAFETY: plain kill(2) on the child we started.
            unsafe { libc::kill(pid, sig) };
        }
        std::thread::sleep(WAIT_POLL);
    }
}

static PENDING_SIGNAL: AtomicI32 = AtomicI32::new(NO_SIGNAL);

extern "C" fn note_signal(sig: libc::c_int) {
    PENDING_SIGNAL.store(sig, Ordering::SeqCst);
}

fn is_regular_file(fd: libc::c_int) -> bool {
    let mut st: libc::stat = unsafe { std::mem::zeroed() };
    // SAFETY: fstat only writes into `st`.
    unsafe { libc::fstat(fd, &mut st) == 0 && (st.st_mode & libc::S_IFMT) == libc::S_IFREG }
}

fn relay(
    mut from: impl Read + Send + 'static,
    mut to: impl Write + Send + 'static,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; RELAY_BUFFER_BYTES];
        while let Ok(n) = from.read(&mut buf) {
            if n == 0 || to.write_all(&buf[..n]).is_err() {
                break;
            }
            let _ = to.flush();
        }
    })
}

/// Run the command to its end, passing on SIGTERM, SIGINT and SIGHUP.
///
/// Standard streams are inherited, except one that is a regular file: Seatbelt checks fstat()
/// against the file's path, and node aborts at start when it cannot stat its own stdout. Such a
/// stream is carried through a pipe instead, so a log file outside own_dir still works.
fn spawn_and_wait(mut command: Command) -> std::io::Result<ExitStatus> {
    let (file_in, file_out, file_err) = (
        is_regular_file(libc::STDIN_FILENO),
        is_regular_file(libc::STDOUT_FILENO),
        is_regular_file(libc::STDERR_FILENO),
    );
    let pipe_if = |yes: bool| {
        if yes {
            Stdio::piped()
        } else {
            Stdio::inherit()
        }
    };
    command
        .stdin(pipe_if(file_in))
        .stdout(pipe_if(file_out))
        .stderr(pipe_if(file_err));
    for sig in FORWARDED_SIGNALS {
        // SAFETY: the handler only stores to an atomic.
        unsafe {
            libc::signal(
                sig,
                note_signal as extern "C" fn(libc::c_int) as libc::sighandler_t,
            )
        };
    }
    let mut child = command.spawn()?;
    if let Some(stdin) = child.stdin.take() {
        relay(std::io::stdin(), stdin);
    }
    let outputs = [
        child.stdout.take().map(|out| relay(out, std::io::stdout())),
        child.stderr.take().map(|err| relay(err, std::io::stderr())),
    ];
    let status = wait_forwarding(&mut child);
    for output in outputs.into_iter().flatten() {
        let _ = output.join();
    }
    status
}

fn wait_forwarding(child: &mut Child) -> std::io::Result<ExitStatus> {
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        let sig = PENDING_SIGNAL.swap(NO_SIGNAL, Ordering::SeqCst);
        if sig != NO_SIGNAL {
            // SAFETY: plain kill(2) on the child we started and have not yet reaped.
            unsafe { libc::kill(child.id() as libc::pid_t, sig) };
        }
        std::thread::sleep(WAIT_POLL);
    }
}
