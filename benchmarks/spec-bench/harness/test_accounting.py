"""accounting.py: where a story's wall time went, as a partition of its window, and the checks recorded with it.

The cases are MECE along the dimensions that decide the answer, one section each:
  A. what is in the log      B. where it lies against the window    C. how parts overlap
  D. how starts and ends pair   E. where model time comes from       F. how a model call streamed
  G. the recorded checks     H. the shape of the result            I. any log at all (property)
  J. the Claude client's log (stream-json)
Run: uv run --with pytest --with hypothesis pytest test_accounting.py
"""
import json
from pathlib import Path

import pytest
from hypothesis import given, settings, strategies as st

import accounting
import llama_log

T0 = 1_000.0          # window start
T1 = 1_100.0          # window end: a 100 s story
WALL = T1 - T0


class Log:
    """A pi event log built in time order: tool calls, compactions, model calls (streamed or not)."""

    def __init__(self):
        self.events: list[dict] = []
        self.n = 0

    def tool(self, start, end=None, cmd="npm run test:unit", name="bash", tid=None):
        self.n += 1
        tid = tid or f"t{self.n}"
        self.events.append({"_rx": start, "type": "tool_execution_start", "toolCallId": tid, "toolName": name, "args": {"command": cmd}})
        if end is not None:
            self.events.append({"_rx": end, "type": "tool_execution_end", "toolCallId": tid, "toolName": name})
        return self

    def tool_end_only(self, end, tid="orphan"):
        self.events.append({"_rx": end, "type": "tool_execution_end", "toolCallId": tid, "toolName": "bash"})
        return self

    def compaction(self, start, end=None):
        self.events.append({"_rx": start, "type": "compaction_start"})
        if end is not None:
            self.events.append({"_rx": end, "type": "compaction_end"})
        return self

    def call(self, sent, first, end, fresh=1000, out=100, cached=0, ended=True):
        """A model call: request sent, first streamed chunk (None: nothing streamed), end."""
        self.events.append({"_rx": sent, "type": "message_start", "message": {"role": "assistant"}})
        if first is not None:
            self.events.append({"_rx": first, "type": "message_update", "assistantMessageEvent": {"type": "text_start"}})
            later = (first + end) / 2 if end is not None else first + 1
            self.events.append({"_rx": later, "type": "message_update", "assistantMessageEvent": {"type": "text_delta"}})
        if ended:
            self.events.append({"_rx": end, "type": "message_end", "message": {"role": "assistant", "usage": {"input": fresh, "cacheRead": cached, "output": out}}})
        return self

    def restart(self, settled, next_session):
        """The agent's session ended at settled; the harness started the next one at next_session."""
        self.events.append({"_rx": settled, "type": "agent_settled"})
        self.events.append({"_rx": next_session, "type": "session", "id": "s"})
        self.events.append({"_rx": next_session, "type": "agent_start"})
        return self

    def harness_restart(self, at, attempt=2):
        """The harness itself restarted the story at `at` (attempts.restart_mark) and started the agent again."""
        self.events.append({"_rx": at, "type": "harness_attempt", "attempt": attempt})
        self.events.append({"_rx": at + 0.2, "type": "session", "id": "s"})
        self.events.append({"_rx": at + 0.2, "type": "agent_start"})
        return self

    def user(self, at):
        self.events.append({"_rx": at, "type": "message_start", "message": {"role": "user"}})
        self.events.append({"_rx": at, "type": "message_end", "message": {"role": "user"}})
        return self

    def write(self, tmp_path: Path) -> Path:
        p = tmp_path / "agent-events.jsonl"
        p.write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in sorted(self.events, key=lambda e: e["_rx"])))
        return p


def split(tmp_path, log: Log, server_log: str | None = None, t_from=T0, t_to=T1) -> dict:
    sl = tmp_path / "server.log"
    if server_log is not None:
        sl.write_text(server_log)
    return accounting.time_split(log.write(tmp_path), sl, t_from, t_to)


def parts(s: dict) -> dict:
    m = s["model"] or {}
    return {"prefill": m.get("prefill_s", 0.0), "decode": m.get("decode_s", 0.0), "tools": s["tools_s"],
            "compaction": s["compaction_s"], "between_sessions": s["between_sessions_s"], "other": s["other_s"]}


def llama(requests: list[tuple[float, float, int, float, int]]) -> str:
    """llama-server log lines for requests (end epoch, prompt ms, prompt tokens, gen ms, gen tokens)."""
    base = T0 - 10
    out = llama_log.start_marker(base)
    for i, (end, pms, pn, gms, gn) in enumerate(requests):
        s = end - base
        us = int(round(s * 1_000_000))   # llama-server stamps: minutes.seconds.milliseconds.microseconds since start
        stamp = f"{us // 60_000_000}.{us // 1_000_000 % 60:02d}.{us // 1000 % 1000:03d}.{us % 1000:03d}"
        out += (f"{stamp} I slot print_timing: id  0 | task {i} | prompt eval time = {pms:8.2f} ms / {pn:5d} tokens (x)\n"
                f"{stamp} I slot print_timing: id  0 | task {i} |        eval time = {gms:8.2f} ms / {gn:5d} tokens (x)\n")
    return out


# ---------- A. what is in the log ----------

def test_A1_an_empty_log_is_all_other(tmp_path):
    s = split(tmp_path, Log())
    assert parts(s) == {"prefill": 0.0, "decode": 0.0, "tools": 0.0, "compaction": 0.0, "between_sessions": 0.0, "other": WALL}
    assert s["model"] is None and s["accounting"]["ok"]


def test_A2_model_calls_only(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 20).call(T0 + 30, T0 + 31, T0 + 35))
    assert parts(s) == {"prefill": 3.0, "decode": 12.0, "tools": 0.0, "compaction": 0.0, "between_sessions": 0.0, "other": 85.0}


def test_A3_tool_calls_only_by_kind(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 5, T0 + 15, "npx playwright test").tool(T0 + 20, T0 + 23, "npm run build").tool(T0 + 30, T0 + 31, name="read"))
    assert s["tools_s"] == 14.0 and s["tools_by_kind"] == {"e2e": 10.0, "build": 3.0, "read": 1.0}
    assert s["other_s"] == 86.0


def test_A4_compactions_only(tmp_path):
    s = split(tmp_path, Log().compaction(T0 + 10, T0 + 40))
    assert s["compaction_s"] == 30.0 and s["compactions"] == 1 and s["other_s"] == 70.0


def test_A5_everything_apart(tmp_path):
    log = Log().call(T0 + 0, T0 + 2, T0 + 10).tool(T0 + 11, T0 + 21).compaction(T0 + 30, T0 + 50).call(T0 + 60, T0 + 61, T0 + 70)
    assert parts(split(tmp_path, log)) == {"prefill": 3.0, "decode": 17.0, "tools": 10.0, "compaction": 20.0, "between_sessions": 0.0, "other": 50.0}


def test_A6_the_harness_waiting_to_restart_the_agent_is_its_own_part(tmp_path):
    s = split(tmp_path, Log().call(T0 + 0, T0 + 2, T0 + 10).restart(T0 + 10, T0 + 70).call(T0 + 71, T0 + 72, T0 + 80))
    assert parts(s) == {"prefill": 3.0, "decode": 16.0, "tools": 0.0, "compaction": 0.0, "between_sessions": 60.0, "other": 21.0}


def test_A7_a_restart_from_an_earlier_attempt_of_the_story_is_outside_the_window(tmp_path):
    s = split(tmp_path, Log().restart(T0 - 100, T0 - 40).restart(T0 + 90, T0 + 130))
    assert s["between_sessions_s"] == 10.0 and s["other_s"] == 90.0


# ---------- B. where it lies against the window ----------

@pytest.mark.parametrize("start,end,inside", [
    (T0 - 50, T0 - 10, 0.0),     # entirely before (an earlier attempt of the story)
    (T0 - 10, T0 + 10, 10.0),    # across the start
    (T0 + 20, T0 + 30, 10.0),    # inside
    (T1 - 10, T1 + 10, 10.0),    # across the end
    (T1 + 10, T1 + 20, 0.0),     # entirely after
    (T0 - 10, T1 + 10, WALL),    # around the whole window
])
def test_B1_a_tool_call_counts_only_inside_the_window(tmp_path, start, end, inside):
    assert split(tmp_path, Log().tool(start, end))["tools_s"] == inside


def test_B2_a_model_call_from_an_earlier_attempt_counts_neither_time_nor_tokens(tmp_path):
    s = split(tmp_path, Log().call(T0 - 60, T0 - 55, T0 - 40, out=999).call(T0 + 10, T0 + 12, T0 + 20, out=100))
    assert s["model"]["requests"] == 1 and s["model"]["decode_tokens"] == 100 and s["model"]["decode_s"] == 8.0


def test_B3_a_model_call_across_the_window_start_counts_its_part_inside_but_not_its_tokens(tmp_path):
    s = split(tmp_path, Log().call(T0 - 5, T0 - 1, T0 + 5))
    assert s["model"]["decode_s"] == 5.0 and s["model"]["prefill_s"] == 0.0
    assert s["model"]["requests"] == 0        # its tokens belong to a call that began before the story


def test_B4_an_empty_or_reversed_window(tmp_path):
    s = split(tmp_path, Log().tool(T0, T0 + 5), t_from=T0, t_to=T0)
    assert parts(s) == {"prefill": 0.0, "decode": 0.0, "tools": 0.0, "compaction": 0.0, "between_sessions": 0.0, "other": 0.0}
    r = split(tmp_path, Log(), t_from=T1, t_to=T0)
    assert r["wall_s"] == 0.0 and not r["accounting"]["ok"]


# ---------- C. how parts overlap: one owner per second, compaction > tool > prefill > decode > between sessions ----------

def test_C1_tool_over_model_the_tool_owns_the_overlap(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 30).tool(T0 + 20, T0 + 25))
    assert parts(s) == {"prefill": 2.0, "decode": 13.0, "tools": 5.0, "compaction": 0.0, "between_sessions": 0.0, "other": 80.0}


def test_C2_compaction_over_its_own_model_call_owns_the_time_and_the_call_is_not_counted(tmp_path):
    s = split(tmp_path, Log().compaction(T0 + 10, T0 + 30).call(T0 + 11, T0 + 12, T0 + 29, out=500).call(T0 + 40, T0 + 41, T0 + 45, out=50))
    assert s["compaction_s"] == 20.0 and s["model"]["requests"] == 1 and s["model"]["decode_tokens"] == 50


def test_C3_compaction_over_a_tool(tmp_path):
    s = split(tmp_path, Log().compaction(T0 + 10, T0 + 20).tool(T0 + 15, T0 + 25))
    assert s["compaction_s"] == 10.0 and s["tools_s"] == 5.0


def test_C4_tools_of_one_kind_overlapping_count_once(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 10, T0 + 20, tid="a").tool(T0 + 15, T0 + 30, tid="b"))
    assert s["tools_s"] == 20.0 and s["tools_by_kind"] == {"unit": 20.0}


def test_C5_tools_of_different_kinds_overlapping_the_earlier_started_owns(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 10, T0 + 20, "npx playwright test", tid="a").tool(T0 + 15, T0 + 30, "npm run build", tid="b"))
    assert s["tools_s"] == 20.0 and s["tools_by_kind"] == {"e2e": 10.0, "build": 10.0}


def test_C6_concurrent_model_requests_count_their_time_once(tmp_path):
    reqs = [(T0 + 20, 5000, 500, 5000, 50), (T0 + 20, 5000, 500, 5000, 50)]   # two requests over the same 10 s
    s = split(tmp_path, Log(), server_log=llama(reqs))
    assert s["model"]["prefill_s"] + s["model"]["decode_s"] == 10.0
    assert s["model"]["decode_tokens"] == 100            # tokens still add up


# ---------- D. how starts and ends pair ----------

def test_D1_a_tool_end_without_a_start_is_ignored_and_reported(tmp_path):
    s = split(tmp_path, Log().tool_end_only(T0 + 10))
    assert s["tools_s"] == 0.0 and any("ended without starting" in p for p in s["accounting"]["problems"])


def interrupted(s: dict) -> list[tuple]:
    return [(t["kind"], t["seconds"], t["ended_by"]) for t in s["accounting"]["interrupted_tools"]]


def test_D2_a_tool_that_never_ended_runs_to_the_agents_next_step_and_is_noted_not_a_problem(tmp_path):
    """A tool call the hang guard, the swap guard, a session's end or a harness restart cut off has no end event.
    Its end is known well enough (what the agent did next), so it is counted and listed, and the checks pass."""
    s = split(tmp_path, Log().tool(T0 + 10).call(T0 + 40, T0 + 41, T0 + 50))
    assert s["tools_s"] == 30.0
    assert s["accounting"]["ok"] is True and s["accounting"]["problems"] == []
    assert interrupted(s) == [("unit", 30.0, accounting.ENDED_BY_STEP)]


def test_D3_a_tool_that_never_ended_with_nothing_after_it_runs_to_the_window_end(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 90))
    assert s["tools_s"] == 10.0 and s["accounting"]["ok"] is True
    assert interrupted(s) == [("unit", 10.0, accounting.ENDED_BY_WINDOW)]


def test_D4_a_compaction_that_never_ended_runs_to_the_window_end_and_is_noted_not_a_problem(tmp_path):
    s = split(tmp_path, Log().compaction(T0 + 80))
    assert s["compaction_s"] == 20.0 and s["compactions"] == 1
    assert s["accounting"]["ok"] is True and s["accounting"]["interrupted_compactions"] == 1


def test_D5_a_model_call_cut_off_before_it_ended_is_counted_as_abandoned_not_as_a_call(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, None, ended=False).call(T0 + 50, T0 + 51, T0 + 60))
    assert s["model"]["requests"] == 1 and s["accounting"]["abandoned_calls"] == 1


def test_D7_a_tool_that_never_ended_stopped_when_its_session_ended(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 10).restart(T0 + 20, T0 + 80).call(T0 + 85, T0 + 86, T0 + 90))
    assert s["tools_s"] == 10.0 and s["between_sessions_s"] == 60.0
    assert interrupted(s) == [("unit", 10.0, accounting.ENDED_BY_SESSION_END)] and s["accounting"]["ok"] is True


# mlx-serve v2-r2 stories 9 and 11 (1 Oct 2026): the harness was restarted while the agent's tool call ran. The call
# is the last event of the first attempt; the log goes on with the restart's mark and the agent's next session.
RESTART_AT = T0 + 50
ATTEMPT_1, ATTEMPT_2 = (T0, T0 + 30), (RESTART_AT, T1)


def restarted_mid_tool() -> Log:
    return (Log().call(T0 + 1, T0 + 2, T0 + 30).tool(T0 + 30, cmd="npx playwright test", tid="call_1")
            .harness_restart(RESTART_AT).user(RESTART_AT + 0.3).call(RESTART_AT + 5, RESTART_AT + 6, RESTART_AT + 20))


def test_D8_a_tool_cut_off_by_a_harness_restart_ended_there_and_owns_nothing_of_the_next_attempt(tmp_path):
    """The call was closed at the next attempt's first model call, so it owned the seconds from the restart to
    that call (5 s here) as tool time of an attempt it never ran in."""
    s = split(tmp_path, restarted_mid_tool(), t_from=ATTEMPT_2[0], t_to=ATTEMPT_2[1])
    assert s["tools_s"] == 0.0 and s["tools_by_kind"] == {}
    assert s["accounting"]["interrupted_tools"] == [] and s["accounting"]["ok"] is True


def test_D9_a_tool_cut_off_by_a_harness_restart_is_listed_once_in_the_attempt_it_started_in(tmp_path):
    s = split(tmp_path, restarted_mid_tool(), t_from=ATTEMPT_1[0], t_to=ATTEMPT_1[1])
    assert interrupted(s) == [("e2e", 0.0, accounting.ENDED_BY_RESTART)] and s["accounting"]["ok"] is True


def new_session(log: Log, at: float) -> Log:
    """A session starting with none ended before it: the agent's process died, and the harness started another."""
    log.events += [{"_rx": at, "type": "session", "id": "s"}, {"_rx": at, "type": "agent_start"}]
    return log


def test_D10_a_tool_whose_process_died_ended_when_the_process_was_last_heard_from(tmp_path):
    """A restart from before the harness marked them (canvas-gufo-r3 story 5), or a crash the harness resumed
    after its 60 s wait: the tool is over by the next session's start, and ran at most until the dead process's
    last line (here the tool's own output at 25 s)."""
    log = Log().tool(T0 + 10)
    log.events.append({"_rx": T0 + 25, "type": "tool_execution_update", "toolCallId": "t1", "partialResult": "x"})
    s = split(tmp_path, new_session(log, T0 + 85).call(T0 + 90, T0 + 91, T0 + 95))
    assert s["tools_s"] == 15.0 and interrupted(s) == [("unit", 15.0, accounting.ENDED_BY_NEW_SESSION)]


def test_D13_the_wait_after_a_session_that_died_without_ending_is_between_sessions(tmp_path):
    """The agent's clock stopped when its process died; the harness waited, then resumed it. Counted as other, the
    wait made the wall longer than the agent's clock and failed the check."""
    log = new_session(Log(), T0).call(T0 + 1, T0 + 2, T0 + 20)
    s = split(tmp_path, new_session(log, T0 + 80).call(T0 + 81, T0 + 82, T1))
    assert s["between_sessions_s"] == 60.0
    assert accounting.check(s, agent_seconds=WALL - 60) == []


def test_D14_the_gap_while_the_harness_itself_was_down_is_not_between_sessions(tmp_path):
    log = new_session(Log(), T0).call(T0 + 1, T0 + 2, T0 + 20).harness_restart(T0 + 80).call(T0 + 81, T0 + 82, T1)
    assert split(tmp_path, log)["between_sessions_s"] == 0.0


def test_D11_a_compaction_cut_off_by_a_restart_owns_nothing_of_the_next_attempt(tmp_path):
    """It was closed at the window's end, whichever window: the whole next attempt would have been compaction."""
    log = Log().compaction(T0 + 20).call(T0 + 21, T0 + 25, None, ended=False)      # its own model call, last heard at 26
    log = log.harness_restart(RESTART_AT).call(RESTART_AT + 5, RESTART_AT + 6, RESTART_AT + 20)
    later = split(tmp_path, log, t_from=ATTEMPT_2[0], t_to=ATTEMPT_2[1])
    assert later["compaction_s"] == 0.0 and later["compactions"] == 0 and later["accounting"]["interrupted_compactions"] == 0
    assert later["model"]["requests"] == 1 and later["model"]["decode_s"] == 14.0
    first = split(tmp_path, log, t_from=ATTEMPT_1[0], t_to=ATTEMPT_1[1])
    assert first["compaction_s"] == 6.0 and first["accounting"]["interrupted_compactions"] == 1 and first["accounting"]["ok"]


def test_D12_a_tool_call_id_started_again_ends_the_call_before_it(tmp_path):
    """The second start replaced the first, whose time was lost without a word."""
    s = split(tmp_path, Log().tool(T0 + 10, tid="same").tool(T0 + 30, T0 + 35, tid="same"))
    assert s["tools_s"] == 25.0 and interrupted(s) == [("unit", 20.0, accounting.ENDED_BY_STEP)]


def test_D6_user_and_system_messages_are_not_model_calls(tmp_path):
    s = split(tmp_path, Log().user(T0 + 5).call(T0 + 10, T0 + 11, T0 + 15))
    assert s["model"]["requests"] == 1


# ---------- E. where model time comes from ----------

def test_E1_the_servers_log_when_it_has_requests_in_the_window(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 11, T0 + 20), server_log=llama([(T0 + 20, 2000, 400, 7000, 70)]))
    assert s["model"]["source"] == "llama-log"
    assert (s["model"]["prefill_s"], s["model"]["decode_s"], s["model"]["decode_tokens"]) == (2.0, 7.0, 70)


def test_E2_the_clients_stream_when_the_servers_log_has_nothing_in_the_window(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 20), server_log=llama([(T0 - 50, 1000, 1, 1000, 1)]))
    assert s["model"]["source"] == "client-stream"


def test_E3_the_clients_stream_when_there_is_no_server_log(tmp_path):
    assert split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 20))["model"]["source"] == "client-stream"


def test_E4_no_model_time_at_all_for_a_log_in_no_format_the_harness_reads(tmp_path):
    p = tmp_path / "agent-events.jsonl"
    p.write_text(json.dumps({"_rx": T0 + 5, "type": "turn", "text": "hello"}) + "\n")
    s = accounting.time_split(p, tmp_path / "none.log", T0, T1)
    assert s["model"] is None and s["other_s"] == WALL


# ---------- F. how a model call streamed ----------

def test_F1_nothing_streamed_before_the_end_is_all_prefill(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, None, T0 + 20))
    assert (s["model"]["prefill_s"], s["model"]["decode_s"]) == (10.0, 0.0)


def test_F2_rates_come_from_the_calls_own_durations_even_when_a_tool_owns_part_of_them(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 30, fresh=2000, out=180).tool(T0 + 20, T0 + 25))
    assert s["model"]["decode_s"] == 13.0                      # owned time
    assert s["model"]["decode_tok_s"] == 10.0                  # 180 tokens over the call's own 18 s
    assert s["model"]["prefill_tok_s"] == 1000.0


def test_F3_cached_input_is_reported_but_not_counted_as_prefill_tokens(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 20, fresh=100, cached=9000))
    assert s["model"]["prefill_tokens"] == 100 and s["model"]["cached_tokens"] == 9000


# ---------- G. the recorded checks ----------

def test_G1_a_consistent_split_passes(tmp_path):
    assert split(tmp_path, Log().call(T0 + 1, T0 + 2, T0 + 3).tool(T0 + 4, T0 + 5))["accounting"] == {
        "version": accounting.VERSION, "ok": True, "problems": [], "abandoned_calls": 0, "interrupted_tools": [],
        "interrupted_compactions": 0}


@pytest.mark.parametrize("damage,expected", [
    (lambda s: s.update(other_s=-1.0), "negative"),
    (lambda s: s.update(tools_s=s["tools_s"] + 5), "sum to"),
    (lambda s: s["tools_by_kind"].update(unit=99.0), "by kind"),
    (lambda s: s.update(wall_s=s["wall_s"] + 1), "sum to"),
])
def test_G2_each_broken_invariant_is_named(tmp_path, damage, expected):
    s = split(tmp_path, Log().tool(T0 + 4, T0 + 6))
    damage(s)
    assert any(expected in p for p in accounting.check(s))


def test_G3_reconciles_with_the_agents_own_clock_when_given(tmp_path):
    s = split(tmp_path, Log())
    assert accounting.check(s, agent_seconds=WALL) == []
    assert any("agent's own clock" in p for p in accounting.check(s, agent_seconds=WALL * 2))


def test_G4_the_agents_clock_leaves_out_the_waits_between_its_sessions(tmp_path):
    s = split(tmp_path, Log().restart(T0 + 10, T0 + 70))
    assert accounting.check(s, agent_seconds=WALL - 60) == []
    assert any("agent's own clock" in p for p in accounting.check(s, agent_seconds=WALL))


def test_G6_the_clock_check_says_which_way_it_failed_and_what_that_means(tmp_path):
    s = split(tmp_path, Log())
    (over,) = accounting.check(s, agent_seconds=WALL + 20)
    assert "20.0 s more than the wall" in over and "counted twice" in over
    (under,) = accounting.check(s, agent_seconds=WALL - 20)
    assert "20.0 s longer than the agent's own clock" in under and "suspended" in under and "missing" in under


@pytest.mark.parametrize("damage,expected", [
    (lambda s: s.update(suspended_s=-1.0), "negative"),
    (lambda s: s.update(suspended_s=s["wall_s"] + 5), "suspended"),
])
def test_G7_time_suspended_is_inside_the_wall(tmp_path, damage, expected):
    s = split(tmp_path, Log())
    damage(s)
    assert any(expected in p for p in accounting.check(s))


# The tool calls of a real attempt (the MTPLX canvas-pi-03 story 9, before its harness restart): seven quick reads,
# 54 ms in all, of two kinds. Tools round to 0.1 s; each kind rounds to 0.0 s and was dropped from tools_by_kind, so
# the check counted no kinds, allowed one rounding step, and reported a broken invariant in a consistent split.
QUICK_TOOLS = [(2.327, 0.009, "pwd && ls -la"), (4.479, 0.004, "cat spec/stories/009/prd.md"), (7.193, 0.014, "cat spec/stories/009/design.md"),
               (13.235, 0.005, "cat spec/stories/009/tasks.md"), (18.205, 0.010, "cat package.json && cat playwright.config.ts"),
               (21.468, 0.008, "find src tests scripts -type f | sort"), (23.981, 0.004, "cat src/shared/board-model.ts")]


def test_G5_kinds_that_each_round_to_nothing_are_kept_so_the_check_can_allow_for_them(tmp_path):
    log = Log()
    for at, took, cmd in QUICK_TOOLS:
        log.tool(T0 + at, T0 + at + took, cmd)
    s = split(tmp_path, log)
    assert s["accounting"]["problems"] == [] and accounting.check(s) == []
    assert s["tools_s"] == 0.1 and s["tools_by_kind"] == {"bash": 0.0, "e2e": 0.0}


# ---------- H. the shape of the result ----------

def test_H1_keys_units_and_rounding_match_what_the_records_and_the_page_read(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10.04, T0 + 12.06, T0 + 20.11).tool(T0 + 30.01, T0 + 31.02, "npx playwright test"))
    assert set(s) == {"wall_s", "model", "tools_s", "tools_by_kind", "compaction_s", "compactions", "between_sessions_s", "other_s", "suspended_s", "accounting"}
    assert set(s["model"]) >= {"source", "requests", "prefill_s", "prefill_tokens", "prefill_tok_s", "decode_s", "decode_tokens", "decode_tok_s", "cached_tokens"}
    for v in (s["wall_s"], s["tools_s"], s["other_s"], s["model"]["prefill_s"], s["model"]["decode_s"]):
        assert round(v, 1) == v


# ---------- I. any log at all: the invariants hold by construction ----------

spans = st.tuples(st.floats(T0 - 50, T1 + 50), st.floats(0, 60))


@settings(max_examples=150, deadline=None)
@given(tools=st.lists(spans, max_size=6), comps=st.lists(spans, max_size=3), calls=st.lists(st.tuples(st.floats(T0 - 50, T1 + 50), st.floats(0, 10), st.floats(0, 30)), max_size=6),
       restarts=st.lists(spans, max_size=3))
def test_I1_parts_never_negative_never_overlap_and_always_sum_to_the_wall(tmp_path_factory, tools, comps, calls, restarts):
    tmp = tmp_path_factory.mktemp("prop")
    log = Log()
    for a, d in tools:
        log.tool(a, a + d)
    for a, d in comps:
        log.compaction(a, a + d)
    for a, pre, dec in calls:
        log.call(a, a + pre, a + pre + dec)
    for a, d in restarts:
        log.restart(a, a + d)
    s = split(tmp, log)
    p = parts(s)
    assert all(v >= 0 for v in p.values())
    assert abs(sum(p.values()) - WALL) <= accounting.TOLERANCE_S
    assert s["accounting"]["ok"] or all("ended without" in x for x in s["accounting"]["problems"])



# ---------- J. the Claude client's log (stream-json) ----------

class ClaudeLog:
    """Claude Code's stream: a session starts with system/init and ends with a result; each content block of a model
    message is its own "assistant" event under the message's id, sent when the block is complete; while the model
    thinks, system/thinking_tokens events stream estimates; a tool's result comes back in a "user" event."""

    def __init__(self):
        self.events: list[dict] = []
        self.n = 0

    def init(self, at):
        self.events.append({"_rx": at, "type": "system", "subtype": "init", "session_id": "s"})
        return self

    def result(self, at, duration_s=None):
        """duration_s: the session's length by Claude Code's own clock (duration_ms), which stops while the machine sleeps."""
        own = {} if duration_s is None else {"duration_ms": int(duration_s * 1000)}
        self.events.append({"_rx": at, "type": "result", "subtype": "success", **own})
        return self

    def message(self, blocks, thinking=(), fresh=2, created=500, cached=1000, parent=None):
        """blocks: (at, type, payload) in time order: ("text", str) or ("tool", (name, input)); thinking: the times
        of the thinking estimates streamed before the first block. Returns the tool ids in order."""
        self.n += 1
        mid, ids = f"m{self.n}", []
        for t in thinking:
            self.events.append({"_rx": t, "type": "system", "subtype": "thinking_tokens", "estimated_tokens": 50})
        usage = {"input_tokens": fresh, "cache_creation_input_tokens": created, "cache_read_input_tokens": cached, "output_tokens": 8}
        for at, kind, payload in blocks:
            if kind == "tool":
                ids.append(f"toolu_{self.n}_{len(ids)}")
                block = {"type": "tool_use", "id": ids[-1], "name": payload[0], "input": payload[1]}
            else:
                block = {"type": "text", "text": payload}
            self.events.append({"_rx": at, "type": "assistant", "parent_tool_use_id": parent,
                                "message": {"id": mid, "role": "assistant", "content": [block], "usage": usage}})
        return ids

    def tool_result(self, at, tid, parent=None):
        self.events.append({"_rx": at, "type": "user", "parent_tool_use_id": parent,
                            "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": "ok"}]}})
        return self

    write = Log.write


def claude_split(tmp_path, log: ClaudeLog, t_from=T0, t_to=T1) -> dict:
    return accounting.time_split(log.write(tmp_path), tmp_path / "none.log", t_from, t_to)


def test_J1_a_message_is_one_call_from_the_step_before_it_to_its_first_output_to_its_last_block(tmp_path):
    log = ClaudeLog().init(T0)
    log.message([(T0 + 30, "text", "done")], thinking=(T0 + 10, T0 + 20))   # sent at init, first output at 10
    s = claude_split(tmp_path, log)
    m = s["model"]
    assert m["source"] == "claude-stream" and m["requests"] == 1
    assert (m["prefill_s"], m["decode_s"]) == (10.0, 20.0)
    assert m["prefill_tokens"] == 502 and m["cached_tokens"] == 1000          # fresh + newly cached; read from cache
    assert m["decode_tokens"] is None and m["decode_tok_s"] is None and m["prefill_tok_s"] is None   # not in the stream


def test_J2_without_thinking_the_first_block_is_the_first_output(tmp_path):
    log = ClaudeLog().init(T0)
    log.message([(T0 + 4, "text", "a"), (T0 + 9, "text", "b")])
    m = claude_split(tmp_path, log)["model"]
    assert (m["prefill_s"], m["decode_s"]) == (4.0, 5.0)


def test_J3_a_tool_runs_from_its_call_to_its_result_by_kind(tmp_path):
    log = ClaudeLog().init(T0)
    (e2e,) = log.message([(T0 + 5, "tool", ("Bash", {"command": "npx playwright test"}))])
    log.tool_result(T0 + 25, e2e)
    (rd,) = log.message([(T0 + 30, "tool", ("Read", {"file_path": "/a"}))])
    log.tool_result(T0 + 31, rd)
    s = claude_split(tmp_path, log)
    assert s["tools_by_kind"] == {"e2e": 20.0, "read": 1.0} and s["tools_s"] == 21.0
    assert s["model"]["requests"] == 2
    assert (s["model"]["prefill_s"], s["model"]["decode_s"]) == (10.0, 0.0)   # sent at init / at the result: 5 + 5


def test_J4_a_message_whose_tools_ran_while_it_was_still_writing_is_one_call_and_the_tools_own_their_time(tmp_path):
    log = ClaudeLog().init(T0)
    a, b = log.message([(T0 + 5, "tool", ("Bash", {"command": "ls"})), (T0 + 12, "tool", ("Bash", {"command": "pwd"}))])
    log.tool_result(T0 + 8, a).tool_result(T0 + 13, b)
    s = claude_split(tmp_path, log)
    assert s["model"]["requests"] == 1
    assert s["tools_s"] == 4.0 and s["model"]["prefill_s"] == 5.0 and s["model"]["decode_s"] == 4.0


def test_J5_the_wait_between_a_session_s_result_and_the_next_session_is_between_sessions(tmp_path):
    log = ClaudeLog().init(T0)
    log.message([(T0 + 10, "text", "first")])
    log.result(T0 + 11).init(T0 + 41)
    log.message([(T0 + 50, "text", "second")])
    s = claude_split(tmp_path, log)
    assert s["between_sessions_s"] == 30.0 and s["model"]["requests"] == 2
    assert s["model"]["prefill_s"] == 19.0                                    # 10 from the first init, 9 from the second


def test_J6_a_tool_call_with_no_result_runs_to_the_agent_s_next_step_and_is_noted(tmp_path):
    log = ClaudeLog().init(T0)
    log.message([(T0 + 5, "tool", ("Bash", {"command": "npm run dev"}))])
    log.message([(T0 + 50, "text", "moving on")], thinking=(T0 + 40,))
    s = claude_split(tmp_path, log)
    assert s["tools_by_kind"] == {"bash": 35.0}
    assert interrupted(s) == [("bash", 35.0, accounting.ENDED_BY_STEP)] and s["accounting"]["ok"] is True


def test_J10_a_session_that_died_without_a_result_ended_when_it_was_last_heard_from(tmp_path):
    log = ClaudeLog().init(T0)
    log.message([(T0 + 5, "tool", ("Bash", {"command": "npx playwright test"}))])
    log.events.append({"_rx": T0 + 30, "type": "tool_progress", "tool_use_id": "toolu_1_0"})
    log.init(T0 + 90)
    log.message([(T0 + 95, "text", "again")])
    s = claude_split(tmp_path, log)
    assert s["tools_by_kind"] == {"e2e": 25.0} and s["between_sessions_s"] == 60.0
    assert interrupted(s) == [("e2e", 25.0, accounting.ENDED_BY_NEW_SESSION)] and s["accounting"]["ok"] is True


def test_J7_a_subagent_s_messages_are_not_the_agent_s_calls(tmp_path):
    log = ClaudeLog().init(T0)
    (task,) = log.message([(T0 + 5, "tool", ("Task", {"description": "look"}))])
    log.message([(T0 + 20, "text", "sub")], parent=task)
    log.tool_result(T0 + 30, task)
    log.message([(T0 + 40, "text", "main")])
    s = claude_split(tmp_path, log)
    assert s["model"]["requests"] == 2 and s["tools_by_kind"] == {"task": 25.0}


def test_J8_the_parts_sum_to_the_wall_and_the_checks_pass(tmp_path):
    log = ClaudeLog().init(T0)
    (t,) = log.message([(T0 + 5, "tool", ("Bash", {"command": "npm run build"}))], thinking=(T0 + 2,))
    log.tool_result(T0 + 15, t)
    log.message([(T0 + 30, "text", "done")], thinking=(T0 + 20, T0 + 25))
    log.result(T0 + 31)
    s = claude_split(tmp_path, log)
    assert sum(parts(s).values()) == pytest.approx(WALL, abs=accounting.TOLERANCE_S)
    assert s["accounting"]["ok"], s["accounting"]["problems"]
    assert s["tools_by_kind"] == {"build": 10.0}


def test_J9_a_session_that_ended_waiting_on_its_own_background_command_is_the_agent_s_tool_time(tmp_path):
    """Opus v2-r3 story 12: the agent started its e2e suite in the background and ended its turn; when the command
    finished, Claude Code itself started the next turn. The 46.7 s between were the agent's (its clock counted
    them), so they are tool time of kind "background", not the harness waiting between sessions."""
    log = ClaudeLog().init(T0)
    log.message([(T0 + 10, "text", "waiting for the suite")])
    log.result(T0 + 11)
    log.events.append({"_rx": T0 + 57, "type": "system", "subtype": "task_notification", "status": "completed"})
    log.init(T0 + 57.5)
    log.message([(T0 + 60, "text", "done")])
    s = claude_split(tmp_path, log)
    assert s["between_sessions_s"] == 0.0 and s["tools_by_kind"] == {"background": 46.5}
    assert accounting.check(s, agent_seconds=WALL) == []


# ---------- K. the machine asleep during a session ----------
# Sonnet 5.5 v2-r4 story 4 (1 Oct 2026): the laptop's lid was closed for about 31 s, 5 minutes into a 39-minute
# session. The wall clock (every event's _rx, the story's window) went on; the harness's clock for the agent
# (time.monotonic) and Claude Code's own (the result's duration_ms) both stop while the machine sleeps. The record
# said wall 2352.1 s against the agent's 2321.2 s and failed its check by 30.9 s; the log's own two clocks differ
# by 30.8 s (init to result 2350.9 s, duration_ms 2320.1 s). Over 94 other recorded sessions they differ by
# 0.16 s at most.
ASLEEP = 30.0


def slept_session(clock_s: float | None = WALL - ASLEEP) -> ClaudeLog:
    """One session over the whole window, with a 55 s gap inside a model call: 25 s of it the model, 30 s asleep."""
    log = ClaudeLog().init(T0)
    log.message([(T0 + 5, "text", "a"), (T0 + 60, "text", "b")])
    log.message([(T0 + 99, "text", "done")])
    return log.result(T1, duration_s=clock_s)


def test_K1_a_session_longer_on_the_wall_than_by_the_agent_s_own_clock_was_suspended_for_the_difference(tmp_path):
    s = claude_split(tmp_path, slept_session())
    assert s["suspended_s"] == ASLEEP
    assert sum(parts(s).values()) == pytest.approx(WALL, abs=accounting.TOLERANCE_S)   # inside the parts, not beside them
    assert s["accounting"]["ok"] is True


def test_K2_the_wall_agrees_with_the_agents_clock_plus_the_time_suspended(tmp_path):
    s = claude_split(tmp_path, slept_session())
    assert accounting.check(s, agent_seconds=WALL - ASLEEP) == []


def test_K3_agent_time_counted_twice_still_fails_whatever_was_suspended(tmp_path):
    s = claude_split(tmp_path, slept_session())
    assert any("counted twice" in p for p in accounting.check(s, agent_seconds=WALL))


def test_K4_a_gap_the_log_s_own_clocks_don_t_show_is_not_taken_for_a_suspension(tmp_path):
    """The same wall and the same agent clock, but Claude Code's clock ran the whole session: 30 s are missing from
    the record of the agent's time, and nothing says the machine slept."""
    s = claude_split(tmp_path, slept_session(clock_s=WALL))
    assert s["suspended_s"] == 0.0
    assert any("agent's own clock" in p for p in accounting.check(s, agent_seconds=WALL - ASLEEP))


def test_K5_clocks_that_differ_by_less_than_a_suspension_could_are_not_one(tmp_path):
    s = claude_split(tmp_path, slept_session(clock_s=WALL - accounting.SUSPENSION_MIN_S / 2))
    assert s["suspended_s"] == 0.0


def test_K6_a_session_without_its_own_clock_or_outside_the_window_counts_nothing(tmp_path):
    assert claude_split(tmp_path, slept_session(clock_s=None))["suspended_s"] == 0.0
    assert claude_split(tmp_path, slept_session(), t_from=T0 + 10)["suspended_s"] == 0.0    # an earlier attempt's session
    assert split(tmp_path, Log().call(T0 + 1, T0 + 2, T0 + 3))["suspended_s"] == 0.0        # pi has no clock of its own


# ---------- L. the calculation's version ----------

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "accounting"
DIGEST_CHARS = 16


def fixture_cases() -> list[dict]:
    """fixtures/accounting/cases.json: small logs shaped like the recorded ones, each with its attempts' windows
    and the agent's own clock for the story."""
    return json.loads((FIXTURES / "cases.json").read_text())


def fixture_digest() -> str:
    """A digest of everything the calculation gives for the fixture logs: each window's split, the story's split
    summed over its attempts (attempts.sum_splits), and the check against the agent's clock. The version itself is
    left out, so the digest names the calculation, not its number."""
    import hashlib
    import attempts
    out = {}
    for case in fixture_cases():
        splits = [accounting.time_split(FIXTURES / case["log"], FIXTURES / "no-server.log", a, b) for a, b in case["windows"]]
        total = attempts.sum_splits(splits)
        out[case["log"]] = {"splits": splits, "total": total, "clock": accounting.check(total, agent_seconds=case["agent_seconds"])}
    text = json.dumps(out, sort_keys=True)
    text = text.replace(f'"version": {accounting.VERSION}', '"version": 0')
    return hashlib.sha256(text.encode()).hexdigest()[:DIGEST_CHARS]


def test_L1_a_changed_calculation_has_a_new_version():
    """Records made by different calculations must not carry the same version: backfill_timing.py --recompute and
    the dashboard tell stale from current by it. VERSION stayed 3 through three changes in the week to 1 Oct 2026."""
    got = fixture_digest()
    assert accounting.DIGESTS.get(accounting.VERSION) == got, (
        f"accounting's output for the fixture logs (fixtures/accounting) changed: its digest is now {got}, and "
        f"accounting.DIGESTS has {accounting.DIGESTS.get(accounting.VERSION)!r} for VERSION {accounting.VERSION}. "
        f"If the calculation changed: set accounting.VERSION = {accounting.VERSION + 1} and ADD the entry "
        f'{accounting.VERSION + 1}: "{got}" to accounting.DIGESTS (leave the earlier entries as they are), then '
        "document what changed in TELEMETRY.md. If only the fixtures changed, replace this version's entry and say so.")


def test_L2_no_two_versions_gave_the_same_output_and_the_current_one_is_the_latest():
    assert len(set(accounting.DIGESTS.values())) == len(accounting.DIGESTS)
    assert max(accounting.DIGESTS) == accounting.VERSION


def test_L3_the_fixtures_exercise_every_part_and_the_digest_notices_a_changed_number(monkeypatch):
    cases = fixture_cases()
    totals = []
    for case in cases:
        splits = [accounting.time_split(FIXTURES / case["log"], FIXTURES / "no-server.log", a, b) for a, b in case["windows"]]
        assert all(s["accounting"]["ok"] for s in splits), (case["log"], [s["accounting"]["problems"] for s in splits])
        import attempts
        totals.append(attempts.sum_splits(splits))
        assert accounting.check(totals[-1], agent_seconds=case["agent_seconds"]) == [], case["log"]
    for part in ("tools_s", "compaction_s", "between_sessions_s", "other_s", "suspended_s"):
        assert any(t[part] > 0 for t in totals), part
    assert {t["model"]["source"] for t in totals} == {accounting.CLIENT_STREAM, accounting.CLAUDE_STREAM}
    assert any(t["accounting"]["interrupted_tools"] for t in totals) and any(t["accounting"]["interrupted_compactions"] for t in totals)
    assert any(t["accounting"]["abandoned_calls"] for t in totals) and any(t.get("attempts") == 2 for t in totals)
    before = fixture_digest()
    monkeypatch.setattr(accounting, "SUSPENSION_MIN_S", 10_000.0)      # a changed constant changes a fixture's output
    assert fixture_digest() != before
