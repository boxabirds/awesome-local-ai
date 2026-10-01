"""PROGRESS.md: the agent's own account of where each task of the story stands.

The pack's spec is read-only for the agent (drive.sandboxed), and the Status column of a story's tasks.md is not
the agent's to update: agents edited it in 13 recorded runs. This file is where that goes instead. The harness
writes it at the workspace's root at the start of each story, for that story (replacing the story before's), with
every task of the pack's tasks.md at `todo`; the agent edits it freely. At the end of the story the harness reads
back what the agent claimed per task and records it beside its own evidence (progress.task_table), which never
depends on it: what ends a story is the verified DONE line (drive.story_finished), not this file.
"""
from __future__ import annotations

import re
from pathlib import Path

FILE = "PROGRESS.md"
INITIAL = "todo"
STATUSES = (INITIAL, "doing", "done", "blocked")
HEADER = "| # | Task | Status |"
RULE = "|---|---|---|"
# A task's row: its number in the first cell, the status in the last; the cells between are the title's.
ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|.*\|\s*([^|]*?)\s*\|\s*$")
HEADER_RE = re.compile(r"^\|\s*#\s*\|.*\|\s*Status\s*\|\s*$", re.I)
EMPHASIS = "*_`~ "             # what a model puts round a word: not part of the status
STATUS_MAX_CHARS = 80          # an unknown status is kept as written, up to this
# What became of the file by the end of the story (the record's `file`).
READ, MISSING, UNPARSEABLE = "read", "missing", "unparseable"


def text(sid: int, title: str, tasks: list[dict]) -> str:
    """The file as a story starts: its number and title, every task at `todo`, and the statuses allowed."""
    rows = [f"| {t['n']} | {t['title'].replace('|', chr(92) + '|')} | {INITIAL} |" for t in tasks]
    return "\n".join([
        f"# Story {sid}: {title}", "",
        "Your progress on this story's tasks. Keep the Status column up to date as you work.", "",
        HEADER, RULE, *rows, "",
        f"Statuses: {', '.join(STATUSES)} (blocked = cannot be done on this machine; say why in NOTES.md).", ""])


def write(ws: Path, sid: int, title: str, tasks: list[dict]) -> None:
    (ws / FILE).write_text(text(sid, title, tasks))


def _status(cell: str) -> str:
    """One of STATUSES where the cell says one (whatever its case or emphasis), else the cell as written."""
    plain = cell.strip(EMPHASIS).lower()
    return plain if plain in STATUSES else cell[:STATUS_MAX_CHARS]


def claimed(ws: Path) -> dict:
    """What the agent's file says per task: {"file": read|missing|unparseable, "tasks": {"<n>": status}}.
    A file with neither the table's header nor a task row is unparseable, like one that can't be read."""
    f = ws / FILE
    if not f.exists():
        return {"file": MISSING, "tasks": {}}
    try:
        lines = f.read_text(errors="replace").splitlines()
    except OSError:
        return {"file": UNPARSEABLE, "tasks": {}}
    rows = [m for m in map(ROW_RE.match, lines) if m]
    if not rows and not any(HEADER_RE.match(line) for line in lines):
        return {"file": UNPARSEABLE, "tasks": {}}
    return {"file": READ, "tasks": {str(int(m.group(1))): _status(m.group(2)) for m in rows}}
