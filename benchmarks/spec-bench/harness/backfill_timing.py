"""backfill_timing.py [--recompute] <run-dir>... — give a run's stories that have no model time (servers other than llama.cpp,
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


def backfill(run: Path, recompute: bool = False) -> list[str]:
    """Fill stories with no model time. With recompute, also redo stories filled before (marked "backfilled") and
    any whose parts added up to more than its wall time (other_s < 0), with the current calculation."""
    path = run / "metrics.json"
    metrics = json.loads(path.read_text())
    filled = []
    for sid, rec in sorted(metrics.get("stories", {}).items(), key=lambda kv: int(kv[0])):
        ts = rec.get("time_split")
        raw = run / "stories" / sid.zfill(2) / "agent-events.jsonl"
        wanted = ts and (ts.get("model") is None or (recompute and (ts.get("backfilled") or ts.get("other_s", 0) < 0)))
        if not wanted or not raw.is_file() or "started" not in rec or "agent_finished" not in rec:
            continue
        new = drive.time_split(raw, run / "server.log", rec["started"], rec["agent_finished"])
        if new.get("model") is None:
            continue
        rec["time_split"] = {**new, "backfilled": True}
        filled.append(sid)
    if filled:
        path.write_text(json.dumps(metrics, indent=2))  # as drive.save_metrics writes it
    return filled


if __name__ == "__main__":
    recompute = "--recompute" in sys.argv
    for arg in (a for a in sys.argv[1:] if a != "--recompute"):
        print(f"{arg}: {', '.join(backfill(Path(arg).resolve(), recompute)) or 'nothing to fill'}")
