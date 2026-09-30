"""backfill_timing.py <run-dir>... — give a run's stories that have no model time (servers other than llama.cpp,
before the harness timed them from the agent's stream) their prefill and decode time, from the full event log the
machine kept (stories/NN/agent-events.jsonl), computed exactly as a live run computes it (drive.time_split). Only
stories whose model time is missing are changed, and each is marked "backfilled". Prints the stories it filled.
Run it where the run's full logs are (the machine that ran it), on a finished run only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import drive


def backfill(run: Path) -> list[str]:
    path = run / "metrics.json"
    metrics = json.loads(path.read_text())
    filled = []
    for sid, rec in sorted(metrics.get("stories", {}).items(), key=lambda kv: int(kv[0])):
        ts = rec.get("time_split")
        raw = run / "stories" / sid.zfill(2) / "agent-events.jsonl"
        if not ts or ts.get("model") is not None or not raw.is_file() or "started" not in rec or "agent_finished" not in rec:
            continue
        new = drive.time_split(raw, run / "server.log", rec["started"], rec["agent_finished"])
        if new.get("model") is None:
            continue
        rec["time_split"] = {**new, "backfilled": True}
        filled.append(sid)
    if filled:
        path.write_text(json.dumps(metrics, indent=2) + "\n")
    return filled


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print(f"{arg}: {', '.join(backfill(Path(arg).resolve())) or 'nothing to fill'}")
