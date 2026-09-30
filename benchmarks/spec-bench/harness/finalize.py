"""finalize.py <run-dir> [--pack benchmarks/vidi] [--record]

At the end of a run: save the workspace's history as <run-dir>/workspace.bundle (the review page builds
each story from it), then re-score the final build with the held-out suite (rescore.py --final), so a
finished run has its score of record and can be judged without anyone doing it by hand.

The re-score only runs when the private suite checkout is exactly at the pack's pack_ref: a checkout a
commit past its tag records a version ("vidi-v2.0-pre2+22a2164") that no page matches, so the record says
why it wasn't scored instead. A run already re-scored under that version is left alone. With --record the
result is committed and pushed with the run's record. Never fails the caller: problems are reported.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

HARNESS = Path(__file__).resolve().parent
BUNDLE = "workspace.bundle"
STATUS = "finalize.json"

Rescore = Callable[[Path, Path, str], None]


def decide(version: str, pack_ref: str, already: bool) -> tuple[str, str]:
    """("rescore", "") or ("skip", why)."""
    if already:
        return "skip", f"already re-scored under {version}"
    if pack_ref and version != pack_ref:
        return "skip", f"the suite checkout is at {version}, not the pack's {pack_ref}"
    return "rescore", ""


def bundle(workspace: Path, dest: Path) -> None:
    subprocess.run(["git", "-C", str(workspace), "bundle", "create", str(dest), "--all"],
                   check=True, capture_output=True, text=True)


def score_of(run: Path, version: str) -> str:
    """The final checkpoint's result as "passed/total", from rescore.py's rescore.json."""
    last = json.loads((run / "rescore" / version / "rescore.json").read_text())["results"][-1]
    return f"{last['passed']}/{last['total']}"


def fault_of(run: Path, version: str) -> str | None:
    """Why the re-score says nothing about the app (the machine spoiled it), if it does."""
    last = json.loads((run / "rescore" / version / "rescore.json").read_text())["results"][-1]
    return last.get("harness_fault")


def set_aside(run: Path, version: str) -> None:
    """Move a spoiled re-score out of the way: the page doesn't read it, and the next finalize tries again."""
    dest = run / "rescore-spoiled" / f"{version}-{time.strftime('%Y%m%dT%H%M%S', time.gmtime())}"
    dest.parent.mkdir(exist_ok=True)
    (run / "rescore" / version).rename(dest)


def finalize(run: Path, pack_ref: str, version: str, rescore: Rescore, record: Callable[[str], None] | None) -> dict:
    work = Path((run / "work_dir.txt").read_text().strip()).expanduser()
    out: dict = {"version": version, "pack_ref": pack_ref, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    bundle(work / "workspace", run / BUNDLE)
    out["bundle"] = BUNDLE
    action, why = decide(version, pack_ref, already=(run / "rescore" / version / "rescore.json").is_file())
    if action == "skip" and why.startswith("already"):
        return {**out, "rescore": "done", "reason": why}   # nothing new to record
    if action == "rescore":
        try:
            rescore(run, run / BUNDLE, version)
            if fault := fault_of(run, version):
                set_aside(run, version)
                raise RuntimeError(fault)
            out.update(rescore="done", reason="", score=score_of(run, version))
            message = f"final score {out['score']} under {version}"
        except Exception as e:  # a broken scorer must not lose the bundle or the run's record
            out.update(rescore="failed", reason=str(e)[:300])
            message = f"final re-score failed: {out['reason']}"
    else:
        out.update(rescore="skipped", reason=why)
        message = f"not re-scored: {why}"
    (run / STATUS).write_text(json.dumps(out, indent=2) + "\n")
    if record:
        record(message)
    return out


def rescore_with_harness(pack: str) -> Rescore:
    def rescore(run: Path, bundle_path: Path, version: str) -> None:
        r = subprocess.run(["uv", "run", "--quiet", str(HARNESS / "rescore.py"), str(run), "--bundle", str(bundle_path),
                            "--pack", pack, "--final"], cwd=HARNESS)
        if r.returncode != 0:
            raise RuntimeError(f"rescore.py exited {r.returncode}")
        if not (run / "rescore" / version / "rescore.json").is_file():
            raise RuntimeError(f"rescore.py wrote no result under {version}")
    return rescore


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run", type=Path)
    ap.add_argument("--pack", default="benchmarks/vidi")
    ap.add_argument("--record", action="store_true", help="commit and push the result with the run's record")
    a = ap.parse_args()
    import drive
    drive.set_pack(a.pack)
    run = a.run.resolve()
    version = subprocess.run([str(HARNESS / "pack-version.sh"), str(drive.PK.dir), drive.PK.name],
                             capture_output=True, text=True).stdout.strip()
    pack_ref = drive.PK.pack_ref or ""

    def record(message: str) -> None:
        res = drive.record_story(drive.REPO_ROOT, run, f"{drive.PK.name} {drive.combination_label(run)} {run.name}: {message}")
        if not res.get("pushed"):
            print(f"finalize: not pushed: {res.get('error', '')}", file=sys.stderr)
    try:
        out = finalize(run, pack_ref, version, rescore_with_harness(a.pack), record if a.record else None)
        print(f"finalize: {out.get('score', out.get('rescore'))} {out.get('reason', '')}".strip())
    except Exception as e:
        print(f"finalize: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
