# /// script
# requires-python = ">=3.11"
# ///
"""Build an anonymised A/B judging bundle from two finished runs.

    uv run judge_prep.py <run-1> <run-2> --out <dir> [--seed N]

Writes <dir>/{A,B}/ (workspace clone without node_modules, per-story accept/gate
JSON and screenshots), <dir>/spec, <dir>/scope.json and <dir>/judge.md. The
label→run mapping goes to <dir>.key.json, OUTSIDE the bundle, so a judge given
the bundle cannot see it. Run twice with different seeds to check position bias.
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
import benchlake  # noqa: E402
import heldout  # noqa: E402
import packdir  # noqa: E402
PACK = packdir.resolve()  # the judged runs are vidi's
PER_STORY_FILES = ("accept.json", "gate.json")
MIRROR = "workspace"          # the plain-file copy older runs have; the harness no longer writes it
# What the plain-file mirror left out (drive.MIRROR_EXCLUDES, minus .git): the pack's spec, build output, test output.
NOT_MIRRORED = ("spec", "node_modules", "dist", ".wrangler", "test-results", "playwright-report")


def drop_unmirrored(tree: Path) -> None:
    """Take from an app's working tree what the mirror never held, so the judge sees what it always saw."""
    for name in NOT_MIRRORED:
        target = tree / name
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        elif target.exists() or target.is_symlink():
            target.unlink()


def scored_story(run: Path) -> tuple[int, str] | None:
    """The story the run's final score was taken on and its commit: the last story metrics.json records a commit for.
    None for a run with no metrics.json or no commit in it."""
    try:
        st = json.loads((run / "metrics.json").read_text())["stories"]
    except (OSError, ValueError, KeyError):
        return None
    stories = st.items() if isinstance(st, dict) else ((s.get("id", i + 1), s) for i, s in enumerate(st))
    found = [(int(k), s["commit"]) for k, s in stories if s.get("commit")]
    return found[-1] if found else None


def clone_app(run: Path, dest: Path) -> None:
    """The run's app, with its git history, in dest: from the lake's code repository at the story the run was scored
    on (bench-lake workspace, story 23), else (a run from before the bundle, or a hand-built reference run) cloned
    from its workspace/ folder."""
    scored = scored_story(run)
    if scored and benchlake.workspace(run, scored[0], dest) is not None:
        drop_unmirrored(dest)
        return
    folder = run / MIRROR
    if not folder.is_dir():
        raise SystemExit(f"{run}: the lake has no code for it and it has no {MIRROR}/ folder: the app it built is not here")
    subprocess.run(["git", "clone", "-q", str(folder), str(dest)], check=True)


def copy_run(run: Path, dest: Path) -> None:
    """The run's app (clone_app) and each story's results. The held-out ones are private: taken from wherever
    heldout.find finds them (this machine's record, else the private repo's copy)."""
    dest.mkdir(parents=True)
    clone_app(run, dest / "workspace")
    for sdir in sorted((run / "stories").iterdir()):
        out = dest / "stories" / sdir.name
        out.mkdir(parents=True)
        for name in PER_STORY_FILES:
            if (src := heldout.find(run, f"stories/{sdir.name}/{name}")):
                shutil.copy(src, out / name)
        if (shots := heldout.find(run, f"stories/{sdir.name}/screenshots")):
            shutil.copytree(shots, out / "screenshots")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("runs", nargs=2, type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args()
    runs = [r.resolve() for r in a.runs]
    random.Random(a.seed).shuffle(runs)
    out = a.out.resolve()
    if out.exists():
        shutil.rmtree(out)
    for label, run in zip("AB", runs):
        copy_run(run, out / label)
    shutil.copytree(PACK / "spec", out / "spec")
    scope = json.loads((runs[0] / "metrics.json").read_text()).get("scope", "canvas")
    shutil.copy(PACK / "scope" / f"{scope}.json", out / "scope.json")
    shutil.copy(HARNESS / "judge.md", out / "judge.md")
    out.with_suffix(".key.json").write_text(json.dumps({"A": str(runs[0]), "B": str(runs[1])}, indent=2))
    print(out)


if __name__ == "__main__":
    main()
