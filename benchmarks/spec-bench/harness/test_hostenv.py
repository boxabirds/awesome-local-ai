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
