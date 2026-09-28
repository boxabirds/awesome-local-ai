# /// script
# requires-python = ">=3.11"
# ///
"""Re-score a finished run's held-out suite under the current pack version, story by story, from
the code the run recorded at the end of each story. The run's own scores are left as they are; the
new ones go to <run>/rescore/<pack-version>/stories/NN/accept.json, beside a per-story table.

    uv run rescore.py <run-dir> --bundle <workspace.bundle> [--pack benchmarks/vidi]

Each story is scored in its own worktree (no branch: detached at the recorded commit) with its own
dependencies and its own app port. --jobs above 1 runs several at once, but the extra load changes
results (see DEFAULT_JOBS), so official re-scores run one at a time.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

HARNESS = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS))

BASE_PORT = 18800
PORTS_PER_JOB = 2          # the app, and the suite's control port right after it
NPM_CI_TIMEOUT_S = 900
# One at a time: held-out results are timing-sensitive. Scoring two stories side by side on one Mac
# (canvas-mlx-02 story 7) failed 5 more tests than scoring it alone, keystrokes dropped under load.
DEFAULT_JOBS = 1


def checkpoints(run: Path) -> list[dict]:
    """Each processed story with recorded code, in the order the run processed them, and the stories
    processed up to and including it (what the held-out suite scores at that point)."""
    m = json.loads((run / "metrics.json").read_text())
    import drive
    processed = drive.load_processed(m, [{"id": int(k)} for k in sorted(m["stories"], key=int)])
    out = []
    for i, p in enumerate(processed):
        rec = m["stories"].get(str(p["id"])) or {}
        if rec.get("commit"):
            out.append({"story": p["id"], "commit": rec["commit"],
                        "processed": [{"id": q["id"], "status": q["status"]} for q in processed[:i + 1]]})
    return out


def out_dir(run: Path, version: str) -> Path:
    return run / "rescore" / version


def _score_one(cp: dict, base_repo: str, work_root: str, out: str, port: int, pack: str) -> dict:
    """One checkpoint: worktree at the recorded commit, its own dependencies, the suite on its own port."""
    os.environ["ACCEPT_PORT"] = str(port)
    import drive, gates
    drive.set_pack(pack)
    ws = Path(work_root) / f"s{cp['story']:02d}"
    subprocess.run(["git", "-C", base_repo, "worktree", "add", "-q", "--detach", str(ws), cp["commit"]],
                   check=True, capture_output=True)
    t0 = time.time()
    try:
        if (ws / "package-lock.json").exists():
            subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=ws, capture_output=True,
                           timeout=NPM_CI_TIMEOUT_S)
        sdir = Path(out) / "stories" / f"{cp['story']:02d}"
        acc = gates.accept(ws, cp["processed"], sdir, drive.PK.acceptance)
        (sdir / "accept.json").write_text(json.dumps(acc, indent=2))
        drive.kill_strays(ws)
        return {"story": cp["story"], "passed": acc.get("passed"), "total": acc.get("total"),
                "fallbacks": (acc.get("setup_fallbacks") or {}).get("tests", 0),
                "harness_fault": acc.get("harness_fault"), "seconds": round(time.time() - t0)}
    finally:
        subprocess.run(["git", "-C", base_repo, "worktree", "remove", "--force", str(ws)], capture_output=True)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run", type=Path)
    ap.add_argument("--bundle", type=Path, required=True, help="the run's workspace history (git bundle)")
    ap.add_argument("--jobs", type=int, default=DEFAULT_JOBS)
    ap.add_argument("--pack", default="benchmarks/vidi")
    ap.add_argument("--only", help="comma list of story ids (a partial re-score, e.g. to check the tool)")
    a = ap.parse_args()
    import drive
    drive.set_pack(a.pack)
    version = subprocess.run([str(HARNESS / "pack-version.sh"), str(drive.PK.dir), drive.PK.name],
                             capture_output=True, text=True).stdout.strip()
    run = a.run.resolve()
    cps = checkpoints(run)
    if a.only:
        wanted = {int(x) for x in a.only.split(",")}
        cps = [c for c in cps if c["story"] in wanted]
    out = out_dir(run, version)
    out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="rescore-"))
    base = tmp / "base"
    subprocess.run(["git", "clone", "-q", "--no-checkout", str(a.bundle.resolve()), str(base)], check=True)
    print(f"re-scoring {run.name}: {len(cps)} stories under {version}, {a.jobs} at a time", flush=True)
    results = []
    try:
        with ProcessPoolExecutor(max_workers=a.jobs) as pool:
            futs = {pool.submit(_score_one, cp, str(base), str(tmp), str(out),
                                BASE_PORT + PORTS_PER_JOB * i, a.pack): cp for i, cp in enumerate(cps)}
            for f in as_completed(futs):
                r = f.result()
                results.append(r)
                print(f"  story {r['story']}: {r['passed']}/{r['total']}, fallbacks {r['fallbacks']}, "
                      f"{r['seconds']}s{'  FAULT ' + r['harness_fault'] if r['harness_fault'] else ''}", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    shutil.copy(run / "metrics.json", out / "metrics.json")   # per_story reads the processed order from here
    (out / "rescore.json").write_text(json.dumps({
        "pack_version": version, "harness_commit": subprocess.run(
            ["git", "-C", str(HARNESS), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip(),
        "host": os.uname().nodename, "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": sorted(results, key=lambda r: r["story"])}, indent=2))
    import history
    (out / "per-story.md").write_text(history.render_per_story(out))
    print(history.render_per_story(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
