"""rescore.py: a finished run's held-out scores recomputed under another pack version, from each
story's recorded code, without touching the run's own scores."""
import json
from pathlib import Path

import pytest

import rescore
from rescore import checkpoints, out_dir


def _metrics(tmp_path: Path, stories: dict, processed: list) -> Path:
    (tmp_path / "metrics.json").write_text(json.dumps({"stories": stories, "processed": processed}))
    return tmp_path


def test_checkpoints_follow_the_processed_order_with_everything_built_so_far(tmp_path):
    run = _metrics(tmp_path,
                   {"1": {"commit": "aaa", "finished": 1}, "2": {"commit": "bbb", "finished": 1},
                    "5": {"commit": "ccc", "finished": 1}},
                   [{"id": 1, "status": "DONE"}, {"id": 2, "status": "PARTIAL"}, {"id": 5, "status": "DONE"}])
    cps = checkpoints(run)
    assert [(c["story"], c["commit"]) for c in cps] == [(1, "aaa"), (2, "bbb"), (5, "ccc")]
    assert cps[2]["processed"] == [{"id": 1, "status": "DONE"}, {"id": 2, "status": "PARTIAL"},
                                   {"id": 5, "status": "DONE"}]


def test_a_story_without_recorded_code_is_left_out(tmp_path):
    """Scored once at the end (Opus run-1) or never finished: no per-story code to score."""
    run = _metrics(tmp_path, {"1": {"commit": "aaa", "finished": 1}, "2": {"finished": 1}},
                   [{"id": 1, "status": "DONE"}, {"id": 2, "status": "DONE"}])
    assert [c["story"] for c in checkpoints(run)] == [1]


def test_rescores_go_beside_the_runs_own_scores(tmp_path):
    """Never over them: the original version's scores stay the record of what was measured then."""
    assert out_dir(tmp_path, "vidi-v1.2") == tmp_path / "rescore" / "vidi-v1.2"


def _acc(results: dict) -> dict:
    tests = [{"file": f, "title": t, "status": s, "setup_fallbacks": []} for (f, t), s in results.items()]
    return {"passed": sum(s == "passed" for s in results.values()), "total": len(results), "tests": tests,
            "by_story": {}, "setup_fallbacks": {"tests": 0, "by_owner": {}}}


def test_majority_takes_each_tests_most_common_result_and_names_the_flaky_ones():
    """Racy app code passes a test some of the time (canvas-mlx-02: 13 of 75 tests changed result
    across three identical scorings; Opus run-3: none). Each test takes its majority result, and the
    tests that changed are reported as flaky: a defect in the app, measured instead of left to chance."""
    from rescore import majority
    a, b, c = ("story-02.spec.ts", "a"), ("story-02.spec.ts", "b"), ("story-07.spec.ts", "c")
    m = majority([_acc({a: "passed", b: "failed", c: "passed"}),
                  _acc({a: "passed", b: "passed", c: "failed"}),
                  _acc({a: "passed", b: "failed", c: "failed"})])
    assert {t["title"]: t["status"] for t in m["tests"]} == {"a": "passed", "b": "failed", "c": "failed"}
    assert (m["passed"], m["total"], m["scorings"], m["scores"]) == (1, 3, 3, [2, 2, 1])
    assert sorted(m["flaky"]) == ["story-02.spec.ts: b", "story-07.spec.ts: c"]
    assert m["by_story"] == {"02": {"passed": 1, "total": 2}, "07": {"passed": 0, "total": 1}}


def test_workers_follow_the_hosts_limits():
    """Held-out workers are chosen from what the host has: cores and free memory, each worker costing
    CORES_PER_WORKER and GB_PER_WORKER (calibrated), never fewer than one. Any host can score."""
    from rescore import auto_workers, CORES_PER_WORKER, GB_PER_WORKER, MAX_WORKERS
    assert auto_workers(cores=8 * CORES_PER_WORKER, free_gb=100) == min(8, MAX_WORKERS)
    assert auto_workers(cores=64, free_gb=3 * GB_PER_WORKER) == min(3, MAX_WORKERS)
    assert auto_workers(cores=1, free_gb=0.5) == 1


def test_a_partial_repeat_counts_only_for_the_tests_it_reran():
    """Repeat scorings rerun just the failed tests; every other test keeps its first result."""
    from rescore import overlay, majority, failed_tests
    a, b, c = ("story-02.spec.ts", "a"), ("story-02.spec.ts", "b"), ("story-07.spec.ts", "c")
    first = _acc({a: "passed", b: "failed", c: "failed"})
    for t, line in zip(first["tests"], (10, 20, 30)):
        t["line"] = line
    assert failed_tests(first) == [("story-02.spec.ts", 20), ("story-07.spec.ts", 30)]
    rerun = _acc({b: "passed", c: "failed"})
    full = overlay(first, rerun)
    assert {t["title"]: t["status"] for t in full["tests"]} == {"a": "passed", "b": "passed", "c": "failed"}
    m = majority([first, full, overlay(first, _acc({b: "passed", c: "failed"}))])
    assert {t["title"]: t["status"] for t in m["tests"]} == {"a": "passed", "b": "passed", "c": "failed"}
    assert m["flaky"] == ["story-02.spec.ts: b"]


class FakeNpm:
    """Stands in for subprocess.run over `npm ci`: exit codes in the order they're asked for."""
    def __init__(self, *codes):
        self.codes, self.calls = list(codes), []

    def __call__(self, cmd, **kw):
        self.calls.append(cmd)
        import subprocess
        return subprocess.CompletedProcess(cmd, self.codes.pop(0), stdout="", stderr="npm error ERESOLVE could not resolve")


def test_a_clean_install_is_the_first_try(tmp_path):
    (tmp_path / "package-lock.json").write_text("{}")
    (tmp_path / "package.json").write_text("{}")
    npm = FakeNpm(0)
    assert rescore.install(tmp_path, npm) == {"ok": True, "command": "npm ci --no-audit --no-fund", "fallback": False}
    assert len(npm.calls) == 1


def test_a_lockfile_that_needs_legacy_peer_deps_installs_that_way_and_says_so(tmp_path):
    """30 Sep 2026: Swift v2-r2's agent installed with --legacy-peer-deps (the spec never asks for a clean
    `npm ci`); the re-score's plain `npm ci` failed unchecked, the build found no vite (exit 127), and every
    held-out test got "connection refused": 0/75 against a live 63/75."""
    (tmp_path / "package-lock.json").write_text("{}")
    (tmp_path / "package.json").write_text("{}")
    npm = FakeNpm(1, 0)
    got = rescore.install(tmp_path, npm)
    assert got == {"ok": True, "command": "npm ci --no-audit --no-fund --legacy-peer-deps", "fallback": True}
    assert "--legacy-peer-deps" in npm.calls[1]


def test_an_install_that_fails_every_way_says_why(tmp_path):
    (tmp_path / "package-lock.json").write_text("{}")
    (tmp_path / "package.json").write_text("{}")
    got = rescore.install(tmp_path, FakeNpm(1, 1))
    assert got["ok"] is False and "ERESOLVE" in got["error"]


def test_without_a_lockfile_the_checkpoint_is_not_installed_and_not_scored(tmp_path):
    """Until 30 Sep 2026 a checkpoint with no lockfile skipped the install and was scored with no node_modules:
    every test failed as if the app were broken."""
    (tmp_path / "package.json").write_text("{}")
    npm = FakeNpm()
    got = rescore.install(tmp_path, npm)
    assert got["ok"] is False and got["command"] is None and "package-lock.json" in got["error"]
    assert npm.calls == []
    assert rescore.install_fault(got).startswith("scoring interrupted:")


def test_a_failed_install_is_a_fault_not_a_score():
    assert rescore.install_fault({"ok": False, "error": "npm error ERESOLVE"}).startswith("scoring interrupted:")
    assert rescore.install_fault({"ok": True}) is None


# ---------- install follows the workspace's package manager (item 6d) ----------

def _pkg(ws: Path, manifest: dict | None = None, *lockfiles: str) -> Path:
    ws.mkdir(parents=True, exist_ok=True)
    if manifest is not None:
        (ws / "package.json").write_text(json.dumps(manifest))
    for f in lockfiles:
        (ws / f).write_text("{}")
    return ws


@pytest.mark.parametrize("lockfile", ["bun.lock", "bun.lockb"])
def test_a_bun_workspace_installs_exactly_its_lockfile_with_bun(tmp_path, lockfile):
    ws = _pkg(tmp_path, {}, lockfile)
    bun = FakeNpm(0)
    got = rescore.install(ws, bun)
    assert bun.calls == [["bun", "install", "--frozen-lockfile"]]
    assert got == {"ok": True, "command": "bun install --frozen-lockfile", "fallback": False}


def test_a_bun_lockfile_bun_refuses_is_a_fault_not_a_fresh_resolve(tmp_path):
    """npm's fallback keeps the lockfile's versions (--legacy-peer-deps changes peer checks only); a plain
    `bun install` would resolve afresh and score other code than was committed, so bun has no fallback."""
    ws = _pkg(tmp_path, {}, "bun.lock")
    bun = FakeNpm(1)
    got = rescore.install(ws, bun)
    assert got["ok"] is False and len(bun.calls) == 1


def test_a_workspace_that_declares_bun_but_has_no_bun_lockfile_is_a_fault(tmp_path):
    ws = _pkg(tmp_path, {"packageManager": "bun@1.2.0"}, "package-lock.json")
    bun = FakeNpm()
    got = rescore.install(ws, bun)
    assert got["ok"] is False and "bun.lock" in got["error"] and bun.calls == []


def test_a_lockfile_of_a_manager_the_scorer_does_not_run_is_named_in_the_fault(tmp_path):
    ws = _pkg(tmp_path, {"packageManager": "pnpm@9.0.0"}, "pnpm-lock.yaml")
    got = rescore.install(ws, FakeNpm())
    assert got["ok"] is False and "pnpm-lock.yaml" in got["error"] and "package-lock.json" in got["error"]


def test_a_checkpoint_without_a_package_json_is_a_fault(tmp_path):
    got = rescore.install(_pkg(tmp_path), FakeNpm())
    assert got["ok"] is False and "package.json" in got["error"]


def test_an_installer_that_is_not_there_is_a_fault_not_a_crash(tmp_path):
    ws = _pkg(tmp_path, {}, "bun.lock")

    def missing(cmd, **kw):
        raise FileNotFoundError(2, "No such file or directory", cmd[0])
    got = rescore.install(ws, missing)
    assert got["ok"] is False and "bun" in got["error"]


def test_an_install_that_times_out_is_a_fault(tmp_path):
    import subprocess
    ws = _pkg(tmp_path, {}, "package-lock.json")

    def slow(cmd, **kw):
        raise subprocess.TimeoutExpired(cmd, kw["timeout"])
    got = rescore.install(ws, slow)
    assert got["ok"] is False and "timed out" in got["error"]


def test_the_npm_workspace_install_is_unchanged(tmp_path):
    ws = _pkg(tmp_path, {}, "package-lock.json")
    npm = FakeNpm(0)
    assert rescore.install(ws, npm)["command"] == "npm ci --no-audit --no-fund"


# ---------- a failed build is the machine's when the live build of the same code passed (item 6b) ----------

def test_a_build_that_failed_only_in_the_rescore_is_a_harness_fault():
    """Swift 1.5 v2-r2 (30 Sep 2026): the re-score's build exited 127 (no vite) and every test failed, 0/75,
    while the live build of the same commit had passed and scored 63/75."""
    acc = {"skipped": False, "build_exit": 127, "build_tail": "sh: vite: command not found"}
    fault = rescore.build_fault(acc, live_build_exit=0)
    assert fault.startswith("scoring interrupted:") and "127" in fault and "vite: command not found" in fault


def test_a_build_that_failed_live_too_is_the_apps_own_failure():
    assert rescore.build_fault({"skipped": False, "build_exit": 1}, live_build_exit=1) is None


def test_a_failed_build_with_no_live_build_to_compare_is_a_fault():
    """Fail closed: nothing shows the app's build ever failed where the agent worked."""
    fault = rescore.build_fault({"skipped": False, "build_exit": 1}, live_build_exit=None)
    assert fault and "no live build" in fault


@pytest.mark.parametrize("acc", [{"skipped": False, "build_exit": 0}, {"skipped": True, "build_exit": None}])
def test_a_passing_or_absent_build_is_no_fault(acc):
    assert rescore.build_fault(acc, live_build_exit=None) is None


def test_checkpoints_carry_the_live_score_and_build_of_their_commit(tmp_path):
    run = _metrics(tmp_path,
                   {"1": {"commit": "aaa", "accept": {"passed": 6, "total": 6, "build_exit": 0}},
                    "2": {"commit": "bbb", "gate": {"steps": {"build": {"exit": 2}}},
                          "accept": {"passed": 0, "total": 10}}},
                   [{"id": 1, "status": "DONE"}, {"id": 2, "status": "DONE"}])
    cps = checkpoints(run)
    assert cps[0]["live"] == {"passed": 6, "total": 6, "build_exit": 0}
    assert cps[1]["live"] == {"passed": 0, "total": 10, "build_exit": 2}      # the gate's build when accept has none


# ---------- flaky tests are re-checked both ways (item 15) ----------

def _tests(statuses: dict) -> dict:
    """An accept result from {title: status}, every test in story-01 with its own line."""
    tests = [{"file": "story-01.spec.ts", "title": t, "line": n, "status": s, "setup_fallbacks": [], "error": ""}
             for n, (t, s) in enumerate(statuses.items(), 1)]
    applicable = [t for t in tests if t["status"] != "skipped"]
    return {"passed": sum(t["status"] == "passed" for t in applicable), "total": len(applicable), "tests": tests,
            "by_story": {}, "setup_fallbacks": {"tests": 0, "by_owner": {}}}


def test_the_passing_sample_is_a_fraction_with_a_floor():
    assert rescore.passing_sample_size(0) == 0
    assert rescore.passing_sample_size(3) == 3                               # fewer than the floor: all of them
    assert rescore.passing_sample_size(rescore.PASSING_SAMPLE_MIN) == rescore.PASSING_SAMPLE_MIN
    assert rescore.passing_sample_size(20) == rescore.PASSING_SAMPLE_MIN     # 20% of 20 is 4, below the floor
    assert rescore.passing_sample_size(63) == 13                             # ceil(20% of 63)
    assert rescore.passing_sample_size(100) == 20


def test_every_failing_test_and_a_seeded_sample_of_passing_ones_are_rerun():
    acc = _tests({f"p{n}": "passed" for n in range(30)} | {"f1": "failed", "f2": "timedOut", "s": "skipped"})
    targets = rescore.repeat_targets(acc, seed="abc123")
    failing = [("story-01.spec.ts", 31), ("story-01.spec.ts", 32)]
    assert targets["failing"] == failing
    assert len(targets["passing"]) == rescore.passing_sample_size(30)
    assert set(targets["passing"]) <= {("story-01.spec.ts", n) for n in range(1, 31)}
    assert rescore.repeat_targets(acc, seed="abc123") == targets              # the same checkpoint, the same sample
    assert rescore.repeat_targets(acc, seed="def456")["passing"] != targets["passing"]


def test_a_test_without_a_line_cannot_be_rerun_and_is_not_sampled():
    acc = _tests({"a": "passed", "b": "passed"})
    acc["tests"][0]["line"] = None
    assert rescore.repeat_targets(acc, seed="x")["passing"] == [("story-01.spec.ts", 2)]


def test_a_clean_checkpoint_is_now_rechecked_too():
    """Before item 15 a checkpoint with no failure was scored once, so a lucky pass was never looked at again."""
    acc = _tests({f"p{n}": "passed" for n in range(10)})
    t = rescore.repeat_targets(acc, seed="x")
    assert t["failing"] == [] and len(t["passing"]) == rescore.PASSING_SAMPLE_MIN


def test_flaky_is_reported_both_ways():
    first = _tests({"pass-then-fails": "passed", "fail-then-passes": "failed", "steady": "passed", "broken": "failed"})
    again = _tests({"pass-then-fails": "failed", "fail-then-passes": "passed", "steady": "passed", "broken": "failed"})
    m = rescore.majority([first, again, again], sampled_passing=2)
    assert {t["title"]: t["status"] for t in m["tests"]} == {
        "pass-then-fails": "failed", "fail-then-passes": "passed", "steady": "passed", "broken": "failed"}
    assert m["flaky_passing"] == ["story-01.spec.ts: pass-then-fails"]
    assert m["flaky_failing"] == ["story-01.spec.ts: fail-then-passes"]
    assert sorted(m["flaky"]) == sorted(m["flaky_passing"] + m["flaky_failing"])
    assert m["passing_sampled"] == 2 and m["passed"] == 2


def _counted_as_passing(p: float, rerun: bool) -> float:
    """Exact chance that a test passing with probability p is recorded as passing, over every outcome of
    three scorings, using majority() itself. Not rerun, a first pass is kept as it is."""
    from itertools import product
    total = 0.0
    for outcome in product((True, False), repeat=rescore.SCORINGS_IF_ANY_FAIL):
        weight = 1.0
        for ok in outcome:
            weight *= p if ok else 1 - p
        if outcome[0] and not rerun:
            total += weight
            continue
        accs = [_tests({"t": "passed" if ok else "failed"}) for ok in outcome]
        total += weight * (rescore.majority(accs)["passed"] == 1)
    return total


def test_rechecking_a_passing_test_removes_the_bias_towards_passing():
    """The review's m1: a test passing half the time counted as passing about 63% of the time (a failure got
    two more tries, a pass none). Rechecked both ways, it counts as passing half the time."""
    assert abs(_counted_as_passing(0.5, rerun=False) - 0.625) < 1e-9
    assert abs(_counted_as_passing(0.5, rerun=True) - 0.5) < 1e-9


# ---------- one checkpoint, scored: install, build, repeats, environment ----------

class FakeScorer:
    """gates.accept for score_checkpoint: each call returns the next result; records what it was asked."""
    def __init__(self, *results):
        self.results, self.calls = list(results), []

    def __call__(self, ws, processed, out, acceptance, build=True, only=None):
        self.calls.append({"build": build, "only": only})
        return self.results.pop(0)


def _checkpoint(**live) -> dict:
    return {"story": 2, "commit": "c0ffee", "processed": [{"id": 1, "status": "DONE"}, {"id": 2, "status": "DONE"}],
            "live": {"passed": 1, "total": 2, "build_exit": 0, **live}}


def test_a_scored_checkpoint_records_its_environment_install_and_both_way_flakiness(tmp_path):
    first = _tests({"a": "passed", "b": "failed"})
    first.update(build_exit=0, environment={"node": "v24.15.0", "workers": 1})
    rerun = _tests({"a": "passed", "b": "passed"})
    accept = FakeScorer(first, rerun, rerun)
    inst = {"ok": True, "command": "npm ci --no-audit --no-fund", "fallback": False}
    acc = rescore.score_checkpoint(tmp_path, _checkpoint(), tmp_path / "out", acceptance=tmp_path,
                                   accept=accept, install=lambda ws: inst, between=lambda: None)
    assert [c["build"] for c in accept.calls] == [True, False, False]
    assert accept.calls[1]["only"] == [("story-01.spec.ts", 2), ("story-01.spec.ts", 1)]   # failing, then sampled
    assert acc["install"] == inst
    assert acc["environment"] == {"node": "v24.15.0", "workers": 1, "install_command": inst["command"]}
    assert (acc["passed"], acc["flaky_failing"], acc["flaky_passing"], acc["passing_sampled"]) == (2, ["story-01.spec.ts: b"], [], 1)
    assert acc["sample_seed"] == "c0ffee"


def test_a_checkpoint_that_did_not_install_is_not_run_at_all(tmp_path):
    accept = FakeScorer()
    acc = rescore.score_checkpoint(tmp_path, _checkpoint(), tmp_path / "out", acceptance=tmp_path, accept=accept,
                                   install=lambda ws: {"ok": False, "command": None, "error": "no package-lock.json"},
                                   between=lambda: None)
    assert accept.calls == [] and acc["harness_fault"].startswith("scoring interrupted:")
    assert acc["environment"]["install_command"] is None and "node" in acc["environment"]


def test_a_build_that_failed_only_here_is_a_fault_and_not_repeated(tmp_path):
    broken = _tests({"a": "failed", "b": "failed"})
    broken.update(build_exit=127, build_tail="sh: vite: command not found", environment={})
    accept = FakeScorer(broken)
    acc = rescore.score_checkpoint(tmp_path, _checkpoint(build_exit=0), tmp_path / "out", acceptance=tmp_path,
                                   accept=accept, install=lambda ws: {"ok": True, "command": "npm ci", "fallback": False},
                                   between=lambda: None)
    assert len(accept.calls) == 1 and "127" in acc["harness_fault"]


def test_a_fault_from_the_suite_itself_is_not_repeated(tmp_path):
    held = {**_tests({}), "build_exit": 0, "harness_fault": "missing resources: scoring port held", "environment": {}}
    accept = FakeScorer(held)
    acc = rescore.score_checkpoint(tmp_path, _checkpoint(), tmp_path / "out", acceptance=tmp_path, accept=accept,
                                   install=lambda ws: {"ok": True, "command": "npm ci", "fallback": False},
                                   between=lambda: None)
    assert len(accept.calls) == 1 and acc["harness_fault"].startswith("missing resources:")


def test_the_result_row_reports_flaky_both_ways_and_the_environment():
    acc = {"passed": 2, "total": 2, "scores": [1, 2, 2], "flaky": ["x: b"], "flaky_failing": ["x: b"],
           "flaky_passing": [], "passing_sampled": 1, "harness_fault": None, "build_exit": 0,
           "environment": {"node": "v24", "install_command": "npm ci"}, "setup_fallbacks": {"tests": 0}}
    row = rescore.result_row(2, acc, seconds=5)
    assert row == {"story": 2, "passed": 2, "total": 2, "fallbacks": 0, "scores": [1, 2, 2], "flaky": 1,
                   "flaky_failing": 1, "flaky_passing": 0, "passing_sampled": 1, "harness_fault": None,
                   "build_exit": 0, "environment": {"node": "v24", "install_command": "npm ci"}, "seconds": 5}
    assert "x: b" not in json.dumps(row)            # rescore.json is public: counts, never a test's name


def test_a_repeat_the_machine_spoiled_makes_the_checkpoint_a_fault(tmp_path):
    """A repeat that could not run can't vote; majority over the rest would lean on the first scoring alone."""
    first = {**_tests({"a": "passed", "b": "failed"}), "build_exit": 0, "environment": {}}
    spoiled = {**_tests({}), "harness_fault": "scoring interrupted: killed by signal 15"}
    accept = FakeScorer(first, spoiled)
    acc = rescore.score_checkpoint(tmp_path, _checkpoint(), tmp_path / "out", acceptance=tmp_path, accept=accept,
                                   install=lambda ws: {"ok": True, "command": "npm ci", "fallback": False},
                                   between=lambda: None)
    assert len(accept.calls) == 2
    assert acc["harness_fault"] == "scoring interrupted: killed by signal 15 (in repeat scoring 2)"
