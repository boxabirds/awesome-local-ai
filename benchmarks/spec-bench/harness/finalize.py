"""finalize.py <run-dir> [--pack benchmarks/vidi] [--record]

At the end of a run: save the workspace's history as <run-dir>/workspace.bundle (the review page builds
each story from it), then re-score the final build with the held-out suite (rescore.py --final), so a
finished run has its score of record and can be judged without anyone doing it by hand.

A re-score is recorded only if it passes the live-vs-record guard (guard): a final score more than
DIVERGENCE_TESTS away from the run's own live score of the same code under the same suite version, or one whose
failures all share one cause across stories when the live scoring can't vouch for it, is set aside with the reason
(rescore-spoiled/, like a re-score the machine spoiled) and the record says the run is unscored, with its live score.

The re-score only runs when the private suite checkout is exactly at the pack's pack_ref: a checkout a
commit past its tag records a version ("vidi-v2.0-pre2+22a2164") that no page matches, so the record says
why it wasn't scored instead. A run already re-scored under that version is left alone. With --record the
result is committed and pushed with the run's record, through drive.record_story like every story: the re-score's
held-out results go to the private repo and only their summaries to this one. Never fails the caller: problems are
reported.
"""
from __future__ import annotations

import argparse
import json
import re
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


def finalize(run: Path, pack_ref: str, version: str, rescore: Rescore, record: Callable[[str], None] | None) -> dict:
    work = Path((run / "work_dir.txt").read_text().strip()).expanduser()
    out: dict = {"version": version, "pack_ref": pack_ref, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    bundle(work / "workspace", run / BUNDLE)
    out["bundle"] = BUNDLE
    out["outside_workspace"] = contain(run)
    action, why = decide(version, pack_ref, already=(run / "rescore" / version / "rescore.json").is_file())
    if action == "skip" and why.startswith("already"):
        return {**out, "rescore": "done", "reason": why}   # nothing new to record
    if action == "rescore":
        try:
            rescore(run, run / BUNDLE, version)
            if fault := fault_of(run, version):
                set_aside(run, version, fault)
                raise RuntimeError(fault)
            check = out["guard"] = guard(run, version)
            if check["flagged"]:
                set_aside(run, version, check["flagged"])
                out.update(rescore="flagged", reason=check["flagged"])
                message = (f"final re-score {check['record']} under {version} flagged, not recorded: {check['flagged']}"
                           f" (live {check['live'] or 'none'})")
            else:
                out.update(rescore="done", reason="", score=score_of(run, version))
                message = f"final score {out['score']} under {version}"
        except Exception as e:  # a broken scorer must not lose the bundle or the run's record
            out.update(rescore="failed", reason=str(e)[:REASON_CHARS])
            message = f"final re-score failed: {out['reason']}"
    else:
        out.update(rescore="skipped", reason=why)
        message = f"not re-scored: {why}"
    (run / STATUS).write_text(json.dumps(out, indent=2) + "\n")
    if out["outside_workspace"]["reached"]:
        message += "; reached outside its workspace in " + ", ".join(f"story {int(s)}" for s in out["outside_workspace"]["reached"])
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
