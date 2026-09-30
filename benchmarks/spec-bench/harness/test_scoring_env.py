"""scoring_env.py: what a held-out scoring ran on, recorded with its result, so a live score and a re-score of
the same code can be told apart by their environments (the Node 12 incident of 30 Sep 2026: a scorer's PATH
held a Node too old for Playwright, and nobody could see it in the record)."""
import json
import subprocess
from pathlib import Path

import scoring_env

PW_VERSION = "1.58.2"
CHROMIUM_VERSION = "145.0.7632.6"
CHROMIUM_REVISION = "1208"


def suite(tmp_path: Path, playwright: str | None = PW_VERSION, browsers: dict | None = None) -> Path:
    """A held-out suite directory with the files Playwright installs, as npm leaves them."""
    acc = tmp_path / "acceptance"
    if playwright:
        (acc / "node_modules" / "@playwright" / "test").mkdir(parents=True)
        (acc / "node_modules" / "@playwright" / "test" / "package.json").write_text(
            json.dumps({"name": "@playwright/test", "version": playwright}))
    if browsers is not None:
        (acc / "node_modules" / "playwright-core").mkdir(parents=True, exist_ok=True)
        (acc / "node_modules" / "playwright-core" / "browsers.json").write_text(json.dumps(browsers))
    acc.mkdir(exist_ok=True)
    return acc


BROWSERS = {"browsers": [
    {"name": "chromium", "revision": CHROMIUM_REVISION, "browserVersion": CHROMIUM_VERSION},
    {"name": "firefox", "revision": "1497", "browserVersion": "146.0"}]}


def fake_tools(versions: dict):
    """subprocess.run for `<tool> --version`: the version, or FileNotFoundError for a tool not installed."""
    def run(cmd, **kw):
        if cmd[0] not in versions:
            raise FileNotFoundError(cmd[0])
        return subprocess.CompletedProcess(cmd, 0, stdout=versions[cmd[0]] + "\n", stderr="")
    return run


def test_every_field_the_review_asked_for_is_recorded(tmp_path):
    env = scoring_env.environment(suite(tmp_path, browsers=BROWSERS), workers=4,
                                  run=fake_tools({"node": "v24.15.0", "npm": "11.12.1"}))
    assert env["node"] == "v24.15.0" and env["npm"] == "11.12.1"
    assert env["playwright"] == PW_VERSION
    assert env["chromium"] == f"{CHROMIUM_VERSION} (r{CHROMIUM_REVISION})"
    assert env["workers"] == 4
    assert env["os"] and env["arch"]
    assert set(env) == set(scoring_env.FIELDS)


def test_a_tool_that_is_missing_or_fails_is_recorded_as_unknown_not_raised(tmp_path):
    def failing(cmd, **kw):
        if cmd[0] == "npm":
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="npm: broken")
        raise FileNotFoundError(cmd[0])
    env = scoring_env.environment(suite(tmp_path), workers=1, run=failing)
    assert env["node"] is None and env["npm"] is None


def test_a_tool_that_hangs_is_recorded_as_unknown(tmp_path):
    def hangs(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))
    assert scoring_env.environment(suite(tmp_path), workers=1, run=hangs)["node"] is None


def test_a_suite_without_installed_packages_has_no_playwright_or_chromium_version(tmp_path):
    env = scoring_env.environment(suite(tmp_path, playwright=None), workers=1, run=fake_tools({}))
    assert env["playwright"] is None and env["chromium"] is None


def test_the_playwright_runner_package_counts_when_the_test_package_is_absent(tmp_path):
    acc = suite(tmp_path, playwright=None)
    (acc / "node_modules" / "playwright").mkdir(parents=True)
    (acc / "node_modules" / "playwright" / "package.json").write_text(json.dumps({"version": "1.57.0"}))
    assert scoring_env.environment(acc, workers=1, run=fake_tools({}))["playwright"] == "1.57.0"


def test_a_browsers_file_without_chromium_or_unreadable_is_unknown(tmp_path):
    no_chromium = {"browsers": [{"name": "webkit", "revision": "2", "browserVersion": "26"}]}
    assert scoring_env.environment(suite(tmp_path / "a", browsers=no_chromium), 1, run=fake_tools({}))["chromium"] is None
    acc = suite(tmp_path / "b", browsers={})
    (acc / "node_modules" / "playwright-core" / "browsers.json").write_text("{not json")
    assert scoring_env.environment(acc, 1, run=fake_tools({}))["chromium"] is None


def test_no_suite_at_all_still_records_the_machine(tmp_path):
    env = scoring_env.environment(None, workers=2, run=fake_tools({"node": "v24.15.0"}))
    assert env["node"] == "v24.15.0" and env["playwright"] is None and env["workers"] == 2


def test_the_real_machine_reports_its_own_node_when_it_has_one():
    import shutil
    env = scoring_env.environment(None, workers=1)
    if shutil.which("node"):
        assert env["node"] and env["node"].startswith("v")
    else:
        assert env["node"] is None
