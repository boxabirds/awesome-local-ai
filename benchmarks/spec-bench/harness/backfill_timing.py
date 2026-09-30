"""backfill_timing.py [--recompute] <run-dir>... — give a run's stories their conversation profile where missing
(conversation.py), and give its stories that have no model time (servers other than llama.cpp,
before the harness timed them from the agent's stream) their prefill and decode time, from the full event log the
machine kept (stories/NN/agent-events.jsonl), computed exactly as a live run computes it (drive.time_split). Only
stories whose model time is missing are changed, and each is marked "backfilled". Prints the stories it filled.
Run it where the run's full logs are (the machine that ran it), on a finished run only.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import accounting
import drive


def backfill(run: Path, recompute: bool = False) -> list[str]:
    """Fill stories with no model time (or no time split at all). With recompute, also redo stories filled before (marked "backfilled"), any
    whose parts added up to more than its wall time (other_s < 0), and any made by an older accounting version."""
    path = run / "metrics.json"
    metrics = json.loads(path.read_text())
    filled = []
    for sid, rec in sorted(metrics.get("stories", {}).items(), key=lambda kv: int(kv[0])):
        ts = rec.get("time_split")
        raw = run / "stories" / sid.zfill(2) / "agent-events.jsonl"
        stale = (ts or {}).get("accounting", {}).get("version", 0) < accounting.VERSION
        wanted = not ts or (ts.get("model") is None or (recompute and (ts.get("backfilled") or ts.get("other_s", 0) < 0 or stale)))
        if not wanted or not raw.is_file() or "started" not in rec or "agent_finished" not in rec:
            continue
        new = drive.time_split(raw, run / "server.log", rec["started"], rec["agent_finished"])
        if new.get("model") is None:
            continue
        clock = accounting.check(new, agent_seconds=(rec.get("agent") or {}).get("seconds"))
        new["accounting"]["problems"] += [p for p in clock if p not in new["accounting"]["problems"]]
        new["accounting"]["ok"] = not new["accounting"]["problems"]
        rec["time_split"] = {**new, "backfilled": True}
        filled.append(sid)
    if filled:
        path.write_text(json.dumps(metrics, indent=2))  # as drive.save_metrics writes it
    return filled


def backfill_conversation(run: Path) -> list[str]:
    """Give each story that has none its conversation profile, from the full event log the machine kept."""
    import conversation
    path = run / "metrics.json"
    metrics = json.loads(path.read_text())
    filled = []
    for sid, rec in sorted(metrics.get("stories", {}).items(), key=lambda kv: int(kv[0])):
        raw = run / "stories" / sid.zfill(2) / "agent-events.jsonl"
        if rec.get("conversation") or not raw.is_file() or "started" not in rec or "agent_finished" not in rec:
            continue
        if (p := conversation.profile(raw, rec["started"], rec["agent_finished"])) is not None:
            rec["conversation"] = p
            filled.append(sid)
    if filled:
        path.write_text(json.dumps(metrics, indent=2))
    return filled


if __name__ == "__main__":
    recompute = "--recompute" in sys.argv
    for arg in (a for a in sys.argv[1:] if a != "--recompute"):
        print(f"{arg}: {', '.join(backfill(Path(arg).resolve(), recompute)) or 'nothing to fill'}")
        print(f"{arg} conversation: {', '.join(backfill_conversation(Path(arg).resolve())) or 'nothing to fill'}")
