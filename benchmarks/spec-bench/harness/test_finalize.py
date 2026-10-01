"""finalize.py: at the end of a run, bundle the workspace's history and re-score the final build under the
pack's exact suite version, so every finished run can be scored and judged without anyone doing it by hand."""
import json
import os
import subprocess
import sys
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


def test_where_the_suite_checkout_is_no_longer_decides_whether_a_run_is_scored(tmp_path):
    """Until 1 Oct 2026 a checkout a commit past its tag ("vidi-v2.0-pre2+22a2164") meant "not re-scored". The
    re-score now takes the suite from the tag itself (tagsuite.py), so finalize scores under the version it is
    given, the tag, and has no rule about the checkout; test_tagsuite.py and test_pipeline.py show the suite is
    the tag's."""
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    calls = []
    out = finalize.finalize(run, pack_ref="vidi-v2.0-pre2", version="vidi-v2.0-pre2",
                            rescore=fake_rescore(75, 75, calls), record=None)
    assert len(calls) == 1 and out["rescore"] == "done" and out["version"] == "vidi-v2.0-pre2"
    assert not hasattr(finalize, "decide")                      # the rule that skipped is gone, not bypassed


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


def test_a_story_whose_agent_reached_outside_its_workspace_is_recorded_and_said(tmp_path):
    """The containment scan (logscan.py) runs at finalize, where the full logs are: each story gets its verdict,
    and a reach is named in the record's message. 25 Sep 2026: an agent read the reference build through a clone."""
    import drive
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    (run / "metrics.json").write_text(json.dumps({"stories": {"7": {"title": "t"}, "8": {"title": "u"}}}))
    reach = {"type": "message_end", "message": {"role": "assistant", "content": [{"type": "toolCall", "id": "c1", "name": "bash",
             "arguments": {"command": "cat ~/share/tools/awesome-local-ai/benchmarks/reference/vidi/opus-5.5/v2-r1/workspace/src/a.ts"}}]}}
    own = {"type": "message_end", "message": {"role": "assistant", "content": [{"type": "toolCall", "id": "c2", "name": "bash",
           "arguments": {"command": "ls src"}}]}}
    for sid, ev in (("07", reach), ("08", own)):
        (run / "stories" / sid).mkdir(parents=True)
        (run / "stories" / sid / "agent-events.jsonl").write_text(json.dumps(ev) + "\n")
    messages = []
    out = finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=messages.append)
    assert out["outside_workspace"]["ok"] is False and out["outside_workspace"]["reached"] == ["07"]
    m = drive.load_metrics(run)
    assert m["stories"]["7"]["outside_workspace"]["ok"] is False and m["stories"]["8"]["outside_workspace"]["ok"] is True
    assert m["stories"]["7"]["outside_workspace"]["reaches"][0]["route"] == "reference_build"
    assert "reached outside its workspace" in messages[0] and "story 7" in messages[0]


def test_the_scan_leaves_the_storys_process_containment_record_alone(tmp_path):
    # metrics.json's per-story "containment" is the systemd scope record (memory limit, reaped processes).
    import drive
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    scope = {"enabled": True, "units": 2, "reaped": []}
    (run / "metrics.json").write_text(json.dumps({"stories": {"7": {"title": "t", "containment": scope}}}))
    (run / "stories" / "07").mkdir(parents=True)
    (run / "stories" / "07" / "agent-events.jsonl").write_text(json.dumps({"type": "message_end", "message": {
        "role": "assistant", "content": [{"type": "toolCall", "id": "c", "name": "bash", "arguments": {"command": "ls src"}}]}}) + "\n")
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=None)
    rec = drive.load_metrics(run)["stories"]["7"]
    assert rec["containment"] == scope and rec["outside_workspace"]["ok"] is True


# ---------- every outcome says whether a person is needed ----------

import rescore as rescore_module

BUILD_FAULT = rescore_module.build_fault({"build_exit": 1, "build_tail": "error TS2307: Cannot find module 'vite'"}, 0)
NO_NPM_FAULT = rescore_module.install_fault({"ok": False, "error": "npm is not installed on this machine"})
INSTALL_FAULT = rescore_module.install_fault({"ok": False, "error": "npm error ERESOLVE could not resolve"})
RUNNER_FAULT = "scoring interrupted: the held-out runner failed to start"


def raising(exc):
    def rescore(run, bundle, version):
        raise exc
    return rescore


def status(run: Path) -> dict:
    return json.loads((run / finalize.STATUS).read_text())


OUTCOMES = [
    # what the re-score did,                                              rescore,   reason_kind,                  needs_person
    (lambda: fake_rescore(64, 75, []),                                     "done",    finalize.KIND_SCORED,          False),
    (lambda: raising(finalize.Unscored(finalize.KIND_TOOL_MISSING, "uv is not on PATH")), "failed", finalize.KIND_TOOL_MISSING, False),
    (lambda: raising(finalize.Unscored("suite_tag_missing", "the pack's suite tag vidi-v9 does not exist", needs_person=True)),
     "failed", "suite_tag_missing", True),
    (lambda: raising(finalize.Unscored("suite_install_failed", "`npm ci` for the suite failed")), "failed", "suite_install_failed", False),
    (lambda: raising(RuntimeError("rescore.py exited 1")),                 "failed",  finalize.KIND_RESCORE_FAILED,  False),
    (lambda: raising(ImportError("cannot import name 'x' from 'drive'")),  "failed",  finalize.KIND_RESCORE_FAILED,  False),
    (lambda: fake_rescore(0, 0, [], fault=BUILD_FAULT),                    "failed",  finalize.KIND_BUILD_FAILS_CLEAN, True),
    (lambda: fake_rescore(0, 0, [], fault=NO_NPM_FAULT),                   "failed",  finalize.KIND_TOOL_MISSING,    False),
    (lambda: fake_rescore(0, 0, [], fault=INSTALL_FAULT),                  "failed",  finalize.KIND_INSTALL_FAILED,  False),
    (lambda: fake_rescore(0, 0, [], fault=RUNNER_FAULT),                   "failed",  finalize.KIND_SPOILED,         False),
    (lambda: fake_rescore(0, 75, []),                                      "flagged", finalize.KIND_FLAGGED,         False),
]


@pytest.mark.parametrize("make,state,kind,person", OUTCOMES, ids=[o[2] + "-" + o[1] for o in OUTCOMES])
def test_every_outcome_says_whether_a_person_is_needed(tmp_path, make, state, kind, person):
    run = live_run(tmp_path, 63)
    messages = []
    out = finalize_with(run, make(), messages)
    fin = status(run)
    assert (fin["rescore"], fin["reason_kind"], fin["needs_person"]) == (state, kind, person), fin
    assert fin["attempts"] == 1 and fin["last_attempt_at"] == fin["at"] and fin["max_attempts"] == finalize.MAX_ATTEMPTS
    assert bool(fin["reason"]) is (state != "done")
    assert ("score" in fin) is (state == "done")
    assert out["needs_person"] is person
    assert ("needs a person" in messages[0]) is person
    assert ("will be retried" in messages[0]) is (state != "done" and not person)


def test_a_run_with_no_bundle_and_no_work_dir_left_needs_a_person(tmp_path):
    run = live_run(tmp_path, 63)
    import shutil
    shutil.rmtree(tmp_path / "work")
    calls = []
    finalize_with(run, fake_rescore(74, 75, calls))
    fin = status(run)
    assert calls == [] and fin["rescore"] == "failed" and fin["needs_person"] is True
    assert fin["reason_kind"] == finalize.KIND_NO_BUNDLE and "bundle" not in fin
    assert str(tmp_path) not in fin["reason"]


def test_a_run_whose_work_dir_was_never_recorded_needs_a_person_too(tmp_path):
    run = live_run(tmp_path, 63)
    (run / "work_dir.txt").unlink()
    finalize_with(run, fake_rescore(74, 75, []))
    assert status(run)["reason_kind"] == finalize.KIND_NO_BUNDLE and status(run)["needs_person"] is True


def test_a_run_whose_work_dir_is_gone_is_scored_from_the_bundle_it_already_has(tmp_path):
    run = live_run(tmp_path, 63)
    finalize_with(run, raising(RuntimeError("no browser")))           # bundled, not scored
    import shutil
    shutil.rmtree(tmp_path / "work")
    calls = []
    finalize_with(run, fake_rescore(62, 75, calls))
    assert len(calls) == 1 and status(run)["score"] == "62/75" and status(run)["needs_person"] is False


def test_attempts_are_counted_and_a_retryable_failure_needs_a_person_at_the_cap(tmp_path):
    run = live_run(tmp_path, 63)
    for n in range(1, finalize.MAX_ATTEMPTS + 1):
        messages = []
        finalize_with(run, raising(RuntimeError(f"rescore.py exited {n}")), messages)
        fin = status(run)
        assert fin["attempts"] == n and len(fin["history"]) == n
        assert fin["needs_person"] is (n == finalize.MAX_ATTEMPTS), n
        assert f"attempt {n} of {finalize.MAX_ATTEMPTS}" in messages[0]
    assert [h["reason"] for h in fin["history"]] == [f"rescore.py exited {n}" for n in range(1, finalize.MAX_ATTEMPTS + 1)]
    assert all(h["rescore"] == "failed" and h["reason_kind"] == finalize.KIND_RESCORE_FAILED and h["at"] for h in fin["history"])
    assert fin["reason"] == f"rescore.py exited {finalize.MAX_ATTEMPTS}" and fin["retries_exhausted"] is True


def test_a_success_after_failures_needs_nobody_and_keeps_the_history(tmp_path):
    run = live_run(tmp_path, 63)
    finalize_with(run, raising(finalize.Unscored(finalize.KIND_TOOL_MISSING, "node is not on PATH")))
    finalize_with(run, fake_rescore(0, 75, []))                       # flagged
    finalize_with(run, fake_rescore(62, 75, []))
    fin = status(run)
    assert fin["rescore"] == "done" and fin["needs_person"] is False and fin["attempts"] == 3
    assert [h["reason_kind"] for h in fin["history"]] == [finalize.KIND_TOOL_MISSING, finalize.KIND_FLAGGED, finalize.KIND_SCORED]
    assert fin["retries_exhausted"] is False


def test_a_person_can_still_ask_again_after_the_cap(tmp_path):
    """needs_person stops the sweep, not finalize.py: run by hand it tries again, and a score clears the flag."""
    run = live_run(tmp_path, 63)
    for _ in range(finalize.MAX_ATTEMPTS):
        finalize_with(run, raising(RuntimeError("no browser")))
    assert status(run)["needs_person"] is True
    finalize_with(run, fake_rescore(62, 75, []))
    assert status(run)["needs_person"] is False and status(run)["attempts"] == finalize.MAX_ATTEMPTS + 1


def test_a_rescore_stopped_for_time_is_not_an_attempt(tmp_path):
    """The sweep's time budget ran out (finalize_pending.py): nothing was learnt about the run."""
    run = live_run(tmp_path, 63)
    for _ in range(finalize.MAX_ATTEMPTS + 1):
        finalize_with(run, raising(finalize.Unscored(finalize.KIND_OUT_OF_TIME, "stopped at the time budget", counted=False)))
    fin = status(run)
    assert fin["attempts"] == 0 and fin["needs_person"] is False and fin["history"] == []
    assert fin["rescore"] == "failed" and fin["reason_kind"] == finalize.KIND_OUT_OF_TIME


def test_a_run_already_scored_is_not_another_attempt_and_says_nobody_is_needed(tmp_path):
    run = live_run(tmp_path, 63)
    finalize_with(run, fake_rescore(62, 75, []))
    before = status(run)
    messages = []
    out = finalize_with(run, fake_rescore(62, 75, []), messages)
    assert status(run) == before and messages == []                   # idempotent: nothing rewritten, nothing recorded
    assert out["rescore"] == "done" and out["needs_person"] is False and out["score"] == "62/75"


def test_a_record_from_before_these_fields_is_read_as_no_attempts_yet(tmp_path):
    """The gufo v2-r4 record of 1 Oct 2026, as the older finalize.py wrote it: skipped, the checkout past its tag."""
    run = live_run(tmp_path, 65)
    (run / finalize.STATUS).write_text(json.dumps({
        "version": "vidi-v2.0-pre2+28ace8b", "pack_ref": VERSION, "at": "2026-10-01T08:26:00Z", "bundle": "workspace.bundle",
        "rescore": "skipped", "reason": f"the suite checkout is at vidi-v2.0-pre2+28ace8b, not the pack's {VERSION}"}))
    messages = []
    finalize_with(run, fake_rescore(66, 75, []), messages)
    fin = status(run)
    assert fin["rescore"] == "done" and fin["score"] == "66/75" and fin["version"] == VERSION
    assert fin["attempts"] == 1 and fin["needs_person"] is False
    assert messages == [f"final score 66/75 under {VERSION}"]


def test_a_score_of_an_earlier_checkpoint_is_not_the_runs_score(tmp_path):
    """A run scored after it stopped at story 11, then resumed and finished at story 12: the earlier re-score is
    set aside and the final build is scored."""
    run = live_run(tmp_path, 63)
    stale = run / "rescore" / VERSION
    stale.mkdir(parents=True)
    (stale / "rescore.json").write_text(json.dumps({"pack_version": VERSION, "results": [
        {"story": FINAL_STORY - 1, "passed": 50, "total": 70, "harness_fault": None}]}))
    calls = []
    finalize_with(run, fake_rescore(62, 75, calls))
    assert len(calls) == 1 and status(run)["score"] == "62/75"
    [aside] = list((run / "rescore-spoiled").iterdir())
    assert "story 11" in json.loads((aside / finalize.SET_ASIDE).read_text())["reason"]


def test_a_score_of_the_same_story_at_another_commit_is_not_the_runs_score(tmp_path):
    run = live_run(tmp_path, 63)                                       # its final story's commit is "abc"
    stale = run / "rescore" / VERSION
    stale.mkdir(parents=True)
    (stale / "rescore.json").write_text(json.dumps({"pack_version": VERSION, "results": [
        {"story": FINAL_STORY, "commit": "an-earlier-attempt", "passed": 50, "total": 75, "harness_fault": None}]}))
    calls = []
    finalize_with(run, fake_rescore(62, 75, calls))
    assert len(calls) == 1 and status(run)["score"] == "62/75"


def test_reasons_are_public_and_name_no_home_path(tmp_path):
    run = live_run(tmp_path, 63)
    finalize_with(run, raising(RuntimeError(f"cannot open {Path.home()}/.cache/thing: denied\n  at line 2")))
    reason = status(run)["reason"]
    assert str(Path.home()) not in reason and "~/.cache/thing" in reason and "\n" not in reason
    assert len(reason) <= finalize.REASON_CHARS


def test_the_outside_workspace_scan_failing_does_not_cost_the_run_its_score(tmp_path, monkeypatch):
    import logscan
    monkeypatch.setattr(logscan, "scan_run", lambda run: 1 / 0)
    run = live_run(tmp_path, 63)
    finalize_with(run, fake_rescore(62, 75, []))
    fin = status(run)
    assert fin["score"] == "62/75" and fin["outside_workspace"]["ok"] is None
    assert "ZeroDivisionError" in fin["outside_workspace"]["error"]


def test_finalize_py_never_fails_its_caller_and_a_harness_that_cannot_load_is_retried(tmp_path, monkeypatch):
    """The harness code in the checkout was momentarily broken (an import error) while a run ended: the run got no
    finalize.json at all, so nothing knew to try again."""
    run = live_run(tmp_path, 63)

    def broken(*a, **k):
        raise ImportError("cannot import name 'story_time_split' from 'drive'")
    monkeypatch.setattr(finalize, "finalize_run", broken)
    assert finalize.main([str(run), "--pack", "benchmarks/vidi"]) == 0
    fin = status(run)
    assert fin["rescore"] == "failed" and fin["reason_kind"] == finalize.KIND_HARNESS_FAILED
    assert fin["needs_person"] is False and fin["attempts"] == 1 and "story_time_split" in fin["reason"]
    monkeypatch.setattr(finalize, "finalize_run", lambda *a, **k: sys.exit("no such pack"))    # SystemExit too
    assert finalize.main([str(run), "--pack", "benchmarks/vidi"]) == 0
    assert status(run)["attempts"] == 2


# ---------- the re-score finds its own tools ----------

def test_the_harness_rescore_names_a_tool_it_cannot_find_and_starts_nothing(tmp_path, monkeypatch):
    import scoring_tools
    monkeypatch.setenv(scoring_tools.HOME_ENV, str(tmp_path / "scoring-home"))
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    monkeypatch.setattr(scoring_tools, "TOOLS", ("no-such-uv", "no-such-node"))
    started = []
    monkeypatch.setattr(subprocess, "Popen", lambda *a, **k: started.append(a))
    with pytest.raises(finalize.Unscored) as e:
        finalize.rescore_with_harness("benchmarks/vidi")(tmp_path, tmp_path / "b", VERSION)
    assert e.value.kind == finalize.KIND_TOOL_MISSING and not e.value.needs_person and e.value.counted
    assert "no-such-uv" in str(e.value) and "no-such-node" in str(e.value) and started == []


def test_the_harness_rescore_runs_with_the_tools_run_sh_had(tmp_path, monkeypatch):
    """A caller with a bare PATH (a shell without the login profile) still gets uv by its full path, and node on
    the re-score's PATH."""
    import scoring_tools
    import tagsuite
    monkeypatch.setenv(scoring_tools.HOME_ENV, str(tmp_path / "scoring-home"))
    bin_ = tmp_path / "bin"
    bin_.mkdir()
    for t in scoring_tools.TOOLS:
        (bin_ / t).write_text("#!/bin/sh\nexit 0\n")
        (bin_ / t).chmod(0o755)
    scoring_tools.remember({"PATH": f"{bin_}:/usr/bin:/bin"})
    monkeypatch.setenv("PATH", "/usr/bin:/bin")
    monkeypatch.setattr(tagsuite, "for_pack", lambda pk, env=None: tagsuite.Suite(None, VERSION, None, False))
    monkeypatch.setattr(finalize, "load_pack", lambda pack: object())
    seen = {}

    def bounded(cmd, cwd, env, timeout_s):
        seen.update(cmd=cmd, path=env["PATH"], timeout=timeout_s)
        return 3
    monkeypatch.setattr(finalize, "run_bounded", bounded)
    with pytest.raises(RuntimeError, match="rescore.py exited 3"):
        finalize.rescore_with_harness("benchmarks/vidi", timeout_s=7)(tmp_path, tmp_path / "b", VERSION)
    assert seen["cmd"][0] == str(bin_ / "uv") and "--final" in seen["cmd"]
    assert seen["path"].split(":")[0] == str(bin_) and seen["timeout"] == 7


def test_a_suite_that_cannot_be_had_is_the_reason_and_says_whether_a_person_is_needed(tmp_path, monkeypatch):
    import scoring_tools
    import tagsuite
    monkeypatch.setattr(scoring_tools, "missing", lambda env: [])
    monkeypatch.setattr(finalize, "load_pack", lambda pack: object())

    def no_tag(pk, env=None):
        raise tagsuite.SuiteError(tagsuite.TAG_MISSING, "the pack's suite tag vidi-v9 does not exist in the private repo", True)
    monkeypatch.setattr(tagsuite, "for_pack", no_tag)
    with pytest.raises(finalize.Unscored) as e:
        finalize.rescore_with_harness("benchmarks/vidi")(tmp_path, tmp_path / "b", VERSION)
    assert e.value.kind == tagsuite.TAG_MISSING and e.value.needs_person and "vidi-v9" in str(e.value)


def test_a_rescore_that_overruns_its_time_is_stopped_gently_and_is_not_an_attempt(tmp_path, monkeypatch):
    """SIGTERM first, so rescore.py's own clean-up (its app servers, its browsers) runs; the child here records
    that it was asked."""
    marker = tmp_path / "asked-to-stop"
    child = ("import signal, sys, time, pathlib\n"
             f"signal.signal(signal.SIGTERM, lambda *a: (pathlib.Path({str(marker)!r}).write_text('x'), sys.exit(143)))\n"
             "print('up', flush=True)\ntime.sleep(60)\n")
    monkeypatch.setattr(finalize, "TERM_GRACE_S", 10)
    with pytest.raises(finalize.Unscored) as e:
        finalize.run_bounded([sys.executable, "-c", child], tmp_path, dict(os.environ), timeout_s=1.5)
    assert e.value.kind == finalize.KIND_OUT_OF_TIME and not e.value.counted and not e.value.needs_person
    assert marker.exists()
    assert finalize.run_bounded([sys.executable, "-c", "raise SystemExit(4)"], tmp_path, dict(os.environ), None) == 4


# ---------- finalize repairs its own run's records ----------

def accounted(version: int | None = None, ok: bool = True, conversation: bool = True, split: bool = True) -> dict:
    import accounting
    rec = {"title": "t", "started": 1.0, "agent_finished": 2.0}
    if split:
        rec["time_split"] = {"model": {"source": "x"}, "other_s": 0,
                             "accounting": {"version": accounting.VERSION if version is None else version, "ok": ok, "problems": []}}
    if conversation:
        rec["conversation"] = {"calls": 1}
    return rec


def run_with_stories(tmp_path: Path, stories: dict, logs: tuple[str, ...] = ()) -> Path:
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    (run / "metrics.json").write_text(json.dumps({"stories": stories}))
    for sid in logs:
        (run / "stories" / sid.zfill(2)).mkdir(parents=True)
        (run / "stories" / sid.zfill(2) / "agent-events.jsonl").write_text("{}\n")
    return run


def fake_backfill(monkeypatch, fix: dict, calls: list):
    """Stands in for backfill_timing.backfill_all: gives the named stories the records in `fix`."""
    import backfill_timing
    import heldout

    def backfill_all(run, recompute=False):
        calls.append((run, recompute))
        m = heldout.load_metrics(run)
        for sid, rec in fix.items():
            m["stories"][sid] = rec
        heldout.save_metrics(run, m)
        return {"timing": sorted(fix)}
    monkeypatch.setattr(backfill_timing, "backfill_all", backfill_all)


STALE = [("an older accounting version", dict(version=0)), ("a failed check", dict(ok=False)),
         ("no time split", dict(split=False)), ("no conversation profile", dict(conversation=False))]


@pytest.mark.parametrize("what,kw", STALE, ids=[w for w, _ in STALE])
def test_a_stale_record_is_recomputed_from_the_full_log_before_the_run_is_recorded(tmp_path, monkeypatch, what, kw):
    import accounting
    import heldout
    run = run_with_stories(tmp_path, {"3": accounted(**kw), "4": accounted()}, logs=("3", "4"))
    calls, events = [], []
    fake_backfill(monkeypatch, {"3": accounted()}, calls)
    real = heldout.load_metrics

    def record(message):
        events.append(("recorded", finalize.needing_repair(real(run))))
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=record)
    assert calls == [(run, True)]                                       # recompute: stale ones are redone
    assert events == [("recorded", {})]                                 # repaired before the record was made
    rep = status(run)["repair"]
    assert rep["repaired"] == ["3"] and rep["left"] == {} and rep["accounting_version"] == accounting.VERSION
    assert "error" not in rep and rep["at"]


def test_records_that_are_current_are_left_alone(tmp_path, monkeypatch):
    run = run_with_stories(tmp_path, {"3": accounted(), "4": accounted()}, logs=("3", "4"))
    calls = []
    fake_backfill(monkeypatch, {}, calls)
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=None)
    rep = status(run)["repair"]
    assert calls == [] and rep["repaired"] == [] and rep["left"] == {} and "at" not in rep


def test_a_stale_record_without_its_full_log_is_left_with_a_note(tmp_path, monkeypatch):
    run = run_with_stories(tmp_path, {"3": accounted(ok=False), "4": accounted(version=0)}, logs=("4",))
    calls = []
    fake_backfill(monkeypatch, {"4": accounted()}, calls)
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=None)
    rep = status(run)["repair"]
    assert rep["repaired"] == ["4"] and list(rep["left"]) == ["3"]
    assert "check failed" in rep["left"]["3"] and "no full log on this machine" in rep["left"]["3"]


def test_with_no_full_logs_at_all_nothing_is_recomputed(tmp_path, monkeypatch):
    run = run_with_stories(tmp_path, {"3": accounted(version=0)})
    calls = []
    fake_backfill(monkeypatch, {}, calls)
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=None)
    assert calls == [] and "no full log" in status(run)["repair"]["left"]["3"]


def test_a_record_the_recomputation_does_not_fix_is_left_with_a_note(tmp_path, monkeypatch):
    run = run_with_stories(tmp_path, {"3": accounted(ok=False)}, logs=("3",))
    fake_backfill(monkeypatch, {}, [])
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=None)
    rep = status(run)["repair"]
    assert rep["repaired"] == [] and "recomputed from the full log, still" in rep["left"]["3"]


def test_a_repair_that_crashes_is_recorded_and_the_run_is_still_scored(tmp_path, monkeypatch):
    import backfill_timing
    run = run_with_stories(tmp_path, {"3": accounted(version=0)}, logs=("3",))
    monkeypatch.setattr(backfill_timing, "backfill_all", lambda run, recompute=False: 1 / 0)
    messages = []
    out = finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=messages.append)
    assert out["score"] == "75/75" and messages == [f"final score 75/75 under {VERSION}"]
    rep = status(run)["repair"]
    assert "ZeroDivisionError" in rep["error"] and status(run)["needs_person"] is False
    assert rep["repaired"] == [] and "the repair failed" in rep["left"]["3"]     # marked as tried by this harness


def test_a_scored_run_whose_records_went_stale_is_repaired_and_recorded_without_another_rescore(tmp_path, monkeypatch):
    """The accounting changed after the run was scored (a new VERSION): the next finalize brings the records up
    to date and records that, and does not score again."""
    run = run_with_stories(tmp_path, {"3": accounted()}, logs=("3",))
    calls, backfills, messages = [], [], []
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, calls), record=None)
    import heldout
    m = heldout.load_metrics(run)
    m["stories"]["3"] = accounted(version=0)
    heldout.save_metrics(run, m)
    fake_backfill(monkeypatch, {"3": accounted()}, backfills)
    out = finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, calls), record=messages.append)
    assert len(calls) == 1 and len(backfills) == 1
    assert messages == ["records repaired: story 3"]
    fin = status(run)
    assert fin["repair"]["repaired"] == ["3"] and fin["score"] == "75/75" and fin["attempts"] == 1
    assert out["rescore"] == "done"


def test_a_scored_run_is_scored_whether_or_not_its_bundle_and_work_dir_are_still_there(tmp_path):
    run = live_run(tmp_path, 63)
    finalize_with(run, fake_rescore(62, 75, []))
    import shutil
    shutil.rmtree(tmp_path / "work")
    (run / finalize.BUNDLE).unlink()
    out = finalize_with(run, fake_rescore(62, 75, []))
    assert out["rescore"] == "done" and status(run)["score"] == "62/75" and status(run)["needs_person"] is False


def test_every_field_of_finalize_json_is_in_the_telemetry_doc(tmp_path, monkeypatch):
    """TELEMETRY.md is what the dashboard is written against: a field finalize writes and the doc doesn't name
    fails here. Taken from real outputs: a score, a flagged re-score, a failure, a repair with something left."""
    doc = (Path(finalize.__file__).resolve().parent.parent / "TELEMETRY.md").read_text()
    written: set[str] = set()

    def keys(d: dict) -> None:
        for k, v in d.items():
            written.add(k)
            for item in (v if isinstance(v, list) else [v]):
                if isinstance(item, dict) and k != "left":
                    keys(item)
    for n, rescore in enumerate((fake_rescore(62, 75, []), fake_rescore(0, 75, []), raising(RuntimeError("x")))):
        (tmp_path / str(n)).mkdir()
        run = live_run(tmp_path / str(n), 63)
        finalize_with(run, rescore)
        keys(status(run))
    (tmp_path / "r").mkdir()
    run = run_with_stories(tmp_path / "r", {"3": accounted(ok=False), "4": accounted(version=0)}, logs=("4",))
    fake_backfill(monkeypatch, {"4": accounted()}, [])
    finalize.finalize(run, VERSION, VERSION, rescore=fake_rescore(75, 75, []), record=None)
    keys(status(run))
    keys(finalize.note_failure(live_run(tmp_path, 63), "the harness did not load"))
    assert {"needs_person", "reason_kind", "attempts", "last_attempt_at", "history", "repair", "repaired"} <= written
    assert sorted(k for k in written if f"`{k}`" not in doc) == []
    kinds = {v for k, v in vars(finalize).items() if k.startswith("KIND_")}
    import tagsuite
    kinds |= {tagsuite.TAG_MISSING, tagsuite.NO_SUITE_AT_TAG, tagsuite.NOT_A_CHECKOUT, tagsuite.FETCH_FAILED,
              tagsuite.ARCHIVE_FAILED, tagsuite.INSTALL_FAILED, tagsuite.TOOL_MISSING}
    assert sorted(k for k in kinds if f"`{k}`" not in doc) == []


def test_a_rescore_in_progress_is_stopped_when_this_process_is_told_to_end(tmp_path):
    """The re-score runs in a process group of its own, so SIGTERM to finalize.py's group doesn't reach it: finalize
    stops it on its way out, gently (rescore.py's own clean-up runs), and is not taken for a failed re-score."""
    import signal
    marker = tmp_path / "asked-to-stop"
    child = ("import signal, sys, time, pathlib\n"
             f"signal.signal(signal.SIGTERM, lambda *a: (pathlib.Path({str(marker)!r}).write_text('x'), sys.exit(143)))\n"
             "time.sleep(60)\n")
    before = finalize.stop_on_sigterm()
    try:
        signal.signal(signal.SIGALRM, lambda *a: os.kill(os.getpid(), signal.SIGTERM))
        signal.setitimer(signal.ITIMER_REAL, 1.5)
        run = live_run(tmp_path, 63)
        with pytest.raises(finalize.Stopped):
            finalize_with(run, lambda r, b, v: finalize.run_bounded([sys.executable, "-c", child], tmp_path, dict(os.environ), None))
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        signal.signal(signal.SIGTERM, before)
    assert marker.exists() and not (run / finalize.STATUS).exists()
