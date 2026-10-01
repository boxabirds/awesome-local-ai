"""scoring_tools.py: a re-score finds uv, node, npm and npx itself, from the PATH run.sh had when it last started a
run on this machine, whatever PATH its caller has.

Why: in the week of 28 Sep 2026 finished runs ended unscored because the process that ran the re-score (a shell
without the login profile) had no `uv` or `node` on its PATH, though every run on the machine had found them."""
import json
import os
import stat
from pathlib import Path

import pytest

import scoring_tools

BARE_PATH = "/usr/bin:/bin"


def tool_dir(d: Path, *names: str) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    for n in names:
        (d / n).write_text("#!/bin/sh\n")
        (d / n).chmod(0o755)
    return d


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv(scoring_tools.HOME_ENV, str(tmp_path / "scoring-home"))
    return tmp_path / "scoring-home"


def test_the_home_is_under_the_bench_home_unless_told(monkeypatch, tmp_path):
    monkeypatch.delenv(scoring_tools.HOME_ENV, raising=False)
    monkeypatch.setenv("VIDI_BENCH_HOME", str(tmp_path / "bench"))
    assert scoring_tools.home() == (tmp_path / "bench").resolve() / scoring_tools.HOME_DIR


def test_tools_are_found_on_the_remembered_path_when_the_callers_has_none(home, tmp_path):
    node = tool_dir(tmp_path / "nvm/bin", "node", "npm", "npx")
    uv = tool_dir(tmp_path / "uv/bin", "uv")
    scoring_tools.remember({"PATH": f"{node}:{uv}:{BARE_PATH}"})
    env = scoring_tools.environment({"PATH": BARE_PATH, "HOME": "/h"})
    assert scoring_tools.resolve(env) == {"uv": str(uv / "uv"), "node": str(node / "node"),
                                          "npm": str(node / "npm"), "npx": str(node / "npx")}
    assert scoring_tools.missing(env) == []
    assert env["HOME"] == "/h"                                   # the rest of the caller's environment is kept


def test_the_remembered_path_comes_first_and_nothing_is_listed_twice(home, tmp_path):
    """run.sh's order is the one known to work (a node from the wrong directory hung npm on one machine)."""
    good, other = tool_dir(tmp_path / "good", "node"), tool_dir(tmp_path / "other", "node")
    scoring_tools.remember({"PATH": f"{good}:{BARE_PATH}"})
    env = scoring_tools.environment({"PATH": f"{other}:{good}:{BARE_PATH}"})
    assert env["PATH"].split(os.pathsep) == [str(good), "/usr/bin", "/bin", str(other)]
    assert scoring_tools.resolve(env)["node"] == str(good / "node")


def test_with_nothing_remembered_the_callers_path_is_used(home, tmp_path):
    here = tool_dir(tmp_path / "bin", *scoring_tools.TOOLS)
    env = scoring_tools.environment({"PATH": str(here)})
    assert scoring_tools.missing(env) == [] and env["PATH"] == str(here)


def test_a_tool_that_is_nowhere_is_named(home, tmp_path):
    here = tool_dir(tmp_path / "bin", "node", "npm", "npx")
    scoring_tools.remember({"PATH": str(here)})
    assert scoring_tools.missing(scoring_tools.environment({"PATH": BARE_PATH})) == ["uv"]


def test_the_playwright_platform_override_is_remembered_too(home):
    """run.sh sets it on an Ubuntu newer than Playwright knows (playwright-platform.sh); a re-score started
    outside run.sh must launch the same browser."""
    scoring_tools.remember({"PATH": BARE_PATH, "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE": "ubuntu24.04-x64"})
    assert scoring_tools.environment({"PATH": BARE_PATH})["PLAYWRIGHT_HOST_PLATFORM_OVERRIDE"] == "ubuntu24.04-x64"
    mine = scoring_tools.environment({"PATH": BARE_PATH, "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE": "ubuntu22.04-x64"})
    assert mine["PLAYWRIGHT_HOST_PLATFORM_OVERRIDE"] == "ubuntu22.04-x64"      # the caller's own setting wins
    scoring_tools.remember({"PATH": BARE_PATH})                               # a later start without it forgets it
    assert "PLAYWRIGHT_HOST_PLATFORM_OVERRIDE" not in scoring_tools.environment({"PATH": BARE_PATH})


def test_what_is_remembered_is_this_machines_alone(home):
    """It holds home paths: never in a run's directory (which is committed), and readable by its owner only."""
    f = scoring_tools.remember({"PATH": BARE_PATH})
    assert f.parent == home and json.loads(f.read_text()) == {"PATH": BARE_PATH}
    assert stat.S_IMODE(f.stat().st_mode) == 0o600


def test_an_unreadable_record_is_ignored(home):
    home.mkdir(parents=True)
    (home / scoring_tools.ENV_FILE).write_text("not json")
    assert scoring_tools.environment({"PATH": BARE_PATH})["PATH"] == BARE_PATH


def test_remember_from_the_command_line(home, monkeypatch):
    monkeypatch.setenv("PATH", BARE_PATH)
    assert scoring_tools.main(["remember"]) == 0
    assert json.loads((home / scoring_tools.ENV_FILE).read_text())["PATH"] == BARE_PATH
