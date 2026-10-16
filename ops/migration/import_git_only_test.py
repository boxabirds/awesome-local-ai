"""Tests of the one-time import of run files that only git holds into the lake.

Run: uv run --with pytest python -m pytest ops/migration/import_git_only_test.py

Every test builds a real git repository and a real lake folder in a temporary directory.
"""
from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path

import pytest

import import_git_only as imp

REF_RUN = "benchmarks/reference/vidi/opus-5.5/run-1"
COMBO_RUN = "combinations/qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/canvas-pi-01"
NODE = "gruntus"
OTHER_NODE = "quintus"


def git(repo: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", *args],
                   check=True, capture_output=True)


def commit_files(repo: Path, files: dict[str, bytes]) -> None:
    if not (repo / ".git").exists():
        repo.mkdir(parents=True, exist_ok=True)
        git(repo, "init", "-q")
    for rel, data in files.items():
        p = repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        git(repo, "add", "--", rel)
    git(repo, "commit", "-q", "-m", "files")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture
def world(tmp_path):
    repo = tmp_path / "repo"
    store = tmp_path / "state"
    (store / "collected" / NODE).mkdir(parents=True)
    (store / "collected" / OTHER_NODE).mkdir(parents=True)
    (store / "reference").mkdir(parents=True)
    return repo, store


def lake_ref(store: Path, rel: str) -> Path:
    return store / "reference" / "vidi" / "opus-5.5" / "run-1" / rel


def lake_combo(store: Path, rel: str, node: str = NODE) -> Path:
    return store / "collected" / node / COMBO_RUN / rel


def test_a_reference_run_file_only_git_holds_is_planned_to_the_reference_folder_of_the_lake(world):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b'{"a": 1}'})
    plan = imp.plan(repo, store)
    assert [(c.source, c.dest) for c in plan.copies] == [(f"{REF_RUN}/run.json", lake_ref(store, "run.json"))]
    assert plan.conflicts == [] and plan.refused == []


def test_applying_the_plan_writes_the_exact_bytes_and_a_second_plan_is_empty(world):
    repo, store = world
    data = b"line one\r\nline two\x00\xff\n"
    commit_files(repo, {f"{REF_RUN}/stories/01/notes.md": data})
    result = imp.apply(imp.plan(repo, store), repo)
    assert result.copied == 1
    assert lake_ref(store, "stories/01/notes.md").read_bytes() == data
    assert imp.plan(repo, store).copies == []


def test_a_file_the_lake_already_holds_with_the_same_bytes_is_not_planned(world):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b"same"})
    lake_ref(store, "run.json").parent.mkdir(parents=True)
    lake_ref(store, "run.json").write_bytes(b"same")
    plan = imp.plan(repo, store)
    assert plan.copies == [] and plan.conflicts == []


def test_a_file_the_lake_holds_with_other_bytes_is_a_conflict_and_is_never_overwritten(world):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b"from git"})
    lake_ref(store, "run.json").parent.mkdir(parents=True)
    lake_ref(store, "run.json").write_bytes(b"from the lake")
    plan = imp.plan(repo, store)
    assert plan.copies == []
    assert [c.source for c in plan.conflicts] == [f"{REF_RUN}/run.json"]
    imp.apply(plan, repo)
    assert lake_ref(store, "run.json").read_bytes() == b"from the lake"


def test_the_workspace_folder_the_gitignore_file_and_archived_json_are_left_out(world):
    repo, store = world
    commit_files(repo, {
        f"{REF_RUN}/workspace/src/app.py": b"code",
        f"{REF_RUN}/.gitignore": b"x",
        f"{REF_RUN}/archived.json": b"{}",
        f"{REF_RUN}/run.json": b"kept",
    })
    plan = imp.plan(repo, store)
    assert [c.source for c in plan.copies] == [f"{REF_RUN}/run.json"]


def test_files_outside_the_two_run_layouts_are_not_run_files_and_are_ignored(world):
    repo, store = world
    commit_files(repo, {"README.md": b"x", "benchmarks/docs/guide/index.html": b"y",
                        f"{REF_RUN}/run.json": b"z"})
    assert [c.source for c in imp.plan(repo, store).copies] == [f"{REF_RUN}/run.json"]


def test_a_combination_file_goes_to_the_one_node_whose_lake_folder_holds_that_run(world):
    repo, store = world
    commit_files(repo, {f"{COMBO_RUN}/run-status.json": b"stub"})
    (store / "collected" / NODE / COMBO_RUN).mkdir(parents=True)
    plan = imp.plan(repo, store)
    assert [(c.source, c.dest) for c in plan.copies] == [
        (f"{COMBO_RUN}/run-status.json", lake_combo(store, "run-status.json"))]


def test_a_combination_run_no_node_holds_is_refused_not_guessed(world):
    repo, store = world
    commit_files(repo, {f"{COMBO_RUN}/run-status.json": b"stub"})
    plan = imp.plan(repo, store)
    assert plan.copies == []
    assert [r.source for r in plan.refused] == [f"{COMBO_RUN}/run-status.json"]
    assert "no node" in plan.refused[0].reason


def test_a_combination_run_two_nodes_hold_is_refused_not_guessed(world):
    repo, store = world
    commit_files(repo, {f"{COMBO_RUN}/run-status.json": b"stub"})
    (store / "collected" / NODE / COMBO_RUN).mkdir(parents=True)
    (store / "collected" / OTHER_NODE / COMBO_RUN).mkdir(parents=True)
    plan = imp.plan(repo, store)
    assert plan.copies == []
    assert "more than one node" in plan.refused[0].reason


def test_a_combination_file_a_node_already_holds_is_not_planned_to_another_node(world):
    repo, store = world
    commit_files(repo, {f"{COMBO_RUN}/run-status.json": b"stub"})
    (store / "collected" / NODE / COMBO_RUN).mkdir(parents=True)
    lake_combo(store, "run-status.json").write_bytes(b"stub")
    assert imp.plan(repo, store).copies == []


def test_the_plan_reads_the_committed_bytes_not_the_edited_working_copy(world):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b"committed"})
    (repo / REF_RUN / "run.json").write_bytes(b"edited after the commit")
    imp.apply(imp.plan(repo, store), repo)
    assert lake_ref(store, "run.json").read_bytes() == b"committed"


def test_apply_deletes_nothing_and_touches_no_file_outside_the_planned_destinations(world):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b"a", f"{REF_RUN}/other.json": b"b"})
    keep = store / "reference" / "vidi" / "opus-5.5" / "run-1" / "unrelated.txt"
    keep.parent.mkdir(parents=True)
    keep.write_bytes(b"mine")
    before = {p: sha(p.read_bytes()) for p in store.rglob("*") if p.is_file()}
    imp.apply(imp.plan(repo, store), repo)
    after = {p: sha(p.read_bytes()) for p in store.rglob("*") if p.is_file()}
    assert all(after[p] == h for p, h in before.items())
    assert set(after) - set(before) == {lake_ref(store, "run.json"), lake_ref(store, "other.json")}


def test_the_command_line_dry_run_prints_the_plan_and_writes_nothing(world, capsys):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b"a"})
    code = imp.main(["--repo", str(repo), "--store", str(store)])
    out = capsys.readouterr().out
    assert code == 0
    assert "would copy 1" in out
    assert not lake_ref(store, "run.json").exists()


def test_the_command_line_with_apply_copies_and_reports_the_count(world, capsys):
    repo, store = world
    commit_files(repo, {f"{REF_RUN}/run.json": b"a"})
    code = imp.main(["--repo", str(repo), "--store", str(store), "--apply"])
    assert code == 0
    assert "copied 1" in capsys.readouterr().out
    assert lake_ref(store, "run.json").read_bytes() == b"a"


def test_the_command_line_exits_one_when_a_conflict_or_refusal_remains(world, capsys):
    repo, store = world
    commit_files(repo, {f"{COMBO_RUN}/run-status.json": b"stub"})
    code = imp.main(["--repo", str(repo), "--store", str(store), "--apply"])
    assert code == 1
    assert "refused 1" in capsys.readouterr().out
