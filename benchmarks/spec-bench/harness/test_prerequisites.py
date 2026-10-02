"""The machine setup checks versions, not only presence. On 2 Oct 2026 a release could not start a job on a machine
whose bubblewrap (0.6.1, Ubuntu 22.04) lacked an option the sandbox used, and whose default node was v12: setup had
only asked whether `bwrap` and `node` existed."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

HARNESS = Path(__file__).parent


def at_least(have: str, minimum: str) -> bool:
    return subprocess.run([str(HARNESS / "version-at-least.sh"), have, minimum]).returncode == 0


@pytest.mark.parametrize("have, minimum, ok", [
    ("0.6.1", "0.6.1", True), ("0.11.1", "0.6.1", True), ("0.6.0", "0.6.1", False), ("0.4", "0.6.1", False),
    ("bubblewrap 0.6.1", "0.6.1", True), ("v24.15.0", "20", True), ("v12.22.9", "20", False),
    ("cargo 1.98.0 (abc 2026-01-01)", "1.77", True), ("1.76.0-nightly", "1.77", False), ("1.10.0", "1.9.0", True),
    ("", "1.0", False), ("unknown", "1.0", False),
])
def test_versions_compare_as_numbers(have, minimum, ok):
    assert at_least(have, minimum) is ok


def test_setup_checks_the_versions_of_the_sandbox_and_the_toolchain():
    text = (HARNESS / "setup-node.sh").read_text()
    for tool in ("bwrap", "node", "cargo"):
        assert f"need_version {tool} " in text, f"{tool} is only checked for presence"
