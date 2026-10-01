"""finalize.py <run-dir> [--pack benchmarks/vidi] [--record]

At the end of a run: save the workspace's history as <run-dir>/workspace.bundle (the review page builds
each story from it), bring the run's own records up to date, then re-score the final build with the held-out suite
(rescore.py --final), so a finished run has its score of record and can be judged without anyone doing it by hand.
finalize_pending.py runs the same thing later for every run that ended without one.

The suite is the one at the pack's tag (pack_ref), taken from the private repo itself (tagsuite.py): where that
checkout happens to be doesn't matter, and the version recorded is the tag that was scored. The re-score finds
uv, node, npm and npx on the PATH run.sh had (scoring_tools.py), whatever PATH this process was given.

A re-score is recorded only if it passes the live-vs-record guard (guard): a final score more than
DIVERGENCE_TESTS away from the run's own live score of the same code under the same suite version, or one whose
failures all share one cause across stories when the live scoring can't vouch for it, is set aside with the reason
(rescore-spoiled/, like a re-score the machine spoiled) and the record says the run is unscored, with its live score.

Records first (repair_records): a story whose time accounting was made by an older accounting.VERSION, failed its
check, or has no time split or conversation profile is recomputed from the machine's full logs
(backfill_timing.backfill_all), before the run is recorded. A repair that fails is noted and nothing else stops.

Every outcome says whether a person is needed (finalize.json: needs_person, reason, reason_kind, attempts,
last_attempt_at, history). Whatever trying again can change is retried by finalize_pending.py, up to MAX_ATTEMPTS:
a tool not on PATH, the suite's tag not fetched yet, a re-score the machine spoiled or the guard flagged, a harness
that failed to load. needs_person is true only for what will not change: no bundle and no work dir left, a build
that fails from a clean clone, a tag that doesn't exist, nothing to score, or MAX_ATTEMPTS failures in a row.

A run already scored under the version, at its final checkpoint, is left alone (its records are still repaired).
With --record the result is committed and pushed with the run's record, through drive.record_story like every
story: the re-score's held-out results go to the private repo and only their summaries to this one. Never fails
the caller: problems are reported, and written to finalize.json.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable

HARNESS = Path(__file__).resolve().parent
BUNDLE = "workspace.bundle"
STATUS = "finalize.json"
SPOILED = "rescore-spoiled"
SET_ASIDE = "set-aside.json"          # beside a set-aside re-score: why it was not recorded
RAW_LOG = "agent-events.jsonl"        # a story's full log, kept only on the machine that ran it

# The live-vs-record guard. The score of record re-scores the final commit on a clean install, often on another
# machine; where the live scoring of the same code ran under the same suite version, the two should agree. On
# the v2 records they agree test for test on 4 of 5 runs, and the fifth differs by one test (the scorer's OS,
# methods review C3), while both scoring faults of 30 Sep 2026 differed by 63. A difference of more than 3 tests
# is not the variation of the same code between machines: it is the scoring. (Run-to-run variation, 5-9 tests,
# is between different code and doesn't apply.)
DIVERGENCE_TESTS = 3
# Every failure with one cause (the app server never answering, one missing module) is the machine's signature
# when it spans stories: a story whose feature is missing fails its own tests one way, and that is a finding.
# Below five failures a shared first line is too common to mean anything (two timeouts look alike).
MIN_SIGNATURE_FAILURES = 5
MIN_SIGNATURE_STORIES = 2
STORY_FILE = re.compile(r"story-(\d+)")

Rescore = Callable[[Path, Path, str], None]
REASON_CHARS = 300
# How many times a retryable failure is tried before it needs a person. Each attempt is a full final re-score, and
# the sweep (finalize_pending.py) makes at most one per run each time it runs, at the start and the end of every
# run on the machine: five failures are spread over at least three runs' starts and ends, which is long enough for
# a passing cause (a busy port, a network error, a tool missing from one shell) to pass, and short enough that a
# cause that does not pass reaches a person with its history instead of being retried for ever.
MAX_ATTEMPTS = 5
HISTORY_KEPT = 2 * MAX_ATTEMPTS       # attempts kept in finalize.json, the newest last
TERM_GRACE_S = 30                     # between SIGTERM and SIGKILL for a re-score that ran out of time

# finalize.json "reason_kind": the outcome as one word a page can switch on. tagsuite.py adds its own
# (suite_tag_missing, suite_not_in_tag, suite_not_in_git, suite_fetch_failed, suite_unavailable, suite_install_failed).
KIND_SCORED = "scored"
KIND_FLAGGED = "flagged"                               # the guard set the re-score aside
KIND_SPOILED = "scoring_spoiled"                       # the machine spoiled it (runner crashed, port held, …)
KIND_TOOL_MISSING = "tool_missing"                     # uv, node, npm or npx not found
KIND_INSTALL_FAILED = "install_failed"                 # the app's dependencies didn't install this time
KIND_RESCORE_FAILED = "rescore_failed"                 # rescore.py itself failed
KIND_HARNESS_FAILED = "harness_failed"                 # finalize could not run at all (the harness didn't load)
KIND_OUT_OF_TIME = "out_of_time"                       # stopped at the sweep's time budget; not an attempt
KIND_BUILD_FAILS_CLEAN = "build_fails_from_clean_clone"  # a result: passes where the agent worked, not from a clean clone
KIND_NO_BUNDLE = "no_bundle"                           # no workspace.bundle and no work dir to make one from
KIND_NOTHING_TO_SCORE = "nothing_to_score"             # no story recorded any code


class Unscored(Exception):
    """Why a re-score produced no score. needs_person: trying again will not change it. counted: it was an
    attempt (a re-score stopped for time was not)."""
    def __init__(self, kind: str, reason: str, needs_person: bool = False, counted: bool = True):
        super().__init__(reason)
        self.kind, self.needs_person, self.counted = kind, needs_person, counted


def public(text) -> str:
    """A reason as it may be published: one line, no path of this machine's home, at most REASON_CHARS."""
    return " ".join(str(text).replace(str(Path.home()), "~").split())[:REASON_CHARS]


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def read_status(run: Path) -> dict:
    try:
        doc = json.loads((run / STATUS).read_text())
    except (OSError, ValueError):
        return {}
    return doc if isinstance(doc, dict) else {}


def write_status(run: Path, status: dict) -> None:
    (run / STATUS).write_text(json.dumps(status, indent=2) + "\n")


def ensure_bundle(run: Path) -> None:
    """The workspace's history as the run's bundle: made afresh while the work dir is still there, else the one
    the run already has. Neither is the end of it: there is nothing left to score."""
    try:
        work = Path((run / "work_dir.txt").read_text().strip()).expanduser()
    except OSError:
        work = None
    if work is not None and (work / "workspace" / ".git").exists():
        bundle(work / "workspace", run / BUNDLE)
    elif not (run / BUNDLE).is_file():
        raise Unscored(KIND_NO_BUNDLE, "the run has no workspace.bundle and its work directory is gone from this "
                                       "machine: there is no code left to score", needs_person=True)


def bundle(workspace: Path, dest: Path) -> None:
    subprocess.run(["git", "-C", str(workspace), "bundle", "create", str(dest), "--all"],
                   check=True, capture_output=True, text=True)


def score_of(run: Path, version: str) -> str:
    """The final checkpoint's result as "passed/total", from rescore.py's rescore.json."""
    last = json.loads((run / "rescore" / version / "rescore.json").read_text())["results"][-1]
    return f"{last['passed']}/{last['total']}"


def last_result(run: Path, version: str) -> dict:
    """The final checkpoint's line in rescore.json. A re-score with no line at all scored nothing: the run
    recorded no code."""
    results = json.loads((run / "rescore" / version / "rescore.json").read_text()).get("results") or []
    if not results:
        raise Unscored(KIND_NOTHING_TO_SCORE, "no story of the run recorded any code to score", needs_person=True)
    return results[-1]


def fault_of(run: Path, version: str) -> str | None:
    """Why the re-score says nothing about the app (the machine spoiled it), if it does."""
    return last_result(run, version).get("harness_fault")


def set_aside(run: Path, version: str, reason: str | None = None) -> None:
    """Move a spoiled or flagged re-score out of the way, with why: the page doesn't read it, and the next finalize
    tries again."""
    dest = run / SPOILED / f"{version}-{time.strftime('%Y%m%dT%H%M%S', time.gmtime())}"
    dest.parent.mkdir(exist_ok=True)
    (run / "rescore" / version).rename(dest)
    if reason:
        (dest / SET_ASIDE).write_text(json.dumps({"reason": reason, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())},
                                                 indent=2) + "\n")


def shared_cause(tests: list[dict]) -> str | None:
    """The one error signature every failing test shares, if there are enough of them across enough stories to
    call it one cause (MIN_SIGNATURE_FAILURES, MIN_SIGNATURE_STORIES); else None."""
    import gates
    sig, failures = gates.shared_signature(tests)
    failing = [t for t in tests if t.get("status") not in gates.FAILED_STATUSES_EXCLUDE]
    stories = {m.group(1) for t in failing if (m := STORY_FILE.search(t.get("file") or ""))}
    if sig is None or failures < MIN_SIGNATURE_FAILURES or len(stories) < MIN_SIGNATURE_STORIES:
        return None
    return sig


def live_version(run: Path, rec: dict) -> str | None:
    """The suite version the story was live-scored under: its own record's, else run.json's (rewritten at each
    start, so the latest start's)."""
    if rec.get("pack_version"):
        return rec["pack_version"]
    try:
        return json.loads((run / "run.json").read_text()).get("pack_version") or None
    except (OSError, json.JSONDecodeError):
        return None


def guard(run: Path, version: str) -> dict:
    """The final re-score checked against the run's own live score of the same checkpoint. Public (it goes into
    finalize.json): counts, versions and the rule's verdict, never a test or its error text.

    Flagged (why, in "flagged") when, with the live score comparable (same suite version, or unknown):
      - the passed counts differ by more than DIVERGENCE_TESTS, or the re-score ran a different number of tests;
    or, either way:
      - every failure shares one error signature across stories (shared_cause), unless the live scoring's failures
        share the same one (the app fails that way wherever it runs);
      - the re-score's test detail is missing, so the above can't be checked."""
    import heldout
    last = json.loads((run / "rescore" / version / "rescore.json").read_text())["results"][-1]
    story = int(last["story"])
    rec = (heldout.load_metrics(run).get("stories") or {}).get(str(story)) or {}
    live = rec.get("accept") if isinstance(rec.get("accept"), dict) and not rec["accept"].get("skipped") else None
    lv = live_version(run, rec)
    comparable = live is not None and live.get("passed") is not None and lv in (None, version)
    out = {"story": story, "record": f"{last['passed']}/{last['total']}",
           "live": f"{live['passed']}/{live['total']}" if live and live.get("passed") is not None else None,
           "live_version": lv, "comparable": comparable, "threshold": DIVERGENCE_TESTS,
           "difference": (last["passed"] - live["passed"]) if comparable else None,
           "failures": None, "one_signature": None, "live_same_signature": None, "flagged": None}
    reasons = []
    if comparable:
        if abs(out["difference"]) > DIVERGENCE_TESTS:
            reasons.append(f"the re-score ({out['record']}) differs from the live score of the same code "
                           f"({out['live']} under {lv or 'an unrecorded suite version'}) by {abs(out['difference'])} "
                           f"tests, more than {DIVERGENCE_TESTS}")
        if live.get("total") is not None and last["total"] != live["total"]:
            reasons.append(f"the re-score ran {last['total']} tests where the live scoring ran {live['total']}")
    detail = heldout.read_json(run / "rescore" / version, f"stories/{story:02d}/accept.json")
    if detail is None:
        reasons.append("the re-score left no test detail to check for a shared cause")
    else:
        tests = detail.get("tests") or []
        out["failures"] = sum(t.get("status") not in ("passed", "skipped") for t in tests)
        cause = shared_cause(tests)
        out["one_signature"] = cause is not None
        if cause is not None:
            live_detail = heldout.read_json(run, f"stories/{story:02d}/accept.json") if comparable else None
            live_cause = shared_cause((live_detail or {}).get("tests") or [])
            out["live_same_signature"] = live_cause == cause
            if live_cause != cause:
                reasons.append(f"all {out['failures']} failures share one error signature across stories, and the "
                               f"live scoring of the same code {'did not fail that way' if comparable else 'cannot vouch for it (not comparable)'}")
    out["flagged"] = "; ".join(reasons) or None
    return out


def scan(run: Path) -> dict:
    """contain(), never fatal: a scan that crashes is recorded as unjudged and the run is still scored."""
    try:
        return contain(run)
    except (Exception, SystemExit) as e:
        return {"ok": None, "reached": [], "unjudged": [], "error": public(f"{type(e).__name__}: {e}")}


def contain(run: Path) -> dict:
    """Each story's containment verdict (logscan.py: did its agent reach outside its workspace for anything that
    could give it answers?), recorded in metrics.json per story, and the run's summary. It runs here, on the
    machine that ran the stories, where their full logs still are."""
    import heldout
    import logscan
    verdicts = logscan.scan_run(run)                       # {"07": verdict}; metrics.json keys stories "7"
    metrics = heldout.load_metrics(run)
    stories = metrics.get("stories") or {}
    for sid, verdict in verdicts.items():
        if (rec := stories.get(str(int(sid)))) is not None:
            rec["outside_workspace"] = verdict   # not "containment": that is the systemd scope record
    if stories:
        heldout.save_metrics(run, metrics)
    return {"ok": all(v["ok"] is not False for v in verdicts.values()),
            "reached": sorted(s for s, v in verdicts.items() if v["ok"] is False),
            "unjudged": sorted(s for s, v in verdicts.items() if v["ok"] is None)}



def final_checkpoint(run: Path) -> dict | None:
    """The run's last story with recorded code ({"story", "commit", …}); None when that can't be told."""
    try:
        import rescore
        cps = rescore.checkpoints(run)
        return cps[-1] if cps else None
    except (Exception, SystemExit):
        return None


def scored_already(run: Path, version: str) -> tuple[bool, str | None]:
    """(the run's final build has its re-score under this version, why a re-score that is there isn't it)."""
    if not (run / "rescore" / version / "rescore.json").is_file():
        return False, None
    try:
        last = last_result(run, version)
    except (Unscored, OSError, ValueError, AttributeError):
        return False, "its rescore.json holds no result"
    cp = final_checkpoint(run)
    if cp is None:
        return True, None
    if int(last.get("story", cp["story"])) != cp["story"]:
        return False, f"it scored story {last['story']}, and the run went on to story {cp['story']}"
    if last.get("commit") and last["commit"] != cp["commit"]:
        return False, f"it scored an earlier commit of story {cp['story']} than the run ended with"
    return True, None


def classify_fault(fault: str) -> tuple[str, bool]:
    """(reason_kind, needs_person) for a re-score that says nothing about the app (rescore.py's harness_fault)."""
    import rescore
    if rescore.BUILD_FAULT_MARK in fault:
        return KIND_BUILD_FAILS_CLEAN, True      # deterministic: the same commit, the same clean install
    if rescore.NOT_INSTALLED_MARK in fault:
        return KIND_TOOL_MISSING, False
    if rescore.INSTALL_FAULT_MARK in fault:
        return KIND_INSTALL_FAILED, False
    return KIND_SPOILED, False


# ---------- the run's own records ----------

def _by_id(stories: dict) -> list[tuple[str, dict]]:
    return sorted(stories.items(), key=lambda kv: (not kv[0].isdigit(), int(kv[0]) if kv[0].isdigit() else 0, kv[0]))


def needing_repair(metrics: dict) -> dict[str, str]:
    """{story id: why} for each story whose time accounting or conversation profile is not what this harness
    records: made by an older accounting.VERSION, failed its own check, or missing."""
    import accounting
    out = {}
    for sid, rec in _by_id(metrics.get("stories") or {}):
        ts = rec.get("time_split")
        acc = (ts or {}).get("accounting") or {}
        if not ts:
            out[sid] = "no time split"
        elif acc.get("version", 0) < accounting.VERSION:
            out[sid] = f"accounting version {acc.get('version', 0)}, now {accounting.VERSION}"
        elif acc.get("ok") is False:
            out[sid] = "its accounting check failed"
        elif not rec.get("conversation"):
            out[sid] = "no conversation profile"
    return out


def raw_log(run: Path, sid: str) -> Path:
    return run / "stories" / sid.zfill(2) / RAW_LOG


def repair_records(run: Path) -> dict:
    """Recompute the stale records of this run from the machine's full logs (backfill_timing.backfill_all, with
    recompute). {"repaired": [ids], "left": {id: why it is still stale}, "accounting_version", "harness_commit"},
    with "at" when anything was recomputed and "error" when the repair itself failed. Never raises."""
    out: dict = {"repaired": [], "left": {}}
    before: dict[str, str] = {}
    try:
        import accounting
        import heldout
        import roots
        out.update(accounting_version=accounting.VERSION, harness_commit=roots.harness_commit())
        before = needing_repair(heldout.load_metrics(run))
        with_log = [sid for sid in before if raw_log(run, sid).is_file()]
        after = before
        if with_log:
            import backfill_timing
            out["at"] = stamp()
            backfill_timing.backfill_all(run, recompute=True)
            after = needing_repair(heldout.load_metrics(run))
        out["repaired"] = [sid for sid in before if sid not in after]
        out["left"] = {sid: f"{why}; " + ("recomputed from the full log, still so" if sid in with_log
                                         else "no full log on this machine") for sid, why in after.items()}
    except (Exception, SystemExit) as e:
        out["error"] = public(f"{type(e).__name__}: {e}")
        # Left as they were, and marked as tried: the sweep repeats a failed repair only under another harness.
        out["left"] = {sid: f"{why}; the repair failed" for sid, why in before.items()}
    return out


def eventful(repair: dict) -> bool:
    return bool(repair.get("repaired") or repair.get("left") or repair.get("error"))


def repaired_note(repair: dict) -> str:
    ids = repair.get("repaired") or []
    return f"records repaired: stor{'y' if len(ids) == 1 else 'ies'} {', '.join(ids)}" if ids else ""


# ---------- finalize ----------

def _keep_scored(run: Path, version: str, prior: dict, out: dict, record: Callable[[str], None] | None) -> dict:
    """The run already has its score under this version: nothing is scored again. Its status is brought up to
    what this harness writes (and recorded) only if that changes it."""
    if prior.get("rescore") == "done" and prior.get("version") == version:
        new = dict(prior)
    else:               # scored by hand, or by a harness that left no status
        new = {**{k: v for k, v in out.items() if k != "repair"}, "rescore": "done", "reason": "",
               "score": score_of(run, version)}
    for k, v in (("reason_kind", KIND_SCORED), ("needs_person", False), ("retries_exhausted", False),
                 ("attempts", 0), ("max_attempts", MAX_ATTEMPTS), ("last_attempt_at", None), ("history", [])):
        new.setdefault(k, v)
    new["needs_person"] = False
    if eventful(out["repair"]) or "repair" not in new:
        new["repair"] = out["repair"]
    if new != prior:
        write_status(run, new)
        if record:
            record(repaired_note(out["repair"]) or f"score of record {new.get('score')} under {version}: status brought up to date")
    return {**new, "reason": f"already re-scored under {version}"}


def finalize(run: Path, pack_ref: str, version: str, rescore: Rescore, record: Callable[[str], None] | None) -> dict:
    now = stamp()
    prior = read_status(run)
    same = prior if prior.get("version") == version else {}     # attempts are counted per suite version
    out: dict = {"version": version, "pack_ref": pack_ref, "at": now}
    no_bundle = None
    try:
        ensure_bundle(run)
        out["bundle"] = BUNDLE
    except Unscored as e:
        no_bundle = e
    out["outside_workspace"] = scan(run)
    out["repair"] = repair_records(run)
    done, stale = scored_already(run, version)
    if done:
        return _keep_scored(run, version, prior, out, record)
    if stale and no_bundle is None:
        set_aside(run, version, f"not the run's final build: {stale}")
    attempts, history = int(same.get("attempts") or 0), list(same.get("history") or [])
    person, counted = False, True
    try:
        if no_bundle is not None:
            raise no_bundle
        rescore(run, run / BUNDLE, version)
        if fault := fault_of(run, version):
            set_aside(run, version, fault)
            fault_kind, fault_person = classify_fault(fault)
            raise Unscored(fault_kind, fault, fault_person)
        check = out["guard"] = guard(run, version)
        if check["flagged"]:
            set_aside(run, version, check["flagged"])
            state, kind, reason = "flagged", KIND_FLAGGED, check["flagged"]
            message = (f"final re-score {check['record']} under {version} flagged, not recorded: {check['flagged']}"
                       f" (live {check['live'] or 'none'})")
        else:
            state, kind, reason = "done", KIND_SCORED, ""
            out["score"] = score_of(run, version)
            message = f"final score {out['score']} under {version}"
    except Unscored as e:
        state, kind, reason, person, counted = "failed", e.kind, public(e), e.needs_person, e.counted
        message = f"final re-score failed: {reason}"
    except (Exception, SystemExit) as e:  # a broken scorer must not lose the bundle or the run's record
        state, kind, reason = "failed", KIND_RESCORE_FAILED, public(e) or type(e).__name__
        message = f"final re-score failed: {reason}"
    if counted:
        attempts += 1
        history = [*history, {"at": now, "rescore": state, "reason_kind": kind, "reason": reason}][-HISTORY_KEPT:]
    exhausted = state != "done" and not person and attempts >= MAX_ATTEMPTS
    out.update(rescore=state, reason=reason, reason_kind=kind, needs_person=state != "done" and (person or exhausted),
               retries_exhausted=exhausted, attempts=attempts, max_attempts=MAX_ATTEMPTS,
               last_attempt_at=now if counted else same.get("last_attempt_at"), history=history)
    if state != "done":
        if exhausted:
            message += f" (attempt {attempts} of {MAX_ATTEMPTS}: needs a person)"
        elif person:
            message += " (needs a person)"
        elif counted:
            message += f" (attempt {attempts} of {MAX_ATTEMPTS}; will be retried)"
        else:
            message += " (will be retried)"
    write_status(run, out)
    if out["outside_workspace"]["reached"]:
        message += "; reached outside its workspace in " + ", ".join(f"story {int(s)}" for s in out["outside_workspace"]["reached"])
    if note := repaired_note(out["repair"]):
        message += f"; {note}"
    if record:
        record(message)
    return out


def note_failure(run: Path, reason: str, kind: str = KIND_HARNESS_FAILED) -> dict | None:
    """finalize could not run at all: say so in finalize.json, as an attempt, so the sweep tries again (and a
    person is asked after MAX_ATTEMPTS). A run that has its score keeps its status. Standard library only."""
    prior = read_status(run)
    if prior.get("rescore") == "done" or not run.is_dir():
        return None
    now = stamp()
    attempts = int(prior.get("attempts") or 0) + 1
    reason = public(reason)
    out = {**prior, "at": now, "rescore": "failed", "reason": reason, "reason_kind": kind,
           "needs_person": attempts >= MAX_ATTEMPTS, "retries_exhausted": attempts >= MAX_ATTEMPTS,
           "attempts": attempts, "max_attempts": MAX_ATTEMPTS, "last_attempt_at": now,
           "history": [*(prior.get("history") or []),
                       {"at": now, "rescore": "failed", "reason_kind": kind, "reason": reason}][-HISTORY_KEPT:]}
    write_status(run, out)
    return out


def _stop(p: subprocess.Popen) -> None:
    """End a re-score and everything in its process group: SIGTERM, so rescore.py's own clean-up runs (its app
    servers and browsers are in groups of their own, which it ends), then SIGKILL."""
    for sig, wait in ((signal.SIGTERM, TERM_GRACE_S), (signal.SIGKILL, None)):
        if p.poll() is not None:
            return
        try:
            os.killpg(p.pid, sig)
        except (ProcessLookupError, PermissionError):
            pass
        try:
            p.wait(timeout=wait)
        except subprocess.TimeoutExpired:
            pass


def run_bounded(cmd: list[str], cwd: Path, env: dict, timeout_s: float | None) -> int:
    """Run a re-score, in a process group of its own, for at most timeout_s. Its exit code; Unscored (out of
    time, not an attempt) when it had to be stopped. However this returns, the re-score is not left running."""
    p = subprocess.Popen(cmd, cwd=cwd, env=env, start_new_session=True)
    try:
        return p.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        _stop(p)
        raise Unscored(KIND_OUT_OF_TIME, f"the re-score was stopped after the {int(timeout_s)}s it was given",
                       counted=False) from None
    finally:
        _stop(p)


def load_pack(pack: str):
    import pack as packmod
    return packmod.load(pack)


def rescore_with_harness(pack: str, timeout_s: float | None = None) -> Rescore:
    def rescore(run: Path, bundle_path: Path, version: str) -> None:
        import scoring_tools
        import tagsuite
        env = scoring_tools.environment()
        if missing := scoring_tools.missing(env):
            raise Unscored(KIND_TOOL_MISSING, f"{', '.join(missing)} not found on PATH (the one run.sh last had on "
                                              f"this machine, then this process's own)")
        try:                                   # the suite at the pack's tag: built here if it isn't yet
            tagsuite.for_pack(load_pack(pack), env=env)
        except tagsuite.SuiteError as e:
            raise Unscored(e.kind, str(e), e.needs_person) from None
        code = run_bounded([scoring_tools.resolve(env)["uv"], "run", "--quiet", str(HARNESS / "rescore.py"), str(run),
                            "--bundle", str(bundle_path), "--pack", pack, "--final"], HARNESS, env, timeout_s)
        if code != 0:
            raise RuntimeError(f"rescore.py exited {code}")
        if not (run / "rescore" / version / "rescore.json").is_file():
            raise RuntimeError(f"rescore.py wrote no result under {version}")
    return rescore


def _recorder(run: Path) -> Callable[[str], None]:
    import drive

    def rec(message: str) -> None:
        res = drive.record_story(drive.REPO_ROOT, run, f"{drive.PK.name} {drive.combination_label(run)} {run.name}: {message}")
        if not res.get("pushed"):
            print(f"finalize: not pushed: {res.get('error', '')}", file=sys.stderr)
    return rec


def finalize_run(run: Path, pack: str, record: bool = False, timeout_s: float | None = None) -> dict:
    """finalize(), for a run of this pack, with the harness's own re-score and record."""
    import drive
    import tagsuite
    drive.set_pack(pack)
    version = tagsuite.version_for(drive.PK)
    limit = {} if timeout_s is None else {"timeout_s": timeout_s}
    return finalize(run, drive.PK.pack_ref or "", version, rescore_with_harness(pack, **limit),
                    _recorder(run) if record else None)


def repair_only(run: Path, record: Callable[[str], None] | None) -> dict:
    """Bring the run's records up to date and nothing else (no bundle, no re-score): for a run that has its score,
    or is waiting for a person, whose records went stale. The status says what was repaired and what was left."""
    prior = read_status(run)
    repair = repair_records(run)
    new = {**prior, "repair": repair}
    if eventful(repair) and new != prior:
        write_status(run, new)
        if record:
            record(repaired_note(repair) or "stale records recomputed from the full logs, unchanged: stories "
                   + ", ".join(repair.get("left") or []) + (f" ({repair['error']})" if repair.get("error") else ""))
    return new


def repair_run(run: Path, pack: str, record: bool = False) -> dict:
    import drive
    drive.set_pack(pack)
    return repair_only(run, _recorder(run) if record else None)


class Stopped(BaseException):
    """This process was told to end (SIGTERM). Not an Exception, so nothing here takes it for a failed re-score;
    the re-score in progress is stopped on the way out (run_bounded)."""


def stop_on_sigterm():
    """Raise Stopped in this process on SIGTERM. Returns what handled it before (None where it can't be set)."""
    def stop(signum, frame):
        raise Stopped()
    try:
        return signal.signal(signal.SIGTERM, stop)
    except ValueError:      # not the main thread: the caller's own handling applies
        return None


TERMINATED = 143            # the usual exit status after SIGTERM


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run", type=Path)
    ap.add_argument("--pack", default="benchmarks/vidi")
    ap.add_argument("--record", action="store_true", help="commit and push the result with the run's record")
    a = ap.parse_args(argv)
    run = a.run.resolve()
    before = stop_on_sigterm()      # the re-score runs in a process group of its own: it is stopped with this process
    try:
        out = finalize_run(run, a.pack, a.record)
        print(f"finalize: {out.get('score', out.get('rescore'))} {out.get('reason', '')}".strip()
              + ("" if out.get("rescore") == "done" else f" (needs a person: {'yes' if out.get('needs_person') else 'no, it will be retried'})"))
    except Stopped:
        print("finalize: told to end; stopped", file=sys.stderr)
        return TERMINATED
    except (Exception, SystemExit) as e:
        print(f"finalize: {type(e).__name__}: {e}", file=sys.stderr)
        note_failure(run, f"finalize could not run: {type(e).__name__}: {e}")
    finally:
        if before is not None:
            signal.signal(signal.SIGTERM, before)
    return 0


if __name__ == "__main__":
    sys.exit(main())
