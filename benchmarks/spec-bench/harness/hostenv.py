"""Host adapters: the few things the harness asks of the operating system, per platform.

macOS keeps its original implementations (pmset, sysctl, footprint, memory_pressure).
Linux uses /sys and /proc for power and memory, and nvidia-smi for GPU thermal
throttling. (The agent's sandbox is sandbox.py, on both.) Parsers are separate
from the commands so they can be tested on captured output from each machine.
"""
from __future__ import annotations

import os
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


HOST_DESC_SH = Path(__file__).resolve().parent / "host-desc.sh"
HOST_DESC_TIMEOUT_S = 30


def host_desc(run=subprocess.run) -> str:
    """This machine as public records name it: its hardware ("<cpu> <ram>GB, <gpu>"), from host-desc.sh, the
    same line run.sh puts in run.json. Never its hostname (machine_names.py). "" when it can't be read."""
    try:
        r = run(["bash", "-c", f'. "{HOST_DESC_SH}"; host_desc'], capture_output=True, text=True,
                timeout=HOST_DESC_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        return ""
    return r.stdout.strip() if r.returncode == 0 else ""


def bench_home() -> Path:
    """All benchmark state on this machine (hidden from agents): work/, keys/, reference/, logs."""
    return Path(os.environ.get("VIDI_BENCH_HOME", Path.home() / ".vidi-bench")).expanduser().resolve()


def playwright_cache(real_home: Path) -> Path:
    """Where Playwright keeps its browsers by default on this OS: the held-out suite's browsers."""
    return real_home / ("Library/Caches" if IS_MAC else ".cache") / "ms-playwright"


def agent_playwright_cache(real_home: Path) -> Path:
    """The agents' browsers, shared by every run on this machine but never with the held-out suite:
    `playwright install` deletes browsers no project it can see uses, and the suite is hidden from agents."""
    return real_home / ".cache" / "vidi-agent-ms-playwright"


def _out(cmd: list[str]) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True).stdout
    except FileNotFoundError:
        return ""


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


def parse_proc_status_split_mib(status: str) -> dict | None:
    """{anon_mib, file_mib}: a Linux process's resident memory split into anonymous (heap, GPU-mapped, copies) and
    file-backed (mapped weights, the page cache it touches). None when the kernel did not report both."""
    def grab(key):
        m = re.search(rf"^{key}:\s+(\d+)\s*kB", status, re.M)
        return round(int(m.group(1)) / 1024, 1) if m else None
    anon, file = grab("RssAnon"), grab("RssFile")
    return {"anon_mib": anon, "file_mib": file} if anon is not None and file is not None else None


def linux_process_split(pid: int) -> dict | None:
    try:
        return parse_proc_status_split_mib(Path(f"/proc/{pid}/status").read_text())
    except OSError:
        return None


def mem_free_pct() -> float | None:
    if IS_MAC:
        return parse_memory_pressure_free_pct(_out(["memory_pressure", "-Q"]))
    return free_pct_from_meminfo(parse_meminfo(Path("/proc/meminfo").read_text()))




# ---------- who the kernel kills first ----------
# Linux's OOM killer picks the biggest process, which on a bench machine is the model server. The
# agent's whole process tree (its tests, dev servers, browsers) is made the preferred victim instead.
# Raising a score needs no root, and it lives and dies with the processes: nothing on the system changes.
AGENT_OOM_SCORE_ADJ = 1000


def oom_first(cmd: list[str], linux: bool = not IS_MAC) -> list[str]:
    """cmd, started with a raised OOM score that every child inherits (from before its first fork)."""
    if not linux:
        return cmd
    return ["sh", "-c", f'echo {AGENT_OOM_SCORE_ADJ} > /proc/self/oom_score_adj 2>/dev/null; exec "$@"',
            "oom-first", *cmd]

# ---------- what holds memory, when it runs low ----------
SNAPSHOT_TOP = 15
SNAPSHOT_PROGRAMS = 10
COMMAND_CHARS = 200
_SECRET_FLAG = re.compile(r"(--?[\w-]*(?:key|token|secret|password)[\w-]*)([ =])(\S+)", re.I)


def _clean_command(args: str, home: str) -> str:
    """Run folders are published: no home paths and no keys in a recorded command line."""
    args = _SECRET_FLAG.sub(lambda m: f"{m.group(1)}{m.group(2)}***", args.replace(home, "~"))
    return args[:COMMAND_CHARS]


def parse_memory_snapshot(ps_out: str, home: str, top: int = SNAPSHOT_TOP, comm_out: str = "") -> dict:
    """`ps -axo pid=,rss=,args=` (rss in KiB, on macOS and Linux alike): the biggest processes, and
    totals per program so that many small processes (a dozen browsers) show up too. Program names
    come from `ps -axo pid=,comm=` when given: an executable path may contain spaces."""
    names = {}
    for line in comm_out.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2 and parts[0].isdigit():
            names[int(parts[0])] = Path(parts[1].strip()).name
    procs = []
    for line in ps_out.splitlines():
        parts = line.split(None, 2)
        if len(parts) < 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        procs.append({"pid": int(parts[0]), "rss_gb": int(parts[1]) / KIB_PER_GIB, "args": parts[2]})
    procs.sort(key=lambda p: -p["rss_gb"])
    by_program: dict[str, dict] = {}
    for p in procs:
        name = names.get(p["pid"]) or Path(p["args"].split()[0]).name
        g = by_program.setdefault(name, {"program": name, "count": 0, "rss_gb": 0.0})
        g["count"] += 1
        g["rss_gb"] += p["rss_gb"]
    programs = sorted(by_program.values(), key=lambda g: -g["rss_gb"])[:SNAPSHOT_PROGRAMS]
    return {"total_rss_gb": round(sum(p["rss_gb"] for p in procs), GB_DECIMALS),
            "processes": [{"pid": p["pid"], "rss_gb": round(p["rss_gb"], GB_DECIMALS),
                           "command": _clean_command(p["args"], home)} for p in procs[:top]],
            "by_program": [{**g, "rss_gb": round(g["rss_gb"], GB_DECIMALS)} for g in programs]}


def memory_snapshot() -> dict:
    return parse_memory_snapshot(_out(["ps", "-axo", "pid=,rss=,args="]), str(Path.home()),
                                 comm_out=_out(["ps", "-axo", "pid=,comm="]))

def linux_swap_used_gb() -> float:
    return swap_used_gb_from_meminfo(parse_meminfo(Path("/proc/meminfo").read_text()))


# A containerised engine does not own the host's listening socket: podman puts a port shim there instead, so
# finding the server "by its port" finds the shim. Measuring the shim gave every gufo run a footprint of 0.0 GB
# while it held about 88 GB -- a plausible-looking number that was wrong, and it is the figure that decides what
# fits on a machine. These are the shims podman uses; the engine itself is never one of them.
CONTAINER_SHIMS = ("rootlessport", "conmon", "slirp4netns", "pasta", "podman", "docker-proxy", "containerd-shim")


def is_container_shim(command: str) -> bool:
    """Is this command podman's (or docker's) plumbing rather than a model server?

    Matched on the executable's own name, not anywhere in the line: an engine whose model path merely contains
    the word "podman" is not a shim, and `gufo serve` run from inside a container is the engine.
    """
    first = (command or "").strip().split()[0] if (command or "").strip() else ""
    exe = first.rsplit("/", 1)[-1]
    return exe in CONTAINER_SHIMS


# The process shapes each engine we run presents, as the launchers' coexistence guard knows them. Matched on
# the whole command line, because the distinguishing part is often an argument ("gufo serve", "mtplx serve").
ENGINE_PATTERNS = ("llama-server", "mtplx.server", "mtplx serve", "mlx-serve", "mlx_lm.server",
                   "gufo serve", "gufo-runtime", "tensorfold serve", "engine/strata", "--engine strata")
# A shell watching a log, or a grep, can mention an engine. A model server holds tens of gigabytes, so the real
# one is orders of magnitude larger; this floor keeps a mention from ever being mistaken for it.
ENGINE_MIN_RSS_KB = 1024 * 1024          # 1 GiB


def pick_engine_pid(procs: "list[tuple[int, int, str]]") -> int | None:
    """The pid of the model server among (pid, rss_kb, command) rows, or None.

    The largest process that looks like an engine and is over the floor. Largest, because during a restart two
    may exist and the live one is the one holding the weights; None rather than a guess, because a wrong pid
    gives a plausible figure and this number decides what fits on a machine.
    """
    best = None
    for pid, rss_kb, command in procs:
        line = command or ""
        if is_container_shim(line) or rss_kb < ENGINE_MIN_RSS_KB:
            continue
        if not any(pat in line for pat in ENGINE_PATTERNS):
            continue
        if best is None or rss_kb > best[1]:
            best = (pid, rss_kb)
    return best[0] if best else None


def linux_process_gb(pid: int) -> tuple[float | None, float | None]:
    try:
        return parse_proc_status_gb(Path(f"/proc/{pid}/status").read_text())
    except OSError:
        return None, None


# ---------- GPU: clock, power, temperature, load ----------
# Sampled during each story, so a slow story can be told apart from a throttled chip.

DRM_ROOT = Path("/sys/class/drm")
UW_PER_W = 1_000_000
MILLIDEG_PER_DEG = 1000
BYTES_PER_GIB = 1024 ** 3
MIB_PER_GIB = 1024
GB_DECIMALS = 2
SCLK_RE = re.compile(r"^\d+:\s*(\d+)Mhz\s*\*", re.M)
NVIDIA_GPU_FIELDS = ("utilization.gpu,clocks.sm,clocks.max.sm,power.draw,temperature.gpu,memory.used,"
                     "clocks_throttle_reasons.active")
# A GPU below this load is idle: its clock drops by design, which is not throttling.
BUSY_PCT = 50


def _read(p: Path) -> str | None:
    try:
        return p.read_text().strip()
    except OSError:
        return None


def amdgpu_sample(drm_root: Path = DRM_ROOT) -> dict | None:
    """The first amdgpu card's load, current shader clock, power, edge temperature and GTT in use."""
    for busy in sorted(drm_root.glob("card*/device/gpu_busy_percent")):
        dev = busy.parent
        hwmon = next(iter(sorted(dev.glob("hwmon/hwmon*"))), None)
        sclk = SCLK_RE.search(_read(dev / "pp_dpm_sclk") or "")
        power = _read(hwmon / "power1_average") or _read(hwmon / "power1_input") if hwmon else None
        temp = _read(hwmon / "temp1_input") if hwmon else None
        gtt = _read(dev / "mem_info_gtt_used")
        return {"busy_pct": int(_read(busy) or 0),
                "sclk_mhz": int(sclk.group(1)) if sclk else None,
                "power_w": round(int(power) / UW_PER_W, 1) if power else None,
                "temp_c": int(temp) / MILLIDEG_PER_DEG if temp else None,
                "gtt_gb": round(int(gtt) / BYTES_PER_GIB, GB_DECIMALS) if gtt else None}
    return None


def parse_nvidia_gpu(csv: str) -> dict | None:
    """The first GPU's line of `nvidia-smi --query-gpu=NVIDIA_GPU_FIELDS --format=csv,noheader,nounits`."""
    line = csv.strip().splitlines()[0] if csv.strip() else ""
    f = [x.strip() for x in line.split(",")]
    if len(f) < 7 or not f[0].isdigit():
        return None

    def num(x: str) -> float | None:
        """A field's number, or None for what nvidia-smi can't read ("[N/A]", "[Not Supported]")."""
        try:
            return float(x)
        except ValueError:
            return None
    sclk, vram_mib = num(f[1]), num(f[5])
    return {"busy_pct": int(f[0]), "sclk_mhz": None if sclk is None else int(sclk), "power_w": num(f[3]),
            "temp_c": num(f[4]), "vram_gb": None if vram_mib is None else round(vram_mib / MIB_PER_GIB, GB_DECIMALS),
            "throttle": f[6]}


def gpu_sample() -> dict | None:
    """This machine's GPU now: amdgpu from sysfs, NVIDIA from nvidia-smi; None on a Mac or no GPU."""
    if IS_MAC:
        return None
    s = amdgpu_sample()
    if s is None and shutil.which("nvidia-smi"):
        s = parse_nvidia_gpu(_out(["nvidia-smi", f"--query-gpu={NVIDIA_GPU_FIELDS}", "--format=csv,noheader,nounits"]))
    return s


def summarise_gpu(samples: list[dict]) -> dict | None:
    if not samples:
        return None
    def vals(k, busy_only=False):
        return [s[k] for s in samples if s.get(k) is not None and (not busy_only or s["busy_pct"] >= BUSY_PCT)]
    def agg(fn, k, busy_only=False):
        v = vals(k, busy_only)
        return fn(v) if v else None
    mem_key = "gtt_gb" if any("gtt_gb" in s for s in samples) else "vram_gb"
    busy = vals("busy_pct")
    return {"samples": len(samples),
            "busy_mean_pct": round(sum(busy) / len(busy), 1) if busy else None,
            "sclk_min_busy_mhz": agg(min, "sclk_mhz", busy_only=True),
            "sclk_max_mhz": agg(max, "sclk_mhz"),
            "power_mean_w": agg(lambda v: round(sum(v) / len(v), 1), "power_w"),
            "power_max_w": agg(max, "power_w"),
            "temp_max_c": agg(max, "temp_c"),
            f"{mem_key.removesuffix('_gb')}_max_gb": agg(max, mem_key),
            "throttled_samples": sum(1 for s in samples if s.get("throttle") not in (None, "0x0000000000000000"))}


# ---- the host's own load while a story runs: CPU, stalls, page cache, paging ------------------------------------------
# Linux reads /proc; where a file is missing (macOS has none of them) the figures that need it are None, and the load
# average falls back to os.getloadavg. Why these: the Strata run of 5 Oct 2026 fell from about 100 to about 25 tok/s with its
# GPU "100% busy" at half its power, an engine that computes experts on the CPU and reads weights through the page cache,
# and none of this was recorded (test_host_sample.py).
PROC_STAT = "/proc/stat"
PROC_LOADAVG = "/proc/loadavg"
PROC_MEMINFO = "/proc/meminfo"
PROC_VMSTAT = "/proc/vmstat"
PROC_PRESSURE = "/proc/pressure/{}"
PSI_KINDS = ("cpu", "memory", "io")
PSI_LEVELS = ("some", "full")
CLK_TCK_DEFAULT = 100
TOP_PROCESSES = 3
US_PER_S = 1_000_000.0
KIB_PER_MIB = 1024
DECIMALS = 2
HOST_FIELDS_NONE = {"cpu_busy_pct": None, "cpu_iowait_pct": None, "major_faults_per_s": None, "disk_read_mb_per_s": None,
                    "swap_in_per_s": None, "swap_out_per_s": None}


def _read_text(path: str) -> str | None:
    try:
        return Path(path).read_text()
    except OSError:
        return None


def _list_pids() -> list[int]:
    try:
        return [int(n) for n in os.listdir("/proc") if n.isdigit()]
    except OSError:
        return []


def parse_proc_stat_cpu(text: str | None) -> dict[str, int] | None:
    """The machine-wide `cpu` line of /proc/stat as ticks per kind (user, nice, system, idle, iowait, irq, softirq, steal)."""
    for line in (text or "").splitlines():
        if line.startswith("cpu "):
            names = ("user", "nice", "system", "idle", "iowait", "irq", "softirq", "steal")
            try:
                return dict(zip(names, (int(x) for x in line.split()[1:9])))
            except ValueError:
                return None
    return None


def parse_pressure(text: str | None) -> dict[str, int] | None:
    """A /proc/pressure/<kind> file as the microseconds stalled in total, per level: {"some": us, "full": us}."""
    out: dict[str, int] = {}
    for line in (text or "").splitlines():
        parts = line.split()
        if parts and parts[0] in PSI_LEVELS:
            kv = dict(p.split("=", 1) for p in parts[1:] if "=" in p)
            try:
                out[parts[0]] = int(kv["total"])
            except (KeyError, ValueError):
                continue
    return out or None


def parse_vmstat(text: str | None) -> dict[str, int]:
    out: dict[str, int] = {}
    for line in (text or "").splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].isdigit():
            out[parts[0]] = int(parts[1])
    return out


def parse_pid_stat(line: str | None) -> tuple[int, str, int] | None:
    """(pid, the kernel's short name, utime + stime in ticks) from one /proc/<pid>/stat line. The name sits in parentheses and may
    hold spaces and parentheses itself, so it runs from the first "(" to the last ")"."""
    if not line:
        return None
    try:
        pid = int(line.split(" ", 1)[0])
        name = line[line.index("(") + 1:line.rindex(")")]
        rest = line[line.rindex(")") + 2:].split()
        return pid, name, int(rest[11]) + int(rest[12])      # after the state: ppid ... cmajflt, utime, stime
    except (ValueError, IndexError):
        return None


class HostSampler:
    """One reading of what the host was doing since the last one: CPU busy and iowait, the load average, the share of the interval the
    kernel says work stalled on CPU, memory and disk, the page cache, paging rates, and the busiest processes by their short name. Rates need
    two looks, so the first reading has the instantaneous figures only. The kernel's files are read through `read` so tests can feed captured ones."""

    def __init__(self, read=_read_text, list_pids=_list_pids, clk_tck: int = CLK_TCK_DEFAULT, ncpu: int | None = None):
        self.read, self.list_pids, self.clk_tck = read, list_pids, clk_tck
        self.ncpu = ncpu or os.cpu_count()
        self.prev: dict | None = None

    def _snapshot(self, now: float) -> dict:
        procs: dict[int, tuple[str, int]] = {}
        for pid in self.list_pids():
            parsed = parse_pid_stat(self.read(f"/proc/{pid}/stat"))
            if parsed:
                procs[parsed[0]] = (parsed[1], parsed[2])
        return {"t": now, "cpu": parse_proc_stat_cpu(self.read(PROC_STAT)), "vm": parse_vmstat(self.read(PROC_VMSTAT)), "procs": procs,
                "psi": {k: parse_pressure(self.read(PROC_PRESSURE.format(k))) for k in PSI_KINDS}}

    def _load(self) -> dict:
        parts = (self.read(PROC_LOADAVG) or "").split()
        try:
            return {"load1": float(parts[0]), "load5": float(parts[1]), "load15": float(parts[2])}
        except (IndexError, ValueError):
            try:
                one, five, fifteen = os.getloadavg()
                return {"load1": round(one, DECIMALS), "load5": round(five, DECIMALS), "load15": round(fifteen, DECIMALS)}
            except OSError:
                return {"load1": None, "load5": None, "load15": None}

    def _memory(self) -> dict:
        text = self.read(PROC_MEMINFO)
        m = parse_meminfo(text) if text else {}
        gib = lambda k: round(m[k] / KIB_PER_GIB, 3) if k in m else None
        return {"cache_gb": gib("Cached"), "avail_gb": gib("MemAvailable"),
                "dirty_mb": round(m["Dirty"] / KIB_PER_MIB, DECIMALS) if "Dirty" in m else None}

    def sample(self, now: float) -> dict:
        snap, prev = self._snapshot(now), self.prev
        self.prev = snap
        reading: dict = {"cpus": self.ncpu, **self._load(), **self._memory(), **HOST_FIELDS_NONE, "top": [],
                         "psi": {k: {"some_pct": None, "full_pct": None} for k in PSI_KINDS}}
        dt = (now - prev["t"]) if prev else 0.0
        if prev is None or dt <= 0:
            return reading
        if snap["cpu"] and prev["cpu"]:
            d = {k: snap["cpu"][k] - prev["cpu"][k] for k in snap["cpu"]}
            total = sum(d.values())
            if total > 0:
                reading["cpu_busy_pct"] = round(PERCENT * (total - d["idle"] - d["iowait"]) / total, DECIMALS)
                reading["cpu_iowait_pct"] = round(PERCENT * d["iowait"] / total, DECIMALS)
        for kind in PSI_KINDS:
            now_t, then_t = snap["psi"][kind], prev["psi"][kind]
            if now_t and then_t:
                for level in PSI_LEVELS:
                    if level in now_t and level in then_t:
                        reading["psi"][kind][f"{level}_pct"] = round(PERCENT * (now_t[level] - then_t[level]) / (dt * US_PER_S), DECIMALS)
        vm, vm0 = snap["vm"], prev["vm"]
        rate = lambda k: round((vm[k] - vm0[k]) / dt, DECIMALS) if k in vm and k in vm0 else None
        reading["major_faults_per_s"] = rate("pgmajfault")
        reading["swap_in_per_s"], reading["swap_out_per_s"] = rate("pswpin"), rate("pswpout")
        if "pgpgin" in vm and "pgpgin" in vm0:
            reading["disk_read_mb_per_s"] = round((vm["pgpgin"] - vm0["pgpgin"]) / KIB_PER_MIB / dt, DECIMALS)   # pgpgin counts KiB
        busy = [(name, (ticks - prev["procs"][pid][1]) / self.clk_tck / dt * PERCENT)
                for pid, (name, ticks) in snap["procs"].items() if pid in prev["procs"] and ticks > prev["procs"][pid][1]]
        busy.sort(key=lambda x: -x[1])
        reading["top"] = [{"comm": name, "cpu_pct": round(pct, DECIMALS)} for name, pct in busy[:TOP_PROCESSES]]
        return reading


def _med(xs: list[float]) -> float | None:
    return round(sorted(xs)[len(xs) // 2] if len(xs) % 2 else (sorted(xs)[len(xs) // 2 - 1] + sorted(xs)[len(xs) // 2]) / 2, DECIMALS) if xs else None


def summarise_host(readings: list[dict]) -> dict | None:
    """A story's host readings as peaks and typical values (the series is in conditions.jsonl); None when there were none."""
    hosts = [r["host"] for r in readings if isinstance(r.get("host"), dict)]
    if not hosts:
        return None

    def vals(get) -> list[float]:
        out = []
        for h in hosts:
            try:
                v = get(h)
            except (KeyError, TypeError):
                continue
            if v is not None:
                out.append(v)
        return out

    peak = lambda xs: max(xs) if xs else None
    busy, cache = vals(lambda h: h["cpu_busy_pct"]), vals(lambda h: h["cache_gb"])
    lead = [h["top"][0]["comm"] for h in hosts if h.get("top")]
    return {"samples": len(hosts),
            "cpu_busy_pct": {"median": _med(busy), "max": peak(busy)} if busy else None,
            "load1_max": peak(vals(lambda h: h["load1"])),
            "psi_cpu_some_pct_max": peak(vals(lambda h: h["psi"]["cpu"]["some_pct"])),
            "psi_memory_some_pct_max": peak(vals(lambda h: h["psi"]["memory"]["some_pct"])),
            "psi_memory_full_pct_max": peak(vals(lambda h: h["psi"]["memory"]["full_pct"])),
            "psi_io_some_pct_max": peak(vals(lambda h: h["psi"]["io"]["some_pct"])),
            "psi_io_full_pct_max": peak(vals(lambda h: h["psi"]["io"]["full_pct"])),
            "major_faults_per_s_max": peak(vals(lambda h: h["major_faults_per_s"])),
            "cache_gb": {"min": min(cache), "median": _med(cache)} if cache else None,
            "top_comm": max(set(lead), key=lead.count) if lead else None}
