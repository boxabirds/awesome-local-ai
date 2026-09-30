# /// script
# requires-python = ">=3.11"
# ///
"""Re-score a finished run's held-out suite under the current pack version, story by story, from
the code the run recorded at the end of each story. The run's own scores are left as they are; the
new ones go to <run>/rescore/<pack-version>/stories/NN/accept.json (private; accept-summary.json beside it is
its public counts), beside a per-story table.

    uv run rescore.py <run-dir> --bundle <workspace.bundle> [--pack benchmarks/vidi]

A checkpoint with any failing test gets two more scorings of just the tests that failed (no rebuild),
and each test takes its majority result; the tests whose result changed are listed as flaky (racy app
code: see SCORINGS_IF_ANY_FAIL). A test that passed the first time is not rerun.

Each story is scored in its own worktree (no branch: detached at the recorded commit) with its own
dependencies and its own app port. --jobs above 1 runs several at once, but the extra load changes
results (see DEFAULT_JOBS), so official re-scores run one at a time.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
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
TERMINATED = 143   # the usual exit status after SIGTERM


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


SCORINGS_IF_ANY_FAIL = 3   # racy code fails some tests only some of the time; Opus's code scored 74/75 x3


# What one held-out worker (a browser plus its own app server) costs, from the calibration on an
# 8-core, 16 GB Mac (29 Sep 2026); MAX_WORKERS is the most the suite can use (one per test file).
CORES_PER_WORKER = 2
GB_PER_WORKER = 1.5
MAX_WORKERS = 11


def auto_workers(cores: int, free_gb: float) -> int:
    """As many held-out workers as the host's cores and free memory allow, at least one."""
    return max(1, min(cores // CORES_PER_WORKER, int(free_gb // GB_PER_WORKER), MAX_WORKERS))


def host_workers() -> tuple[int, dict]:
    import hostenv
    cores = os.cpu_count() or 1
    free_pct = hostenv.mem_free_pct() or 0.0
    total_gb = _total_memory_gb()
    free_gb = total_gb * free_pct / 100
    return auto_workers(cores, free_gb), {"cores": cores, "memory_gb": round(total_gb, 1), "free_gb": round(free_gb, 1)}


def _total_memory_gb() -> float:
    if sys.platform == "darwin":
        out = subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip()
        return int(out) / 1024 ** 3 if out.isdigit() else 0.0
    for line in open("/proc/meminfo"):
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) / 1024 ** 2
    return 0.0


def needs_repeats(acc: dict) -> bool:
    """Only a checkpoint with a failure can be flaky; a clean one is scored once."""
    return any(t.get("status") not in ("passed", "skipped") for t in acc.get("tests", []))


def failed_tests(acc: dict) -> list[tuple[str, int]]:
    """(file, line) of each test that did not pass, for a repeat scoring of just those."""
    return [(t.get("file"), t.get("line")) for t in acc.get("tests", [])
            if t.get("status") not in ("passed", "skipped") and t.get("file") and t.get("line")]


def overlay(first: dict, rerun: dict) -> dict:
    """A repeat scoring that reran only some tests, completed with the first scoring's other results."""
    again = {(t.get("file"), t.get("title")): t for t in rerun.get("tests", [])}
    tests = [again.get((t.get("file"), t.get("title")), t) for t in first.get("tests", [])]
    applicable = [t for t in tests if t.get("status") != "skipped"]
    return {**first, "tests": tests, "passed": sum(t.get("status") == "passed" for t in applicable),
            "total": len(applicable)}


def majority(accs: list[dict]) -> dict:
    """Several scorings of one checkpoint combined: each test takes its most common result, and the
    tests whose result changed between scorings are listed as flaky."""
    import re
    from collections import Counter
    first = accs[0]
    keyed = [{(t.get("file"), t.get("title")): t for t in a.get("tests", [])} for a in accs]
    tests, flaky = [], []
    for key, t in keyed[0].items():
        statuses = [k[key]["status"] if key in k else "none" for k in keyed]
        status = Counter(statuses).most_common(1)[0][0]
        if len(set(statuses)) > 1:
            flaky.append(f"{key[0]}: {key[1]}")
        tests.append({**t, "status": status, "statuses": statuses})
    applicable = [t for t in tests if t["status"] != "skipped"]
    by_story: dict[str, dict] = {}
    for t in applicable:
        sid = re.search(r"story-(\d+)", t.get("file") or "")
        agg = by_story.setdefault(sid.group(1) if sid else "?", {"passed": 0, "total": 0})
        agg["total"] += 1
        agg["passed"] += t["status"] == "passed"
    return {**first, "passed": sum(t["status"] == "passed" for t in applicable), "total": len(applicable),
            "by_story": by_story, "tests": tests, "scorings": len(accs),
            "scores": [a.get("passed") for a in accs], "flaky": flaky}


NPM_CI = ["npm", "ci", "--no-audit", "--no-fund"]
# The spec never asks for a clean `npm ci`, and agents do install with --legacy-peer-deps when peers conflict,
# leaving a lockfile a plain `npm ci` refuses. Install as the agent could have; say when it took the fallback.
NPM_CI_FALLBACKS = [NPM_CI, NPM_CI + ["--legacy-peer-deps"]]
ERROR_TAIL_CHARS = 600


def install(ws: Path, run=subprocess.run) -> dict:
    """The checkpoint's dependencies from its lockfile: {"ok", "command", "fallback"}, or {"ok": False, "error"}."""
    if not (ws / "package-lock.json").exists():
        return {"ok": True, "command": None, "fallback": False}
    err = ""
    for i, cmd in enumerate(NPM_CI_FALLBACKS):
        r = run(cmd, cwd=ws, capture_output=True, text=True, timeout=NPM_CI_TIMEOUT_S)
        if r.returncode == 0:
            return {"ok": True, "command": " ".join(cmd), "fallback": i > 0}
        err = ((r.stderr or "") + (r.stdout or ""))[-ERROR_TAIL_CHARS:]
    return {"ok": False, "command": " ".join(NPM_CI_FALLBACKS[-1]), "fallback": True, "error": err}


def install_fault(inst: dict) -> str | None:
    """A checkpoint whose dependencies didn't install can't be scored: its tests would say nothing about the app."""
    import gates
    return None if inst.get("ok") else f"{gates.SCORING_INTERRUPTED} the app's dependencies didn't install ({inst.get('error', '')[-200:]})"


def out_dir(run: Path, version: str) -> Path:
    return run / "rescore" / version


def _score_one(cp: dict, base_repo: str, work_root: str, out: str, port: int, pack: str) -> dict:
    """One checkpoint: worktree at the recorded commit, its own dependencies, the suite on its own port."""
    os.environ["ACCEPT_PORT"] = str(port)
    import drive, gates, heldout
    drive.set_pack(pack)
    ws = Path(work_root) / f"s{cp['story']:02d}"
    subprocess.run(["git", "-C", base_repo, "worktree", "add", "-q", "--detach", str(ws), cp["commit"]],
                   check=True, capture_output=True)
    t0 = time.time()
    try:
        inst = install(ws)
        sdir = Path(out) / "stories" / f"{cp['story']:02d}"
        if fault := install_fault(inst):
            sdir.mkdir(parents=True, exist_ok=True)
            acc = {"skipped": False, "passed": 0, "total": 0, "tests": [], "by_story": {}, "harness_fault": fault}
        else:
            acc = gates.accept(ws, cp["processed"], sdir, drive.PK.acceptance)
        acc["install"] = inst
        if needs_repeats(acc) and not acc.get("harness_fault"):
            accs = [acc]
            again = failed_tests(acc)
            for n in range(2, SCORINGS_IF_ANY_FAIL + 1):
                drive.kill_strays(ws)
                rerun = gates.accept(ws, cp["processed"], sdir / f"scoring-{n}", drive.PK.acceptance,
                                     build=False, only=again)
                accs.append(overlay(acc, rerun))
            acc = majority(accs)
        heldout.write_accept(sdir / "accept.json", acc)   # its public summary beside it
        drive.kill_strays(ws)
        return {"story": cp["story"], "passed": acc.get("passed"), "total": acc.get("total"),
                "fallbacks": (acc.get("setup_fallbacks") or {}).get("tests", 0),
                "scores": acc.get("scores", [acc.get("passed")]), "flaky": len(acc.get("flaky", [])),
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
    ap.add_argument("--final", action="store_true", help="only the run's last checkpoint (the headline score)")
    ap.add_argument("--workers", default="auto",
                    help="held-out workers per scoring: a number, or auto (from the host's cores and free memory)")
    a = ap.parse_args()
    # SIGTERM ends the re-score like Ctrl-C, so every scoring's clean-up (its servers, its browsers) runs.
    signal.signal(signal.SIGTERM, lambda signum, frame: sys.exit(TERMINATED))
    import drive
    drive.set_pack(a.pack)
    version = subprocess.run([str(HARNESS / "pack-version.sh"), str(drive.PK.dir), drive.PK.name],
                             capture_output=True, text=True).stdout.strip()
    workers, host = host_workers() if a.workers == "auto" else (int(a.workers), {})
    os.environ["ACCEPT_WORKERS"] = str(workers)
    run = a.run.resolve()
    cps = checkpoints(run)
    if a.final:
        cps = cps[-1:]
    if a.only:
        wanted = {int(x) for x in a.only.split(",")}
        cps = [c for c in cps if c["story"] in wanted]
    out = out_dir(run, version)
    out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="rescore-"))
    base = tmp / "base"
    subprocess.run(["git", "clone", "-q", "--no-checkout", str(a.bundle.resolve()), str(base)], check=True)
    print(f"re-scoring {run.name}: {len(cps)} stories under {version}, {a.jobs} at a time, "
          f"{workers} held-out workers each {host}", flush=True)
    results = []
    try:
        if a.jobs == 1:   # in this process, so the clean-up runs here when the re-score is stopped
            for i, cp in enumerate(cps):
                r = _score_one(cp, str(base), str(tmp), str(out), BASE_PORT, a.pack)
                results.append(r)
                print(f"  story {r['story']}: {r['passed']}/{r['total']} (scorings {r['scores']}, flaky {r['flaky']}), "
                      f"fallbacks {r['fallbacks']}, "
                      f"{r['seconds']}s{'  FAULT ' + r['harness_fault'] if r['harness_fault'] else ''}", flush=True)
        else:
          with ProcessPoolExecutor(max_workers=a.jobs) as pool:
            futs = {pool.submit(_score_one, cp, str(base), str(tmp), str(out),
                                BASE_PORT + PORTS_PER_JOB * i, a.pack): cp for i, cp in enumerate(cps)}
            for f in as_completed(futs):
                r = f.result()
                results.append(r)
                print(f"  story {r['story']}: {r['passed']}/{r['total']} (scorings {r['scores']}, flaky {r['flaky']}), "
                      f"fallbacks {r['fallbacks']}, "
                      f"{r['seconds']}s{'  FAULT ' + r['harness_fault'] if r['harness_fault'] else ''}", flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    import heldout
    heldout.save_metrics(out, heldout.load_metrics(run))   # per_story reads the processed order from here
    (out / "rescore.json").write_text(json.dumps({
        "pack_version": version, "harness_commit": subprocess.run(
            ["git", "-C", str(HARNESS), "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip(),
        "host": os.uname().nodename, "held_out_workers": workers, "host_limits": host, "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "results": sorted(results, key=lambda r: r["story"])}, indent=2))
    import history
    (out / "per-story.md").write_text(history.render_per_story(out))
    print(history.render_per_story(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
