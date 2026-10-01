"""check-browser.sh: proves a Playwright project can launch its browser, rather than trusting an install.

The harness runs it in the held-out suite. The script itself needs only a directory where node finds
@playwright/test, so the test uses the held-out suite when this checkout has it (the private pack repo, with its
packages installed) and otherwise the repo's public Playwright project, tools/benchmarker. With neither
installed there is nothing to launch, and the tests skip saying so."""
import os
import subprocess
from pathlib import Path

import pytest

import packdir

SCRIPT = Path(__file__).parent / "check-browser.sh"
PLAYWRIGHT_PACKAGE = Path("node_modules") / "@playwright" / "test"
HELD_OUT_SUITE = packdir.resolve("vidi") / "acceptance"  # the one pack with a held-out suite
PUBLIC_PROJECT = packdir.REPO_ROOT / "tools" / "benchmarker"
PROJECT = next((d for d in (HELD_OUT_SUITE, PUBLIC_PROJECT) if (d / PLAYWRIGHT_PACKAGE).is_dir()), None)

needs_a_playwright_project = pytest.mark.skipif(
    PROJECT is None,
    reason="no Playwright project with its packages installed: neither the held-out suite (private pack repo) "
           "nor tools/benchmarker (bun install)")


def run(env_extra: dict) -> subprocess.CompletedProcess:
    return subprocess.run([str(SCRIPT), str(PROJECT)], env={**os.environ, **env_extra},
                          capture_output=True, text=True)


@needs_a_playwright_project
def test_passes_when_the_browser_launches():
    r = run({})
    assert r.returncode == 0, r.stdout + r.stderr
    assert "browser launches" in r.stdout


@needs_a_playwright_project
def test_fails_with_the_reason_when_the_browser_is_missing(tmp_path):
    r = run({"PLAYWRIGHT_BROWSERS_PATH": str(tmp_path)})  # an empty browser cache
    assert r.returncode != 0
    assert "Executable doesn't exist" in r.stdout + r.stderr


def test_a_directory_that_is_not_there_fails_and_says_which(tmp_path):
    """A checkout without the held-out suite (CI, 1 Oct 2026): the script must fail naming the directory."""
    missing = tmp_path / "no-suite-here"
    r = subprocess.run([str(SCRIPT), str(missing)], capture_output=True, text=True)
    assert r.returncode != 0 and str(missing) in r.stderr
