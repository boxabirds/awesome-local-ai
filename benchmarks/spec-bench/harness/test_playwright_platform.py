"""playwright-platform.sh: on an Ubuntu newer than Playwright lists, every Playwright call the harness
makes (setup-node.sh and run.sh alike) must use its 24.04 build, or the install refuses outright."""
import os
import subprocess
from pathlib import Path

HARNESS = Path(__file__).resolve().parent


def override(tmp_path: Path, os_id: str, version: str, machine: str = "x86_64") -> str:
    (tmp_path / "os-release").write_text(f'ID={os_id}\nVERSION_ID="{version}"\n')
    stubs = tmp_path / "bin"
    stubs.mkdir(exist_ok=True)
    uname = stubs / "uname"
    uname.write_text(f'#!/bin/sh\n[ "$1" = -m ] && echo {machine} || echo Linux\n')
    uname.chmod(0o755)
    env = {**os.environ, "PATH": f"{stubs}:{os.environ['PATH']}", "OS_RELEASE": str(tmp_path / "os-release")}
    env.pop("PLAYWRIGHT_HOST_PLATFORM_OVERRIDE", None)
    r = subprocess.run(["bash", "-c", f'. "{HARNESS}/playwright-platform.sh"; echo "${{PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-none}}"'],
                       env=env, capture_output=True, text=True, check=True)
    return r.stdout.strip()


def test_ubuntu_2604_uses_the_2404_build(tmp_path):
    assert override(tmp_path, "ubuntu", "26.04") == "ubuntu24.04-x64"
    assert override(tmp_path, "ubuntu", "26.04", "aarch64") == "ubuntu24.04-arm64"


def test_releases_playwright_knows_are_left_alone(tmp_path):
    assert override(tmp_path, "ubuntu", "24.04") == "none"
    assert override(tmp_path, "ubuntu", "22.04") == "none"
    assert override(tmp_path, "debian", "13") == "none"


def test_both_entry_points_source_it():
    for script in ("run.sh", "setup-node.sh"):
        assert '. "$HARNESS/playwright-platform.sh"' in (HARNESS / script).read_text(), script
