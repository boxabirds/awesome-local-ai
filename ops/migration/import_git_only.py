#!/usr/bin/env python3
"""One-time import: copy run files that only git holds into the lake. Copy only; never overwrites or deletes.

    uv run ops/migration/import_git_only.py --repo REPO --store STATE            # dry run: prints the plan
    uv run ops/migration/import_git_only.py --repo REPO --store STATE --apply    # copies

A file is eligible if git HEAD tracks it as a run file (a combination run under combinations/**/benchmarks/<pack>/<run>/
or a reference run under benchmarks/reference/<pack>/<stack>/<run>/) and it is not under workspace/ (the lake keeps the
workspace as a bundle), not a .gitignore and not an archived.json. It is copied when no lake copy exists. A lake copy
with other bytes is a conflict and is left alone. A combination run that no node, or more than one node, holds in the
lake is refused: the tool does not guess which node's lake the file belongs to.

This is a one-time migration tool, written in Python and not in Rust: the lake layout it writes to is read by
dbench's collector, and a mistake here is caught by the comparison in the migration plan, not by a type.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

COMBINATIONS_ROOT = "combinations"
REFERENCE_ROOT = ("benchmarks", "reference")
BENCHMARKS_DIR = "benchmarks"
REFERENCE_RUN_DEPTH = 5            # benchmarks/reference/<pack>/<stack>/<run>
COMBINATION_RUN_TAIL = 3           # benchmarks/<pack>/<run> after the combination's own path
WORKSPACE_DIR = "workspace"
LEFT_OUT_NAMES = (".gitignore", "archived.json")
COLLECTED_DIR = "collected"
REFERENCE_DIR = "reference"
TEMP_PREFIX = ".import-git-only-"
EXIT_OK, EXIT_PROBLEMS = 0, 1


@dataclass(frozen=True)
class Copy:
    source: str
    dest: Path
    sha256: str


@dataclass(frozen=True)
class Conflict:
    source: str
    dest: Path


@dataclass(frozen=True)
class Refusal:
    source: str
    reason: str


@dataclass
class Plan:
    copies: list[Copy] = field(default_factory=list)
    conflicts: list[Conflict] = field(default_factory=list)
    refused: list[Refusal] = field(default_factory=list)


@dataclass
class Result:
    copied: int = 0


def _git(repo: Path, *args: str, data: bytes | None = None) -> bytes:
    return subprocess.run(["git", "-C", str(repo), *args], input=data, check=True, capture_output=True).stdout


def split_run_path(path: str) -> tuple[str, str, str] | None:
    """(kind, run folder, file inside the run) for a tracked run file, else None."""
    parts = path.split("/")
    if tuple(parts[:2]) == REFERENCE_ROOT:
        if len(parts) <= REFERENCE_RUN_DEPTH:
            return None
        return "reference", "/".join(parts[:REFERENCE_RUN_DEPTH]), "/".join(parts[REFERENCE_RUN_DEPTH:])
    if parts[0] == COMBINATIONS_ROOT and BENCHMARKS_DIR in parts:
        at = len(parts) - 1 - parts[::-1].index(BENCHMARKS_DIR)
        if len(parts) <= at + COMBINATION_RUN_TAIL:
            return None
        run_end = at + COMBINATION_RUN_TAIL
        return "combination", "/".join(parts[:run_end]), "/".join(parts[run_end:])
    return None


def is_left_out(rel: str) -> bool:
    return rel.split("/")[0] == WORKSPACE_DIR or rel.split("/")[-1] in LEFT_OUT_NAMES


def tracked_blobs(repo: Path) -> dict[str, str]:
    out = _git(repo, "ls-tree", "-r", "-z", "HEAD", "--", COMBINATIONS_ROOT, "/".join(REFERENCE_ROOT))
    blobs = {}
    for entry in out.split(b"\0"):
        if entry:
            meta, path = entry.split(b"\t", 1)
            blobs[path.decode()] = meta.split()[2].decode()
    return blobs


def read_blobs(repo: Path, oids: list[str]) -> dict[str, bytes]:
    """The committed bytes of each blob, through one cat-file process."""
    if not oids:
        return {}
    out = _git(repo, "cat-file", "--batch", data=("\n".join(oids) + "\n").encode())
    blobs, at = {}, 0
    for oid in oids:
        newline = out.index(b"\n", at)
        size = int(out[at:newline].split()[2])
        blobs[oid] = out[newline + 1:newline + 1 + size]
        at = newline + 1 + size + 1
    return blobs


def lake_candidates(kind: str, run: str, rel: str, store: Path) -> list[Path]:
    if kind == "reference":
        pack, stack, name = run.split("/")[2:5]
        return [store / REFERENCE_DIR / pack / stack / name / rel]
    collected = store / COLLECTED_DIR
    nodes = sorted(d for d in collected.iterdir() if d.is_dir()) if collected.is_dir() else []
    return [n / run / rel for n in nodes]


def holders(run: str, store: Path) -> list[Path]:
    collected = store / COLLECTED_DIR
    nodes = sorted(d for d in collected.iterdir() if d.is_dir()) if collected.is_dir() else []
    return [n for n in nodes if (n / run).is_dir()]


def plan(repo: Path, store: Path) -> Plan:
    eligible = {}
    for path, oid in tracked_blobs(repo).items():
        split = split_run_path(path)
        if split and not is_left_out(split[2]):
            eligible[path] = (split, oid)
    contents = read_blobs(repo, sorted({oid for _, oid in eligible.values()}))
    result = Plan()
    for path in sorted(eligible):
        (kind, run, rel), oid = eligible[path]
        want = hashlib.sha256(contents[oid]).hexdigest()
        present = [c for c in lake_candidates(kind, run, rel, store) if c.is_file()]
        if present:
            if not any(hashlib.sha256(c.read_bytes()).hexdigest() == want for c in present):
                result.conflicts.append(Conflict(path, present[0]))
            continue
        if kind == "reference":
            result.copies.append(Copy(path, lake_candidates(kind, run, rel, store)[0], want))
            continue
        nodes = holders(run, store)
        if not nodes:
            result.refused.append(Refusal(path, "no node's lake folder holds this run"))
        elif len(nodes) > 1:
            result.refused.append(Refusal(path, "more than one node's lake folder holds this run"))
        else:
            result.copies.append(Copy(path, nodes[0] / run / rel, want))
    return result


def apply(made: Plan, repo: Path) -> Result:
    """Write each planned copy with an exclusive create, so an existing file can never be replaced."""
    tracked = tracked_blobs(repo) if made.copies else {}
    oids = {c.source: tracked[c.source] for c in made.copies}
    contents = read_blobs(repo, sorted(set(oids.values())))
    result = Result()
    for copy in made.copies:
        copy.dest.parent.mkdir(parents=True, exist_ok=True)
        temp = copy.dest.with_name(TEMP_PREFIX + copy.dest.name)
        temp.write_bytes(contents[oids[copy.source]])
        try:
            os.link(temp, copy.dest)
            result.copied += 1
        except FileExistsError:
            pass
        finally:
            temp.unlink()
    return result


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--repo", required=True, type=Path, help="the repository whose HEAD is read")
    parser.add_argument("--store", required=True, type=Path, help="the lake's state folder")
    parser.add_argument("--apply", action="store_true", help="copy; without it only the plan is printed")
    args = parser.parse_args(argv)
    made = plan(args.repo, args.store)
    if args.apply:
        print(f"copied {apply(made, args.repo).copied}")
    else:
        print(f"would copy {len(made.copies)}")
    print(f"conflicts {len(made.conflicts)}")
    for c in made.conflicts:
        print(f"  conflict {c.source} -> {c.dest}")
    print(f"refused {len(made.refused)}")
    for r in made.refused:
        print(f"  refused {r.source}: {r.reason}")
    return EXIT_PROBLEMS if made.conflicts or made.refused else EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
