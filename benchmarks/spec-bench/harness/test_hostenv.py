"""Host adapters: parsers are tested on captured output from each platform; the bwrap
command is tested for mount order (later mounts win, so own_dir must come after the masks)."""
from pathlib import Path

import hostenv

GRUNTUS_MEMINFO = """MemTotal:       65643972 kB
MemFree:         1000000 kB
MemAvailable:   57553088 kB
SwapTotal:       2097148 kB
SwapFree:        2032892 kB
"""


def test_meminfo_free_pct_and_swap():
    m = hostenv.parse_meminfo(GRUNTUS_MEMINFO)
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
    # gruntus: a desktop whose only "battery" is a Logitech mouse (scope=Device).
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


def test_bwrap_masks_then_reopens_own_dir(tmp_path):
    work_root = tmp_path / "work"
    own = work_root / "run-a"
    secret_file = tmp_path / "token"
    missing = tmp_path / "does-not-exist"
    for d in (work_root, own):
        d.mkdir(exist_ok=True)
    secret_file.write_text("x")
    cmd = hostenv.bwrap_wrap(["pi", "-p"], own_dir=own, deny=[work_root, secret_file, missing])
    assert cmd[0] == "bwrap" and cmd[-2:] == ["pi", "-p"]
    # `--bind / /` is nodev: without the real /dev, /dev/null can't be opened and every
    # child spawned with ignored stdio (Chromium via Playwright) fails with EACCES.
    assert "--dev-bind /dev /dev" in " ".join(cmd)
    joined = " ".join(cmd)
    assert f"--tmpfs {work_root.resolve()}" in joined          # directories: masked by an empty tmpfs
    assert f"--ro-bind /dev/null {secret_file.resolve()}" in joined  # files: masked by /dev/null
    assert str(missing) not in joined                          # never create paths on the host
    assert cmd.index(str(own.resolve())) > cmd.index(str(work_root.resolve()))  # own_dir after the mask


def fake_amdgpu(root: Path) -> Path:
    """tritus's card1 sysfs, values as read during story 4."""
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


def test_nvidia_sample_from_gruntus_smi_line():
    # utilization.gpu, clocks.sm, clocks.max.sm, power.draw, temperature.gpu, memory.used, throttle reasons
    s = hostenv.parse_nvidia_gpu("98, 2745, 3105, 405.08, 68, 22622, 0x0000000000000000\n")
    assert s == {"busy_pct": 98, "sclk_mhz": 2745, "power_w": 405.08, "temp_c": 68.0, "vram_gb": 22.09,
                 "throttle": "0x0000000000000000"}
    assert hostenv.parse_nvidia_gpu("") is None
