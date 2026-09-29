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
import signal
import subprocess
import sys
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


BUN_LOCKFILES = ("bun.lock", "bun.lockb")


def package_manager(ws: Path) -> str:
    """The workspace's own package manager: bun for a bun workspace (a bun lockfile, or
    "packageManager": "bun@..."), else npm. npm can't install bun's `workspace:` dependencies."""
    if any((ws / f).exists() for f in BUN_LOCKFILES):
        return "bun"
    try:
        declared = json.loads((ws / "package.json").read_text()).get("packageManager") or ""
    except (OSError, json.JSONDecodeError, AttributeError):
        declared = ""
    return "bun" if declared.startswith("bun@") else "npm"


def install(ws: Path) -> dict:
    if package_manager(ws) == "bun":
        return _run(["bun", "install"], ws, STEP_TIMEOUT_S)
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
    pm = package_manager(ws)
    for step in steps or GATE_STEPS:
        if step not in scripts:
            result["steps"][step] = {"exit": "missing"}
            continue
        cmd = [pm, "run", step]
        if step == "test:e2e":
            # Chromium only: the harness does not install every browser. (npm needs "--" to pass
            # arguments through to the script; bun passes them as they are.)
            cmd += ["--project=chromium"] if pm == "bun" else ["--", "--project=chromium"]
        r = _run(cmd, ws, STEP_TIMEOUT_S, env)
        if step == "test:e2e" and r["exit"] != 0 and NO_SUCH_PROJECT.search(r["tail"]):
            # The agent's config has no "chromium" project: run its own projects instead.
            cmd = [pm, "run", step]
            r = _run(cmd, ws, STEP_TIMEOUT_S, env)
        if step == "test:e2e" and missing_chromium(r["tail"]):
            # Install the browser the agent's Playwright wants, once, and rerun. Still missing means
            # this machine can't run the tests at all: stop, don't score (or retry) against nothing.
            fetch = _run(["npx", "playwright", "install", "chromium"], ws, STEP_TIMEOUT_S, env)
            result["steps"]["browser_install"] = fetch
            r = _run(cmd, ws, STEP_TIMEOUT_S, env) if fetch["exit"] == 0 else r
            if missing_chromium(r["tail"]):
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


SETUP_FALLBACK = "setup-fallback"
FALLBACK_OWNER = re.compile(r"story (\d+)")


def _setup_fallbacks(test: dict, result: dict) -> list[str]:
    """Setup steps that fell back to their documented flow (EVALUATION-POLICY rule 8), once each."""
    out: list[str] = []
    for a in [*(test.get("annotations") or []), *(result.get("annotations") or [])]:
        if a.get("type") == SETUP_FALLBACK and a.get("description") not in out:
            out.append(a.get("description"))
    return out


def _fallback_summary(tests: list[dict]) -> dict:
    """Tests that needed a setup fallback, and how many per story that owns the fallen-back behaviour."""
    by_owner: dict[str, int] = {}
    used = [t for t in tests if t.get("setup_fallbacks")]
    for t in used:
        for owner in {m.group(1) for d in t["setup_fallbacks"] if (m := FALLBACK_OWNER.search(d or ""))}:
            by_owner[owner] = by_owner.get(owner, 0) + 1
    return {"tests": len(used), "by_owner": by_owner}


def _walk(suite: dict):
    for spec in suite.get("specs", []):
        for t in spec.get("tests", []):
            res = t["results"][-1] if t.get("results") else {}
            yield {"file": suite.get("file") or spec.get("file"), "title": spec["title"], "line": spec.get("line"),
                   "status": res.get("status", "none"),
                   "error": (res.get("error") or {}).get("message", "")[:500],
                   "on_partial": _on_partial(t, res), "setup_fallbacks": _setup_fallbacks(t, res)}
    for child in suite.get("suites", []):
        yield from _walk(child)


# Every harness fault starts with this: the machine lacks something, and no run on it can score.
MISSING_RESOURCES = "missing resources:"
# The suite runner was stopped from outside (a signal, or the harness's own timeout) before it wrote
# a report: the score would be 0 of 0, which says nothing about the app.
SCORING_INTERRUPTED = "scoring interrupted:"
ACCEPT_ATTEMPTS = 2
# Output that means there is no browser to test with, whatever the app does.
BROWSER_MISSING_SIGNS = (
    "Executable doesn't exist",               # Playwright, launching a browser it has not downloaded
    "browser not installed",                  # a playwright.config that skips browsers it can't find
    "Host system is missing dependencies",    # downloaded, but the OS lacks its libraries
)


# Playwright's error when --project names a project the config doesn't have.
NO_SUCH_PROJECT = re.compile(r'Project\(s\) .* not found')
# The harness installs and promises Chromium only; another missing browser is the agent's configuration.
CHROMIUM = re.compile(r"chrom", re.IGNORECASE)
BROWSER_NAMES = re.compile(r"chrom|firefox|webkit", re.IGNORECASE)


def missing_chromium(output: str) -> str | None:
    """The sign that a run had no Chromium, the one browser this machine must provide; else None.
    Chromium counts as missing when a line reporting the missing browser names it, or names no
    browser and Chromium appears in the output."""
    sig = missing_browser(output)
    if not sig:
        return None
    lines = [line for line in output.splitlines() if sig in line]
    if any(CHROMIUM.search(line) for line in lines):
        return sig
    if not any(BROWSER_NAMES.search(line) for line in lines) and CHROMIUM.search(output):
        return sig
    return None


def missing_browser(output: str) -> str | None:
    """The sign, in a test run's output, that it had no browser; None if it had one."""
    return next((sig for sig in BROWSER_MISSING_SIGNS if sig in (output or "")), None)


def interrupted(run: dict, report: Path) -> str | None:
    """Why the suite runner produced no score, if something outside the app stopped it."""
    if report.exists():
        return None
    code = run["exit"]
    if code == "timeout":
        return f"{SCORING_INTERRUPTED} the held-out suite timed out after {ACCEPT_TIMEOUT_S}s before writing a report"
    if isinstance(code, int) and code < 0:
        return f"{SCORING_INTERRUPTED} the held-out suite was killed by signal {-code} before writing a report"
    return None


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


# ---------- app server lifetime ----------
# The held-out suite starts its app servers detached (each in its own process group, so a restart test
# can stop one) and stops them in Playwright's global teardown, which does not run if the scoring is
# killed, crashes or times out. So the scoring owns them: each server records "<pgid> <port>" in
# SERVERS_FILE in the scoring's artifacts, and the scoring kills those groups however it ends. A hard
# kill (kill -9) runs no clean-up at all, so the next scoring also takes its ports back from its own
# kind of leftover before starting.
SERVERS_FILE = "servers.pids"
DEFAULT_ACCEPT_PORT = 18787
PORTS_PER_SLOT = 2
STOP_GRACE_S = 3
SCORING_PROCESS = re.compile(r"wrangler|workerd|playwright")


def recorded_server_groups(artifacts: Path) -> set[int]:
    try:
        lines = (artifacts / SERVERS_FILE).read_text().splitlines()
    except OSError:
        return set()
    return {int(l.split()[0]) for l in lines if l.split() and l.split()[0].isdigit()}


def kill_groups(groups) -> None:
    groups = set(groups)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for g in groups:
            try:
                os.killpg(g, sig)
            except (ProcessLookupError, PermissionError):
                pass
        if sig == signal.SIGTERM and groups:
            time.sleep(STOP_GRACE_S)


def is_scoring_process(cmd: str) -> bool:
    """An app server or test runner of ours, the only kind of process a scoring may take a port from."""
    return bool(SCORING_PROCESS.search(cmd))


def scoring_ports() -> list[int]:
    base = int(os.environ.get("ACCEPT_PORT", DEFAULT_ACCEPT_PORT))
    workers = max(1, int(os.environ.get("ACCEPT_WORKERS", 1)))
    return [base + PORTS_PER_SLOT * slot + k for slot in range(workers) for k in (0, 1)]


def reclaim_ports(ports: list[int]) -> list[str]:
    """Kill our own leftovers (app servers, test runners) holding these ports; report anything else."""
    notes = []
    for port in ports:
        pids = subprocess.run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
                              capture_output=True, text=True).stdout.split()
        for pid in pids:
            cmd = subprocess.run(["ps", "-o", "command=", "-p", pid], capture_output=True, text=True).stdout.strip()
            if is_scoring_process(cmd):
                try:
                    kill_groups({os.getpgid(int(pid))})
                    notes.append(f"reclaimed port {port} from a leftover {cmd.split()[0].rsplit('/', 1)[-1]} (pid {pid})")
                except ProcessLookupError:
                    pass
            else:
                notes.append(f"port {port} is held by something else (pid {pid}: {cmd[:80]}); left alone")
    return notes


def _run_owned(cmd: list[str], cwd: Path, timeout: int, env: dict | None = None) -> dict:
    """_run, in a process group of its own that is killed afterwards however the command ended, so the
    browsers and anything else it started go with it."""
    t0 = time.monotonic()
    p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                         errors="replace", env={**os.environ, "CI": "1", **(env or {})}, start_new_session=True)
    try:
        out, _ = p.communicate(timeout=timeout)
        code = p.returncode
    except subprocess.TimeoutExpired:
        code, out = "timeout", ""
    finally:
        kill_groups({p.pid})
    return {"cmd": " ".join(cmd), "exit": code, "seconds": round(time.monotonic() - t0, 1),
            "tail": (out or "")[-OUTPUT_TAIL_CHARS:]}


def accept(ws: Path, processed: list, out: Path, acceptance: Path | None = ACCEPTANCE, build: bool = True,
           only: list[tuple[str, int]] | None = None) -> dict:
    """Build the workspace and run the held-out suite for every processed story.

    processed: the queue of processed stories ({"id", "status": DONE|PARTIAL}), or plain ids (all DONE).
    acceptance: the pack's suite; None for a pack without one, which is reported skipped ("n/a"),
    not as 0 of 0 passed. build=False skips the app build (already built for an earlier scoring of the
    same code); only=[(file, line)] runs just those tests (a repeat scoring of the ones that failed)."""
    out.mkdir(parents=True, exist_ok=True)
    if acceptance is None:
        return {"skipped": True, "build_exit": None, "runner_exit": None, "runner_tail": "", "passed": 0,
                "total": 0, "on_partial": {"passed": 0, "total": 0}, "by_story": {}, "harness_fault": None,
                "tests": []}
    build = (_run(["npm", "run", "build"], ws, STEP_TIMEOUT_S) if build
             else {"cmd": "", "exit": 0, "seconds": 0, "tail": "skipped: already built"})
    report = out / "accept-report.json"
    report.unlink(missing_ok=True)
    done = [p["id"] if isinstance(p, dict) else p for p in processed]
    env = {"WORKSPACE": str(ws), "PROCESSED_STORIES": processed_env(processed),
           "ACCEPT_JSON": str(report), "ACCEPT_ARTIFACTS": str(out / "artifacts"),
           "SHOT_DIR": str(out / "screenshots")}
    files = [f"tests/story-{s:02d}.spec.ts" for s in done if (acceptance / f"tests/story-{s:02d}.spec.ts").exists()]
    if only is not None:
        files = [f"tests/{f}:{line}" for f, line in only]
    for note in reclaim_ports(scoring_ports()):
        print(f"  {note}", file=sys.stderr, flush=True)
    try:
        for _ in range(ACCEPT_ATTEMPTS):
            run = _run_owned(["npx", "playwright", "test", *files], acceptance, ACCEPT_TIMEOUT_S, env)
            stopped = interrupted(run, report) if files else None
            if not stopped:
                break
            print(f"  {stopped}", file=sys.stderr, flush=True)
    finally:
        kill_groups(recorded_server_groups(out / "artifacts"))
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
        "setup_fallbacks": _fallback_summary(applicable),
        "harness_fault": stopped or harness_fault(tests, run["tail"]),
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
