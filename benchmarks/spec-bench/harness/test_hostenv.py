"""Host adapters: parsers are tested on captured output from each platform; the bwrap
command is tested for mount order (later mounts win, so own_dir must come after the masks)."""
import sys
from pathlib import Path

import pytest

import hostenv

RTX4090_BOX_MEMINFO = """MemTotal:       65643972 kB
MemFree:         1000000 kB
MemAvailable:   57553088 kB
SwapTotal:       2097148 kB
SwapFree:        2032892 kB
"""


def test_meminfo_free_pct_and_swap():
    m = hostenv.parse_meminfo(RTX4090_BOX_MEMINFO)
    assert round(hostenv.free_pct_from_meminfo(m)) == 88
    assert abs(hostenv.swap_used_gb_from_meminfo(m) - (2097148 - 2032892) / 1024 ** 2) < 1e-9


def test_macos_memory_pressure_free_pct():
    out = "The system has 137438953472 (8388608 pages with a page size of 16384).\n...\nSystem-wide memory free percentage: 23%\n"
    assert hostenv.parse_memory_pressure_free_pct(out) == 23


def test_proc_status_rss_and_peak():
    status = "Name:\tllama-server\nVmHWM:\t 8388608 kB\nVmRSS:\t 4194304 kB\n"
    assert hostenv.parse_proc_status_gb(status) == (4.0, 8.0)


def test_nvidia_thermal():
    assert hostenv.parse_nvidia_thermal("Not Active, Not Active\n") == "nominal"
    assert hostenv.parse_nvidia_thermal("Not Active, Active\n") == "throttled"
    assert hostenv.parse_nvidia_thermal("Not Active, Not Active\nActive, Not Active\n") == "throttled"  # any GPU


def test_linux_power_ignores_device_batteries():
    # the RTX 4090 machine: a desktop whose only "battery" is a Logitech mouse (scope=Device).
    mouse = {"type": "Battery", "scope": "Device", "status": "Discharging"}
    assert hostenv.parse_linux_power([mouse], platform_profile=None) == {"ac": True, "low_power": False}


def test_linux_power_laptop_on_battery_and_low_power():
    bat = {"type": "Battery", "status": "Discharging"}
    mains_off = {"type": "Mains", "online": "0"}
    assert hostenv.parse_linux_power([bat, mains_off], platform_profile="balanced") == {"ac": False, "low_power": False}
    mains_on = {"type": "Mains", "online": "1"}
    assert hostenv.parse_linux_power([bat, mains_on], platform_profile="low-power") == {"ac": True, "low_power": True}


def test_playwright_cache_is_per_os():
    home = Path("/home/user")
    expected = "Library/Caches/ms-playwright" if hostenv.IS_MAC else ".cache/ms-playwright"
    assert hostenv.playwright_cache(home) == home / expected


def fake_amdgpu(root: Path) -> Path:
    """The Strix Halo box's card1 sysfs, values as read during story 4."""
    dev = root / "card1" / "device"
    hw = dev / "hwmon" / "hwmon3"
    hw.mkdir(parents=True)
    (dev / "gpu_busy_percent").write_text("97\n")
    (dev / "pp_dpm_sclk").write_text("0: 2900Mhz \n1: 1100Mhz \n2: 2900Mhz *\n")
    (dev / "mem_info_gtt_used").write_text("73701355520\n")
    (hw / "power1_average").write_text("88016000\n")
    (hw / "temp1_input").write_text("62000\n")
    return root


def test_amdgpu_sample_reads_busy_clock_power_temperature_and_gtt(tmp_path):
    s = hostenv.amdgpu_sample(fake_amdgpu(tmp_path))
    assert s == {"busy_pct": 97, "sclk_mhz": 2900, "power_w": 88.0, "temp_c": 62.0, "gtt_gb": 68.64}


def test_no_amdgpu_means_no_sample(tmp_path):
    assert hostenv.amdgpu_sample(tmp_path) is None


def test_gpu_summary_shows_a_clock_drop_under_load():
    busy = {"busy_pct": 97, "sclk_mhz": 2900, "power_w": 88.0, "temp_c": 62.0, "gtt_gb": 68.6}
    samples = [busy, {**busy, "sclk_mhz": 1100, "temp_c": 91.0}, {**busy, "busy_pct": 0, "sclk_mhz": 600}]
    s = hostenv.summarise_gpu(samples)
    assert s["samples"] == 3 and s["busy_mean_pct"] == 64.7
    assert s["sclk_min_busy_mhz"] == 1100          # idle clocks don't count as throttling
    assert s["temp_max_c"] == 91.0 and s["power_max_w"] == 88.0 and s["gtt_max_gb"] == 68.6
    assert hostenv.summarise_gpu([]) is None


def test_nvidia_sample_from_the_rtx_4090_smi_line():
    # utilization.gpu, clocks.sm, clocks.max.sm, power.draw, temperature.gpu, memory.used, throttle reasons
    s = hostenv.parse_nvidia_gpu("98, 2745, 3105, 405.08, 68, 22622, 0x0000000000000000\n")
    assert s == {"busy_pct": 98, "sclk_mhz": 2745, "power_w": 405.08, "temp_c": 68.0, "vram_gb": 22.09,
                 "throttle": "0x0000000000000000"}
    assert hostenv.parse_nvidia_gpu("") is None


def test_an_nvidia_field_reported_as_na_does_not_kill_the_condition_sampler():
    """nvidia-smi prints [N/A] for a field it can't read (a driver hiccup, another card). The sampler
    thread parses every sample; an exception there silently stops the swap/memory guards for the story."""
    import hostenv
    s = hostenv.parse_nvidia_gpu("97, 2520, 3105, [N/A], 64, 22622, 0x0000000000000000\n")
    assert s is not None and s["busy_pct"] == 97 and s["power_w"] is None and s["temp_c"] == 64.0


PS_OUT = """  101 20971520 /home/u/.local/share/x/llama-server -m /home/u/models/m.gguf --api-key sk-secret123 --port 18010
  202   524288 /usr/bin/gnome-shell
  303  1048576 /opt/chrome/chrome --type=renderer
  304  1048576 /opt/chrome/chrome --type=renderer
  305   262144 node /home/u/.vidi-bench/work/x/workspace/node_modules/.bin/wrangler dev
"""


def test_memory_snapshot_ranks_processes_and_totals_by_program():
    """What held the memory when free memory ran low (the RTX 4090 machine's canvas-pi-03 story 5: about 28 GB we
    couldn't attribute). Per-program totals catch many small processes, e.g. a dozen browsers."""
    from hostenv import parse_memory_snapshot
    snap = parse_memory_snapshot(PS_OUT, home="/home/u", top=3)
    assert [p["pid"] for p in snap["processes"]] == [101, 303, 304]
    assert snap["processes"][0]["rss_gb"] == 20.0
    assert snap["by_program"][0] == {"program": "llama-server", "count": 1, "rss_gb": 20.0}
    assert {"program": "chrome", "count": 2, "rss_gb": 2.0} in snap["by_program"]
    assert snap["total_rss_gb"] == 22.75


def test_memory_snapshot_hides_home_and_keys():
    """Run folders are published: no home paths, no keys."""
    from hostenv import parse_memory_snapshot
    cmd = parse_memory_snapshot(PS_OUT, home="/home/u", top=1)["processes"][0]["command"]
    assert "/home/u" not in cmd and cmd.startswith("~/.local/share/x/llama-server")
    assert "sk-secret123" not in cmd and "--api-key ***" in cmd


def test_memory_snapshot_names_programs_whose_path_has_spaces():
    """macOS: "/Applications/Google Chrome.app/..." is one program, not "Google"."""
    from hostenv import parse_memory_snapshot
    args = "  7 1048576 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --flag\n"
    comm = "  7 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n"
    snap = parse_memory_snapshot(args, home="/Users/u", comm_out=comm)
    assert snap["by_program"][0]["program"] == "Google Chrome"


def test_agent_is_the_first_to_go_when_linux_runs_out_of_memory():
    """The kernel's OOM killer picks the biggest process, which on a bench machine is the model
    server (the RTX 4090 machine's llama-server: score 810 of 1000). The agent's command raises its own tree's
    score instead, so a runaway test dies first. Raising needs no root; nothing outlives the process."""
    from hostenv import oom_first, AGENT_OOM_SCORE_ADJ
    cmd = oom_first(["bwrap", "--", "pi", "-p", "a prompt with 'quotes'"], linux=True)
    assert cmd[:2] == ["sh", "-c"] and f"echo {AGENT_OOM_SCORE_ADJ} > /proc/self/oom_score_adj" in cmd[2]
    assert 'exec "$@"' in cmd[2] and cmd[4:] == ["bwrap", "--", "pi", "-p", "a prompt with 'quotes'"]
    assert oom_first(["pi"], linux=False) == ["pi"]   # macOS has no such setting


@pytest.mark.skipif(sys.platform != "linux", reason="Linux /proc only")
def test_oom_first_is_inherited_by_children():
    import subprocess
    from hostenv import oom_first, AGENT_OOM_SCORE_ADJ
    out = subprocess.run(oom_first(["sh", "-c", "sh -c 'cat /proc/self/oom_score_adj'"], linux=True),
                         capture_output=True, text=True).stdout.strip()
    assert out == str(AGENT_OOM_SCORE_ADJ)


# ---------- host_desc: a machine is named in records by its hardware, never its hostname ----------

def test_host_desc_is_host_desc_shs_one_line():
    """The same line run.sh puts in run.json: one definition of how a machine is named."""
    import subprocess as sp
    seen = []

    def run(cmd, **kw):
        seen.append(cmd)
        return sp.CompletedProcess(cmd, 0, stdout="Made-up CPU 64GB, Made-up GPU 24 GB\n", stderr="")
    assert hostenv.host_desc(run=run) == "Made-up CPU 64GB, Made-up GPU 24 GB"
    assert "host-desc.sh" in " ".join(seen[0])


@pytest.mark.parametrize("fail", ["exit", "raise"])
def test_host_desc_is_empty_when_the_hardware_cant_be_read(fail):
    import subprocess as sp

    def run(cmd, **kw):
        if fail == "raise":
            raise OSError("no bash")
        return sp.CompletedProcess(cmd, 1, stdout="partial", stderr="boom")
    assert hostenv.host_desc(run=run) == ""


def test_host_desc_on_this_machine_names_hardware_not_the_hostname():
    import socket
    desc = hostenv.host_desc()
    assert desc and socket.gethostname().split(".")[0].lower() not in desc.lower()


# ---------- the model server's footprint when the engine runs in a container ----------
# Every gufo run recorded footprint 0.0 GB -- 2,381 readings on v2-gufo05-r4 alone -- while mlx-serve recorded
# 87 GB correctly. The cause: server_footprint_gb finds the process by lsof on the LISTENING PORT, and for a
# containerised engine the host listener is podman's port shim (rootlessport / conmon / slirp4netns), not the
# engine. It measured the shim. A figure of zero for a model holding 88 GB is worse than no figure: it is a
# plausible-looking number that is wrong, and it is the figure that decides what fits on a machine.

def test_a_container_port_shim_is_recognised_as_not_the_engine():
    for cmd in ("/usr/bin/rootlessport", "conmon --api-version 1 -c abc", "slirp4netns --config-net",
                "/usr/libexec/podman/rootlessport", "podman"):
        assert hostenv.is_container_shim(cmd), cmd


def test_a_real_engine_process_is_not_a_shim():
    for cmd in ("/usr/bin/llama-server --port 18010", "gufo serve --host 0.0.0.0 llm --model x.gguf",
                "python -m mlx_lm.server", "~/.local/share/x/engine/gufo serve"):
        assert not hostenv.is_container_shim(cmd), cmd


# When the listener is a shim, the engine still runs on the host (podman rootless shares the PID namespace), so
# it can be found by name. The largest match wins: a model server is the biggest thing on the machine by far,
# and a stray `tail -f` whose arguments mention llama-server is not.

ENGINE_PROCS = [
    (101, 2_048, "/usr/libexec/podman/rootlessport"),
    (102, 1_024, "conmon --api-version 1 -c deadbeef"),
    (103, 92_000_000, "gufo serve --host 0.0.0.0 --port 8080 llm --model /models/x.gguf"),
    (104, 8_192, "tail -f /var/log/llama-server.log"),
    (105, 4_096, "grep gufo serve"),
]


def test_the_engine_is_the_largest_process_that_looks_like_one():
    assert hostenv.pick_engine_pid(ENGINE_PROCS) == 103


def test_no_engine_among_them_is_none_not_a_guess():
    assert hostenv.pick_engine_pid([p for p in ENGINE_PROCS if p[0] in (101, 102, 104)]) is None


def test_two_engines_takes_the_larger_so_a_dying_one_does_not_win():
    procs = ENGINE_PROCS + [(106, 50_000_000, "/usr/bin/llama-server --port 18010")]
    assert hostenv.pick_engine_pid(procs) == 103
