"""accounting.reconcile_silent_alive: an agent process that was alive but silent until the harness killed it is not 'between sessions'.

Why: gufo v2-gufo05-r1 story 4 (and 8 other stories, 9 Oct 2026). The agent hung silent for about ten minutes, the harness killed it (exit 143) and
resumed it 60 s later. The harness's clock for the agent ran through the silent stretch; the log analysis put the same stretch in 'between sessions'
(from the process's last event to the next session's start: 666 s). 606 s was counted twice, the accounting check failed, and the app, which never
shows a split that fails its own check, showed no time breakdown for the story. The split is true except for that one allocation.
"""
import gzip
import json
from pathlib import Path

import pytest

import accounting

REPO = Path(__file__).resolve().parents[3]
STORY4 = REPO / "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-gufo05-r1"


def split(wall, between, other, **kw):
    s = {"wall_s": wall, "model": {"prefill_s": 500.0, "decode_s": wall - 500.0 - between - other - 100.0, "prefill_tokens": 1, "decode_tokens": 1}, "tools_s": 100.0,
         "tools_by_kind": {"bash": 100.0}, "compaction_s": 0.0, "compactions": 0, "between_sessions_s": between, "other_s": other, "suspended_s": 0.0,
         "accounting": {"version": 4, "ok": True, "problems": [], "abandoned_calls": 0, "interrupted_tools": [], "interrupted_compactions": 0}}
    s.update(kw)
    return s


def test_the_silent_alive_stretch_moves_from_between_sessions_to_other_and_the_check_then_passes():
    s = split(14415.4, between=665.8, other=24.7)
    assert accounting.check(s, agent_seconds=14355.4), "before: the check fails, agent time counted twice"
    r = accounting.reconcile_silent_alive(s, agent_seconds=14355.4)
    assert r["between_sessions_s"] == pytest.approx(60.0, abs=0.2), "what is left is the harness's own wait before the restart"
    assert r["other_s"] == pytest.approx(24.7 + 605.8, abs=0.2)
    assert r["accounting"]["silent_alive_s"] == pytest.approx(605.8, abs=0.2)
    assert accounting.check(r, agent_seconds=14355.4) == []
    assert s["between_sessions_s"] == 665.8, "the input is not changed"


def test_a_split_that_already_agrees_with_the_agent_clock_is_left_alone():
    s = split(1000.0, between=60.0, other=10.0)
    assert accounting.reconcile_silent_alive(s, agent_seconds=940.0) == s


def test_an_overlap_that_between_sessions_cannot_explain_is_still_a_failure():
    s = split(1000.0, between=20.0, other=10.0)       # the agent's clock exceeds the wall by 200 s and only 20 s is between sessions
    r = accounting.reconcile_silent_alive(s, agent_seconds=1180.0)
    assert r == s and accounting.check(r, agent_seconds=1180.0)


def test_an_unexplained_gap_the_wall_longer_than_the_agent_clock_is_still_flagged():
    s = split(1000.0, between=0.0, other=300.0)
    r = accounting.reconcile_silent_alive(s, agent_seconds=600.0)
    assert r == s and any("longer than the agent's own clock" in p for p in accounting.check(r, agent_seconds=600.0))


@pytest.mark.skipif(not (STORY4 / "stories/04/agent-events.compact.jsonl.gz").exists(), reason="the recorded run is not in this checkout")
def test_gufo05_r1_story_4_from_its_recorded_log_gets_a_split_that_passes(tmp_path):
    """The real record and log: the story the owner could not see a time breakdown for."""
    import drive
    rec = json.loads((STORY4 / "metrics.json").read_text())["stories"]["4"]
    events = tmp_path / "agent-events.jsonl"
    events.write_bytes(gzip.open(STORY4 / "stories/04/agent-events.compact.jsonl.gz").read())
    sp = drive.story_time_split(rec, events, tmp_path / "no-server.log")
    assert sp["accounting"]["ok"], sp["accounting"]["problems"]
    assert 30.0 < sp["between_sessions_s"] < 120.0, "the 60 s restart wait, not the silent ten minutes"
    assert sp["accounting"]["silent_alive_s"] > 500.0
    assert sp["tools_s"] > 5000.0, "the hung tool calls are still tool time"
