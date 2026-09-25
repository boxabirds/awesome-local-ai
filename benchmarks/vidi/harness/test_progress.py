"""uv run --with pytest pytest harness/test_progress.py"""
import json
import subprocess
import threading
import time
from pathlib import Path

import drive
import progress
from clients import empty_state
from drive import DONE, PARTIAL, SPEC

STORY3 = SPEC / "stories" / "003-see-other-people-s-edits-appear-live-on-the-same-b" / "tasks.md"
GIT_ENV = drive.GIT_IDENTITY


def git(ws: Path, *args: str) -> str:
    return drive.sh(["git", *args], ws, GIT_ENV)


def repo(tmp_path: Path) -> tuple[Path, str]:
    ws = tmp_path / "ws"
    ws.mkdir()
    git(ws, "init", "-q", "-b", "main")
    # An earlier story's test already uses TC-22: TC numbers restart in every story.
    (ws / "tests").mkdir()
    (ws / "tests" / "old.test.ts").write_text("it('TC-22 earlier story', () => {})\n")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "story 2: earlier")
    return ws, git(ws, "rev-parse", "HEAD").strip()


def test_parse_tasks_reads_the_table_and_expands_tc_ranges():
    tasks = {t["n"]: t for t in progress.parse_tasks(STORY3)}
    assert [t["type"] for t in tasks.values()] == ["test:unit", "implementation", "implementation", "implementation",
                                                   "test:integration", "test:integration", "test:ui-component",
                                                   "test:e2e", "test:e2e"]
    assert tasks[1]["tcs"] == ["TC-01", "TC-02", "TC-03"]
    assert tasks[6]["tcs"] == ["TC-07", "TC-08", "TC-09", "TC-10", "TC-11", "TC-12", "TC-14", "TC-15", "TC-16",
                               "TC-18", "TC-31"]
    assert tasks[8]["tcs"] == [f"TC-{i}" for i in range(22, 29)]
    assert tasks[3]["tcs"] == [] and tasks[3]["implements"] == ["sync.room"]


def test_every_story_in_the_spec_has_a_parseable_task_table():
    for d in (p for p in (SPEC / "stories").iterdir() if p.is_dir()):
        tasks = progress.parse_tasks(d / "tasks.md")
        assert tasks, d.name
        assert all(t["tcs"] for t in tasks if t["type"] != "implementation"), d.name


def test_task_status_comes_from_lines_this_story_added(tmp_path):
    ws, base = repo(tmp_path)
    (ws / "tests" / "unit.test.ts").write_text("it('TC-01', ()=>{}); it('TC-02', ()=>{}); it('TC-03', ()=>{})\n")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "story 3 task 1: unit tests first")
    # Written but not committed: two of task 8's seven e2e cases.
    (ws / "tests" / "collab.spec.ts").write_text("test('TC-22', ()=>{}); test('TC-23', ()=>{})\n")
    table = {r["n"]: r for r in progress.task_table(progress.parse_tasks(STORY3), progress.evidence(ws, base))}
    assert table[1]["status"] == "committed" and table[1]["found"] == 3
    assert table[8]["status"] == "written" and (table[8]["found"], table[8]["total"]) == (2, 7)
    assert table[9]["status"] == "not-started"
    # Implementation tasks follow the test tasks of their component: sync.room <- tasks 1 and 6.
    assert table[3]["status"] == "not-started"   # task 6 (sync.room integration) not started
    assert table[2]["status"] == "not-started"


def test_old_tc_ids_in_earlier_files_do_not_count(tmp_path):
    ws, base = repo(tmp_path)
    table = {r["n"]: r for r in progress.task_table(progress.parse_tasks(STORY3), progress.evidence(ws, base))}
    assert table[8]["status"] == "not-started"


def test_commit_messages_naming_tasks_count_as_committed(tmp_path):
    ws, base = repo(tmp_path)
    (ws / "src.ts").write_text("x\n")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "feat: live sync end-to-end (tasks 4-6)")
    (ws / "src.ts").write_text("y\n")
    git(ws, "commit", "-qam", "fix (tasks 7, 9)")
    ev = progress.evidence(ws, base)
    assert ev["named"] == {4, 5, 6, 7, 9}
    table = {r["n"]: r for r in progress.task_table(progress.parse_tasks(STORY3), ev)}
    assert table[4]["status"] == "committed" and table[5]["status"] == "committed"
    assert table[8]["status"] == "not-started"
    assert ev["last_commit_at"] is not None


def test_verified_needs_the_gate_step_for_the_task_type(tmp_path):
    ws, base = repo(tmp_path)
    (ws / "tests" / "unit.test.ts").write_text("TC-01 TC-02 TC-03\n")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "unit")
    ev = progress.evidence(ws, base)
    tasks = progress.parse_tasks(STORY3)
    green = {"steps": {"test:unit": {"exit": 0}}}
    red = {"steps": {"test:unit": {"exit": 1}}}
    assert {r["n"]: r["status"] for r in progress.task_table(tasks, ev, green)}[1] == "verified"
    assert {r["n"]: r["status"] for r in progress.task_table(tasks, ev, red)}[1] == "committed"


def _table(statuses: dict[int, str]) -> list[dict]:
    return [{"n": t["n"], "type": t["type"], "status": statuses.get(t["n"], "verified")}
            for t in progress.parse_tasks(STORY3)]


def test_verdict_green_when_only_test_tasks_are_open():
    h = progress.base_health({"all_green": True}, _table({8: "written", 9: "committed"}),
                             {"passed": 5, "total": 7},
                             [{"status": "DONE", "gate_green": True, "accept": {"passed": 5, "total": 7}},
                              {"status": "DONE", "gate_green": True, "accept": {"passed": 6, "total": 7}},
                              # An unhealthy completion (red gate) doesn't lower the bar.
                              {"status": "DONE", "gate_green": False, "accept": {"passed": 0, "total": 7}}])
    assert h["verdict"] == "green" and h["unverified_tasks"] == [8, 9]


def test_verdict_amber_when_an_implementation_task_is_open_or_heldout_falls_short():
    assert progress.base_health({"all_green": True}, _table({3: "committed"}), {"passed": 7, "total": 7},
                                [])["verdict"] == "amber"
    assert progress.base_health({"all_green": True}, _table({}), {"passed": 3, "total": 7},
                                [{"status": "DONE", "gate_green": True, "accept": {"passed": 5, "total": 7}}])["verdict"] == "amber"
    # No baseline: every own held-out test must pass.
    assert progress.base_health({"all_green": True}, _table({}), {"passed": 6, "total": 7}, [])["verdict"] == "amber"
    assert progress.base_health({"all_green": True}, _table({}), {"passed": 3, "total": 7},
                                [{"status": "DONE", "gate_green": False, "accept": {"passed": 0, "total": 7}}]
                                )["verdict"] == "amber"


def test_verdict_red_when_the_gate_is_red():
    assert progress.base_health({"all_green": False}, _table({}), {"passed": 7, "total": 7}, [])["verdict"] == "red"


def test_prompt_is_unchanged_while_every_story_is_done():
    story = {"id": 3, "dir": "003-see-other-people-s-edits-appear-live-on-the-same-b"}
    scope = {"out_of_scope_note": "NOTE"}
    text = drive.render_prompt(story, "T", [{"id": 1, "status": DONE}, {"id": 2, "status": DONE}], scope)
    assert "Stories already implemented in this repository, in order: 1, 2.\nNOTE" in text
    first = drive.render_prompt({"id": 1, "dir": "001-pan-and-zoom-around-an-infinite-board"}, "T", [], scope)
    assert "in order: none (empty repository)." in first


def test_prompt_names_a_partial_story_and_the_gap_rule():
    story = {"id": 4, "dir": "004-return-to-a-board-and-find-everything-as-it-was-le"}
    processed = [{"id": 1, "status": DONE}, {"id": 2, "status": DONE},
                 {"id": 3, "status": PARTIAL, "tasks": _table({8: "written", 9: "not-started"})}]
    text = drive.render_prompt(story, "T", processed, {"out_of_scope_note": ""})
    assert "in order: 1 (done), 2 (done), 3 (partial)." in text
    assert "Story 3 was ended before it was complete" in text and "not verified then: 8, 9." in text
    assert 'under "Gap filled from story 3"' in text and "Never stub, mock or fake product code" in text
    assert "skipped" not in text.lower()


def test_old_runs_become_a_queue_of_done_stories():
    stories = [{"id": 1}, {"id": 2}, {"id": 3}]
    m = {"stories": {"2": {"finished": 2, "title": "b"}, "1": {"finished": 1, "title": "a"}, "3": {"title": "c"}}}
    assert [(p["id"], p["status"]) for p in drive.load_processed(m, stories)] == [(1, DONE), (2, DONE)]
    assert drive.load_processed({"stories": {}, "processed": [{"id": 1, "status": PARTIAL}]}, stories)[0]["status"] == PARTIAL


def test_skip_request_matches_only_its_story_and_is_marked_applied(tmp_path):
    (tmp_path / "control").mkdir()
    (tmp_path / "control" / "skip-story.json").write_text(json.dumps({"story": 3, "reason": "r"}))
    assert drive.pending_skip(tmp_path, 4) is None
    assert drive.pending_skip(tmp_path, 3)["reason"] == "r"
    drive.mark_skip_applied(tmp_path, 3)
    assert drive.pending_skip(tmp_path, 3) is None
    assert (tmp_path / "control" / "skip-story-3.applied.json").exists()


class SleepyClient:
    """Stands in for pi: reports a session, then works until it is killed."""
    name = "sleepy"

    def env(self):
        return {}

    def command(self, model_id, prompt, resume_from=None, fork=True):
        return ["sh", "-c", 'echo \'{"type":"session","id":"s1"}\'; echo \'{"type":"step"}\'; exec sleep 60']

    def scan(self, e, st):
        if e.get("type") == "session":
            st["session"] = e["id"]
        elif e.get("type") == "step":
            st["steps"] += 1
        return None


def test_operator_skip_stops_the_agent_with_no_resume_or_nudge(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "SKIP_POLL_S", 0.2)
    run = tmp_path / "run"
    ws, _ = repo(tmp_path)
    (run / "stories" / "03").mkdir(parents=True)
    drive.STORY_SKIP.clear()
    skipper = drive.SkipWatcher(run, 3, ws)
    skipper.start()

    def request():
        time.sleep(1.5)
        (run / "control").mkdir()
        (run / "control" / "skip-story.json").write_text(json.dumps({"story": 3, "reason": "too long", "by": "t"}))
    threading.Thread(target=request, daemon=True).start()
    t0 = time.monotonic()
    res = drive.run_story_agent(SleepyClient(), ws, {}, "m", "p", run / "stories" / "03" / "agent-events.jsonl")
    assert time.monotonic() - t0 < 30, "the agent must be stopped, not waited for"
    assert skipper.stop()["reason"] == "too long"
    assert res["ended_by_operator"] and res["resumes"] == 0 and res["nudges"] == 0 and res["errors"] == []
    drive.STORY_SKIP.clear()


def test_event_tally_reads_only_new_lines(tmp_path):
    from clients import PiClient
    ev = tmp_path / "e.jsonl"
    msg = {"type": "message_end", "message": {"role": "assistant", "usage": {"output": 10}, "stopReason": "toolUse"}}
    ev.write_text(json.dumps(msg) + "\n" + json.dumps({"type": "tool_execution_start", "toolName": "bash",
                                                       "args": {"command": "cd /x/ws && npx playwright test"}}) + "\n")
    t = progress.EventTally(PiClient(tmp_path), ev, empty_state)
    assert t.update()["calls"] == 1
    with ev.open("a") as f:
        f.write(json.dumps(msg) + "\n")
    out = t.update()
    assert out["calls"] == 2 and out["output_tokens"] == 20
    assert out["recent_activity"] == ["bash: npx playwright test"]


def test_heldout_changes_find_fixed_and_regressed_tests():
    before = {"tests": [{"file": "story-03.spec.ts", "title": "a", "status": "failed"},
                        {"file": "story-03.spec.ts", "title": "b", "status": "passed"}]}
    now = [{"file": "story-03.spec.ts", "title": "a", "status": "passed"},
           {"file": "story-03.spec.ts", "title": "b", "status": "failed"},
           {"file": "story-04.spec.ts", "title": "c", "status": "failed"}]
    assert progress.heldout_changes(before, now, 3) == {"fixed": ["a"], "regressed": ["b"]}


def test_stub_markers_flag_product_code_not_tests(tmp_path):
    ws, base = repo(tmp_path)
    (ws / "src").mkdir()
    (ws / "src" / "room.ts").write_text("export const relay = () => {} // TODO: stub until story 3 lands\n")
    (ws / "tests" / "room.test.ts").write_text("// TODO in a test is fine\n")
    git(ws, "add", "-A")
    git(ws, "commit", "-qm", "x")
    assert progress.stub_markers(ws, base) == ["src/room.ts: export const relay = () => {} // TODO: stub until story 3 lands"]


def test_progress_json_lists_every_story_with_its_status(tmp_path):
    stories = [{"id": 1}, {"id": 2}, {"id": 3}]
    metrics = {"processed": [{"id": 1, "status": DONE}]}
    progress.write_progress(tmp_path, {"name": "canvas"}, stories, metrics, {"id": 2, "status": "running"})
    doc = json.loads((tmp_path / "progress.json").read_text())
    assert [(s["id"], s["status"]) for s in doc["stories"]] == [(1, DONE), (2, "running"), (3, "pending")]


def test_run_gitignore_keeps_live_state_out_of_git():
    assert "progress.json" in drive.RUN_GITIGNORE and "control/" in drive.RUN_GITIGNORE


def test_gates_env_carries_story_status():
    import gates
    assert gates.processed_env([{"id": 1, "status": DONE}, {"id": 3, "status": PARTIAL}]) == "1:DONE,3:PARTIAL"
    assert gates.processed_env([1, 2]) == "1:DONE,2:DONE"
    assert gates.parse_processed("1,3:PARTIAL") == [{"id": 1, "status": DONE}, {"id": 3, "status": PARTIAL}]
