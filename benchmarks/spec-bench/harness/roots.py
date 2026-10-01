"""roots.py — the one place that says where the harness's code is and where its results live.

Two roots, usually the same directory:

- the code root: the tree this file is in (benchmarks/spec-bench/harness -> its root). The harness's own files:
  its scripts, the generic prompt template, EVALUATION-POLICY.md, benchmarks/perf. What a harness release pins.
- the results root: the checkout of main where runs are written, committed and pushed. Everything that is a
  record or belongs with one: each run's directory (combinations/…/benchmarks/<pack>/<run-id>,
  benchmarks/reference/<pack>/<stack>/<run-id>), other runs' records (baselines, known runs), a combination's
  config.sh and a reference stack's stack.env, the packs (benchmarks/<name>, versioned by their own tags) and the
  private pack checkout beside the repo.

A developer runs run.sh from a checkout and the two are that checkout. A benchmark node runs the harness of the
latest release: dbench materialises the release tag as a directory of its own (no .git, read-only, with
RELEASE_FILE at its root) and sets $SPEC_BENCH_RESULTS_ROOT to the node's checkout, so the code that runs is the
code that passed the release's checks while results still go to main.

The agent's sandbox hides both roots (drive.SANDBOX_DENY).

The results root is never guessed. In a checkout with no variable it is that checkout, as it always was. In a
release with no variable the harness stops as it loads. And a record is committed only where it belongs
(drive.record_refusal): the run must be inside the root, and the root must be the top of a git checkout.

    python3 roots.py results          # the results root
    python3 roots.py code             # the code root
    python3 roots.py harness-commit   # the code's commit, short: the release's, or HEAD of the checkout
    python3 roots.py release-tag      # the release's tag; empty in a checkout
    python3 roots.py release-json     # the same as JSON: "harness-v…" or null

Tests: test_roots.py; test_pipeline.py runs the story loop with the two apart.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ENV = "SPEC_BENCH_RESULTS_ROOT"
# Checkouts no record may be committed in, whatever root a recorder is given (drive.record_refusal): paths joined
# by os.pathsep. Tests only: conftest.py names the roots the tests run with, so neither a test nor a process it
# starts can commit and push there, as one did on 1 Oct 2026 when the results root fell back to that checkout.
NO_RECORD_ENV = "SPEC_BENCH_NO_RECORD_IN"


def off_limits(environ: dict | None = None) -> list[Path]:
    given = (os.environ if environ is None else environ).get(NO_RECORD_ENV, "")
    return [Path(p).resolve() for p in given.split(os.pathsep) if p]
# Written by dbench at the root of a materialised release (tools/dbench/src/harness.rs MANIFEST_FILE):
# {"tag", "commit", "commit_short"}. A release has no .git, so this is how it knows what it is.
RELEASE_FILE = "RELEASE.json"
RELEASE_KEYS = ("tag", "commit", "commit_short")
HARNESS = Path(__file__).resolve().parent
CODE_ROOT = HARNESS.parents[2]                 # benchmarks/spec-bench/harness -> its root
QUESTIONS = ("results", "code", "harness-commit", "release-tag", "release-json")


def results_root(environ: dict | None = None) -> Path:
    """$SPEC_BENCH_RESULTS_ROOT, else the code root when that is a checkout. A root that isn't a directory stops
    the harness: results written anywhere else would be lost. So does a release with no variable: its own
    directory keeps no results and has no git, so git would look upwards and commit into whatever repository
    happened to contain it."""
    given = (os.environ if environ is None else environ).get(ENV)
    if not given:
        found = release()
        if found:
            raise SystemExit(f"this is harness release {found['tag']}, which keeps no results of its own: set ${ENV} "
                             f"to the checkout that does (dbench does, for the jobs it runs), or run run.sh from a "
                             f"checkout")
        return CODE_ROOT
    root = Path(given).expanduser().resolve()
    if not root.is_dir():
        raise SystemExit(f"${ENV} is {given}, which is not a directory: results have nowhere to go")
    return root


def release(code_root: Path = CODE_ROOT) -> dict | None:
    """The release this code is, from its manifest: {"tag", "commit", "commit_short"}. None in a checkout.
    A manifest that can't be read stops the harness: a release must not run as an unknown harness."""
    manifest = Path(code_root) / RELEASE_FILE
    if not manifest.is_file():
        return None
    try:
        doc = json.loads(manifest.read_text())
        return {k: str(doc[k]) for k in RELEASE_KEYS}
    except (OSError, ValueError, KeyError, TypeError) as e:
        raise SystemExit(f"{manifest}: not a release manifest ({RELEASE_FILE} needs {', '.join(RELEASE_KEYS)}): {e!r}")


def release_tag(code_root: Path = CODE_ROOT) -> str | None:
    found = release(code_root)
    return found["tag"] if found else None


def harness_commit(code_root: Path = CODE_ROOT) -> str:
    """The code's commit, short: the release's, or HEAD of the checkout (empty where git can't say)."""
    found = release(code_root)
    if found:
        return found["commit_short"]
    return subprocess.run(["git", "-C", str(code_root), "rev-parse", "--short", "HEAD"], capture_output=True,
                          text=True).stdout.strip()


RESULTS_ROOT = results_root()


def main(argv: list[str]) -> None:
    if len(argv) != 1 or argv[0] not in QUESTIONS:
        sys.exit(f"usage: roots.py {'|'.join(QUESTIONS)}")
    what = argv[0]
    if what == "results":
        print(RESULTS_ROOT)
    elif what == "code":
        print(CODE_ROOT)
    elif what == "harness-commit":
        print(harness_commit())
    elif what == "release-tag":
        print(release_tag() or "")
    else:
        print(json.dumps(release_tag()))


if __name__ == "__main__":
    main(sys.argv[1:])
