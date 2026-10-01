"""PROGRESS.md: where the agent keeps its own account of a story's tasks (progress_file.py)."""
from __future__ import annotations

import pytest

import progress_file

TASKS = [{"n": 1, "title": "Unit tests for the board"}, {"n": 2, "title": "The board | its columns"},
         {"n": 3, "title": "End-to-end tests"}]
FRESH = """\
# Story 4: Edit a note

Your progress on this story's tasks. Keep the Status column up to date as you work.

| # | Task | Status |
|---|---|---|
| 1 | Unit tests for the board | todo |
| 2 | The board \\| its columns | todo |
| 3 | End-to-end tests | todo |

Statuses: todo, doing, done, blocked (blocked = cannot be done on this machine; say why in NOTES.md).
"""


def test_a_fresh_file_names_the_story_and_lists_every_task_as_todo_with_the_statuses_allowed():
    assert progress_file.text(4, "Edit a note", TASKS) == FRESH
    assert (progress_file.FILE, progress_file.STATUSES, progress_file.INITIAL) == (
        "PROGRESS.md", ("todo", "doing", "done", "blocked"), "todo")


def test_writing_it_replaces_the_story_before_s(tmp_path):
    (tmp_path / progress_file.FILE).write_text("# Story 3: The one before\n\n| 1 | Old task | done |\n")
    progress_file.write(tmp_path, 4, "Edit a note", TASKS)
    assert (tmp_path / "PROGRESS.md").read_text() == FRESH


def test_a_fresh_file_reads_back_as_every_task_todo(tmp_path):
    progress_file.write(tmp_path, 4, "Edit a note", TASKS)
    assert progress_file.claimed(tmp_path) == {"file": progress_file.READ, "tasks": {"1": "todo", "2": "todo", "3": "todo"}}


def test_what_the_agent_claims_is_read_per_task_with_unknown_wording_kept_as_written(tmp_path):
    edited = (FRESH.replace("| Unit tests for the board | todo |", "| Unit tests for the board | **Done** |")
              .replace("| its columns | todo |", "| its columns |  blocked  |")
              .replace("| End-to-end tests | todo |", "| End-to-end tests | ✅ complete (see NOTES) |"))
    (tmp_path / progress_file.FILE).write_text(edited)
    assert progress_file.claimed(tmp_path) == {
        "file": progress_file.READ, "tasks": {"1": "done", "2": "blocked", "3": "✅ complete (see NOTES)"}}


def test_a_long_unknown_status_is_cut_to_its_limit(tmp_path):
    (tmp_path / progress_file.FILE).write_text("| # | Task | Status |\n|---|---|---|\n| 1 | A | " + "x" * 500 + " |\n")
    got = progress_file.claimed(tmp_path)["tasks"]["1"]
    assert got == "x" * progress_file.STATUS_MAX_CHARS and progress_file.STATUS_MAX_CHARS == 80


def test_a_task_listed_twice_takes_its_last_row_and_rows_the_agent_added_are_kept(tmp_path):
    (tmp_path / progress_file.FILE).write_text(
        "| # | Task | Status |\n|---|---|---|\n| 1 | A | doing |\n| 1 | A | done |\n| 9 | My own extra task | DOING |\n")
    assert progress_file.claimed(tmp_path)["tasks"] == {"1": "done", "9": "doing"}


def test_a_story_with_no_tasks_has_a_table_with_no_rows_and_reads_as_no_claims(tmp_path):
    progress_file.write(tmp_path, 1, "First", [])
    assert "| # | Task | Status |\n|---|---|---|\n\nStatuses:" in (tmp_path / progress_file.FILE).read_text()
    assert progress_file.claimed(tmp_path) == {"file": progress_file.READ, "tasks": {}}


@pytest.mark.parametrize("content, state", [
    (None, progress_file.MISSING),
    ("", progress_file.UNPARSEABLE),
    ("All done, nothing to see here.\n", progress_file.UNPARSEABLE),
    (b"\xff\xfe\x00 not text | 1 |", progress_file.UNPARSEABLE),
])
def test_a_missing_or_unparseable_file_is_recorded_as_such(tmp_path, content, state):
    f = tmp_path / progress_file.FILE
    if isinstance(content, bytes):
        f.write_bytes(content)
    elif content is not None:
        f.write_text(content)
    assert progress_file.claimed(tmp_path) == {"file": state, "tasks": {}}


def test_a_directory_in_its_place_is_unparseable_not_a_crash(tmp_path):
    (tmp_path / progress_file.FILE).mkdir()
    assert progress_file.claimed(tmp_path) == {"file": progress_file.UNPARSEABLE, "tasks": {}}
