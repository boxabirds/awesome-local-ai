"""The orchestrator owns every process the agent starts (tools/agent-containment/PROPOSAL.md).

On Linux with a systemd user manager each agent session runs in its own scope (a cgroup). A process
cannot leave its cgroup the way it can leave its process group (setsid, double forks, reparenting),
so the harness can list, measure, cap and kill everything the agent ever started, including servers
whose starter died without stopping them. Elsewhere (macOS) this module reports itself unavailable
and the harness keeps its process-group clean-up.

Safety: every cgroup path is checked to be this user's own scope before anything reads or kills
through it, and a process is signalled only if the kernel says it is in that scope.
"""
from __future__ import annotations

import os
import re
import shutil
import signal
import subprocess
import sys
from pathlib import Path

CGROUP_ROOT = Path("/sys/fs/cgroup")
UNIT_PREFIX = "spec-bench"
SYSTEMCTL_TIMEOUT_S = 10


# systemd-run finds the user's manager through these.
LAUNCHER_ENV = ("XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")


class ContainmentError(RuntimeError):
    pass


def available() -> bool:
    """Linux, cgroup v2, and a reachable systemd user manager."""
    if not sys.platform.startswith("linux") or not shutil.which("systemd-run"):
        return False
    if not (CGROUP_ROOT / "cgroup.controllers").exists() or not os.environ.get("XDG_RUNTIME_DIR"):
        return False
    try:
        r = subprocess.run(["systemctl", "--user", "show", "-p", "Version", "--value"],
                           capture_output=True, text=True, timeout=SYSTEMCTL_TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired):
        return False
    if r.returncode != 0 or not r.stdout.strip():
        return False
    return _trial_scope()


_TRIAL: bool | None = None


def _trial_scope() -> bool:
    """Once per process: can this environment actually start a scope? If not, containment stays off
    and the agent runs as before, rather than failing to start at all."""
    global _TRIAL
    if _TRIAL is None:
        try:
            r = subprocess.run(["systemd-run", "--user", "--scope", "--quiet", "--collect", "--", "true"],
                               capture_output=True, text=True, timeout=SYSTEMCTL_TIMEOUT_S)
            _TRIAL = r.returncode == 0
            if not _TRIAL:
                print(f"    containment off: systemd-run failed: {(r.stderr or r.stdout).strip()[:200]}", flush=True)
        except (OSError, subprocess.TimeoutExpired) as e:
            print(f"    containment off: {e}", flush=True)
            _TRIAL = False
    return _TRIAL


def unit_name(run: str, story: int, attempt: int) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "-", run).strip("-")
    return f"{UNIT_PREFIX}-{safe}-s{story:02d}-{attempt}"


def wrap(cmd: list[str], unit: str, memory_max_bytes: int) -> list[str]:
    """cmd, run in its own transient scope with a memory limit; the scope goes away when it empties."""
    return ["systemd-run", "--user", "--scope", "--quiet", "--collect", f"--unit={unit}",
            "-p", f"MemoryMax={int(memory_max_bytes)}", "--", *cmd]


def check_cgroup(rel: str, unit: str, uid: int) -> str:
    """rel (as systemd reports a unit's ControlGroup), only if it is this user's own scope for unit."""
    prefix = f"/user.slice/user-{uid}.slice/user@{uid}.service/"
    if not rel or not rel.startswith(prefix) or not rel.endswith(f"/{unit}.scope"):
        raise ContainmentError(f"not {unit}'s own scope: {rel!r}")
    return rel


class Scope:
    """One agent session's scope, found by its unit name and checked before every use."""

    def __init__(self, unit: str):
        self.unit = unit
        self.uid = os.getuid()

    @property
    def rel(self) -> str:
        try:
            r = subprocess.run(["systemctl", "--user", "show", "-p", "ControlGroup", "--value", f"{self.unit}.scope"],
                               capture_output=True, text=True, timeout=SYSTEMCTL_TIMEOUT_S)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise ContainmentError(f"{self.unit}: {e}") from e
        return check_cgroup(r.stdout.strip(), self.unit, self.uid)

    @property
    def path(self) -> Path:
        p = CGROUP_ROOT / self.rel.lstrip("/")
        if not p.is_dir():
            raise ContainmentError(f"{self.unit}: {p} does not exist")
        return p


def members(scope: Scope) -> set[int]:
    try:
        return {int(x) for x in (scope.path / "cgroup.procs").read_text().split()}
    except FileNotFoundError:
        return set()


def memory(scope: Scope) -> dict:
    """Bytes: current, peak (kernels that keep it) and the limit (None when unlimited)."""
    p = scope.path
    def read(name):
        try:
            v = (p / name).read_text().strip()
        except FileNotFoundError:
            return None
        return None if v == "max" else int(v)
    return {"current": read("memory.current"), "peak": read("memory.peak"), "max": read("memory.max")}


def _clock_ticks() -> int:
    return os.sysconf("SC_CLK_TCK")


def proc_table(pids: set[int]) -> dict[int, tuple[int, float, str]]:
    """pid -> (parent pid, start time in seconds since boot, command name), for those still alive."""
    out = {}
    ticks = _clock_ticks()
    for pid in pids:
        try:
            stat = Path(f"/proc/{pid}/stat").read_text()
        except OSError:
            continue
        comm = stat[stat.index("(") + 1:stat.rindex(")")]
        fields = stat[stat.rindex(")") + 2:].split()
        # fields[0] is state (stat field 3): ppid is stat field 4, starttime stat field 22
        out[pid] = (int(fields[1]), int(fields[19]) / ticks, comm)
    return out


def uptime_s() -> float:
    return float(Path("/proc/uptime").read_text().split()[0])


def _ancestors(pid: int, table: dict) -> set[int]:
    seen = set()
    while pid in table and pid not in seen:
        seen.add(pid)
        pid = table[pid][0]
    return seen


def orphans(scope_members: set[int], table: dict, agent_pid: int) -> set[int]:
    """Members with no path to the agent: their starter is gone. The agent and the wrappers above it
    are never orphans. Without the agent in the table nothing can be told apart, so nothing is."""
    if agent_pid not in table:
        return set()
    above = _ancestors(agent_pid, table)
    out = set()
    for m in scope_members:
        if m in above or m not in table:
            continue
        x, seen = m, set()
        while x in table and x != agent_pid and x not in seen:
            seen.add(x)
            x = table[x][0]
        if x != agent_pid:
            out.add(m)
    return out


TOOL_START_SLACK_S = 2.0   # the harness hears of a tool call from the agent's events, a little after it began


def interrupt_victims(scope_members: set[int], table: dict, agent_pid: int, since: float) -> set[int]:
    """What a tool call the harness is interrupting started: members that started at or after `since`
    (seconds since boot), never the agent or the wrappers above it. Start times, not a snapshot of
    members, so a server the call started before the harness read its event is still caught."""
    keep = _ancestors(agent_pid, table) | {agent_pid}
    return {m for m in scope_members if m in table and m not in keep and table[m][1] >= since}


def pressure_victims(scope_members: set[int], table: dict, agent_pid: int, now: float, grace_s: float) -> list[int]:
    """Orphans older than the grace period, oldest first (a server the agent backgrounded moments ago
    is spared)."""
    cands = [m for m in orphans(scope_members, table, agent_pid) if now - table[m][1] >= grace_s]
    return sorted(cands, key=lambda m: table[m][1])


def _in_scope(pid: int, scope: Scope) -> bool:
    try:
        lines = Path(f"/proc/{pid}/cgroup").read_text().splitlines()
    except OSError:
        return False
    return f"0::{scope.rel}" in lines


def signal_members(scope: Scope, pids: set[int] | list[int], sig: int = signal.SIGKILL) -> list[int]:
    """Signal each pid the kernel confirms is in this scope; returns those signalled."""
    done = []
    for pid in pids:
        if _in_scope(pid, scope):
            try:
                os.kill(pid, sig)
                done.append(pid)
            except (ProcessLookupError, PermissionError):
                pass
    return done


def kill_all(scope: Scope) -> None:
    """Every process in the scope at once (cgroup.kill: no race with processes forking meanwhile)."""
    (scope.path / "cgroup.kill").write_text("1")


def _alive(pid: int) -> bool:
    try:
        state = Path(f"/proc/{pid}/stat").read_text()
    except OSError:
        return False
    return state[state.rindex(")") + 2] != "Z"


# ---------- one story's containment, as the harness uses it ----------

GIB = 1024 ** 3
RESERVE_BYTES = 4 * GIB        # left outside the agent's limit for the operating system and the harness
MIN_MEMORY_MAX = 4 * GIB       # never cap the agent below this, however little is free at the start
PRESSURE_GRACE_S = 600         # an orphan younger than this may be a server the agent just backgrounded
KIB = 1024


def memory_limit(available_bytes: int) -> int:
    """The agent's memory limit: what is available when its session starts, less a reserve."""
    return max(MIN_MEMORY_MAX, available_bytes - RESERVE_BYTES)


def _available_bytes() -> int:
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) * KIB
    return MIN_MEMORY_MAX


def _rss_gb(pid: int) -> float | None:
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("VmRSS:"):
                return round(int(line.split()[1]) * KIB / GIB, 2)
    except OSError:
        pass
    return None


class StoryContainment:
    """A story's agent sessions (one scope per attempt), what was reaped from them and why, and the
    whole-scope kill at the end of the story. Disabled (off Linux, or no systemd user manager), every
    method is a no-op and the harness behaves as before. Containment problems are logged, never raised:
    they must not end a run."""

    def __init__(self, run: str, story: int, enabled: bool | None = None, log=print):
        self.enabled = available() if enabled is None else enabled
        self.run, self.story, self.log = run, story, log
        self.attempt = 0
        self.scopes: list[Scope] = []
        self.agent_pid: int | None = None
        self.call_start: float | None = None      # seconds since boot, less TOOL_START_SLACK_S
        self.reaped: list[dict] = []
        self.memory_max: int | None = None
        self.peaks: dict[str, int | None] = {}

    def wrap(self, cmd: list[str]) -> list[str]:
        if not self.enabled:
            return cmd
        self.attempt += 1
        unit = unit_name(self.run, self.story, self.attempt)
        self.memory_max = memory_limit(_available_bytes())
        self.scopes.append(Scope(unit))
        self.call_start = None
        return wrap(cmd, unit, self.memory_max)

    def launcher_env(self) -> dict:
        """What systemd-run needs in its own environment to reach the user's manager. agent-sandbox drops it before
        the agent starts (--keep-env), so the agent never has it."""
        if not self.enabled:
            return {}
        return {k: os.environ[k] for k in LAUNCHER_ENV if k in os.environ}

    def started(self, pid: int) -> None:
        self.agent_pid = pid

    def current_members(self) -> set[int]:
        if not self.enabled or not self.scopes:
            return set()
        try:
            return members(self.scopes[-1])
        except ContainmentError as e:
            self.log(f"    containment: {e}")
            return set()

    def note_tool_start(self) -> None:
        if self.enabled:
            try:
                self.call_start = uptime_s() - TOOL_START_SLACK_S
            except OSError as e:
                self.log(f"    containment: {e}")

    def _reap(self, pids, rule: str) -> list[dict]:
        scope = self.scopes[-1]
        table = proc_table(set(pids))
        now = uptime_s()
        records = [{"pid": p, "comm": table[p][2], "age_s": round(now - table[p][1]), "rss_gb": _rss_gb(p),
                    "rule": rule} for p in pids if p in table]
        done = set(signal_members(scope, [r["pid"] for r in records]))
        records = [r for r in records if r["pid"] in done]
        self.reaped += records
        if records:
            gb = sum(r["rss_gb"] or 0 for r in records)
            self.log(f"    containment: reaped {len(records)} process(es), {gb:.1f} GB ({rule})")
        return records

    def reap_interrupted(self) -> list[dict]:
        """What the tool call the harness is interrupting started, the agent excepted."""
        if not self.enabled or self.call_start is None or self.agent_pid is None:
            return []
        try:
            m = self.current_members()
            victims = interrupt_victims(m, proc_table(m), self.agent_pid, self.call_start)
            return self._reap(victims, "interrupted") if victims else []
        except (ContainmentError, OSError) as e:
            self.log(f"    containment: {e}")
            return []

    def reap_pressure(self) -> list[dict]:
        """Orphans past the grace period, oldest first, when memory is short."""
        if not self.enabled or self.agent_pid is None:
            return []
        try:
            m = self.current_members()
            victims = pressure_victims(m, proc_table(m), self.agent_pid, uptime_s(), PRESSURE_GRACE_S)
            return self._reap(victims, "memory pressure") if victims else []
        except (ContainmentError, OSError) as e:
            self.log(f"    containment: {e}")
            return []

    def finish(self) -> dict:
        """Kill whatever is left in the story's scopes; the record for the story's telemetry."""
        if not self.enabled:
            return {"enabled": False}
        left = 0
        for scope in self.scopes:
            try:
                mem = memory(scope)
                self.peaks[scope.unit] = mem["peak"] if mem["peak"] is not None else mem["current"]
                left += len(members(scope))
                kill_all(scope)
            except (ContainmentError, OSError):
                continue          # an emptied scope is collected and gone: nothing left to kill
        peak = max((v for v in self.peaks.values() if v is not None), default=None)
        return {"enabled": True, "units": [s.unit for s in self.scopes],
                "memory_max_gb": round(self.memory_max / GIB, 1) if self.memory_max else None,
                "memory_peak_gb": round(peak / GIB, 2) if peak is not None else None,
                "left_at_story_end": left, "reaped": self.reaped}
