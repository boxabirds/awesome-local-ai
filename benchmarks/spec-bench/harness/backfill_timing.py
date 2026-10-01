"""backfill_timing.py [--recompute] <run-dir>... — bring a finished run's records up to what the harness records now.
Every step is idempotent and only fills or corrects; it prints what each changed. In order:

1. events: rebuild each story's published conversation log (stories/NN/agent-events.compact.jsonl.gz) from the
   full log the machine kept (stories/NN/agent-events.jsonl), lossless as drive.compact_events writes it now: logs
   from before 30 Sep 2026 cut long strings. Needs the full logs: run it on the machine that ran the run.
2. attempts: a story the harness restarted mid-way gets its totals over every attempt (attempts.recompute), from
   the full log, else from the published one (counts only when that one is an old, cut log).
   recount: a restarted story whose record already has its attempts, but with counts that differ from its log
   (a past bug counted 0 steps for earlier attempts), is recounted from the log and its time split redone.
3. timing: stories with no model time (servers other than llama.cpp, before the harness timed them from the agent's
   stream) get their prefill and decode time, exactly as a live run computes it (drive.story_time_split, over every
   attempt of a restarted story). Only stories whose model time is missing are changed, each marked "backfilled";
   --recompute also redoes those, any whose parts overran the wall, any made by an older accounting version
   (accounting.VERSION changes with the calculation: test_accounting.py holds it to that), and any whose stored
   accounting check failed. A record of version 3 that failed for a tool call cut off by a restart or the story's
   end, or for a machine that slept under Claude Code, passes once redone.
4. conversation: each story with no conversation profile gets one (conversation.py).
5. provenance: each story with none gets the harness commit and pack version it ran under (provenance.py), from
   run.sh's record of each start (run-history.jsonl, run.json).
"""
from __future__ import annotations

import sys
from pathlib import Path

import accounting
import attempts
import drive
import heldout
import provenance

RAW = "agent-events.jsonl"
COMPACT = "agent-events.compact.jsonl.gz"
DEFAULT_CLIENT = "pi"          # runs recorded before metrics named their client were all pi


def _raw(run: Path, sid: str) -> Path:
    return run / "stories" / sid.zfill(2) / RAW


def _stories(metrics: dict):
    return sorted((metrics.get("stories") or {}).items(), key=lambda kv: int(kv[0]))


def backfill_events(run: Path) -> list[str]:
    """Rebuild the lossless published log of every story whose full log is on this machine."""
    done = []
    for raw in sorted((run / "stories").glob(f"*/{RAW}")):
        drive.compact_events(raw)
        done.append(raw.parent.name)
    return done


def _sync_processed(metrics: dict, sid: str, agent: dict) -> None:
    """The processed-stories queue repeats a story's effort (progress.json, the gallery): keep it in step."""
    for p in metrics.get("processed") or []:
        if str(p.get("id")) == sid:
            p.update(agent_minutes=round(agent["seconds"] / 60, 1), calls=agent["steps"],
                     output_tokens=agent["tokens"].get("output", 0), compactions=agent["compactions"])


def backfill_attempts(run: Path) -> list[str]:
    """Count every attempt of each story the harness restarted mid-way. Returns the stories changed."""
    metrics = heldout.load_metrics(run)
    starts = attempts.run_starts(run)
    client = metrics.get("client") or DEFAULT_CLIENT
    changed = []
    for sid, rec in _stories(metrics):
        raw, compact = _raw(run, sid), _raw(run, sid).with_name(COMPACT)
        log = raw if raw.is_file() else compact
        new = attempts.recompute(rec, log, client, starts=starts, server_log=run / "server.log")
        if new is None:
            continue
        if "time_split" in new:
            new["time_split"]["backfilled"] = True
        rec.update(new)
        _sync_processed(metrics, sid, rec["agent"])
        changed.append(sid)
    if changed:
        heldout.save_metrics(run, metrics)
    return changed


def backfill_recount(run: Path) -> list[str]:
    """Recount each restarted story whose earlier attempts' counts differ from its log (attempts.recount), and redo
    its time split over the recounted attempts. Returns the stories changed."""
    metrics = heldout.load_metrics(run)
    starts = attempts.run_starts(run)
    client = metrics.get("client") or DEFAULT_CLIENT
    changed = []
    for sid, rec in _stories(metrics):
        raw, compact = _raw(run, sid), _raw(run, sid).with_name(COMPACT)
        log = raw if raw.is_file() else compact
        new = attempts.recount(rec, log, client, starts=starts)
        if new is None:
            continue
        rec["agent"] = new
        if raw.is_file():
            rec["time_split"] = {**drive.story_time_split(rec, raw, run / "server.log"), "backfilled": True}
        _sync_processed(metrics, sid, rec["agent"])
        changed.append(sid)
    if changed:
        heldout.save_metrics(run, metrics)
    return changed


def backfill(run: Path, recompute: bool = False) -> list[str]:
    """Fill stories with no model time (or no time split at all). With recompute, also redo stories filled before (marked "backfilled"), any
    whose parts added up to more than its wall time (other_s < 0), any made by an older accounting version, and any whose
    stored accounting check failed (made by a harness with a bug since fixed: mlx-serve v2-r2 story 4, 1 Oct 2026)."""
    metrics = heldout.load_metrics(run)
    filled = []
    for sid, rec in _stories(metrics):
        ts = rec.get("time_split")
        raw = _raw(run, sid)
        acc = (ts or {}).get("accounting", {})
        stale = acc.get("version", 0) < accounting.VERSION or acc.get("ok") is False
        wanted = not ts or (ts.get("model") is None or (recompute and (ts.get("backfilled") or ts.get("other_s", 0) < 0 or stale)))
        if not wanted or not raw.is_file() or "started" not in rec or "agent_finished" not in rec:
            continue
        seconds = (rec.get("agent") or {}).get("seconds")
        new = drive.story_time_split(rec, raw, run / "server.log")
        if new.get("model") is None:
            continue
        rec["time_split"] = {**new, "backfilled": True}
        rec.pop("time_split_covers", None)
        if (rec.get("agent") or {}).get("seconds") != seconds:   # an earlier attempt's seconds, corrected with its split
            _sync_processed(metrics, sid, rec["agent"])
        filled.append(sid)
    if filled:
        heldout.save_metrics(run, metrics)  # as drive.save_metrics writes it: public, with the detail beside it
    return filled


def backfill_conversation(run: Path) -> list[str]:
    """Give each story that has none its conversation profile, from the full event log the machine kept."""
    import conversation
    metrics = heldout.load_metrics(run)
    filled = []
    for sid, rec in _stories(metrics):
        raw = _raw(run, sid)
        if rec.get("conversation") or not raw.is_file() or "started" not in rec or "agent_finished" not in rec:
            continue
        if (p := conversation.profile(raw, rec.get("first_started", rec["started"]), rec["agent_finished"])) is not None:
            rec["conversation"] = p
            filled.append(sid)
    if filled:
        heldout.save_metrics(run, metrics)
    return filled


def backfill_provenance(run: Path) -> list[str]:
    return provenance.backfill(run)


def backfill_all(run: Path, recompute: bool = False) -> dict[str, list[str]]:
    """Every step, in the order each needs the one before (a rebuilt log, then totals, then timing over them)."""
    return {"events": backfill_events(run), "attempts": backfill_attempts(run), "recount": backfill_recount(run),
            "timing": backfill(run, recompute),
            "conversation": backfill_conversation(run), "provenance": backfill_provenance(run)}


if __name__ == "__main__":
    recompute = "--recompute" in sys.argv
    for arg in (a for a in sys.argv[1:] if a != "--recompute"):
        for step, sids in backfill_all(Path(arg).resolve(), recompute).items():
            print(f"{arg} {step}: {', '.join(sids) or 'nothing to fill'}")
