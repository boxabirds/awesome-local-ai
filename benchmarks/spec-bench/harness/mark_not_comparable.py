"""mark_not_comparable.py <run-dir> <story>=<reason>... — record that a story run isn't the same work as that
story in other runs, so it is left out of story-by-story comparisons. The run's total and its score stand.

Each named story's record gets "not_comparable": the reason, in plain words, as the pages show it; and the run's
interventions.md gets one line per story. Idempotent: the same reason again changes nothing.

Why: gufo v2-r1, 1 Oct 2026. Its story 10 was finished at 32 minutes and nudged on for 171 more, in which the agent
built stories 11 and 12 as well. Compared story by story, its 10 looked 7.6 times slower than another run's, and
its 11 and 12 started from code that was already there. Tests: test_mark_not_comparable.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import heldout

FIELD = "not_comparable"


def mark(run: Path, reasons: dict[int, str]) -> list[str]:
    """Set each story's reason; returns the story ids whose record changed. Refuses a story the run never recorded."""
    run = Path(run)
    metrics = heldout.load_metrics(run)
    for sid, reason in reasons.items():
        if str(sid) not in metrics["stories"]:
            raise SystemExit(f"{run}: story {sid} is not in this run's record")
        if not reason.strip():
            raise SystemExit(f"story {sid}: give the reason")
    changed = []
    for sid, reason in reasons.items():
        rec = metrics["stories"][str(sid)]
        if rec.get(FIELD) != reason.strip():
            rec[FIELD] = reason.strip()
            changed.append(str(sid))
    if changed:
        heldout.save_metrics(run, metrics)
        import drive
        for sid in changed:
            drive.log_intervention(run, f"story {sid}: not compared story by story with other runs: {metrics['stories'][sid][FIELD]}")
    return changed


def main(argv: list[str]) -> int:
    if len(argv) < 2 or any("=" not in a for a in argv[1:]):
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    reasons = {int(k): v for k, v in (a.split("=", 1) for a in argv[1:])}
    for sid in mark(Path(argv[0]), reasons):
        print(f"story {sid}: marked")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
