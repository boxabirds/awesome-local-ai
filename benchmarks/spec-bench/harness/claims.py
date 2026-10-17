"""What the agent said when it finished each story: its completion claims, for a grading package.

    claims.py <run-record-dir> <out-dir>

Reads each story's raw event log (stories/NN/agent-events.jsonl) from a recorded run, else its compact copy
(agent-events.compact.jsonl.gz, the only form some reference runs have), and writes <out-dir>/story-NN.md,
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

RAW_EVENTS = "agent-events.jsonl"
HOME_MARK = "~"
EVENTS = "agent-events.compact.jsonl.gz"      # the compact copy: stream deltas dropped; older runs have only this


def event_log(sdir: Path) -> Path | None:
    """A story's event log: the raw one when it is there, else the compact copy, else None."""
    return next((p for p in (sdir / RAW_EVENTS, sdir / EVENTS) if p.is_file()), None)


def event_lines(sdir: Path) -> list[str]:
    """The lines of the story's event log (raw, else compact); [] when it has none. The raw log is read as the
    compact copy was written: this machine's home directory shown as ~."""
    path = event_log(sdir)
    if path is None:
        return []
    if path.suffix == ".gz":
        with gzip.open(path, "rt", errors="replace") as f:
            return f.readlines()
    home = str(Path.home())
    with path.open(errors="replace") as f:
        return [line.replace(home, HOME_MARK) for line in f]


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
        if event_log(sdir) is None:
            continue
        text = final_message(event_lines(sdir))
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
