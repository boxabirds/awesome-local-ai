# /// script
# requires-python = ">=3.11"
# ///
"""Post-story checks on a workspace: the agent's own gate, then the held-out suite.

Usable standalone, e.g. to re-score a finished run after an acceptance-suite fix:

    uv run gates.py accept <workspace> --done 1,2,3 --out <dir>
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
ACCEPTANCE = HARNESS.parent / "acceptance"
STEP_TIMEOUT_S = 20 * 60
ACCEPT_TIMEOUT_S = 60 * 60
OUTPUT_TAIL_CHARS = 4000

# Scripts the spec (story 1 tasks.md) tells the agent to define, run in this order.
GATE_STEPS = ["build", "typecheck", "test:unit", "test:component", "test:integration", "test:e2e"]

VITEST_RE = re.compile(r"Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(?:(\d+)\s+passed)?", re.I)
PW_PASSED_RE = re.compile(r"(\d+)\s+passed", re.I)
PW_FAILED_RE = re.compile(r"(\d+)\s+failed", re.I)


def _run(cmd: list[str], cwd: Path, timeout: int, env: dict | None = None) -> dict:
    t0 = time.monotonic()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout,
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


def gate(ws: Path) -> dict:
    """Run the agent's own scripts. Never modifies source files."""
    result: dict = {"steps": {}}
    pkg = ws / "package.json"
    if not pkg.exists():
        result["error"] = "no package.json"
        return result
    scripts = json.loads(pkg.read_text()).get("scripts", {})
    result["steps"]["install"] = install(ws)
    for step in GATE_STEPS:
        if step not in scripts:
            result["steps"][step] = {"exit": "missing"}
            continue
        cmd = ["npm", "run", step]
        if step == "test:e2e":
            # Chromium only: the harness does not install every browser.
            cmd += ["--", "--project=chromium"]
        r = _run(cmd, ws, STEP_TIMEOUT_S)
        if step == "test:e2e" and r["exit"] != 0 and "project" in r["tail"].lower():
            r = _run(["npm", "run", step], ws, STEP_TIMEOUT_S)
        r.update(_counts(r["tail"]))
        result["steps"][step] = r
    result["all_green"] = all(s.get("exit") in (0, "missing") for s in result["steps"].values())
    return result


def _walk(suite: dict):
    for spec in suite.get("specs", []):
        for t in spec.get("tests", []):
            res = t["results"][-1] if t.get("results") else {}
            yield {"file": suite.get("file") or spec.get("file"), "title": spec["title"],
                   "status": res.get("status", "none"),
                   "error": (res.get("error") or {}).get("message", "")[:500]}
    for child in suite.get("suites", []):
        yield from _walk(child)


def accept(ws: Path, done: list[int], out: Path) -> dict:
    """Build the workspace and run the held-out suite for every implemented story."""
    out.mkdir(parents=True, exist_ok=True)
    build = _run(["npm", "run", "build"], ws, STEP_TIMEOUT_S)
    report = out / "accept-report.json"
    report.unlink(missing_ok=True)
    env = {"WORKSPACE": str(ws), "DONE_STORIES": ",".join(map(str, done)),
           "ACCEPT_JSON": str(report), "ACCEPT_ARTIFACTS": str(out / "artifacts"),
           "SHOT_DIR": str(out / "screenshots")}
    files = [f"tests/story-{s:02d}.spec.ts" for s in done if (ACCEPTANCE / f"tests/story-{s:02d}.spec.ts").exists()]
    run = _run(["npx", "playwright", "test", *files], ACCEPTANCE, ACCEPT_TIMEOUT_S, env)
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
    return {
        "build_exit": build["exit"],
        "runner_exit": run["exit"],
        "runner_tail": run["tail"][-1500:] if not tests else "",
        "passed": sum(t["status"] == "passed" for t in applicable),
        "total": len(applicable),
        "by_story": by_story,
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
        res = accept(ws, [int(x) for x in a.done.split(",") if x], a.out)
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / f"{a.what}.json").write_text(json.dumps(res, indent=2))
    print(json.dumps({k: v for k, v in res.items() if k not in ("tests", "steps")}, indent=2))


if __name__ == "__main__":
    main()
