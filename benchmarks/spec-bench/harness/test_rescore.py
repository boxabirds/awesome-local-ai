"""rescore.py: a finished run's held-out scores recomputed under another pack version, from each
story's recorded code, without touching the run's own scores."""
import json
from pathlib import Path

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


def test_a_single_clean_scoring_needs_no_repeats():
    from rescore import needs_repeats
    assert not needs_repeats({"tests": [{"status": "passed"}, {"status": "skipped"}]})
    assert needs_repeats({"tests": [{"status": "passed"}, {"status": "failed"}]})


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
