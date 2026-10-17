"""Scope reduction (docs/design/dbench-scopes/api.md): what the harness no longer makes or commits. Each test fails if
the old behaviour returns: a workspace/ mirror, a compacted event log, or a raw log, compact log or workspace file in git.
What stays: workspace.bundle, metrics.json, gate.json, workspace-git-log.txt and the other records.
Run: uv run --with pytest pytest test_scope_reduction.py
"""
from __future__ import annotations

import gzip
import inspect
import subprocess
from pathlib import Path

import pytest

import drive
import publicise as pub
import test_publish_gate as pg

G, git, write, RUN_REL, MESSAGE = pg.G, pg.git, pg.write, pg.RUN_REL, pg.MESSAGE

RAW_LOG = "stories/01/agent-events.jsonl"
RAW_LOG_PI = "stories/01/agent-events-restart2.jsonl"
COMPACT_LOG = "stories/01/agent-events.compact.jsonl.gz"
STRAY_COMPACT = "stories/01/other.compact.jsonl.gz"
WORKSPACE_FILES = ["workspace/src/App.tsx", "workspace/notes.md", "workspace/tests/e2e/a.spec.ts"]
KEPT = ["metrics.json", "stories/01/gate.json", "workspace.bundle", "workspace-git-log.txt", "run.json"]
FORBIDDEN = [RAW_LOG, RAW_LOG_PI, COMPACT_LOG, STRAY_COMPACT, *WORKSPACE_FILES]
GIT_LOG_TEXT = "commit aaaa\nagent  Sat Sep 26 08:00:00 2026 +0100\n\n    story 1: board\n"
BUNDLE_BYTES = b"# v2 git bundle\n"
SMALL_LIMIT_BYTES = 100


def run_with_everything(repo: Path) -> Path:
    run = pg.small_run(repo)
    write(run / RAW_LOG, '{"_rx":1.0,"type":"session"}\n')
    write(run / RAW_LOG_PI, '{"_rx":2.0,"type":"session"}\n')
    write(run / COMPACT_LOG, gzip.compress(b'{"type":"session"}\n'))
    write(run / STRAY_COMPACT, gzip.compress(b'{"type":"session"}\n'))
    for rel in WORKSPACE_FILES:
        write(run / rel, "x\n")
    write(run / "stories/01/gate.json", {"steps": {"build": {"exit": 0}}})
    write(run / "workspace.bundle", BUNDLE_BYTES)
    write(run / "workspace-git-log.txt", GIT_LOG_TEXT)
    return run


def committed(repo: Path) -> set[str]:
    listed = git(repo, "ls-tree", "-r", "--name-only", "HEAD", "--", RUN_REL).split()
    return {p.removeprefix(RUN_REL + "/") for p in listed}


def test_1_no_workspace_mirror_is_made_and_the_git_log_still_is(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    write(ws / "a.txt", "a")
    subprocess.run(["git", "init", "-q", str(ws)], check=True)
    git(ws, "add", "a.txt")
    git(ws, "commit", "-qm", "story 1: board")
    run = tmp_path / "run"
    run.mkdir()
    assert not hasattr(drive, "mirror")
    drive.write_workspace_git_log(ws, run)
    assert "story 1: board" in (run / "workspace-git-log.txt").read_text()
    assert not (run / "workspace").exists()


def test_1b_the_story_loop_neither_mirrors_nor_compacts_but_writes_the_git_log():
    src = inspect.getsource(drive)
    assert "workspace mirror" not in src and "compacted log" not in src
    assert 'derived("workspace git log"' in src


def test_2_compact_events_and_the_deltas_only_it_used_are_gone():
    for name in ("compact_events", "_delta_stamp", "_cut_to_fit", "_truncate", "DELTA_TYPE", "MIRROR_EXCLUDES",
                 "EVENT_LOG_MAX_BYTES", "LOG_CUT_MARK"):
        assert not hasattr(drive, name), name
    assert not hasattr(pub, "EVENT_LOG_LIMIT") and not hasattr(pub, "WORKSPACE_LIMIT")


def test_2b_make_publishable_writes_no_compact_log_for_a_raw_log_outside_stories(tmp_path):
    run = tmp_path / RUN_REL
    write(run / "agent-events.jsonl", '{"_rx":1.0,"type":"session"}\n')
    drive.make_publishable(run)
    assert not list(run.rglob("*.compact.jsonl.gz"))


def test_3_a_record_commits_the_records_and_none_of_the_three_forbidden_kinds(tmp_path):
    repo, remote = pg.cloned(tmp_path, "public")
    run = run_with_everything(repo)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True and res["pushed"] is True, res
    got = committed(repo)
    assert set(KEPT) <= got, sorted(set(KEPT) - got)
    assert not got & set(FORBIDDEN), sorted(got & set(FORBIDDEN))
    assert not [p for p in got if p.startswith("workspace/") or "agent-events" in p or p.endswith(".compact.jsonl.gz")]
    pushed = set(subprocess.run(["git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "main"],
                                capture_output=True, text=True, check=True).stdout.split())
    assert not [p for p in pushed if "agent-events" in p or "/workspace/" in p or p.endswith(".compact.jsonl.gz")]
    for rel in FORBIDDEN:
        assert (run / rel).exists(), rel                    # on the machine, as they were
    assert git(repo, "status", "--porcelain", "--", RUN_REL).strip() == ""


def test_3b_a_forbidden_file_is_not_added_even_when_a_nested_gitignore_is_missing(tmp_path):
    """record_story writes the run's .gitignore itself: a stale one that lets them through is replaced."""
    repo, _ = pg.cloned(tmp_path, "public")
    run = run_with_everything(repo)
    write(run / ".gitignore", "# stale: ignores nothing\n")
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True
    assert not committed(repo) & set(FORBIDDEN)


def test_3c_copies_an_older_harness_committed_are_dropped_on_the_next_record_and_the_record_succeeds(tmp_path):
    repo, _ = pg.cloned(tmp_path, "public")
    run = run_with_everything(repo)
    git(repo, "add", "-f", "--", RUN_REL)
    git(repo, "commit", "-qm", "an older harness's record: compact log, raw log and mirror")
    assert set(FORBIDDEN) <= committed(repo)
    res = drive.record_story(repo, run, MESSAGE, git=G, private=tmp_path / "none")
    assert res["committed"] is True and res["pushed"] is True, res
    assert not committed(repo) & set(FORBIDDEN)
    assert set(KEPT) <= committed(repo)
    for rel in FORBIDDEN:
        assert (run / rel).exists(), rel


@pytest.mark.parametrize("rel,lake_only", [
    (f"{RUN_REL}/stories/01/agent-events.jsonl", True),
    (f"{RUN_REL}/stories/01/agent-events-restart2.jsonl", True),
    (f"{RUN_REL}/stories/01/agent-events.compact.jsonl.gz", True),
    (f"{RUN_REL}/rescore/v1/stories/02/x.compact.jsonl.gz", True),
    (f"{RUN_REL}/workspace/src/App.tsx", True),
    (f"{RUN_REL}/workspace/deep/dir/x.png", True),
    ("benchmarks/reference/vidi/opus-5.5/v2-r1/workspace/a.ts", True),
    (f"{RUN_REL}/workspace.bundle", False),
    (f"{RUN_REL}/workspace-git-log.txt", False),
    (f"{RUN_REL}/metrics.json", False),
    (f"{RUN_REL}/stories/01/gate.json", False),
    (f"{RUN_REL}/stories/01/accept-summary.json", False),
    ("tools/dbench/tests/fixtures/stories/02/agent-events.compact.jsonl.gz", False),
])
def test_3d_what_publicise_keeps_out_of_git(rel, lake_only):
    assert pub.is_lake_only(rel) is lake_only


def test_3e_the_run_gitignore_ignores_exactly_what_is_lake_only(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    run = tmp_path / RUN_REL
    write(run / ".gitignore", drive.RUN_GITIGNORE)
    every = FORBIDDEN + KEPT + ["stories/01/accept-summary.json", "summary.md"]
    for rel in every:
        write(run / rel, "x")
    ignored = set(subprocess.run(["git", "check-ignore", "--stdin"], cwd=run, input="\n".join(every),
                                 capture_output=True, text=True).stdout.split())
    assert ignored == set(FORBIDDEN)


def test_5_the_limits_that_remain_still_apply(tmp_path):
    assert pub.size_limit(f"{RUN_REL}/workspace.bundle") == pub.BUNDLE_LIMIT
    assert pub.size_limit(f"{RUN_REL}/metrics.json") == pub.METRICS_LIMIT
    assert pub.size_limit(f"{RUN_REL}/summary.md") == pub.DEFAULT_SIZE_LIMIT
    run = tmp_path / RUN_REL
    write(run / "workspace.bundle", b"\0" * (pub.BUNDLE_LIMIT + 1))
    write(run / "notes.md", "n" * (pub.DEFAULT_SIZE_LIMIT + 1))
    assert sorted(drive.make_publishable(run)) == sorted([str(run / "workspace.bundle"), str(run / "notes.md")])


def test_5b_over_limit_does_not_flag_a_tracked_copy_an_older_harness_committed_of_a_kind_no_longer_published(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    big = tmp_path / RUN_REL / "workspace" / "big.png"
    write(big, b"\0" * (pub.DEFAULT_SIZE_LIMIT + 1))
    subprocess.run(["git", "add", "-f", str(big)], cwd=tmp_path, check=True)
    assert pub.over_limit(tmp_path) == []
