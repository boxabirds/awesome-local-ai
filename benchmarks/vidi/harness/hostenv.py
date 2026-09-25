"""Host adapters: the few things the harness asks of the operating system, per platform.

macOS keeps its original implementations (sandbox-exec, pmset, sysctl, footprint,
memory_pressure). Linux uses bubblewrap for the agent sandbox, /sys and /proc for
power and memory, and nvidia-smi for GPU thermal throttling. Parsers are separate
from the commands so they can be tested on captured output from each machine.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

IS_MAC = sys.platform == "darwin"
KIB_PER_GIB = 1024 ** 2
MIB_PER_GIB = 1024
PERCENT = 100
POWER_SUPPLY_DIR = Path("/sys/class/power_supply")
PLATFORM_PROFILE = Path("/sys/firmware/acpi/platform_profile")
LOW_POWER_PROFILES = {"low-power", "quiet", "cool"}
# Thermal states that count as fit to measure. macOS reports "nominal"; a Linux host with
# no GPU/thermal source reports "unmonitored" rather than blocking every story forever.
THERMAL_OK = {"nominal", "unmonitored"}
# Both names exist: drivers from 530 on say clocks_event_reasons, older ones clocks_throttle_reasons.
NVIDIA_THERMAL_FIELDS = ("clocks_event_reasons.hw_thermal_slowdown,clocks_event_reasons.sw_thermal_slowdown",
                         "clocks_throttle_reasons.hw_thermal_slowdown,clocks_throttle_reasons.sw_thermal_slowdown")


def playwright_cache(real_home: Path) -> Path:
    """Where Playwright keeps its browsers by default on this OS (shared with the agent's isolated HOME)."""
    return real_home / ("Library/Caches" if IS_MAC else ".cache") / "ms-playwright"


def _out(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True).stdout
    except FileNotFoundError:
        return ""


# ---------- sandbox ----------

def bwrap_wrap(cmd: list[str], own_dir: Path, deny: list[Path], reopen_ro: list[Path] | None = None) -> list[str]:
    """Linux: everything visible and writable as normal, except each denied path, which is
    masked (a directory by an empty tmpfs, a file by /dev/null); own_dir is then bound back on
    top. bwrap applies mounts in order, so own_dir must come after the mask that covers it.
    Paths that don't exist are skipped: masking them would create them on the host."""
    # --bind / / is mounted nodev; bind the real /dev back so /dev/null, /dev/shm and ptys work.
    args = ["bwrap", "--die-with-parent", "--bind", "/", "/", "--dev-bind", "/dev", "/dev"]
    for p in deny:
        if p.is_dir():
            args += ["--tmpfs", str(p.resolve())]
        elif p.exists():
            args += ["--ro-bind", "/dev/null", str(p.resolve())]
    for p in reopen_ro or []:  # after the masks, so they show through them, read-only
        if p.exists():
            args += ["--ro-bind", str(p.resolve()), str(p.resolve())]
    own = str(own_dir.resolve())
    return [*args, "--bind", own, own, "--", *cmd]


# ---------- power ----------

def parse_linux_power(supplies: list[dict], platform_profile: str | None) -> dict:
    """AC unless a system battery exists and no mains supply is online. Device batteries
    (a wireless mouse reports one) have scope=Device and are ignored."""
    system_batteries = [s for s in supplies if s.get("type") == "Battery" and s.get("scope") != "Device"]
    mains_online = any(s.get("type") == "Mains" and s.get("online") == "1" for s in supplies)
    ac = mains_online or not system_batteries
    return {"ac": ac, "low_power": (platform_profile or "").strip() in LOW_POWER_PROFILES}


def linux_power() -> dict:
    supplies = []
    if POWER_SUPPLY_DIR.is_dir():
        for d in POWER_SUPPLY_DIR.iterdir():
            supplies.append({k: (d / k).read_text().strip() for k in ("type", "scope", "online", "status")
                             if (d / k).is_file()})
    profile = PLATFORM_PROFILE.read_text() if PLATFORM_PROFILE.is_file() else None
    return parse_linux_power(supplies, profile)


# ---------- thermal ----------

def parse_nvidia_thermal(csv: str) -> str:
    """One line per GPU of 'Active'/'Not Active' flags; any active thermal slowdown = throttled."""
    flags = [f.strip() for line in csv.strip().splitlines() for f in line.split(",")]
    return "throttled" if "Active" in flags else "nominal"


def linux_thermal() -> str:
    if not shutil.which("nvidia-smi"):
        return "unmonitored"
    for fields in NVIDIA_THERMAL_FIELDS:
        out = _out(["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader"])
        if out.strip() and "Field" not in out:
            return parse_nvidia_thermal(out)
    return "unmonitored"


# ---------- memory ----------

def parse_meminfo(text: str) -> dict[str, int]:
    """/proc/meminfo -> {key: kB}."""
    return {m.group(1): int(m.group(2)) for m in re.finditer(r"^(\w+):\s+(\d+)\s*kB", text, re.M)}


def free_pct_from_meminfo(m: dict[str, int]) -> float:
    return PERCENT * m["MemAvailable"] / m["MemTotal"]


def swap_used_gb_from_meminfo(m: dict[str, int]) -> float:
    return (m.get("SwapTotal", 0) - m.get("SwapFree", 0)) / KIB_PER_GIB


def parse_memory_pressure_free_pct(out: str) -> float | None:
    m = re.search(r"free percentage:\s*(\d+)%", out)
    return float(m.group(1)) if m else None


def parse_proc_status_gb(status: str) -> tuple[float | None, float | None]:
    """(VmRSS, VmHWM) in GB: resident now and its peak, for a Linux process."""
    def grab(key):
        m = re.search(rf"^{key}:\s+(\d+)\s*kB", status, re.M)
        return int(m.group(1)) / KIB_PER_GIB if m else None
    return grab("VmRSS"), grab("VmHWM")


def mem_free_pct() -> float | None:
    if IS_MAC:
        return parse_memory_pressure_free_pct(_out(["memory_pressure", "-Q"]))
    return free_pct_from_meminfo(parse_meminfo(Path("/proc/meminfo").read_text()))


def linux_swap_used_gb() -> float:
    return swap_used_gb_from_meminfo(parse_meminfo(Path("/proc/meminfo").read_text()))


def linux_process_gb(pid: int) -> tuple[float | None, float | None]:
    try:
        return parse_proc_status_gb(Path(f"/proc/{pid}/status").read_text())
    except OSError:
        return None, None
