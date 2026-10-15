"""Build the mini project as a real git repository in a given folder, with a small history (not a committed .git folder).

The history has three commits: the code, a run's records, and a later change to one record, so audit queries that read
history (`git log`, `git show rev:path`) have something to find.

    uv run ops/refactor/fixtures/build_mini_repo.py DEST
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

MINI = Path(__file__).resolve().parent / "mini"
RUNS = "runs"
AUTHOR = ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false"]
IGNORED = shutil.ignore_patterns("node_modules", "target", "__pycache__", ".pytest_cache", ".coverage")


def git(dest: Path, *args: str) -> None:
    subprocess.run(["git", *AUTHOR, "-C", str(dest), *args], check=True, capture_output=True, text=True)


def build(dest: Path) -> Path:
    """Copy the mini project to dest and give it its history; returns dest."""
    shutil.copytree(MINI, dest, ignore=IGNORED)
    runs = dest / RUNS
    held = dest.parent / f"{dest.name}-runs-held"
    shutil.move(runs, held)
    git(dest, "init", "-q", "-b", "main")
    git(dest, "add", "-A")
    git(dest, "commit", "-q", "-m", "mini: the code")
    shutil.move(held, runs)
    git(dest, "add", RUNS)
    git(dest, "commit", "-q", "-m", "vidi/m1/run-1: run finished")
    metrics = runs / "vidi" / "m1" / "run-1" / "metrics.json"
    metrics.write_text('{"passed": 9}\n')
    git(dest, "add", RUNS)
    git(dest, "commit", "-q", "-m", "vidi/m1/run-1: rescored")
    return dest


if __name__ == "__main__":
    print(build(Path(sys.argv[1])))
