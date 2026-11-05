"""The lake, through bench-lake (story 23): host tools take a run's code from the lake's code repository by running
`bench-lake <state> workspace <run> <story> <dest>` and reading its JSON answer (tools/bench-lake/CANONICAL.md).
Nothing here reads the lake itself: one reader of the lake, in Rust, and this runs it.

The command is $BENCH_LAKE, else the checkout's release build (tools/target/release/bench-lake); the lake's state
folder is $BENCH_LAKE_STATE, else the private repository's beside this checkout. The benchmarker defaults the same.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

BIN_ENV = "BENCH_LAKE"
STATE_ENV = "BENCH_LAKE_STATE"
REPO = Path(__file__).resolve().parents[3]
DEFAULT_BIN = REPO / "tools" / "target" / "release" / "bench-lake"
DEFAULT_STATE = REPO.parent / "awesome-local-ai-bench-private" / "state"
COLLECTED = "collected"
REFERENCE = "reference"
REFERENCE_ID_PREFIX = "benchmarks/reference"
NODE_SEPARATOR = "@"
# bench-lake's exits: 0 an answer (found or absent), 2 a refusal or a malformed question; anything else failed.
EXIT_ANSWER = 0
EXIT_REFUSED = 2
TIMEOUT_S = 600


def binary() -> Path:
    return Path(os.environ.get(BIN_ENV) or DEFAULT_BIN)


def state() -> Path:
    return Path(os.environ.get(STATE_ENV) or DEFAULT_STATE)


def ask(*words: str) -> dict:
    """bench-lake's answer to a question, as JSON. A command that cannot answer stops the caller with its message."""
    cmd = [str(binary()), str(state()), *words]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise SystemExit(f"bench-lake {binary()} could not run: {e}") from None
    if r.returncode not in (EXIT_ANSWER, EXIT_REFUSED) or not r.stdout.strip():
        raise SystemExit(f"bench-lake {' '.join(words)} failed (exit {r.returncode}): {r.stderr.strip()[-500:]}")
    return json.loads(r.stdout)


def run_id(run: Path) -> str | None:
    """The lake's name for a run folder: its path in this checkout (the id bench-lake gives the preferred copy), or,
    for a folder in the lake itself, `<node>@<id>` (a collected copy) or `benchmarks/reference/...`. None for a folder
    in neither, which the lake cannot hold."""
    run = run.resolve()
    lake = state().resolve()
    if run.is_relative_to(lake / COLLECTED):
        node, *rest = run.relative_to(lake / COLLECTED).parts
        return f"{node}{NODE_SEPARATOR}{'/'.join(rest)}"
    if run.is_relative_to(lake / REFERENCE):
        return f"{REFERENCE_ID_PREFIX}/{run.relative_to(lake / REFERENCE).as_posix()}"
    if run.is_relative_to(REPO):
        return run.relative_to(REPO).as_posix()
    return None


def workspace(run: Path, story: int, dest: Path) -> str | None:
    """The run's code at the story, checked out in dest (which must not exist or be empty) with its history; the
    commit. None when the lake has no code for it (bench-lake's absence). A refusal stops the caller."""
    name = run_id(run)
    if name is None:
        return None
    answer = ask("workspace", name, str(story), str(dest))
    if answer["status"] == "found":
        return answer["commit"]
    if answer["status"] == "absent":
        return None
    raise SystemExit(f"bench-lake workspace {name} {story}: {json.dumps(answer.get('refused', answer))}")
