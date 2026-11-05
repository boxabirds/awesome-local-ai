"""benchlake.py (story 23, code.readers): host tools read a run's code through the real bench-lake command."""
from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

import benchlake
import lake_testing


def repo_with_two_commits(tmp_path: Path) -> tuple[Path, str, str]:
    src = tmp_path / "src"
    src.mkdir()
    lake_testing.git(src, "init", "-q", "-b", "main")
    commits = []
    for n in (1, 2):
        (src / "a.ts").write_text(f"export const a = {n}\n")
        lake_testing.git(src, "add", "-A")
        lake_testing.git(src, "commit", "-q", "-m", f"story {n}")
        commits.append(lake_testing.git(src, "rev-parse", "HEAD"))
    return src, commits[0], commits[1]


def test_the_lakes_name_for_a_run_folder(tmp_path, monkeypatch):
    state = lake_testing.lake(tmp_path, monkeypatch)
    collected = state / "collected" / "node-t" / lake_testing.RUN_ID
    assert benchlake.run_id(collected) == f"node-t@{lake_testing.RUN_ID}"
    assert benchlake.run_id(state / "reference" / "vidi" / "opus-5.5" / "r1") == "benchmarks/reference/vidi/opus-5.5/r1"
    assert benchlake.run_id(benchlake.REPO / lake_testing.RUN_ID) == lake_testing.RUN_ID
    assert benchlake.run_id(tmp_path / "elsewhere") is None


def test_a_workspace_is_the_story_refs_commit_with_its_history(tmp_path, monkeypatch):
    # TC-80, through the command
    src, first, second = repo_with_two_commits(tmp_path)
    state = lake_testing.lake(tmp_path, monkeypatch)
    run = lake_testing.add_run(state, src, {1: first, 2: second})
    dest = tmp_path / "w"
    assert benchlake.workspace(run, 1, dest) == first
    assert (dest / "a.ts").read_text() == "export const a = 1\n"
    assert benchlake.workspace(run, 2, tmp_path / "w2") == second
    count = subprocess.run(["git", "-C", str(tmp_path / "w2"), "rev-list", "--count", "HEAD"], capture_output=True, text=True)
    assert count.stdout.strip() == "2"


def test_no_code_in_the_lake_is_none_and_makes_nothing(tmp_path, monkeypatch):
    # TC-81
    src, first, _ = repo_with_two_commits(tmp_path)
    state = lake_testing.lake(tmp_path, monkeypatch)
    run = lake_testing.add_run(state, src, {1: first})
    assert benchlake.workspace(run, 9, tmp_path / "w") is None
    assert not (tmp_path / "w").exists()
    assert benchlake.workspace(tmp_path / "not-in-the-lake", 1, tmp_path / "w") is None


def test_a_refusal_stops_the_caller_with_bench_lakes_answer(tmp_path, monkeypatch):
    src, first, _ = repo_with_two_commits(tmp_path)
    state = lake_testing.lake(tmp_path, monkeypatch)
    run = lake_testing.add_run(state, src, {1: first})
    dest = tmp_path / "w"
    (dest / "keep").mkdir(parents=True)
    with pytest.raises(SystemExit, match="E-LAKE-DEST-NOT-EMPTY"):
        benchlake.workspace(run, 1, dest)


def test_a_command_that_fails_or_is_missing_stops_the_caller_with_its_message(tmp_path, monkeypatch):
    lake_testing.lake(tmp_path, monkeypatch)
    with pytest.raises(SystemExit, match="bench-lake no-such-question failed .exit 2.: .*unknown question"):
        benchlake.ask("no-such-question")
    monkeypatch.setenv(benchlake.BIN_ENV, str(tmp_path / "no-bench-lake"))
    with pytest.raises(SystemExit, match="could not run"):
        benchlake.ask("runs")


def test_the_defaults_are_the_checkouts_build_and_the_private_repos_state(monkeypatch):
    monkeypatch.delenv(benchlake.BIN_ENV, raising=False)
    monkeypatch.delenv(benchlake.STATE_ENV, raising=False)
    assert benchlake.binary() == benchlake.REPO / "tools" / "target" / "release" / "bench-lake"
    assert benchlake.state() == benchlake.REPO.parent / "awesome-local-ai-bench-private" / "state"
