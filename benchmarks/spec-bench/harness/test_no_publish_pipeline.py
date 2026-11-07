"""Story 23 (harness.no_publish), TC-20 to TC-24: a recorded run (--record), from its first story through the run event
and finalize, publishes nothing. The run is in a bench checkout that has a remote, beside a private repository; a `git`
first on the PATH logs every git command and the directory it works in.

  TC-20  each story is committed and tagged story-NN in the run's own repository; no git command works in the bench
         checkout (TC-20b, a tag that fails, is test_drive_main's: a harness fault, the story recorded as ever);
  TC-21  no workspace.bundle anywhere in the run folder after the stories, the run event and finalize;
  TC-22  the held-out detail stays in the run folder, and the private repository is untouched;
  TC-24  a bench checkout with uncommitted changes is byte-identical afterwards, outside the run folder, and its
         remote has not moved.

The rig is test_pipeline's: a scripted agent builds a two-story app, held-out results known in advance.
"""
from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

import drive
import finalize
import heldout
import publicise
import record_event
import tagsuite
import test_pipeline as tp

pytestmark = tp.pytestmark

RUN_REL = "combinations/a/b/benchmarks/kat/run"
# Paths written in: the agent's own environment is allow-listed, so a variable would not reach a git it runs.
SPY = """#!/bin/sh
printf '%s\\t%s\\0' "$PWD" "$*" >> '{log}'
exec '{real}' "$@"
"""
DIRTY = "notes.md"
UNTRACKED = "scratch.txt"


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", *args],
                          cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def repo_with_remote(root: Path) -> tuple[Path, Path]:
    """A bench checkout of main with one commit, its remote, and uncommitted changes (one changed file, one new)."""
    remote, checkout = root / "remote.git", root / "checkout"
    git(root, "init", "-q", "--bare", str(remote))
    checkout.mkdir()
    git(checkout, "init", "-q")
    (checkout / DIRTY).write_text("committed\n")
    git(checkout, "add", "-A")
    git(checkout, "commit", "-qm", "the bench checkout")
    git(checkout, "remote", "add", "origin", str(remote))
    git(checkout, "push", "-q", "origin", "main")
    (checkout / DIRTY).write_text("committed\nand changed, not committed\n")
    (checkout / UNTRACKED).write_text("never added\n")
    return checkout, remote


def private_repo(root: Path) -> Path:
    p = root / "private-copy"
    p.mkdir()
    git(p, "init", "-q")
    (p / "README.md").write_text("the private repository\n")
    git(p, "add", "-A")
    git(p, "commit", "-qm", "private")
    return p


def snapshot(top: Path, skip: Path | None = None) -> dict[str, str]:
    """Every file under `top` (its .git included) by content, except under `skip`."""
    out = {}
    for f in sorted(top.rglob("*")):
        if skip is not None and (f == skip or skip in f.parents):
            continue
        if f.is_file() and not f.is_symlink():
            out[f.relative_to(top).as_posix()] = hashlib.sha256(f.read_bytes()).hexdigest()
    return out


def worked_in(line: str) -> Path:
    """The repository a logged git command worked in: its -C directory, else the directory it ran in."""
    cwd, args = line.split("\t", 1)
    words = args.split()
    for i, w in enumerate(words[:-1]):
        if w == "-C":
            return (Path(cwd) / words[i + 1]).resolve()
    return Path(cwd).resolve()


@pytest.fixture(scope="module")
def recorded_run(tmp_path_factory):
    """One recorded run: both stories with --record, then the finished event and finalize with its recorder, as
    run.sh does them."""
    root = tmp_path_factory.mktemp("no-publish")
    checkout, remote = repo_with_remote(root)
    private = private_repo(root)
    before = {"checkout": snapshot(checkout), "remote": snapshot(remote), "private": snapshot(private)}
    spy = root / "spy"
    spy.mkdir()
    log = root / "git-calls.log"
    (spy / "git").write_text(SPY.format(log=log, real=shutil.which("git")))
    (spy / "git").chmod((spy / "git").stat().st_mode | stat.S_IEXEC)
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("PATH", f"{spy}{os.pathsep}{os.environ['PATH']}")
        mp.setattr(drive, "REPO_ROOT", checkout)
        mp.setattr(heldout, "private_repo", lambda: private)
        run = tp.drive_run(root, mp, extra_args=("--record",), run=checkout / RUN_REL)
        record_event.record(run, "finished")
        version = tagsuite.version_for(finalize.load_pack(tp.PACK))
        finalize.finalize(run, tp.PACK_REF, version, rescore=tp.rescore_here(mp))
    calls = [c for c in log.read_text().split("\0") if c] if log.exists() else []   # NUL-ended: messages span lines
    return {"root": root, "run": run, "checkout": checkout, "remote": remote, "private": private, "before": before,
            "calls": calls}


def test_tc20_each_story_is_committed_and_tagged_in_the_run_s_own_repository(recorded_run):
    ws = Path((recorded_run["run"] / "work_dir.txt").read_text().strip()) / drive.WORKSPACE_DIR
    tags = git(ws, "tag", "--list", "story-*").split()
    assert tags == ["story-01", "story-02"]
    m = heldout.load_metrics(recorded_run["run"])
    for sid in ("1", "2"):
        assert git(ws, "rev-parse", f"story-{int(sid):02d}^{{commit}}") == m["stories"][sid]["commit"]


def test_tc20_no_git_command_works_in_the_bench_checkout_or_the_private_repository(recorded_run):
    checkout, private = recorded_run["checkout"].resolve(), recorded_run["private"].resolve()
    calls = recorded_run["calls"]
    assert calls, "the spy saw no git command at all: it is not in the way"
    stray = [c for c in calls if (d := worked_in(c)) == checkout or checkout in d.parents
             or d == private or private in d.parents]
    assert stray == [], "\n".join(stray)


def test_tc21_no_workspace_bundle_anywhere_in_the_run_folder(recorded_run):
    assert sorted(p.relative_to(recorded_run["run"]).as_posix() for p in recorded_run["run"].rglob("*.bundle")) == []


def test_tc22_held_out_detail_stays_in_the_run_folder_and_the_private_repository_is_untouched(recorded_run):
    run = recorded_run["run"]
    base = run.relative_to(recorded_run["checkout"]).as_posix()
    detail = [f for f in run.rglob("*") if f.is_file() and publicise.is_private(f"{base}/{f.relative_to(run).as_posix()}")]
    assert detail, "the run has held-out detail to keep"
    assert {f.name for f in detail} >= {"heldout-detail.json", "accept.json"}
    assert snapshot(recorded_run["private"]) == recorded_run["before"]["private"]


def test_tc24_a_dirty_bench_checkout_is_byte_identical_and_its_remote_has_not_moved(recorded_run):
    checkout = recorded_run["checkout"]
    assert snapshot(checkout, skip=checkout / RUN_REL) == recorded_run["before"]["checkout"]
    assert (checkout / DIRTY).read_text() == "committed\nand changed, not committed\n"
    assert snapshot(recorded_run["remote"]) == recorded_run["before"]["remote"]
