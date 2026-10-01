"""backfill_draft.py [--dry-run] <run-dir>... — MTP draft figures for stories recorded without them.

Until 1 Oct 2026 the harness read draft figures only from llama-server's log, so gufo's and mlx-serve's stories
(timed from pi's stream) had none, and neither had a restarted story on any server (summing its attempts' splits
dropped them). This fills time_split.model's draft_acceptance and mean_accepted_len, for the story and for each of
its attempts, exactly as a live run now computes them (accounting.time_split, accounting.draft_figures), from the
server's log the run kept (server.log) and the full event log the machine kept (stories/NN/agent-events.jsonl).
Run it on the machine that ran the run. Nothing else in a record changes: the time split itself is the same
calculation. Idempotent: a story that has draft figures, or whose logs have none, is left alone. --dry-run prints
what it would fill and writes nothing.
"""
from __future__ import annotations

import sys
from pathlib import Path

import accounting
import heldout
from backfill_timing import _raw, _stories
from engine_log import DRAFT_KEYS

SERVER_LOG = "server.log"
ACCEPTANCE = "draft_acceptance"     # present (None when nothing was drafted) once a story's figures were read


def _attempts(rec: dict) -> list[dict]:
    """A restarted story's attempts, each with its window; [] for a story run once."""
    each = (rec.get("agent") or {}).get("attempts") or []
    return [a for a in each if a.get("started") is not None and a.get("ended") is not None] if len(each) > 1 else []


def _windows(rec: dict) -> list[tuple[float, float]]:
    if (each := _attempts(rec)):
        return [(a["started"], a["ended"]) for a in each]
    return [(rec["started"], rec["agent_finished"])] if "started" in rec and "agent_finished" in rec else []


def _fill(split: dict | None, figures: dict) -> bool:
    model = (split or {}).get("model")
    if not model or not figures or ACCEPTANCE in model:
        return False
    model.update(figures)
    return True


def backfill(run: Path, dry_run: bool = False) -> list[str]:
    """Fill the draft figures of every story that has model time but none. Returns the stories filled."""
    metrics = heldout.load_metrics(run)
    server_log = run / SERVER_LOG
    filled = []
    if not server_log.is_file():
        return filled
    for sid, rec in _stories(metrics):
        raw = _raw(run, sid)
        model = (rec.get("time_split") or {}).get("model")
        if not model or ACCEPTANCE in model or not raw.is_file():
            continue
        windows = _windows(rec)
        figures = accounting.draft_figures(raw, server_log, windows)
        if not figures:
            continue
        if dry_run:
            print(f"{run} story {sid}: {figures}")
        else:
            _fill(rec["time_split"], figures)
            for a in _attempts(rec):
                _fill(a.get("time_split"), accounting.draft_figures(raw, server_log, [(a["started"], a["ended"])]))
        filled.append(sid)
    if filled and not dry_run:
        heldout.save_metrics(run, metrics)
    return filled


def main(argv: list[str]) -> None:
    dry_run = "--dry-run" in argv
    for arg in (a for a in argv if a != "--dry-run"):
        sids = backfill(Path(arg).resolve(), dry_run)
        print(f"{arg} draft: {', '.join(sids) or 'nothing to fill'}")


if __name__ == "__main__":
    main(sys.argv[1:])
