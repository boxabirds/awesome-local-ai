"""conversation.py: a story's conversation profile, counted from its event log. No LLM.

MECE by what decides the answer, one section each:
  A. what the log holds      B. where events lie against the story's window    C. thinking and the largest block
  D. context growth          E. tool calls                                      F. signals and their thresholds
  G. the shape of the result                                                  H. the Claude client's log
Run: uv run --with pytest pytest test_conversation.py
"""
import json
from pathlib import Path

import pytest

import conversation as cv

T0, T1 = 1_000.0, 2_000.0


class Log:
    def __init__(self):
        self.events = []
        self.n = 0

    def call(self, at, thinking="", text="", tools=(), fresh=1000, cached=0, out=100):
        """An assistant message ending at `at`: thinking, text, and tool calls as (name, arguments)."""
        content = ([{"type": "thinking", "thinking": thinking}] if thinking else []) + ([{"type": "text", "text": text}] if text else [])
        content += [{"type": "toolCall", "name": n, "arguments": a} for n, a in tools]
        self.events.append({"_rx": at - 1, "type": "message_start", "message": {"role": "assistant"}})
        self.events.append({"_rx": at - 0.5, "type": "message_update"})
        self.events.append({"_rx": at, "type": "message_end", "message": {"role": "assistant", "content": content,
                            "usage": {"input": fresh, "cacheRead": cached, "output": out}}})
        return self

    def tool(self, start, end, name="bash", command="npm test", error=False):
        self.n += 1
        self.events.append({"_rx": start, "type": "tool_execution_start", "toolCallId": f"t{self.n}", "toolName": name, "args": {"command": command}})
        if end is not None:
            self.events.append({"_rx": end, "type": "tool_execution_end", "toolCallId": f"t{self.n}", "toolName": name, "isError": error})
        return self

    def user(self, at):
        self.events.append({"_rx": at, "type": "message_end", "message": {"role": "user", "content": "go"}})
        return self

    def write(self, tmp: Path, stamped=True) -> Path:
        p = tmp / "agent-events.jsonl"
        evs = sorted(self.events, key=lambda e: e["_rx"])
        if not stamped:
            evs = [{k: v for k, v in e.items() if k != "_rx"} for e in evs]
        p.write_text("".join(json.dumps(e) + "\n" for e in evs))
        return p


def prof(tmp, log, t_from=T0, t_to=T1, **kw):
    return cv.profile(log.write(tmp, **kw), t_from, t_to)


# ---------- A. what the log holds ----------

def test_A1_no_log_file_is_no_profile(tmp_path):
    assert cv.profile(tmp_path / "missing.jsonl", T0, T1) is None


def test_A2_a_log_with_no_model_calls_is_no_profile(tmp_path):
    assert prof(tmp_path, Log().user(T0 + 1)) is None


def test_A3_a_log_without_receive_stamps_cant_be_placed_in_time_so_no_profile(tmp_path):
    assert prof(tmp_path, Log().call(T0 + 10, thinking="x" * 50), stamped=False) is None


def test_A4_counts_calls_thinking_text_and_tool_arguments(tmp_path):
    log = Log().call(T0 + 10, thinking="a" * 100, text="b" * 7, tools=[("bash", {"command": "ls"})]).call(T0 + 20, thinking="c" * 50)
    p = prof(tmp_path, log)
    assert (p["calls"], p["tool_calls"], p["thinking_chars"], p["text_chars"]) == (2, 1, 150, 7)
    assert p["tool_arg_chars"] == len(json.dumps({"command": "ls"}))


def test_A5_user_messages_and_streamed_updates_are_not_calls(tmp_path):
    p = prof(tmp_path, Log().user(T0 + 5).call(T0 + 10).user(T0 + 15))
    assert p["calls"] == 1


def test_A6_a_line_cut_off_mid_write_is_skipped(tmp_path):
    f = Log().call(T0 + 10, thinking="x" * 10).write(tmp_path)
    with f.open("a") as h:
        h.write('{"_rx": 1500, "type": "message_end", "message": {"role": "assi')
    assert cv.profile(f, T0, T1)["calls"] == 1


# ---------- B. where events lie against the window ----------

@pytest.mark.parametrize("at,counted", [(T0 - 1, False), (T0, True), (T0 + 500, True), (T1, True), (T1 + 1, False)])
def test_B1_only_calls_ending_inside_the_window_count(tmp_path, at, counted):
    p = prof(tmp_path, Log().call(at, thinking="x" * 10).call(T0 + 100))
    assert p["calls"] == (2 if counted else 1)


def test_B2_an_earlier_attempt_of_the_story_is_left_out_entirely(tmp_path):
    log = Log().call(T0 - 500, thinking="z" * 90_000).tool(T0 - 400, T0 - 100).call(T0 + 10, thinking="a" * 10)
    p = prof(tmp_path, log)
    assert p["largest_thinking"]["chars"] == 10 and p["longest_tool"] is None


# ---------- C. thinking and the largest block ----------

def test_C1_medians_before_and_after_the_largest_block(tmp_path):
    log = Log()
    for i, n in enumerate([80, 90, 70, 64_000, 400, 500, 450]):
        log.call(T0 + 10 * (i + 1), thinking="t" * n)
    p = prof(tmp_path, log)
    assert p["largest_thinking"] == {"chars": 64_000, "call": 4, "at_s": 40.0}
    assert (p["thinking_median_before"], p["thinking_median_after"]) == (80, 450)
    assert p["thinking_median"] == 400


def test_C2_largest_first_has_nothing_before_largest_last_nothing_after(tmp_path):
    first = prof(tmp_path, Log().call(T0 + 1, thinking="x" * 9).call(T0 + 2, thinking="x" * 1))
    assert first["thinking_median_before"] is None and first["thinking_median_after"] == 1
    last = prof(tmp_path, Log().call(T0 + 1, thinking="x" * 1).call(T0 + 2, thinking="x" * 9))
    assert last["thinking_median_after"] is None and last["thinking_median_before"] == 1


def test_C3_ties_for_largest_take_the_first(tmp_path):
    p = prof(tmp_path, Log().call(T0 + 1, thinking="x" * 5).call(T0 + 2, thinking="x" * 5))
    assert p["largest_thinking"]["call"] == 1


def test_C4_no_thinking_at_all(tmp_path):
    p = prof(tmp_path, Log().call(T0 + 1, text="hi").call(T0 + 2, text="there"))
    assert p["largest_thinking"] is None and p["thinking_median"] == 0
    assert p["thinking_median_before"] is None and p["thinking_median_after"] is None


# ---------- D. context growth ----------

def test_D1_context_start_end_and_the_largest_jump(tmp_path):
    log = Log().call(T0 + 1, fresh=9_000).call(T0 + 2, fresh=500, cached=9_500).call(T0 + 3, fresh=16_000, cached=10_000).call(T0 + 4, fresh=100, cached=26_100)
    p = prof(tmp_path, log)
    assert (p["context_start"], p["context_end"]) == (9_000, 26_200)
    assert p["largest_context_jump"] == {"tokens": 16_000, "call": 3}


def test_D2_context_that_shrinks_after_a_compaction_is_not_a_jump(tmp_path):
    p = prof(tmp_path, Log().call(T0 + 1, fresh=50_000).call(T0 + 2, fresh=8_000))
    assert p["largest_context_jump"] is None


def test_D3_one_call_has_no_jump(tmp_path):
    p = prof(tmp_path, Log().call(T0 + 1, fresh=5_000))
    assert p["context_start"] == p["context_end"] == 5_000 and p["largest_context_jump"] is None


# ---------- E. tool calls ----------

def test_E1_tools_by_name_from_the_models_calls(tmp_path):
    log = Log().call(T0 + 1, tools=[("bash", {"command": "a"}), ("read", {"path": "x"})]).call(T0 + 2, tools=[("bash", {"command": "b"})])
    assert prof(tmp_path, log)["tools_by_name"] == {"bash": 2, "read": 1}


def test_E2_errors_are_tool_results_marked_as_errors(tmp_path):
    log = Log().call(T0 + 1).tool(T0 + 2, T0 + 3, error=True).tool(T0 + 4, T0 + 5).tool(T0 + 6, T0 + 7, error=True)
    assert prof(tmp_path, log)["tool_errors"] == 2


def test_E3_the_longest_tool_call_with_what_it_ran(tmp_path):
    log = Log().call(T0 + 1).tool(T0 + 2, T0 + 12, command="npm test").tool(T0 + 20, T0 + 700, command="npx wrangler dev")
    assert prof(tmp_path, log)["longest_tool"] == {"seconds": 680.0, "name": "bash", "gist": "npx wrangler dev"}


def test_E4_a_tool_that_never_ended_runs_to_the_windows_end(tmp_path):
    log = Log().call(T0 + 1).tool(T1 - 100, None, command="npm run dev")
    assert prof(tmp_path, log)["longest_tool"]["seconds"] == 100.0


def test_E5_a_long_gist_is_cut(tmp_path):
    log = Log().call(T0 + 1).tool(T0 + 2, T0 + 3, command="x" * 1000)
    assert len(prof(tmp_path, log)["longest_tool"]["gist"]) == cv.GIST_CHARS


# ---------- F. signals and their thresholds ----------

def test_F1_a_long_thinking_block_is_not_a_signal_on_its_own(tmp_path):
    """How long is long depends on the combination: the median largest block per story was 10.6k characters for
    gufo, 30.5k for Swift 1.5 and 38.9k for mlx-serve (v2, 30 Sep 2026). So thinking is judged against the same
    story in the combination's other runs (the benchmarker does that), never by a fixed size here."""
    p = prof(tmp_path, Log().call(T0 + 1, thinking="x" * 90_000))
    assert p["signals"] == [] and p["largest_thinking"]["chars"] == 90_000


@pytest.mark.parametrize("secs,signal", [(cv.HUNG_TOOL_S - 1, False), (cv.HUNG_TOOL_S, True)])
def test_F2_a_hung_command(tmp_path, secs, signal):
    p = prof(tmp_path, Log().call(T0 + 1).tool(T0 + 2, T0 + 2 + secs))
    assert ("hung-command" in p["signals"]) is signal


def test_F3_no_signals_on_an_ordinary_story(tmp_path):
    assert prof(tmp_path, Log().call(T0 + 1, thinking="x" * 100).tool(T0 + 2, T0 + 30))["signals"] == []


# ---------- G. the shape of the result ----------

def test_G1_keys_match_what_the_benchmarker_reads(tmp_path):
    p = prof(tmp_path, Log().call(T0 + 1, thinking="x"))
    assert set(p) == {"version", "calls", "tool_calls", "thinking_chars", "text_chars", "tool_arg_chars", "thinking_median",
                      "thinking_median_before", "thinking_median_after", "largest_thinking", "context_start", "context_end",
                      "largest_context_jump", "tools_by_name", "tool_errors", "longest_tool", "signals",
                      "thinking_visible", "thinking_estimated_tokens", "largest_thinking_estimated", "subagent_calls",
                      "thinking_tokens"}
    assert p["version"] == cv.VERSION
    json.dumps(p)


def test_G2_pi_shows_its_thinking_and_has_no_estimates(tmp_path):
    p = prof(tmp_path, Log().call(T0 + 1, thinking="xyz"))
    assert p["thinking_visible"] is True and p["thinking_chars"] == 3
    assert p["thinking_estimated_tokens"] is None and p["largest_thinking_estimated"] is None and p["subagent_calls"] == 0
    assert p["thinking_tokens"] is None


# ---------- H. the Claude client's log (stream-json: one event per content block, thinking text withheld) ----------

class ClaudeLog:
    """Claude Code's stream: each content block of a model message is its own "assistant" event under the
    message's id; thinking blocks arrive empty (the text is withheld), and while the model thinks the client
    streams running estimates of the thinking tokens (system/thinking_tokens), restarting with each message."""
    def __init__(self):
        self.events = []
        self.n = 0

    def call(self, at, thinking_est=(), text="", tools=(), fresh=2, cached=0, created=1000, parent=None):
        """A model message whose blocks arrive at `at`; thinking_est: the running estimates streamed before it;
        tools: (name, input) pairs. Returns the tool ids, for tool_result."""
        self.n += 1
        mid = f"msg_{self.n}"
        for i, est in enumerate(thinking_est):
            self.events.append({"_rx": at - len(thinking_est) + i, "type": "system", "subtype": "thinking_tokens",
                                "estimated_tokens": est, "estimated_tokens_delta": est})
        usage = {"input_tokens": fresh, "cache_read_input_tokens": cached, "cache_creation_input_tokens": created,
                 "output_tokens": 8}
        blocks = [{"type": "thinking", "thinking": "", "signature": "sig"}] + (
            [{"type": "text", "text": text}] if text else [])
        ids = []
        for name, inp in tools:
            ids.append(f"toolu_{self.n}_{len(ids)}")
            blocks.append({"type": "tool_use", "id": ids[-1], "name": name, "input": inp})
        for j, b in enumerate(blocks):
            self.events.append({"_rx": at + j * 0.01, "type": "assistant", "parent_tool_use_id": parent,
                                "message": {"id": mid, "role": "assistant", "content": [b], "usage": usage}})
        return ids

    def result(self, at, tool_id, error=False, parent=None):
        self.events.append({"_rx": at, "type": "user", "parent_tool_use_id": parent, "message": {"role": "user", "content": [
            {"type": "tool_result", "tool_use_id": tool_id, "content": "out", "is_error": error}]}})

    def finish(self, at, thinking_tokens):
        """The invocation's closing "result" event: its exact usage, thinking tokens included."""
        self.events.append({"_rx": at, "type": "result", "subtype": "success", "usage": {
            "output_tokens": thinking_tokens + 100, "output_tokens_details": {"thinking_tokens": thinking_tokens}}})

    write = Log.write


def test_H1_a_model_message_is_one_call_however_many_blocks_it_streams_in(tmp_path):
    log = ClaudeLog()
    a, b = log.call(T0 + 10, text="Now the code.", tools=[("Bash", {"command": "ls"}), ("Read", {"file_path": "/x"})])
    log.result(T0 + 11, a), log.result(T0 + 11, b)
    log.call(T0 + 20, text="done")
    p = prof(tmp_path, log)
    assert p["calls"] == 2 and p["tool_calls"] == 2 and p["tools_by_name"] == {"Bash": 1, "Read": 1}
    assert p["text_chars"] == len("Now the code.") + len("done")
    assert p["tool_arg_chars"] == len(json.dumps({"command": "ls"})) + len(json.dumps({"file_path": "/x"}))


def test_H2_withheld_thinking_is_not_visible_never_zero(tmp_path):
    log = ClaudeLog()
    log.call(T0 + 10, text="x")
    p = prof(tmp_path, log)
    assert p["thinking_visible"] is False
    assert p["thinking_chars"] is None and p["thinking_median"] is None and p["largest_thinking"] is None
    assert p["thinking_median_before"] is None and p["thinking_median_after"] is None


def test_H3_each_call_takes_the_last_estimate_streamed_before_it(tmp_path):
    log = ClaudeLog()
    log.call(T0 + 100, thinking_est=(50, 400, 2200), text="a")       # 2200 for this call
    log.call(T0 + 200, thinking_est=(50, 230), text="b")             # restarts: 230, not 2430
    log.call(T0 + 300, text="c")                                     # no estimate: none counted
    p = prof(tmp_path, log)
    assert p["thinking_estimated_tokens"] == 2430
    assert p["largest_thinking_estimated"] == {"tokens": 2200, "call": 1, "at_s": 100.0}


def test_H4_no_estimates_at_all_is_none_not_zero(tmp_path):
    log = ClaudeLog()
    log.call(T0 + 10, text="a")
    p = prof(tmp_path, log)
    assert p["thinking_estimated_tokens"] is None and p["largest_thinking_estimated"] is None


def test_H5_context_is_fresh_plus_cached_plus_newly_cached_input(tmp_path):
    log = ClaudeLog()
    log.call(T0 + 10, fresh=2, cached=100, created=900)
    log.call(T0 + 20, fresh=3, cached=1000, created=5000)
    p = prof(tmp_path, log)
    assert p["context_start"] == 1002 and p["context_end"] == 6003
    assert p["largest_context_jump"] == {"tokens": 5001, "call": 2}


def test_H6_tool_time_runs_from_the_call_to_its_result_and_errors_are_counted(tmp_path):
    log = ClaudeLog()
    (quick,) = log.call(T0 + 10, tools=[("Bash", {"command": "ls"})])
    log.result(T0 + 11, quick)
    (slow,) = log.call(T0 + 20, tools=[("Bash", {"command": "npx playwright test"})])
    log.result(T0 + 320, slow, error=True)
    (never,) = log.call(T0 + 400, tools=[("Read", {"file_path": "/a"})])
    p = prof(tmp_path, log, t_to=T0 + 450)
    assert p["tool_errors"] == 1
    assert p["longest_tool"] == {"seconds": 300.0, "name": "Bash", "gist": "npx playwright test"}


def test_H7_a_subagent_s_messages_are_not_the_agent_s_calls(tmp_path):
    log = ClaudeLog()
    (task,) = log.call(T0 + 10, tools=[("Task", {"description": "look"})])
    log.call(T0 + 20, text="sub", parent=task)
    log.call(T0 + 30, text="sub", parent=task)
    log.result(T0 + 40, task)
    log.call(T0 + 50, text="main")
    p = prof(tmp_path, log)
    assert p["calls"] == 2 and p["subagent_calls"] == 2 and p["text_chars"] == len("main")


def test_H8_only_messages_inside_the_window_count(tmp_path):
    log = ClaudeLog()
    log.call(T0 - 5, text="before")
    log.call(T0 + 5, thinking_est=(50, 300), text="in")
    log.call(T1 + 5, text="after")
    p = prof(tmp_path, log)
    assert p["calls"] == 1 and p["text_chars"] == 2 and p["thinking_estimated_tokens"] == 300


def test_H8_exact_thinking_tokens_are_the_sum_of_each_invocation_s_result_inside_the_window(tmp_path):
    # Real logs (Sonnet 5.5 v2-r1 story 9): a story resumed after a nudge has one result per invocation, each
    # its own total, not cumulative: 15,719 then 0, 0, ... So the story's thinking is their sum, in its window.
    log = ClaudeLog()
    log.call(T0 + 10, thinking_est=(50, 1200), text="a")
    log.finish(T0 + 20, 7986)
    log.call(T0 + 30, text="b")
    log.finish(T0 + 40, 14)
    log.finish(T0 - 5, 99999)                      # an earlier attempt's result: outside the window
    p = prof(tmp_path, log)
    assert p["thinking_tokens"] == 8000
    assert p["thinking_estimated_tokens"] == 1200   # the client's running estimate stays as it was


def test_H9_no_result_event_is_none_not_zero(tmp_path):
    log = ClaudeLog()
    log.call(T0 + 10, text="a")
    assert prof(tmp_path, log)["thinking_tokens"] is None


def test_H10_no_per_call_figures_are_made_from_the_client_s_estimates(tmp_path):
    # 1 Oct 2026: medians made from Claude Code's running estimates ran 13-28% high against the exact totals, and
    # 14-23% of the calls that thought had no estimate at all (and were counted as 0). Only exact figures are kept.
    log = ClaudeLog()
    log.call(T0 + 10, thinking_est=(100,), text="a")
    log.call(T0 + 20, text="b")
    p = prof(tmp_path, log)
    assert "thinking_estimated_median_before" not in p and "thinking_estimated_median_after" not in p

