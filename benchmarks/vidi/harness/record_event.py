"""record_event.py <run-dir> <started|finished|failed|stopped> [reason]

Commit and push a run-level event, so the run's commits say when it started, finished, failed or
was stopped, not only when a story finished. A machine watched only through its pushed commits
(the M2) otherwise fails silently: a run that refuses to start commits nothing.

Writes <run-dir>/run-status.json and records it with drive.record_story (only the run dir is
committed). Never fails the caller: a record that can't be pushed is reported on stderr.
"""
from __future__ import annotations

import json
import socket
import sys
import time
from pathlib import Path

import drive

STATES = ("started", "finished", "failed", "stopped")
REASON_CHARS = 300


def record(repo_root: Path, run: Path, state: str, reason: str = "") -> dict:
    reason = " ".join(reason.split())[:REASON_CHARS]
    status = {"state": state, "reason": reason, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
              "host": socket.gethostname()}
    (run / "run-status.json").write_text(json.dumps(status, indent=2) + "\n")
    message = f"vidi {drive.combination_label(run)} {run.name}: run {state}" + (f": {reason}" if reason else "")
    return drive.record_story(repo_root, run, message)


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[2] not in STATES:
        sys.exit(__doc__)
    run = Path(sys.argv[1]).resolve()
    res = record(drive.REPO_ROOT, run, sys.argv[2], " ".join(sys.argv[3:]))
    if not res.get("pushed"):
        print(f"record_event: {sys.argv[2]} not pushed: {res.get('error', '')}", file=sys.stderr)


if __name__ == "__main__":
    main()
