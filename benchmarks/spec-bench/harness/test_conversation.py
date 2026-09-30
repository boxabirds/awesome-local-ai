"""conversation.py: a story's conversation profile, counted from its event log. No LLM.

MECE by what decides the answer, one section each:
  A. what the log holds      B. where events lie against the story's window    C. thinking and the largest block
  D. context growth          E. tool calls                                      F. signals and their thresholds
  G. the shape of the result
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
                      "largest_context_jump", "tools_by_name", "tool_errors", "longest_tool", "signals"}
    assert p["version"] == cv.VERSION
    json.dumps(p)
