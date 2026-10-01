# /// script
# requires-python = ">=3.11"
# ///
"""Re-score a finished run's held-out suite under the current pack version, story by story, from
the code the run recorded at the end of each story. The run's own scores are left as they are; the
new ones go to <run>/rescore/<pack-version>/stories/NN/accept.json (private; accept-summary.json beside it is
its public counts), beside a per-story table.

    uv run rescore.py <run-dir> --bundle <workspace.bundle> [--pack benchmarks/vidi]

The suite is the one at the pack's tag (bench.json "pack_ref"), taken from the private repo's git objects and
kept on this machine (tagsuite.py), never the private checkout's working tree: where that checkout is cannot
change the score, and the version recorded is the tag that was scored (rescore.json also has its commit). A
pack without a pack_ref is scored from its working tree, under what pack-version.sh says that is.

Every checkpoint gets two more scorings (no rebuild) of the tests that failed and of a seeded sample of the
tests that passed (PASSING_SAMPLE_FRACTION, PASSING_SAMPLE_MIN), and each rerun test takes its majority
result. The tests whose result changed are listed as flaky, both ways: flaky_failing (failed first) and
flaky_passing (passed first). See SCORINGS_IF_ANY_FAIL and the sampling rule below.

The record's app is installed from the checkpoint's own lockfile with the workspace's package manager
(install). A checkpoint that can't be installed, whose build fails here but passed where the agent worked
(build_fault), or that the machine otherwise spoiled (gates.harness_fault) is a harness fault: no score.
Each result records the scoring environment (scoring_env.py) and the install command.

Each story is scored in its own worktree (no branch: detached at the recorded commit) with its own
dependencies and its own app port. --jobs above 1 runs several at once, but the extra load changes
results (see DEFAULT_JOBS), so official re-scores run one at a time.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
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

import roots  # noqa: E402 - found through the path above

BASE_PORT = 18800
PORTS_PER_JOB = 2          # the app, and the suite's control port right after it
INSTALL_TIMEOUT_S = 900
# One at a time: held-out results are timing-sensitive. Scoring two stories side by side on one Mac
# (canvas-mlx-02 story 7) failed 5 more tests than scoring it alone, keystrokes dropped under load.
DEFAULT_JOBS = 1
TERMINATED = 143   # the usual exit status after SIGTERM
EXIT_NO_SUITE = 4  # the suite at the pack's tag could not be had (tagsuite.SuiteError); nothing was scored


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
                        "processed": [{"id": q["id"], "status": q["status"]} for q in processed[:i + 1]],
                        "live": live_of(rec)})
    return out


def live_of(rec: dict) -> dict:
    """The story's own scoring where the agent worked: its counts, and the exit of its build of this commit (the
    held-out scoring's build, else the gate's)."""
    acc = rec.get("accept") or {}
    build = acc.get("build_exit")
    if build is None:
        build = (((rec.get("gate") or {}).get("steps") or {}).get("build") or {}).get("exit")
    return {"passed": acc.get("passed"), "total": acc.get("total"), "build_exit": build}


SCORINGS_IF_ANY_FAIL = 3   # racy code fails some tests only some of the time; Opus's code scored 74/75 x3

# Flaky tests are re-checked both ways (item 15, 30 Sep 2026). Rerunning only the failures made the record
# lean towards passing: a test passing half the time got two more tries when it failed and none when it passed,
# so it counted as passing 1/2 + 1/2 * 1/4 = 62.5% of the time. A passing test in the sample gets the same
# majority of three as a failing one, so it counts as passing with the chance a majority of three gives
# (exactly 1/2 at p = 1/2; test_rescore._counted_as_passing).
# Why a sample and not every passing test: rerunning all of them is two more full scorings per checkpoint (on
# 75 tests, ~60 of them passing, 120 more test runs where the failures alone need ~30). A fifth of the passing
# tests, at least 5, costs about 25 more on a final checkpoint (13 sampled of 63 passing) and 10 on an early
# one, and it measures what matters: flaky_passing / passing_sampled estimates how many recorded passes are
# flukes. With 6 flaky tests among 63 passing (canvas-mlx-02 had 13 of 75 flaky), a sample of 13 holds one
# 77% of the time, and shows a flip 65% of the time at p = 1/2 (0.75 per sampled flaky test). The floor keeps
# early checkpoints (5-20 passing tests) from sampling one or two. The unsampled passes keep the old lean; set
# the fraction to 1 to remove it everywhere, at the cost above.
# The sample is seeded by the checkpoint's commit: the same code gets the same sample on every re-score.
PASSING_SAMPLE_FRACTION = 0.2
PASSING_SAMPLE_MIN = 5


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


def failed_tests(acc: dict) -> list[tuple[str, int]]:
    """(file, line) of each test that did not pass, for a repeat scoring of just those."""
    return [(t.get("file"), t.get("line")) for t in acc.get("tests", [])
            if t.get("status") not in ("passed", "skipped") and t.get("file") and t.get("line")]


def passing_sample_size(passing: int) -> int:
    return min(passing, max(PASSING_SAMPLE_MIN, math.ceil(PASSING_SAMPLE_FRACTION * passing)))


def repeat_targets(acc: dict, seed: str) -> dict:
    """What the repeat scorings rerun: every test that failed, and a sample of those that passed, seeded (the
    checkpoint's commit) so the same code always gets the same sample. Both as (file, line), in suite order."""
    passing = [(t.get("file"), t.get("line")) for t in acc.get("tests", [])
               if t.get("status") == "passed" and t.get("file") and t.get("line")]
    chosen = set(random.Random(seed).sample(range(len(passing)), passing_sample_size(len(passing))))
    return {"failing": failed_tests(acc), "passing": [p for i, p in enumerate(passing) if i in chosen]}


def overlay(first: dict, rerun: dict) -> dict:
    """A repeat scoring that reran only some tests, completed with the first scoring's other results."""
    again = {(t.get("file"), t.get("title")): t for t in rerun.get("tests", [])}
    tests = [again.get((t.get("file"), t.get("title")), t) for t in first.get("tests", [])]
    applicable = [t for t in tests if t.get("status") != "skipped"]
    return {**first, "tests": tests, "passed": sum(t.get("status") == "passed" for t in applicable),
            "total": len(applicable)}


def majority(accs: list[dict], sampled_passing: int = 0) -> dict:
    """Several scorings of one checkpoint combined: each test takes its most common result, and the
    tests whose result changed between scorings are listed as flaky, and by which way they first went:
    flaky_passing (passed the first time) and flaky_failing (did not). sampled_passing: how many passing
    tests were rerun, so flaky_passing can be read as a share of them."""
    import re
    from collections import Counter
    first = accs[0]
    keyed = [{(t.get("file"), t.get("title")): t for t in a.get("tests", [])} for a in accs]
    tests, flaky, flaky_passing, flaky_failing = [], [], [], []
    for key, t in keyed[0].items():
        statuses = [k[key]["status"] if key in k else "none" for k in keyed]
        status = Counter(statuses).most_common(1)[0][0]
        if len(set(statuses)) > 1:
            flaky.append(f"{key[0]}: {key[1]}")
            (flaky_passing if statuses[0] == "passed" else flaky_failing).append(flaky[-1])
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
            "scores": [a.get("passed") for a in accs], "flaky": flaky, "flaky_passing": flaky_passing,
            "flaky_failing": flaky_failing, "passing_sampled": sampled_passing}


# Phrases of this module's faults that finalize.classify_fault tells them apart by.
NOT_INSTALLED_MARK = "is not installed on this machine"       # the package manager itself is missing
INSTALL_FAULT_MARK = "the app's dependencies didn't install"
BUILD_FAULT_MARK = "the app's build failed in the re-score"

NPM_CI = ["npm", "ci", "--no-audit", "--no-fund"]
# The spec never asks for a clean `npm ci`, and agents do install with --legacy-peer-deps when peers conflict,
# leaving a lockfile a plain `npm ci` refuses. Install as the agent could have; say when it took the fallback.
NPM_CI_FALLBACKS = [NPM_CI, NPM_CI + ["--legacy-peer-deps"]]
ERROR_TAIL_CHARS = 600


# bun has no fallback: its lockfile either installs as committed or it doesn't. (npm's --legacy-peer-deps keeps the
# lockfile's versions and relaxes only the peer check; a plain `bun install` would resolve afresh and score other
# code than the agent committed.)
BUN_INSTALL = [["bun", "install", "--frozen-lockfile"]]
INSTALLS = {"npm": NPM_CI_FALLBACKS, "bun": BUN_INSTALL}
LOCKFILES = {"npm": ("package-lock.json",), "bun": ("bun.lock", "bun.lockb")}
# Lockfiles of package managers the scorer does not run: named in the fault, so it says what the checkpoint had.
OTHER_LOCKFILES = ("pnpm-lock.yaml", "yarn.lock")


def install(ws: Path, run=subprocess.run) -> dict:
    """The checkpoint's dependencies, exactly as its lockfile says, with the workspace's own package manager
    (gates.package_manager): {"ok", "command", "fallback"}, or {"ok": False, "command", "fallback", "error"}.
    No lockfile is no install: the app would be scored with no dependencies, every test failing for a reason
    that is not the app's (until 30 Sep 2026 it was, silently)."""
    import gates
    if not (ws / "package.json").exists():
        return {"ok": False, "command": None, "fallback": False, "error": "the checkpoint has no package.json"}
    pm = gates.package_manager(ws)
    if not any((ws / f).exists() for f in LOCKFILES[pm]):
        others = [f for f in OTHER_LOCKFILES if (ws / f).exists()]
        return {"ok": False, "command": None, "fallback": False,
                "error": f"no {' or '.join(LOCKFILES[pm])} for {pm}: the record installs only from the committed lockfile"
                         + (f" (the checkpoint has {', '.join(others)}, which the scorer does not install)" if others else "")}
    err = ""
    cmds = INSTALLS[pm]
    for i, cmd in enumerate(cmds):
        try:
            r = run(cmd, cwd=ws, capture_output=True, text=True, timeout=INSTALL_TIMEOUT_S)
        except FileNotFoundError:
            return {"ok": False, "command": " ".join(cmd), "fallback": i > 0,
                    "error": f"{cmd[0]} {NOT_INSTALLED_MARK}"}
        except subprocess.TimeoutExpired:
            err = f"`{' '.join(cmd)}` timed out after {INSTALL_TIMEOUT_S}s"
            continue
        if r.returncode == 0:
            return {"ok": True, "command": " ".join(cmd), "fallback": i > 0}
        err = ((r.stderr or "") + (r.stdout or ""))[-ERROR_TAIL_CHARS:]
    return {"ok": False, "command": " ".join(cmds[-1]), "fallback": len(cmds) > 1, "error": err}


def install_fault(inst: dict) -> str | None:
    """A checkpoint whose dependencies didn't install can't be scored: its tests would say nothing about the app."""
    import gates
    return None if inst.get("ok") else f"{gates.SCORING_INTERRUPTED} {INSTALL_FAULT_MARK} ({inst.get('error', '')[-200:]})"


BUILD_TAIL_IN_FAULT = 200


def build_fault(acc: dict, live_build_exit) -> str | None:
    """A build that failed in the re-score, when the live build of the same commit passed (or there is none to
    compare), says nothing about the app: the machine or the clean install differs from where the agent worked
    (Swift 1.5 v2-r2: exit 127, no vite; 0/75 against a live 63/75). A build that failed live too is the app's."""
    import gates
    code = acc.get("build_exit")
    if acc.get("skipped") or code in (0, None) or live_build_exit not in (0, None):
        return None
    where = ("but passed where the agent worked, on the same commit" if live_build_exit == 0
             else "and the run has no live build of this commit to compare")
    tail = (acc.get("build_tail") or "").strip()[-BUILD_TAIL_IN_FAULT:]
    return f"{gates.SCORING_INTERRUPTED} {BUILD_FAULT_MARK} (exit {code}) {where}: {tail}"


def score_checkpoint(ws: Path, cp: dict, sdir: Path, acceptance: Path | None, accept=None, install=None,
                     between=lambda: None) -> dict:
    """One checkpoint in its worktree: install, score, and, unless the machine spoiled it, the repeat scorings
    of the failing tests and a sample of the passing ones, combined by majority. between() runs before each
    repeat (the caller's clean-up of stray processes). accept and install default to gates.accept and this
    module's install, looked up when called."""
    import gates, scoring_env
    accept = accept or gates.accept
    inst = (install or globals()["install"])(ws)
    if fault := install_fault(inst):
        sdir.mkdir(parents=True, exist_ok=True)
        acc = {"skipped": False, "passed": 0, "total": 0, "tests": [], "by_story": {}, "harness_fault": fault,
               "environment": scoring_env.environment(acceptance, gates.scoring_workers())}
    else:
        acc = accept(ws, cp["processed"], sdir, acceptance)
        acc["harness_fault"] = acc.get("harness_fault") or build_fault(acc, (cp.get("live") or {}).get("build_exit"))
    acc["install"] = inst
    if not acc.get("harness_fault"):
        targets = repeat_targets(acc, seed=cp["commit"])
        again = targets["failing"] + targets["passing"]
        if again:
            accs = [acc]
            for n in range(2, SCORINGS_IF_ANY_FAIL + 1):
                between()
                rerun = accept(ws, cp["processed"], sdir / f"scoring-{n}", acceptance, build=False, only=again)
                if rerun.get("harness_fault"):
                    # A repeat the machine spoiled can't vote: the checkpoint's result is incomplete.
                    acc["harness_fault"] = f"{rerun['harness_fault']} (in repeat scoring {n})"
                    break
                accs.append(overlay(acc, rerun))
            else:
                acc = {**majority(accs, sampled_passing=len(targets["passing"])), "sample_seed": cp["commit"]}
    acc["environment"] = {**(acc.get("environment") or {}), "install_command": inst.get("command")}
    return acc


def result_row(story: int, acc: dict, seconds: float) -> dict:
    """A checkpoint's line in rescore.json, which is public: counts and the harness's own words, never a test."""
    return {"story": story, "passed": acc.get("passed"), "total": acc.get("total"),
            "fallbacks": (acc.get("setup_fallbacks") or {}).get("tests", 0),
            "scores": acc.get("scores", [acc.get("passed")]), "flaky": len(acc.get("flaky", [])),
            "flaky_failing": len(acc.get("flaky_failing", [])), "flaky_passing": len(acc.get("flaky_passing", [])),
            "passing_sampled": acc.get("passing_sampled", 0), "harness_fault": acc.get("harness_fault"),
            "build_exit": acc.get("build_exit"), "environment": acc.get("environment"), "seconds": seconds}


def out_dir(run: Path, version: str) -> Path:
    return run / "rescore" / version


PACK_SUITE = "the pack's own"     # _score_one's acceptance: the suite the pack resolves to (drive.PK.acceptance)


def _score_one(cp: dict, base_repo: str, work_root: str, out: str, port: int, pack: str,
               acceptance: str | None = PACK_SUITE) -> dict:
    """One checkpoint: worktree at the recorded commit, its own dependencies, the suite on its own port.
    acceptance: the suite to run (main passes the one at the pack's tag); None for a pack without one."""
    os.environ["ACCEPT_PORT"] = str(port)
    import drive, gates, heldout
    drive.set_pack(pack)
    suite = drive.PK.acceptance if acceptance == PACK_SUITE else (Path(acceptance) if acceptance else None)
    ws = Path(work_root) / f"s{cp['story']:02d}"
    subprocess.run(["git", "-C", base_repo, "worktree", "add", "-q", "--detach", str(ws), cp["commit"]],
                   check=True, capture_output=True)
    t0 = time.time()
    try:
        sdir = Path(out) / "stories" / f"{cp['story']:02d}"
        acc = score_checkpoint(ws, cp, sdir, suite, accept=gates.accept,
                               between=lambda: drive.kill_strays(ws))
        heldout.write_accept(sdir / "accept.json", acc)   # its public summary beside it
        drive.kill_strays(ws)
        # The commit that was scored: finalize tells a score of the run's final build from one of an earlier one.
        return {**result_row(cp["story"], acc, round(time.time() - t0)), "commit": cp["commit"]}
    finally:
        subprocess.run(["git", "-C", base_repo, "worktree", "remove", "--force", str(ws)], capture_output=True)


def progress_line(r: dict) -> str:
    return (f"  story {r['story']}: {r['passed']}/{r['total']} (scorings {r['scores']}, flaky {r['flaky']}: "
            f"{r['flaky_failing']} failed first, {r['flaky_passing']} of {r['passing_sampled']} sampled passes), "
            f"fallbacks {r['fallbacks']}, {r['seconds']}s{'  FAULT ' + r['harness_fault'] if r['harness_fault'] else ''}")



def rescore_record(version: str, workers: int, host_limits: dict, environment: dict, results: list[dict],
                   suite_commit: str | None = None) -> dict:
    """rescore.json, which is public: the machine is named by its hardware (hostenv.host_desc), never its hostname.
    suite_commit: the commit of the pack's tag the suite was taken from (None: the pack's working tree)."""
    import hostenv
    return {
        "pack_version": version, "suite_commit": suite_commit, "harness_commit": roots.harness_commit(),
        "host": hostenv.host_desc(), "held_out_workers": workers, "host_limits": host_limits,
        "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "environment": environment,
        "passing_sample": {"fraction": PASSING_SAMPLE_FRACTION, "min": PASSING_SAMPLE_MIN},
        "results": sorted(results, key=lambda r: r["story"])}

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
    import scoring_tools, tagsuite
    # The tools run.sh had (uv, node, npm, npx), whatever PATH this was started with: for the suite's install, the
    # app's install and build, and the runner.
    tools_env = scoring_tools.environment()
    os.environ.update({k: tools_env[k] for k in scoring_tools.KEPT if k in tools_env})
    try:        # the suite at the pack's tag (built on first use)
        suite = tagsuite.for_pack(drive.PK, env=tools_env)
    except tagsuite.SuiteError as e:
        print(f"rescore: no suite to score with: {e}", file=sys.stderr)
        return EXIT_NO_SUITE
    version = suite.version
    acceptance = str(suite.acceptance) if suite.acceptance else None
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
                r = _score_one(cp, str(base), str(tmp), str(out), BASE_PORT, a.pack, acceptance)
                results.append(r)
                print(progress_line(r), flush=True)
        else:
          with ProcessPoolExecutor(max_workers=a.jobs) as pool:
            futs = {pool.submit(_score_one, cp, str(base), str(tmp), str(out),
                                BASE_PORT + PORTS_PER_JOB * i, a.pack, acceptance): cp for i, cp in enumerate(cps)}
            for f in as_completed(futs):
                r = f.result()
                results.append(r)
                print(progress_line(r), flush=True)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    import heldout, scoring_env
    heldout.save_metrics(out, heldout.load_metrics(run))   # per_story reads the processed order from here
    (out / "rescore.json").write_text(json.dumps(rescore_record(
        version, workers, host, scoring_env.environment(suite.acceptance, workers), results, suite.commit), indent=2))
    import history
    (out / "per-story.md").write_text(history.render_per_story(out))
    print(history.render_per_story(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
