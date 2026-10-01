"""drive.py's agent session and what watches it, pinned branch by branch before the story loop is rebuilt
(CLAUDE.md, "Refactor DELETE FIRST").

- run_agent: one session of a scripted agent (a real process printing pi's events): what is logged, counted and
  returned; the loop detector's stop; the kill after the grace period; errors and the operator's skip.
- run_story_agent, the attempts of one story (resume after an error, the stop rule, their caps), is
  test_stop_rule.py's.
- The watchers (hang guard, conditions sampler, skip watcher, progress watcher): each loop is run a set number of
  times by a stand-in for its halt event, so nothing here waits on a clock or samples the machine.
- The process helpers that find and kill what an agent left behind, with ps, pgrep, lsof and the signals faked.
"""
from __future__ import annotations

import json
import os
import signal
import sys
import textwrap
from pathlib import Path
from types import SimpleNamespace

import pytest

import drive
import hostenv
import progress
from clients import PiClient
from sandbox_testing import no_sandbox

NOMINAL = {"ac": True, "low_power": False, "thermal": "nominal"}
ON_BATTERY = {"ac": False, "low_power": False, "thermal": "nominal"}
HOT = {"ac": True, "low_power": False, "thermal": "heavy"}
SLEEP_FOREVER_S = 600          # a scripted agent that must be killed sleeps this long; the test never waits for it
SHORT_GRACE_S = 0.3


def never(*a, **k):
    raise AssertionError("must not be called")


@pytest.fixture(autouse=True)
def clean_story_state(monkeypatch):
    """The module's per-story state, as a fresh process has it, before and after every test."""
    def reset():
        drive.STORY_FAULTS.clear()
        drive.STORY_SKIP.clear()
        drive.RUN_ABORT.clear()
    reset()
    monkeypatch.setattr(drive, "CONTAINMENT", None)
    monkeypatch.setattr(drive, "AGENT_ROOT_PID", None)
    yield
    reset()


class Rounds:
    """Stands in for a watcher's halt event: its loop goes round n times, then is told to stop."""
    def __init__(self, n: int):
        self.left = n
        self.waits: list[float] = []

    def wait(self, timeout=None) -> bool:
        self.waits.append(timeout)
        if self.left:
            self.left -= 1
            return False
        return True

    def set(self) -> None:
        pass


def run_rounds(watcher, n: int) -> Rounds:
    """Start the watcher's thread for exactly n rounds of its loop and wait for it to end."""
    rounds = Rounds(n)
    watcher._halt = rounds
    watcher.start()
    watcher.join()
    return rounds


class Containment:
    """Stands in for containment.StoryContainment: records what the harness asks of it."""
    def __init__(self):
        self.calls: list = []

    def wrap(self, cmd):
        self.calls.append("wrap")
        return cmd

    def started(self, pid):
        self.calls.append(("started", pid))

    def note_tool_start(self):
        self.calls.append("tool_start")

    def reap_interrupted(self):
        self.calls.append("reap_interrupted")

    def reap_pressure(self):
        self.calls.append("reap_pressure")


# ======================= run_agent: one session =======================

class Scripted(PiClient):
    """pi's events and counting, with a Python script in place of `pi`."""

    def __init__(self, work: Path, body: str):
        super().__init__(work)
        self.script = work / "agent.py"
        self.script.write_text("import json, os, signal, sys, time\n"
                               "def emit(*events):\n"
                               "    for e in events:\n"
                               "        print(e if isinstance(e, str) else json.dumps(e), flush=True)\n"
                               + textwrap.dedent(body))
        self.asked: list[tuple] = []
        self.root_pids: list[int | None] = []

    def env(self) -> dict:
        return {"COV_CLIENT_VAR": "from the client"}

    def command(self, model_id, prompt, resume_from=None, fork=True):
        self.asked.append((model_id, prompt, resume_from, fork))
        return [sys.executable, str(self.script), prompt]

    def scan(self, e, st):
        self.root_pids.append(drive.AGENT_ROOT_PID)
        return super().scan(e, st)


@pytest.fixture
def session(tmp_path, monkeypatch):
    """run_agent with the sandbox and the OOM wrapper off; returns run(body, **kwargs) -> (result, client, events)."""
    no_sandbox(monkeypatch)
    monkeypatch.setattr(hostenv, "oom_first", lambda cmd: cmd)
    ws = tmp_path / "work" / "workspace"
    ws.mkdir(parents=True)
    events = tmp_path / "agent-events.jsonl"

    def run(body: str, env: dict | None = None, prompt: str = "the prompt", **kwargs):
        client = Scripted(tmp_path, body)
        result = drive.run_agent(client, ws, env or {}, "the-model", prompt, events, **kwargs)
        return result, client, events
    run.ws = ws
    return run


TURN = {"type": "message_end", "message": {"role": "assistant", "stopReason": "stop", "usage": {"input": 10, "output": 4}}}
TOOL = {"type": "tool_execution_start", "toolName": "bash", "args": {"command": "npm test"}}


def logged(events: Path) -> list:
    return [json.loads(l) if l.startswith("{") else l for l in events.read_text().splitlines()]


def test_a_clean_session_is_counted_logged_with_arrival_times_and_returned(session):
    body = f"""
        emit({{"type": "session", "id": "s1", "pid": os.getpid()}}, {TOOL!r}, "npm warn: not an event", {TURN!r}, {TURN!r})
    """
    result, client, events = session(body)
    seconds = result.pop("seconds")
    assert isinstance(seconds, float) and 0 <= seconds < 60
    assert result == {"exit": 0, "stalled": False, "session": "s1", "error": None, "steps": 2, "tool_calls": 1,
                      "compactions": 0, "tokens": {"input": 20, "output": 8, "reasoning": 0, "cache_read": 0, "cache_write": 0}}
    got = logged(events)
    assert [e if isinstance(e, str) else e["type"] for e in got] == [
        "session", "tool_execution_start", "npm warn: not an event", "message_end", "message_end"]
    stamps = [e["_rx"] for e in got if isinstance(e, dict)]
    assert stamps == sorted(stamps) and all(isinstance(t, float) for t in stamps)
    assert client.asked == [("the-model", "the prompt", None, True)]
    # While the session runs the harness knows its root process; afterwards it knows none.
    assert set(client.root_pids) == {got[0]["pid"]} and drive.AGENT_ROOT_PID is None


def test_a_resumed_session_is_asked_of_the_client_and_appended_to_the_log(session):
    _, _, events = session('emit({"type": "session", "id": "s1"})')
    result, client, _ = session('emit({"type": "session", "id": "s2"})', prompt="go on", resume_from="s1", fork=False)
    assert client.asked == [("the-model", "go on", "s1", False)] and result["session"] == "s2"
    assert [e["id"] for e in logged(events)] == ["s1", "s2"]


def test_the_harness_s_own_variables_do_not_reach_the_agent(session, monkeypatch):
    for k, v in {"SPEC_BENCH_RESULTS_ROOT": "/x/awesome-local-ai", "VIDI_WORK_ROOT": "/x/w", "DBENCH_JOB": "j",
                 "BENCH_CONTEXT": "1", "CTX": "131072"}.items():
        monkeypatch.setenv(k, v)
    body = """
        emit({"type": "session", "id": "s", "env": sorted(k for k in os.environ if k in
              ("SPEC_BENCH_RESULTS_ROOT", "VIDI_WORK_ROOT", "DBENCH_JOB", "BENCH_CONTEXT", "CTX", "PATH"))})
    """
    _, _, events = session(body)
    assert logged(events)[0]["env"] == ["CTX", "PATH"]


def test_the_agent_runs_in_the_workspace_with_the_given_and_the_client_s_environment(session, monkeypatch):
    """With no sandbox (the stand-in these tests use) the agent also has the harness's own environment; the sandbox's
    allow-list, which drops it, is test_agent_world.py and test_sandbox.py."""
    monkeypatch.setenv("COV_INHERITED", "from the harness")
    body = """
        emit({"type": "session", "id": "s", "cwd": os.getcwd(), "stdin": sys.stdin.read(), "own_group": os.getpgrp() == os.getpid(),
              "env": {k: os.environ.get(k) for k in ("COV_INHERITED", "COV_GIVEN", "COV_CLIENT_VAR")}})
    """
    _, _, events = session(body, env={"COV_GIVEN": "from agent_env", "COV_CLIENT_VAR": "the client's wins"})
    e = logged(events)[0]
    assert e["cwd"] == str(session.ws.resolve()) and e["stdin"] == "" and e["own_group"] is True
    assert e["env"] == {"COV_INHERITED": "from the harness", "COV_GIVEN": "from agent_env",
                        "COV_CLIENT_VAR": "from the client"}


def test_the_agent_s_stderr_is_logged_with_its_events(session):
    _, _, events = session('emit({"type": "session", "id": "s"}); sys.stderr.write("a warning\\n")')
    assert "a warning" in logged(events)


@pytest.mark.parametrize("body, error", [
    ('emit({"type": "session", "id": "s"}); sys.exit(3)', "agent exited with status 3"),
    # The client's own account of the error is kept over the exit status.
    ('emit({"type": "message_end", "message": {"role": "assistant", "stopReason": "error", "errorMessage": "429 overloaded"}}); '
     'sys.exit(3)', "429 overloaded"),
    ('emit({"type": "message_end", "message": {"role": "assistant", "stopReason": "error", "errorMessage": "429 overloaded"}})',
     "429 overloaded"),
])
def test_a_session_that_fails_is_returned_with_its_error(session, body, error):
    result, _, _ = session(body)
    assert result["error"] == error and result["stalled"] is False
    assert result["exit"] == (3 if "sys.exit(3)" in body else 0)


def test_a_session_the_operator_ended_has_no_error_whatever_it_exited_with(session):
    drive.STORY_SKIP.set()
    body = 'emit({"type": "message_end", "message": {"role": "assistant", "stopReason": "error", "errorMessage": "killed"}}); sys.exit(3)'
    result, _, _ = session(body)
    assert result["error"] is None and result["exit"] == 3 and result["steps"] == 1


def test_an_agent_repeating_one_tool_call_is_stopped_as_stalled_not_as_an_error(session):
    body = f"""
        emit({{"type": "session", "id": "s"}})
        for _ in range({drive.LOOP_REPEAT_LIMIT}):
            emit({TOOL!r})
        time.sleep({SLEEP_FOREVER_S})
    """
    result, _, events = session(body)
    assert result["stalled"] is True and result["exit"] == -signal.SIGTERM and result["error"] is None
    assert result["tool_calls"] == drive.LOOP_REPEAT_LIMIT and result["session"] == "s"
    assert [e["type"] for e in logged(events)] == ["session"] + ["tool_execution_start"] * drive.LOOP_REPEAT_LIMIT


def test_one_call_fewer_than_the_limit_is_not_a_stall(session):
    body = f"""
        for _ in range({drive.LOOP_REPEAT_LIMIT - 1}):
            emit({TOOL!r})
    """
    result, _, _ = session(body)
    assert result["stalled"] is False and result["exit"] == 0 and result["tool_calls"] == drive.LOOP_REPEAT_LIMIT - 1


def test_a_stalled_agent_that_ignores_the_stop_is_killed_after_the_grace_period(session, monkeypatch):
    monkeypatch.setattr(drive, "KILL_GRACE_S", SHORT_GRACE_S)
    body = f"""
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        for _ in range({drive.LOOP_REPEAT_LIMIT}):
            emit({TOOL!r})
        time.sleep({SLEEP_FOREVER_S})
    """
    result, _, _ = session(body)
    assert result["stalled"] is True and result["exit"] == -signal.SIGKILL and result["error"] is None
    assert result["seconds"] >= SHORT_GRACE_S


def test_the_session_is_wrapped_in_its_containment_and_each_tool_call_is_noted(session, monkeypatch):
    contained = Containment()
    monkeypatch.setattr(drive, "CONTAINMENT", contained)
    body = f"""
        emit({{"type": "session", "id": "s", "pid": os.getpid()}}, {TOOL!r}, {{"type": "tool_execution_end"}},
             {{"type": "tool_execution_start", "toolName": "read", "args": {{}}}})
    """
    _, _, events = session(body)
    assert contained.calls == ["wrap", ("started", logged(events)[0]["pid"]), "tool_start", "tool_start"]


NOT_AN_OBJECT = "a line of the agent's output that is JSON but not an object (a bare number, null, a list)"


def test_a_json_line_that_is_not_an_event_does_not_crash_the_session(session):
    """It reached client.scan, which calls .get on it, and the session crashed. It is skipped, as a line that is
    not JSON is, and stays in the log as it arrived; the story's record counts such lines (drive.skipped_output)."""
    result, _, events = session('emit("42", "null", "[1, 2]", {"type": "session", "id": "s"}, "7")')
    assert result["session"] == "s" and result["exit"] == 0 and result["steps"] == 0
    assert events.read_text().splitlines()[:3] == ["42", "null", "[1, 2]"]          # unstamped, word for word
    assert drive.skipped_output(events) == {"count": 4, "samples": ["42", "null", "[1, 2]"]}


def test_a_json_line_that_is_not_an_event_does_not_stop_the_last_session_being_found(tmp_path):
    """The same line in a story's log crashed last_session when the harness restarted mid-story."""
    ev = tmp_path / "e.jsonl"
    ev.write_text('{"type": "session", "id": "s"}\n42\n')
    assert drive.last_session(PiClient(tmp_path), ev) == "s"


# ======================= output lines that are JSON but not events =======================

def test_skipped_output_counts_every_such_line_and_keeps_the_first_few_each_cut_to_its_limit(tmp_path):
    ev = tmp_path / "e.jsonl"
    long_list = json.dumps(list(range(500)))
    ev.write_text("\n".join(['{"_rx":1.0,"type":"session","id":"s"}', "npm warn: not JSON at all", "", long_list, "null",
                             '"a bare string"', "3.5", "true", '{"_rx":2.0,"type":"message_end"', "{cut off"]) + "\n")
    got = drive.skipped_output(ev)
    assert got == {"count": 5, "samples": [long_list[:drive.SKIPPED_OUTPUT_SAMPLE_CHARS], "null", '"a bare string"']}
    assert (drive.SKIPPED_OUTPUT_SAMPLES, drive.SKIPPED_OUTPUT_SAMPLE_CHARS) == (3, 200)
    assert len(long_list) > drive.SKIPPED_OUTPUT_SAMPLE_CHARS


def test_a_log_with_no_such_line_and_a_story_with_no_log_have_nothing_to_record(tmp_path):
    ev = tmp_path / "e.jsonl"
    assert drive.skipped_output(ev) is None                                 # no log: the agent was never started
    ev.write_text('{"_rx":1.0,"type":"session","id":"s"}\nnpm warn: not JSON\n\n')
    assert drive.skipped_output(ev) is None


# ======================= the loop detector =======================

def test_the_loop_detector_trips_on_its_limit_of_identical_keys_and_not_before():
    d = drive.LoopDetector(limit=3)
    assert [d.key("a"), d.key("a"), d.key("a"), d.key("a"), d.key("b"), d.key("a"), d.key("a")] == [
        False, False, True, True, False, False, False]
    assert drive.LoopDetector().recent.maxlen == drive.LOOP_REPEAT_LIMIT


def test_a_tool_call_s_key_does_not_depend_on_the_order_of_its_arguments():
    d = drive.LoopDetector(limit=2)
    assert d.tool_call("edit", {"a": 1, "b": 2}) is False and d.tool_call("edit", {"b": 2, "a": 1}) is True
    assert d.tool_call(None, None) is False


# ======================= the hang guard =======================

def test_the_hang_guard_logs_each_interruption_and_counts_them(tmp_path, monkeypatch, capsys):
    events = tmp_path / "run" / "stories" / "07" / "agent-events.jsonl"
    log = tmp_path / "interventions.md"
    checks = iter([False, True, False, True])
    seen = []
    monkeypatch.setattr(drive, "tool_hang_check", lambda ev, ws: seen.append((ev, ws)) or next(checks))
    guard = drive.ToolHangGuard(events, tmp_path / "ws", log)
    assert guard.daemon is True
    rounds = run_rounds(guard, 4)
    assert guard.stop() == 2 and seen == [(events, tmp_path / "ws")] * 4
    assert rounds.waits == [drive.TOOL_HANG_POLL_S] * 5
    entries = log.read_text().splitlines()
    assert len(entries) == 2
    for entry in entries:
        assert entry.split(" ", 1)[1] == (f"07: interrupted a tool call silent for {drive.TOOL_HANG_S}s "
                                         f"(killed processes under the workspace)")
    assert capsys.readouterr().out == f"    tool call silent {drive.TOOL_HANG_S // 60} min — interrupted (Ctrl-C equivalent)\n" * 2


def test_the_hang_guard_writes_nothing_while_no_tool_call_hangs(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(drive, "tool_hang_check", lambda ev, ws: False)
    log = tmp_path / "interventions.md"
    guard = drive.ToolHangGuard(tmp_path / "e.jsonl", tmp_path, log)
    run_rounds(guard, 3)
    assert guard.stop() == 0 and not log.exists() and capsys.readouterr().out == ""


def test_the_hang_guard_has_the_containment_reap_what_the_interrupted_call_started(tmp_path, monkeypatch):
    contained = Containment()
    monkeypatch.setattr(drive, "CONTAINMENT", contained)
    monkeypatch.setattr(drive, "tool_hang_check", lambda ev, ws: True)
    guard = drive.ToolHangGuard(tmp_path / "e.jsonl", tmp_path, tmp_path / "interventions.md")
    run_rounds(guard, 2)
    assert contained.calls == ["reap_interrupted", "reap_interrupted"] and guard.stop() == 2


# ======================= the conditions sampler =======================

T = 1_790_000_000.0


def sampler(monkeypatch, rounds: int, swaps: list[float], frees: list[float | None] | None = None,
            conditions: list[dict] | None = None, footprints: list[tuple] | None = None, gpu=None,
            ws: Path | None = None, port: int | None = None):
    """A sampler run for `rounds` samples of a scripted machine. swaps: at the story's start, then per sample.
    Returns (sampler, its stop() record, what was killed)."""
    swap, free = iter(swaps), iter(frees or [50.0] * rounds)
    cond, foot = iter(conditions or [NOMINAL] * rounds), iter(footprints or [(None, None)] * rounds)
    asked_ports: list = []
    killed: list = []
    monkeypatch.setattr(drive, "swap_used_gb", lambda: next(swap))
    monkeypatch.setattr(drive, "mem_free_pct", lambda: next(free))
    monkeypatch.setattr(drive, "conditions", lambda: dict(next(cond)))
    monkeypatch.setattr(drive, "server_footprint_gb", lambda p: asked_ports.append(p) or next(foot))
    monkeypatch.setattr(hostenv, "gpu_sample", gpu or (lambda: None))
    monkeypatch.setattr(hostenv, "summarise_gpu", lambda samples: {"samples": list(samples)})
    monkeypatch.setattr(drive, "workspace_pids", lambda w: {("pids of", w)})
    monkeypatch.setattr(drive, "kill_pids", killed.append)
    monkeypatch.setattr(drive.time, "time", lambda: T)
    s = drive.ConditionSampler(ws, server_port=port)
    waits = run_rounds(s, rounds).waits
    assert waits == [drive.CONDITION_POLL_S] * (rounds + 1) and asked_ports == [port] * rounds
    return s, s.stop(), killed


def test_a_quiet_story_on_a_fit_machine_is_sampled_and_nothing_else(monkeypatch, capsys):
    s, record, killed = sampler(monkeypatch, 3, swaps=[1.004, 1.0, 1.2, 1.1], port=18010)
    assert s.daemon is True
    assert record == {"samples": 3, "degraded": False, "throttled_share": 0.0, "bad_samples": [],
                      "swap_start_gb": 1.0, "swap_max_gb": 1.2, "aborted_swap": False, "aborted_memory": False,
                      "free_min_pct": 50.0, "memory_snapshot": None, "server_footprint_max_gb": None,
                      "server_footprint_peak_gb": None, "gpu": {"samples": []}}
    assert killed == [] and not drive.RUN_ABORT.is_set() and capsys.readouterr().out == ""


def test_each_unfit_sample_is_kept_with_its_time(monkeypatch):
    _, record, _ = sampler(monkeypatch, 4, swaps=[0.0] * 5, conditions=[NOMINAL, ON_BATTERY, HOT, NOMINAL])
    assert record["bad_samples"] == [{**ON_BATTERY, "t": T}, {**HOT, "t": T}]
    assert record["samples"] == 4 and record["degraded"] is True and record["throttled_share"] == 0.25


def test_gpu_samples_are_kept_and_a_failed_reading_stops_nothing(monkeypatch, capsys):
    readings = iter([{"util": 90}, None, RuntimeError("nvidia-smi went away"), {"util": 70}])

    def gpu():
        r = next(readings)
        if isinstance(r, Exception):
            raise r
        return r
    _, record, _ = sampler(monkeypatch, 4, swaps=[0.0] * 5, gpu=gpu)
    assert record["gpu"] == {"samples": [{"util": 90}, {"util": 70}]} and record["samples"] == 4
    assert capsys.readouterr().out == "    gpu sample failed: nvidia-smi went away\n"


def test_the_server_s_footprint_is_kept_at_its_highest(monkeypatch):
    _, record, _ = sampler(monkeypatch, 4, swaps=[0.0] * 5, port=18010,
                           footprints=[(2.0, 3.0), (5.0, None), (None, None), (1.0, 9.0)])
    assert record["server_footprint_max_gb"] == 5.0 and record["server_footprint_peak_gb"] == 9.0


def test_a_footprint_with_no_peak_reported_has_a_peak_of_zero(monkeypatch):
    _, record, _ = sampler(monkeypatch, 1, swaps=[0.0] * 2, footprints=[(2.0, None)])
    assert record["server_footprint_max_gb"] == 2.0 and record["server_footprint_peak_gb"] == 0.0


def test_low_memory_reaps_orphans_and_is_snapshotted_at_each_new_low(monkeypatch):
    contained = Containment()
    monkeypatch.setattr(drive, "CONTAINMENT", contained)
    snapshots = iter([{"top": "first"}, {"top": "second"}])
    monkeypatch.setattr(hostenv, "memory_snapshot", lambda: next(snapshots))
    below_reap, below_snapshot = drive.MEM_REAP_PCT - 5, drive.MEM_SNAPSHOT_PCT - 1
    frees = [float(drive.MEM_REAP_PCT), below_reap, below_snapshot, below_snapshot + 0.5, below_snapshot - 4, None, 40.0]
    s, record, killed = sampler(monkeypatch, len(frees), swaps=[0.0] * (len(frees) + 1), frees=frees)
    assert contained.calls == ["reap_pressure"] * 4                   # each sample under the reap line; not at it, not unknown
    assert record["free_min_pct"] == below_snapshot - 4
    assert record["memory_snapshot"] == {"t": T, "free_pct": below_snapshot - 4, "top": "second"}   # two new lows, the last kept
    assert record["aborted_memory"] is False and killed == []


def test_low_memory_without_containment_is_snapshotted_and_nothing_is_reaped(monkeypatch):
    monkeypatch.setattr(hostenv, "memory_snapshot", lambda: {"top": "x"})
    _, record, _ = sampler(monkeypatch, 1, swaps=[0.0] * 2, frees=[drive.MEM_SNAPSHOT_PCT - 1.0])
    assert record["memory_snapshot"] == {"t": T, "free_pct": drive.MEM_SNAPSHOT_PCT - 1.0, "top": "x"}


def test_a_failed_memory_snapshot_stops_nothing(monkeypatch, capsys):
    def broken():
        raise OSError("ps failed")
    monkeypatch.setattr(hostenv, "memory_snapshot", broken)
    low = drive.MEM_SNAPSHOT_PCT - 1.0
    _, record, _ = sampler(monkeypatch, 2, swaps=[0.0] * 3, frees=[low, low - 1])
    assert record["memory_snapshot"] is None and record["free_min_pct"] == low - 1 and record["samples"] == 2
    assert capsys.readouterr().out == "    memory snapshot failed: ps failed\n" * 2


def test_memory_that_cannot_be_read_is_neither_a_low_nor_a_reason_to_stop(monkeypatch):
    _, record, killed = sampler(monkeypatch, 2, swaps=[0.0] * 3, frees=[None, None])
    assert record["free_min_pct"] is None and record["memory_snapshot"] is None
    assert record["aborted_memory"] is False and not drive.RUN_ABORT.is_set()


def test_swap_growing_past_the_limit_stops_the_agent_once(tmp_path, monkeypatch, capsys):
    grown = 1.0 + drive.SWAP_ABORT_GROWTH_GB + 0.5
    s, record, killed = sampler(monkeypatch, 3, swaps=[1.0, 1.0 + drive.SWAP_ABORT_GROWTH_GB, grown, grown + 2],
                                frees=[50.0, 50.0, drive.MEM_FREE_ABORT_PCT - 1.0], ws=tmp_path)
    assert record["aborted_swap"] is True and record["aborted_memory"] is False       # the later low memory changes nothing
    assert record["swap_start_gb"] == 1.0 and record["swap_max_gb"] == grown + 2 and record["samples"] == 3
    assert killed == [{("pids of", tmp_path)}] and drive.RUN_ABORT.is_set() and s.aborted.is_set()
    assert capsys.readouterr().out == (f"    SWAP GUARD: swap grew {drive.SWAP_ABORT_GROWTH_GB + 0.5:.1f} GB during the story "
                                       f"(1.0 -> {grown:.1f} GB) — stopping the agent to protect the machine\n")


def test_swap_growth_at_the_limit_is_not_past_it(monkeypatch):
    _, record, killed = sampler(monkeypatch, 1, swaps=[1.0, 1.0 + drive.SWAP_ABORT_GROWTH_GB])
    assert record["aborted_swap"] is False and killed == [] and not drive.RUN_ABORT.is_set()


def test_free_memory_under_the_limit_stops_the_agent(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(hostenv, "memory_snapshot", lambda: {})
    low = drive.MEM_FREE_ABORT_PCT - 1.0
    _, record, killed = sampler(monkeypatch, 2, swaps=[0.0] * 3, frees=[float(drive.MEM_FREE_ABORT_PCT), low], ws=tmp_path)
    assert record["aborted_memory"] is True and record["aborted_swap"] is False and record["free_min_pct"] == low
    assert killed == [{("pids of", tmp_path)}] and drive.RUN_ABORT.is_set()
    assert capsys.readouterr().out == (f"    MEMORY GUARD: free memory {low:.0f}% < {drive.MEM_FREE_ABORT_PCT}% — stopping the "
                                       f"agent to protect the machine\n")


def test_when_swap_and_memory_both_cross_in_one_sample_it_is_the_swap_guard_s_stop(monkeypatch):
    monkeypatch.setattr(hostenv, "memory_snapshot", lambda: {})
    _, record, _ = sampler(monkeypatch, 1, swaps=[0.0, drive.SWAP_ABORT_GROWTH_GB + 1], frees=[drive.MEM_FREE_ABORT_PCT - 1.0])
    assert record["aborted_swap"] is True and record["aborted_memory"] is False


def test_a_guard_with_no_workspace_stops_the_run_and_kills_nothing(monkeypatch):
    _, record, killed = sampler(monkeypatch, 1, swaps=[0.0, drive.SWAP_ABORT_GROWTH_GB + 1], ws=None)
    assert record["aborted_swap"] is True and killed == [] and drive.RUN_ABORT.is_set()


# ======================= the skip watcher =======================

def skip_request(run: Path, **req) -> Path:
    f = run / drive.CONTROL_DIR / drive.SKIP_FILE
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(req))
    return f


@pytest.fixture
def killed(monkeypatch):
    out: list = []
    monkeypatch.setattr(drive, "workspace_pids", lambda ws: {("pids of", ws)})
    monkeypatch.setattr(drive, "kill_pids", out.append)
    return out


def test_the_skip_watcher_does_nothing_while_no_request_waits_and_the_story_is_under_its_cap(tmp_path, killed, capsys):
    skip_request(tmp_path, story=6, reason="another story's")
    w = drive.SkipWatcher(tmp_path, 5, tmp_path / "ws", now=lambda: 1000.0)
    assert w.daemon is True and w.poll_s == drive.SKIP_POLL_S
    rounds = run_rounds(w, 3)
    assert w.stop() is None and rounds.waits == [drive.SKIP_POLL_S] * 4
    assert killed == [] and not drive.STORY_SKIP.is_set() and capsys.readouterr().out == ""


def test_the_operator_s_request_ends_the_story_and_the_watching(tmp_path, killed, capsys):
    skip_request(tmp_path, story=5, reason="stuck on the build", by="someone@example.invalid", at=9.0)
    w = drive.SkipWatcher(tmp_path, 5, tmp_path / "ws", now=lambda: 1000.0, poll_s=0.5)
    rounds = run_rounds(w, 3)
    assert rounds.waits == [0.5]                                      # it stopped watching at the request
    assert w.stop() == {"story": 5, "reason": "stuck on the build", "by": drive.OPERATOR, "at": 9.0}
    assert drive.STORY_SKIP.is_set() and killed == [{("pids of", tmp_path / "ws")}]
    assert capsys.readouterr().out == "    operator ended story 5 (operator): stuck on the build\n"


def test_the_story_cap_ends_the_story_as_a_request_from_the_harness(tmp_path, killed, capsys):
    clock = iter([1000.0, 1000.0 + drive.MAX_STORY_AGENT_S - 1, 1000.0 + drive.MAX_STORY_AGENT_S, 2000.0])
    w = drive.SkipWatcher(tmp_path, 5, tmp_path / "ws", now=lambda: next(clock))
    rounds = run_rounds(w, 5)
    hours = drive.MAX_STORY_AGENT_S / drive.SECONDS_PER_HOUR
    reason = f"story cap: {hours:.1f} h of agent time (cap {hours:.1f} h)"
    assert len(rounds.waits) == 2                                     # under the cap once, then at it
    assert w.stop() == {"story": 5, "reason": reason, "by": "harness (cap)", "at": 2000.0}
    assert drive.STORY_SKIP.is_set() and killed == [{("pids of", tmp_path / "ws")}]
    assert capsys.readouterr().out == f"    the story cap ended story 5 (harness (cap)): {reason}\n"


def test_the_story_cap_counts_the_agent_time_of_earlier_attempts(tmp_path, killed):
    w = drive.SkipWatcher(tmp_path, 5, tmp_path / "ws", now=lambda: 1000.0, already_s=drive.MAX_STORY_AGENT_S)
    assert w.elapsed() == drive.MAX_STORY_AGENT_S
    run_rounds(w, 1)
    assert w.stop()["by"] == "harness (cap)"


def test_an_operator_s_request_is_taken_before_the_cap(tmp_path, killed):
    skip_request(tmp_path, story=5, reason="mine")
    w = drive.SkipWatcher(tmp_path, 5, tmp_path / "ws", now=lambda: 1000.0, already_s=drive.MAX_STORY_AGENT_S)
    run_rounds(w, 1)
    assert w.stop() == {"story": 5, "reason": "mine", "by": drive.OPERATOR}


def test_the_nudge_cap_ends_the_story_through_the_watcher(tmp_path, killed):
    w = drive.SkipWatcher(tmp_path, 5, tmp_path / "ws", now=lambda: 1234.0)
    w.cap("story cap: 5 nudges without committing (cap 5)")
    assert w.request == {"story": 5, "reason": "story cap: 5 nudges without committing (cap 5)", "by": "harness (cap)", "at": 1234.0}
    assert drive.STORY_SKIP.is_set() and killed == [{("pids of", tmp_path / "ws")}]


# ======================= the progress watcher =======================

class Tally:
    def __init__(self):
        self.n = 0

    def update(self) -> dict:
        self.n += 1
        return {"calls": self.n, "output_tokens": 10 * self.n, "compactions": 0, "recent_activity": [f"call {self.n}"]}


@pytest.fixture
def watcher(tmp_path, monkeypatch):
    """A progress watcher over scripted evidence; watcher.tables is what the task table will be at each refresh."""
    written: list[tuple] = []
    asked: list[tuple] = []
    clock = [T]
    tables = iter([])
    monkeypatch.setattr(drive.time, "time", lambda: clock[0])
    monkeypatch.setattr(progress, "evidence", lambda ws, base: asked.append((ws, base)) or {"last_commit_at": 77.0})
    monkeypatch.setattr(progress, "task_table", lambda tasks, ev: next(w.tables))
    monkeypatch.setattr(progress, "write_progress", lambda *a: written.append((*a[:4], dict(a[4]))))
    live = {"id": 3, "started_at": T - 90.0}
    w = drive.ProgressWatcher(tmp_path / "run", {"name": "scope"}, [{"id": 3}], {"stories": {}}, live,
                              tmp_path / "ws", "the-base", [{"n": 1}], Tally())
    w.tables, w.written, w.asked, w.clock, w.live_doc = tables, written, asked, clock, live
    return w


def test_a_refresh_writes_the_story_s_tasks_effort_and_last_commit(tmp_path, watcher):
    table = [{"n": 1, "status": "written"}]
    watcher.tables = iter([table])
    watcher.refresh()
    assert watcher.asked == [(tmp_path / "ws", "the-base")]
    expected = {"id": 3, "started_at": T - 90.0, "last_task_change_at": T, "tasks": table, "last_commit_at": 77.0,
                "calls": 1, "output_tokens": 10, "compactions": 0, "recent_activity": ["call 1"], "agent_minutes": 1.5}
    assert watcher.live_doc == expected
    assert watcher.written == [(tmp_path / "run", {"name": "scope"}, [{"id": 3}], {"stories": {}}, expected)]


def test_the_time_of_the_last_task_change_moves_only_when_the_tasks_change(watcher):
    same, changed = [{"n": 1, "status": "written"}], [{"n": 1, "status": "committed"}]
    watcher.tables = iter([same, [dict(same[0])], changed])
    seen = []
    for at in (T, T + 60, T + 120):
        watcher.clock[0] = at
        watcher.refresh()
        seen.append((watcher.live_doc["last_task_change_at"], watcher.live_doc["agent_minutes"], watcher.live_doc["calls"]))
    assert seen == [(T, 1.5, 1), (T, 2.5, 2), (T + 120, 3.5, 3)]


def test_the_progress_watcher_refreshes_at_once_then_every_poll_and_survives_a_failed_refresh(watcher, monkeypatch, capsys):
    assert watcher.daemon is True
    tables = iter([[], RuntimeError("git is busy"), []])

    def table(tasks, ev):
        t = next(tables)
        if isinstance(t, Exception):
            raise t
        return t
    monkeypatch.setattr(progress, "task_table", table)
    rounds = run_rounds(watcher, 2)
    watcher.stop()
    assert len(watcher.written) == 2 and rounds.waits == [drive.PROGRESS_POLL_S] * 3
    assert capsys.readouterr().out == "    progress refresh failed: git is busy\n"


# ======================= finding and killing what an agent left =======================

def ps(monkeypatch, answers: dict[str, str]) -> list[list[str]]:
    """subprocess.run faked by the command's name: its stdout from answers."""
    calls: list[list[str]] = []

    def run(cmd, **k):
        calls.append(list(cmd))
        return SimpleNamespace(stdout=answers[cmd[0]], returncode=0, stderr="")
    monkeypatch.setattr(drive.subprocess, "run", run)
    return calls


@pytest.mark.parametrize("command, is_agent", [
    ("pi", True), ("pi -p --mode json", True), ("node /opt/tools/pi-coding-agent/dist/cli.js", True),
    ("sandbox-exec -p (version 1) pi", True), ("/opt/tools/opencode run --format json", True),
    ("claude -p --output-format stream-json", True),
    ("node node_modules/vite/bin/vite.js preview", False), ("pip install wheel", False), ("ping localhost", False),
    ("", False),                                                      # the process is gone
])
def test_the_agent_is_known_by_its_command_line(tmp_path, monkeypatch, command, is_agent):
    calls = ps(monkeypatch, {"ps": f"{command}\n"})
    assert drive.is_agent_process(4242, tmp_path) is is_agent
    assert calls == [["ps", "-o", "command=", "-p", "4242"]]


def test_a_run_directory_named_after_a_client_does_not_make_its_tools_the_agent(tmp_path, monkeypatch):
    run_dir = tmp_path / "combinations" / "mlxserve-opencode" / "benchmarks" / "vidi" / "r1"
    ps(monkeypatch, {"ps": f"node {run_dir}/workspace/server.js\n"})
    assert drive.is_agent_process(1, run_dir) is False
    ps(monkeypatch, {"ps": f"opencode run --dir {run_dir}/workspace\n"})
    assert drive.is_agent_process(1, run_dir) is True


def test_workspace_processes_are_found_by_command_line_or_working_directory(tmp_path, monkeypatch):
    ws = tmp_path / "work" / "workspace"
    ws.mkdir(parents=True)
    root = str(ws.resolve())
    lsof = f"p20\nfcwd\nn/somewhere/else\np21\nfcwd\nn{root}\np22\nfcwd\nn{root}/sub/dir\np23\nfcwd\nn{root}-sibling\nn{root}\n"
    calls = ps(monkeypatch, {"pgrep": f"11\n12\n{os.getpid()}\n", "lsof": "n" + root + "\n" + lsof})
    assert drive.workspace_pids(ws) == {11, 12, 21, 22, 23}            # 23: lsof's second name line for it is the workspace
    assert calls == [["pgrep", "-f", root], ["lsof", "-d", "cwd", "-Fpn"]]


def test_workspace_processes_can_leave_out_the_agent_itself(tmp_path, monkeypatch):
    ws = tmp_path / "work" / "workspace"
    ws.mkdir(parents=True)
    ps(monkeypatch, {"pgrep": "11\n12\n", "lsof": ""})
    asked = []
    monkeypatch.setattr(drive, "is_agent_process", lambda pid, run_dir: asked.append(run_dir) or pid == 12)
    assert drive.workspace_pids(ws, spare_agent=True) == {11}
    assert set(asked) == {ws.resolve().parent}


def test_kill_pids_terminates_each_and_ignores_the_gone_and_the_forbidden(monkeypatch):
    sent = []

    def kill(pid, sig):
        sent.append((pid, sig))
        if pid == 2:
            raise ProcessLookupError
        if pid == 3:
            raise PermissionError
    monkeypatch.setattr(drive.os, "kill", kill)
    drive.kill_pids({1, 2, 3, 4})
    assert sorted(sent) == [(n, signal.SIGTERM) for n in (1, 2, 3, 4)]


@pytest.mark.parametrize("error", [ProcessLookupError, PermissionError])
def test_a_process_that_is_gone_or_not_ours_has_no_group_and_its_group_is_not_alive(monkeypatch, error):
    def refuse(*a):
        raise error
    monkeypatch.setattr(drive.os, "getpgid", refuse)
    monkeypatch.setattr(drive.os, "killpg", refuse)
    assert drive._pgid(4242) is None and drive._group_alive(4242) is False


def test_a_live_process_has_its_group_and_a_group_that_takes_a_signal_is_alive(monkeypatch):
    sent = []
    monkeypatch.setattr(drive.os, "getpgid", lambda pid: pid + 1)
    monkeypatch.setattr(drive.os, "killpg", lambda pgid, sig: sent.append((pgid, sig)))
    assert drive._pgid(10) == 11 and drive._group_alive(11) is True and sent == [(11, 0)]


@pytest.fixture
def groups(monkeypatch):
    """kill_process_groups with the processes scripted: groups.pgid, groups.alive, and what was sent."""
    g = SimpleNamespace(pgid={}, alive=set(), sent=[], singles=[], slept=[], refuse={})

    def killpg(pgid, sig):
        g.sent.append((pgid, sig))
        if pgid in g.refuse:
            raise g.refuse[pgid]
    monkeypatch.setattr(drive, "_pgid", lambda pid: g.pgid.get(pid))
    monkeypatch.setattr(drive.os, "killpg", killpg)
    monkeypatch.setattr(drive, "kill_pids", lambda pids: g.singles.append(set(pids)))
    monkeypatch.setattr(drive, "_group_alive", lambda pgid: pgid in g.alive)
    monkeypatch.setattr(drive.time, "sleep", g.slept.append)
    return g


def test_each_process_is_killed_with_its_group_and_a_group_that_survives_is_killed_outright(groups):
    groups.pgid = {1: 10, 2: 10, 3: 99, 4: None, 5: 50}                # 3 is in a spared group; 4 is already gone
    groups.alive = {10}
    drive.kill_process_groups({1, 2, 3, 4, 5}, spare_pgids={99})
    assert set(groups.sent[:2]) == {(10, signal.SIGTERM), (50, signal.SIGTERM)}
    assert groups.sent[2:] == [(10, signal.SIGKILL)]                   # after the grace period, only what survived
    assert groups.singles == [{3}] and groups.slept == [drive.KILL_GRACE_S]


def test_groups_that_die_at_the_first_signal_are_not_waited_for(groups):
    groups.pgid = {1: 10}
    drive.kill_process_groups({1}, spare_pgids=set())
    assert groups.sent == [(10, signal.SIGTERM)] and groups.slept == [] and groups.singles == [set()]


@pytest.mark.parametrize("error", [ProcessLookupError(), PermissionError()])
def test_a_group_that_cannot_be_signalled_is_passed_over(groups, error):
    groups.pgid = {1: 10}
    groups.alive = {10}
    groups.refuse = {10: error}
    drive.kill_process_groups({1}, spare_pgids=set())
    assert groups.sent == [(10, signal.SIGTERM), (10, signal.SIGKILL)]


def test_nothing_to_kill_is_nothing_signalled(groups):
    drive.kill_process_groups(set(), spare_pgids={1})
    assert groups.sent == [] and groups.slept == []


PS_TREE = """\
  PID  PPID  PGID
  100     1   100
  101   100   100
  102   101   102
  103   102   102
  103   102   102
  104   100   104
  200     1   200
  201   200   102
"""


def test_what_the_agent_started_is_found_by_parentage_outside_its_own_group(tmp_path, monkeypatch):
    ws = tmp_path / "work" / "workspace"
    ws.mkdir(parents=True)
    monkeypatch.setattr(drive, "AGENT_ROOT_PID", 100)
    calls = ps(monkeypatch, {"ps": PS_TREE})
    asked = []
    monkeypatch.setattr(drive, "is_agent_process", lambda pid, run_dir: asked.append((pid, run_dir)) or pid == 104)
    # 101: the agent's own group. 104: the agent by its command line. 200, 201: not descended from the session.
    assert drive.agent_started_pids(ws) == {102, 103}
    assert calls == [["ps", "-A", "-o", "pid=,ppid=,pgid="]]
    assert {run_dir for _, run_dir in asked} == {ws.resolve().parent} and 101 not in {pid for pid, _ in asked}


def test_nothing_was_started_by_a_session_that_is_not_running(tmp_path, monkeypatch):
    calls = ps(monkeypatch, {"ps": PS_TREE})
    assert drive.agent_started_pids(tmp_path) == set() and calls == []           # no session: ps isn't asked
    monkeypatch.setattr(drive, "AGENT_ROOT_PID", 999)
    assert drive.agent_started_pids(tmp_path) == set() and len(calls) == 1       # the session's process is gone


def test_the_hang_guard_s_kill_takes_the_tools_and_spares_the_agent_and_the_harness(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "AGENT_ROOT_PID", 50)
    monkeypatch.setattr(drive, "workspace_pids", lambda ws, spare_agent=False: {2, 3} if spare_agent else {1, 2, 3})
    monkeypatch.setattr(drive, "agent_started_pids", lambda ws: {4, 50})
    monkeypatch.setattr(drive, "_pgid", {1: 11, 50: 500}.get)
    killed = []
    monkeypatch.setattr(drive, "kill_process_groups", lambda pids, spare: killed.append((pids, spare)))
    drive.kill_workspace_tools(tmp_path)
    assert killed == [({2, 3, 4}, {os.getpgrp(), 11, 500})]           # never the session itself, nor the agent's group


def test_the_hang_guard_s_kill_without_a_session_spares_the_harness_and_what_it_can_still_see(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "workspace_pids", lambda ws, spare_agent=False: {2, 3} if spare_agent else {1, 2, 3})
    monkeypatch.setattr(drive, "agent_started_pids", lambda ws: set())
    monkeypatch.setattr(drive, "_pgid", lambda pid: None)             # the agent in the workspace has just gone
    killed = []
    monkeypatch.setattr(drive, "kill_process_groups", lambda pids, spare: killed.append((pids, spare)))
    drive.kill_workspace_tools(tmp_path)
    assert killed == [({2, 3}, {os.getpgrp()})]


def test_strays_are_everything_in_the_workspace_but_the_harness_s_own_group(tmp_path, monkeypatch):
    monkeypatch.setattr(drive, "workspace_pids", lambda ws: {("pids of", ws)})
    killed = []
    monkeypatch.setattr(drive, "kill_process_groups", lambda pids, spare: killed.append((pids, spare)))
    drive.kill_strays(tmp_path)
    assert killed == [({("pids of", tmp_path)}, {os.getpgrp()})]
