"""uv run --with pytest pytest harness/test_gates.py"""
from pathlib import Path

import pytest

import gates


@pytest.fixture(autouse=True)
def no_port_listeners(monkeypatch):
    """Nothing listens on a scoring port unless a test says so: the real ports of the machine running the tests
    must not decide a test's result."""
    monkeypatch.setattr(gates, "_listeners", lambda port: [])


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
    the held-out suite's). The gate must look there too: on a fresh node (the Strix Halo box) the default cache
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
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    gates.gate(ws, ["build", "test:e2e"])
    e2e = next(env for cmd, env in seen.items() if "test:e2e" in cmd)
    assert e2e.get("PLAYWRIGHT_BROWSERS_PATH") == str(hostenv.agent_playwright_cache(Path.home()))


# What the Strix Halo box's gate really printed (story 1, canvas-vk-01): the agent's playwright.config skips
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
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
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
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] and res["harness_fault"].startswith("missing resources:")


def _suite_with_story_1(tmp_path):
    acc = tmp_path / "acc"
    (acc / "tests").mkdir(parents=True)
    (acc / "tests" / "story-01.spec.ts").write_text("")
    return acc


def _runs(*results):
    """A fake _run: the build, then the suite runner returning each of `results` in turn."""
    calls = []

    def run(cmd, cwd, timeout, env=None):
        calls.append(cmd)
        if cmd[:2] == ["npm", "run"]:
            return {"exit": 0, "tail": ""}
        return results[min(sum(c[:2] == ["npx", "playwright"] for c in calls), len(results)) - 1]
    return run, calls


def test_a_suite_runner_killed_before_its_report_is_retried_once(tmp_path, monkeypatch):
    """27 Sep 2026: a stray pkill SIGTERMed todoodle run-2's story-5 scoring; the record said 0/0."""
    acc = _suite_with_story_1(tmp_path)
    killed = {"exit": -15, "tail": "\nRunning 84 tests using 1 worker\n\n"}
    run, calls = _runs(killed, {"exit": 0, "tail": ""})
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert sum(c[:2] == ["npx", "playwright"] for c in calls) == 2
    assert res["harness_fault"] is None


def test_a_suite_runner_killed_every_time_is_a_harness_fault_not_a_score(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    run, _ = _runs({"exit": -15, "tail": "Running 84 tests using 1 worker"})
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] and res["harness_fault"].startswith(gates.SCORING_INTERRUPTED)
    assert "signal 15" in res["harness_fault"]


def test_a_suite_runner_that_timed_out_without_a_report_is_a_harness_fault(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    run, _ = _runs({"exit": "timeout", "tail": ""})
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] and "timed out" in res["harness_fault"]


def test_a_suite_runner_that_crashed_loading_playwright_is_a_harness_fault(tmp_path, monkeypatch):
    """30 Sep 2026: under Node 12, Playwright's own code didn't parse; the record said 0/0."""
    acc = _suite_with_story_1(tmp_path)
    crash = (f"{acc}/node_modules/playwright-core/lib/cli/program.js:160\n"
             "        console.log(`  Install location:    ${executable.directory ?? \"<system>\"}`);\n"
             "SyntaxError: Unexpected token '?'\n    at wrapSafe (internal/modules/cjs/loader.js:915:16)\n"
             f"    at Object.<anonymous> ({acc}/node_modules/playwright/lib/program.js:36:22)\n")
    run, _ = _runs({"exit": 1, "tail": crash})
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] and res["harness_fault"].startswith(gates.SCORING_INTERRUPTED)
    assert "runner failed to start" in res["harness_fault"] and "SyntaxError" in res["harness_fault"]


def test_a_suite_that_fails_normally_without_a_report_is_not_interrupted(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    run, calls = _runs({"exit": 1, "tail": "Error: something in the app"})
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] is None
    assert sum(c[:2] == ["npx", "playwright"] for c in calls) == 1


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
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
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
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
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


def test_setup_fallbacks_are_kept_per_test_and_counted_once_per_owner():
    """EVALUATION-POLICY rule 8: a held-out test whose setup fell back to the documented flow
    records it (Playwright annotation 'setup-fallback'); the result keeps it with the test and
    counts it against the story that owns the behaviour, not the story being checked."""
    from gates import _walk, _fallback_summary
    report = {"file": "story-07.spec.ts", "specs": [
        {"title": "drag moves the selection", "tests": [{"annotations": [
            {"type": "setup-fallback", "description": "createNote (partial); story 2; TC-35"}],
            "results": [{"status": "passed", "annotations": [
                {"type": "setup-fallback", "description": "createNote (partial); story 2; TC-35"}]}]}]},
        {"title": "shift-click toggles", "tests": [{"annotations": [], "results": [{"status": "passed"}]}]}]}
    tests = list(_walk(report))
    assert tests[0]["setup_fallbacks"] == ["createNote (partial); story 2; TC-35"]
    assert tests[1]["setup_fallbacks"] == []
    assert _fallback_summary(tests) == {"tests": 1, "by_owner": {"2": 1}}


def test_a_repeat_scoring_reruns_only_the_named_tests_without_rebuilding(tmp_path, monkeypatch):
    """rescore.py's second and third scorings: the app is already built, and only the tests that
    failed need another look, by file and line."""
    import gates
    calls = []
    monkeypatch.setattr(gates, "_run", lambda cmd, cwd, timeout, env=None: calls.append(cmd) or
                        {"cmd": " ".join(cmd), "exit": 0, "seconds": 0, "tail": ""})
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    acc_dir = tmp_path / "acceptance"; (acc_dir / "tests").mkdir(parents=True)
    for s in (1, 2):
        (acc_dir / "tests" / f"story-{s:02d}.spec.ts").write_text("")
    gates.accept(tmp_path, [1, 2], tmp_path / "out", acc_dir, build=False,
                 only=[("story-02.spec.ts", 81), ("story-01.spec.ts", 12)])
    assert not any(c[:3] == ["npm", "run", "build"] for c in calls)
    assert calls[-1][:3] == ["npx", "playwright", "test"]
    assert calls[-1][3:] == ["tests/story-02.spec.ts:81", "tests/story-01.spec.ts:12"]


def test_each_test_result_keeps_its_line_so_it_can_be_rerun():
    from gates import _walk
    report = {"file": "story-02.spec.ts", "specs": [{"title": "t", "line": 81, "tests": [{"results": [{"status": "failed"}]}]}]}
    assert list(_walk(report))[0]["line"] == 81


# ---------- app server lifetime: the scoring owns the servers it starts ----------

def test_recorded_servers_are_read_back_as_process_groups(tmp_path):
    from gates import recorded_server_groups, SERVERS_FILE
    (tmp_path / SERVERS_FILE).write_text("4101 18800\n4102 18802\n\nnot a line\n")
    assert recorded_server_groups(tmp_path) == {4101, 4102}
    assert recorded_server_groups(tmp_path / "missing") == set()


def test_a_scoring_kills_the_servers_it_recorded_even_when_the_runner_fails(tmp_path, monkeypatch):
    """Playwright's teardown stops the servers only if Playwright gets that far. The scoring itself
    kills every server group recorded in its artifacts, however the runner ended."""
    import gates
    acc_dir = tmp_path / "acceptance"; (acc_dir / "tests").mkdir(parents=True)
    (acc_dir / "tests" / "story-01.spec.ts").write_text("")
    killed = []
    monkeypatch.setattr(gates, "kill_groups", lambda groups: killed.append(set(groups)))
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    def run(cmd, cwd, timeout, env=None):
        if cmd[:2] == ["npx", "playwright"]:
            (tmp_path / "out" / "artifacts").mkdir(parents=True, exist_ok=True)
            (tmp_path / "out" / "artifacts" / gates.SERVERS_FILE).write_text("777 18800\n")
            raise KeyboardInterrupt  # the scoring is stopped mid-run
        return {"cmd": " ".join(cmd), "exit": 0, "seconds": 0, "tail": ""}
    monkeypatch.setattr(gates, "_run_owned", run)
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    monkeypatch.setattr(gates, "reclaim_ports", lambda ports: [])
    import pytest
    with pytest.raises(KeyboardInterrupt):
        gates.accept(tmp_path, [1], tmp_path / "out", acc_dir)
    assert {777} in killed


@pytest.mark.parametrize("cmd,ours", [
    ("node /x/node_modules/wrangler/wrangler-dist/cli.js dev --port 18800", True),
    ("/x/node_modules/@cloudflare/workerd-darwin-arm64/bin/workerd serve --binary", True),
    ("node /x/acceptance/node_modules/.bin/playwright test tests/story-01.spec.ts", True),
    ("/usr/sbin/sshd -D", False),
    ("python3 -m http.server 18800", False),
])
def test_only_our_own_leftovers_are_reclaimed_from_a_scoring_port(cmd, ours):
    """A hard-killed scoring can leave a server on its port. The next scoring takes the port back
    only from an app server or test runner, never from anything else."""
    from gates import is_scoring_process
    assert is_scoring_process(cmd) is ours


# ---------- a port another program holds is the machine's fault, not the app's (item 6c) ----------
# Before 30 Sep 2026 reclaim_ports noted "held by something else" on stderr and the scoring went ahead;
# the suite's waitPortFree then threw after 30 s and every test failed as if the app never started.

def _suite_run(monkeypatch):
    """gates._run where the build passes and the suite runner writes nothing; returns the commands run."""
    calls = []
    monkeypatch.setattr(gates, "_run", lambda cmd, cwd, timeout, env=None: calls.append(cmd) or
                        {"cmd": " ".join(cmd), "exit": 0, "seconds": 0, "tail": ""})
    monkeypatch.setattr(gates, "_run_owned", gates._run)
    return calls


def _listening(monkeypatch, holders: dict):
    """gates._listeners from {port: [(pid, command), ...]}; each holder a list of answers, one per call."""
    asked = {}

    def listeners(port):
        answers = holders.get(port) or [[]]
        n = asked[port] = asked.get(port, -1) + 1
        return answers[min(n, len(answers) - 1)]
    monkeypatch.setattr(gates, "_listeners", listeners)


def test_a_port_held_by_another_program_is_a_harness_fault_and_the_suite_never_runs(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    calls = _suite_run(monkeypatch)
    monkeypatch.setenv("ACCEPT_PORT", "18800")
    monkeypatch.setenv("ACCEPT_WORKERS", "1")
    _listening(monkeypatch, {18801: [[("4242", "python3 -m http.server 18801")]]})
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"].startswith(gates.MISSING_RESOURCES)
    assert "18801" in res["harness_fault"] and "4242" in res["harness_fault"] and "http.server" in res["harness_fault"]
    assert not any(c[:2] == ["npx", "playwright"] for c in calls)
    assert (res["passed"], res["total"], res["tests"]) == (0, 0, [])


def test_every_workers_ports_are_checked(tmp_path, monkeypatch):
    """ACCEPT_WORKERS=3 gives each worker its app port and its control port: six ports in all."""
    acc = _suite_with_story_1(tmp_path)
    _suite_run(monkeypatch)
    monkeypatch.setenv("ACCEPT_PORT", "18800")
    monkeypatch.setenv("ACCEPT_WORKERS", "3")
    assert gates.scoring_ports() == [18800, 18801, 18802, 18803, 18804, 18805]
    _listening(monkeypatch, {18805: [[("99", "/usr/sbin/sshd -D")]]})
    assert "18805" in gates.accept(tmp_path, [1], tmp_path / "out", acc)["harness_fault"]


def test_a_leftover_of_our_own_is_reclaimed_and_the_scoring_goes_ahead(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    calls = _suite_run(monkeypatch)
    monkeypatch.setenv("ACCEPT_PORT", "18800")
    monkeypatch.setenv("ACCEPT_WORKERS", "1")
    wrangler = ("555", "node /x/node_modules/wrangler/wrangler-dist/cli.js dev --port 18800")
    _listening(monkeypatch, {18800: [[wrangler], []]})          # gone once killed
    killed = []
    monkeypatch.setattr(gates, "kill_groups", lambda groups: killed.append(set(groups)))
    monkeypatch.setattr(gates.os, "getpgid", lambda pid: pid)
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert {555} in killed
    assert res["harness_fault"] is None
    assert any(c[:2] == ["npx", "playwright"] for c in calls)


def test_a_leftover_of_our_own_that_survives_the_kill_is_still_a_fault(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    calls = _suite_run(monkeypatch)
    monkeypatch.setenv("ACCEPT_PORT", "18800")
    monkeypatch.setenv("ACCEPT_WORKERS", "1")
    _listening(monkeypatch, {18800: [[("555", "/x/workerd serve")]]})       # never goes away
    monkeypatch.setattr(gates, "kill_groups", lambda groups: None)
    monkeypatch.setattr(gates.os, "getpgid", lambda pid: pid)
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"].startswith(gates.MISSING_RESOURCES) and "18800" in res["harness_fault"]
    assert not any(c[:2] == ["npx", "playwright"] for c in calls)


def test_free_ports_are_no_fault(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    _suite_run(monkeypatch)
    assert gates.accept(tmp_path, [1], tmp_path / "out", acc)["harness_fault"] is None


# The suite's AppServer.waitPortFree (private suite, tests/app-server.ts) when a port never frees up.
PORT_STUCK = "Error: port 18800 still in use after 30000 ms"


def test_a_port_the_suite_waited_on_in_vain_is_a_harness_fault():
    tests = [{"status": "failed", "error": PORT_STUCK}, {"status": "passed", "error": ""}]
    fault = gates.harness_fault(tests)
    assert fault and fault.startswith(gates.MISSING_RESOURCES) and "18800" in fault


def test_a_port_the_suite_waited_on_in_global_setup_is_a_harness_fault():
    """Global setup failing means no test ran: the message is only in the runner's output."""
    assert "18800" in gates.harness_fault([], runner_tail=f"Error in global setup\n{PORT_STUCK}\n    at waitPortFree")


def test_an_app_error_that_mentions_a_port_is_not_a_port_fault():
    tests = [{"status": "failed", "error": "Error: expect(locator).toHaveText(expected) 'port 3 still open'"}]
    assert gates.harness_fault(tests) is None


# ---------- the build follows the workspace's package manager, and says why it failed ----------

def test_the_held_out_build_uses_the_workspaces_package_manager(tmp_path, monkeypatch):
    calls = _suite_run(monkeypatch)
    acc = _suite_with_story_1(tmp_path)
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "package.json").write_text('{"packageManager": "bun@1.2.0"}')
    gates.accept(ws, [1], tmp_path / "out", acc)
    assert ["bun", "run", "build"] in calls and ["npm", "run", "build"] not in calls
    (ws / "package.json").write_text('{}')
    gates.accept(ws, [1], tmp_path / "out2", acc)
    assert ["npm", "run", "build"] in calls


def test_a_failed_build_keeps_its_output_and_a_passing_one_does_not(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)

    def run(cmd, cwd, timeout, env=None):
        if cmd[1:3] == ["run", "build"]:
            return {"cmd": "", "exit": 127, "seconds": 0, "tail": "sh: vite: command not found"}
        return {"cmd": "", "exit": 0, "seconds": 0, "tail": ""}
    monkeypatch.setattr(gates, "_run", run)
    monkeypatch.setattr(gates, "_run_owned", run)
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["build_exit"] == 127 and "vite: command not found" in res["build_tail"]
    _suite_run(monkeypatch)
    assert "build_tail" not in gates.accept(tmp_path, [1], tmp_path / "out", acc)


# ---------- the scoring environment is recorded with every result (item 6e) ----------

def test_every_scoring_records_its_environment(tmp_path, monkeypatch):
    import scoring_env
    acc = _suite_with_story_1(tmp_path)
    _suite_run(monkeypatch)
    monkeypatch.setenv("ACCEPT_WORKERS", "3")
    seen = {}
    monkeypatch.setattr(scoring_env, "environment",
                        lambda acceptance, workers: seen.update(acceptance=acceptance, workers=workers) or {"node": "v1"})
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["environment"] == {"node": "v1"}
    assert seen == {"acceptance": acc, "workers": 3}


def test_a_scoring_stopped_by_a_held_port_still_records_its_environment(tmp_path, monkeypatch):
    acc = _suite_with_story_1(tmp_path)
    _suite_run(monkeypatch)
    _listening(monkeypatch, {gates.DEFAULT_ACCEPT_PORT: [[("1", "sshd")]]})
    monkeypatch.delenv("ACCEPT_PORT", raising=False)
    res = gates.accept(tmp_path, [1], tmp_path / "out", acc)
    assert res["harness_fault"] and set(res["environment"]) >= {"node", "playwright", "workers"}


# ---------- error signatures: many failures, one cause ----------

REFUSED = "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18800/"


@pytest.mark.parametrize("a,b", [
    (REFUSED, "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18802/b/7f3a"),   # another worker, board
    ("\x1b[31mTimeoutError\x1b[39m: waiting 5000ms", "TimeoutError: waiting 15000ms"),        # colour, numbers
    ("Error: x\n    at story-01.spec.ts:12:5", "Error: x\n    at story-07.spec.ts:40:9"),       # only the first line
    ("Error: expected 'red'", 'Error: expected "blue"'),                                      # quoted values
])
def test_messages_that_differ_only_in_detail_share_a_signature(a, b):
    assert gates.error_signature(a) == gates.error_signature(b)


@pytest.mark.parametrize("a,b", [
    (REFUSED, "Error: expect(locator).toBeVisible() failed"),
    ("TimeoutError: locator.click", "TimeoutError: locator.fill"),
])
def test_different_failures_have_different_signatures(a, b):
    assert gates.error_signature(a) != gates.error_signature(b)


def test_shared_signature_names_the_one_cause_of_every_failure():
    tests = [{"status": "failed", "error": REFUSED.replace("18800", str(p))} for p in (18800, 18802, 18804)]
    tests += [{"status": "skipped", "error": ""}, {"status": "passed", "error": ""}]
    assert gates.shared_signature(tests) == (gates.error_signature(REFUSED), 3)


def test_shared_signature_is_none_when_the_failures_differ_or_there_are_none():
    mixed = [{"status": "failed", "error": REFUSED}, {"status": "timedOut", "error": "Test timeout exceeded"}]
    assert gates.shared_signature(mixed) == (None, 2)
    assert gates.shared_signature([{"status": "passed", "error": ""}]) == (None, 0)
