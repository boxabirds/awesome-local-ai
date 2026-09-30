"""What a held-out scoring ran on: Node and npm, the suite's Playwright and the Chromium it launches, the OS,
and the number of held-out workers. gates.accept records it with every result (live and re-score alike), and
rescore.py adds the install command and puts it in rescore.json.

Why: on 30 Sep 2026 a re-score ran under a Node too old for Playwright and recorded 0/0, and nothing in the
record said which Node it had. Live scores and re-scores run on different machines, with different tools; when
the two disagree, this is where the difference shows. Never raises: anything it can't find is None.
"""
from __future__ import annotations

import json
import platform
import subprocess
from pathlib import Path

import identity

FIELDS = ("node", "npm", "playwright", "chromium", "os", "arch", "workers")
VERSION_TIMEOUT_S = 30          # npm can take a few seconds to start on a loaded machine
# The suite's own packages, in the order they are asked: the test package pins the runner it brings.
PLAYWRIGHT_PACKAGES = ("@playwright/test", "playwright")
# Playwright's list of the browser builds it downloads and launches, one per browser name.
BROWSERS_FILE = Path("node_modules") / "playwright-core" / "browsers.json"
CHROMIUM = "chromium"


def tool_version(cmd: list[str], run=subprocess.run) -> str | None:
    try:
        r = run(cmd, capture_output=True, text=True, timeout=VERSION_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return None
    out = (r.stdout or "").strip()
    return out.splitlines()[0] if r.returncode == 0 and out else None


def _json(path: Path) -> dict:
    try:
        doc = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    return doc if isinstance(doc, dict) else {}


def playwright_version(acceptance: Path | None) -> str | None:
    if acceptance is None:
        return None
    for pkg in PLAYWRIGHT_PACKAGES:
        if v := _json(acceptance / "node_modules" / pkg / "package.json").get("version"):
            return v
    return None


def chromium_version(acceptance: Path | None) -> str | None:
    """The Chromium build the suite's Playwright launches: "<version> (r<revision>)"."""
    if acceptance is None:
        return None
    for b in _json(acceptance / BROWSERS_FILE).get("browsers") or []:
        if isinstance(b, dict) and b.get("name") == CHROMIUM and b.get("browserVersion"):
            return f"{b['browserVersion']} (r{b.get('revision')})"
    return None


def environment(acceptance: Path | None, workers: int | None, run=subprocess.run) -> dict:
    return {"node": tool_version(["node", "--version"], run), "npm": tool_version(["npm", "--version"], run),
            "playwright": playwright_version(acceptance), "chromium": chromium_version(acceptance),
            "os": identity.os_desc(), "arch": platform.machine(), "workers": workers}
