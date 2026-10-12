"""The agent's world, seen from inside it: the real sandbox (Seatbelt on macOS, bubblewrap on Linux), started the way a
story starts the agent (drive.run_agent), with a probe in place of the agent (prove_sandbox.py: the same checks the owner
runs on a bench machine with prove-sandbox.sh).

Each group is one property the owner required of the agent's world, and every one failed on the permissive sandbox that
ran until 1 Oct 2026 (the whole machine visible, the owner's whole environment, an open network): the cwd named the run
and the word "bench", `env` printed the owner's keys, `pkill -f wrangler` reached the machine, any host could be
fetched from. Around the probe sit canaries that a leak would show, each first read from outside (prove_sandbox.observe)."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

import prove_sandbox as ps

pytestmark = pytest.mark.needs_sandbox


@pytest.fixture(scope="module")
def results():
    scratch = Path.home() / f"{ps.TEMP_PREFIX}{uuid.uuid4().hex[:ps.TEMP_TAG_CHARS]}"
    scratch.mkdir()
    observed = None
    try:
        observed = ps.observe(scratch)
        yield ps.checks(observed)
    finally:
        if observed is not None:
            ps.cleanup(observed)
        shutil.rmtree(scratch, ignore_errors=True)


def failed(results, group: str) -> list[str]:
    return [f"{c.name}: {c.detail.strip()[:300]}" for c in results if c.group == group and not c.ok and not c.skipped]


@pytest.mark.parametrize("group", ps.GROUPS)
def test_the_agents_world_holds(results, group):
    in_group = [c for c in results if c.group == group]
    assert in_group, f"no check ran for {group}"
    assert not failed(results, group), "\n".join(failed(results, group))


def test_the_checks_are_the_ones_the_owner_asked_for(results):
    names = " | ".join(c.name for c in results)
    for phrase in ("names no run", "cannot read the repository", "cannot read another run's directory", "cannot read a file share",
                   "real home directory", "cannot change spec/", "allow-list", "canary key", "model server",
                   "raw address is refused", "not listed is refused", "process outside cannot be read",
                   "its own port", "no sudo"):
        assert phrase in names, phrase


def test_a_real_chromium_runs_in_the_sandbox_and_the_agent_cannot_change_the_shared_browsers():
    """The story's own startup path: Playwright's Chromium launched in the sandbox, loading a page from a server of
    the run's own; and the agent's `playwright install` leaves the shared browsers as they were. Skipped, with the
    reason, where the machine has no browser installed for the agents or no network (the harness's own CI has neither)."""
    scratch = Path.home() / f"{ps.TEMP_PREFIX}{uuid.uuid4().hex[:ps.TEMP_TAG_CHARS]}"
    scratch.mkdir()
    try:
        observed = ps.observe_browser(scratch)
    finally:
        shutil.rmtree(scratch, ignore_errors=True)
    if isinstance(observed, str):
        pytest.skip(observed)
    bad = [f"{c.name}: {c.detail.strip()[:300]}" for c in ps.browser_checks(observed) if not c.ok]
    assert not bad, "\n".join(bad)


# ---- observe: the probe's output is read as "name: value" lines and nothing else ----

def test_observe_keeps_only_the_name_value_lines_the_probe_printed(monkeypatch):
    """Inside the real sandbox, with a probe that prints three kinds of line: a stray line, a line whose name is not an
    identifier, and a good one (whose value holds a colon of its own). Only the good one becomes a result."""
    monkeypatch.setattr(ps, "PROBE", 'echo "a stray line with no separator"\n'
                                     'echo "two words: not an identifier"\n'
                                     'echo "good_name: value: with a colon"\n')
    scratch = Path.home() / f"{ps.TEMP_PREFIX}{uuid.uuid4().hex[:ps.TEMP_TAG_CHARS]}"
    scratch.mkdir()
    observed = None
    try:
        observed = ps.observe(scratch, with_network=False)
        assert observed.lines == ["a stray line with no separator", "two words: not an identifier",
                                  "good_name: value: with a colon"]
        assert observed.out == {"good_name": "value: with a colon"}
        assert observed.online is False
    finally:
        if observed is not None:
            ps.cleanup(observed)
        shutil.rmtree(scratch, ignore_errors=True)


# ---- observe_browser, with the browser's process faked at the boundary it uses (drive.run_agent) ----

BROWSER_EVENTS = ("npm_install: added 1 package rc=0\n"
                  f"browser: page: {ps.BROWSER_PAGE_TEXT}\n"
                  "a stray line\n"
                  "not an identifier: x\n"
                  "agent_install: rc=0\n"
                  "agent_write_shared: Read-only file system\n")


class FakeBrowserMachine:
    """A shared browser cache in tmp_path, a stand-in for drive.run_agent, and a record of how it was called."""

    def __init__(self, tmp_path: Path, monkeypatch):
        self.shared = tmp_path / "shared-browsers"
        self.shared.mkdir()
        self.calls: list[dict] = []
        self.events = BROWSER_EVENTS
        self.agent_adds: str | None = None          # a name the stand-in agent creates in the shared cache
        self.agent_raises: Exception | None = None
        monkeypatch.setattr(ps, "shared_browsers", lambda: self.shared)
        monkeypatch.setattr(ps, "online", lambda: True)
        monkeypatch.setattr(ps.preflight, "playwright_version", lambda acceptance: "9.9.9")
        monkeypatch.setattr(ps.drive, "run_agent", self.run_agent)

    def run_agent(self, client, ws, env, model_id, prompt, events_path, **kw):
        self.calls.append({"script": client.script, "ws": ws, "world": ps.drive.WORLD,
                           "page": (ws / ps.BROWSER_PROJECT / ps.BROWSER_SCRIPT).read_text()})
        if self.agent_raises:
            raise self.agent_raises
        if self.agent_adds:
            (self.shared / self.agent_adds).mkdir()
        events_path.write_text(self.events)
        return {}


@pytest.fixture
def browser_machine(tmp_path, monkeypatch):
    return FakeBrowserMachine(tmp_path, monkeypatch)


def test_observe_browser_says_why_when_no_chromium_is_installed_for_the_agents(tmp_path, browser_machine):
    (browser_machine.shared / "ffmpeg-1").mkdir()                     # something else in the cache is not a browser
    got = ps.observe_browser(tmp_path / "scratch")
    assert got == (f"no Chromium is installed for the agents in {browser_machine.shared} "
                   "(the machine's setup installs it)")
    assert browser_machine.calls == []


def test_observe_browser_says_why_when_offline(tmp_path, browser_machine, monkeypatch):
    (browser_machine.shared / "chromium-1").mkdir()
    monkeypatch.setattr(ps, "online", lambda: False)
    assert ps.observe_browser(tmp_path / "scratch") == "offline: the probe installs Playwright's package from the npm registry"
    assert browser_machine.calls == []


def test_observe_browser_runs_the_probe_in_the_agents_world_and_reads_its_lines(tmp_path, browser_machine):
    import re
    (browser_machine.shared / "chromium-1").mkdir()
    before_world = ps.drive.WORLD
    got = ps.observe_browser(tmp_path / "scratch")
    assert got == {"npm_install": "added 1 package rc=0", "browser": f"page: {ps.BROWSER_PAGE_TEXT}",
                   "agent_install": "rc=0", "agent_write_shared": "Read-only file system", "shared_untouched": "yes"}
    [call] = browser_machine.calls
    assert "npm install --no-audit --no-fund --silent @playwright/test@9.9.9" in call["script"]
    assert f"touch {browser_machine.shared}/written-by-the-agent" in call["script"]
    assert f"timeout {ps.BROWSER_INSTALL_SECONDS} npx playwright install chromium" in call["script"]
    assert re.search(r"@[A-Z_]+@", call["script"]) is None, "a placeholder was left in the probe"
    assert sandbox_port_env_in(call["page"]) and ps.BROWSER_PAGE_TEXT in call["page"]
    assert re.search(r"@[A-Z_]+@", call["page"]) is None
    assert call["world"] is not before_world and call["world"].run == call["ws"].parent.name
    assert ps.drive.WORLD is before_world                               # the world is put back


def sandbox_port_env_in(page: str) -> bool:
    return f"process.env.{ps.sandbox.PORT_FIRST_ENV}" in page


def test_observe_browser_notices_when_the_agent_changed_the_shared_browsers(tmp_path, browser_machine):
    (browser_machine.shared / "chromium-1").mkdir()
    browser_machine.agent_adds = "chromium-2"
    got = ps.observe_browser(tmp_path / "scratch")
    assert got["shared_untouched"] == "no"
    checks = {c.name: c for c in ps.browser_checks(got)}
    assert not checks["the agent's own `playwright install` cannot change the shared browsers"].ok


def test_observe_browser_puts_the_world_back_when_the_agent_run_fails(tmp_path, browser_machine):
    (browser_machine.shared / "chromium-1").mkdir()
    browser_machine.agent_raises = RuntimeError("sandbox could not start")
    before_world = ps.drive.WORLD
    with pytest.raises(RuntimeError, match="sandbox could not start"):
        ps.observe_browser(tmp_path / "scratch")
    assert ps.drive.WORLD is before_world
