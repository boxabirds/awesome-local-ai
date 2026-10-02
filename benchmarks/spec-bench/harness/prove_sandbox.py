# /// script
# requires-python = ">=3.11"
# ///
"""Prove the agent's world on this machine: from inside the sandbox, the way a story starts the agent, try every forbidden
thing and every permitted thing and say PASS or FAIL for each. Exit status 1 if any FAIL.

    benchmarks/spec-bench/harness/prove-sandbox.sh            # on a bench machine, in a checkout or in a release

What it does, and what it does not touch:
  - It starts a probe (a shell script) in place of the agent, through the harness's own path (drive.run_agent: the same
    allow-listed environment, the same agent-sandbox flags, the same descriptors), in a run directory of its own in a
    temporary directory. It never reads or writes a benchmark run, a results checkout or the bench home.
  - Around the probe it puts canaries a leak would show: a file in a stand-in "repository", another run's file, a "file
    share" and a private dbench directory in the home directory, a file in this machine's /tmp, a process outside, a
    server of another run on the loopback, and a key in this process's own environment. Each canary is first read from
    outside, so a refusal is the sandbox's and not a missing file. They are removed afterwards.
  - The only network it needs is the allow-list's own: the npm registry, and the Playwright CDN. Offline, the two
    network checks are SKIPPED and say so; nothing else needs the network.

Used by the harness's own tests (test_agent_world.py), so what is proven here is what CI proves on Linux.
"""
from __future__ import annotations

import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import uuid
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import drive
import hostenv
import packdir
import preflight
import sandbox
from clients import PiClient

RUN_NAME = "qwen__3.8__flash-next__macos__128GB__mlxserve-pi__benchmarks__vidi__v2-r3"
CANARY_KEY = "FAKE_API_KEY"
CANARY_VALUE = "sk-canary-0123456789abcdef"
SECRET = "the-held-out-answer"
MODEL_REPLY = "MODEL-SERVER-OK"
OTHER_RUN_REPLY = "OTHER-RUNS-SERVER"
NPM_REGISTRY = "https://registry.npmjs.org/"
PLAYWRIGHT_CDN = "https://cdn.playwright.dev/"
UNLISTED_HOST = "https://example.com/"
RAW_IP = "https://1.1.1.1/"
CURL_SECONDS = 20
SPEC_TEXT = "the requirements\n"
FIXED_PORT_BASE = 41_300       # away from the kernels' ephemeral ranges and the harness's own ports
FIXED_PORT_TRIES = 400
ONLINE_TIMEOUT_S = 5
ENV_WORDS = ("qwen", "mlx", "macos", "v2-r3", "vidi", "bench")
PATH_WORDS = (*ENV_WORDS, "/work/", "128gb", "flash")
TEMP_PREFIX = ".agent-sandbox-prove-"
TEMP_TAG_CHARS = 8


def free_fixed_port(taken: set[int]) -> int:
    for port in range(FIXED_PORT_BASE, FIXED_PORT_BASE + FIXED_PORT_TRIES):
        if port in taken:
            continue
        s = socket.socket()
        try:
            s.bind(("127.0.0.1", port))
        except OSError:
            continue
        finally:
            s.close()
        return port
    raise RuntimeError("no free port")


def serve(port: int, reply: str) -> HTTPServer:
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.end_headers()
            self.wfile.write(reply.encode())

        def log_message(self, *a):
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def online() -> bool:
    try:
        socket.create_connection(("registry.npmjs.org", 443), timeout=ONLINE_TIMEOUT_S).close()
        return True
    except OSError:
        return False


class Probe(PiClient):
    """A client whose "agent" is a shell script."""

    def __init__(self, work: Path, script: str, view: Path):
        super().__init__(work, view=view)
        self.script = script

    def command(self, model_id, prompt, resume_from=None, fork=True):
        return ["sh", "-c", self.script]

    def scan(self, e, st):
        return None


# One script, one session: each line it prints is "name: value".
PROBE = r"""
say() { printf '%s: %s\n' "$1" "$(printf '%s' "$2" | tr '\n' ' ')"; }
say cwd "$(pwd -P)"
say pwd_var "$PWD"
say home "$HOME"
say env_names "$(env | cut -d= -f1 | sort | tr '\n' ' ')"
say env_text "$(env)"
say canary_env "$(printenv @CANARY_KEY@ || echo absent)"
say canary_proc_environ "$(tr '\0' '\n' < /proc/self/environ 2>/dev/null | grep -c @CANARY_KEY@; true)"
say canary_outside_environ "$(cat /proc/@CANARY_PID@/environ 2>/dev/null | tr '\0' '\n' | grep -c @CANARY_KEY@; true)"
say ls_root "$(ls / 2>&1)"
say ls_home "$(ls "$HOME" 2>&1)"
say ls_real_home "$(ls @REAL_HOME@ 2>&1 | head -c 300)"
say write_real_home "$(touch @REAL_HOME@/written-by-the-agent 2>&1 && echo WROTE)"
say read_repo "$(cat @REPO_FILE@ 2>&1 | head -c 100)"
say read_other_run "$(cat @OTHER_RUN_FILE@ 2>&1 | head -c 100)"
say read_share "$(cat @SHARE_FILE@ 2>&1 | head -c 100)"
say read_dbench "$(cat @DBENCH_FILE@ 2>&1 | head -c 100)"
say read_host_tmp "$(cat @HOST_TMP_FILE@ 2>&1 | head -c 100)"
say ls_tmp "$(ls /tmp 2>&1 | head -c 300)"
say tmpdir "$TMPDIR"
say write_tmp "$(echo x > "$TMPDIR/scratch" && cat "$TMPDIR/scratch")"
say heredoc "$(cat <<'EOF'
works
EOF
)"
say write_workspace "$(echo mine > "$PWD/mine.txt" && cat "$PWD/mine.txt")"
say chmod_spec "$(chmod u+w spec/tasks.md 2>&1; echo "rc=$?")"
say write_spec "$(echo changed >> spec/tasks.md 2>&1; echo "rc=$?")"
say create_in_spec "$(echo x > spec/new.md 2>&1; echo "rc=$?")"
say write_progress "$(echo done > PROGRESS.md 2>&1; echo "rc=$?")"
say sudo "$(sudo -n true 2>&1; echo "rc=$?")"
say no_new_privs "$(grep NoNewPrivs /proc/self/status 2>/dev/null || echo n/a)"
say model_server "$(curl -s -m 5 http://127.0.0.1:@MODEL_PORT@/ 2>&1; echo " rc=$?")"
say other_runs_server "$(curl -s -m 5 http://127.0.0.1:@OTHER_PORT@/ 2>&1; echo " rc=$?")"
say npm_registry "$(curl -sS -m @CURL_SECONDS@ -o /dev/null -w '%{http_code}' @NPM_REGISTRY@ 2>&1; echo " rc=$?")"
say playwright_cdn "$(curl -sS -m @CURL_SECONDS@ -o /dev/null -w '%{http_code}' @PLAYWRIGHT_CDN@ 2>&1; echo " rc=$?")"
say unlisted_host "$(curl -sS -m @CURL_SECONDS@ -o /dev/null -w '%{http_code}' @UNLISTED_HOST@ 2>&1; echo " rc=$?")"
say raw_ip_direct "$(curl -sS -m 10 --noproxy '*' -o /dev/null -w '%{http_code}' @RAW_IP@ 2>&1; echo " rc=$?")"
say raw_ip_proxied "$(curl -sS -m @CURL_SECONDS@ -o /dev/null -w '%{http_code}' @RAW_IP@ 2>&1; echo " rc=$?")"
say own_port "$(node -e "
const http = require('http');
const port = Number(process.env.@PORT_FIRST@);
const s = http.createServer((q, r) => r.end('served')).listen(port, '127.0.0.1', () =>
  fetch('http://127.0.0.1:' + port + '/').then((r) => r.text()).then((t) => { console.log(t); s.close(); }));
s.on('error', (e) => { console.log('ERROR ' + e.code); process.exit(0); });
" 2>&1)"
say foreign_port "$(node -e "
const s = require('http').createServer().listen(@FOREIGN_PORT@, '127.0.0.1', () => { console.log('listening'); s.close(); });
s.on('error', (e) => { console.log('ERROR ' + e.code); process.exit(0); });
" 2>&1)"
"""


GROUPS = ("probe", "filesystem", "environment", "network", "ports", "privileges")
BROWSER_GROUP = "browser"      # its own probe: a project to install and a real Chromium (observe_browser)
BROWSER_PAGE_TEXT = "browser-page-ok"
BROWSER_PROJECT = "browser-probe"
BROWSER_SCRIPT = "browser-probe.mjs"
BROWSER_INSTALL_SECONDS = 600
SHARED_BROWSER_PREFIX = "chromium"


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""
    skipped: bool = False
    group: str = ""


class Observed:
    """What the probe saw, and the canaries around it."""

    out: dict
    lines: list


def observe(scratch: Path, with_network: bool | None = None) -> Observed:
    """Run the probe in a run directory under `scratch`, with every canary, and collect what it printed."""
    o = Observed()
    o.online = online() if with_network is None else with_network
    os.environ[CANARY_KEY] = CANARY_VALUE
    work = scratch / "w" / drive.work_id(RUN_NAME)
    o.work = work
    ws = work / drive.WORKSPACE_DIR
    (ws / "spec").mkdir(parents=True)
    (ws / "spec" / "tasks.md").write_text(SPEC_TEXT)
    (ws / "spec" / "tasks.md").chmod(drive.SPEC_FILE_MODE)       # as the harness leaves it: a hint, not protection
    o.repo_file = scratch / "repo" / "acceptance" / "tests" / "story-01.spec.ts"
    o.other_run_file = scratch / "work" / "qwen__other-run__benchmarks__vidi__v2-r4" / "workspace" / "answer.txt"
    o.share_file = scratch / "sambashare" / "tools" / "reference-build" / "geometry.ts"
    o.dbench_file = scratch / "dotdbench" / "jobs" / "job.json"
    o.host_tmp_file = Path("/tmp") / f"agent-sandbox-prove-{uuid.uuid4().hex[:TEMP_TAG_CHARS]}"
    for f in (o.repo_file, o.other_run_file, o.share_file, o.dbench_file, o.host_tmp_file):
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(SECRET)
        assert f.read_text() == SECRET          # readable from outside: a refusal below is the sandbox's
    o.canary = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(600)"])      # its environment holds the canary key
    taken: set[int] = set()
    o.model_port = free_fixed_port(taken)
    taken.add(o.model_port)
    o.model = serve(o.model_port, MODEL_REPLY)
    o.other_port = free_fixed_port(taken)
    taken.add(o.other_port)
    o.other = serve(o.other_port, OTHER_RUN_REPLY)
    o.foreign_port = free_fixed_port(taken)
    script = PROBE
    for name, value in {
        "CANARY_KEY": CANARY_KEY, "REAL_HOME": str(Path.home()), "REPO_FILE": o.repo_file,
        "OTHER_RUN_FILE": o.other_run_file, "SHARE_FILE": o.share_file, "DBENCH_FILE": o.dbench_file,
        "HOST_TMP_FILE": o.host_tmp_file, "CANARY_PID": o.canary.pid,
        "MODEL_PORT": o.model_port, "OTHER_PORT": o.other_port, "FOREIGN_PORT": o.foreign_port,
        "CURL_SECONDS": CURL_SECONDS, "NPM_REGISTRY": NPM_REGISTRY, "PLAYWRIGHT_CDN": PLAYWRIGHT_CDN,
        "UNLISTED_HOST": UNLISTED_HOST, "RAW_IP": RAW_IP, "PORT_FIRST": sandbox.PORT_FIRST_ENV,
    }.items():
        script = script.replace(f"@{name}@", str(value))
    view = sandbox.view_root(work)
    old_world = drive.WORLD
    drive.WORLD = sandbox.World(run=work.name, host_ports=(o.model_port,), kernel_picked_ports=False)
    events = scratch / "events.jsonl"
    try:
        o.result = drive.run_agent(Probe(work, script, view), ws, drive.agent_env(work, view), "model", "prompt", events)
    finally:
        drive.WORLD = old_world
    o.lines = events.read_text().splitlines()
    o.out = {}
    for line in o.lines:
        name, sep, value = line.partition(": ")
        if sep and name.isidentifier():
            o.out[name] = value
    o.own_file_written = (ws / "mine.txt").exists()
    o.real_home_marker = Path.home() / "written-by-the-agent"
    o.spec_after = (ws / "spec" / "tasks.md").read_text()
    o.spec_mode = (ws / "spec" / "tasks.md").stat().st_mode & 0o777
    o.spec_new = (ws / "spec" / "new.md").exists()
    return o


def cleanup(o: Observed) -> None:
    o.canary.kill()
    o.canary.wait()
    o.model.shutdown()
    o.other.shutdown()
    o.host_tmp_file.unlink(missing_ok=True)
    o.real_home_marker.unlink(missing_ok=True)
    os.environ.pop(CANARY_KEY, None)


def _no(words, text: str) -> str:
    return next((w for w in words if w in text.lower()), "")


def checks(o: Observed) -> list[Check]:
    """Every property of the agent's world, as the probe saw it. In the order of the owner's list."""
    out, mac = o.out, sys.platform == "darwin"
    cs: list[Check] = []
    group = [GROUPS[0]]

    def add(name: str, ok: bool, detail: str = "", skip: bool = False):
        cs.append(Check(name, bool(ok), "" if ok else detail, skip, group[0]))

    add("the probe ran to its end", "own_port" in out and "foreign_port" in out, "\n".join(o.lines[-12:]))
    group[0] = "filesystem"
    for label, line in (("cwd", out.get("cwd", "")), ("$PWD", out.get("pwd_var", "")), ("$HOME", out.get("home", "")),
                        ("$TMPDIR", out.get("tmpdir", ""))):
        add(f"{label} names no run, engine, model, machine or benchmark", not _no(PATH_WORDS, line),
            f"{label} contains {_no(PATH_WORDS, line)!r}: {line}")
    add("the cwd is the run's workspace", out.get("cwd", "").strip().endswith("/workspace")
        and out.get("cwd", "").strip() == out.get("pwd_var", "").strip(), out.get("cwd", ""))
    if not mac:
        add("the cwd is /w/workspace on Linux", out.get("cwd", "").strip() == f"{sandbox.VIEW_ROOT}/workspace", out.get("cwd", ""))
    for key, what in (("read_repo", "the repository"), ("read_other_run", "another run's directory"),
                      ("read_share", "a file share"), ("read_dbench", "the private dbench directory"),
                      ("read_host_tmp", "this machine's /tmp")):
        add(f"cannot read {what}", SECRET not in out.get(key, SECRET), f"{key}: {out.get(key)}")
    listing = out.get("ls_real_home", "x")
    add("cannot list the real home directory", listing.strip() == "" or any(w in listing for w in ("No such file", "not permitted", "denied")), listing)
    add("cannot write the real home directory", "WROTE" not in out.get("write_real_home", "WROTE") and not o.real_home_marker.exists(),
        out.get("write_real_home", ""))
    add("/tmp is the run's own: the machine's is not listed", o.host_tmp_file.name not in out.get("ls_tmp", o.host_tmp_file.name), out.get("ls_tmp", ""))
    add("can write its own temp directory", out.get("write_tmp", "").strip() == "x", out.get("write_tmp", ""))
    add("a here-document works", out.get("heredoc", "").strip() == "works", out.get("heredoc", ""))
    add("can write the workspace", out.get("write_workspace", "").strip() == "mine" and o.own_file_written, out.get("write_workspace", ""))
    add("can write PROGRESS.md", out.get("write_progress", "").strip() == "rc=0", out.get("write_progress", ""))
    add("cannot change spec/ (write, create, chmod +w)",
        o.spec_after == SPEC_TEXT and not o.spec_new and o.spec_mode == drive.SPEC_FILE_MODE
        and all("rc=0" not in out.get(k, "rc=0") for k in ("write_spec", "create_in_spec")),
        f"spec now {o.spec_after!r} mode {o.spec_mode:o}; {out.get('write_spec')} {out.get('create_in_spec')}")
    group[0] = "environment"
    names = set(out.get("env_names", "").split())
    allowed = set(sandbox.ENV_ALLOWED) | set(sandbox.ENV_FROM_SANDBOX) | set(sandbox.ENV_FROM_SHELL) | {"LANG", "LC_ALL"}
    add("every environment variable is on the allow-list", names and names <= allowed, f"not on it: {sorted(names - allowed)}")
    add("the canary key is not in `env`", CANARY_KEY not in names and CANARY_VALUE not in out.get("env_text", CANARY_VALUE), "in env")
    add("the canary key is not in `printenv` or /proc/self/environ",
        out.get("canary_env", "").strip() == "absent" and out.get("canary_proc_environ", "").strip() in ("0", ""), "found")
    # Not process isolation for its own sake: a process's environment is a file under /proc, and the harness's holds keys.
    add("the environment of a process outside cannot be read through /proc",
        out.get("canary_outside_environ", "").strip() in ("0", ""), "read")
    add("no variable names the run or the benchmark", not _no(ENV_WORDS, out.get("env_text", "")), f"contains {_no(ENV_WORDS, out.get('env_text', ''))!r}")
    group[0] = "network"
    add("the model server on the host's loopback is reachable", MODEL_REPLY in out.get("model_server", ""), out.get("model_server", ""))
    add("another server's loopback port is refused", OTHER_RUN_REPLY not in out.get("other_runs_server", OTHER_RUN_REPLY)
        and "rc=0" not in out.get("other_runs_server", "rc=0"), out.get("other_runs_server", ""))
    add("a raw address is refused (direct)", "rc=0" not in out.get("raw_ip_direct", "rc=0"), out.get("raw_ip_direct", ""))
    add("a raw address is refused (through the proxy)", "rc=0" not in out.get("raw_ip_proxied", "rc=0"), out.get("raw_ip_proxied", ""))
    add("the npm registry is reachable", out.get("npm_registry", "").strip().startswith("200"), out.get("npm_registry", ""), skip=not o.online)
    add("Playwright's CDN is reachable", out.get("playwright_cdn", "").strip()[:1] in ("2", "3", "4"), out.get("playwright_cdn", ""), skip=not o.online)
    add("a host that is not listed is refused", "rc=0" not in out.get("unlisted_host", "rc=0")
        and not out.get("unlisted_host", "").strip().startswith("200"), out.get("unlisted_host", ""), skip=not o.online)
    group[0] = "ports"
    add("it can serve on its own port", out.get("own_port", "").strip().endswith("served"), out.get("own_port", ""))     # node may warn first
    if mac:
        add("on macOS it cannot serve on a port it was not given", "EPERM" in out.get("foreign_port", ""), out.get("foreign_port", ""))
    group[0] = "privileges"
    add("there is no sudo", "rc=0" not in out.get("sudo", "rc=0"), out.get("sudo", ""))
    if not mac:
        add("no_new_privs is set", out.get("no_new_privs", "").strip().endswith("1"), out.get("no_new_privs", ""))
    return cs


def main() -> int:
    scratch = Path(tempfile.mkdtemp(prefix=TEMP_PREFIX, dir=Path.home()))
    print(f"sandbox: {sandbox.identity()}")
    print(f"platform: {sys.platform}; probe in {scratch.name}; allow-list of {len(sandbox.ENV_ALLOWED)} environment variables")
    failed = 0
    try:
        o = observe(scratch)
        for c in checks(o):
            if c.skipped:
                print(f"SKIP  {c.group}: {c.name} (offline)")
                continue
            print(f"{'PASS' if c.ok else 'FAIL'}  {c.group}: {c.name}" + (f": {c.detail.strip()[:300]}" if not c.ok else ""))
            failed += not c.ok
        cleanup(o)
        browser = observe_browser(scratch)
        for c in browser_checks(browser):
            reason = f" ({c.detail})" if c.skipped else ""
            print(f"SKIP  {c.group}: {c.name}{reason}" if c.skipped else
                  f"{'PASS' if c.ok else 'FAIL'}  {c.group}: {c.name}" + (f": {c.detail.strip()[:300]}" if not c.ok else ""))
            failed += not c.ok and not c.skipped
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    print(f"{'FAILED' if failed else 'all passed'}{f': {failed} check(s)' if failed else ''}")
    return 1 if failed else 0



# A real Playwright Chromium, in the agent's world, loading a page from a server of its own on the loopback: what a
# story's end-to-end tests do, and what the preflight's browser step does. Then the agent's own `playwright install`.
BROWSER_PAGE_SCRIPT = """
import http from 'node:http';
import { chromium } from '@playwright/test';
const port = Number(process.env.@PORT_FIRST@);
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end('<h1 id=ok>@TEXT@</h1>'); });
await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
try {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(`http://127.0.0.1:${port}/`);
  console.log('page: ' + await p.textContent('#ok')); await b.close();
} catch (e) { console.log('launch failed: ' + String(e.message).split('\\n')[0]); }
server.close();
"""
BROWSER_PROBE = r"""
say() { printf '%s: %s\n' "$1" "$(printf '%s' "$2" | tr '\n' ' ')"; }
mkdir -p @PROJECT@ && cd @PROJECT@ || exit 1
echo '{"private": true, "type": "module"}' > package.json
say npm_install "$(npm install --no-audit --no-fund --silent @playwright/test@@VERSION@ 2>&1 | tail -c 300; echo " rc=$?")"
say browser "$(node @SCRIPT@ 2>&1 | tail -c 400)"
say agent_install "$(timeout @INSTALL_SECONDS@ npx playwright install chromium 2>&1 | tail -c 300; echo " rc=$?")"
say agent_write_shared "$(touch @SHARED@/written-by-the-agent 2>&1 && echo WROTE; touch @SHARED@/chromium-1/libevil.so 2>&1 && echo WROTE)"
"""


def shared_browsers() -> Path:
    return hostenv.agent_playwright_cache(Path.home())


def observe_browser(scratch: Path) -> dict | str:
    """The browser probe's output, or the reason it cannot run here (no browser installed for the agents, no network
    for the install of Playwright's package): such a machine is skipped, and says why. Never installs a browser: that is
    the machine's setup (setup-node.sh), as the machine's user, outside the sandbox."""
    shared = shared_browsers()
    if not any(shared.glob(f"{SHARED_BROWSER_PREFIX}*")):
        return f"no Chromium is installed for the agents in {shared} (the machine's setup installs it)"
    if not online():
        return "offline: the probe installs Playwright's package from the npm registry"
    work = scratch / "w" / drive.work_id(RUN_NAME + "-browser")
    ws = work / drive.WORKSPACE_DIR
    ws.mkdir(parents=True)
    page = BROWSER_PAGE_SCRIPT.replace("@PORT_FIRST@", sandbox.PORT_FIRST_ENV).replace("@TEXT@", BROWSER_PAGE_TEXT)
    (ws / BROWSER_PROJECT).mkdir()
    (ws / BROWSER_PROJECT / BROWSER_SCRIPT).write_text(page)
    version = preflight.playwright_version(packdir.part(drive.PACK, "acceptance"))
    script = BROWSER_PROBE
    for name, value in {"PROJECT": BROWSER_PROJECT, "VERSION": version, "SCRIPT": BROWSER_SCRIPT, "SHARED": shared,
                        "INSTALL_SECONDS": BROWSER_INSTALL_SECONDS}.items():
        script = script.replace(f"@{name}@", str(value))
    view = sandbox.view_root(work)
    old_world = drive.WORLD
    drive.WORLD = sandbox.World(run=work.name)
    events = scratch / "browser-events.jsonl"
    before = sorted(p.name for p in shared.iterdir())
    try:
        drive.run_agent(Probe(work, script, view), ws, drive.agent_env(work, view), "model", "prompt", events)
    finally:
        drive.WORLD = old_world
    out = {}
    for line in events.read_text().splitlines():
        name, sep, value = line.partition(": ")
        if sep and name.isidentifier():
            out[name] = value
    out["shared_untouched"] = "yes" if sorted(p.name for p in shared.iterdir()) == before else "no"
    return out


def browser_checks(o: dict | str) -> list[Check]:
    if isinstance(o, str):
        return [Check(name, True, o, skipped=True, group=BROWSER_GROUP) for name in (
            "Chromium launches in the sandbox and loads a page from a local server",
            "the agent's own `playwright install` cannot change the shared browsers")]
    launched = o.get("browser", "").strip().endswith(f"page: {BROWSER_PAGE_TEXT}")
    install = o.get("agent_install", "")
    return [
        Check("Chromium launches in the sandbox and loads a page from a local server", launched,
              f"{o.get('npm_install', '')} | {o.get('browser', 'no output')}", group=BROWSER_GROUP),
        # Refused (EROFS/EPERM) or a no-op that downloads nothing: either way the shared cache is as it was, and the agent
        # could not write into it by any path.
        Check("the agent's own `playwright install` cannot change the shared browsers",
              o.get("shared_untouched") == "yes" and "WROTE" not in o.get("agent_write_shared", "WROTE"),
              f"{install} | {o.get('agent_write_shared')} | untouched: {o.get('shared_untouched')}", group=BROWSER_GROUP),
    ]


if __name__ == "__main__":
    sys.exit(main())
