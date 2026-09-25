# /// script
# requires-python = ">=3.11"
# ///
"""Build a blinded package for an independent grader (see benchmarks/vidi/GRADING.md).

    uv run grading_package.py --out ~/vidi-grading \
        --build opus=<workspace>:<claims-dir>:<accept.json> \
        --build flash-next=<workspace>:<claims-dir>:<accept.json> \
        --key ~/vidi-grading-key.json

The builds become A and B in random order, and the name-to-letter key goes to --key, outside the
package. Each build gets:
- workspace/: git HEAD, without spec/ and without git history, so no author names;
- commits.txt: messages and changed files, without authors;
- claims/: the agent's final statements;
- heldout.json: with local paths removed.

Setup names are scrubbed from all text, and anything left is reported. No existing audit is
included, so the grade is independent.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import subprocess
from pathlib import Path

import packdir

HERE = Path(__file__).resolve().parent
TEXT_SUFFIXES = {".md", ".json", ".txt", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".jsonc", ".sh", ".toml", ".yaml", ".yml"}
# Words that would tell the grader which setup made a build.
REVEALING = re.compile(r"\b(opus|claude|anthropic|qwen|flash[- ]?next|mtplx|pi\.dev|pi-coding-agent|vidi-agent|opus-5\.5-reference|canvas-pi-\d+)\b", re.I)
HOME = re.compile(r"(/Users|/home)/[^/\s\"'`]+")


def scrub(text: str) -> str:
    return REVEALING.sub("[setup]", HOME.sub("~", text))


def copy_build(name: str, ws: Path, claims: Path, accept: Path, dest: Path) -> list[str]:
    (dest / "workspace").mkdir(parents=True)
    archive = subprocess.run(["git", "-C", str(ws), "archive", "HEAD"], capture_output=True, check=True).stdout
    subprocess.run(["tar", "-x", "-C", str(dest / "workspace"), "--exclude", "spec"], input=archive, check=True)
    log = subprocess.run(["git", "-C", str(ws), "log", "--reverse", "--date=iso", "--format=commit %h  %ad%n    %s", "--stat"],
                         capture_output=True, text=True, check=True).stdout
    (dest / "commits.txt").write_text(scrub(log))
    (dest / "claims").mkdir()
    for f in sorted(claims.glob("story-*.md")):
        body = f.read_text().split("\n", 1)[1] if f.read_text().startswith("# ") else f.read_text()
        (dest / "claims" / f.name).write_text(f"# {f.stem.replace('-', ' ').title()}: the agent's final statements\n{scrub(body)}")
    (dest / "heldout.json").write_text(scrub(accept.read_text()))
    leftovers = []
    for f in (dest / "workspace").rglob("*"):
        if f.is_file() and f.suffix in TEXT_SUFFIXES:
            t = f.read_text(errors="replace")
            s = scrub(t)
            if s != t:
                f.write_text(s)
                leftovers.append(str(f.relative_to(dest)))
    return leftovers


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--key", type=Path, required=True, help="where to save the name→letter key (keep it away from the grader)")
    ap.add_argument("--build", action="append", required=True, help="name=workspace:claims-dir:accept.json (exactly two)")
    ap.add_argument("--scope", default="canvas")
    a = ap.parse_args()
    if len(a.build) != 2:
        raise SystemExit("exactly two --build entries")
    out = a.out.expanduser()
    if out.exists():
        raise SystemExit(f"{out} exists; choose a new directory")
    pack = packdir.resolve(HERE.parent)
    out.mkdir(parents=True)
    shutil.copy(HERE.parent / "GRADING.md", out / "GRADING.md")
    shutil.copytree(pack / "spec", out / "spec")
    shutil.copy(pack / "scope" / f"{a.scope}.json", out / "scope.json")
    shutil.copytree(pack / "acceptance" / "tests", out / "acceptance" / "tests")
    builds = [b.split("=", 1) for b in a.build]
    random.SystemRandom().shuffle(builds)
    key = {}
    for letter, (name, spec) in zip("AB", builds):
        ws, claims, accept = (Path(p).expanduser() for p in spec.split(":"))
        edited = copy_build(name, ws, claims, accept, out / f"build-{letter}")
        key[letter] = name
        print(f"build-{letter}: {len(edited)} workspace files had setup names scrubbed")
    a.key.expanduser().write_text(json.dumps(key, indent=2))
    print(f"package: {out}\nkey (don't share with the grader): {a.key}")


if __name__ == "__main__":
    main()
