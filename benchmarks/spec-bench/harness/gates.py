# /// script
# requires-python = ">=3.11"
# ///
"""Post-story checks on a workspace: the agent's own gate, then the held-out suite.

Usable standalone, e.g. to re-score a finished run after an acceptance-suite fix:

    uv run gates.py accept <workspace> --done 1,2,3 --out <dir>
    uv run gates.py accept <workspace> --done 1:DONE,2:DONE,3:PARTIAL --out <dir>
    uv run gates.py gate   <workspace> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import time
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
import hostenv  # noqa: E402
import packdir  # noqa: E402
# The default pack's held-out suite (vidi); drive.py passes the running pack's.
ACCEPTANCE = packdir.resolve() / "acceptance"
STEP_TIMEOUT_S = 20 * 60
ACCEPT_TIMEOUT_S = 60 * 60
OUTPUT_TAIL_CHARS = 4000

# Scripts the spec (story 1 tasks.md) tells the agent to define, run in this order. A pack names its
# own in bench.json ("gate"); these are the default.
GATE_STEPS = ["build", "typecheck", "test:unit", "test:component", "test:integration", "test:e2e"]

VITEST_RE = re.compile(r"Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(?:(\d+)\s+passed)?", re.I)
PW_PASSED_RE = re.compile(r"(\d+)\s+passed", re.I)
PW_FAILED_RE = re.compile(r"(\d+)\s+failed", re.I)


def _run(cmd: list[str], cwd: Path, timeout: int, env: dict | None = None) -> dict:
    t0 = time.monotonic()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors="replace", timeout=timeout,
                           env={**os.environ, "CI": "1", **(env or {})})
        code, out = p.returncode, p.stdout + p.stderr
    except subprocess.TimeoutExpired as e:
        code = "timeout"
        out = (e.stdout or b"").decode(errors="replace") + (e.stderr or b"").decode(errors="replace")
    return {"cmd": " ".join(cmd), "exit": code, "seconds": round(time.monotonic() - t0, 1),
            "tail": out[-OUTPUT_TAIL_CHARS:]}


def _counts(output: str) -> dict:
    passed = failed = None
    m = VITEST_RE.search(output)
    if m and (m.group(1) or m.group(2)):
        failed, passed = int(m.group(1) or 0), int(m.group(2) or 0)
    else:
        mp, mf = PW_PASSED_RE.findall(output), PW_FAILED_RE.findall(output)
        if mp or mf:
            passed, failed = int(mp[-1]) if mp else 0, int(mf[-1]) if mf else 0
    return {"passed": passed, "failed": failed}


def install(ws: Path) -> dict:
    cmd = ["npm", "ci"] if (ws / "package-lock.json").exists() else ["npm", "install"]
    return _run(cmd, ws, STEP_TIMEOUT_S)


def gate(ws: Path, steps: list[str] | None = None) -> dict:
    """Run the agent's own scripts, the pack's gate steps in order. Never modifies source files."""
    result: dict = {"steps": {}}
    pkg = ws / "package.json"
    if not pkg.exists():
        result["error"] = "no package.json"
        return result
    scripts = json.loads(pkg.read_text()).get("scripts", {})
    result["steps"]["install"] = install(ws)
    # The agent's scripts run against the agent's browsers, which it installed with its own
    # Playwright; the default cache holds the held-out suite's build, a different version.
    env = {"PLAYWRIGHT_BROWSERS_PATH": str(hostenv.agent_playwright_cache(Path.home()))}
    for step in steps or GATE_STEPS:
        if step not in scripts:
            result["steps"][step] = {"exit": "missing"}
            continue
        cmd = ["npm", "run", step]
        if step == "test:e2e":
            # Chromium only: the harness does not install every browser.
            cmd += ["--", "--project=chromium"]
        r = _run(cmd, ws, STEP_TIMEOUT_S, env)
        if step == "test:e2e" and r["exit"] != 0 and "project" in r["tail"].lower():
            cmd = ["npm", "run", step]
            r = _run(cmd, ws, STEP_TIMEOUT_S, env)
        if step == "test:e2e" and missing_browser(r["tail"]):
            # Install the browser the agent's Playwright wants, once, and rerun. Still missing means
            # this machine can't run the tests at all: stop, don't score (or retry) against nothing.
            fetch = _run(["npx", "playwright", "install", "chromium"], ws, STEP_TIMEOUT_S, env)
            result["steps"]["browser_install"] = fetch
            r = _run(cmd, ws, STEP_TIMEOUT_S, env) if fetch["exit"] == 0 else r
            if missing_browser(r["tail"]):
                result["harness_fault"] = (f"{MISSING_RESOURCES} the agent's e2e tests have no browser "
                                           f"({missing_browser(r['tail'])}); `npx playwright install chromium` "
                                           f"in the workspace with PLAYWRIGHT_BROWSERS_PATH={env['PLAYWRIGHT_BROWSERS_PATH']} "
                                           f"{'did not fix it' if fetch['exit'] == 0 else 'failed: ' + fetch['tail'][-200:]}")
        r.update(_counts(r["tail"]))
        result["steps"][step] = r
    result["all_green"] = all(s.get("exit") in (0, "missing") for s in result["steps"].values())
    return result


def _on_partial(test: dict, result: dict) -> str | None:
    """The PARTIAL stories a test was built on (fixtures.ts `requires()` annotation), if any."""
    for a in [*(test.get("annotations") or []), *(result.get("annotations") or [])]:
        if a.get("type") == "on-partial":
            return a.get("description") or ""
    return None


def _walk(suite: dict):
    for spec in suite.get("specs", []):
        for t in spec.get("tests", []):
            res = t["results"][-1] if t.get("results") else {}
            yield {"file": suite.get("file") or spec.get("file"), "title": spec["title"],
                   "status": res.get("status", "none"),
                   "error": (res.get("error") or {}).get("message", "")[:500],
                   "on_partial": _on_partial(t, res)}
    for child in suite.get("suites", []):
        yield from _walk(child)


# Every harness fault starts with this: the machine lacks something, and no run on it can score.
MISSING_RESOURCES = "missing resources:"
# Output that means there is no browser to test with, whatever the app does.
BROWSER_MISSING_SIGNS = (
    "Executable doesn't exist",               # Playwright, launching a browser it has not downloaded
    "browser not installed",                  # a playwright.config that skips browsers it can't find
    "Host system is missing dependencies",    # downloaded, but the OS lacks its libraries
)


def missing_browser(output: str) -> str | None:
    """The sign, in a test run's output, that it had no browser; None if it had one."""
    return next((sig for sig in BROWSER_MISSING_SIGNS if sig in (output or "")), None)


def harness_fault(tests: list[dict], runner_tail: str = "") -> str | None:
    """Why this score says nothing about the app, if the tests failed for a reason of the machine's."""
    sig = next(filter(None, (missing_browser(t.get("error") or "") for t in tests)), None) \
        or missing_browser(runner_tail)
    if sig:
        return (f"{MISSING_RESOURCES} the held-out suite has no browser ({sig}); run "
                f"`npx playwright install chromium` in the acceptance suite")
    return None


def processed_env(processed: list) -> str:
    """PROCESSED_STORIES for the suite: "1:DONE,2:DONE,3:PARTIAL". Plain ids mean DONE."""
    return ",".join(f"{p['id']}:{p['status']}" if isinstance(p, dict) else f"{p}:DONE" for p in processed)


def parse_processed(arg: str) -> list[dict]:
    """--done "1,2,3" or "1:DONE,3:PARTIAL" into the processed queue."""
    out = []
    for e in filter(None, arg.split(",")):
        sid, _, status = e.partition(":")
        out.append({"id": int(sid), "status": status or "DONE"})
    return out


def accept(ws: Path, processed: list, out: Path, acceptance: Path | None = ACCEPTANCE) -> dict:
    """Build the workspace and run the held-out suite for every processed story.

    processed: the queue of processed stories ({"id", "status": DONE|PARTIAL}), or plain ids (all DONE).
    acceptance: the pack's suite; None for a pack without one, which is reported skipped ("n/a"),
    not as 0 of 0 passed."""
    out.mkdir(parents=True, exist_ok=True)
    if acceptance is None:
        return {"skipped": True, "build_exit": None, "runner_exit": None, "runner_tail": "", "passed": 0,
                "total": 0, "on_partial": {"passed": 0, "total": 0}, "by_story": {}, "harness_fault": None,
                "tests": []}
    build = _run(["npm", "run", "build"], ws, STEP_TIMEOUT_S)
    report = out / "accept-report.json"
    report.unlink(missing_ok=True)
    done = [p["id"] if isinstance(p, dict) else p for p in processed]
    env = {"WORKSPACE": str(ws), "PROCESSED_STORIES": processed_env(processed),
           "ACCEPT_JSON": str(report), "ACCEPT_ARTIFACTS": str(out / "artifacts"),
           "SHOT_DIR": str(out / "screenshots")}
    files = [f"tests/story-{s:02d}.spec.ts" for s in done if (acceptance / f"tests/story-{s:02d}.spec.ts").exists()]
    run = _run(["npx", "playwright", "test", *files], acceptance, ACCEPT_TIMEOUT_S, env)
    tests = []
    if report.exists():
        doc = json.loads(report.read_text())
        for s in doc.get("suites", []):
            tests.extend(_walk(s))
    applicable = [t for t in tests if t["status"] != "skipped"]
    by_story: dict[str, dict] = {}
    for t in applicable:
        sid = re.search(r"story-(\d+)", t["file"] or "")
        key = sid.group(1) if sid else "?"
        agg = by_story.setdefault(key, {"passed": 0, "total": 0})
        agg["total"] += 1
        agg["passed"] += t["status"] == "passed"
        if t.get("on_partial") is not None:
            agg["on_partial_total"] = agg.get("on_partial_total", 0) + 1
            agg["on_partial_passed"] = agg.get("on_partial_passed", 0) + (t["status"] == "passed")
    return {
        "skipped": False,
        "build_exit": build["exit"],
        "runner_exit": run["exit"],
        "runner_tail": run["tail"][-1500:] if not tests else "",
        "passed": sum(t["status"] == "passed" for t in applicable),
        "total": len(applicable),
        "on_partial": {"passed": sum(t["status"] == "passed" for t in applicable if t.get("on_partial") is not None),
                       "total": sum(t.get("on_partial") is not None for t in applicable)},
        "by_story": by_story,
        "harness_fault": harness_fault(tests, run["tail"]),
        "tests": tests,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("what", choices=["gate", "accept"])
    ap.add_argument("workspace", type=Path)
    ap.add_argument("--done", default="")
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    ws = a.workspace.resolve()
    if a.what == "gate":
        res = gate(ws)
    else:
        res = accept(ws, parse_processed(a.done), a.out)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / f"{a.what}.json").write_text(json.dumps(res, indent=2))
    print(json.dumps({k: v for k, v in res.items() if k not in ("tests", "steps")}, indent=2))


if __name__ == "__main__":
    main()
