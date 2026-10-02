"""Job start installs a browser only when one is missing. Until 2 Oct 2026 every job ran `playwright install` twice
(the suite's browsers, the agents') and the preflight a third time, whether or not anything was missing."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

HARNESS = Path(__file__).parent
SCRIPT = HARNESS / "ensure-browser.sh"

# Stand-ins on PATH: `node` launches the browser if the marker file exists; `npx` records each call and, when told
# to, "installs" by creating the marker.
NODE = '#!/bin/sh\n[ -e "$MARKER" ] && { echo "browser launches"; exit 0; }\necho "browser does not launch: missing"; exit 1\n'
NPX = '#!/bin/sh\necho "$PLAYWRIGHT_BROWSERS_PATH|$*" >> "$CALLS"\n[ "$INSTALL_WORKS" = 1 ] && : > "$MARKER"\nexit 0\n'


def run(tmp_path: Path, *, installed: bool, install_works: bool = True, browsers: str | None = None):
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for name, body in (("node", NODE), ("npx", NPX)):
        (bin_ / name).write_text(body)
        (bin_ / name).chmod(0o755)
    acceptance = tmp_path / "acceptance"
    acceptance.mkdir()
    marker, calls = tmp_path / "browser", tmp_path / "calls"
    if installed:
        marker.touch()
    env = {"PATH": f"{bin_}:/usr/bin:/bin", "MARKER": str(marker), "CALLS": str(calls), "INSTALL_WORKS": "1" if install_works else "0"}
    argv = [str(SCRIPT), str(acceptance)] + ([browsers] if browsers else [])
    r = subprocess.run(argv, env=env, capture_output=True, text=True)
    return r, (calls.read_text().splitlines() if calls.exists() else [])


def test_a_browser_that_launches_is_never_installed_again(tmp_path):
    r, calls = run(tmp_path, installed=True)
    assert r.returncode == 0 and calls == [], r.stdout + r.stderr


def test_a_missing_browser_is_installed_once_and_then_launches(tmp_path):
    r, calls = run(tmp_path, installed=False)
    assert r.returncode == 0, r.stdout + r.stderr
    assert calls == ["|playwright install chromium"]


def test_the_agents_browsers_are_checked_and_installed_in_their_own_directory(tmp_path):
    r, calls = run(tmp_path, installed=False, browsers="/agents/browsers")
    assert r.returncode == 0, r.stdout + r.stderr
    assert calls == ["/agents/browsers|playwright install chromium"]


def test_an_install_that_leaves_no_usable_browser_stops_the_job(tmp_path):
    r, calls = run(tmp_path, installed=False, install_works=False)
    assert r.returncode == 1 and len(calls) == 1
    assert "browser does not launch" in r.stdout


def test_job_start_and_the_preflight_do_not_install_browsers_themselves():
    for name in ("run.sh", "preflight.py"):
        assert "playwright install" not in (HARNESS / name).read_text().replace("`playwright install`", ""), name
