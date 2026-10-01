# /// script
# requires-python = ">=3.11"
# ///
"""finalize_pending.py [--record] [--list] [--even-if-busy] [--limit N] [--budget-s S] [--exclude RUN_DIR] [--root DIR]

The sweep: every run on this machine that ended without its score of record gets another try, with nobody asking.
run.sh calls it at the start of every run (after the self-test, before the model server: the machine is free
then) and again at the end, after its own finalize. An operator can run it by hand; --list only shows what it
would do and what is waiting for a person.

What it does for each run it picks, through finalize.py: bundle the workspace if its work dir is still there,
re-score the final build under the pack's tag, repair stale records, and (--record) commit and push the result.

Which runs (survey): under the results root (roots.py), with
  - run-status.json saying the run ended: finished, failed or stopped. A failed or stopped run still has a final
    build, and its score is of the stories it processed, as its live scores are; if it is resumed later, finalize
    sees that the score is of an earlier checkpoint and scores the final one. A run still "started" is left: it
    may be running, or about to be resumed;
  - at least one story with recorded code, and a work_dir.txt (it ran on this machine: only here are its work
    dir and full logs);
  - not marked "invalid" in run.json, and not the run that is starting (--exclude);
  - no score of record (finalize.json absent, or its rescore not "done") and needs_person not true, for a run
    that ran under the pack's current tag (a run made under another tag is not re-scored under this one unasked);
  - or: stories whose time accounting is stale or failed its check, with their full logs here, that this harness
    (commit and accounting version) has not already recomputed.

Bounds, so a run is never held up or failed by it:
  - most recently ended first, at most SWEEP_MAX_RUNS runs a sweep; the rest wait for the next one;
  - a time budget (SWEEP_BUDGET_S): a re-score starts only with RESCORE_RESERVE_S of it left and is stopped when
    it is spent (not an attempt); HARD_STOP_GRACE_S after it the sweep ends whatever it is doing;
  - it refuses while another harness run or re-score is active on the machine (a re-score shares the machine
    with whatever is being measured), unless --even-if-busy; and only one sweep runs at a time;
  - it always exits 0. A run it could not handle has the reason in its finalize.json, as an attempt.

Tests: test_finalize_pending.py; test_pipeline.py leaves a run unscored and has the next start score it.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import functools
import json
import math
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

HARNESS = Path(__file__).resolve().parent
sys.path.insert(0, str(HARNESS))

import finalize  # noqa: E402 - found through the path above; standard library only until it is used
import scoring_tools  # noqa: E402

# Runs handled per sweep. A sweep runs twice per run of the machine, so a backlog of any size clears three runs
# at a time without one start paying for all of it.
SWEEP_MAX_RUNS = 3
# How long a sweep may take: the most a run's start is held up. The final re-scores recorded under the v2 suite
# (rescore.json "seconds", 13 runs on four machines up to 1 Oct 2026) took 42 to 412 s; RESCORE_RESERVE_S is above
# the longest, and a re-score is started only with that much of the budget left, so one that starts normally ends.
SWEEP_BUDGET_S = 900
RESCORE_RESERVE_S = 450
HARD_STOP_GRACE_S = 60          # past the budget, for a step that isn't a re-score (a bundle, a commit and push)
ENDED = ("finished", "failed", "stopped")
SCORE, REPAIR = "score", "repair"
LOCK = "sweep.lock"
# Another run, or another re-score, on this machine: these scripts under python or uv, and the harness's run.sh.
BUSY_SCRIPTS = ("drive.py", "rescore.py", "finalize.py")
RUN_SH = "spec-bench/harness/run.sh"
SHELLS = ("bash", "sh")
PS = ["ps", "-axo", "pid=,ppid=,command="]
PS_TIMEOUT_S = 30
RUN_PARENTS = ("combinations", "benchmarks/reference")


class OutOfTime(BaseException):
    """The sweep's hard stop. Not an Exception: no step's own error handling may swallow it."""


def default_root() -> Path:
    """The results root (roots.py): the checkout of main, also when the harness runs from a release's directory.
    roots is loaded here, not with this module: a release with no results root stops as it loads, and the sweep
    reports that like any other failure instead of dying on it."""
    import roots
    return roots.RESULTS_ROOT


def this_harness() -> str:
    import roots
    return roots.harness_commit()


def _read(path: Path) -> dict:
    try:
        doc = json.loads(path.read_text())
    except OSError:
        return {}
    return doc if isinstance(doc, dict) else {}


def run_dirs(root: Path) -> list[Path]:
    """Every run's directory under the results root: combinations/<…>/benchmarks/<pack>/<run> and
    benchmarks/reference/<pack>/<stack>/<run>. Nothing inside a run is searched."""
    found = []
    for top, dirs, _ in os.walk(root / "combinations"):
        if "benchmarks" in dirs:
            found += [r for p in sorted((Path(top) / "benchmarks").iterdir()) if p.is_dir()
                      for r in sorted(p.iterdir()) if r.is_dir()]
            dirs.remove("benchmarks")
    ref = root / "benchmarks" / "reference"
    if ref.is_dir():
        found += [r for r in sorted(ref.glob("*/*/*")) if r.is_dir()]
    return found


def generation(pack_version: str) -> str:
    """The tag a run's pack version is of: "kat-v1+28ace8b-dirty" and "kat-v1-dirty" are kat-v1's."""
    return pack_version.split("+")[0].removesuffix("-dirty")


def pack_of(run: Path) -> str:
    """The pack a run is of: run.json's "pack", else (runs from before run.json named it) its place in the results
    root: combinations/<…>/benchmarks/<pack>/<run>, benchmarks/reference/<pack>/<stack>/<run>."""
    named = _read(run / "run.json").get("pack")
    if named:
        return str(named)
    return run.parents[1].name if run.parents[2].name == "reference" else run.parent.name


def why(run: Path, pack_ref_of: Callable[[str], str | None], harness_commit: str) -> tuple[str | None, str]:
    """(SCORE, REPAIR or None, the reason) for one run directory."""
    state = _read(run / "run-status.json").get("state")
    if state not in ENDED:
        return None, f"not ended (run-status: {state or 'none'})"
    run_json = _read(run / "run.json")
    if run_json.get("invalid"):
        return None, "marked invalid in run.json"
    if not (run / "work_dir.txt").is_file():
        return None, "did not run on this machine (no work_dir.txt)"
    metrics = json.loads((run / "metrics.json").read_text()) if (run / "metrics.json").is_file() else {}
    if not any(isinstance(rec, dict) and rec.get("commit") for rec in (metrics.get("stories") or {}).values()):
        return None, "no story recorded any code"
    fin = finalize.read_status(run)
    stale = finalize.needing_repair(metrics)
    fixable = [sid for sid in stale if finalize.raw_log(run, sid).is_file()]
    tried = fin.get("repair") or {}
    import accounting
    if fixable and tried.get("harness_commit") == harness_commit and tried.get("accounting_version") == accounting.VERSION \
            and all(sid in (tried.get("left") or {}) for sid in fixable):
        fixable = []                # this harness already recomputed them, and they stayed as they are
    repair = (REPAIR, f"stale records with their full logs here: stories {', '.join(fixable)}") if fixable else None
    if fin.get("rescore") == "done":
        return repair or (None, f"scored: {fin.get('score')} under {fin.get('version')}")
    if fin.get("needs_person") is True:
        return repair or (None, f"needs a person: {fin.get('reason')}")
    ref = pack_ref_of(pack_of(run))
    ran = str(run_json.get("pack_version") or "")
    if ref and not ran:
        return repair or (None, "ran under an unrecorded suite version")
    if ref and generation(ran) != ref:
        return repair or (None, f"ran under {ran}, not the pack's {ref}")
    return SCORE, fin.get("reason") or "never finalized"


def survey(root: Path, pack_ref_of: Callable[[str], str | None], harness_commit: str,
           exclude: list[Path] | tuple = ()) -> list[tuple[Path, str | None, str]]:
    """Every run under the root with what the sweep would do for it and why, the most recently ended first."""
    excluded = {Path(p).resolve() for p in exclude}
    rows = []
    for run in run_dirs(root):
        if run.resolve() in excluded:
            continue
        try:
            action, reason = why(run, pack_ref_of, harness_commit)
        except (Exception, SystemExit) as e:
            action, reason = None, finalize.public(f"its records can't be read: {type(e).__name__}: {e}")
        rows.append((str(_read(run / "run-status.json").get("at") or ""), run, action, reason))
    rows.sort(key=lambda r: r[0], reverse=True)
    return [(run, action, reason) for _, run, action, reason in rows]


def pending(root: Path, pack_ref_of: Callable[[str], str | None], harness_commit: str,
            exclude: list[Path] | tuple = ()) -> list[tuple[Path, str, str]]:
    return [row for row in survey(root, pack_ref_of, harness_commit, exclude) if row[1] is not None]


# ---------- is the machine busy ----------

def harness_processes(ps_text: str, own_pid: int) -> list[str]:
    """The lines of `ps -axo pid=,ppid=,command=` that are another harness run or re-score: not this process, not
    what started it (the run.sh that called the sweep), not what it started."""
    rows = []
    for line in ps_text.splitlines():
        parts = line.split(None, 2)
        if len(parts) == 3 and parts[0].isdigit() and parts[1].isdigit():
            rows.append((int(parts[0]), int(parts[1]), parts[2], line.strip()))
    parent = {pid: ppid for pid, ppid, _, _ in rows}

    def lineage(pid: int) -> set[int]:
        seen = set()
        while pid in parent and pid not in seen:
            seen.add(pid)
            pid = parent[pid]
        return seen
    mine = lineage(own_pid) | {own_pid}
    found = []
    for pid, _, cmd, line in rows:
        if pid in mine or own_pid in lineage(pid):
            continue
        argv = cmd.split()
        prog = os.path.basename(argv[0])
        script = (prog.startswith("python") or prog == "uv") and any(os.path.basename(a) in BUSY_SCRIPTS for a in argv[1:])
        run_sh = prog in SHELLS and len(argv) > 1 and argv[1].endswith(RUN_SH) or argv[0].endswith(RUN_SH)
        if script or run_sh:
            found.append(line)
    return found


def busy() -> list[str]:
    """Other harness runs or re-scores active on this machine now. If that can't be told, it says so, and the
    sweep waits: a re-score must not land on a benchmark."""
    try:
        out = subprocess.run(PS, capture_output=True, text=True, timeout=PS_TIMEOUT_S)
    except (OSError, subprocess.SubprocessError) as e:
        return [f"the machine's processes could not be listed ({type(e).__name__})"]
    if out.returncode != 0:
        return [f"the machine's processes could not be listed (ps exit {out.returncode})"]
    return harness_processes(out.stdout, os.getpid())


# ---------- the sweep ----------

@functools.lru_cache(maxsize=None)
def pack_ref(name: str) -> str | None:
    return finalize.load_pack(f"benchmarks/{name}").pack_ref


def finalize_one(run: Path, pack: str, record: bool, timeout_s: float, action: str) -> dict:
    if action == REPAIR:
        return finalize.repair_run(run, pack, record)
    return finalize.finalize_run(run, pack, record, timeout_s)


def _label(run: Path, root: Path) -> str:
    try:
        return run.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return run.name


def sweep(root: Path, pack_ref_of: Callable[[str], str | None] | None = None, harness_commit: str | None = None,
          record: bool = False, limit: int = SWEEP_MAX_RUNS, budget_s: float = SWEEP_BUDGET_S,
          even_if_busy: bool = False, exclude: list[Path] | tuple = (), busy: Callable[[], list[str]] | None = None,
          finalize_one: Callable | None = None, clock: Callable[[], float] = time.monotonic,
          log: Callable[[str], None] = print) -> dict:
    """Handle what is pending, within the cap and the budget. {"handled": [(run name, outcome)], "left": how many
    are still pending, "stopped": why it stopped early (or None)}."""
    busy = busy or globals()["busy"]
    finalize_one = finalize_one or globals()["finalize_one"]
    harness_commit = this_harness() if harness_commit is None else harness_commit
    deadline = clock() + budget_s
    todo = pending(root, pack_ref_of or pack_ref, harness_commit, exclude)
    handled: list[tuple[str, str]] = []
    stopped = None
    for run, action, reason in todo:
        if len(handled) >= limit:
            stopped = f"the cap of {limit} runs a sweep"
            break
        if not even_if_busy and (others := busy()):
            stopped = f"another harness run is active on this machine: {finalize.public(others[0])}"
            break
        remaining = deadline - clock()
        if remaining <= 0 or (action == SCORE and remaining < min(RESCORE_RESERVE_S, budget_s)):
            stopped = f"the time budget of {int(budget_s)}s"
            break
        log(f"finalize_pending: {_label(run, root)}: {action} ({reason})")
        try:
            out = finalize_one(run, f"benchmarks/{pack_of(run)}", record, remaining, action) or {}
            outcome = "repaired" if action == REPAIR else str(out.get("score") and "done" or out.get("rescore") or "?")
            log(f"finalize_pending: {_label(run, root)}: {out.get('score') or out.get('rescore') or outcome} {out.get('reason') or ''}".rstrip())
        except (Exception, SystemExit) as e:
            outcome = "failed"
            log(f"finalize_pending: {_label(run, root)}: {type(e).__name__}: {e}")
            finalize.note_failure(run, f"the sweep could not finalize it: {type(e).__name__}: {e}")
        handled.append((run.name, outcome))
    left = len(todo) - len(handled)
    if stopped:
        log(f"finalize_pending: stopped at {stopped}; {left} left for the next sweep")
    return {"handled": handled, "left": left, "stopped": stopped}


@contextlib.contextmanager
def exclusive():
    """True for the one sweep that may run on this machine now; False while another holds the lock."""
    home = scoring_tools.home()
    home.mkdir(parents=True, exist_ok=True)
    with open(home / LOCK, "w") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


@contextlib.contextmanager
def hard_stop(seconds: float):
    """Raise OutOfTime in this process after `seconds`, and when it is told to end (SIGTERM): a re-score in
    progress is stopped on the way out (finalize.run_bounded), never left running."""
    def out_of_time(signum, frame):
        raise OutOfTime("ended" if signum == signal.SIGTERM else "time")
    try:
        before = {s: signal.signal(s, out_of_time) for s in (signal.SIGALRM, signal.SIGTERM)}
    except ValueError:              # not the main thread: no alarm; the budget's own checks still apply
        yield
        return
    signal.alarm(max(1, math.ceil(seconds)))
    try:
        yield
    finally:
        signal.alarm(0)
        for s, handler in before.items():
            signal.signal(s, handler)


def show(root: Path, exclude: list[Path]) -> None:
    rows = survey(root, pack_ref, this_harness(), exclude)
    shown = [(run, action or "needs a person", reason.removeprefix("needs a person: ")) for run, action, reason in rows
             if action is not None or reason.startswith("needs a person")]
    for run, what, reason in shown:
        print(f"{_label(run, root)}\t{what}\t{reason}")
    if not shown:
        print(f"finalize_pending: nothing pending under the results root ({len(rows)} runs)")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--record", action="store_true", help="commit and push each result with its run's record")
    ap.add_argument("--list", action="store_true", help="show what is pending and what needs a person; change nothing")
    ap.add_argument("--even-if-busy", action="store_true", help="sweep although another harness run is active")
    ap.add_argument("--limit", type=int, default=SWEEP_MAX_RUNS, help="runs handled this sweep")
    ap.add_argument("--budget-s", type=float, default=SWEEP_BUDGET_S, help="seconds the sweep may take")
    ap.add_argument("--exclude", type=Path, action="append", default=[], help="a run to leave out (the one starting)")
    ap.add_argument("--root", type=Path, help="the results root to sweep (default: roots.py's)")
    a = ap.parse_args(argv)
    try:
        root = (a.root or default_root()).resolve()
        if a.list:
            show(root, a.exclude)
            return 0
        with exclusive() as mine:
            if not mine:
                print("finalize_pending: another sweep is running on this machine; leaving it to that one")
                return 0
            with hard_stop(a.budget_s + HARD_STOP_GRACE_S):
                out = sweep(root, record=a.record, limit=a.limit, budget_s=a.budget_s, even_if_busy=a.even_if_busy,
                            exclude=a.exclude)
            if not out["handled"] and not out["stopped"]:
                print("finalize_pending: nothing pending")
    except OutOfTime as e:
        print("finalize_pending: " + ("told to end; stopped" if str(e) == "ended"
                                      else "stopped at the time budget; the rest is left for the next sweep"))
    except (Exception, SystemExit) as e:    # never the caller's problem: run.sh goes on
        print(f"finalize_pending: {type(e).__name__}: {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
