"""host-desc.sh: run.sh runs under `set -euo pipefail`, so describing the host must never exit the run.
First seen on tritus (AMD Strix Halo, no nvidia-smi): the NVIDIA-only line exited 127 right after the
model server came up, and dbench restarted the run in a loop."""
import os
import subprocess
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
STRIX_LSPCI = ("0000:bd:00.0 Display controller: Advanced Micro Devices, Inc. [AMD/ATI] Strix Halo "
               "[Radeon Graphics / Radeon 8050S Graphics / Radeon 8060S Graphics] (rev c1)")


def describe(tmp_path: Path, tools: dict[str, str]) -> subprocess.CompletedProcess:
    stubs = tmp_path / "bin"
    stubs.mkdir()
    tools = {"uname": "echo Linux", "lscpu": "echo 'Model name:            AMD RYZEN AI MAX+ 395'", **tools}
    for name, body in tools.items():
        (stubs / name).write_text(f"#!/bin/sh\n{body}\n")
        (stubs / name).chmod(0o755)
    (tmp_path / "meminfo").write_text("MemTotal:       128134264 kB\n")
    env = {**os.environ, "PATH": f"{stubs}:/usr/bin:/bin", "MEMINFO": str(tmp_path / "meminfo")}
    return subprocess.run(["bash", "-c", f'set -euo pipefail; . "{HARNESS}/host-desc.sh"; host_desc; echo; echo next-line'],
                          env=env, capture_output=True, text=True)


def test_amd_without_nvidia_smi_is_described_and_the_run_goes_on(tmp_path):
    r = describe(tmp_path, {"lspci": f"echo '{STRIX_LSPCI}'"})
    assert r.returncode == 0 and "next-line" in r.stdout, r.stderr
    assert r.stdout.startswith("AMD RYZEN AI MAX+ 395 122GB, Advanced Micro Devices, Inc. [AMD/ATI] Strix Halo")


def test_nvidia_is_described_from_nvidia_smi(tmp_path):
    r = describe(tmp_path, {"nvidia-smi": "echo 'NVIDIA GeForce RTX 4090, 24564 MiB'", "lspci": "exit 1"})
    assert r.returncode == 0 and r.stdout.startswith("AMD RYZEN AI MAX+ 395 122GB, NVIDIA GeForce RTX 4090 24564 MiB")


def test_no_gpu_tool_at_all_still_describes_the_host(tmp_path):
    r = describe(tmp_path, {})
    assert r.returncode == 0 and r.stdout.startswith("AMD RYZEN AI MAX+ 395 122GB\n"), (r.stdout, r.stderr)
