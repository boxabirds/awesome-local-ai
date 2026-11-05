"""Test support (story 23): the real bench-lake command, and a scratch lake holding a run and the lake's code
repository, laid out as dbench lays it out (`code-import`, the collector): the run folder under
`collected/<node>/<id>`, its branches under `refs/runs/<node>/<id>/heads/` and each story's commit under
`refs/runs/<node>/<id>/story/NN` in `code.git`. Git and bench-lake are real; nothing is mocked."""
from __future__ import annotations

import functools
import json
import shutil
import subprocess
from pathlib import Path

import benchlake

TOOLS = benchlake.REPO / "tools"
BUILT = TOOLS / "target" / "release" / "bench-lake"
BUILD_TIMEOUT_S = 900
NODE = "node-t"
RUN_ID = "combinations/m/1/size/linux/hw/eng-cli/benchmarks/vidi/r1"


@functools.lru_cache(maxsize=None)
def binary() -> Path:
    """bench-lake built from this checkout (cargo builds only what changed), so a test never runs a stale one."""
    cargo = shutil.which("cargo")
    if not cargo:
        raise RuntimeError("these tests run the real bench-lake and need cargo to build it")
    subprocess.run([cargo, "build", "--quiet", "--release", "-p", "bench-lake"], cwd=TOOLS, check=True,
                   timeout=BUILD_TIMEOUT_S)
    return BUILT


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(cwd), "-c", "user.name=a", "-c", "user.email=a@b", *args],
                          capture_output=True, text=True, check=True).stdout.strip()


def lake(tmp: Path, monkeypatch) -> Path:
    """An empty lake (its state folder, with `collected/`, `reference/` and `code.git`), used by benchlake."""
    state = tmp / "state"
    (state / "collected").mkdir(parents=True)
    (state / "reference").mkdir()
    subprocess.run(["git", "init", "--quiet", "--bare", str(state / "code.git")], check=True)
    monkeypatch.setenv(benchlake.BIN_ENV, str(binary()))
    monkeypatch.setenv(benchlake.STATE_ENV, str(state))
    return state


def add_run(state: Path, repo: Path | None, stories: dict[int, str], node: str = NODE, run_id: str = RUN_ID) -> Path:
    """The run's folder in the lake (run.json, metrics.json naming each story's commit) and, from `repo`, its
    branches and the story refs in code.git (a story whose commit the repository lacks gets none, as the import)."""
    run = state / "collected" / node / run_id
    run.mkdir(parents=True)
    (run / "run.json").write_text(json.dumps({"run": run_id.rsplit("/", 1)[-1]}))
    (run / "metrics.json").write_text(json.dumps({"stories": {str(s): {"commit": c} for s, c in stories.items()}}))
    if repo is None:
        return run
    code = state / "code.git"
    prefix = f"refs/runs/{node}/{run_id}"
    git(code, "fetch", "--quiet", "--no-tags", str(repo), f"+refs/heads/*:{prefix}/heads/*")
    for story, commit in stories.items():
        if subprocess.run(["git", "-C", str(code), "cat-file", "-e", f"{commit}^{{commit}}"]).returncode == 0:
            git(code, "update-ref", f"{prefix}/story/{story:02d}", commit)
    return run
