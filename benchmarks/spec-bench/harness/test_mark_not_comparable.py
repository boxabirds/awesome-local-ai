"""mark_not_comparable.py: a story run that can't be compared story by story says so in its record.

Why: gufo v2-r1 story 10 (1 Oct 2026 analysis). Nudged on after it was finished, the agent built stories 11 and 12
inside story 10, so the three story runs are not the same work as other runs' stories 10, 11 and 12.
"""
import json

import pytest

import mark_not_comparable as mnc


def run_with(tmp_path, stories=("9", "10", "11")):
    run = tmp_path / "run"
    run.mkdir()
    (run / "metrics.json").write_text(json.dumps({"stories": {s: {"status": "DONE", "accept": {"passed": 5, "total": 6}} for s in stories}}))
    return run


def stories_of(run):
    return json.loads((run / "metrics.json").read_text())["stories"]


def test_the_named_stories_get_their_reason_and_the_others_are_untouched(tmp_path):
    run = run_with(tmp_path)
    assert mnc.mark(run, {10: "also built stories 11 and 12", 11: "built during story 10"}) == ["10", "11"]
    got = stories_of(run)
    assert got["10"][mnc.FIELD] == "also built stories 11 and 12" and got["11"][mnc.FIELD] == "built during story 10"
    assert mnc.FIELD not in got["9"]
    assert got["10"]["status"] == "DONE" and got["10"]["accept"] == {"passed": 5, "total": 6}   # the result stands


def test_it_is_written_once_in_the_runs_interventions(tmp_path):
    run = run_with(tmp_path)
    mnc.mark(run, {10: "also built stories 11 and 12"})
    text = (run / "interventions.md").read_text()
    assert "story 10: not compared story by story with other runs: also built stories 11 and 12" in text
    assert mnc.mark(run, {10: "also built stories 11 and 12"}) == []       # a second pass changes nothing
    assert (run / "interventions.md").read_text() == text


def test_a_changed_reason_replaces_the_old_one(tmp_path):
    run = run_with(tmp_path)
    mnc.mark(run, {10: "first"})
    assert mnc.mark(run, {10: "second"}) == ["10"]
    assert stories_of(run)["10"][mnc.FIELD] == "second"


def test_a_story_the_run_never_recorded_is_refused_and_nothing_is_written(tmp_path):
    run = run_with(tmp_path)
    before = (run / "metrics.json").read_text()
    with pytest.raises(SystemExit, match="story 12"):
        mnc.mark(run, {10: "x", 12: "y"})
    assert (run / "metrics.json").read_text() == before and not (run / "interventions.md").exists()


def test_an_empty_reason_is_refused(tmp_path):
    with pytest.raises(SystemExit, match="reason"):
        mnc.mark(run_with(tmp_path), {10: "  "})


def test_the_command_line_takes_story_equals_reason(tmp_path):
    run = run_with(tmp_path)
    assert mnc.main([str(run), "10=also built stories 11 and 12", "11=built during story 10"]) == 0
    assert stories_of(run)["11"][mnc.FIELD] == "built during story 10"
