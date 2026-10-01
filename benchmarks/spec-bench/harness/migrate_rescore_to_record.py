"""migrate_rescore_to_record.py --dry-run|--write [--root DIR] [--built-under VERSION] [run-dir …]

One-off migration (monitor entry A-030, 1 Oct 2026). Some v2 runs ended before finalize.json existed, and have a
full final re-score made by hand under the pack's tag (rescore/<tag>/rescore.json, rescore.py --final) but no
finalize.json, so no score of record. This writes, for each such run, the finalize.json finalize.py would have
written for that re-score. It scores nothing: no machine time, no new re-score, and nothing else in the run changes.

A run is migrated only when all of these hold (anything else is left alone and listed with why):
  - run.json's pack_version is of the pack's tag (finalize_pending.generation), and that tag is MIGRATED_VERSION;
    or, with --built-under VERSION, it is of exactly that earlier version (see below);
  - run-status.json says "finished"; run.json does not mark it invalid;
  - it has no finalize.json, or one that holds nothing but the sweep's "repair" block (SCORELESS_KEYS). What the
    rule protects is a recorded outcome: a score, or a re-score's state, reason, attempts or history, is never
    overwritten, and neither is a file that can't be read or holds anything else. A repair block says only which
    story records the sweep recomputed; it is kept as it is, and the score is written beside it;
  - rescore/<tag>/rescore.json's last result is the run's final checkpoint (finalize.scored_already: the same story,
    and the same commit where the row carries one), the final checkpoint is story FINAL_STORY, the result has no
    harness_fault, and it ran the whole suite (FULL_SUITE_TESTS);
  - finalize.guard (the live-vs-record check) does not flag it. A flagged one is not set aside here: it is listed.

Reused from finalize.py: guard, scored_already, final_checkpoint, last_result, score_of, read_status, write_status,
the status constants. From finalize_pending.py: run_dirs, generation, pack_of, pack_ref, ENDED's "finished".
Not reusable: finalize._keep_scored (it also bundles, scans the agent logs and repairs records, which write to the
run and need the machine's logs) and finalize.scan (it reads the agent logs, kept only on the machine that ran the
run). So the record is put together here from the same fields _keep_scored writes, plus guard, and
outside_workspace is recorded the way finalize.scan records a scan it could not make: ok null, with the reason.
No "repair" is made here: the sweep repairs records on the machine that has their logs. One already recorded stays.

--built-under VERSION is for a run the owner has decided gets its score of record from a re-score under the tag
although it was built while the suite was at an earlier version (its live scores were made under that one). It
applies only to run directories named on the command line, never to a search of the root, and only to a run whose
pack_version is of exactly VERSION; such a run named without the option is left, as before. Every other condition
holds as it does for any run, the guard included (with the live score made under another version, the guard does
not compare the two counts: it says "not comparable"). The record written says so: "built_under", with the version
the run was built under, its recorded pack_version and the version it was scored under.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Callable

import finalize
import finalize_pending

MIGRATED_VERSION = "vidi-v2.0-pre2"   # the only suite these hand-made re-scores were made under
FINAL_STORY = 12                      # vidi v2's last story
FULL_SUITE_TESTS = 75                 # vidi v2's held-out tests at FINAL_STORY
FINISHED = "finished"
MIGRATED_ON = "1 Oct 2026"
MIGRATION_NOTE = (f"made from an existing re-score on {MIGRATED_ON} by migrate_rescore_to_record.py (monitor entry "
                  f"A-030), not a fresh re-score: the run ended before finalize.json existed")
BUILT_UNDER_NOTE = ("built while the suite was at {built}; its score of record is the final re-score under {scored}, "
                    "by the owner's decision for this run")
SCORELESS_KEYS = frozenset({"repair"})   # all a finalize.json may hold and still have no outcome to protect
ABSENT = None                         # prior_status: the run has no finalize.json
NOT_JUDGED = ("not judged: this record was made from an existing re-score by migration, away from the machine "
              "that ran the run, so the agent logs were not read")


def _read(path: Path) -> dict | None:
    try:
        doc = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None


def prior_status(run: Path) -> tuple[bool, dict | None]:
    """(a record may be written, what the run's finalize.json holds now: ABSENT, or its repair-only content).
    Not writable: a finalize.json that can't be read, or that holds anything beside a repair block."""
    path = run / finalize.STATUS
    if not path.exists():
        return True, ABSENT
    doc = _read(path)
    if doc is None or set(doc) != SCORELESS_KEYS or not isinstance(doc["repair"], dict):
        return False, doc
    return True, doc


def unchanged(run: Path, found: dict) -> bool:
    """The run's finalize.json is still what check() saw (absent, or the same repair-only content)."""
    return prior_status(run) == (True, found["prior"])


def discover(root: Path) -> list[Path]:
    return finalize_pending.run_dirs(root)


def check(run: Path, pack_ref_of: Callable[[str], str | None],
          built_under: str | None = None) -> tuple[str | None, dict | None]:
    """(why the run is left alone, None) or (None, {"version", "pack_ref", "guard", "score", "rescored_at", "from",
    "prior", "built_under"}). built_under: the earlier version this run is said to have been built under."""
    run_json = _read(run / "run.json") or {}
    ref = pack_ref_of(finalize_pending.pack_of(run))
    if ref != MIGRATED_VERSION:
        return f"the pack's tag is {ref or 'not set'}, not {MIGRATED_VERSION}", None
    ran = str(run_json.get("pack_version") or "")
    if not ran:
        return "ran under an unrecorded suite version", None
    built = None
    if built_under is not None:
        if finalize_pending.generation(ran) != built_under:
            return f"ran under {ran}, not the named {built_under}", None
        built = {"version": built_under, "pack_version": ran, "scored_under": ref,
                 "note": BUILT_UNDER_NOTE.format(built=built_under, scored=ref)}
    elif finalize_pending.generation(ran) != ref:
        return f"ran under {ran}, not {ref}", None
    state = (_read(run / "run-status.json") or {}).get("state")
    if state != FINISHED:
        return f"not finished (run-status: {state or 'none'})", None
    if run_json.get("invalid"):
        return "marked invalid in run.json", None
    writable, prior = prior_status(run)
    if not writable:
        return f"already has {finalize.STATUS} holding more than a repair block", None
    rj_path = run / "rescore" / ref / "rescore.json"
    rj = _read(rj_path)
    if rj is None:
        return f"no re-score under {ref}", None
    try:
        last = finalize.last_result(run, ref)
    except finalize.Unscored:
        return "its rescore.json holds no result", None
    cp = finalize.final_checkpoint(run)
    if cp is None:
        return "its final checkpoint can't be told from metrics.json", None
    done, stale = finalize.scored_already(run, ref)
    if not done:
        return f"the re-score is not of the run's final build: {stale}", None
    if cp["story"] != FINAL_STORY:
        return f"the run ended at story {cp['story']}, not {FINAL_STORY}", None
    if last.get("harness_fault"):
        return f"the re-score has a harness fault: {finalize.public(last['harness_fault'])}", None
    if last.get("total") != FULL_SUITE_TESTS:
        return f"the re-score ran {last.get('total')} tests, not the whole suite's {FULL_SUITE_TESTS}", None
    check_ = finalize.guard(run, ref)
    if check_["flagged"]:
        return f"guard flagged: {check_['flagged']}", None
    return None, {"version": ref, "pack_ref": ref, "guard": check_, "score": finalize.score_of(run, ref),
                  "rescored_at": rj.get("finished_at"), "from": rj_path.relative_to(run).as_posix(),
                  "prior": prior, "built_under": built}


def record_of(run: Path, found: dict, now: str) -> dict:
    """finalize.json as finalize.py writes it for a run scored under its version (finalize._keep_scored for a run
    scored by hand, with the guard finalize computes for a fresh one), and where it came from."""
    out: dict = {"version": found["version"], "pack_ref": found["pack_ref"], "at": now}
    if (run / finalize.BUNDLE).is_file():
        out["bundle"] = finalize.BUNDLE
    out.update(outside_workspace={"ok": None, "reached": [], "unjudged": [], "error": NOT_JUDGED},
               guard=found["guard"], rescore="done", reason="", score=found["score"],
               reason_kind=finalize.KIND_SCORED, needs_person=False, retries_exhausted=False, attempts=0,
               max_attempts=finalize.MAX_ATTEMPTS, last_attempt_at=None, history=[],
               migrated={"at": now, "from": found["from"], "rescored_at": found["rescored_at"], "note": MIGRATION_NOTE})
    if found["built_under"]:
        out["built_under"] = found["built_under"]
    if found["prior"] is not ABSENT:
        out["repair"] = found["prior"]["repair"]
    return out


def migrate(runs: list[Path], pack_ref_of: Callable[[str], str | None], write: bool,
            now: str | None = None, built_under: str | None = None) -> list[dict]:
    """One row per run: {"run", "eligible", "why", "score", "guard", "built_under"}; with write, each eligible
    run's finalize.json. built_under applies to every run given: the caller names them (main: the command line)."""
    now = now or finalize.stamp()
    rows = []
    for run in runs:
        why, found = check(run, pack_ref_of, built_under)
        row = {"run": run, "eligible": found is not None, "why": why or "", "score": None, "guard": None,
               "built_under": None}
        if found is not None:
            row.update(score=found["score"], guard=found["guard"], built_under=built_under)
            if write:
                if not unchanged(run, found):                # appeared or changed since the check: never overwritten
                    row.update(eligible=False, why=f"its {finalize.STATUS} changed during the check")
                else:
                    finalize.write_status(run, record_of(run, found, now))
        rows.append(row)
    return rows


def _guard_text(g: dict) -> str:
    return (f"live {g['live'] or 'none'} under {g['live_version'] or 'unrecorded'}, "
            f"{'comparable, difference ' + format(g['difference'], '+d') if g['comparable'] else 'not comparable'}, "
            f"flagged: {g['flagged'] or 'no'}")


def main(argv: list[str] | None = None, pack_ref_of: Callable[[str], str | None] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="list what would be written; write nothing")
    mode.add_argument("--write", action="store_true", help="write finalize.json for each eligible run")
    ap.add_argument("--root", type=Path, help="the results root to search (default: the harness's)")
    ap.add_argument("--built-under", metavar="VERSION",
                    help="the earlier suite version the named runs were built under (e.g. vidi-v2.0-pre1); they "
                         "must be named on the command line")
    ap.add_argument("runs", nargs="*", type=Path, help="run directories (default: every run under the root)")
    a = ap.parse_args(argv)
    if a.built_under is not None and not a.runs:
        ap.error("--built-under applies only to runs named on the command line")
    if a.built_under is not None and a.built_under == MIGRATED_VERSION:
        ap.error(f"--built-under names an earlier version than {MIGRATED_VERSION}, the one the re-scores were made under")
    runs = [r.resolve() for r in a.runs] or discover((a.root or finalize_pending.default_root()).resolve())
    rows = migrate(runs, pack_ref_of or finalize_pending.pack_ref, write=a.write, built_under=a.built_under)
    for r in rows:
        if r["eligible"]:
            print(f"eligible  {r['run']}: {r['score']} ({_guard_text(r['guard'])})"
                  + (f", built under {r['built_under']}" if r["built_under"] else "")
                  + (" -> written" if a.write else ""))
    for r in rows:
        if not r["eligible"]:
            print(f"left      {r['run']}: {r['why']}")
    print(f"{sum(r['eligible'] for r in rows)} eligible of {len(rows)}"
          + ("; written" if a.write else "; dry run, nothing written"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
