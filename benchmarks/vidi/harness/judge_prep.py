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
VIDI = HARNESS.parent
PER_STORY_FILES = ("accept.json", "gate.json")


def copy_run(run: Path, dest: Path) -> None:
    dest.mkdir(parents=True)
    subprocess.run(["git", "clone", "-q", str(run / "workspace"), str(dest / "workspace")], check=True)
    for sdir in sorted((run / "stories").iterdir()):
        out = dest / "stories" / sdir.name
        out.mkdir(parents=True)
        for name in PER_STORY_FILES:
            if (sdir / name).exists():
                shutil.copy(sdir / name, out / name)
        if (sdir / "screenshots").exists():
            shutil.copytree(sdir / "screenshots", out / "screenshots")


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
    shutil.copytree(VIDI / "spec", out / "spec")
    scope = json.loads((runs[0] / "metrics.json").read_text()).get("scope", "canvas")
    shutil.copy(VIDI / "scope" / f"{scope}.json", out / "scope.json")
    shutil.copy(HARNESS / "judge.md", out / "judge.md")
    out.with_suffix(".key.json").write_text(json.dumps({"A": str(runs[0]), "B": str(runs[1])}, indent=2))
    print(out)


if __name__ == "__main__":
    main()
