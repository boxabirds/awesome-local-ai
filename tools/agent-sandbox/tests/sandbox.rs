//! The real sandbox: the built `agent-sandbox` binary running real commands under Seatbelt (macOS)
//! or bubblewrap (Linux). Each test prints `SKIP <test>: <reason>` and passes only when the
//! machine has no sandbox tool at all, or lacks a program the test is about (node, git) or, for
//! the tests named `online_*`, the internet. Nothing else may skip.
//!
//! Every canary is first read from outside the sandbox, so a test cannot pass because the canary
//! was never there.

mod common;

use common::TempDir;
use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream, ToSocketAddrs, UdpSocket};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

const BIN: &str = env!("CARGO_BIN_EXE_agent-sandbox");
const SANDBOX_EXEC: &str = "/usr/bin/sandbox-exec";
const BASH: &str = "/bin/bash";
const ANY_PORT: u16 = 0;
/// Where fixed_port() looks for free ports: below the range the kernel picks from for port 0
/// (49152 and up), and away from the ports dev servers and the harness use by habit.
const FIXED_PORT_BASE: u16 = 41_100;
const FIXED_PORT_TRIES: u16 = 800;
/// The kernel's range for a bind to port 0 unless a machine was reconfigured (IANA dynamic ports).
#[cfg(target_os = "macos")]
const EPHEMERAL_FROM: u16 = 49_152;
const HTTPS_PORT: u16 = 443;
/// Long enough for any single command here; the workload has its own.
const DEADLINE: Duration = Duration::from_secs(60);
const INSTALL_DEADLINE: Duration = Duration::from_secs(300);
const WORKLOAD_DEADLINE: Duration = Duration::from_secs(900);
const ONLINE_TIMEOUT: Duration = Duration::from_secs(5);
/// A refusal by the sandbox is immediate; a connection that was let out would wait far longer for an answer.
const REFUSAL_DEADLINE: Duration = Duration::from_secs(10);
const POLL: Duration = Duration::from_millis(20);
const SIGTERM_EXIT: i32 = 128 + libc::SIGTERM;
const EXECUTABLE: u32 = 0o755;
const SECRET: &str = "held-out-secret-7c1f";
const LEAK_PACKAGE: &str = "agent-sandbox-test-leak";
const NPM_REGISTRY: &str = "registry.npmjs.org";
/// An address in TEST-NET-1 (RFC 5737): never routed, used only to ask the kernel which local
/// address it would send from. No packet leaves the machine.
const UNROUTED: (Ipv4Addr, u16) = (Ipv4Addr::new(192, 0, 2, 1), 9);

/// The workload the harness's preflight requires (benchmarks/spec-bench/harness/preflight.py,
/// PACKAGE and FILES), with the port filled in at run time.
const PACKAGE_JSON: &str = r#"{
  "name": "preflight", "private": true, "type": "module",
  "scripts": {"build": "vite build"},
  "devDependencies": {"vite": "^7.0.0", "wrangler": "^4.0.0", "@playwright/test": "^1.55.0"}
}"#;
const INDEX_HTML: &str = "<!doctype html><title>preflight</title><h1 id=ok>preflight ok</h1>";
const VITE_CONFIG: &str = "export default { build: { outDir: 'dist/client' } };";
const WRANGLER_JSONC: &str = r#"{"name": "preflight", "compatibility_date": "2026-09-01", "assets": {"directory": "./dist/client"}}"#;
const BROWSE_MJS: &str = "import { chromium } from '@playwright/test';\
const b = await chromium.launch(); const p = await b.newPage();\
await p.goto(`http://127.0.0.1:${process.argv[2]}/`);\
console.log(await p.textContent('#ok')); await b.close();";
/// Runs the whole workload inside one sandbox, as an agent session does: on Linux each sandbox
/// has its own loopback, so the server and the browser must share one.
const DRIVE_MJS: &str = r#"
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const port = process.argv[2];
let server;
const stop = () => { try { server?.kill('SIGTERM'); } catch {} };
const step = (name, cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`STEP FAILED: ${name}\n${r.stdout}\n${r.stderr}`); stop(); process.exit(1); }
  console.log(`STEP OK: ${name}`);
  return r.stdout;
};
step('npm install', 'npm', ['install', '--no-audit', '--no-fund']);
step('vite build', 'npm', ['run', 'build']);
// Not detached: the server stays in the test's process group, which the test kills at the end.
server = spawn('npx', ['wrangler', 'dev', '--port', port, '--inspector-port', process.argv[3], '--ip', '127.0.0.1'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try { up = (await (await fetch(`http://127.0.0.1:${port}/`)).text()).includes('preflight ok'); } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { console.log('STEP FAILED: wrangler dev'); stop(); process.exit(1); }
console.log('STEP OK: wrangler dev');
const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
const wanted = JSON.parse(readFileSync('node_modules/playwright-core/browsers.json', 'utf8'))
  .browsers.find((b) => b.name === 'chromium-headless-shell').revision;
if (!cache || !existsSync(`${cache}/chromium_headless_shell-${wanted}`)) {
  console.log(`CHROMIUM SKIPPED: revision ${wanted} is not in the browser cache`);
} else {
  step('playwright browsers', 'npx', ['playwright', 'install', 'chromium']);
  const r = spawnSync('node', ['browse.mjs', port], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.includes('preflight ok')) {
    console.log(`STEP FAILED: chromium\n${r.stdout}\n${r.stderr}`); stop(); process.exit(1);
  }
  console.log('STEP OK: chromium');
}
stop();
process.exit(0);
"#;

// ---------- what this machine has ----------

fn on_path(name: &str) -> Option<PathBuf> {
    agent_sandbox::toolchain::find_on_path(
        OsStr::new(name),
        &std::env::var_os("PATH").unwrap_or_default(),
    )
}

/// Why the sandbox cannot be tested here, if it cannot.
fn no_sandbox_tool() -> Option<String> {
    if cfg!(target_os = "macos") {
        (!Path::new(SANDBOX_EXEC).exists()).then(|| format!("{SANDBOX_EXEC} is missing"))
    } else if cfg!(target_os = "linux") {
        on_path("bwrap")
            .is_none()
            .then(|| "bubblewrap (bwrap) is not installed".to_string())
    } else {
        Some("no sandbox tool is supported on this operating system".to_string())
    }
}

/// True (after printing why) when `test` must be skipped: no sandbox tool, or a needed program is absent.
fn skip(test: &str, programs: &[&str]) -> bool {
    let why = no_sandbox_tool().or_else(|| {
        programs
            .iter()
            .find(|p| on_path(p).is_none())
            .map(|p| format!("{p} is not installed"))
    });
    if let Some(why) = &why {
        eprintln!("SKIP {test}: {why}");
    }
    why.is_some()
}

/// Tries every address of the registry: a machine with no IPv6 route is still online.
fn offline(test: &str) -> bool {
    let reachable = (NPM_REGISTRY, HTTPS_PORT)
        .to_socket_addrs()
        .ok()
        .is_some_and(|mut addrs| {
            addrs.any(|addr| TcpStream::connect_timeout(&addr, ONLINE_TIMEOUT).is_ok())
        });
    if !reachable {
        eprintln!("SKIP {test}: needs the internet ({NPM_REGISTRY} cannot be reached)");
    }
    !reachable
}

fn real_home() -> PathBuf {
    PathBuf::from(std::env::var_os("HOME").expect("HOME is set for the test run"))
}

/// A free loopback port that the kernel would not hand out for port 0, different on every call:
/// what a harness gives a run for its dev server.
fn fixed_port() -> u16 {
    static NEXT: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);
    for _ in 0..FIXED_PORT_TRIES {
        let port = FIXED_PORT_BASE + NEXT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok() {
            return port;
        }
    }
    panic!("no free port in {FIXED_PORT_TRIES} tries from {FIXED_PORT_BASE}");
}

/// Playwright's browsers as the harness provides them, if this machine has any.
fn browser_cache() -> Option<PathBuf> {
    let home = real_home();
    let candidates = [
        std::env::var_os("PLAYWRIGHT_BROWSERS_PATH").map(PathBuf::from),
        Some(home.join(".cache/vidi-agent-ms-playwright")),
        Some(home.join(".cache/ms-playwright")),
        Some(home.join("Library/Caches/ms-playwright")),
    ];
    candidates.into_iter().flatten().find(|p| p.is_dir())
}

// ---------- a run directory with canaries around it ----------

/// A stand-in for the bench layout, under the real home so the home's own rules apply:
///   <base>/work/run-a            the run's own directory (workspace/, tmp/, agent-home/)
///   <base>/work/run-b            another run
///   <base>/repo                  the repository with the held-out suite
///   <base>/node_modules, package.json      packages above the run
struct Bench {
    base: TempDir,
    own: PathBuf,
    workspace: PathBuf,
}

impl Bench {
    fn new() -> Bench {
        let base = TempDir::under(&real_home());
        let own = base.dir("work/run-a");
        let workspace = base.dir("work/run-a/workspace");
        base.dir("work/run-a/agent-home");
        base.dir("work/run-a/tmp");
        base.file("work/run-b/workspace/answer.txt", SECRET);
        base.file("repo/acceptance/tests/story-01.spec.ts", SECRET);
        base.file("package.json", &format!("{{\"name\": \"{SECRET}\"}}"));
        base.file(
            &format!("node_modules/{LEAK_PACKAGE}/index.js"),
            &format!("module.exports = '{SECRET}';"),
        );
        base.file(
            &format!("work/node_modules/{LEAK_PACKAGE}/index.js"),
            &format!("module.exports = '{SECRET}';"),
        );
        Bench {
            base,
            own,
            workspace,
        }
    }

    fn path(&self, rel: &str) -> PathBuf {
        self.base.path().join(rel)
    }

    /// The environment the harness gives an agent (drive.agent_env): its own home and temp
    /// directory, nothing inherited but PATH.
    fn agent_env(&self, command: &mut Command) {
        let tmp = self.own.join("tmp");
        command
            .current_dir(&self.workspace)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", self.own.join("agent-home"))
            .env("PWD", &self.workspace)
            .env("npm_config_update_notifier", "false")
            .env("WRANGLER_SEND_METRICS", "false")
            .stdin(Stdio::null());
        for name in ["TMPDIR", "TMP", "TEMP"] {
            command.env(name, &tmp);
        }
    }

    /// `agent-sandbox run --own-dir <own> <extra> -- <cmd>`.
    fn sandboxed(&self, extra: &[&str], cmd: &[&str]) -> Command {
        let mut command = Command::new(BIN);
        command
            .arg("run")
            .arg("--own-dir")
            .arg(&self.own)
            .args(extra)
            .arg("--")
            .args(cmd);
        self.agent_env(&mut command);
        command
    }

    /// The same command and environment with no sandbox: the control.
    fn unsandboxed(&self, cmd: &[&str]) -> Command {
        let mut command = Command::new(cmd[0]);
        command.args(&cmd[1..]);
        self.agent_env(&mut command);
        command
    }

    fn bash(&self, extra: &[&str], script: &str) -> Output {
        finish(self.sandboxed(extra, &[BASH, "-c", script]), DEADLINE)
    }

    fn bash_outside(&self, script: &str) -> Output {
        finish(self.unsandboxed(&[BASH, "-c", script]), DEADLINE)
    }
}

/// Run to the end in a process group of its own; past the deadline the group is killed and the
/// test fails. The group is killed afterwards too, so nothing a test started outlives it.
fn finish(mut command: Command, deadline: Duration) -> Output {
    let child = command
        .process_group(0)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id() as libc::pid_t;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let result = rx.recv_timeout(deadline);
    // SAFETY: signals only the process group this function created.
    unsafe { libc::kill(-pid, libc::SIGKILL) };
    match result {
        Ok(output) => output.unwrap(),
        Err(_) => panic!("still running after {deadline:?}: {command:?}"),
    }
}

fn stdout(o: &Output) -> String {
    String::from_utf8_lossy(&o.stdout).into_owned()
}

fn describe(o: &Output) -> String {
    format!(
        "exit {:?}\nstdout: {}\nstderr: {}",
        o.status.code(),
        stdout(o),
        String::from_utf8_lossy(&o.stderr)
    )
}

fn quoted(p: &Path) -> String {
    format!("'{}'", p.display())
}

/// A server on `addr`, on a port the kernel picks, that answers each line with "pong".
fn pong_server(addr: IpAddr) -> Option<SocketAddr> {
    pong_server_on(addr, ANY_PORT)
}

fn pong_server_on(addr: IpAddr, port: u16) -> Option<SocketAddr> {
    let listener = TcpListener::bind((addr, port)).ok()?;
    let bound = listener.local_addr().ok()?;
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            let mut line = String::new();
            let mut reader = BufReader::new(conn);
            if reader.read_line(&mut line).is_ok() {
                let _ = reader.get_mut().write_all(b"pong\n");
            }
        }
    });
    Some(bound)
}

/// bash: send a line to host:port and print the line that comes back.
fn ping_script(addr: SocketAddr) -> String {
    format!(
        "exec 3<>/dev/tcp/{}/{} && echo ping >&3 && read -r answer <&3 && echo \"$answer\"",
        addr.ip(),
        addr.port()
    )
}

// ---------- the policy as printed ----------

#[test]
fn print_shows_a_deny_by_default_policy_for_this_platform() {
    if skip(
        "print_shows_a_deny_by_default_policy_for_this_platform",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let mut command = Command::new(BIN);
    command
        .arg("print")
        .arg("--own-dir")
        .arg(&bench.own)
        .args(["--preset", "npm", "--", "true"]);
    bench.agent_env(&mut command);
    let out = finish(command, DEADLINE);
    assert!(out.status.success(), "{}", describe(&out));
    let text = stdout(&out);
    if cfg!(target_os = "macos") {
        assert!(text.starts_with("(version 1)\n(deny default)\n"), "{text}");
        assert!(!text.contains("(allow default)"));
    } else {
        assert!(
            text.contains("--tmpfs\n/\n") && text.contains("--unshare-net\n"),
            "{text}"
        );
        assert!(!text.contains("--bind\n/\n/\n"));
    }
    assert!(text.contains(bench.own.to_str().unwrap()));
}

#[test]
fn an_unknown_preset_or_a_bad_host_stops_before_anything_runs() {
    if skip(
        "an_unknown_preset_or_a_bad_host_stops_before_anything_runs",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    for bad in [
        ["--preset", "everything"],
        ["--allow-host", "*.example.com"],
    ] {
        let out = bench.bash(&bad, "echo ran > \"$PWD/ran\"");
        assert!(!out.status.success());
        assert!(
            !bench.workspace.join("ran").exists(),
            "{bad:?}: {}",
            describe(&out)
        );
    }
}

// ---------- a) what must be invisible ----------

#[test]
fn files_of_other_runs_the_repo_and_packages_above_the_run_are_unreadable() {
    if skip(
        "files_of_other_runs_the_repo_and_packages_above_the_run_are_unreadable",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let canaries = [
        bench.path("work/run-b/workspace/answer.txt"),
        bench.path("repo/acceptance/tests/story-01.spec.ts"),
        bench.path("package.json"),
        bench.path(&format!("node_modules/{LEAK_PACKAGE}/index.js")),
        bench.path(&format!("work/node_modules/{LEAK_PACKAGE}/index.js")),
    ];
    for canary in &canaries {
        let script = format!("cat {}", quoted(canary));
        let control = bench.bash_outside(&script);
        assert!(
            stdout(&control).contains(SECRET),
            "control: {canary:?} is readable without the sandbox"
        );
        let out = bench.bash(&[], &script);
        assert!(
            !out.status.success(),
            "{canary:?} was read: {}",
            describe(&out)
        );
        assert!(!stdout(&out).contains(SECRET));
    }
    for dir in [
        "work",
        "work/run-b",
        "repo",
        "node_modules",
        "work/node_modules",
        "",
    ] {
        let listing = stdout(&bench.bash(&[], &format!("ls -A {}", quoted(&bench.path(dir)))));
        for hidden in [
            "run-b",
            "repo",
            "acceptance",
            "answer.txt",
            "node_modules",
            "package.json",
            LEAK_PACKAGE,
        ] {
            assert!(
                !listing.lines().any(|l| l == hidden),
                "ls {dir:?} shows {hidden}: {listing}"
            );
        }
    }
}

#[test]
fn the_home_directory_cannot_be_listed_and_its_private_directories_are_closed() {
    if skip(
        "the_home_directory_cannot_be_listed_and_its_private_directories_are_closed",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let home = real_home();
    let control = stdout(&bench.bash_outside(&format!("ls -A {}", quoted(&home))));
    assert!(
        control.lines().count() > 1,
        "control: the home lists without the sandbox"
    );
    let listing = stdout(&bench.bash(&[], &format!("ls -A {}", quoted(&home))));
    // Linux shows the directories that lead to something allowed (and nothing in them); macOS shows nothing.
    let mut leads_somewhere: Vec<PathBuf> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    leads_somewhere.push(bench.own.clone());
    for name in listing.lines() {
        let entry = home.join(name);
        assert!(
            leads_somewhere
                .iter()
                .any(|allowed| allowed.starts_with(&entry)),
            "the home listing shows an entry that leads to nothing the sandbox allows"
        );
    }
    for private in [
        ".ssh",
        ".dbench",
        ".claude",
        ".config",
        ".npmrc",
        "Library",
        "Documents",
    ] {
        let path = home.join(private);
        let script = format!(
            "ls -A {0} 2>/dev/null; cat {0} 2>/dev/null; true",
            quoted(&path)
        );
        let out = bench.bash(&[], &script);
        assert!(
            out.stdout.is_empty(),
            "something under the home's {private} was readable"
        );
    }
}

#[test]
fn the_machines_shared_temp_directories_are_closed() {
    if skip("the_machines_shared_temp_directories_are_closed", &[]) {
        return;
    }
    let bench = Bench::new();
    let name = format!("{}-{}-canary", common::TEST_DIR_PREFIX, std::process::id());
    let mut canaries = vec![PathBuf::from("/tmp").join(&name)];
    let user_temp = std::env::temp_dir();
    if !user_temp.starts_with("/tmp") {
        canaries.push(user_temp.join(&name));
    }
    for canary in &canaries {
        std::fs::write(canary, SECRET).unwrap();
        let script = format!("cat {}", quoted(canary));
        let control = stdout(&bench.bash_outside(&script));
        let out = bench.bash(&[], &script);
        let listing = bench.bash(&[], &format!("ls -A {}", quoted(canary.parent().unwrap())));
        std::fs::remove_file(canary).unwrap();
        assert!(control.contains(SECRET), "control: {canary:?}");
        assert!(
            !out.status.success() && !stdout(&out).contains(SECRET),
            "{canary:?} was read"
        );
        assert!(!stdout(&listing).contains(&name), "{canary:?} was listed");
    }
}

#[test]
fn nothing_outside_the_run_can_be_written() {
    if skip("nothing_outside_the_run_can_be_written", &[]) {
        return;
    }
    let bench = Bench::new();
    let name = format!("{}-{}-written", common::TEST_DIR_PREFIX, std::process::id());
    let targets = [
        bench.path("work/run-b/workspace").join(&name),
        bench.path("repo").join(&name),
        bench.path("").join(&name),
        real_home().join(&name),
        PathBuf::from("/tmp").join(&name),
    ];
    for target in &targets {
        bench.bash(&[], &format!("echo intruder > {}", quoted(target)));
        let written = target.exists();
        let _ = std::fs::remove_file(target);
        assert!(!written, "the sandboxed command wrote {target:?}");
    }
    let out = bench.bash(
        &[],
        &format!(
            "echo changed >> {}",
            quoted(&bench.path("work/run-b/workspace/answer.txt"))
        ),
    );
    assert!(!out.status.success());
    assert_eq!(
        std::fs::read_to_string(bench.path("work/run-b/workspace/answer.txt")).unwrap(),
        SECRET
    );
}

#[test]
fn a_read_only_path_can_be_read_and_run_but_not_written() {
    if skip("a_read_only_path_can_be_read_and_run_but_not_written", &[]) {
        return;
    }
    let bench = Bench::new();
    let tool = bench
        .base
        .file("tools/bin/hello", "#!/bin/sh\necho hello from the tool\n");
    std::fs::set_permissions(
        &tool,
        std::os::unix::fs::PermissionsExt::from_mode(EXECUTABLE),
    )
    .unwrap();
    let tools = bench.path("tools");
    let ro = [
        "--ro",
        tools.to_str().unwrap(),
        "--ro",
        "/nonexistent/agent-sandbox-test-tools",
    ];
    let out = bench.bash(&ro, &format!("{0} && cat {0} | wc -l", quoted(&tool)));
    assert!(
        out.status.success() && stdout(&out).contains("hello from the tool"),
        "{}",
        describe(&out)
    );
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("does not exist"),
        "the missing --ro path is reported"
    );
    let out = bench.bash(
        &ro,
        &format!(
            "echo x >> {0} || touch {1}/new",
            quoted(&tool),
            quoted(&tools)
        ),
    );
    assert!(!out.status.success(), "{}", describe(&out));
    assert!(!tools.join("new").exists());
    let closed = bench.bash(&[], &format!("cat {}", quoted(&tool)));
    assert!(
        !closed.status.success(),
        "without --ro the tool is not readable"
    );
}

#[test]
fn a_command_found_on_path_through_a_symlink_starts_by_its_name() {
    if skip(
        "a_command_found_on_path_through_a_symlink_starts_by_its_name",
        &[],
    ) {
        return;
    }
    // As an agent client is installed: ~/.local/bin/agent -> ~/.local/share/agent/versions/1.0
    let bench = Bench::new();
    let real = bench
        .base
        .file("share/agent/versions/1.0", "#!/bin/sh\necho agent 1.0\n");
    std::fs::set_permissions(
        &real,
        std::os::unix::fs::PermissionsExt::from_mode(EXECUTABLE),
    )
    .unwrap();
    bench.base.file("share/agent/versions/0.9", SECRET);
    let bin = bench.base.dir("bin");
    std::os::unix::fs::symlink(&real, bin.join("agent")).unwrap();
    let path = std::env::join_paths(std::iter::once(bin).chain(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    )))
    .unwrap();
    let mut command = bench.sandboxed(&[], &["agent"]);
    command.env("PATH", &path);
    let out = finish(command, DEADLINE);
    assert!(
        out.status.success() && stdout(&out) == "agent 1.0\n",
        "{}",
        describe(&out)
    );
    let beside = bench.path("share/agent/versions/0.9");
    let mut peek = bench.sandboxed(&[], &[BASH, "-c", &format!("cat {}", quoted(&beside))]);
    peek.env("PATH", &path);
    let out = finish(peek, DEADLINE);
    assert!(
        !out.status.success(),
        "only the one resolved file is opened, not what lies beside it"
    );
}

// ---------- b) what must work: the run's own directory ----------

#[test]
fn the_workspace_is_writable_and_temp_files_land_in_the_runs_own_tmp() {
    if skip(
        "the_workspace_is_writable_and_temp_files_land_in_the_runs_own_tmp",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let out = bench.bash(
        &[],
        "echo built > out.txt && mkdir -p src/deep && echo x > src/deep/f && echo home > \"$HOME/.rc\" && \
         echo t > \"$TMPDIR/direct\" && f=$(mktemp) && d=$(mktemp -d) && echo m > \"$f\" && echo n > \"$d/inside\" && \
         basename \"$f\" && basename \"$d\"",
    );
    assert!(out.status.success(), "{}", describe(&out));
    assert_eq!(
        std::fs::read_to_string(bench.workspace.join("out.txt")).unwrap(),
        "built\n"
    );
    assert!(bench.workspace.join("src/deep/f").exists());
    assert!(bench.own.join("agent-home/.rc").exists());
    let tmp = bench.own.join("tmp");
    assert!(tmp.join("direct").exists());
    let names: Vec<String> = stdout(&out).lines().map(str::to_string).collect();
    assert_eq!(names.len(), 2);
    assert_eq!(
        std::fs::read_to_string(tmp.join(&names[0])).unwrap(),
        "m\n",
        "mktemp's file is in the run's tmp"
    );
    assert!(
        tmp.join(&names[1]).join("inside").exists(),
        "mktemp -d's directory is in the run's tmp"
    );
}

#[test]
fn the_exit_status_and_output_are_the_commands() {
    if skip("the_exit_status_and_output_are_the_commands", &[]) {
        return;
    }
    let bench = Bench::new();
    let out = bench.bash(&[], "echo to-out; echo to-err >&2; exit 7");
    assert_eq!(out.status.code(), Some(7));
    assert_eq!(stdout(&out), "to-out\n");
    assert!(String::from_utf8_lossy(&out.stderr).contains("to-err"));
    let out = bench.bash(&[], "kill -TERM $$");
    assert_eq!(out.status.code(), Some(SIGTERM_EXIT));
}

#[test]
fn everyday_shell_tools_work() {
    if skip("everyday_shell_tools_work", &[]) {
        return;
    }
    let bench = Bench::new();
    let script = "set -e; ls . >/dev/null; date >/dev/null; id -un >/dev/null; \
        echo a | sed s/a/b/ | awk '{print}' | grep -q b; \
        echo e > /dev/stderr; cat <(echo substituted) >/dev/null; [ \"$(head -c 4 /dev/urandom | wc -c)\" -eq 4 ]; \
        cd \"$TMPDIR\"; echo x > f; tar czf a.tgz f; tar xzf a.tgz; \
        sleep 30 & kill $!";
    let out = bench.bash(&[], script);
    assert!(out.status.success(), "{}", describe(&out));
    let noise = String::from_utf8_lossy(&out.stderr).replace("e\n", "");
    assert!(
        !noise.contains("not permitted") && !noise.contains("denied"),
        "stderr: {noise}"
    );
}

#[test]
fn terminating_the_sandbox_ends_its_command() {
    if skip("terminating_the_sandbox_ends_its_command", &[]) {
        return;
    }
    let bench = Bench::new();
    let mut command = bench.sandboxed(&[], &[BASH, "-c", "echo $$ > \"$PWD/pid\"; sleep 300"]);
    let mut child = command.process_group(0).spawn().unwrap();
    let pid_file = bench.workspace.join("pid");
    let end = Instant::now() + DEADLINE;
    while !pid_file.exists() && Instant::now() < end {
        std::thread::sleep(POLL);
    }
    // SAFETY: signals the one process this test started.
    unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
    let started = Instant::now();
    let status = child.wait().unwrap();
    // SAFETY: sweeps only the process group this test created.
    unsafe { libc::kill(-(child.id() as libc::pid_t), libc::SIGKILL) };
    assert!(started.elapsed() < DEADLINE, "the sandbox ignored SIGTERM");
    assert!(!status.success());
}

// ---------- c) the workload's tools ----------

#[test]
fn git_can_create_a_repository_and_commit() {
    if skip("git_can_create_a_repository_and_commit", &["git"]) {
        return;
    }
    let bench = Bench::new();
    let out = bench.bash(
        &[],
        "git init -q . && echo a > a.txt && git add a.txt && \
         git -c user.name=agent -c user.email=agent@example.invalid commit -q -m 'first commit' && \
         git log --oneline && git status --short",
    );
    assert!(out.status.success(), "{}", describe(&out));
    assert!(stdout(&out).contains("first commit"));
    assert!(bench.workspace.join(".git/HEAD").exists());
}

#[test]
fn node_runs_and_cannot_use_a_package_from_above_the_run() {
    if skip(
        "node_runs_and_cannot_use_a_package_from_above_the_run",
        &["node"],
    ) {
        return;
    }
    let bench = Bench::new();
    let out = finish(
        bench.sandboxed(
            &[],
            &["node", "-e", "console.log(6 * 7, require('os').tmpdir())"],
        ),
        DEADLINE,
    );
    assert!(out.status.success(), "{}", describe(&out));
    let tmp = if cfg!(target_os = "linux") {
        PathBuf::from("/tmp")
    } else {
        bench.own.join("tmp")
    };
    assert!(stdout(&out).starts_with("42 "), "{}", describe(&out));
    assert!(
        cfg!(target_os = "linux") || stdout(&out).trim().ends_with(tmp.to_str().unwrap()),
        "{}",
        describe(&out)
    );

    let resolve = format!("console.log(require('{LEAK_PACKAGE}'))");
    let control = finish(bench.unsandboxed(&["node", "-e", &resolve]), DEADLINE);
    assert!(
        stdout(&control).contains(SECRET),
        "control: node finds the package above the run without the sandbox"
    );
    let out = finish(bench.sandboxed(&[], &["node", "-e", &resolve]), DEADLINE);
    assert!(
        !out.status.success() && !stdout(&out).contains(SECRET),
        "{}",
        describe(&out)
    );
}

#[test]
fn output_sent_to_a_file_outside_the_run_still_arrives() {
    if skip(
        "output_sent_to_a_file_outside_the_run_still_arrives",
        &["node"],
    ) {
        return;
    }
    let bench = Bench::new();
    let log = bench.path("agent.log");
    let mut command = bench.sandboxed(
        &[],
        &[
            "node",
            "-e",
            "console.log('logged'); console.error('and errors')",
        ],
    );
    let file = std::fs::File::create(&log).unwrap();
    let status = command
        .stdout(file.try_clone().unwrap())
        .stderr(file)
        .status()
        .unwrap();
    let text = std::fs::read_to_string(&log).unwrap();
    assert!(
        status.success(),
        "node aborts when it cannot stat its own stdout: {text}"
    );
    assert!(
        text.contains("logged") && text.contains("and errors"),
        "{text}"
    );
}

// ---------- d) the network ----------

#[test]
fn a_server_on_the_hosts_loopback_is_reachable_when_its_port_is_named() {
    if skip(
        "a_server_on_the_hosts_loopback_is_reachable_when_its_port_is_named",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let server = pong_server(IpAddr::V4(Ipv4Addr::LOCALHOST)).unwrap();
    let out = bench.bash(
        &["--host-port", &server.port().to_string()],
        &ping_script(server),
    );
    assert!(
        out.status.success() && stdout(&out) == "pong\n",
        "{}",
        describe(&out)
    );
}

/// node: serve on `port` (0: any free port) and fetch from that server; prints what came back,
/// or the error's code.
fn serve_and_fetch_script(port: u16) -> String {
    format!(
        "const s = require('http').createServer((q, r) => r.end('own server'));\
         s.on('error', (e) => {{ console.log(e.code); process.exit(1); }});\
         s.listen({port}, '127.0.0.1', async () => {{\
           try {{ const r = await fetch(`http://127.0.0.1:${{s.address().port}}/`); console.log(await r.text()); }}\
           catch (e) {{ console.log('fetch failed', e.cause?.code); process.exitCode = 1; }}\
           s.close(); }});"
    )
}

#[test]
fn the_command_can_serve_and_reach_a_port_given_to_it() {
    if skip(
        "the_command_can_serve_and_reach_a_port_given_to_it",
        &["node"],
    ) {
        return;
    }
    let bench = Bench::new();
    let port = fixed_port();
    let out = finish(
        bench.sandboxed(
            &["--agent-ports", &format!("{port}-{}", port + 1)],
            &["node", "-e", &serve_and_fetch_script(port)],
        ),
        DEADLINE,
    );
    assert!(
        out.status.success() && stdout(&out) == "own server\n",
        "{}",
        describe(&out)
    );
}

#[test]
fn with_ephemeral_ports_the_command_can_serve_on_a_port_the_kernel_picks() {
    if skip(
        "with_ephemeral_ports_the_command_can_serve_on_a_port_the_kernel_picks",
        &["node"],
    ) {
        return;
    }
    let bench = Bench::new();
    let out = finish(
        bench.sandboxed(
            &["--ephemeral-ports"],
            &["node", "-e", &serve_and_fetch_script(ANY_PORT)],
        ),
        DEADLINE,
    );
    assert!(
        out.status.success() && stdout(&out) == "own server\n",
        "{}",
        describe(&out)
    );
}

/// macOS only: on Linux the sandbox's loopback is its own, so any port in it can be served on.
#[cfg(target_os = "macos")]
#[test]
fn macos_a_port_that_was_not_given_cannot_be_served_on() {
    if skip(
        "macos_a_port_that_was_not_given_cannot_be_served_on",
        &["node"],
    ) {
        return;
    }
    let bench = Bench::new();
    let given = fixed_port();
    let other = fixed_port();
    for port in [other, ANY_PORT] {
        let control = finish(
            bench.unsandboxed(&["node", "-e", &serve_and_fetch_script(port)]),
            DEADLINE,
        );
        assert_eq!(stdout(&control), "own server\n", "control: port {port}");
        let out = finish(
            bench.sandboxed(
                &["--agent-ports", &given.to_string()],
                &["node", "-e", &serve_and_fetch_script(port)],
            ),
            DEADLINE,
        );
        assert!(
            !out.status.success() && stdout(&out) == "EPERM\n",
            "port {port}: {}",
            describe(&out)
        );
    }
}

/// The servers of other runs and of the harness: one on a port the kernel picked, one on a fixed
/// port. Neither was named, so neither is reachable, whatever else was named.
#[test]
fn a_host_loopback_port_that_was_not_named_is_unreachable() {
    if skip(
        "a_host_loopback_port_that_was_not_named_is_unreachable",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let named = pong_server(loopback).unwrap();
    let own = fixed_port();
    let extra = [
        "--host-port",
        &named.port().to_string(),
        "--agent-ports",
        &own.to_string(),
        "--preset",
        "npm",
    ];
    for server in [
        pong_server(loopback).unwrap(),
        pong_server_on(loopback, fixed_port()).unwrap(),
    ] {
        let control = bench.bash_outside(&ping_script(server));
        assert_eq!(
            stdout(&control),
            "pong\n",
            "control: {server} is reachable without the sandbox"
        );
        for args in [&[][..], &extra[..]] {
            let out = bench.bash(args, &ping_script(server));
            assert!(
                !out.status.success() && !stdout(&out).contains("pong"),
                "{server} was reached with {args:?}: {}",
                describe(&out)
            );
        }
    }
    let out = bench.bash(&extra, &ping_script(named));
    assert_eq!(stdout(&out), "pong\n", "the named one: {}", describe(&out));
}

/// macOS only, and a gap stated plainly: Seatbelt cannot say "ports this sandbox bound", so
/// --ephemeral-ports opens every port of the kernel's ephemeral range, including one another
/// process listens on. Fixed ports (dev servers, the harness, databases) stay closed. On Linux
/// the flag changes nothing: a_host_loopback_port_that_was_not_named_is_unreachable holds.
#[cfg(target_os = "macos")]
#[test]
fn macos_ephemeral_ports_open_that_range_and_no_fixed_port() {
    if skip(
        "macos_ephemeral_ports_open_that_range_and_no_fixed_port",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let loopback = IpAddr::V4(Ipv4Addr::LOCALHOST);
    let fixed = pong_server_on(loopback, fixed_port()).unwrap();
    let out = bench.bash(&["--ephemeral-ports"], &ping_script(fixed));
    assert!(
        !out.status.success() && !stdout(&out).contains("pong"),
        "a fixed port was reached: {}",
        describe(&out)
    );
    let ephemeral = pong_server(loopback).unwrap();
    assert!(ephemeral.port() >= EPHEMERAL_FROM);
    let out = bench.bash(&["--ephemeral-ports"], &ping_script(ephemeral));
    assert_eq!(
        stdout(&out),
        "pong\n",
        "the known gap has changed; update README.md: {}",
        describe(&out)
    );
}

/// A server on another of this machine's addresses (the LAN or VPN one, where the harness's own
/// services may listen). On macOS Seatbelt's "localhost" also matches those addresses, so what
/// keeps it closed there is that its port was not named.
#[test]
fn another_address_of_this_machine_is_unreachable() {
    if skip("another_address_of_this_machine_is_unreachable", &[]) {
        return;
    }
    let local = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, ANY_PORT))
        .and_then(|s| s.connect(UNROUTED).and_then(|()| s.local_addr()))
        .map(|a| a.ip())
        .ok()
        .filter(|ip| !ip.is_loopback() && !ip.is_unspecified());
    let Some(server) = local.and_then(pong_server) else {
        eprintln!("SKIP another_address_of_this_machine_is_unreachable: this machine has no address other than loopback");
        return;
    };
    let bench = Bench::new();
    let control = bench.bash_outside(&ping_script(server));
    assert_eq!(
        stdout(&control),
        "pong\n",
        "control: {server} is reachable without the sandbox"
    );
    let out = bench.bash(&["--preset", "npm"], &ping_script(server));
    assert!(
        !out.status.success() && !stdout(&out).contains("pong"),
        "{server} was reached: {}",
        describe(&out)
    );
}

/// Needs no network: the address is never routed, so outside a sandbox the connection times out
/// or finds no route. Inside, the sandbox itself must refuse it at once, with its own error.
#[test]
fn a_connection_to_another_machine_is_refused_by_the_sandbox_itself() {
    if skip(
        "a_connection_to_another_machine_is_refused_by_the_sandbox_itself",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let started = Instant::now();
    let out = bench.bash(
        &["--preset", "npm"],
        &format!("exec 3<>/dev/tcp/{}/{HTTPS_PORT}", UNROUTED.0),
    );
    let error = String::from_utf8_lossy(&out.stderr).to_lowercase();
    assert!(!out.status.success(), "{}", describe(&out));
    assert!(
        started.elapsed() < REFUSAL_DEADLINE,
        "the connection was attempted, not refused: {:?}",
        started.elapsed()
    );
    let refusal = if cfg!(target_os = "macos") {
        "operation not permitted"
    } else {
        "network is unreachable"
    };
    assert!(
        error.contains(refusal),
        "expected the sandbox's own refusal ({refusal}): {}",
        describe(&out)
    );
}

#[test]
fn online_a_direct_connection_to_an_allowed_host_is_still_refused() {
    let test = "online_a_direct_connection_to_an_allowed_host_is_still_refused";
    if skip(test, &[]) || offline(test) {
        return;
    }
    let registry = (NPM_REGISTRY, HTTPS_PORT)
        .to_socket_addrs()
        .unwrap()
        .find(SocketAddr::is_ipv4)
        .unwrap();
    let script = format!(
        "exec 3<>/dev/tcp/{}/{} && echo connected",
        registry.ip(),
        registry.port()
    );
    let bench = Bench::new();
    let control = bench.bash_outside(&script);
    assert_eq!(
        stdout(&control),
        "connected\n",
        "control: {registry} is reachable without the sandbox"
    );
    let out = bench.bash(&["--preset", "npm"], &script);
    assert!(
        !out.status.success() && !stdout(&out).contains("connected"),
        "only the proxy may connect out: {}",
        describe(&out)
    );
}

#[test]
fn with_no_allowed_host_there_is_no_proxy_and_no_way_out() {
    if skip("with_no_allowed_host_there_is_no_proxy_and_no_way_out", &[]) {
        return;
    }
    let bench = Bench::new();
    let out = bench.bash(
        &[],
        "echo \"proxy=[$HTTPS_PROXY$HTTP_PROXY$https_proxy$http_proxy]\"",
    );
    assert_eq!(stdout(&out), "proxy=[]\n", "{}", describe(&out));
}

#[test]
fn a_host_that_is_not_allowed_gets_403_from_the_proxy_and_is_logged() {
    if skip(
        "a_host_that_is_not_allowed_gets_403_from_the_proxy_and_is_logged",
        &[],
    ) {
        return;
    }
    let bench = Bench::new();
    let log = bench.path("proxy.jsonl");
    let script = "[ \"$HTTPS_PROXY\" = \"$HTTP_PROXY\" ] && [ \"$NO_PROXY\" = localhost,127.0.0.1 ] && \
        exec 3<>/dev/tcp/127.0.0.1/${HTTPS_PROXY##*:} && \
        printf 'CONNECT github.com:443 HTTP/1.1\\r\\nHost: github.com:443\\r\\n\\r\\n' >&3 && read -r answer <&3 && echo \"$answer\"";
    let out = bench.bash(
        &["--preset", "npm", "--proxy-log", log.to_str().unwrap()],
        script,
    );
    assert!(out.status.success(), "{}", describe(&out));
    assert!(
        stdout(&out).starts_with("HTTP/1.1 403 "),
        "{}",
        describe(&out)
    );
    let logged = std::fs::read_to_string(&log).unwrap();
    let line: serde_json::Value = serde_json::from_str(logged.lines().next().unwrap()).unwrap();
    assert_eq!(line["request"], "CONNECT github.com:443 HTTP/1.1");
    assert_eq!(line["allowed"], false);
    let peek = bench.bash(
        &["--preset", "npm", "--proxy-log", log.to_str().unwrap()],
        &format!("cat {}", quoted(&log)),
    );
    assert!(
        !peek.status.success(),
        "the proxy's log is outside the run and unreadable from inside"
    );
}

#[test]
fn online_npm_install_works_through_the_proxy_with_only_the_npm_preset() {
    let test = "online_npm_install_works_through_the_proxy_with_only_the_npm_preset";
    if skip(test, &["node", "npm"]) || offline(test) {
        return;
    }
    let bench = Bench::new();
    std::fs::write(
        bench.workspace.join("package.json"),
        r#"{"name": "probe", "private": true}"#,
    )
    .unwrap();
    let log = bench.path("proxy.jsonl");
    let extra = ["--preset", "npm", "--proxy-log", log.to_str().unwrap()];
    let install = bench.sandboxed(
        &extra,
        &["npm", "install", "is-number", "--no-audit", "--no-fund"],
    );
    let out = finish(install, INSTALL_DEADLINE);
    assert!(out.status.success(), "{}", describe(&out));
    assert!(bench
        .workspace
        .join("node_modules/is-number/package.json")
        .exists());
    assert!(
        bench.own.join("agent-home/.npm").is_dir(),
        "npm's cache is the run's own, not the user's"
    );

    let fetch = "fetch('https://github.com/').then(() => { console.log('reached'); }, (e) => { console.log('blocked'); })";
    let out = finish(bench.sandboxed(&extra, &["node", "-e", fetch]), DEADLINE);
    assert_eq!(stdout(&out), "blocked\n", "{}", describe(&out));

    let lines: Vec<serde_json::Value> = std::fs::read_to_string(&log)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    let (allowed, refused): (Vec<_>, Vec<_>) = lines.iter().partition(|l| l["allowed"] == true);
    assert!(!allowed.is_empty());
    for line in &allowed {
        assert_eq!(
            line["request"],
            format!("CONNECT {NPM_REGISTRY}:443 HTTP/1.1")
        );
    }
    assert!(
        refused
            .iter()
            .any(|l| l["request"] == "CONNECT github.com:443 HTTP/1.1"),
        "{refused:?}"
    );
}

#[test]
fn online_the_harness_workload_installs_builds_serves_and_loads_in_chromium() {
    let test = "online_the_harness_workload_installs_builds_serves_and_loads_in_chromium";
    if skip(test, &["node", "npm", "npx"]) || offline(test) {
        return;
    }
    let bench = Bench::new();
    for (name, body) in [
        ("package.json", PACKAGE_JSON),
        ("index.html", INDEX_HTML),
        ("vite.config.js", VITE_CONFIG),
        ("wrangler.jsonc", WRANGLER_JSONC),
        ("browse.mjs", BROWSE_MJS),
        ("drive.mjs", DRIVE_MJS),
    ] {
        std::fs::write(bench.workspace.join(name), body).unwrap();
    }
    let log = bench.path("proxy.jsonl");
    // The shared browser cache is read-only. `playwright install` takes a lock and records the
    // project in the browsers directory, so the run gets a directory of its own that links to the
    // shared browsers (not to its hidden bookkeeping): the install step then finds them complete
    // and downloads nothing.
    let cache = browser_cache();
    let own_browsers = bench.own.join("agent-home/.cache/ms-playwright");
    let mut extra = vec!["--preset", "npm", "--proxy-log", log.to_str().unwrap()];
    if let Some(cache) = &cache {
        std::fs::create_dir_all(&own_browsers).unwrap();
        for entry in std::fs::read_dir(cache)
            .unwrap()
            .flatten()
            .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        {
            std::os::unix::fs::symlink(entry.path(), own_browsers.join(entry.file_name())).unwrap();
        }
        extra.extend(["--ro", cache.to_str().unwrap()]);
    }
    // The app's port and wrangler's inspector port are the run's own; workerd and miniflare also
    // bind ports the kernel picks and connect to them, which needs --ephemeral-ports.
    let (port, inspector) = (fixed_port().to_string(), fixed_port().to_string());
    extra.extend([
        "--agent-ports",
        &port,
        "--agent-ports",
        &inspector,
        "--ephemeral-ports",
    ]);
    let mut command = bench.sandboxed(&extra, &["node", "drive.mjs", &port, &inspector]);
    if cache.is_some() {
        command.env("PLAYWRIGHT_BROWSERS_PATH", &own_browsers);
    }
    let out = finish(command, WORKLOAD_DEADLINE);
    let text = stdout(&out);
    assert!(out.status.success(), "{}", describe(&out));
    for step in ["npm install", "vite build", "wrangler dev"] {
        assert!(
            text.contains(&format!("STEP OK: {step}")),
            "{}",
            describe(&out)
        );
    }
    assert!(bench.workspace.join("dist/client/index.html").exists());
    match text.lines().find(|l| l.starts_with("CHROMIUM SKIPPED")) {
        Some(why) => eprintln!("SKIP {test} (Chromium step only): {why}"),
        None => {
            assert!(
                text.contains("STEP OK: playwright browsers"),
                "{}",
                describe(&out)
            );
            assert!(text.contains("STEP OK: chromium"), "{}", describe(&out));
        }
    }
    let logged = std::fs::read_to_string(&log).unwrap();
    for line in logged
        .lines()
        .map(|l| serde_json::from_str::<serde_json::Value>(l).unwrap())
    {
        let to_registry = line["request"] == format!("CONNECT {NPM_REGISTRY}:443 HTTP/1.1");
        assert_eq!(
            line["allowed"] == true,
            to_registry,
            "only the registry is let through: {line}"
        );
    }
}
