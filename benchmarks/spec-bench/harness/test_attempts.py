"""attempts.py: a story's agent totals across every harness attempt, and the recompute for past records.

Dimensions: one attempt (nothing changes); a restarted story (totals, per-attempt detail, the mark); resumes and
nudges inside one attempt are not harness attempts; splitting earlier attempts (markers, run-history starts); time
splits summed; recompute from a log with two sessions (synthetic, and the real canvas-gufo-r3 story 5 record)."""
from __future__ import annotations

import gzip
import json
from pathlib import Path

import pytest

import attempts
import accounting
from clients import PiClient

T0 = 1_790_000_000.0
CALL_S = 10.0            # each fake model call's length
TOOL_S = 5.0             # each fake tool call's length


def _call(t: float, out: int = 7, inp: int = 100, think: str = "") -> list[dict]:
    """One pi model call with its stream (message_start, deltas, message_end) and one tool call after it."""
    content = ([{"type": "thinking", "thinking": think}] if think else []) + [
        {"type": "toolCall", "name": "bash", "arguments": {"command": "ls"}}]
    return [
        {"_rx": t, "type": "message_start", "message": {"role": "assistant"}},
        {"_rx": t + 1, "type": "message_update", "delta": "a"},
        {"_rx": t + 2, "type": "message_update", "delta": "b"},
        {"_rx": t + CALL_S, "type": "message_end", "message": {
            "role": "assistant", "content": content, "stopReason": "toolUse",
            "usage": {"input": inp, "output": out, "cacheRead": 0, "cacheWrite": 0}}},
        {"_rx": t + CALL_S, "type": "tool_execution_start", "toolCallId": f"c{t}", "toolName": "bash", "args": {"command": "ls"}},
        {"_rx": t + CALL_S + 1, "type": "tool_execution_update", "partial": "x"},
        {"_rx": t + CALL_S + TOOL_S, "type": "tool_execution_end", "toolCallId": f"c{t}", "toolName": "bash"},
    ]


def _session(t: float, sid: str, calls: int) -> list[dict]:
    out = [{"_rx": t, "type": "session", "id": sid}, {"_rx": t, "type": "agent_start"}]
    for i in range(calls):
        out += _call(t + 1 + i * (CALL_S + TOOL_S))
    end = t + 1 + calls * (CALL_S + TOOL_S)
    return out + [{"_rx": end, "type": "agent_end"}]


def _write(path: Path, events: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in events))
    return path


def _harness_agent(seconds: float, steps: int, tool_calls: int, session: str, **kw) -> dict:
    """rec["agent"] as run_story_agent returns it."""
    return {"seconds": seconds, "steps": steps, "tool_calls": tool_calls, "compactions": 0, "tool_interruptions": 0,
            "tokens": {"input": 100 * steps, "output": 7 * steps, "reasoning": 0, "cache_read": 0, "cache_write": 0},
            "exit": 0, "stalled": False, "resumes": kw.get("resumes", 0), "nudges": kw.get("nudges", 0),
            "toolcall_text_resumes": 0, "errors": [], "ended_by_operator": False, "ended_in_error": False,
            "sessions": [session] * (1 + kw.get("nudges", 0) + kw.get("resumes", 0))}


# ---------- one attempt ----------

def test_a_story_run_once_has_no_earlier_attempts(tmp_path):
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 3))
    assert attempts.earlier_attempts(PiClient(tmp_path), ev, before=T0 - attempts.RESTART_SLACK_S) == []


def test_combining_with_no_earlier_attempts_leaves_the_record_as_it_was():
    current = _harness_agent(100.0, 3, 3, "s1")
    assert attempts.combine([], current, T0, T0 + 100) == current


# ---------- a restarted story ----------

def _restarted_log(tmp_path: Path) -> tuple[Path, float]:
    """Attempt 1: 4 calls from T0; the harness is killed; attempt 2 (after the restart) continues the same session."""
    first = _session(T0, "s1", 4)[:-1]           # killed: no agent_end
    restart = T0 + 5000
    return _write(tmp_path / "e.jsonl", first + [attempts.restart_mark(restart, 2, {"pack_version": "p-v1"})]
                  + _session(restart + 1, "s1", 2)), restart


def test_the_earlier_attempt_is_counted_from_the_log(tmp_path):
    ev, restart = _restarted_log(tmp_path)
    [a] = attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart)
    assert a["attempt"] == 1 and a["source"] == "log"
    assert (a["steps"], a["tool_calls"], a["tokens"]["output"]) == (4, 4, 28)
    assert a["started"] == T0 and a["ended"] == T0 + 1 + 3 * (CALL_S + TOOL_S) + CALL_S + TOOL_S
    assert a["seconds"] == round(a["ended"] - a["started"], 1)
    assert a["sessions"] == ["s1"]


def test_a_restarted_story_records_totals_across_attempts_and_keeps_each_attempt(tmp_path):
    ev, restart = _restarted_log(tmp_path)
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart)
    current = _harness_agent(31.0, 2, 2, "s1")
    agent = attempts.combine(earlier, current, restart + 1, restart + 32)
    assert agent["restarted"] is True and agent["harness_attempts"] == 2
    assert agent["steps"] == 6 and agent["tool_calls"] == 6
    assert agent["seconds"] == round(earlier[0]["seconds"] + 31.0, 1)
    assert agent["tokens"]["output"] == 42 and agent["tokens"]["input"] == 600
    assert [a["attempt"] for a in agent["attempts"]] == [1, 2]
    assert [a["source"] for a in agent["attempts"]] == ["log", "harness"]
    assert agent["attempts"][1]["steps"] == 2 and agent["attempts"][1]["started"] == restart + 1
    assert agent["sessions"] == ["s1", "s1"]
    # How the story ended is the last attempt's.
    assert agent["exit"] == 0 and agent["ended_in_error"] is False


def test_the_restart_mark_is_ignored_by_everything_that_counts_the_log(tmp_path):
    ev, restart = _restarted_log(tmp_path)
    import progress
    from clients import empty_state
    import conversation
    tally = progress.EventTally(PiClient(tmp_path), ev, empty_state)
    assert tally.update()["calls"] == 6
    assert conversation.profile(ev, T0, restart + 1000)["calls"] == 6
    assert accounting.time_split(ev, tmp_path / "none.log", T0, restart + 1000)["model"]["requests"] == 6


# ---------- resumes and nudges inside one attempt are not harness attempts ----------

def test_nudges_and_resumes_in_one_harness_attempt_are_one_attempt(tmp_path):
    """Three pi sessions in one harness attempt (a first run, a nudge, a fork-resume): all after the attempt started."""
    events = _session(T0, "s1", 2) + _session(T0 + 100, "s1", 1) + _session(T0 + 200, "s2", 1)
    ev = _write(tmp_path / "e.jsonl", events)
    assert attempts.earlier_attempts(PiClient(tmp_path), ev, before=T0 - attempts.RESTART_SLACK_S) == []
    current = _harness_agent(230.0, 4, 4, "s1", nudges=1, resumes=1)
    assert attempts.combine([], current, T0, T0 + 230) == current


def test_each_harness_restart_is_its_own_attempt_split_by_marks(tmp_path):
    events = (_session(T0, "s1", 1) + [attempts.restart_mark(T0 + 100, 2, {})] + _session(T0 + 101, "s1", 2)
              + [attempts.restart_mark(T0 + 300, 3, {})])
    ev = _write(tmp_path / "e.jsonl", events + _session(T0 + 301, "s1", 1))
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=T0 + 300)
    assert [(a["attempt"], a["steps"]) for a in earlier] == [(1, 1), (2, 2)]


def test_without_marks_run_history_starts_split_the_earlier_attempts(tmp_path):
    """Logs from before the harness marked restarts: run.sh's start times (run-history.jsonl) split them."""
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 1) + _session(T0 + 101, "s1", 2) + _session(T0 + 301, "s1", 1))
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=T0 + 300, starts=[T0 - 50, T0 + 100.5])
    assert [(a["attempt"], a["steps"]) for a in earlier] == [(1, 1), (2, 2)]


def test_a_log_without_receive_stamps_cannot_be_split(tmp_path):
    events = [{k: v for k, v in e.items() if k != "_rx"} for e in _session(T0, "s1", 2)]
    ev = _write(tmp_path / "e.jsonl", events)
    assert attempts.earlier_attempts(PiClient(tmp_path), ev, before=T0 + 10_000) == []


def test_the_next_attempt_number_follows_the_earlier_ones(tmp_path):
    ev, restart = _restarted_log(tmp_path)
    assert attempts.next_attempt(attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart + 1000)) == 3
    assert attempts.next_attempt([]) == 1


# ---------- time splits ----------

def test_time_splits_of_attempts_sum_to_a_valid_partition(tmp_path):
    ev, restart = _restarted_log(tmp_path)
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart)
    s1 = accounting.time_split(ev, tmp_path / "none.log", earlier[0]["started"], earlier[0]["ended"])
    s2 = accounting.time_split(ev, tmp_path / "none.log", restart + 1, restart + 32)
    total = attempts.sum_splits([s1, s2])
    assert total["wall_s"] == round(s1["wall_s"] + s2["wall_s"], 1)
    assert total["model"]["requests"] == s1["model"]["requests"] + s2["model"]["requests"] == 6
    assert total["model"]["decode_tokens"] == 42
    assert total["tools_s"] == round(s1["tools_s"] + s2["tools_s"], 1)
    assert accounting.check(total) == []
    assert total["accounting"]["ok"] is True and total["attempts"] == 2
    # A rate over both attempts is tokens over both attempts' raw seconds, not a mean of the two rates.
    raw = sum(s["model"]["decode_tokens"] / s["model"]["decode_tok_s"] for s in (s1, s2))
    assert total["model"]["decode_tok_s"] == round(42 / raw, 1)


def test_one_split_sums_to_itself():
    s = {"wall_s": 10.0, "model": None, "tools_s": 4.0, "tools_by_kind": {"bash": 4.0}, "compaction_s": 0.0,
         "compactions": 0, "between_sessions_s": 0.0, "other_s": 6.0,
         "accounting": {"version": accounting.VERSION, "ok": True, "problems": [], "abandoned_calls": 0}}
    assert attempts.sum_splits([s]) == s


def test_a_problem_in_one_attempt_is_named_with_its_attempt():
    ok = {"wall_s": 10.0, "model": None, "tools_s": 0.0, "tools_by_kind": {}, "compaction_s": 0.0, "compactions": 0,
          "between_sessions_s": 0.0, "other_s": 10.0,
          "accounting": {"version": accounting.VERSION, "ok": True, "problems": [], "abandoned_calls": 0}}
    bad = {**ok, "accounting": {"version": accounting.VERSION, "ok": False, "problems": ["a tool call never ended"],
                                "abandoned_calls": 1}}
    total = attempts.sum_splits([ok, bad])
    assert total["accounting"]["problems"] == ["attempt 2: a tool call never ended"]
    assert total["accounting"]["abandoned_calls"] == 1 and total["accounting"]["ok"] is False


# ---------- recompute for past records ----------

def _metrics_story(started: float, finished: float, agent: dict) -> dict:
    return {"title": "t", "started": started, "agent_finished": finished, "agent": agent}


def test_recompute_from_a_log_with_two_sessions(tmp_path):
    """A record from before this fix: the last attempt only. The log holds both harness attempts, no marks."""
    first = _session(T0, "s1", 4)[:-1]
    restart = T0 + 5000
    ev = _write(tmp_path / "e.jsonl", first + _session(restart + 1, "s1", 2))
    rec = _metrics_story(restart, restart + 32, _harness_agent(31.0, 2, 2, "s1"))
    new = attempts.recompute(rec, ev, "pi", starts=[T0 - 60, restart - 5])
    assert new is not None
    agent = new["agent"]
    assert agent["restarted"] and agent["harness_attempts"] == 2 and agent["steps"] == 6 and agent["tool_calls"] == 6
    assert new["first_started"] == T0
    assert new["time_split"]["model"]["requests"] == 6 and new["time_split"]["attempts"] == 2
    assert new["conversation"]["calls"] == 6


def test_recompute_leaves_a_story_run_once_alone(tmp_path):
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 3))
    rec = _metrics_story(T0 - 1, T0 + 100, _harness_agent(100.0, 3, 3, "s1"))
    assert attempts.recompute(rec, ev, "pi") is None


def test_recompute_is_not_done_twice(tmp_path):
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 4)[:-1] + _session(T0 + 5001, "s1", 2))
    rec = _metrics_story(T0 + 5000, T0 + 5032, _harness_agent(31.0, 2, 2, "s1"))
    rec.update(attempts.recompute(rec, ev, "pi"))
    assert attempts.recompute(rec, ev, "pi") is None


def test_recompute_from_an_old_truncated_log_keeps_counts_but_not_its_time_split(tmp_path):
    """A compact log from before the lossless one: no stream deltas, so no prefill/decode timing; counts only."""
    events = [e for e in _session(T0, "s1", 4)[:-1] + _session(T0 + 5001, "s1", 2)
              if e["type"] not in ("message_update", "tool_execution_update")]
    gz = tmp_path / "agent-events.compact.jsonl.gz"
    with gzip.open(gz, "wt") as f:
        f.write("".join(json.dumps(e) + "\n" for e in events))
    old_split = {"wall_s": 31.0, "model": None}
    rec = {**_metrics_story(T0 + 5000, T0 + 5032, _harness_agent(31.0, 2, 2, "s1")), "time_split": old_split}
    new = attempts.recompute(rec, gz, "pi")
    assert new["agent"]["steps"] == 6
    assert "time_split" not in new and new["time_split_covers"] == "last attempt"
    assert "conversation" not in new


REAL = (Path(__file__).resolve().parents[3] / "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/"
        "benchmarks/vidi/canvas-gufo-r3")


@pytest.mark.skipif(not (REAL / "stories/05/agent-events.compact.jsonl.gz").exists(), reason="record not in this checkout")
def test_recompute_the_real_restarted_gufo_story():
    """canvas-gufo-r3 story 5: recorded at 18 min and 27 calls; its log shows two harness attempts, 90 min, 284 calls."""
    metrics = json.loads((REAL / "metrics.json").read_text())
    rec = metrics["stories"]["5"]
    if rec["agent"].get("attempts"):
        pytest.skip("already recomputed")
    starts = attempts.run_starts(REAL)
    new = attempts.recompute(rec, REAL / "stories/05/agent-events.compact.jsonl.gz", "pi", starts=starts)
    agent = new["agent"]
    assert agent["harness_attempts"] == 2 and agent["tool_calls"] == 284
    assert agent["attempts"][1]["tool_calls"] == rec["agent"]["tool_calls"] == 27
    assert 85 * 60 < agent["seconds"] < 95 * 60


# ---------- drive.py's wiring: what a live restarted story records ----------

def test_a_harness_restart_marks_the_log_and_finds_the_earlier_attempt(tmp_path):
    import drive
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 4)[:-1])
    earlier = drive.begin_attempt(PiClient(tmp_path), ev, prior="s1", started=T0 + 5000,
                                  provenance={"harness_commit": "abc1234", "pack_version": "p-v1"})
    assert [a["steps"] for a in earlier] == [4]
    mark = json.loads(ev.read_text().splitlines()[-1])
    assert mark == {"_rx": T0 + 5000, "type": attempts.RESTART_MARK, "attempt": 2,
                    "harness_commit": "abc1234", "pack_version": "p-v1"}


def test_a_fresh_story_writes_no_mark(tmp_path):
    import drive
    ev = tmp_path / "e.jsonl"
    assert drive.begin_attempt(PiClient(tmp_path), ev, prior=None, started=T0, provenance={}) == []
    assert not ev.exists()


def test_a_live_restarted_story_records_every_attempt(tmp_path):
    """drive.record_attempts: what main() stores after the agent of a restarted story finishes."""
    import drive
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 4)[:-1])
    restart = T0 + 5000
    earlier = drive.begin_attempt(PiClient(tmp_path), ev, prior="s1", started=restart, provenance={})
    with ev.open("a") as f:
        f.write("".join(json.dumps(e) + "\n" for e in _session(restart + 1, "s1", 2)))
    rec = {"started": restart, "agent_finished": restart + 32, "agent": _harness_agent(31.0, 2, 2, "s1")}
    drive.record_attempts(rec, earlier)
    assert rec["agent"]["steps"] == 6 and rec["agent"]["restarted"] and rec["first_started"] == T0
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert split["attempts"] == 2 and split["model"]["requests"] == 6
    assert split["accounting"]["ok"], split["accounting"]["problems"]    # the wall agrees with the agent's clock
    assert [a["time_split"]["model"]["requests"] for a in rec["agent"]["attempts"]] == [4, 2]


def test_a_story_run_once_is_recorded_as_before(tmp_path):
    import drive
    ev = _write(tmp_path / "e.jsonl", _session(T0 + 1, "s1", 2))
    agent = _harness_agent(31.0, 2, 2, "s1")
    rec = {"started": T0, "agent_finished": T0 + 32, "agent": dict(agent)}
    drive.record_attempts(rec, [])
    assert rec["agent"] == agent and "first_started" not in rec
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert "attempts" not in split and split == {**accounting.time_split(ev, tmp_path / "server.log", T0, T0 + 32),
                                                 "accounting": split["accounting"]}


def test_the_story_cap_counts_the_earlier_attempts(tmp_path):
    import drive
    now = [1000.0]
    w = drive.SkipWatcher(tmp_path, 5, tmp_path, now=lambda: now[0], already_s=drive.MAX_STORY_AGENT_S - 10)
    assert drive.cap_reason(w.elapsed(), 0) is None
    now[0] += 11
    assert drive.cap_reason(w.elapsed(), 0) is not None


def test_server_stats_cover_every_attempt_s_window(tmp_path):
    import drive
    log = tmp_path / "req.jsonl"
    log.write_text("".join(json.dumps({"logged_at_s": t, "prompt_tokens": 10, "completion_tokens": 1}) + "\n"
                           for t in (100, 200, 300)))
    assert drive.server_stats(log, 250, 350)["requests"] == 1
    assert drive.server_stats(log, 250, 350, earlier=[(90, 110)])["requests"] == 2


def test_a_story_skipped_before_its_restart_is_timed_over_the_attempts_the_log_holds(tmp_path):
    """The operator ended the story while the harness was down: no attempt of this process, all from the log."""
    import drive
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 3)[:-1] + [attempts.restart_mark(T0 + 500, 2, {})]
                + _session(T0 + 501, "s1", 2)[:-1])
    logged = attempts.earlier_attempts(PiClient(tmp_path), ev, before=T0 + 10_000)
    now = T0 + 10_000
    rec = {"started": now, "agent_finished": now, "agent": {"seconds": sum(a["seconds"] for a in logged),
                                                           "attempts": logged, "restarted": True}}
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert split["model"]["requests"] == 5 and split["wall_s"] == round(sum(a["seconds"] for a in logged), 1)
    assert split["accounting"]["ok"], split["accounting"]["problems"]


def test_recompute_from_the_lossless_compact_log_times_every_attempt(tmp_path):
    """accounting.py and conversation.py read plain logs; recompute reads the published .gz through a plain copy."""
    import drive
    raw = _write(tmp_path / "stories/05/agent-events.jsonl", _session(T0, "s1", 4)[:-1] + _session(T0 + 5001, "s1", 2))
    gz = drive.compact_events(raw)
    raw.unlink()                       # as on a machine without the full log: the published one only
    rec = _metrics_story(T0 + 5000, T0 + 5032, _harness_agent(31.0, 2, 2, "s1"))
    new = attempts.recompute(rec, gz, "pi")
    assert new["time_split"]["model"]["requests"] == 6 and new["time_split"]["model"]["decode_s"] > 0
    assert new["conversation"]["calls"] == 6
    assert sorted(p.name for p in gz.parent.iterdir()) == ["agent-events.compact.jsonl.gz"]   # no copy left behind
