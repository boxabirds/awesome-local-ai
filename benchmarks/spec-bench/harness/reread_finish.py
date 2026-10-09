"""reread_finish.py <run-dir> <story>... — a story recorded PARTIAL because the harness could not read the agent's reply is re-read.

For each story: if its record says the harness ended it at the stop message (end_reason stop-message-exhausted), and the agent's last
reply in the story's events, read by the current reader, has `STORY <id> DONE <hash>` with the hash the start of the commit the story
was recorded at (a commit the harness did not have to make: the tree was clean), the record becomes what the current harness would
have written: DONE, ended by the agent, finished after the stop message (the message was sent, and the record still says so), with
the conversation profile the current reader gives. The held-out result and everything else stand. Anything short of that evidence
changes nothing. Idempotent. Run it on the node, in the run directory, with the run stopped.

Why: gufo-opencode v2-gufoopencode-r1 story 1, 8 Oct 2026 (the reader knew only pi's and Claude Code's events). Tests: test_reread_finish.py.
"""
from __future__ import annotations

import sys
from pathlib import Path

import conversation
import drive
import heldout

REREAD_NOTE = ("story {sid}: re-read with the fixed reader: the agent's own `STORY {sid} DONE` line is for the recorded commit, so the story "
               "finished at the stop message. It had been recorded PARTIAL (ended by the operator) because the harness could not read "
               "OpenCode's events. Held-out result unchanged.")
SKIP_ONLY_FIELDS = ("reason", "by", "requested_at", "verdict", "health")


def reread(run: Path, sid: int) -> bool:
    """Whether the story's record was changed."""
    run = Path(run)
    metrics = heldout.load_metrics(run)
    rec = metrics["stories"].get(str(sid))
    if not rec or rec.get("end_reason") != drive.STOP_MESSAGE_EXHAUSTED or rec.get("status") != drive.PARTIAL:
        return False
    events = run / "stories" / f"{sid:02d}" / "agent-events.jsonl"
    hashes = [h.lower() for n, h in drive.DONE_LINE.findall(drive.final_reply_text(events)) if int(n) == sid]
    if not any(str(rec.get("commit", "")).lower().startswith(h) for h in hashes):
        return False
    rec["agent"]["finished"] = True
    rec["agent"].pop("ended_by_operator", None)
    rec.update(status=drive.DONE, ended_by="agent", end_reason=drive.end_reason(rec["agent"], None))
    rec.pop("skip", None)
    rec.pop("verdict", None)
    rec["conversation"] = conversation.profile(events, rec["started"], rec["agent_finished"])
    for entry in metrics.get("processed", []):
        if entry.get("id") == sid:
            entry.update(status=drive.DONE, ended_by="agent")
            for k in SKIP_ONLY_FIELDS:
                entry.pop(k, None)
    heldout.save_metrics(run, metrics)
    drive.log_intervention(run, REREAD_NOTE.format(sid=sid))
    return True


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__.splitlines()[0], file=sys.stderr)
        return 2
    for sid in map(int, argv[1:]):
        print(f"story {sid}: {'re-read, now DONE' if reread(Path(argv[0]), sid) else 'left as it was (the evidence does not show it finished)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
