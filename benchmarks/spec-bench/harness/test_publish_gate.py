"""Held-out detail in a run's records: the public form a run's files are kept in (heldout.make_public, run by
drive.prepare_records), and the resolver that finds the detail. The rules are publicise.py's.

Until story 23 this file was the publishing gate, which checked every commit the harness made; since story 23
(harness.no_publish) the harness commits and pushes nothing, so what is left is:
  B. each held-out result has its public summary beside it: story, re-score story, final, run-level, base
  C. metrics.json is split into its public counts and its held-out detail; the machine's tools still get the detail
  E. the resolver finds the detail in the run, or in the private repo's copy older runs had made
  F. every writer of results goes through the same path: rescore, gates, backfill
  H. records written before the split are put in their public form
Every title and machine name here is made up: a real one in this public repo would itself be a leak.
Run: uv run --with pytest pytest test_publish_gate.py
"""
from __future__ import annotations

import gzip
import json
import subprocess
from pathlib import Path


import drive
import heldout
import publicise as pub
import report

G = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
TITLE = "a made-up held-out title for the gate"
OTHER = "another invented held-out check of the gate"
ANCHOR = "@ref prd:made-up.gate-anchor"
OWN_TITLE = "creates a note on a double click, invented"
RUN_REL = "combinations/some/stack/benchmarks/vidi/r1"
VERSION = "vidi-v9"
MESSAGE = "vidi some/stack r1: story 2 done"
ERROR = "Error: expect(locator).toHaveText(expected) failed\nLocator: getByRole('note')\nExpected: \"x\""


# ---------- fixtures: a private suite, a public repo, a whole run ----------

def git(cwd: Path, *args: str) -> str:
    return subprocess.run([*G, *args], cwd=cwd, capture_output=True, text=True, check=True).stdout


def write(p: Path, content: str | bytes | dict) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, dict):
        content = json.dumps(content, indent=2)
    (p.write_bytes if isinstance(content, bytes) else p.write_text)(content)
    return p


def t(title: str, status: str, story: int = 1, error: str = "") -> dict:
    return {"file": f"story-{story:02d}.spec.ts", "line": 9, "title": f"{title} {ANCHOR}" if title in (TITLE, OTHER) else title,
            "status": status, "error": error}


def result(tests: list[dict], **extra) -> dict:
    """A held-out result as gates.accept returns it: counts, runner output, and every test."""
    by: dict[str, dict] = {}
    for x in tests:
        s = by.setdefault(x["file"][6:8], {"passed": 0, "total": 0})
        s["total"] += 1
        s["passed"] += x["status"] == "passed"
    return {"skipped": False, "build_exit": 0, "runner_exit": 1, "runner_tail": f"  1) {TITLE} {ANCHOR}\n{ERROR}",
            "passed": sum(x["status"] == "passed" for x in tests), "total": len(tests),
            "on_partial": {"passed": 1, "total": 2}, "by_story": by, "harness_fault": None,
            "setup_fallbacks": {"tests": 0, "by_owner": {}}, "tests": tests, **extra}


STORY_1 = result([t(TITLE, "passed"), t(OTHER, "failed", error=ERROR)])
STORY_2 = result([t(TITLE, "failed", error=ERROR), t(OTHER, "passed"), t(OWN_TITLE, "passed", story=2)])
RESCORED = result([t(TITLE, "failed", error=ERROR), t(OTHER, "passed"), t(OWN_TITLE, "passed", story=2)],
                  scores=[2, 2, 3], flaky=[f"story-01.spec.ts: {TITLE}"])


def story_record(n: int, acc: dict, commit: str, **extra) -> dict:
    """metrics.json's record of a story, as drive.main keeps it: the result without its tests."""
    return {"title": f"Story {n}", "commit": commit, "finished": 1, "status": "DONE",
            "agent": {"seconds": 600, "stalled": False, "steps": 3, "tokens": {"output": 10}},
            "requests": {"requests": 3}, "conditions": {},
            "gate": {"all_green": True, "steps": {"e2e": {"tail": f"ok  {OWN_TITLE}; ok {TITLE}"}}},
            "accept": {k: v for k, v in acc.items() if k != "tests"}, **extra}


def full_metrics() -> dict:
    return {"pack": "vidi", "processed": [{"id": 1, "status": "PARTIAL"}, {"id": 2, "status": "DONE"}], "stories": {
        "1": story_record(1, STORY_1, "aaaa", status="PARTIAL", skip={"by": "op", "reason": "cap"},
                          verdict={"verdict": "green", "gate_green": True, "heldout": {"passed": 1, "total": 2}}),
        "2": story_record(2, STORY_2, "bbbb", partial_base=[1], stub_markers=[],
                          partial_heldout_changes={"1": {"fixed": [f"{OTHER} {ANCHOR}"], "regressed": [f"{TITLE} {ANCHOR}"]}}),
    }}


# Each held-out result, and its public summary beside it.
SUMMARIES = {"stories/01/accept.json": "stories/01/accept-summary.json",
             "stories/02/accept.json": "stories/02/accept-summary.json",
             f"rescore/{VERSION}/stories/02/accept.json": f"rescore/{VERSION}/stories/02/accept-summary.json",
             "accept-final.json": "accept-final-summary.json",
             "base/accept.json": "base/accept-summary.json",
             "superseded/story-03-early-stop/accept.json": "superseded/story-03-early-stop/accept-summary.json"}


def small_run(repo: Path) -> Path:
    run = repo / RUN_REL
    write(run / "run.json", {"combination": "some/stack"})
    drive.save_metrics(run, {"stories": {"1": story_record(1, STORY_1, "aaaa")}})
    return run


# ---------- A. private files are never staged ----------


# ---------- B. each held-out result has its public summary beside it ----------


def test_B3_write_accept_puts_the_summary_beside_each_kind_of_result(tmp_path):
    for name, summary in pub.SUMMARY_NAMES.items():
        heldout.write_accept(tmp_path / name, RESCORED)
        assert json.loads((tmp_path / summary).read_text()) == pub.summarise_accept(RESCORED)
        assert json.loads((tmp_path / summary).read_text())["flaky"] == 1
    heldout.write_accept(tmp_path / "other.json", RESCORED)          # not a held-out result's name: no summary
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([*pub.SUMMARY_NAMES, *pub.SUMMARY_NAMES.values(), "other.json"])


def test_B4_write_summaries_finds_every_result_once_and_leaves_the_workspace_alone(tmp_path):
    run = tmp_path / "run"
    for full in SUMMARIES:
        write(run / full, STORY_1)
    write(run / "workspace/accept.json", {"passed": 1})
    write(run / "stories/01/half-written/accept.json", "{not json")
    assert sorted(heldout.write_summaries(run)) == sorted(SUMMARIES.values())
    assert heldout.write_summaries(run) == []                           # unchanged: nothing rewritten
    assert not (run / "workspace/accept-summary.json").exists()


# ---------- C. metrics and reports as committed: counts only; the machine keeps the detail ----------


def test_C5_the_partial_notes_read_the_same_from_titles_or_counts():
    full = full_metrics()
    public, _ = pub.split_metrics(full)
    assert report.partial_notes(full) == report.partial_notes(public)


def test_C6_saving_what_was_loaded_changes_nothing(tmp_path):
    drive.save_metrics(tmp_path, full_metrics())
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    drive.save_metrics(tmp_path, drive.load_metrics(tmp_path))
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before


def test_C7_an_old_full_metrics_json_is_split_when_a_resumed_run_next_saves(tmp_path):
    (tmp_path / "metrics.json").write_text(json.dumps(full_metrics()))      # written by the harness before the gate
    m = drive.load_metrics(tmp_path)
    assert m == full_metrics()
    drive.save_metrics(tmp_path, m)
    assert "runner_tail" not in (tmp_path / "metrics.json").read_text()
    assert pub.leaks_in_file(f"{RUN_REL}/metrics.json", (tmp_path / "metrics.json").read_text(), {TITLE}) == []
    assert TITLE in (tmp_path / pub.HELDOUT_DETAIL).read_text()


def test_C8_a_run_without_held_out_detail_leaves_no_sidecar(tmp_path):
    write(tmp_path / pub.HELDOUT_DETAIL, {"stories": {"1": {"accept": {"runner_tail": "stale"}}}})
    drive.save_metrics(tmp_path, {"stories": {"1": {"title": "no held-out suite", "accept": {"passed": 0, "total": 0}}}})
    assert not (tmp_path / pub.HELDOUT_DETAIL).exists()


# ---------- D. the leak check: refuses held-out detail, allows the agent's own work ----------


# ---------- E. the private copy, and finding the detail here or there ----------


def _here_and_private(tmp_path: Path) -> tuple[Path, Path]:
    """A run in a checkout, and a private repo whose copy of it holds detail the run doesn't."""
    repo = tmp_path / "public"
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    run = repo / RUN_REL
    run.mkdir(parents=True)
    private = tmp_path / "private"
    return run, private


def test_E5_find_takes_the_machines_copy_then_the_private_repos_then_none(tmp_path):
    run, private = _here_and_private(tmp_path)
    copy = write(private / "runs" / RUN_REL / "stories/01/accept.json", STORY_2)
    assert heldout.find(run, "stories/01/accept.json", private) == copy
    local = write(run / "stories/01/accept.json", STORY_1)
    assert heldout.find(run, "stories/01/accept.json", private) == local
    assert heldout.find(run, "stories/09/accept.json", private) is None
    assert heldout.find(tmp_path / "not-in-a-checkout", "accept.json", private) is None


def test_E6_counts_come_from_the_summary_where_the_detail_is_nowhere(tmp_path):
    run, private = _here_and_private(tmp_path)
    write(run / "stories/01/accept-summary.json", pub.summarise_accept(STORY_1))
    assert heldout.accept_or_summary(run, "stories/01/accept.json", private) == pub.summarise_accept(STORY_1)
    write(private / "runs" / RUN_REL / "stories/01/accept.json", STORY_1)
    assert heldout.accept_or_summary(run, "stories/01/accept.json", private) == STORY_1
    assert heldout.accept_or_summary(run, "gate.json", private) is None


def test_E8_judge_prep_and_annotate_take_the_results_from_the_private_copy(tmp_path, monkeypatch):
    import annotate
    import judge_prep
    run, private = _here_and_private(tmp_path)
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(private))
    ws = run / "workspace"
    ws.mkdir()
    git(ws, "init", "-q")
    git(ws, "commit", "-q", "--allow-empty", "-m", "base")
    write(run / "stories/01/gate.json", {"all_green": True})
    write(run / "stories/01" / annotate.EVENTS, gzip.compress(json.dumps({"type": "session"}).encode() + b"\n"))
    write(private / "runs" / RUN_REL / "stories/01/accept.json", STORY_1)
    write(private / "runs" / RUN_REL / "stories/01/screenshots/a.png", b"\x89PNG")
    judge_prep.copy_run(run, tmp_path / "bundle")
    assert json.loads((tmp_path / "bundle/stories/01/accept.json").read_text()) == STORY_1
    assert (tmp_path / "bundle/stories/01/screenshots/a.png").exists()
    attempt = annotate.build_attempt(RUN_REL, run, run / "stories/01", {"stories": {"1": {"title": "S"}}}, "")
    assert [f["title"] for f in attempt["behaviour"]["failed"]] == [f"{OTHER} {ANCHOR}"]


# ---------- F. every writer of results goes through the same path ----------

def test_F1_a_rescore_writes_each_result_with_its_summary(tmp_path, monkeypatch):
    import gates
    import rescore
    base = tmp_path / "base"
    base.mkdir()
    git(base, "init", "-q")
    git(base, "commit", "-q", "--allow-empty", "-m", "story 2")
    commit = git(base, "rev-parse", "HEAD").strip()
    monkeypatch.setenv("ACCEPT_PORT", "0")                    # _score_one sets it; restored after the test
    monkeypatch.setattr(drive, "set_pack", lambda pack: None)
    monkeypatch.setattr(drive, "kill_strays", lambda ws: None)
    # The empty checkpoint has no package.json, which rescore.install now faults (item 6d); this test is about
    # where each result and its summary are written, so the install is taken as done.
    monkeypatch.setattr(rescore, "install", lambda ws: {"ok": True, "command": "npm ci", "fallback": False})
    scorings = iter([STORY_2, result([t(TITLE, "passed"), t(OTHER, "passed"), t(OWN_TITLE, "passed", story=2)]), STORY_2])
    monkeypatch.setattr(gates, "accept", lambda *a, **k: json.loads(json.dumps(next(scorings))))
    out = tmp_path / "rescore" / VERSION
    rescore._score_one({"story": 2, "commit": commit, "processed": [{"id": 1, "status": "DONE"}, {"id": 2, "status": "DONE"}]},
                       str(base), str(tmp_path), str(out), 0, "benchmarks/vidi")
    full = json.loads((out / "stories/02/accept.json").read_text())
    assert full["flaky"] == [f"story-01.spec.ts: {TITLE} {ANCHOR}"]
    assert json.loads((out / "stories/02/accept-summary.json").read_text()) == pub.summarise_accept(full)


def test_F2_gates_accept_from_the_command_line_writes_the_summary(tmp_path, monkeypatch):
    import sys
    import gates
    monkeypatch.setattr(gates, "accept", lambda *a, **k: STORY_1)
    monkeypatch.setattr(sys, "argv", ["gates.py", "accept", str(tmp_path), "--done", "1", "--out", str(tmp_path / "out")])
    gates.main()
    assert json.loads((tmp_path / "out/accept.json").read_text()) == STORY_1
    assert json.loads((tmp_path / "out/accept-summary.json").read_text()) == pub.summarise_accept(STORY_1)


def test_F4_backfill_keeps_metrics_public_and_the_detail_beside_it(tmp_path, monkeypatch):
    import backfill_timing
    import conversation
    (tmp_path / "metrics.json").write_text(json.dumps({"stories": {
        "1": {**story_record(1, STORY_1, "aaaa"), "started": 1, "agent_finished": 2}}}))   # a pre-gate record
    write(tmp_path / "stories/01/agent-events.jsonl", "{}\n")
    monkeypatch.setattr(conversation, "profile", lambda *a: {"calls": 1})
    assert backfill_timing.backfill_conversation(tmp_path) == ["1"]
    assert "runner_tail" not in (tmp_path / "metrics.json").read_text()
    assert pub.leaks_in_file(f"{RUN_REL}/metrics.json", (tmp_path / "metrics.json").read_text(), {TITLE}) == []
    assert heldout.load_metrics(tmp_path)["stories"]["1"]["accept"]["runner_tail"] == STORY_1["runner_tail"]
    assert heldout.load_metrics(tmp_path)["stories"]["1"]["conversation"] == {"calls": 1}


# ---------- G. end to end ----------


# ---------- H. records written before the gate are made public before they are staged ----------

def test_H1_a_full_metrics_copy_anywhere_in_the_run_is_split_and_its_detail_wins(tmp_path):
    """reference run-2 had one: rescore/vidi-v1.3.2/metrics.json, copied whole by rescore.py before the split."""
    rs = tmp_path / "rescore" / VERSION
    write(rs / "metrics.json", full_metrics())
    write(rs / pub.HELDOUT_DETAIL, {"stories": {"1": {"accept": {"runner_tail": "older"}}, "7": {"accept": {"x": 1}}}})
    changed = heldout.make_public(tmp_path)
    assert changed["metrics"] == [f"rescore/{VERSION}/metrics.json"]
    assert "runner_tail" not in (rs / "metrics.json").read_text()
    kept = json.loads((rs / pub.HELDOUT_DETAIL).read_text())["stories"]
    assert kept["1"]["accept"]["runner_tail"] == STORY_1["runner_tail"] and kept["7"] == {"accept": {"x": 1}}
    assert heldout.make_public(tmp_path)["metrics"] == []                 # idempotent


def test_H2_a_summary_with_titles_is_redacted_and_its_full_form_kept(tmp_path):
    text = f"- story 1: 2/2 → 1/2; broke 1: “{TITLE}”. Most common error: `{ERROR.splitlines()[0]}`\n"
    write(tmp_path / "summary.md", text)
    assert heldout.make_public(tmp_path)["reports"] == ["summary.md"]
    assert (tmp_path / "summary.md").read_text() == "- story 1: 2/2 → 1/2; broke 1.\n"
    assert (tmp_path / pub.SUMMARY_DETAIL).read_text() == text
    assert heldout.make_public(tmp_path)["reports"] == []


# ---------- I. the owner's machine names: never in a harness-written file, nor in the commit message ----------
# The names come from the local dbench node list and the machine's hostname, read at run time (machine_names.py);
# conftest points the node list at a missing file and the hostname at a made-up one, so a test names its own.


# ---------- the checks that fail closed, called directly ----------


def test_metrics_are_saved_and_loaded_through_the_held_out_split(tmp_path):
    """drive's save_metrics and load_metrics go through heldout's split (moved from test_drive_record.py, which tested
    the recording path story 23 removed)."""
    metrics = {"stories": {"1": story_record(1, STORY_1, "aaaa")}}
    drive.save_metrics(tmp_path, metrics)
    assert drive.load_metrics(tmp_path) == heldout.load_metrics(tmp_path)
    assert drive.load_metrics(tmp_path)["stories"]["1"]["commit"] == "aaaa"
