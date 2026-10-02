"""The preflight's browser step, run the way the harness runs it: inside the agent's real sandbox, with the shared
browsers read-only. On 2 Oct 2026 the first real jobs on harness-v2026.10.01.2 failed here: the step ran
`playwright install`, which writes its bookkeeping (`.links/<hash>`) into the browsers directory, and the directory's
`.links` was a link to the shared cache's own, which the sandbox mounts read-only (EROFS). The step now only checks,
and the run's browsers directory keeps its own bookkeeping."""
from __future__ import annotations

from pathlib import Path

import pytest

import drive
import hostenv
import preflight
import sandbox
from sandbox_testing import agent_run

# What `playwright install` does to its browsers directory, in the one place that failed.
BOOKKEEPING = (
    "const fs = require('fs'), path = require('path');"
    "const dir = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, '.links');"
    "fs.mkdirSync(dir, { recursive: true });"
    "fs.writeFileSync(path.join(dir, '2bccf1ba2264c69330d1351c72606d4f2b8572ed'), '/some/project');"
    "console.log('bookkeeping written');"
)


@pytest.fixture
def shared_browsers(outside_shared_temp, monkeypatch):
    """A shared agent browsers cache as `playwright install` leaves it (a browser, and its own `.links`), read-only to
    the agent as on a bench machine."""
    shared = outside_shared_temp / "agent-browsers"
    (shared / "chromium-1243").mkdir(parents=True)
    (shared / ".links").mkdir()
    (shared / ".links" / "0123456789abcdef").write_text("/the/acceptance/suite")
    monkeypatch.setattr(hostenv, "agent_playwright_cache", lambda home: shared)
    monkeypatch.setattr(sandbox, "read_only_paths", lambda: [shared])
    return shared


@pytest.mark.needs_sandbox
def test_playwright_s_bookkeeping_is_written_in_the_runs_own_browsers_directory(shared_browsers, outside_shared_temp):
    r = agent_run(["node", "-e", BOOKKEEPING], outside_shared_temp / "run")
    assert r.returncode == 0 and "bookkeeping written" in r.stdout, r.stdout + r.stderr
    assert sorted(p.name for p in (shared_browsers / ".links").iterdir()) == ["0123456789abcdef"]   # the shared cache is untouched


@pytest.mark.needs_sandbox
def test_the_agent_cannot_put_anything_into_the_shared_browsers(shared_browsers, outside_shared_temp):
    # Through the run's link to a shared browser, and straight to the shared cache's own path.
    script = ("const fs = require('fs'), path = require('path');"
              f"for (const f of [path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1243', 'libevil.so'), {str(shared_browsers / 'chromium-1243' / 'libevil.so')!r}]) {{"
              "  try { fs.writeFileSync(f, 'x'); console.log('WROTE ' + f); } catch (e) { console.log('refused ' + e.code); } }")
    r = agent_run(["node", "-e", script], outside_shared_temp / "run")
    assert "WROTE" not in r.stdout and r.stdout.count("refused") == 2, r.stdout + r.stderr
    assert not (shared_browsers / "chromium-1243" / "libevil.so").exists()


def test_the_browsers_directory_never_links_the_shared_cache_s_bookkeeping(tmp_path):
    shared = hostenv.agent_playwright_cache(tmp_path / "real")
    (shared / "chromium-1").mkdir(parents=True)
    (shared / ".links").mkdir()
    drive.link_agent_browsers(tmp_path / "run", tmp_path / "run" / "agent-home", Path("/w"), tmp_path / "real")
    assert [p.name for p in (tmp_path / "run" / "browsers").iterdir()] == ["chromium-1"]


def test_the_preflight_s_browser_step_checks_and_never_installs():
    assert "'playwright'" not in preflight.FILES["drive.mjs"]
    assert "playwright browsers" not in preflight.FILES["drive.mjs"]


MISSING = ("browserType.launch: Executable doesn't exist at /w/browsers/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell\n"
           "Looks like Playwright Test or Playwright was just installed or updated. Please run: npx playwright install")


def test_a_missing_browser_is_reported_in_plain_words_naming_it_and_the_machine_setup():
    why = preflight.browser_failure_reason(MISSING)
    assert "chromium_headless_shell-1243" in why and "setup-node.sh" in why
    assert "npx playwright install" not in why                    # the agent's sandbox cannot install: not the advice


def test_any_other_launch_failure_keeps_playwright_s_own_first_line():
    why = preflight.browser_failure_reason("browserType.launch: Target page, context or browser has been closed\nmore")
    assert "Target page, context or browser has been closed" in why and "more" not in why


def test_the_preflight_asks_for_the_playwright_the_browsers_were_installed_for(tmp_path):
    (tmp_path / "package-lock.json").write_text('{"packages": {"node_modules/@playwright/test": {"version": "1.58.2"}}}')
    assert preflight.playwright_version(tmp_path) == "1.58.2"
    (tmp_path / "package-lock.json").write_text("{}")
    assert preflight.playwright_version(tmp_path) == preflight.PLAYWRIGHT_ANY
    assert preflight.playwright_version(tmp_path / "no-suite") == preflight.PLAYWRIGHT_ANY


def test_the_isolation_check_s_script_can_be_built_and_names_what_it_tries_to_open():
    """The step after the browser's: it had never run on a real release (the browser step failed first), and its
    script's own shell braces broke str.format."""
    script = preflight.isolation_script()
    assert str(preflight.REPO_ROOT) in script and str(preflight.PACK / "acceptance") in script
    assert "{" in script and "{repo}" not in script and "{secret_words}" not in script
    assert script.count('try_read "') == 3


def test_a_home_that_holds_only_the_way_to_the_shared_browsers_is_not_called_open(tmp_path, monkeypatch):
    """On Linux the real home exists inside the sandbox as an empty directory on the way to the read-only browsers
    (`~/.cache/<browsers>`), and nothing else of it is there. On 2 Oct 2026 the check called that open, because the
    directory could be listed; what it has to show is that a file in the home cannot be read."""
    import subprocess
    home = tmp_path / "home-as-the-sandbox-shows-it"
    (home / ".cache" / "browsers").mkdir(parents=True)
    home.chmod(0o555)                                    # read-only, as the sandbox's root is
    monkeypatch.setattr(preflight.Path, "home", lambda: home)
    monkeypatch.setattr(preflight, "REPO_ROOT", tmp_path / "no-repo")
    monkeypatch.setattr(preflight, "PACK", tmp_path / "no-pack")
    try:
        out = subprocess.run(["sh", "-c", preflight.isolation_script()], env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True).stdout
    finally:
        home.chmod(0o755)
    assert "the owner's home refused" in out and "OPEN" not in out and out.count(" refused") == 5, out


def test_a_file_of_the_home_that_can_be_read_is_called_open(tmp_path, monkeypatch):
    import subprocess
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setattr(preflight.Path, "home", lambda: home)
    monkeypatch.setattr(preflight, "REPO_ROOT", tmp_path / "no-repo")
    monkeypatch.setattr(preflight, "PACK", tmp_path / "no-pack")
    (home / preflight.HOME_CANARY).write_text("the owner's")
    out = subprocess.run(["sh", "-c", preflight.isolation_script()], env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True).stdout
    assert "the owner's home OPEN" in out, out
