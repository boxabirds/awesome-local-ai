"""uv run --with pytest pytest harness/test_gates.py"""
from pathlib import Path

import gates


def test_unstartable_app_counts_every_applicable_test_as_failed(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "exit 1"}}')
    res = gates.accept(ws, [1], tmp_path / "out")
    assert res["total"] > 0, "an app that cannot start must fail its tests, not have none"
    assert res["passed"] == 0


BROWSER_MISSING = ("browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/"
                   "chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell")


def test_a_missing_browser_is_a_harness_fault_not_an_app_failure():
    tests = [{"status": "failed", "error": BROWSER_MISSING}, {"status": "failed", "error": BROWSER_MISSING}]
    assert "playwright install" in gates.harness_fault(tests)


def test_app_failures_are_not_harness_faults():
    refused = "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18787/"
    assert gates.harness_fault([{"status": "failed", "error": refused}, {"status": "passed", "error": ""}]) is None
    assert gates.harness_fault([]) is None


def test_the_gate_runs_the_agents_tests_against_the_agents_browsers(tmp_path: Path, monkeypatch):
    """The agent installs its own Playwright's browsers into agent_playwright_cache (the sandbox hides
    the held-out suite's). The gate must look there too: on a fresh node (tritus) the default cache
    held only the suite's older build, so every e2e run skipped every browser and failed with
    'No tests found' although the agent's own runs of the same tests had a browser."""
    import hostenv
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "true", "test:e2e": "true"}}')
    seen = {}

    def fake_run(cmd, cwd, timeout, env=None):
        seen[" ".join(cmd)] = env or {}
        return {"exit": 0, "tail": ""}
    monkeypatch.setattr(gates, "_run", fake_run)
    gates.gate(ws, ["build", "test:e2e"])
    e2e = next(env for cmd, env in seen.items() if "test:e2e" in cmd)
    assert e2e.get("PLAYWRIGHT_BROWSERS_PATH") == str(hostenv.agent_playwright_cache(Path.home()))


# What tritus's gate really printed (story 1, canvas-vk-01): the agent's playwright.config skips
# every browser it can't find, then Playwright finds no tests at all.
SKIPPED_ALL = ("[playwright.config] skipping chromium, firefox, webkit (browser not installed; run "
               "`npx playwright install --with-deps`)\n[WebServer] Ready on http://127.0.0.1:8787\n"
               "Error: No tests found\n")


def fake_gate(monkeypatch, e2e_tails, install_exit=0):
    """gates._run where each e2e run prints the next of e2e_tails; returns the commands run."""
    ran, tails = [], list(e2e_tails)

    def fake_run(cmd, cwd, timeout, env=None):
        ran.append(" ".join(cmd))
        if "test:e2e" in cmd:
            return {"exit": 1 if tails[0] != "ok" else 0, "tail": tails.pop(0)}
        if cmd[:3] == ["npx", "playwright", "install"]:
            return {"exit": install_exit, "tail": "download failed" if install_exit else ""}
        return {"exit": 0, "tail": ""}
    monkeypatch.setattr(gates, "_run", fake_run)
    return ran


def e2e_ws(tmp_path: Path) -> Path:
    ws = tmp_path / "ws"
    ws.mkdir(parents=True)
    (ws / "package.json").write_text('{"scripts": {"build": "true", "test:e2e": "true"}}')
    return ws


def test_a_missing_browser_in_the_gate_is_installed_once_then_rerun(tmp_path, monkeypatch):
    ran = fake_gate(monkeypatch, [SKIPPED_ALL, "ok"])
    res = gates.gate(e2e_ws(tmp_path), ["build", "test:e2e"])
    assert sum(c.startswith("npx playwright install") for c in ran) == 1
    assert res["all_green"] and res.get("harness_fault") is None


def test_a_browser_that_stays_missing_stops_the_run_as_missing_resources(tmp_path, monkeypatch):
    for tails, install_exit in (([SKIPPED_ALL, SKIPPED_ALL], 0), ([BROWSER_MISSING], 1)):
        ran = fake_gate(monkeypatch, tails, install_exit)
        res = gates.gate(e2e_ws(tmp_path / str(install_exit)), ["build", "test:e2e"])
        assert res["harness_fault"].startswith("missing resources:"), res
        assert "browser" in res["harness_fault"]
        assert sum(c.startswith("npx playwright install") for c in ran) == 1   # never retried forever


def test_an_app_whose_e2e_tests_fail_is_not_missing_resources(tmp_path, monkeypatch):
    fake_gate(monkeypatch, ["page.goto: net::ERR_CONNECTION_REFUSED\n1 failed\n"])
    res = gates.gate(e2e_ws(tmp_path), ["build", "test:e2e"])
    assert res["all_green"] is False and res.get("harness_fault") is None


def test_the_held_out_suite_without_a_browser_is_missing_resources_even_with_no_report(tmp_path, monkeypatch):
    """If the browser is gone before any test runs, there is no report to read the errors from."""
    acc = tmp_path / "acc"
    (acc / "tests").mkdir(parents=True)
    (acc / "tests" / "story-01.spec.ts").write_text("")
    monkeypatch.setattr(gates, "_run", lambda cmd, cwd, timeout, env=None: {"exit": 1, "tail": BROWSER_MISSING})
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] and res["harness_fault"].startswith("missing resources:")


def _fake_npm(tmp_path, script: str):
    """A workspace whose `npm` is a stub: `script` is sh that prints what a real run would."""
    import os
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"test:e2e": "playwright test"}}')
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for tool in ("npm", "npx"):
        (bin_ / tool).write_text("#!/bin/sh\n" + script)
        (bin_ / tool).chmod(0o755)
    return ws, {**os.environ, "PATH": f"{bin_}:{os.environ['PATH']}"}


def test_the_word_project_in_a_failing_e2e_run_is_not_a_missing_project(tmp_path, monkeypatch):
    # A todoodle build has tests about projects; a failing Chromium run mentions them. That is a red
    # gate, not a reason to rerun every browser (and then stop the run when WebKit isn't installed).
    ws, env = _fake_npm(tmp_path, '''case "$*" in
  *install*) exit 0;;
  *project=chromium*) echo "1 failed: tests/e2e/projects.spec.ts creates a project"; exit 1;;
  *) echo "browserType.launch: Executable doesn't exist at /x/webkit-2359/pw_run.sh"; exit 1;;
esac''')
    monkeypatch.setattr(gates.os, "environ", env)
    res = gates.gate(ws, ["test:e2e"])
    assert "harness_fault" not in res, res.get("harness_fault")
    assert res["steps"]["test:e2e"]["exit"] == 1


def test_only_a_missing_chromium_stops_the_run(tmp_path, monkeypatch):
    # The harness promises Chromium. With no chromium project the suite reruns on the agent's own
    # browsers; a missing WebKit there is the agent's configuration, not this machine's fault.
    ws, env = _fake_npm(tmp_path, '''case "$*" in
  *install*) exit 0;;
  *project=chromium*) echo 'Error: Project(s) "chromium" not found. Available projects: "webkit"'; exit 1;;
  *) echo "browserType.launch: Executable doesn't exist at /x/webkit-2359/pw_run.sh"; exit 1;;
esac''')
    monkeypatch.setattr(gates.os, "environ", env)
    res = gates.gate(ws, ["test:e2e"])
    assert "harness_fault" not in res, res.get("harness_fault")


def test_a_bun_workspace_is_installed_and_gated_with_bun(tmp_path, monkeypatch):
    # Todoodle's spec is a bun workspace (`workspace:` dependencies npm can't install): the gate must
    # use the workspace's own package manager, or every build shows red for a tooling reason.
    ran = []
    monkeypatch.setattr(gates, "_run", lambda cmd, cwd, timeout, env=None: ran.append(cmd) or {"exit": 0, "tail": ""})
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "x", "test:e2e": "x"}, "packageManager": "bun@1.2.0"}')
    gates.gate(ws, ["build", "test:e2e"])
    assert ran[0] == ["bun", "install"]
    assert ["bun", "run", "build"] in ran
    assert ["bun", "run", "test:e2e", "--project=chromium"] in ran


def test_an_npm_workspace_is_unchanged(tmp_path, monkeypatch):
    ran = []
    monkeypatch.setattr(gates, "_run", lambda cmd, cwd, timeout, env=None: ran.append(cmd) or {"exit": 0, "tail": ""})
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"scripts": {"build": "x"}}')
    (ws / "package-lock.json").write_text("{}")
    gates.gate(ws, ["build"])
    assert ran[0] == ["npm", "ci"] and ["npm", "run", "build"] in ran


def test_a_bun_lockfile_alone_marks_a_bun_workspace(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text("{}")
    (ws / "bun.lock").write_text("")
    assert gates.package_manager(ws) == "bun"
