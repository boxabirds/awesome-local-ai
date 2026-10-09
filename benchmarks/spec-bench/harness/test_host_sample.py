"""hostenv.HostSampler: what the machine was doing while a story ran, beyond its GPU, swap and free memory.

Why: the one full Strata run (v2-strata0139-r2, 5 Oct 2026) fell from about 100 to about 25 tok/s partway through story 2 while its GPU read 100% busy
at half its power. The engine computes experts on the CPU and reads weights through the page cache, so the answer may be in the host, and we recorded no CPU
load, no stall figures and no page-cache or page-fault numbers (TELEMETRY.md listed them as not captured). A reading every 30 s now carries them.

Fixtures are two real samples of /proc 3.24 s apart from the RTX 4090 benchmark box (32 CPUs, a Strata story running), trimmed to the 8 busiest processes.
"""
import json
from pathlib import Path

import pytest

import hostenv

FIX = Path(__file__).parent / "fixtures" / "proc"
META = json.loads((FIX / "meta.json").read_text())
FILES = {"stat": "/proc/stat", "pressure_cpu": "/proc/pressure/cpu", "pressure_memory": "/proc/pressure/memory", "pressure_io": "/proc/pressure/io",
         "vmstat": "/proc/vmstat", "meminfo": "/proc/meminfo", "loadavg": "/proc/loadavg"}


class FakeProc:
    """The kernel's files as of one of the two fixture samples; the clock the sampler is told is the sample's."""
    def __init__(self, n):
        self.n = n
        self.pids = {}
        for line in (FIX / f"pidstat.{n}").read_text().splitlines():
            self.pids[int(line.split(" ", 1)[0])] = line

    def read(self, path):
        for name, p in FILES.items():
            if path == p:
                return (FIX / f"{name}.{self.n}").read_text()
        if path.startswith("/proc/") and path.endswith("/stat"):
            return self.pids.get(int(path.split("/")[2]))
        return None

    def list_pids(self):
        return sorted(self.pids)


def sampler():
    proc = {1: FakeProc(1), 2: FakeProc(2)}
    state = {"n": 1}
    s = hostenv.HostSampler(read=lambda p: proc[state["n"]].read(p), list_pids=lambda: proc[state["n"]].list_pids(), clk_tck=META["clk_tck"], ncpu=32)
    return s, state


def two_samples():
    s, state = sampler()
    t0 = 1_000_000.0
    first = s.sample(t0)
    state["n"] = 2
    return first, s.sample(t0 + META["interval_s"])


def test_the_first_reading_has_what_a_single_look_gives_and_no_rates():
    first, _ = two_samples()
    assert first["load1"] == 13.07 and first["load5"] == 11.36 and first["load15"] == 10.27
    assert first["cache_gb"] == pytest.approx(7.0, abs=0.5) and first["avail_gb"] > 10
    assert first["cpu_busy_pct"] is None and first["major_faults_per_s"] is None and first["top"] == [], "a rate needs two looks"
    assert first["cpus"] == 32


def test_cpu_busy_is_the_non_idle_non_iowait_share_of_the_ticks_between_two_looks():
    _, second = two_samples()
    # /proc/stat deltas: user 4627, system 34, idle 5685, iowait 12 of 10,358 ticks
    assert second["cpu_busy_pct"] == pytest.approx(45.0, abs=0.05)
    assert second["cpu_iowait_pct"] == pytest.approx(0.12, abs=0.01)


def test_the_stall_figures_are_the_share_of_the_interval_the_kernel_says_work_was_waiting():
    _, second = two_samples()
    interval_us = META["interval_s"] * 1e6
    assert second["psi"]["cpu"]["some_pct"] == pytest.approx(6169 / interval_us * 100, abs=0.005)
    assert second["psi"]["memory"] == {"some_pct": 0.0, "full_pct": 0.0}
    assert second["psi"]["io"]["some_pct"] == pytest.approx(219 / interval_us * 100, abs=0.005)
    assert second["psi"]["io"]["full_pct"] == pytest.approx(192 / interval_us * 100, abs=0.005)


def test_paging_is_a_rate_per_second_from_the_kernels_counters():
    _, second = two_samples()
    assert second["major_faults_per_s"] == 0.0 and second["swap_in_per_s"] == 0.0 and second["swap_out_per_s"] == 0.0
    assert second["disk_read_mb_per_s"] == pytest.approx(9296 / 1024 / META["interval_s"], abs=0.01)   # pgpgin is in KiB


def test_page_cache_and_available_memory_are_the_kernels_figures_in_gb():
    _, second = two_samples()
    assert second["cache_gb"] == pytest.approx(7.064, abs=0.005) and second["avail_gb"] == pytest.approx(14.354, abs=0.005)
    assert second["dirty_mb"] == pytest.approx(564 / 1024, abs=0.01)


def test_the_busiest_processes_are_named_by_the_kernels_short_name_only_with_their_cpu_share_and_idle_ones_are_left_out():
    _, second = two_samples()
    one_cpu_pct = 100.0 / (META["clk_tck"] * META["interval_s"])      # one tick over the interval, as a percentage of one CPU
    assert second["top"] == [{"comm": "dbench", "cpu_pct": pytest.approx(9 * one_cpu_pct, abs=0.01)},
                             {"comm": "tailscaled", "cpu_pct": pytest.approx(4 * one_cpu_pct, abs=0.01)}]
    assert all(set(p) == {"comm", "cpu_pct"} for p in second["top"]), "no command line, no pid: an argument can hold a secret"


def test_a_missing_kernel_file_leaves_its_figures_none_and_never_raises():
    s = hostenv.HostSampler(read=lambda p: None, list_pids=lambda: [], clk_tck=100, ncpu=4)
    r = s.sample(1.0)
    s2 = s.sample(31.0)
    for reading in (r, s2):
        assert reading["psi"] == {"cpu": {"some_pct": None, "full_pct": None}, "memory": {"some_pct": None, "full_pct": None}, "io": {"some_pct": None, "full_pct": None}}
        assert reading["cpu_busy_pct"] is None and reading["cache_gb"] is None and reading["top"] == []


def test_a_process_name_with_spaces_and_parentheses_is_read_whole():
    assert hostenv.parse_pid_stat("42 (Web Content (x)) S 1 42 42 0 -1 4194560 100 0 0 0 7 5 0 0 20 0 1 0 100 1000 100 18446744073709551615") == (42, "Web Content (x)", 12)


def test_the_summary_of_a_story_gives_the_peaks_and_the_typical_so_a_reader_need_not_open_the_series():
    readings = [{"host": {"cpu_busy_pct": b, "load1": l, "psi": {"cpu": {"some_pct": c, "full_pct": None}, "memory": {"some_pct": m, "full_pct": 0.0}, "io": {"some_pct": 0.0, "full_pct": 0.0}},
                          "major_faults_per_s": f, "cache_gb": g, "top": [{"comm": n, "cpu_pct": p}]}}
                for b, l, c, m, f, g, n, p in [(40.0, 2.0, 1.0, 0.0, 0.0, 30.0, "strata", 300.0), (60.0, 6.0, 5.0, 2.0, 50.0, 12.0, "strata", 500.0), (80.0, 9.0, 3.0, 0.0, 0.0, 12.5, "chrome", 400.0)]]
    sm = hostenv.summarise_host(readings)
    assert sm["samples"] == 3 and sm["cpu_busy_pct"] == {"median": 60.0, "max": 80.0} and sm["load1_max"] == 9.0
    assert sm["psi_cpu_some_pct_max"] == 5.0 and sm["psi_memory_some_pct_max"] == 2.0 and sm["major_faults_per_s_max"] == 50.0
    assert sm["cache_gb"] == {"min": 12.0, "median": 12.5}
    assert sm["top_comm"] == "strata", "the process most often the busiest"
    assert hostenv.summarise_host([]) is None
