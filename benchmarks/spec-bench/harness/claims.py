"""What the agent said when it finished each story: its completion claims, for a grading package.

    claims.py <run-record-dir> <out-dir>

Reads stories/NN/agent-events.compact.jsonl.gz from a recorded run and writes <out-dir>/story-NN.md,
one per story, holding the agent's final message. Two event formats are understood:
- pi: the text parts of the last assistant `message_end`;
- Claude Code (stream-json): the final `result` event's `result`.
A story with neither gets no file.
"""
from __future__ import annotations

import gzip
import json
import sys
from pathlib import Path

EVENTS = "agent-events.compact.jsonl.gz"


def final_message(lines) -> str | None:
    """The agent's last statement in one story's event stream, or None."""
    pi_text = None
    claude_result = None
    for line in lines:
        try:
            e = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        if e.get("type") == "message_end":
            m = e.get("message") or {}
            if m.get("role") == "assistant":
                parts = [c.get("text", "") for c in m.get("content") or [] if c.get("type") == "text"]
                text = "".join(parts).strip()
                if text:
                    pi_text = text
        elif e.get("type") == "result" and isinstance(e.get("result"), str) and e["result"].strip():
            claude_result = e["result"].strip()
    return claude_result or pi_text


def write_claims(run: Path, out: Path) -> list[str]:
    """story-NN.md for each story with a final message. Returns the story ids written."""
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for sdir in sorted(p for p in (run / "stories").iterdir() if p.is_dir()):
        events = sdir / EVENTS
        if not events.exists():
            continue
        with gzip.open(events, "rt", errors="replace") as f:
            text = final_message(f)
        if text is None:
            continue
        (out / f"story-{sdir.name}.md").write_text(f"# Story {sdir.name}\n{text}\n")
        written.append(sdir.name)
    return written


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    ids = write_claims(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"claims for stories: {' '.join(ids) or 'none'}")
