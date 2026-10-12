"""A test's id is its name in the refactor register (ops/refactor/assignments.toml), so collecting the suite twice must give
the same ids. A parameter built from the clock (gzip.compress writes the current time into its header) makes an id that is
different on every run, so the test can never be listed once and found again."""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
CLOCK_RESOLUTION_SECONDS = 1.1          # gzip's header time has a one-second resolution


def collect(module: str) -> list[str]:
    done = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", module],
                          cwd=HERE, capture_output=True, text=True, check=True)
    return [line for line in done.stdout.splitlines() if "::" in line]


def test_the_publish_gate_tests_have_the_same_ids_when_collected_a_second_later():
    first = collect("test_publish_gate.py")
    time.sleep(CLOCK_RESOLUTION_SECONDS)
    assert collect("test_publish_gate.py") == first
