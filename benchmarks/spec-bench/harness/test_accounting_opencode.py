"""accounting.py reads OpenCode's events: where the story's time went, from its steps and tool calls.

Why: gufo-opencode v2-gufoopencode-r1 story 1, 8 Oct 2026. The time reader knew only pi's and Claude Code's events, so the story's
whole 1,867 s was "other", with no model time and no tool time, and the accounting check failed (CLAUDE.md: every coding agent has
its own parser). OpenCode writes a step_start, then its text and tool_use events once each is done, then a step_finish; a tool_use
carries its own start and end; nothing says when the first token arrived or how long the model thought.
"""
import json
from pathlib import Path

import pytest

import accounting

FIXTURE = Path(__file__).parent / "fixtures" / "opencode-stream.jsonl"


def ev(rx, type_, **part):
    return json.dumps({"_rx": rx, "type": type_, "sessionID": "s", "part": {"type": type_, **part}}) + "\n"


def step(t, model_s, tool=None, tool_s=0.0, reason="tool-calls", out=50, inp=1000, cache=500):
    """One OpenCode step starting at t: the model works for model_s, then maybe one tool for tool_s, then the step finishes."""
    lines = [ev(t, "step_start")]
    gen_end = t + model_s
    lines.append(ev(gen_end, "text", messageID="m", text="x", time={"start": (gen_end - 1) * 1000, "end": gen_end * 1000}))
    end = gen_end
    if tool:
        end = gen_end + tool_s
        lines.append(ev(end, "tool_use", tool=tool, callID=f"c{t}", state={"status": "completed", "input": {"command": "ls"}, "output": "",
                                                                          "time": {"start": gen_end * 1000, "end": end * 1000}}))
    lines.append(ev(end + 0.02, "step_finish", reason=reason, tokens={"input": inp, "output": out, "reasoning": 0, "cache": {"read": cache, "write": 0}}))
    return lines, end + 0.02


def split(tmp_path, lines, t_from, t_to):
    p = tmp_path / "events.jsonl"
    p.write_text("".join(lines))
    return accounting.time_split(p, tmp_path / "no-server.log", t_from, t_to)


def test_a_real_opencode_story_has_its_time_split_and_passes_the_accounting_check(tmp_path):
    lines = FIXTURE.read_text().splitlines(keepends=True)
    rxs = [json.loads(l)["_rx"] for l in lines]
    s = split(tmp_path, lines, rxs[0], rxs[-1] + 0.1)
    assert s["accounting"]["ok"], s["accounting"]["problems"]
    m = s["model"]
    assert m and m["source"] == accounting.OPENCODE_STREAM and m["requests"] == 6
    assert m["prefill_tokens"] == 7692 + 3057 + 12019 + 398 + 14402 + 54, "fresh input tokens, summed over the steps"
    assert m["cached_tokens"] == 0 + 7790 + 10983 + 23144 + 23542 + 38111
    assert s["tools_s"] > 0 and sum(s["tools_by_kind"].values()) == pytest.approx(s["tools_s"], abs=0.5)
    assert s["other_s"] < 1.0, "the time is owned by the model and the tools, not left as 'other'"
    assert m["prefill_tok_s"] is None and m["decode_tok_s"] is None, "OpenCode's events say neither when the first token came nor how long it thought"


def test_the_model_owns_its_step_up_to_the_first_tool(tmp_path):
    a, t = step(100.0, 30.0, tool="bash", tool_s=5.0)
    s = split(tmp_path, a, 100.0, t)
    assert s["model"]["prefill_s"] + s["model"]["decode_s"] == pytest.approx(30.0, abs=0.3)
    assert s["tools_s"] == pytest.approx(5.0, abs=0.3)
    assert s["model"]["decode_tokens"] == 50


def test_the_wait_before_a_session_is_resumed_is_between_sessions(tmp_path):
    a, t = step(100.0, 10.0, reason="stop")
    b, t2 = step(t + 60.0, 10.0, reason="stop")           # the harness's 60 s wait, or a stop message sent after a finished step
    s = split(tmp_path, a + b, 100.0, t2)
    assert s["between_sessions_s"] == pytest.approx(60.0, abs=0.3)
    assert s["accounting"]["ok"], s["accounting"]["problems"]


def test_a_step_cut_off_by_a_dead_process_is_abandoned_and_the_gap_is_between_sessions(tmp_path):
    a, t = step(100.0, 10.0)
    cut = [ev(t + 0.05, "step_start")]                       # the process died here: no step_finish
    b, t2 = step(t + 70.0, 10.0, reason="stop")
    s = split(tmp_path, a + cut + b, 100.0, t2)
    assert s["accounting"]["abandoned_calls"] == 1
    assert s["between_sessions_s"] == pytest.approx(70.0 - 0.05, abs=0.3)
