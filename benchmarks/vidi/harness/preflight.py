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


def main() -> None:
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
    finally:
        subprocess.run(["pkill", "-f", str(ws)], capture_output=True)
        if server:
            server.terminate()
        shutil.rmtree(PROBE, ignore_errors=True)
    print("preflight passed")


if __name__ == "__main__":
    sys.exit(main())
