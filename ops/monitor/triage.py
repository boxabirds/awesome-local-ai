#!/usr/bin/env python3
"""The monitor's judging half: hands the detector's new log lines to Claude, which buckets them and writes the
entries in ops/anomaly-tracking.md. It records and proposes; it never fixes code.

    python3 ops/monitor/triage.py            # triage what is new, commit the file by path, push
    python3 ops/monitor/triage.py --no-push  # the same, without committing or pushing

Claude runs headless (`claude -p`) and may only read, run a short list of read-only commands, and edit the one file.
This script, not Claude, checks privacy, commits ops/anomaly-tracking.md by path and pushes it
(drive.push_with_rebase). How the run ended is written to ops/monitor-state/triage.json, which the detector turns
into ops/monitor-status.json: a run that ended because usage credits or a usage or rate limit ran out is recorded
as `usage_limit`, anything else that failed as `failed` with its exit code and message.
"""
from __future__ import annotations

import fcntl
import json
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OPS = REPO / "ops"
LOG = OPS / "monitor-log.jsonl"
STATE_DIR = OPS / "monitor-state"
TRIAGE_STATE = STATE_DIR / "triage.json"
PENDING = STATE_DIR / "pending.jsonl"
LAST_OUTPUT = STATE_DIR / "triage-last-output.txt"
LOCK = STATE_DIR / "triage.lock"
TRACKING = "ops/anomaly-tracking.md"
PROMPT = HERE / "triage-prompt.md"
CLAUDE_TIMEOUT_S = 1500
MAX_BUDGET_USD = "5"
MAX_PENDING = 150                         # more than this in one go: the oldest wait for the next run
MESSAGE_KEPT = 300

# What the Claude Code CLI says when credits or a limit stop it. The wording is the CLI's own (2.1.285: its
# messages and its own error classifier), matched loosely so a change of punctuation doesn't lose it.
USAGE_LIMIT = re.compile(
    r"usage limit reached|hit your (?:\w+ ){0,3}limit|out of extra usage|credit balance (?:is )?too low|"
    r"spend limit reached|billing_error|rate_limit_error|rate limit", re.I)

ALLOWED_TOOLS = ",".join([
    "Read", "Grep", "Glob", f"Edit({TRACKING})",
    "Bash(git fetch -q origin main)", "Bash(git show *)", "Bash(git log *)", "Bash(git diff *)",
    "Bash(dbench status*)", "Bash(dbench --json status*)", "Bash(dbench nodes*)", "Bash(dbench logs *)",
    "Bash(dbench events *)", "Bash(curl -s localhost:7760/api/*)", "Bash(curl -s 127.0.0.1:7760/api/*)",
    "Bash(date*)",
])


def classify(exit_code: int, stdout: str, stderr: str) -> tuple[str, str]:
    """(outcome, message) for one `claude -p --output-format json` run: ok, usage_limit or failed."""
    result, is_error = "", False
    try:
        obj = json.loads(stdout) if stdout.strip() else {}
        if isinstance(obj, list):                     # the CLI prints a list of events; the result is the last
            obj = next((e for e in reversed(obj) if isinstance(e, dict) and e.get("type") == "result"), {})
        if isinstance(obj, dict):
            result, is_error = str(obj.get("result") or ""), bool(obj.get("is_error"))
    except ValueError:
        result = stdout.strip()
    text = " ".join(x for x in (result, stderr.strip()) if x)
    if exit_code == 0 and not is_error:
        return "ok", result[:MESSAGE_KEPT]
    if USAGE_LIMIT.search(text) or USAGE_LIMIT.search(stdout):
        return "usage_limit", text[:MESSAGE_KEPT]
    return "failed", f"exit {exit_code}: {text}"[:MESSAGE_KEPT]


def pending(log: Path, triaged_through: int) -> list[dict]:
    if not log.exists():
        return []
    out = []
    for i, line in enumerate(log.read_text().splitlines()):
        if i >= triaged_through and line.strip():
            out.append(json.loads(line))
    return out


def save(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    TRIAGE_STATE.write_text(json.dumps(state, indent=1) + "\n")


def run(cmd: list[str], timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)


def commit_and_push() -> str:
    """Commit the tracking file by path if Claude changed it, after the privacy test; push without disturbing
    anyone's uncommitted work. Returns what happened."""
    if not run(["git", "status", "--porcelain", "--", TRACKING]).stdout.strip():
        return "no change to the file"
    privacy = run(["bash", "tests/privacy-test.sh"], 600)
    last = (privacy.stdout.strip().splitlines() or [""])[-1]
    if privacy.returncode != 0 or "checks passed" not in last:
        run(["git", "checkout", "--", TRACKING])
        return "privacy test failed; the edit was discarded: " + privacy.stdout[-300:]
    msgs = ["-m", "ops: anomaly tracking: unattended triage of the monitor's new detections",
            "-m", "Co-Authored-By: Claude <noreply@anthropic.com>"]
    c = run(["git", "commit", "-q", *msgs, "--", TRACKING])
    if c.returncode != 0:
        return "commit failed: " + (c.stderr or c.stdout)[-200:]
    push = subprocess.run(
        ["uv", "run", "-q", "python", "-c",
         "from pathlib import Path; import drive; print(drive.push_with_rebase(Path('../../..').resolve(), ['git']))"],
        cwd=REPO / "benchmarks/spec-bench/harness", capture_output=True, text=True, timeout=600, stdin=subprocess.DEVNULL)
    return "committed; push: " + (push.stdout.strip() or push.stderr.strip())[-200:]


def main(argv: list[str]) -> int:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    lock = LOCK.open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("another triage is running")
        return 0
    state = json.loads(TRIAGE_STATE.read_text()) if TRIAGE_STATE.exists() else {}
    through = int(state.get("triaged_through") or 0)
    todo = pending(LOG, through)
    now = time.time()
    if not todo:
        save({**state, "last_run": now, "outcome": "ok", "message": "nothing new", "triaged_through": through})
        print("nothing new")
        return 0
    batch = todo[:MAX_PENDING]
    PENDING.write_text("".join(json.dumps(d) + "\n" for d in batch))
    prompt = PROMPT.read_text().replace("{PENDING}", str(PENDING.relative_to(REPO))).replace("{COUNT}", str(len(batch)))
    cmd = ["claude", "-p", prompt, "--output-format", "json", "--allowedTools", ALLOWED_TOOLS,
           "--permission-mode", "dontAsk", "--max-budget-usd", MAX_BUDGET_USD, "--no-session-persistence"]
    try:
        r = run(cmd, CLAUDE_TIMEOUT_S)
        code, out, err = r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        code, out, err = 124, "", f"claude did not finish in {CLAUDE_TIMEOUT_S} s"
    except OSError as e:
        code, out, err = 127, "", str(e)
    LAST_OUTPUT.write_text(f"exit {code}\n--- stdout\n{out[-20000:]}\n--- stderr\n{err[-5000:]}\n")
    outcome, message = classify(code, out, err)
    new_state = {**state, "last_run": now, "outcome": outcome, "message": message, "exit_code": code,
                 "triaged_through": through}
    if outcome == "ok":
        new_state["triaged_through"] = through + len(batch)
        new_state["commit"] = "not committed (--no-push)" if "--no-push" in argv else commit_and_push()
    save(new_state)
    print(json.dumps(new_state, indent=1))
    return 0 if outcome == "ok" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
