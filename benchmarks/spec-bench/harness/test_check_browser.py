"""check-browser.sh: proves the held-out suite can launch its browser, rather than trusting an install."""
import os
import subprocess
from pathlib import Path

import packdir

SCRIPT = Path(__file__).parent / "check-browser.sh"
ACCEPTANCE = packdir.resolve("vidi") / "acceptance"  # the one pack with a held-out suite


def run(env_extra: dict) -> subprocess.CompletedProcess:
    return subprocess.run([str(SCRIPT), str(ACCEPTANCE)], env={**os.environ, **env_extra},
                          capture_output=True, text=True)


def test_passes_when_the_browser_launches():
    r = run({})
    assert r.returncode == 0, r.stdout + r.stderr


def test_fails_with_the_reason_when_the_browser_is_missing(tmp_path):
    r = run({"PLAYWRIGHT_BROWSERS_PATH": str(tmp_path)})  # an empty browser cache
    assert r.returncode != 0
    assert "Executable doesn't exist" in r.stdout + r.stderr
