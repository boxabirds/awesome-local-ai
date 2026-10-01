# /// script
# requires-python = ">=3.11"
# ///
"""Sandbox preflight: prove the agent's toolchain works inside the sandbox before any story runs.

Every earlier harness bug (EPERM on ancestors, PWD outside the sandbox, a hung tool) only showed up
mid-story, costing an hour each. This builds a tiny Vite + Wrangler + Playwright project inside the
exact sandbox and environment the agent gets, and checks: npm install, vite build, `wrangler dev`
serving it over HTTP, and Chromium loading the page. It also checks the sandbox still hides the repo.

    uv run preflight.py            # exit 0 = ready, 1 = a named step failed
"""
from __future__ import annotations

import json
import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

import drive
import sandbox
from drive import PACK, REPO_ROOT, WORK_ROOT, agent_env, launch_agent

STEP_TIMEOUT_S = 900
PROBE = WORK_ROOT / "_preflight"
SECRET_WORDS = ("KEY", "TOKEN", "SECRET", "PASSWORD")

PACKAGE = {
    "name": "preflight", "private": True, "type": "module",
    "scripts": {"build": "vite build"},
    "devDependencies": {"vite": "^7.0.0", "wrangler": "^4.0.0", "@playwright/test": "^1.55.0"},
}
FILES = {
    "index.html": "<!doctype html><title>preflight</title><h1 id=ok>preflight ok</h1>",
    "vite.config.js": "export default { build: { outDir: 'dist/client' } };",
    "wrangler.jsonc": json.dumps({"name": "preflight", "compatibility_date": "2026-09-01",
                                  "assets": {"directory": "./dist/client"}}),
    "browse.mjs": ("import { chromium } from '@playwright/test';"
                   "const b = await chromium.launch(); const p = await b.newPage();"
                   "await p.goto(`http://127.0.0.1:${process.argv[2]}/`);"
                   "console.log(await p.textContent('#ok')); await b.close();"),
    # The whole workload in ONE sandbox, as an agent session is: on Linux each sandbox has a loopback of its own, so
    # the server and the browser must share one. Each step prints "STEP OK: <name>" or "STEP FAILED: <name>".
    "drive.mjs": """
import { spawn, spawnSync } from 'node:child_process';
const [port, inspector] = process.argv.slice(2);
let server;
const stop = () => { try { server?.kill('SIGTERM'); } catch {} };
const step = (name, cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) { console.log(`STEP FAILED: ${name}\n${r.stdout}\n${r.stderr}`); stop(); process.exit(1); }
  console.log(`STEP OK: ${name}`);
};
step('npm install', 'npm', ['install', '--no-audit', '--no-fund']);
step('vite build', 'npm', ['run', 'build']);
server = spawn('npx', ['wrangler', 'dev', '--port', port, '--inspector-port', inspector, '--ip', '127.0.0.1'], { stdio: 'ignore' });
let up = false;
for (let i = 0; i < 90 && !up; i++) {
  try { up = (await (await fetch(`http://127.0.0.1:${port}/`)).text()).includes('preflight ok'); } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 1000));
}
if (!up) { console.log('STEP FAILED: wrangler dev serves over HTTP'); stop(); process.exit(1); }
console.log('STEP OK: wrangler dev serves over HTTP');
step('playwright browsers', 'npx', ['playwright', 'install', 'chromium']);
const r = spawnSync('node', ['browse.mjs', port], { encoding: 'utf8' });
if (r.status !== 0 || !r.stdout.includes('preflight ok')) {
  console.log(`STEP FAILED: chromium loads the page\n${r.stdout}\n${r.stderr}`); stop(); process.exit(1);
}
console.log('STEP OK: chromium loads the page');
stop();
process.exit(0);
""",
}
# What the agent's world must NOT give, tried from inside it: each prints "<name> refused" or "<name> OPEN".
ISOLATION_SCRIPT = """
try_read() { if ls "$2" >/dev/null 2>&1 || cat "$2" >/dev/null 2>&1; then echo "$1 OPEN"; else echo "$1 refused"; fi; }
try_read "the repository" "{repo}"
try_read "the held-out suite" "{suite}"
try_read "the owner's home" "{home}"
if env | grep -E -i '{secret_words}' >/dev/null; then echo "environment OPEN"; else echo "environment refused"; fi
if touch "{home}/preflight-was-here" 2>/dev/null; then rm -f "{home}/preflight-was-here"; echo "home write OPEN"; else echo "home write refused"; fi
"""


def run_in_world(cmd: list[str], env: dict, secrets: dict[str, str] | None = None, timeout: int = STEP_TIMEOUT_S):
    """cmd as the agent runs it: in the sandbox, in the probe's workspace, with the environment it gets."""
    launch = launch_agent(cmd, PROBE, env, secrets)
    try:
        # A group of its own, so a step that runs out of time takes everything it started with it.
        proc = subprocess.Popen(launch.argv, cwd=PROBE / "workspace", env=launch.env, pass_fds=launch.fds,
                                stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                start_new_session=True)
    finally:
        launch.close()
    try:
        out, err = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        out, err = proc.communicate()
        raise SystemExit(f"PREFLIGHT FAILED: {cmd[0]} ran past {timeout}s\n{(out + err)[-1500:]}")
    return subprocess.CompletedProcess(launch.argv, proc.returncode, out, err)


def workload(env: dict) -> None:
    first, _ = drive.WORLD.ports
    r = run_in_world(["node", "drive.mjs", str(first), str(first + 1)], env)
    out = r.stdout
    for line in out.splitlines():
        if line.startswith("STEP OK: "):
            print(f"  ok  {line[len('STEP OK: '):]}")
    if r.returncode != 0 or "STEP FAILED" in out:
        raise SystemExit(f"PREFLIGHT FAILED: exit {r.returncode}\n{(out + r.stderr)[-2000:]}")


def isolation(env: dict) -> None:
    script = ISOLATION_SCRIPT.format(repo=REPO_ROOT, suite=PACK / "acceptance", home=Path.home(),
                                     secret_words="|".join(SECRET_WORDS))
    r = run_in_world(["sh", "-c", script], env)
    open_ = [l for l in r.stdout.splitlines() if l.endswith(" OPEN")]
    if open_ or r.stdout.count(" refused") != 5:
        raise SystemExit("PREFLIGHT FAILED: the sandbox lets the agent through:\n" + (r.stdout + r.stderr)[-800:])
    print("  ok  the repository, the held-out suite, the home directory and the owner's environment are closed")


# The Claude Code probe runs a small model: it only has to try to list a directory and report back.
CLAUDE_PROBE_MODEL = "claude-haiku-4-5-20251001"
CLAUDE_PROBE_TIMEOUT_S = 300


def claude_probe_verdict(events: list[dict], secret_name: str) -> tuple[bool, str]:
    """(passed, reason): the sandboxed session must complete (so it authenticated) and none of its
    tool results may show the held-out suite's files."""
    done = any(e.get("type") == "result" and not e.get("is_error") and e.get("subtype") == "success" for e in events)
    for e in events:
        if e.get("type") != "user":
            continue
        for c in (e.get("message") or {}).get("content") or []:
            text = c.get("content") if isinstance(c, dict) else None
            text = json.dumps(text) if not isinstance(text, str) else text
            if secret_name in (text or ""):
                return False, f"Claude Code in the sandbox can read the held-out suite ({secret_name} listed)"
    if not done:
        return False, "Claude Code did not complete a session in the sandbox (token missing or invalid?)"
    return True, "authenticated, and the held-out suite is invisible"


def claude_probe(env: dict) -> None:
    from clients import ClaudeClient
    view = sandbox.view_root(PROBE)
    client = ClaudeClient(PROBE, view=view)
    client.write_config("", CLAUDE_PROBE_MODEL, 0, 0)
    target = PACK / "acceptance" / "tests"
    prompt = f"Use the Bash tool to run exactly: ls {target}  -- then reply with the command's output only."
    r = run_in_world(client.command(CLAUDE_PROBE_MODEL, prompt), {**env, **client.env()}, client.secrets(),
                     timeout=CLAUDE_PROBE_TIMEOUT_S)
    events = []
    for line in r.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    ok, why = claude_probe_verdict(events, "story-01.spec.ts")
    if not ok:
        raise SystemExit(f"PREFLIGHT FAILED (claude): {why}\n{r.stderr[-800:]}")
    print(f"  ok  claude code: {why}")


def main() -> None:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--client", default="pi")
    a = ap.parse_args()
    from clients import CLIENTS
    shutil.rmtree(PROBE, ignore_errors=True)
    ws = PROBE / "workspace"
    ws.mkdir(parents=True)
    (ws / "package.json").write_text(json.dumps(PACKAGE, indent=2))
    for name, body in FILES.items():
        (ws / name).write_text(body)
    drive.WORLD = sandbox.world_for(PROBE.name, None, CLIENTS[a.client].presets, None)
    env = agent_env(PROBE)
    try:
        workload(env)
        isolation(env)
        if a.client == "claude":
            claude_probe(env)
    finally:
        shutil.rmtree(PROBE, ignore_errors=True)
    print("preflight passed")


if __name__ == "__main__":
    sys.exit(main())
