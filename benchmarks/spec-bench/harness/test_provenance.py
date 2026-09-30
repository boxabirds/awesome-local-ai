"""provenance.py: which harness commit and suite version each story ran under, live and backfilled; run.json's
earlier states kept (run.sh appends each to run-history.jsonl before writing the new one).

Dimensions: live values (harness commit and dirtiness, pack version from pack-version.sh); the run's states from
run-history.jsonl + run.json; a story assigned the state it was scored under (and the one it started under when a
restart fell inside it); backfill (fills, marks its source, never overwrites a live record); run.sh keeps states."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import provenance

HARNESS = Path(__file__).resolve().parent


def _git(cwd: Path, *a: str) -> str:
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *a], cwd=cwd, check=True,
                          capture_output=True, text=True).stdout.strip()


def _repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    (repo / provenance.HARNESS_REL).mkdir(parents=True)
    (repo / provenance.HARNESS_REL / "drive.py").write_text("v1")
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", "harness v1")
    return repo


# ---------- live ----------

def test_the_harness_commit_is_the_checkout_s_head(tmp_path):
    repo = _repo(tmp_path)
    got = provenance.at_start(repo)
    assert got == {"harness_commit": _git(repo, "rev-parse", "--short", "HEAD"), "harness_dirty": False}


def test_uncommitted_harness_edits_are_recorded_as_dirty(tmp_path):
    repo = _repo(tmp_path)
    (repo / provenance.HARNESS_REL / "drive.py").write_text("edited")
    assert provenance.at_start(repo)["harness_dirty"] is True


def test_edits_outside_the_harness_are_not_dirt(tmp_path):
    """A run's own records change the checkout all the time; they are not the harness."""
    repo = _repo(tmp_path)
    (repo / "combinations").mkdir()
    (repo / "combinations" / "metrics.json").write_text("{}")
    assert provenance.at_start(repo)["harness_dirty"] is False


def test_the_pack_version_is_the_pack_s_own_tag(tmp_path):
    pack = tmp_path / "packs" / "demo"
    pack.mkdir(parents=True)
    (pack / "spec.md").write_text("s")
    _git(tmp_path / "packs", "init", "-q", "-b", "main")
    _git(tmp_path / "packs", "add", "-A")
    _git(tmp_path / "packs", "commit", "-qm", "pack")
    _git(tmp_path / "packs", "tag", "demo-v1.0")
    assert provenance.pack_version(pack, "demo") == "demo-v1.0"
    (pack / "spec.md").write_text("changed")
    assert provenance.pack_version(pack, "demo").endswith("-dirty")


def test_a_pack_outside_git_is_unversioned(tmp_path):
    assert provenance.pack_version(tmp_path, "demo") == "unversioned"


# ---------- the run's states ----------

def _state(at: str, commit: str, version: str) -> dict:
    return {"started_at": at, "harness_commit": commit, "pack_version": version, "client": "pi"}


def _run(tmp_path: Path, history: list[dict], current: dict) -> Path:
    run = tmp_path / "run"
    run.mkdir()
    (run / "run-history.jsonl").write_text("".join(json.dumps(h) + "\n" for h in history))
    (run / "run.json").write_text(json.dumps(current, indent=1))
    return run


def _t(stamp: str) -> float:
    return provenance.epoch(stamp)


def test_the_run_s_states_are_history_then_run_json_in_time_order(tmp_path):
    run = _run(tmp_path, [_state("2026-09-29T19:34:20Z", "aaa1111", "demo-v2-pre1")],
               _state("2026-09-30T07:18:32Z", "bbb2222", "demo-v2-pre2"))
    states = provenance.run_states(run)
    assert [s["pack_version"] for s in states] == ["demo-v2-pre1", "demo-v2-pre2"]
    assert states[0]["at"] == _t("2026-09-29T19:34:20Z")


def test_a_story_is_given_the_state_it_was_scored_under(tmp_path):
    run = _run(tmp_path, [_state("2026-09-29T19:34:20Z", "aaa1111", "demo-v2-pre1")],
               _state("2026-09-30T07:18:32Z", "bbb2222", "demo-v2-pre2"))
    states = provenance.run_states(run)
    before = {"started": _t("2026-09-29T20:00:00Z"), "agent_finished": _t("2026-09-29T21:00:00Z")}
    after = {"started": _t("2026-09-30T08:00:00Z"), "agent_finished": _t("2026-09-30T09:00:00Z")}
    assert provenance.for_story(states, before) == {"harness_commit": "aaa1111", "pack_version": "demo-v2-pre1",
                                                    "run_started_at": "2026-09-29T19:34:20Z", "source": provenance.BACKFILL}
    assert provenance.for_story(states, after)["pack_version"] == "demo-v2-pre2"


def test_a_story_restarted_under_a_new_state_names_the_one_it_started_under(tmp_path):
    run = _run(tmp_path, [_state("2026-09-29T19:34:20Z", "aaa1111", "demo-v2-pre1")],
               _state("2026-09-30T07:18:32Z", "bbb2222", "demo-v2-pre2"))
    rec = {"started": _t("2026-09-30T07:19:00Z"), "first_started": _t("2026-09-30T06:00:00Z"),
           "agent_finished": _t("2026-09-30T08:00:00Z")}
    got = provenance.for_story(provenance.run_states(run), rec)
    assert got["pack_version"] == "demo-v2-pre2"
    assert got["started_under"] == {"harness_commit": "aaa1111", "pack_version": "demo-v2-pre1"}


def test_a_story_before_every_recorded_state_gets_none(tmp_path):
    run = _run(tmp_path, [], _state("2026-09-30T07:18:32Z", "bbb2222", "demo-v2-pre2"))
    assert provenance.for_story(provenance.run_states(run), {"started": 1.0, "agent_finished": 2.0}) is None


def test_a_run_without_run_json_has_no_states(tmp_path):
    assert provenance.run_states(tmp_path) == []


# ---------- backfill ----------

def test_backfill_fills_each_story_from_the_run_s_states(tmp_path):
    import heldout
    run = _run(tmp_path, [_state("2026-09-29T19:34:20Z", "aaa1111", "demo-v2-pre1")],
               _state("2026-09-30T07:18:32Z", "bbb2222", "demo-v2-pre2"))
    live = {"harness_commit": "ccc3333", "pack_version": "demo-v2-pre3", "source": provenance.LIVE}
    heldout.save_metrics(run, {"stories": {
        "1": {"started": _t("2026-09-29T20:00:00Z"), "agent_finished": _t("2026-09-29T21:00:00Z")},
        "2": {"started": _t("2026-09-30T08:00:00Z"), "agent_finished": _t("2026-09-30T09:00:00Z")},
        "3": {"started": _t("2026-09-30T10:00:00Z"), "agent_finished": _t("2026-09-30T11:00:00Z"), "provenance": live}}})
    assert provenance.backfill(run) == ["1", "2"]
    stories = heldout.load_metrics(run)["stories"]
    assert stories["1"]["provenance"]["pack_version"] == "demo-v2-pre1"
    assert stories["2"]["provenance"]["pack_version"] == "demo-v2-pre2"
    assert stories["3"]["provenance"] == live                      # a live record is never overwritten
    assert provenance.backfill(run) == []                          # idempotent


# ---------- run.json's earlier states are kept ----------

def test_run_sh_keeps_the_previous_run_json_in_run_history_before_writing_a_new_one(tmp_path):
    """run.sh writes run.json at every start; the line before it appends the previous one to run-history.jsonl."""
    line = next(l for l in (HARNESS / "run.sh").read_text().splitlines() if "run-history.jsonl" in l and "run.json" in l)
    run = tmp_path / "run"
    run.mkdir()
    for n, state in enumerate([_state("2026-09-29T19:34:20Z", "aaa1111", "p1"), _state("2026-09-30T07:18:32Z", "bbb2222", "p2")]):
        subprocess.run(["bash", "-c", line], env={"RUN_DIR": str(run), "PATH": "/usr/bin:/bin"})
        (run / "run.json").write_text(json.dumps(state, indent=1))
    subprocess.run(["bash", "-c", line], env={"RUN_DIR": str(run), "PATH": "/usr/bin:/bin"})
    kept = [json.loads(l)["harness_commit"] for l in (run / "run-history.jsonl").read_text().splitlines()]
    assert kept == ["aaa1111", "bbb2222"]
    assert re.search(r'tr -d .\\n.', line)                         # one state per line, whatever run.json's layout


def test_a_live_story_records_where_it_was_scored(tmp_path):
    """drive.story_provenance: the harness at the process's start, the pack at scoring; and the pack at the story's
    start when it moved while the story ran."""
    import drive
    harness = {"harness_commit": "abc1234", "harness_dirty": False}
    same = drive.story_provenance(harness, started_under="demo-v1", scored_under="demo-v1")
    assert same == {"harness_commit": "abc1234", "harness_dirty": False, "pack_version": "demo-v1", "source": provenance.LIVE}
    moved = drive.story_provenance(harness, started_under="demo-v1", scored_under="demo-v2")
    assert moved["pack_version"] == "demo-v2" and moved["started_under"] == {"pack_version": "demo-v1"}
