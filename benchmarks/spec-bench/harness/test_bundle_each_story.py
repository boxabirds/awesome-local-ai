"""The run's code is bundled when a story completes and when the run is stopped, so it never lives only in the node's
work folder (docs/design/dbench-scopes/api.md, item 4). Before this, workspace.bundle was made only when a run was
finalised, and the mirror was the in-between copy.
Run: uv run --with pytest pytest test_bundle_each_story.py
"""
from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

import drive
import record_event
import test_pipeline as tp
import test_record_event as tre

BUNDLE = "workspace.bundle"
RECORD_RESULT = {"committed": True, "pushed": True, "commit": "abc1234"}
STOP_REASONS = ["stopped", "failed", "finished", "started"]


def head_of_bundle(bundle: Path) -> str:
    out = subprocess.run(["git", "bundle", "list-heads", str(bundle)], capture_output=True, text=True, check=True)
    return next(line.split()[0] for line in out.stdout.splitlines() if line.endswith(" HEAD"))


def workspace_of(run: Path) -> Path:
    return Path((run / "work_dir.txt").read_text().strip()) / "workspace"


def head_of(ws: Path) -> str:
    return subprocess.run(["git", "-C", str(ws), "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()


def run_recording_bundles(tmp_path: Path, mp: pytest.MonkeyPatch, only: str | None) -> tuple[Path, list[dict]]:
    """Both stories through drive's main loop; at each record, what was on disk beside the run's records."""
    seen: list[dict] = []

    def record(repo, run, message, **k):
        bundle = run / BUNDLE
        seen.append({"message": message, "has_bundle": bundle.is_file(),
                     "bundle_head": head_of_bundle(bundle) if bundle.is_file() else None,
                     "workspace_head": head_of(workspace_of(run))})
        return dict(RECORD_RESULT)

    mp.setattr(drive, "record_story", record)
    args = ("--record",) + (("--only", only) if only else ())
    run = tp.drive_run(tmp_path / "kat", mp, extra_args=args)
    return run, seen


def test_a_story_that_completes_is_bundled_before_it_is_recorded(tmp_path, monkeypatch):
    run, seen = run_recording_bundles(tmp_path, monkeypatch, only="1")
    assert len(seen) == 1
    assert seen[0]["has_bundle"], "story 1 was recorded with no workspace.bundle beside it"
    assert seen[0]["bundle_head"] == seen[0]["workspace_head"]


def test_each_story_refreshes_the_bundle_to_the_code_it_left(tmp_path, monkeypatch):
    run, seen = run_recording_bundles(tmp_path, monkeypatch, only=None)
    assert len(seen) == 2
    assert all(s["has_bundle"] for s in seen)
    assert [s["bundle_head"] for s in seen] == [s["workspace_head"] for s in seen]
    assert seen[0]["bundle_head"] != seen[1]["bundle_head"], "story 2's bundle is still story 1's"


def test_the_bundle_clones_to_the_code_the_story_left(tmp_path, monkeypatch):
    run, _ = run_recording_bundles(tmp_path, monkeypatch, only="1")
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(run / BUNDLE), str(clone)], check=True, capture_output=True)
    assert head_of(clone) == head_of(workspace_of(run))


def stopped_run(tmp_path: Path) -> tuple[Path, Path, Path, Path]:
    """A run in a pushable checkout whose work folder holds the agent's repository, as a run killed mid-story leaves it."""
    repo, remote = tre.repo_with_remote(tmp_path)
    run = repo / "combos" / "x" / "benchmarks" / "vidi" / "r1"
    run.mkdir(parents=True)
    work = tmp_path / "work" / "r1"
    ws = work / "workspace"
    ws.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(ws)], check=True)
    (ws / "a.txt").write_text("code the agent had written\n")
    env = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
    subprocess.run(["git", "-C", str(ws), "add", "a.txt"], check=True, env={**os.environ, **env})
    subprocess.run(["git", "-C", str(ws), "commit", "-qm", "story 1: board"], check=True, env={**os.environ, **env})
    (run / "work_dir.txt").write_text(str(work) + "\n")
    return repo, remote, run, ws


def pushed_files(remote: Path) -> set[str]:
    out = subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "main"],
                         capture_output=True, text=True, check=True).stdout.split()
    return {p.rsplit("/", 1)[-1] for p in out}


@pytest.mark.parametrize("state", STOP_REASONS)
def test_a_run_event_carries_the_bundle_of_the_code_in_the_work_folder(tmp_path, monkeypatch, state):
    for k, v in tre.IDENTITY.items():
        monkeypatch.setenv(k, v)
    repo, remote, run, ws = stopped_run(tmp_path)
    res = record_event.record(repo, run, state, "stopped by the operator")
    assert res["pushed"], res
    assert BUNDLE in pushed_files(remote)
    assert head_of_bundle(run / BUNDLE) == head_of(ws)


def test_a_run_event_with_no_work_folder_is_still_recorded(tmp_path, monkeypatch):
    for k, v in tre.IDENTITY.items():
        monkeypatch.setenv(k, v)
    repo, remote, run, ws = stopped_run(tmp_path)
    (run / "work_dir.txt").unlink()
    res = record_event.record(repo, run, "stopped", "")
    assert res["pushed"], res
    assert BUNDLE not in pushed_files(remote)


def test_a_work_folder_that_is_gone_does_not_fail_or_delete_the_bundle_the_run_has(tmp_path, monkeypatch):
    for k, v in tre.IDENTITY.items():
        monkeypatch.setenv(k, v)
    repo, remote, run, ws = stopped_run(tmp_path)
    record_event.record(repo, run, "stopped", "")
    kept = (run / BUNDLE).read_bytes()
    subprocess.run(["rm", "-r", str(ws.parent)], check=True)
    res = record_event.record(repo, run, "stopped", "again")
    assert res["pushed"] or res.get("committed") is False, res
    assert (run / BUNDLE).read_bytes() == kept


def test_a_bundle_that_cannot_be_made_never_stops_the_event_being_recorded(tmp_path, monkeypatch):
    for k, v in tre.IDENTITY.items():
        monkeypatch.setenv(k, v)
    repo, remote, run, ws = stopped_run(tmp_path)

    def boom(*a, **k):
        raise subprocess.CalledProcessError(1, "git bundle")

    monkeypatch.setattr(drive, "make_bundle", boom)
    res = record_event.record(repo, run, "stopped", "")
    assert res["pushed"], res
    assert BUNDLE not in pushed_files(remote)


def test_finalize_makes_its_bundle_with_the_same_code(tmp_path):
    import finalize
    repo, remote, run, ws = stopped_run(tmp_path)
    out = tmp_path / "final.bundle"
    finalize.bundle(ws, out)
    assert head_of_bundle(out) == head_of(ws)
    assert finalize.bundle.__code__.co_names.count("make_bundle") == 1, "finalize has its own bundle command again"
