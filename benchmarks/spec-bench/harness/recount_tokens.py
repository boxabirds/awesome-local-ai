# /// script
# requires-python = ">=3.11"
# ///
"""Rebuild each story's agent.tokens from the story's own recorded event log.

Until 30 Sep 2026 ClaudeClient.scan kept only the usage of a session's last `result` event, so a Claude
story that ended in more than one kept the last stretch alone (Opus v2-r3 story 12: 1,230 output tokens
recorded against 91,850). The scan now adds them; this re-reads each story's log with the current scan and
puts the sums in metrics.json. The log counts every attempt of the story it holds, so a story restarted by
the harness gets all of them, not only its last.

    uv run recount_tokens.py <run-dir>... [--client claude] [--write]

Without --write it only prints what would change. With it, each changed story's agent.tokens and its
processed entry's output_tokens are replaced, and agent.tokens_recounted keeps what was there before and
which log the new figures came from. Only the public metrics.json is touched: tokens are not held-out
detail, so heldout-detail.json is left as it is. Running it twice changes nothing the second time.
"""
from __future__ import annotations

import argparse
import gzip
import json
import sys
import time
from pathlib import Path

from clients import CLIENTS, empty_state

FULL_LOG = "agent-events.jsonl"                 # git-ignored, on the machine that ran the story
COMPACT_LOG = "agent-events.compact.jsonl.gz"   # the committed copy: stream deltas dropped, long strings cut
PROVENANCE = "tokens_recounted"
METRICS = "metrics.json"


def story_log(sdir: Path) -> Path | None:
    """The story's event log: the full one if the machine still has it, else the committed compact one."""
    return next((p for p in (sdir / FULL_LOG, sdir / COMPACT_LOG) if p.is_file()), None)


def _lines(path: Path):
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", errors="replace") as f:
        yield from f


def events_of(path: Path):
    for line in _lines(path):
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue          # a line cut off when the harness or the machine stopped
        if isinstance(e, dict):
            yield e


def tokens_from_events(client: str, events) -> dict:
    # The scan keeps nothing on disk; the work directory it is given is never written.
    c, st = CLIENTS[client](Path("/nonexistent")), empty_state()
    for e in events:
        c.scan(e, st)
    return st["tokens"]


def tokens_from_log(client: str, path: Path) -> dict:
    return tokens_from_events(client, events_of(path))


def recount(run: Path, client: str | None = None, write: bool = False) -> list[dict]:
    """One row per recorded story: {"story", "log", "recorded", "recomputed", "changed", "note"}."""
    mf = run / METRICS
    m = json.loads(mf.read_text())
    client = client or m.get("client")
    if client not in CLIENTS:
        raise SystemExit(f"{run}: metrics.json names no client ({client!r}); pass --client ({', '.join(CLIENTS)})")
    rows, changed = [], False
    for sid, rec in sorted((m.get("stories") or {}).items(), key=lambda kv: int(kv[0])):
        agent = rec.get("agent") or {}
        recorded = agent.get("tokens")
        log = story_log(run / "stories" / f"{int(sid):02d}")
        row = {"story": sid, "log": log.relative_to(run).as_posix() if log else None, "recorded": recorded,
               "recomputed": None, "changed": False, "note": ""}
        rows.append(row)
        if log is None:
            row["note"] = "no event log: record kept"
            continue
        got = tokens_from_log(client, log)
        row["recomputed"] = got
        if not any(got.values()):
            # A log with no usage in it (cut off before its first result) says nothing: never zero a record.
            row["note"] = "no token usage in the log: record kept"
            continue
        if got == recorded:
            continue
        row["changed"] = changed = True
        if write:
            agent[PROVENANCE] = {"previous": agent.get(PROVENANCE, {}).get("previous", recorded),
                                 "from": row["log"], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
            agent["tokens"] = got
            for p in m.get("processed") or []:
                if str(p.get("id")) == sid and "output_tokens" in p:
                    p["output_tokens"] = got["output"]
    if write and changed:
        mf.write_text(json.dumps(m, indent=2))
    return rows


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs="+", type=Path)
    ap.add_argument("--client", choices=sorted(CLIENTS), help="for a run whose metrics.json doesn't name one")
    ap.add_argument("--write", action="store_true", help="update metrics.json (default: print only)")
    a = ap.parse_args(argv)
    for run in a.runs:
        print(f"{run}{'' if a.write else '  (dry run)'}")
        for r in recount(run.resolve(), a.client, a.write):
            before = (r["recorded"] or {}).get("output")
            after = (r["recomputed"] or {}).get("output")
            mark = "CHANGED" if r["changed"] else "same"
            print(f"  story {r['story']:>3}: output {before} -> {after}  {mark}  {r['note'] or r['log']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
