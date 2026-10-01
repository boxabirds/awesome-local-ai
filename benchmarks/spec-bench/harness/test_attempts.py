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


def test_tokens_no_attempt_knows_stay_unknown_when_summed():
    """Claude Code's stream doesn't give a call's output tokens (accounting.py: decode_tokens None). Summed over
    attempts they became 0: Sonnet v2-r1 story 9, 62 model calls over five attempts, was recorded as generating
    nothing. The model parts are that record's first and last attempts."""
    first = {"source": accounting.CLAUDE_STREAM, "requests": 57, "prefill_s": 95.0, "prefill_tokens": 322570, "prefill_tok_s": None,
             "decode_s": 360.5, "decode_tokens": None, "decode_tok_s": None, "cached_tokens": 7153607}
    last = {**first, "requests": 2, "prefill_s": 2.5, "prefill_tokens": 13478, "decode_s": 6.7, "cached_tokens": 257640}
    split = lambda model, wall: {"wall_s": wall, "model": model, "tools_s": 0.0, "tools_by_kind": {}, "compaction_s": 0.0,
                                 "compactions": 0, "between_sessions_s": 0.0, "other_s": round(wall - model["prefill_s"] - model["decode_s"], 1),
                                 "accounting": {"version": accounting.VERSION, "ok": True, "problems": [], "abandoned_calls": 0}}
    total = attempts.sum_splits([split(first, 693.5), split(last, 11.2)])
    assert total["model"]["decode_tokens"] is None and total["model"]["decode_tok_s"] is None
    assert total["model"]["requests"] == 59 and total["model"]["prefill_tokens"] == 336048
    assert total["accounting"]["ok"] is True


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


def _mlx_serve_log(started: float, drafts: list[tuple[int, int, int]], inp: int = 100, out: int = 7) -> str:
    """mlx-serve's log after run.sh's start mark: per request its draft figures (accepts, drafted, attempts) and its
    tokens, shaped as the real one (fixtures/engine-logs/mlx-serve-excerpt.txt)."""
    import llama_log
    return llama_log.start_marker(started) + "".join(
        f"POST /v1/chat/completions (2 msgs, stream=true)\n"
        f"  [spec-stats] mode=mtp attempts={r} accepts={a} avg_per_round={a / r:.2f} per_draft_pct={100 * a / d:.1f}% depth=6 drafted={d} runtime_disabled=false\n"
        f"  <- {inp}+{out} tokens streamed [prefill: 1.0 tok/s, decode: 1.0 tok/s] [tool_calls]\n" for a, d, r in drafts)


def test_a_restarted_story_s_draft_acceptance_covers_every_attempt(tmp_path):
    """Summing the attempts' splits kept no draft figures: mlx-serve v2-r2's restarted stories (4, 9, 11) had none."""
    import drive
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 4)[:-1])
    restart = T0 + 5000
    earlier = drive.begin_attempt(PiClient(tmp_path), ev, prior="s1", started=restart, provenance={})
    with ev.open("a") as f:
        f.write("".join(json.dumps(e) + "\n" for e in _session(restart + 1, "s1", 2)))
    drafts = [(3, 4, 1)] * 4 + [(1, 4, 1)] * 2
    (tmp_path / "server.log").write_text(_mlx_serve_log(T0 - 60, drafts))
    rec = {"started": restart, "agent_finished": restart + 32, "agent": _harness_agent(31.0, 2, 2, "s1")}
    drive.record_attempts(rec, earlier)
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert split["attempts"] == 2 and split["model"]["requests"] == 6
    assert split["model"]["draft_acceptance"] == round(14 / 24, 3) and split["model"]["mean_accepted_len"] == 3.33
    assert [a["time_split"]["model"]["draft_acceptance"] for a in rec["agent"]["attempts"]] == [0.75, 0.25]


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


def test_an_earlier_attempts_waits_between_sessions_are_not_counted_twice(tmp_path):
    """1 Oct 2026, mlx-serve v2-r2 story 4: its first attempt resumed the agent once (a wait between sessions),
    then the harness crashed and restarted. The earlier attempt's seconds were its log span, waits included, while
    the agent's clock (the current attempt's) runs only while a session does; the check then added the waits again
    and failed by exactly them (206 s). An attempt's seconds are the agent's clock, whichever record they came from."""
    import drive
    per_call = CALL_S + TOOL_S
    first = _session(T0, "s1", 2) + _session(T0 + 200, "s1", 2)          # a resume inside the first attempt
    restart_at = T0 + 400
    second = _session(restart_at + 1, "s1", 2)
    ev = _write(tmp_path / "e.jsonl", first + [attempts.restart_mark(restart_at, 2, {})] + second)
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart_at + 1 - attempts.RESTART_SLACK_S)
    assert len(earlier) == 1
    started, finished = restart_at + 1, restart_at + 1 + 1 + 2 * per_call
    rec = {"started": started, "agent_finished": finished,
           "agent": attempts.combine(earlier, _harness_agent(finished - started, 2, 2, "s1"), started, finished)}
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert split["between_sessions_s"] > 0                                 # the wait is there, and named
    assert split["accounting"]["ok"], split["accounting"]["problems"]


# ---------- a tool call the harness's own restart cut off ----------

def _restarted_mid_tool(tmp_path):
    """mlx-serve v2-r2 stories 9 and 11 (1 Oct 2026): the harness was restarted while a tool call of the agent's
    ran. The call's start is the first attempt's last event; then the restart's mark and the agent's next session."""
    import drive
    first = _session(T0, "s1", 2)[:-1]                                    # killed: no agent_end
    cut_at = first[-1]["_rx"] + CALL_S
    first += _call(cut_at)[:5]                                            # a model call, its tool call started, nothing more
    restart_at = cut_at + CALL_S + 170.0
    second = _session(restart_at + 0.2, "s1", 2)
    ev = _write(tmp_path / "e.jsonl", first + [attempts.restart_mark(restart_at, 2, {})] + second)
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart_at - attempts.RESTART_SLACK_S)
    finished = second[-1]["_rx"] + 0.3
    rec = {"started": restart_at, "agent_finished": finished,
           "agent": attempts.combine(earlier, _harness_agent(finished - restart_at - 0.2, 2, 2, "s1"), restart_at, finished)}
    return drive.story_time_split(rec, ev, tmp_path / "server.log"), rec


def test_a_tool_call_cut_off_by_the_harness_s_restart_is_not_a_failed_check(tmp_path):
    split, _ = _restarted_mid_tool(tmp_path)
    assert split["accounting"]["ok"], split["accounting"]["problems"]
    assert split["accounting"]["problems"] == []


def test_a_tool_call_cut_off_by_a_restart_is_listed_once_with_its_attempt_and_owns_none_of_the_next(tmp_path):
    """It was reported by both attempts, and owned the next attempt's first seconds (to its first model call)."""
    split, rec = _restarted_mid_tool(tmp_path)
    assert split["accounting"]["interrupted_tools"] == [
        {"attempt": 1, "kind": "bash", "seconds": 0.0, "ended_by": accounting.ENDED_BY_RESTART}]
    first, second = (a["time_split"] for a in rec["agent"]["attempts"])
    assert len(first["accounting"]["interrupted_tools"]) == 1 and second["accounting"]["interrupted_tools"] == []
    assert second["tools_s"] == 2 * TOOL_S                                # its own two tool calls, nothing of the dead one


def test_summed_splits_keep_the_time_suspended_and_what_was_interrupted():
    acc = lambda **kw: {"version": accounting.VERSION, "ok": True, "problems": [], "abandoned_calls": 0,
                        "interrupted_tools": [], "interrupted_compactions": 0, **kw}
    one = {"wall_s": 50.0, "model": None, "tools_s": 5.0, "tools_by_kind": {"e2e": 5.0}, "compaction_s": 10.0, "compactions": 1,
           "between_sessions_s": 0.0, "other_s": 35.0, "suspended_s": 30.0,
           "accounting": acc(interrupted_tools=[{"kind": "e2e", "seconds": 5.0, "ended_by": accounting.ENDED_BY_RESTART}],
                             interrupted_compactions=1)}
    two = {**one, "suspended_s": 0.0, "accounting": acc()}
    total = attempts.sum_splits([one, two])
    assert total["suspended_s"] == 30.0 and total["accounting"]["ok"] is True
    assert total["accounting"]["interrupted_tools"] == [
        {"attempt": 1, "kind": "e2e", "seconds": 5.0, "ended_by": accounting.ENDED_BY_RESTART}]
    assert total["accounting"]["interrupted_compactions"] == 1
    old = {k: v for k, v in two.items() if k != "suspended_s"}            # a split from before these fields
    old["accounting"] = {"version": 3, "ok": True, "problems": [], "abandoned_calls": 0}
    assert attempts.sum_splits([old, one])["suspended_s"] == 30.0


# ---------- the machine asleep during a session ----------

ASLEEP_S = 30.0


def _claude_session(t: float, wall_s: float, clock_s: float) -> list[dict]:
    """One Claude Code session: wall_s long by the log's stamps, clock_s by Claude Code's own clock."""
    msg = lambda at, mid, text: {"_rx": at, "type": "assistant", "parent_tool_use_id": None, "message": {
        "id": mid, "role": "assistant", "content": [{"type": "text", "text": text}],
        "usage": {"input_tokens": 2, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0, "output_tokens": 8}}}
    return [{"_rx": t, "type": "system", "subtype": "init", "session_id": "c1"},
            msg(t + 5, f"m{t}a", "working"), msg(t + wall_s - 1, f"m{t}b", "done"),
            {"_rx": t + wall_s, "type": "result", "subtype": "success", "session_id": "c1", "duration_ms": int(clock_s * 1000)}]


def test_a_story_whose_machine_slept_agrees_with_the_agents_clock(tmp_path):
    """Sonnet 5.5 v2-r4 story 4 (1 Oct 2026): one session, the lid closed for 31 s of it. The harness's clock for
    the agent (time.monotonic) stopped; the wall went on. Wall 2352.1 s, agent 2321.2 s: the check failed by the
    sleep. Claude Code's own clock (duration_ms) stopped too, and the log's two clocks give the time asleep."""
    import drive
    wall = 100.0
    ev = _write(tmp_path / "e.jsonl", _claude_session(T0 + 0.5, wall - 1, wall - 1 - ASLEEP_S))
    rec = {"started": T0, "agent_finished": T0 + wall, "agent": {"seconds": wall - ASLEEP_S}}
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert split["suspended_s"] == ASLEEP_S
    assert split["accounting"]["ok"], split["accounting"]["problems"]


def test_agent_time_counted_twice_fails_even_when_the_machine_slept(tmp_path):
    import drive
    wall = 100.0
    ev = _write(tmp_path / "e.jsonl", _claude_session(T0 + 0.5, wall - 1, wall - 1 - ASLEEP_S))
    rec = {"started": T0, "agent_finished": T0 + wall, "agent": {"seconds": wall}}     # the sleep counted as agent time too
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert not split["accounting"]["ok"] and "counted twice" in split["accounting"]["problems"][0]


def test_an_earlier_attempt_s_seconds_leave_out_the_time_its_machine_slept(tmp_path):
    """An attempt counted from the log gets the agent's clock for its seconds: its span less the waits between its
    sessions and less the time suspended, as the harness's own clock would have given."""
    import drive
    from clients import ClaudeClient
    restart_at = T0 + 500
    ev = _write(tmp_path / "e.jsonl", _claude_session(T0, 100.0, 100.0 - ASLEEP_S) + [attempts.restart_mark(restart_at, 2, {})]
                + _claude_session(restart_at + 0.5, 49.0, 49.0))
    earlier = attempts.earlier_attempts(ClaudeClient(tmp_path), ev, before=restart_at - attempts.RESTART_SLACK_S)
    started, finished = restart_at, restart_at + 50
    current = {"seconds": 49.6, "steps": 2, "tool_calls": 0, "compactions": 0, "tokens": {}, "sessions": ["c1"]}
    rec = {"started": started, "agent_finished": finished, "agent": attempts.combine(earlier, current, started, finished)}
    split = drive.story_time_split(rec, ev, tmp_path / "server.log")
    assert rec["agent"]["attempts"][0]["seconds"] == 100.0 - ASLEEP_S
    assert split["suspended_s"] == ASLEEP_S and split["wall_s"] == 150.0
    assert split["accounting"]["ok"], split["accounting"]["problems"]


# ---------- a Claude story's earlier attempts, counted after another pass over its log ----------

def test_earlier_attempts_count_claude_steps_after_the_harness_looked_for_the_session(tmp_path):
    """drive.py finds the session to continue (drive.last_session: every event through client.scan) before it
    counts the earlier attempts, with the same client. Sonnet v2-r1 story 9 was recorded with 0 steps for them."""
    from clients import ClaudeClient, empty_state
    from test_clients import RESTARTED_CLAUDE_EVENTS, RESTARTED_CLAUDE_STEPS
    log = _write(tmp_path / "agent-events.jsonl", RESTARTED_CLAUDE_EVENTS)
    client = ClaudeClient(tmp_path)
    for e in attempts.events(log):                       # as drive.last_session does
        client.scan(e, empty_state())
    [earlier] = attempts.earlier_attempts(client, log, before=RESTARTED_CLAUDE_EVENTS[-1]["_rx"] + 1)
    assert earlier["steps"] == RESTARTED_CLAUDE_STEPS and earlier["tool_calls"] == 2


# ---------- recounting a restarted record whose earlier attempts were counted wrong ----------

def _restarted_record(tmp_path, damage):
    """A story restarted once (pi log), recorded as the harness records it, then damaged as a past bug did."""
    restart_at = T0 + 400
    ev = _write(tmp_path / "e.jsonl", _session(T0, "s1", 3) + [attempts.restart_mark(restart_at, 2, {})]
                + _session(restart_at + 1, "s1", 2))
    earlier = attempts.earlier_attempts(PiClient(tmp_path), ev, before=restart_at + 1 - attempts.RESTART_SLACK_S)
    started, finished = restart_at + 1, restart_at + 1 + 1 + 2 * (CALL_S + TOOL_S)
    good = attempts.combine(earlier, _harness_agent(finished - started, 2, 2, "s1"), started, finished)
    rec = {"started": started, "agent_finished": finished, "agent": json.loads(json.dumps(good))}
    damage(rec["agent"])
    return rec, ev, good


def _zero_earlier_steps(agent):
    agent["attempts"][0]["steps"] = 0
    agent["steps"] = agent["attempts"][1]["steps"]


def test_recount_restores_an_earlier_attempt_s_counts_from_the_log(tmp_path):
    """Sonnet 5.5 v2-r1 story 9 and v2-r2 story 2 (1 Oct 2026): recorded with 0 steps for their earlier attempts
    (2 steps for 62 in the log), by a client that counted a log's steps only on its first pass. recompute()
    leaves a record that already has attempts alone; recount() redoes the attempts the log recorded and keeps
    the one the harness ran."""
    rec, ev, good = _restarted_record(tmp_path, _zero_earlier_steps)
    assert attempts.recompute(rec, ev, "pi") is None                      # the old tool passes it over
    new = attempts.recount(rec, ev, "pi")
    assert new["steps"] == good["steps"] == 5
    assert [a["steps"] for a in new["attempts"]] == [3, 2]
    assert new["attempts"][1] == good["attempts"][1]                      # the harness's own attempt is kept
    assert new["tokens"] == good["tokens"] and new["seconds"] == good["seconds"]


def test_recount_leaves_a_right_record_and_a_story_run_once_alone(tmp_path):
    rec, ev, _ = _restarted_record(tmp_path, lambda agent: None)
    assert attempts.recount(rec, ev, "pi") is None
    once = {"started": T0, "agent_finished": T0 + 50, "agent": _harness_agent(50, 3, 3, "s1")}
    assert attempts.recount(once, ev, "pi") is None
    assert attempts.recount(rec, tmp_path / "missing.jsonl", "pi") is None
