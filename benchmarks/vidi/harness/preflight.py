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
import subprocess
import sys
import time
import urllib.request

from drive import PACK, REPO_ROOT, WORK_ROOT, agent_env, sandboxed

PORT = 18899
STEP_TIMEOUT_S = 300
SERVER_READY_S = 60
PROBE = WORK_ROOT / "_preflight"

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
                   f"await p.goto('http://127.0.0.1:{PORT}/');"
                   "console.log(await p.textContent('#ok')); await b.close();"),
}


def step(name: str, cmd: list[str], env: dict, ws) -> None:
    r = subprocess.run(sandboxed(cmd, own_dir=PROBE), cwd=ws, env=env, capture_output=True, text=True,
                       timeout=STEP_TIMEOUT_S)
    if r.returncode != 0:
        raise SystemExit(f"PREFLIGHT FAILED at {name}: exit {r.returncode}\n{(r.stdout + r.stderr)[-1500:]}")
    print(f"  ok  {name}")


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
    client = ClaudeClient(PROBE)
    client.write_config("", CLAUDE_PROBE_MODEL, 0, 0)
    target = PACK / "acceptance" / "tests"
    prompt = f"Use the Bash tool to run exactly: ls {target}  -- then reply with the command's output only."
    full = {**env, **client.env()}
    for k in client.env_remove:
        full.pop(k, None)
    r = subprocess.run(sandboxed(client.command(CLAUDE_PROBE_MODEL, prompt), own_dir=PROBE), cwd=PROBE / "workspace",
                       env=full, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=CLAUDE_PROBE_TIMEOUT_S)
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
    shutil.rmtree(PROBE, ignore_errors=True)
    ws = PROBE / "workspace"
    ws.mkdir(parents=True)
    (ws / "package.json").write_text(json.dumps(PACKAGE, indent=2))
    for name, body in FILES.items():
        (ws / name).write_text(body)
    env = {**os.environ, **agent_env(PROBE)}
    server = None
    try:
        step("npm install", ["npm", "install", "--no-audit", "--no-fund"], env, ws)
        step("vite build", ["npm", "run", "build"], env, ws)
        log = (PROBE / "wrangler.log").open("w")
        server = subprocess.Popen(sandboxed(["npx", "wrangler", "dev", "--port", str(PORT), "--ip", "127.0.0.1"],
                                            own_dir=PROBE), cwd=ws, env=env, stdout=log, stderr=subprocess.STDOUT)
        deadline = time.time() + SERVER_READY_S
        while True:
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORT}/", timeout=2)
                break
            except OSError:
                if time.time() > deadline or server.poll() is not None:
                    raise SystemExit("PREFLIGHT FAILED at wrangler dev:\n" + (PROBE / "wrangler.log").read_text()[-1500:])
                time.sleep(1)
        print("  ok  wrangler dev serves over HTTP")
        step("playwright browsers", ["npx", "playwright", "install", "chromium"], env, ws)
        step("chromium loads the page", ["node", "browse.mjs"], env, ws)
        leak = subprocess.run(sandboxed(["ls", str(PACK / "acceptance")], own_dir=PROBE),
                              capture_output=True, text=True)
        if leak.returncode == 0:
            raise SystemExit("PREFLIGHT FAILED: the sandbox can read the held-out acceptance suite")
        print("  ok  held-out suite is hidden")
        if a.client == "claude":
            claude_probe(env)
    finally:
        subprocess.run(["pkill", "-f", str(ws)], capture_output=True)
        if server:
            server.terminate()
        shutil.rmtree(PROBE, ignore_errors=True)
    print("preflight passed")


if __name__ == "__main__":
    sys.exit(main())
