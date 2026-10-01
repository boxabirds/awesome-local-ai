"""A fault in the harness's own bookkeeping never loses a story.

After the agent finishes, a story needs its gate, its held-out scoring, its commit and its record. Everything
else the harness does with it is derived: the check of the agent's last reply, totals over attempts, provenance,
task evidence, server statistics, the time split, the conversation profile, lines of code, the workspace mirror,
the task table, the progress file, the summary, the compacted log, and (for a story the operator ended) the
verdict and what it says about later stories. On 30 Sep and 1 Oct 2026 a bug in two of those (the time
accounting, the reply check) crashed the harness after hours of the agent's work, before the story was saved.

Each derived step is made to raise here, one at a time and all at once, through drive.py's real story loop
(test_pipeline's scripted agent and fake suite). The story must still be recorded with its known scores, the fault
named in its record (harness_faults) and in the run's interventions, and the run must carry on.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

import conversation
import drive
import heldout
import progress
import report
import test_pipeline as tp

pytestmark = tp.pytestmark


class Boom(RuntimeError):
    pass


def boom(*a, **k):
    raise Boom("injected fault")


# step name (as recorded) -> (module, attribute) that is made to raise
ALWAYS = {
    "reply check": (drive, "final_reply_text"),
    "provenance": (drive, "story_provenance"),
    "task evidence": (progress, "evidence"),
    "server statistics": (drive, "server_stats"),
    "time split": (drive, "story_time_split"),
    "conversation profile": (conversation, "profile"),
    "lines of code": (drive, "loc"),
    "workspace mirror": (drive, "mirror"),
    "task table": (progress, "task_table"),
    "progress file": (progress, "write_progress"),
}
RECORDING = {            # only with --record
    "summary": (report, "write_summary"),
    "compacted log": (drive, "compact_events"),
    "record": (drive, "record_story"),
}
ENDED_BY_OPERATOR = {    # only for a story the operator ended, and the stories after it
    "verdict": (progress, "base_health"),
    "stub markers": (progress, "stub_markers"),
    "held-out changes": (progress, "heldout_changes"),
}
SKIP = {"story": 1, "reason": "testing", "by": "test", "at": 1.0}


class SkipsStoryOne:
    """The skip watcher, with the operator ending story 1 the moment its agent finishes."""
    def __init__(self, run, sid, ws, **k):
        self.sid = sid

    def start(self):
        pass

    def cap(self, reason):
        pass

    def stop(self):
        return dict(SKIP) if self.sid == 1 else None


def run_with(tmp_path: Path, mp: pytest.MonkeyPatch, broken: dict, record=False, skip_one=False, only="1") -> Path:
    root = tmp_path / "kat"
    with mp.context() as m:
        recorded = []
        if record:
            m.setattr(drive, "record_story", lambda repo, run, message, **k: recorded.append(message) or
                      {"committed": True, "pushed": True, "commit": "abc1234"})
        if skip_one:
            m.setattr(drive, "SkipWatcher", SkipsStoryOne)
        for module, name in broken.values():
            m.setattr(module, name, boom)
        args = (("--only", only) if only else ()) + (("--record",) if record else ())
        tp.drive_run(root, m, extra_args=args)
    return root / "run"


def faults(run: Path, sid: str) -> list[str]:
    return [f["step"] for f in heldout.load_metrics(run)["stories"][sid].get("harness_faults", [])]


def assert_recorded(run: Path, sid: str = "1") -> dict:
    rec = heldout.load_metrics(run)["stories"][sid]
    assert {k: rec["accept"][k] for k in ("passed", "total")} == tp.EXPECTED_LIVE[sid]
    assert rec["commit"] and rec["gate"] and rec["agent"]["steps"] == 1
    return rec


def test_an_ordinary_story_records_no_faults(tmp_path, monkeypatch):
    run = run_with(tmp_path, monkeypatch, {})
    assert "harness_faults" not in assert_recorded(run)
    assert not (run / "interventions.md").exists()


@pytest.mark.parametrize("step", sorted(ALWAYS))
def test_a_fault_in_one_derived_step_still_records_the_story(tmp_path, monkeypatch, step):
    run = run_with(tmp_path, monkeypatch, {step: ALWAYS[step]})
    rec = assert_recorded(run)
    assert step in faults(run, "1"), rec.get("harness_faults")
    fault = next(f for f in rec["harness_faults"] if f["step"] == step)
    assert "Boom: injected fault" in fault["error"]
    assert f"harness fault in {step}" in (run / "interventions.md").read_text()


@pytest.mark.parametrize("step", sorted(RECORDING))
def test_a_fault_while_publishing_still_keeps_the_story_on_the_machine(tmp_path, monkeypatch, step):
    run = run_with(tmp_path, monkeypatch, {step: RECORDING[step]}, record=True)
    assert_recorded(run)
    assert step in faults(run, "1")


@pytest.mark.parametrize("step", sorted(ENDED_BY_OPERATOR))
def test_a_fault_judging_a_story_the_operator_ended_still_records_it_and_the_next(tmp_path, monkeypatch, step):
    run = run_with(tmp_path, monkeypatch, {step: ENDED_BY_OPERATOR[step]}, skip_one=True, only="")
    m = heldout.load_metrics(run)["stories"]
    assert m["1"]["status"] == drive.PARTIAL and m["2"]["status"] == drive.DONE
    assert step in faults(run, "1") + faults(run, "2")


def test_every_derived_step_failing_at_once_still_records_both_stories_and_the_run_can_be_reported(tmp_path, monkeypatch):
    run = run_with(tmp_path, monkeypatch, {**ALWAYS, **RECORDING}, record=True, only="")
    for sid in ("1", "2"):
        assert_recorded(sid=sid, run=run)
        assert set(faults(run, sid)) >= set(ALWAYS) | set(RECORDING)
    report.write_summary(run)                                  # the faulted record is still readable
    assert "story" in (run / "summary.md").read_text().lower()
    json.dumps(heldout.load_metrics(run))


def test_a_guard_stopping_the_run_is_not_swallowed(tmp_path, monkeypatch):
    """Only bookkeeping faults are isolated: SystemExit (the guards, missing resources) still stops the run."""
    def unfit(*a, **k):
        raise SystemExit(75)
    with monkeypatch.context() as m, pytest.raises(SystemExit) as e:
        m.setattr(drive, "loc", unfit)
        tp.drive_run(tmp_path / "kat", m, extra_args=("--only", "1"))
    assert e.value.code == 75
