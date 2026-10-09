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


def gufo_lines(calls_tokens, ttft_ms=1500.0):
    """What gufo's server logs for each finished request: the prompt and generated tokens (how a request is matched to the agent's call)
    and ttft_ms, the time to the first token generated, i.e. the time spent reading the prompt."""
    out = [f"=== server start {NOW0 - 100} ==="]
    for i, (prompt, gen) in enumerate(calls_tokens):
        out.append(f"2026-10-08 23:07:17 [INFO] [http] request=r{i} event=completed method=POST path=/v1/chat/completions status=200 duration_ms=9999.0 "
                   f"outcome=completed prompt_tokens={prompt} prefill_tokens={prompt} generated_tokens={gen} finish=stop cache=miss cached_tokens=0 ttft_ms={ttft_ms}")
    return "\n".join(out) + "\n"


NOW0 = 1791500000.0


def test_with_the_server_log_an_opencode_stories_model_time_is_split_into_reading_and_writing_by_its_ttft(tmp_path):
    """9 Oct 2026, the owner: an OpenCode story's time bar was one 'Model, not split' block. OpenCode's own events carry no first-token
    time, but gufo's server logs, for each request, the time to its first token (ttft_ms); the request is matched to the agent's step
    by its token counts, as the draft figures already are."""
    lines = FIXTURE.read_text().splitlines(keepends=True)
    events = [json.loads(l) for l in lines]
    calls = [(e["part"]["tokens"]["input"] + e["part"]["tokens"]["cache"]["read"], e["part"]["tokens"]["output"]) for e in events if e["type"] == "step_finish"]
    (tmp_path / "events.jsonl").write_text("".join(lines))
    (tmp_path / "server.log").write_text(gufo_lines(calls, ttft_ms=1500.0))
    s = accounting.time_split(tmp_path / "events.jsonl", tmp_path / "server.log", events[0]["_rx"], events[-1]["_rx"] + 0.1)
    m = s["model"]
    assert s["accounting"]["ok"], s["accounting"]["problems"]
    assert m["prefill_s"] == pytest.approx(6 * 1.5, abs=0.3), "each step's reading time is its request's ttft"
    assert m["decode_s"] > 0 and m["prefill_s"] + m["decode_s"] == pytest.approx(
        sum(c.end - c.sent for c in accounting.parse(tmp_path / "events.jsonl", 1e12).calls), abs=0.5), "the model's time is the same, now divided"
    assert m["prefill_tok_s"] is not None and m["decode_tok_s"] is not None, "with measured times there are rates"
    assert m["prefill_tok_s"] == pytest.approx(sum(f for f in (7692, 3057, 12019, 398, 14402, 54)) / (6 * 1.5), rel=0.05)


def test_a_server_log_that_has_no_request_for_a_step_leaves_that_step_unsplit(tmp_path):
    a, t = step(100.0, 30.0, tool="bash", tool_s=5.0)
    (tmp_path / "events.jsonl").write_text("".join(a))
    (tmp_path / "server.log").write_text(gufo_lines([(99999, 7)]))      # a request that is not this step's
    s = accounting.time_split(tmp_path / "events.jsonl", tmp_path / "server.log", 100.0, t)
    assert s["model"]["prefill_s"] == 0.0 and s["model"]["prefill_tok_s"] is None
