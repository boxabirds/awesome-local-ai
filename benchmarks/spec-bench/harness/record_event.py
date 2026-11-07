"""record_event.py <run-dir> <started|finished|failed|stopped> [reason]

Record a run-level event in the run's folder, so the run says when it started, finished, failed or was stopped, not
only when a story finished: <run-dir>/run-status.json, and the run's records in their kept form
(drive.prepare_records). Nothing is committed or pushed: the collector takes the run folder to the lake through the
node's API (story 23, harness.no_publish). Never fails the caller: a problem is reported on stderr.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import drive
import hostenv

STATES = ("started", "finished", "failed", "stopped")
REASON_CHARS = 300


def record(run: Path, state: str, reason: str = "") -> dict:
    """Writes run-status.json and brings the run's records to their kept form. Returns the status written."""
    reason = " ".join(reason.split())[:REASON_CHARS]
    status = {"state": state, "reason": reason, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    host = hostenv.host_desc()          # the machine's hardware, as run.json names it; never its hostname
    if host:
        status["host"] = host
    (run / "run-status.json").write_text(json.dumps(status, indent=2) + "\n")
    try:
        drive.prepare_records(run)
    except Exception as e:           # never fails the caller: the event is recorded without it
        print(f"record_event: the records were not brought to their kept form: {type(e).__name__}: {e}", file=sys.stderr)
    return status


def main() -> None:
    if len(sys.argv) < 3 or sys.argv[2] not in STATES:
        sys.exit(__doc__)
    record(Path(sys.argv[1]).resolve(), sys.argv[2], " ".join(sys.argv[3:]))


if __name__ == "__main__":
    main()
