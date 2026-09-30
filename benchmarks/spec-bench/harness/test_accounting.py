"""accounting.py: where a story's wall time went, as a partition of its window, and the checks recorded with it.

The cases are MECE along the dimensions that decide the answer, one section each:
  A. what is in the log      B. where it lies against the window    C. how parts overlap
  D. how starts and ends pair   E. where model time comes from       F. how a model call streamed
  G. the recorded checks     H. the shape of the result            I. any log at all (property)
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
            "compaction": s["compaction_s"], "other": s["other_s"]}


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
    assert parts(s) == {"prefill": 0.0, "decode": 0.0, "tools": 0.0, "compaction": 0.0, "other": WALL}
    assert s["model"] is None and s["accounting"]["ok"]


def test_A2_model_calls_only(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 20).call(T0 + 30, T0 + 31, T0 + 35))
    assert parts(s) == {"prefill": 3.0, "decode": 12.0, "tools": 0.0, "compaction": 0.0, "other": 85.0}


def test_A3_tool_calls_only_by_kind(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 5, T0 + 15, "npx playwright test").tool(T0 + 20, T0 + 23, "npm run build").tool(T0 + 30, T0 + 31, name="read"))
    assert s["tools_s"] == 14.0 and s["tools_by_kind"] == {"e2e": 10.0, "build": 3.0, "read": 1.0}
    assert s["other_s"] == 86.0


def test_A4_compactions_only(tmp_path):
    s = split(tmp_path, Log().compaction(T0 + 10, T0 + 40))
    assert s["compaction_s"] == 30.0 and s["compactions"] == 1 and s["other_s"] == 70.0


def test_A5_everything_apart(tmp_path):
    log = Log().call(T0 + 0, T0 + 2, T0 + 10).tool(T0 + 11, T0 + 21).compaction(T0 + 30, T0 + 50).call(T0 + 60, T0 + 61, T0 + 70)
    assert parts(split(tmp_path, log)) == {"prefill": 3.0, "decode": 17.0, "tools": 10.0, "compaction": 20.0, "other": 50.0}


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
    assert parts(s) == {"prefill": 0.0, "decode": 0.0, "tools": 0.0, "compaction": 0.0, "other": 0.0}
    r = split(tmp_path, Log(), t_from=T1, t_to=T0)
    assert r["wall_s"] == 0.0 and not r["accounting"]["ok"]


# ---------- C. how parts overlap: one owner per second, compaction > tool > prefill > decode ----------

def test_C1_tool_over_model_the_tool_owns_the_overlap(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, T0 + 30).tool(T0 + 20, T0 + 25))
    assert parts(s) == {"prefill": 2.0, "decode": 13.0, "tools": 5.0, "compaction": 0.0, "other": 80.0}


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


def test_D2_a_tool_that_never_ended_runs_to_the_agents_next_step_and_is_reported(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 10).call(T0 + 40, T0 + 41, T0 + 50))
    assert s["tools_s"] == 30.0 and any("never ended" in p for p in s["accounting"]["problems"])


def test_D3_a_tool_that_never_ended_with_nothing_after_it_runs_to_the_window_end(tmp_path):
    s = split(tmp_path, Log().tool(T0 + 90))
    assert s["tools_s"] == 10.0


def test_D4_a_compaction_that_never_ended_runs_to_the_window_end_and_is_reported(tmp_path):
    s = split(tmp_path, Log().compaction(T0 + 80))
    assert s["compaction_s"] == 20.0 and any("compaction" in p for p in s["accounting"]["problems"])


def test_D5_a_model_call_cut_off_before_it_ended_is_counted_as_abandoned_not_as_a_call(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10, T0 + 12, None, ended=False).call(T0 + 50, T0 + 51, T0 + 60))
    assert s["model"]["requests"] == 1 and s["accounting"]["abandoned_calls"] == 1


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


def test_E4_no_model_time_at_all_for_a_client_that_logs_no_stream(tmp_path):
    p = tmp_path / "agent-events.jsonl"
    p.write_text(json.dumps({"_rx": T0 + 5, "type": "assistant", "message": {"content": []}}) + "\n")   # Claude Code's format
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
        "version": accounting.VERSION, "ok": True, "problems": [], "abandoned_calls": 0}


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


# ---------- H. the shape of the result ----------

def test_H1_keys_units_and_rounding_match_what_the_records_and_the_page_read(tmp_path):
    s = split(tmp_path, Log().call(T0 + 10.04, T0 + 12.06, T0 + 20.11).tool(T0 + 30.01, T0 + 31.02, "npx playwright test"))
    assert set(s) == {"wall_s", "model", "tools_s", "tools_by_kind", "compaction_s", "compactions", "other_s", "accounting"}
    assert set(s["model"]) >= {"source", "requests", "prefill_s", "prefill_tokens", "prefill_tok_s", "decode_s", "decode_tokens", "decode_tok_s", "cached_tokens"}
    for v in (s["wall_s"], s["tools_s"], s["other_s"], s["model"]["prefill_s"], s["model"]["decode_s"]):
        assert round(v, 1) == v


# ---------- I. any log at all: the invariants hold by construction ----------

spans = st.tuples(st.floats(T0 - 50, T1 + 50), st.floats(0, 60))


@settings(max_examples=150, deadline=None)
@given(tools=st.lists(spans, max_size=6), comps=st.lists(spans, max_size=3), calls=st.lists(st.tuples(st.floats(T0 - 50, T1 + 50), st.floats(0, 10), st.floats(0, 30)), max_size=6))
def test_I1_parts_never_negative_never_overlap_and_always_sum_to_the_wall(tmp_path_factory, tools, comps, calls):
    tmp = tmp_path_factory.mktemp("prop")
    log = Log()
    for a, d in tools:
        log.tool(a, a + d)
    for a, d in comps:
        log.compaction(a, a + d)
    for a, pre, dec in calls:
        log.call(a, a + pre, a + pre + dec)
    s = split(tmp, log)
    p = parts(s)
    assert all(v >= 0 for v in p.values())
    assert abs(sum(p.values()) - WALL) <= accounting.TOLERANCE_S
    assert s["accounting"]["ok"] or all("never ended" in x or "ended without" in x for x in s["accounting"]["problems"])
