"""finalize.py: at the end of a run, bundle the workspace's history and re-score the final build under the
pack's exact suite version, so every finished run can be scored and judged without anyone doing it by hand."""
import json
import subprocess
from pathlib import Path

import pytest

import finalize

IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t"]


def workspace_with_history(tmp_path: Path) -> Path:
    """A run's work dir as drive.py leaves it: <work>/workspace, a git repo with one commit per story."""
    work = tmp_path / "work"
    ws = work / "workspace"
    ws.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(ws)], check=True)
    for n in (1, 2):
        (ws / f"f{n}.txt").write_text(str(n))
        subprocess.run(["git", *IDENTITY, "-C", str(ws), "add", "."], check=True)
        subprocess.run(["git", *IDENTITY, "-C", str(ws), "commit", "-q", "-m", f"story {n}"], check=True)
    return work


def run_dir(tmp_path: Path, work: Path) -> Path:
    run = tmp_path / "run"
    run.mkdir()
    (run / "work_dir.txt").write_text(str(work) + "\n")
    return run


FINAL_STORY = 12
# Stories of the fake suite, and how many held-out tests each has: 75 in all, like vidi v2's canvas scope.
SUITE = {1: 10, 2: 10, 3: 7, 4: 4, 5: 5, 7: 8, 8: 7, 9: 6, 10: 8, 11: 5, 12: 5}
REFUSED = "page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:18800/"
VERSION = "vidi-v2.0-pre2"


def held_out_tests(passed: int, errors=None) -> list[dict]:
    """The suite's 75 tests (fake titles), the first `passed` passing; each failure gets errors(i) as its error,
    by default a different assertion each, as a real app's failures have."""
    errors = errors or (lambda i: f"Error: expect(locator).toHaveText(expected) #{'abcdefghijklmnopqrstuvwxyz'[i % 26]}{i // 26}")
    tests, i = [], 0
    for story, n in SUITE.items():
        for k in range(n):
            ok = i < passed
            tests.append({"file": f"story-{story:02d}.spec.ts", "title": f"fake check {story}.{k}", "line": k + 1,
                          "status": "passed" if ok else "failed", "error": "" if ok else errors(i)})
            i += 1
    return tests


def fake_rescore(passed: int, total: int, calls: list, fault: str | None = None, errors=None, detail: bool = True):
    """Stands in for rescore.py --final: writes what it would (rescore.json, and the final checkpoint's
    accept.json), without a browser."""
    def rescore(run: Path, bundle: Path, version: str) -> None:
        calls.append((run, bundle, version))
        out = run / "rescore" / version
        out.mkdir(parents=True)
        (out / "rescore.json").write_text(json.dumps({"pack_version": version, "results": [
            {"story": FINAL_STORY, "passed": passed, "total": total, "harness_fault": fault}]}))
        if detail:
            tests = held_out_tests(passed, errors)[:total]
            sdir = out / "stories" / f"{FINAL_STORY:02d}"
            sdir.mkdir(parents=True)
            (sdir / "accept.json").write_text(json.dumps({"passed": passed, "total": total, "tests": tests,
                                                          "harness_fault": fault}))
    return rescore


def test_decide_rescores_only_under_the_exact_pack_ref():
    assert finalize.decide("vidi-v2.0-pre2", "vidi-v2.0-pre2", already=False) == ("rescore", "")
    action, why = finalize.decide("vidi-v2.0-pre2+22a2164", "vidi-v2.0-pre2", already=False)
    assert action == "skip" and "vidi-v2.0-pre2+22a2164" in why and "vidi-v2.0-pre2" in why
    assert finalize.decide("vidi-v2.0-pre2", "vidi-v2.0-pre2", already=True)[0] == "skip"
    assert finalize.decide("vidi-v1", "", already=False) == ("rescore", "")  # a pack without a pinned private suite


def test_a_finished_run_gets_its_bundle_and_final_score_and_says_so(tmp_path):
    work = workspace_with_history(tmp_path)
    run = run_dir(tmp_path, work)
    calls, messages = [], []
    out = finalize.finalize(run, pack_ref="vidi-v2.0-pre2", version="vidi-v2.0-pre2",
                            rescore=fake_rescore(74, 75, calls), record=messages.append)
    heads = subprocess.run(["git", "bundle", "list-heads", str(run / "workspace.bundle")], capture_output=True, text=True).stdout
    head = subprocess.run(["git", "-C", str(work / "workspace"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    assert head in heads                                        # the bundle ends at the final story's commit
    assert calls == [(run, run / "workspace.bundle", "vidi-v2.0-pre2")]
    assert out["score"] == "74/75" and out["rescore"] == "done"
    assert json.loads((run / "finalize.json").read_text())["score"] == "74/75"
    assert messages == ["final score 74/75 under vidi-v2.0-pre2"]


def test_a_suite_checkout_off_its_tag_is_not_scored_and_the_record_says_why(tmp_path):
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    calls, messages = [], []
    out = finalize.finalize(run, pack_ref="vidi-v2.0-pre2", version="vidi-v2.0-pre2+22a2164",
                            rescore=fake_rescore(75, 75, calls), record=messages.append)
    assert calls == []
    assert (run / "workspace.bundle").is_file()                 # still judgeable once scored by hand
    assert out["rescore"] == "skipped"
    assert "not re-scored" in messages[0] and "vidi-v2.0-pre2+22a2164" in messages[0]


def test_a_run_already_finalized_is_left_alone(tmp_path):
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    calls = []
    finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=fake_rescore(75, 75, calls), record=None)
    finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=fake_rescore(75, 75, calls), record=None)
    assert len(calls) == 1


def test_a_failed_rescore_is_reported_not_raised(tmp_path):
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    messages = []

    def broken(run, bundle, version):
        raise RuntimeError("no browser")
    out = finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=broken, record=messages.append)
    assert out["rescore"] == "failed" and "no browser" in out["reason"]
    assert (run / "workspace.bundle").is_file()
    assert "re-score failed" in messages[0]


def test_a_rescore_the_machine_spoiled_is_not_a_score_and_does_not_block_a_retry(tmp_path):
    """30 Sep 2026: Swift v2-r2's re-score ran under a Node too old for Playwright; the runner crashed before
    any test, and the record said "final score 0/0"."""
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    calls, messages = [], []
    out = finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2",
                            rescore=fake_rescore(0, 0, calls, fault="scoring interrupted: the held-out runner failed to start"),
                            record=messages.append)
    assert out["rescore"] == "failed" and "score" not in out and "runner failed to start" in out["reason"]
    assert messages and "0/0" not in messages[0] and "failed" in messages[0]
    assert not (run / "rescore" / "vidi-v2.0-pre2").exists()          # set aside, so the page never shows it
    assert [p.name.startswith("vidi-v2.0-pre2-") for p in (run / "rescore-spoiled").iterdir()] == [True]
    finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=fake_rescore(61, 75, calls), record=None)
    assert len(calls) == 2                                             # and the next finalize tries again



# ---------- the live-vs-record guard (item 6a) ----------

def live_run(tmp_path: Path, passed: int | None, total: int = 75, version: str | None = VERSION,
             story_version: str | None = None, errors=None, detail: bool = True) -> Path:
    """A finished run whose final story (12) scored passed/total where the agent worked, under `version`."""
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    rec = {"commit": "abc", "accept": None if passed is None else {"passed": passed, "total": total, "build_exit": 0}}
    if story_version:
        rec["pack_version"] = story_version
    (run / "metrics.json").write_text(json.dumps({"stories": {str(FINAL_STORY): rec},
                                                  "processed": [{"id": FINAL_STORY, "status": "DONE"}]}))
    if version:
        (run / "run.json").write_text(json.dumps({"pack_version": version}))
    if passed is not None and detail:
        sdir = run / "stories" / f"{FINAL_STORY:02d}"
        sdir.mkdir(parents=True)
        (sdir / "accept.json").write_text(json.dumps({"passed": passed, "total": total,
                                                      "tests": held_out_tests(passed, errors)[:total]}))
    return run


def finalize_with(run: Path, rescore, messages: list | None = None) -> dict:
    return finalize.finalize(run, VERSION, VERSION, rescore=rescore, record=(messages.append if messages is not None else None))


def assert_not_recorded(run: Path, out: dict, messages: list, *reason_parts: str) -> None:
    assert out["rescore"] == "flagged" and "score" not in out
    for part in reason_parts:
        assert part in out["reason"], (part, out["reason"])
    assert not (run / "rescore" / VERSION).exists()                  # the page never shows it
    [spoiled] = list((run / "rescore-spoiled").iterdir())
    assert json.loads((spoiled / finalize.SET_ASIDE).read_text())["reason"] == out["reason"]
    assert (spoiled / "rescore.json").is_file()                      # kept for whoever looks into it
    assert messages and "flagged" in messages[0] and "not recorded" in messages[0]


def test_replay_the_refused_install_0_of_75_against_a_live_63_is_flagged_not_recorded(tmp_path):
    """30 Sep 2026, Swift 1.5 v2-r2: `npm ci` refused the lockfile, the build found no vite, and every held-out
    test got "connection refused". Replayed as the old scorer recorded it, with no harness fault set."""
    run = live_run(tmp_path, 63)
    messages = []
    out = finalize_with(run, fake_rescore(0, 75, [], errors=lambda i: REFUSED.replace("18800", str(18800 + 2 * (i % 4)))),
                        messages)
    assert_not_recorded(run, out, messages, "63", "0/75", "63/75")
    assert out["guard"]["difference"] == -63 and out["guard"]["one_signature"] is True
    assert "live 63/75" in messages[0] and not messages[0].startswith("final score")


def test_replay_the_crashed_runner_0_of_0_is_flagged_even_without_a_harness_fault(tmp_path):
    """30 Sep 2026: under a Node too old for Playwright the runner crashed before any test; the record said
    "final score 0/0". Since then gates.interrupted() catches it; the guard catches it again if that ever misses."""
    run = live_run(tmp_path, 63)
    messages = []
    out = finalize_with(run, fake_rescore(0, 0, []), messages)
    assert_not_recorded(run, out, messages, "0 tests", "75")


def test_a_small_difference_from_the_live_score_is_recorded(tmp_path):
    """gufo v2-r1: 68/75 in the record against a live 67 (one test, the scorer's OS: methods review C3)."""
    run = live_run(tmp_path, 67)
    messages = []
    out = finalize_with(run, fake_rescore(68, 75, []), messages)
    assert out["rescore"] == "done" and out["score"] == "68/75"
    assert out["guard"]["difference"] == 1 and out["guard"]["flagged"] is None and out["guard"]["comparable"] is True
    assert messages == [f"final score 68/75 under {VERSION}"]
    assert json.loads((run / "finalize.json").read_text())["guard"]["live"] == "67/75"


@pytest.mark.parametrize("live,record,flagged", [
    (60, 60 + finalize.DIVERGENCE_TESTS, False),          # at the threshold: recorded
    (60, 60 + finalize.DIVERGENCE_TESTS + 1, True),       # one past it: flagged
    (60, 60 - finalize.DIVERGENCE_TESTS, False),
    (60, 60 - finalize.DIVERGENCE_TESTS - 1, True),       # a drop counts the same as a rise
])
def test_the_threshold_is_the_number_of_tests_either_way(tmp_path, live, record, flagged):
    out = finalize_with(live_run(tmp_path, live), fake_rescore(record, 75, []))
    assert (out["rescore"] == "flagged") is flagged
    assert out["guard"]["threshold"] == finalize.DIVERGENCE_TESTS


def test_a_rescore_that_ran_a_different_number_of_tests_than_live_is_flagged(tmp_path):
    out = finalize_with(live_run(tmp_path, 63), fake_rescore(62, 70, []))
    assert out["rescore"] == "flagged" and "70 tests" in out["reason"] and "75" in out["reason"]


def test_an_app_that_never_starts_live_or_in_the_record_keeps_its_0(tmp_path):
    """A shared signature is the app's own when the live scoring of the same code failed the same way: flagging
    it would drop the run's worst result from every mean (the survivorship the review warned of)."""
    refused = lambda i: REFUSED
    run = live_run(tmp_path, 0, errors=refused)
    out = finalize_with(run, fake_rescore(0, 75, [], errors=refused))
    assert out["rescore"] == "done" and out["score"] == "0/75"
    assert out["guard"]["one_signature"] is True and out["guard"]["live_same_signature"] is True


def test_one_signature_across_stories_is_flagged_when_live_cannot_vouch_for_it(tmp_path):
    """Live scored under another suite version: the counts can't be compared, but 20 failures in several stories
    with one cause still say the machine, not the app."""
    run = live_run(tmp_path, 75, version="vidi-v2.0-pre1+94b980f-dirty")
    out = finalize_with(run, fake_rescore(55, 75, [], errors=lambda i: REFUSED))
    assert out["rescore"] == "flagged" and "share one error signature" in out["reason"]
    assert out["guard"]["comparable"] is False


def test_one_signature_confined_to_one_story_is_the_apps(tmp_path):
    """A story whose feature is missing fails all its tests the same way: that is a finding, not a fault."""
    run = live_run(tmp_path, 70)
    out = finalize_with(run, fake_rescore(70, 75, [], errors=lambda i: "Error: expect(locator).toBeVisible() failed"))
    assert out["rescore"] == "done" and out["guard"]["one_signature"] is False


def test_a_few_failures_sharing_a_signature_is_no_signal(tmp_path):
    few = finalize.MIN_SIGNATURE_FAILURES - 1
    run = live_run(tmp_path, 75 - few, version="other-version")
    out = finalize_with(run, fake_rescore(75 - few, 75, [], errors=lambda i: "TimeoutError: waiting 5000ms"))
    assert out["rescore"] == "done"


def test_a_live_score_under_another_suite_version_is_not_compared(tmp_path):
    """Opus v2-r1: live-scored under a dirty pre1 (0/75, the "Create a board" bug), 75/75 under pre2. Comparing
    the two would flag a correct record."""
    run = live_run(tmp_path, 0, version="vidi-v2.0-pre1+94b980f-dirty")
    out = finalize_with(run, fake_rescore(75, 75, []))
    assert out["rescore"] == "done" and out["score"] == "75/75"
    assert out["guard"]["comparable"] is False and out["guard"]["live_version"] == "vidi-v2.0-pre1+94b980f-dirty"


def test_the_storys_own_suite_version_wins_over_the_runs(tmp_path):
    """run.json is rewritten at each restart; a version recorded with the story says what that story ran under."""
    run = live_run(tmp_path, 0, version=VERSION, story_version="vidi-v2.0-pre1")
    out = finalize_with(run, fake_rescore(75, 75, []))
    assert out["rescore"] == "done" and out["guard"]["live_version"] == "vidi-v2.0-pre1"


def test_a_run_whose_suite_version_is_unknown_is_compared(tmp_path):
    """Nothing says the versions differ, so the counts are compared: the guard errs towards flagging."""
    out = finalize_with(live_run(tmp_path, 63, version=None), fake_rescore(0, 75, []))
    assert out["rescore"] == "flagged" and out["guard"]["comparable"] is True


def test_a_run_with_no_live_score_is_recorded_on_the_rescore_alone(tmp_path):
    out = finalize_with(live_run(tmp_path, None), fake_rescore(70, 75, []))
    assert out["rescore"] == "done" and out["guard"]["live"] is None and out["guard"]["difference"] is None


def test_a_rescore_without_its_test_detail_is_flagged(tmp_path):
    """Fail closed: without the tests, a shared cause can't be ruled out."""
    out = finalize_with(live_run(tmp_path, 70), fake_rescore(70, 75, [], detail=False))
    assert out["rescore"] == "flagged" and "no test detail" in out["reason"]


def test_a_flagged_rescore_is_tried_again_by_the_next_finalize(tmp_path):
    run = live_run(tmp_path, 63)
    calls = []
    finalize_with(run, fake_rescore(0, 75, calls))
    out = finalize_with(run, fake_rescore(62, 75, calls))
    assert len(calls) == 2 and out["rescore"] == "done" and out["score"] == "62/75"


def test_the_guards_record_is_public_counts_only(tmp_path):
    """finalize.json and the set-aside note are committed: no test title or error text may be in them."""
    run = live_run(tmp_path, 63)
    out = finalize_with(run, fake_rescore(0, 75, [], errors=lambda i: REFUSED))
    text = (run / "finalize.json").read_text() + next((run / "rescore-spoiled").iterdir()).joinpath(finalize.SET_ASIDE).read_text()
    assert "fake check" not in text and "ERR_CONNECTION_REFUSED" not in text
    assert out["guard"]["failures"] == 75


def _failing(stories_and_counts: dict, error: str = REFUSED) -> list[dict]:
    return [{"file": f"story-{st:02d}.spec.ts", "title": f"fake check {st}.{k}", "status": "failed", "error": error}
            for st, n in stories_and_counts.items() for k in range(n)]


def test_a_shared_cause_needs_enough_failures_in_more_than_one_story():
    enough = finalize.MIN_SIGNATURE_FAILURES
    assert finalize.shared_cause(_failing({3: enough - 2, 7: 1})) is None                  # too few
    assert finalize.shared_cause(_failing({3: enough})) is None                           # one story
    assert finalize.shared_cause(_failing({3: enough - 1, 7: 1})) is not None             # enough, two stories
    mixed = _failing({3: enough - 1}) + _failing({7: 1}, "Error: expect(locator).toBeVisible() failed")
    assert finalize.shared_cause(mixed) is None                                           # two causes
    passing = [{"file": "story-01.spec.ts", "title": "fake ok", "status": "passed", "error": ""}]
    assert finalize.shared_cause(passing + _failing({3: enough - 1, 7: 1})) is not None   # passes don't count
