"""containment.py: the orchestrator owns every process the agent starts (tools/agent-containment/PROPOSAL.md).

Pure parts are tested everywhere; the cgroup parts at the end run only on Linux with a systemd user
manager, and never touch anything outside a scope they created."""
import os
import shutil
import signal
import subprocess
import sys
import time

import pytest

import containment as C


def test_the_agent_command_runs_in_its_own_scope_with_a_memory_limit():
    cmd = C.wrap(["sh", "-c", "pi"], unit="spec-bench-canvas-mlx-02-s07-1", memory_max_bytes=12 * 1024 ** 3)
    assert cmd[:5] == ["systemd-run", "--user", "--scope", "--quiet", "--collect"]
    assert "--unit=spec-bench-canvas-mlx-02-s07-1" in cmd
    assert f"MemoryMax={12 * 1024 ** 3}" in cmd
    assert cmd[cmd.index("--") + 1:] == ["sh", "-c", "pi"]


def test_unit_names_are_safe_for_systemd():
    assert C.unit_name("canvas-mlx-02", 7, 2) == "spec-bench-canvas-mlx-02-s07-2"
    assert C.unit_name("run with/odd:chars", 12, 1) == "spec-bench-run-with-odd-chars-s12-1"


@pytest.mark.parametrize("rel,ok", [
    ("/user.slice/user-1000.slice/user@1000.service/app.slice/spec-bench-x-s01-1.scope", True),
    ("", False),                                                     # a failed lookup: never the root
    ("/", False),
    ("/user.slice/user-1001.slice/user@1001.service/app.slice/spec-bench-x-s01-1.scope", False),  # another user
    ("/user.slice/user-1000.slice/user@1000.service/app.slice/other.scope", False),                # another unit
    ("/system.slice/spec-bench-x-s01-1.scope", False),
])
def test_only_this_users_own_scope_is_ever_acted_on(rel, ok):
    """A probe once resolved an empty lookup to the cgroup root and tried to kill everything there."""
    if ok:
        assert C.check_cgroup(rel, unit="spec-bench-x-s01-1", uid=1000) == rel
    else:
        with pytest.raises(C.ContainmentError):
            C.check_cgroup(rel, unit="spec-bench-x-s01-1", uid=1000)


# A process table: pid -> (ppid, start time in seconds since boot, command)
TABLE = {
    100: (1, 10.0, "bwrap"),
    101: (100, 10.5, "pi"),          # the agent
    200: (101, 50.0, "bash"),        # the current tool call
    201: (200, 51.0, "playwright"),
    300: (1, 20.0, "sh"),            # orphaned: its tool call ended long ago
    301: (300, 20.5, "node"),
    302: (301, 21.0, "workerd"),
    400: (1, 49.0, "sh"),            # orphaned seconds ago
}


def test_orphans_are_scope_members_with_no_path_to_the_agent():
    members = set(TABLE)
    assert C.orphans(members, TABLE, agent_pid=101) == {300, 301, 302, 400}


def test_an_interrupted_call_loses_everything_it_started_and_nothing_else():
    """Everything in the scope that started after the tool call began: the call's own tree, including
    servers it detached. The agent, the wrappers above it and processes from earlier calls stay."""
    assert C.interrupt_victims(set(TABLE), TABLE, agent_pid=101, since=45.0) == {200, 201, 400}


def test_a_server_the_call_started_before_the_harness_noticed_the_call_is_still_caught():
    """The harness learns a tool call began from the agent's event stream, which can arrive after the
    call already started a server. Start times, not a membership snapshot, decide."""
    table = {**TABLE, 500: (1, 49.9, "sh")}          # started 0.1 s before the harness noted the call at 50.0
    victims = C.interrupt_victims(set(table), table, agent_pid=101, since=50.0 - C.TOOL_START_SLACK_S)
    assert 500 in victims and 101 not in victims and 100 not in victims


def test_under_memory_pressure_the_oldest_orphans_go_first_after_a_grace_period():
    members = set(TABLE)
    order = C.pressure_victims(members, TABLE, agent_pid=101, now=60.0, grace_s=30.0)
    assert order == [300, 301, 302]          # 400 is only 11 s old: spared, it may be a deliberate server


def test_nothing_is_reaped_when_the_agent_is_not_known():
    """If the agent's pid is not in the scope, the orphan rules cannot tell a leak from the agent."""
    assert C.orphans(set(TABLE), TABLE, agent_pid=999) == set()


# ---------- Linux with a systemd user manager only ----------

LINUX_SCOPES = sys.platform.startswith("linux") and shutil.which("systemd-run") and C.available()
linux = pytest.mark.skipif(not LINUX_SCOPES, reason="needs Linux with a systemd user manager")


def _start(unit: str, script: str, memory_max: int = 256 * 1024 ** 2) -> subprocess.Popen:
    p = subprocess.Popen(C.wrap(["bash", "-c", script], unit=unit, memory_max_bytes=memory_max),
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            if C.members(C.Scope(unit)):
                return p
        except C.ContainmentError:
            pass
        time.sleep(0.2)
    raise AssertionError("scope did not start")


@linux
def test_a_process_that_escapes_by_setsid_and_double_fork_is_still_contained_and_killed():
    unit = f"spec-bench-test-escape-{os.getpid()}"
    p = _start(unit, "setsid bash -c 'sleep 300 & exit'; sleep 300")
    scope = C.Scope(unit)
    time.sleep(1)
    members = C.members(scope)
    escaped = [m for m in members if C.proc_table(members)[m][0] == 1]
    assert escaped, "the double-forked sleep should be reparented to init yet still listed"
    C.kill_all(scope)
    p.wait(timeout=10)
    deadline = time.time() + 5
    while time.time() < deadline and any(C._alive(m) for m in members):
        time.sleep(0.2)
    assert not any(C._alive(m) for m in members)


@linux
def test_interrupt_reaping_kills_only_what_started_after_the_snapshot():
    unit = f"spec-bench-test-interrupt-{os.getpid()}"
    p = _start(unit, "sleep 300 & echo $! > /tmp/early-$$; sleep 2; setsid bash -c 'sleep 300 & exit'; sleep 300")
    scope = C.Scope(unit)
    at_start = C.members(scope)
    mark = C.uptime_s()
    time.sleep(3)
    now = C.members(scope)
    victims = C.interrupt_victims(now, C.proc_table(now), agent_pid=p.pid, since=mark)
    assert victims and victims.isdisjoint(at_start)
    C.signal_members(scope, victims)
    time.sleep(1)
    assert all(C._alive(m) for m in at_start if m in C.members(scope))
    assert not any(C._alive(v) for v in victims)
    C.kill_all(scope)
    p.wait(timeout=10)


@linux
def test_the_memory_limit_is_enforced_inside_the_scope_only():
    unit = f"spec-bench-test-memory-{os.getpid()}"
    limit = 64 * 1024 ** 2
    hog = "python3 -c \"b = bytearray(256 * 1024 * 1024); import time; time.sleep(30)\""
    p = _start(unit, f"{hog}; sleep 30", memory_max=limit)
    scope = C.Scope(unit)
    time.sleep(3)
    mem = C.memory(scope)
    assert mem["max"] == limit and mem["current"] <= limit
    C.kill_all(scope)
    p.wait(timeout=10)


# ---------- the per-story orchestration the harness uses ----------

def test_without_containment_the_harness_runs_as_before():
    s = C.StoryContainment("canvas-mlx-02", 7, enabled=False)
    assert s.wrap(["pi"]) == ["pi"]
    s.started(123)
    s.note_tool_start()
    assert s.reap_interrupted() == [] and s.reap_pressure() == []
    assert s.finish() == {"enabled": False}


def test_an_interrupt_without_a_tool_call_snapshot_reaps_nothing():
    """No snapshot (a client whose events the harness cannot read) means no way to tell what the call
    started: then nothing is reaped, rather than everything but the agent."""
    s = C.StoryContainment("r", 1, enabled=True)
    s.agent_pid = 42
    assert s.reap_interrupted() == []


def test_the_memory_limit_leaves_a_reserve_and_has_a_floor():
    gib = 1024 ** 3
    assert C.memory_limit(available_bytes=40 * gib) == 40 * gib - C.RESERVE_BYTES
    assert C.memory_limit(available_bytes=2 * gib) == C.MIN_MEMORY_MAX


@linux
def test_a_fake_agent_leaking_a_detached_server_through_an_interrupted_call_loses_it():
    """The gruntus case in miniature: after the tool call starts, it launches a server in its own
    session and is then cut off. The server must go, the agent must stay, and the reaping must be
    recorded; at the end of the story the scope is emptied."""
    s = C.StoryContainment(f"test-{os.getpid()}", 1)
    agent = subprocess.Popen(s.wrap(["bash", "-c", "sleep 2; setsid sleep 300 </dev/null >/dev/null 2>&1 & sleep 300"]),
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    s.started(agent.pid)
    deadline = time.time() + 10
    while time.time() < deadline and not s.current_members():
        time.sleep(0.2)
    s.note_tool_start()                      # the tool call begins
    time.sleep(3)                            # ...and starts a detached server
    reaped = s.reap_interrupted()            # the harness cuts the call off
    assert reaped and all(r["rule"] == "interrupted" for r in reaped)
    assert any(r["comm"] == "sleep" for r in reaped)
    assert C._alive(agent.pid)
    summary = s.finish()
    agent.wait(timeout=10)
    assert summary["enabled"] and summary["reaped"] == reaped and summary["units"]
    assert not s.current_members()
