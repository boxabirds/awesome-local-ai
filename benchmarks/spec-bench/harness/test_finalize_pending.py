"""finalize_pending.py: the sweep that gives every run that ended without its score of record another try, with
nobody asking. run.sh calls it at the start and the end of every run; an operator can run it by hand.

Why: in the week of 28 Sep 2026 finished runs kept ending "not scored" (the suite checkout past its tag, uv not on
PATH, the harness momentarily broken), and each time the dashboard asked the owner to log in to the machine and
run a command. Everything here uses made-up runs in a temporary results root; the real one is never swept.
"""
import json
import os
import re
import signal
import sys
import time
from pathlib import Path

import pytest

import accounting
import finalize
import finalize_pending as fp

PACK = "kat"
REF = "kat-v1"
COMBO = f"combinations/a/b/benchmarks/{PACK}"
HARNESS_COMMIT = "abc1234"
RUN_SH = Path(__file__).with_name("run.sh").read_text()


def write(p: Path, doc) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(doc if isinstance(doc, str) else json.dumps(doc))


def story(stale: bool = False) -> dict:
    return {"commit": "c0ffee", "started": 1.0, "agent_finished": 2.0, "conversation": {"calls": 1},
            "time_split": {"model": {}, "accounting": {"version": 0 if stale else accounting.VERSION, "ok": True}}}


def make_run(root: Path, rel: str, state: str | None = "finished", at: str = "2026-10-01T08:00:00Z", fin: dict | None = None,
             invalid: bool = False, here: bool = True, stories: dict | None = None, ran_under: str | None = REF,
             logs: tuple[str, ...] = ()) -> Path:
    run = root / rel
    run.mkdir(parents=True)
    if state:
        write(run / "run-status.json", {"state": state, "reason": "", "at": at})
    write(run / "run.json", {"pack": PACK, **({"pack_version": ran_under} if ran_under else {}),
                             **({"invalid": {"reason": "read another run's build", "since": "2026-09-30"}} if invalid else {})})
    write(run / "metrics.json", {"stories": {"1": story()} if stories is None else stories})
    if here:
        write(run / "work_dir.txt", str(root / "work" / run.name) + "\n")
    if fin is not None:
        write(run / finalize.STATUS, fin)
    for sid in logs:
        write(run / "stories" / sid.zfill(2) / finalize.RAW_LOG, "{}\n")
    return run


DONE = {"version": REF, "rescore": "done", "score": "4/5", "needs_person": False}
RETRYABLE = {"version": REF, "rescore": "failed", "reason": "uv not found on PATH", "reason_kind": "tool_missing",
             "needs_person": False, "attempts": 1}
NEEDS_PERSON = {"version": REF, "rescore": "failed", "reason": "the app's build failed in the re-score",
                "reason_kind": "build_fails_from_clean_clone", "needs_person": True, "attempts": 1}
LEGACY_SKIPPED = {"version": f"{REF}+28ace8b", "pack_ref": REF, "rescore": "skipped",
                  "reason": f"the suite checkout is at {REF}+28ace8b, not the pack's {REF}"}


def pending(root: Path, **kw) -> dict[str, str]:
    found = fp.pending(root, pack_ref_of=lambda name: REF, harness_commit=HARNESS_COMMIT, **kw)
    return {run.name: action for run, action, _ in found}


@pytest.fixture
def root(tmp_path):
    return tmp_path / "results"


# ---------- which runs ----------

def test_runs_that_ended_without_a_score_of_record_are_found(root):
    make_run(root, f"{COMBO}/never-finalized")
    make_run(root, f"{COMBO}/retryable", fin=RETRYABLE)
    make_run(root, f"{COMBO}/skipped-by-the-old-rule", fin=LEGACY_SKIPPED, ran_under=f"{REF}+28ace8b")
    make_run(root, f"{COMBO}/flagged", fin={**RETRYABLE, "rescore": "flagged", "reason_kind": "flagged"})
    make_run(root, f"benchmarks/reference/{PACK}/opus/ref-run")
    make_run(root, "combinations/q/3.8/27b/ubuntu/gpu/llamacpp-pi/benchmarks/kat/deep")
    assert pending(root) == {n: "score" for n in ("never-finalized", "retryable", "skipped-by-the-old-rule", "flagged",
                                                  "ref-run", "deep")}


@pytest.mark.parametrize("state,found", [("finished", True), ("failed", True), ("stopped", True),
                                         ("started", False), (None, False)])
def test_only_a_run_that_has_ended_is_scored(root, state, found):
    """finished, and failed or stopped too: a run that used up its restarts still has a final build, and its
    score is of the stories it processed. A run still marked started may be running, or may be resumed."""
    make_run(root, f"{COMBO}/r1", state=state)
    assert pending(root) == ({"r1": "score"} if found else {})


def test_runs_that_must_not_be_swept_are_skipped_each_for_its_own_reason(root):
    make_run(root, f"{COMBO}/scored", fin=DONE)
    make_run(root, f"{COMBO}/invalid", invalid=True)
    make_run(root, f"{COMBO}/needs-person", fin=NEEDS_PERSON)
    make_run(root, f"{COMBO}/elsewhere", here=False)                     # its work dir was never on this machine
    make_run(root, f"{COMBO}/no-code", stories={"1": {"title": "t"}})
    make_run(root, f"{COMBO}/no-stories", stories={})
    make_run(root, f"{COMBO}/older-suite", ran_under="kat-v0.9")
    make_run(root, f"{COMBO}/unknown-suite", ran_under=None)
    assert pending(root) == {}
    why = {run.name: reason for run, action, reason in fp.survey(root, lambda name: REF, HARNESS_COMMIT) if action is None}
    assert "scored" in why["scored"] and "invalid" in why["invalid"] and "needs a person" in why["needs-person"]
    assert "build failed" in why["needs-person"]                         # with the reason a person needs
    assert "this machine" in why["elsewhere"] and "no story" in why["no-code"] and "no story" in why["no-stories"]
    assert "kat-v0.9" in why["older-suite"] and "unrecorded" in why["unknown-suite"]


@pytest.mark.parametrize("ran,same", [(REF, True), (f"{REF}+28ace8b", True), (f"{REF}+28ace8b-dirty", True),
                                      (f"{REF}-dirty", True), ("kat-v1.1", False), ("28ace8b", False)])
def test_a_run_is_scored_only_under_the_suite_generation_it_ran_under(root, ran, same):
    """A checkout a few commits past the tag is the same generation (the tag's suite is what is scored); a run
    made under another tag is not re-scored under this one by a sweep nobody asked for."""
    make_run(root, f"{COMBO}/r1", ran_under=ran)
    assert bool(pending(root)) is same


def test_a_run_whose_run_json_names_no_pack_is_of_the_pack_its_directory_is_under(root):
    """Runs recorded before run.json had "pack" (found on the real records: reference/vidi/opus-5.5/run-3)."""
    seen = []
    for rel in (f"{COMBO}/old", f"benchmarks/reference/{PACK}/opus/old-ref"):
        run = make_run(root, rel)
        write(run / "run.json", {"pack_version": REF})
        assert fp.pack_of(run) == PACK
    fp.pending(root, pack_ref_of=lambda name: seen.append(name) or REF, harness_commit=HARNESS_COMMIT)
    assert seen == [PACK, PACK]
    calls = []
    sweep(root, calls)
    assert {c[1] for c in calls} == {f"benchmarks/{PACK}"}


def test_the_run_that_is_starting_is_left_out(root):
    mine = make_run(root, f"{COMBO}/mine", state="stopped")
    make_run(root, f"{COMBO}/other")
    assert pending(root, exclude=[mine]) == {"other": "score"}


def test_the_most_recently_ended_run_comes_first(root):
    make_run(root, f"{COMBO}/older", at="2026-09-29T08:00:00Z")
    make_run(root, f"{COMBO}/newest", at="2026-10-01T09:00:00Z")
    make_run(root, f"{COMBO}/middle", at="2026-09-30T08:00:00Z")
    assert list(pending(root)) == ["newest", "middle", "older"]


def test_a_workspace_copy_inside_a_run_is_not_searched_for_runs(root):
    run = make_run(root, f"{COMBO}/r1", fin=DONE)
    make_run(run / "workspace", f"{COMBO}/inner")
    assert fp.run_dirs(root) == [run]


# ---------- stale records ----------

def test_a_scored_run_with_stale_records_and_its_full_logs_is_repaired(root):
    make_run(root, f"{COMBO}/stale", fin=DONE, stories={"1": story(stale=True)}, logs=("1",))
    make_run(root, f"{COMBO}/stale-no-logs", fin=DONE, stories={"1": story(stale=True)})
    make_run(root, f"{COMBO}/current", fin=DONE, logs=("1",))
    make_run(root, f"{COMBO}/stale-needs-person", fin=NEEDS_PERSON, stories={"1": story(stale=True)}, logs=("1",))
    assert pending(root) == {"stale": "repair", "stale-needs-person": "repair"}


def test_a_repair_this_harness_already_tried_is_not_tried_again(root):
    """Idempotent: a record the recomputation can't fix is recomputed once per harness and accounting version."""
    tried = {"repaired": [], "left": {"1": "its accounting check failed; recomputed from the full log, still so"},
             "harness_commit": HARNESS_COMMIT, "accounting_version": accounting.VERSION}
    make_run(root, f"{COMBO}/tried", fin={**DONE, "repair": tried}, stories={"1": story(stale=True)}, logs=("1",))
    make_run(root, f"{COMBO}/tried-by-an-older-harness", fin={**DONE, "repair": {**tried, "harness_commit": "0ld"}},
             stories={"1": story(stale=True)}, logs=("1",))
    assert pending(root) == {"tried-by-an-older-harness": "repair"}


# ---------- the sweep ----------

class Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def scorer(calls: list, clock: Clock | None = None, seconds: float = 0, fail: tuple[str, ...] = ()):
    """Stands in for finalize: scores the run (writes what finalize would), or crashes for the named runs."""
    def finalize_one(run, pack, record, timeout_s, action):
        calls.append((run.name, pack, record, timeout_s, action))
        if clock:
            clock.t += seconds
        if run.name in fail:
            raise RuntimeError(f"cannot import name 'x' ({run.name})")
        fin = {**finalize.read_status(run), **DONE}
        if action == "repair":
            m = json.loads((run / "metrics.json").read_text())
            m["stories"] = {sid: story() for sid in m["stories"]}
            write(run / "metrics.json", m)
        write(run / finalize.STATUS, fin)
        return fin
    return finalize_one


def sweep(root: Path, calls: list, **kw):
    kw.setdefault("busy", lambda: [])
    kw.setdefault("finalize_one", scorer(calls))
    return fp.sweep(root, pack_ref_of=lambda name: REF, harness_commit=HARNESS_COMMIT, log=lambda *a: None, **kw)


def test_the_sweep_scores_what_is_pending_and_a_second_sweep_finds_nothing(root):
    make_run(root, f"{COMBO}/unscored", fin=RETRYABLE)
    make_run(root, f"{COMBO}/stale", fin=DONE, stories={"1": story(stale=True)}, logs=("1",), at="2026-09-30T08:00:00Z")
    make_run(root, f"{COMBO}/scored", fin=DONE)
    calls = []
    first = sweep(root, calls, record=True)
    assert [(c[0], c[1], c[2], c[4]) for c in calls] == [("unscored", f"benchmarks/{PACK}", True, "score"),
                                                         ("stale", f"benchmarks/{PACK}", True, "repair")]
    assert [name for name, _ in first["handled"]] == ["unscored", "stale"] and first["left"] == 0
    again = sweep(root, calls)
    assert len(calls) == 2 and again["handled"] == [] and again["left"] == 0           # idempotent


def test_the_sweep_refuses_while_another_harness_run_is_active(root):
    make_run(root, f"{COMBO}/unscored")
    calls = []
    out = sweep(root, calls, busy=lambda: ["12345 python drive.py --run-dir …"])
    assert calls == [] and out["handled"] == [] and "drive.py" in out["stopped"] and out["left"] == 1
    assert not (root / COMBO / "unscored" / finalize.STATUS).exists()           # waiting is not an attempt
    sweep(root, calls, busy=lambda: ["12345 python drive.py --run-dir …"], even_if_busy=True)
    assert [c[0] for c in calls] == ["unscored"]


def test_a_run_that_starts_during_the_sweep_stops_it(root):
    for n in (1, 2, 3):
        make_run(root, f"{COMBO}/r{n}", at=f"2026-10-01T0{n}:00:00Z")
    calls = []
    out = sweep(root, calls, busy=lambda: ["99 python drive.py"] if calls else [])
    assert [c[0] for c in calls] == ["r3"] and out["left"] == 2 and "drive.py" in out["stopped"]


def test_the_sweep_handles_no_more_than_its_cap_and_leaves_the_rest_for_next_time(root):
    for n in range(fp.SWEEP_MAX_RUNS + 2):
        make_run(root, f"{COMBO}/r{n}", at=f"2026-10-01T0{n}:00:00Z")
    calls = []
    out = sweep(root, calls)
    assert [c[0] for c in calls] == [f"r{n}" for n in range(fp.SWEEP_MAX_RUNS + 1, 1, -1)]   # the newest ones
    assert out["left"] == 2 and "cap" in out["stopped"]
    sweep(root, calls, limit=1)
    assert len(calls) == fp.SWEEP_MAX_RUNS + 1


def test_the_sweep_stops_at_its_time_budget(root):
    """A re-score is started only with RESCORE_RESERVE_S of the budget left, and is given what is left as its
    limit, so the sweep ends by its budget and a run is never held up for longer."""
    for n in (1, 2, 3):
        make_run(root, f"{COMBO}/r{n}", at=f"2026-10-01T0{n}:00:00Z")
    clock, calls = Clock(), []
    budget = fp.RESCORE_RESERVE_S * 2
    out = sweep(root, calls, clock=clock, budget_s=budget,
                finalize_one=scorer(calls, clock, seconds=fp.RESCORE_RESERVE_S * 0.75))
    assert [(c[0], c[3]) for c in calls] == [("r3", budget), ("r2", budget - fp.RESCORE_RESERVE_S * 0.75)]
    assert out["left"] == 1 and "time" in out["stopped"]
    assert not (root / COMBO / "r1" / finalize.STATUS).exists()


def test_a_repair_needs_no_rescore_time_and_still_stops_when_the_budget_is_spent(root):
    make_run(root, f"{COMBO}/stale-a", fin=DONE, stories={"1": story(stale=True)}, logs=("1",), at="2026-10-01T02:00:00Z")
    make_run(root, f"{COMBO}/stale-b", fin=DONE, stories={"1": story(stale=True)}, logs=("1",), at="2026-10-01T01:00:00Z")
    clock, calls = Clock(), []
    sweep(root, calls, clock=clock, budget_s=10, finalize_one=scorer(calls, clock, seconds=10))
    assert [c[0] for c in calls] == ["stale-a"]                         # 10 s is below the re-score reserve: a repair still ran


def test_a_failure_in_one_run_does_not_stop_the_others_and_is_noted_as_an_attempt(root):
    for n in (1, 2, 3):
        make_run(root, f"{COMBO}/r{n}", at=f"2026-10-01T0{n}:00:00Z")
    calls = []
    out = sweep(root, calls, finalize_one=scorer(calls, fail=("r3",)))
    assert [c[0] for c in calls] == ["r3", "r2", "r1"]
    fin = finalize.read_status(root / COMBO / "r3")
    assert fin["rescore"] == "failed" and fin["reason_kind"] == finalize.KIND_HARNESS_FAILED
    assert fin["needs_person"] is False and fin["attempts"] == 1 and "cannot import" in fin["reason"]
    assert finalize.read_status(root / COMBO / "r2")["rescore"] == "done"
    assert [o for _, o in out["handled"]] == ["failed", "done", "done"]


def test_a_run_whose_records_cannot_be_read_does_not_stop_the_sweep(root):
    make_run(root, f"{COMBO}/good", at="2026-10-01T01:00:00Z")
    bad = make_run(root, f"{COMBO}/bad", at="2026-10-01T02:00:00Z")
    (bad / "metrics.json").write_text("{ not json")
    calls = []
    sweep(root, calls)
    assert [c[0] for c in calls] == ["good"]


def test_a_run_that_keeps_failing_stops_being_swept_at_the_cap(root):
    """End to end with finalize's own counting: MAX_ATTEMPTS failed attempts, then needs_person, then nothing."""
    run = make_run(root, f"{COMBO}/r1")
    calls = []

    def failing(run, pack, record, timeout_s, action):
        calls.append(run.name)
        return finalize.note_failure(run, "rescore.py exited 1", finalize.KIND_RESCORE_FAILED)
    for _ in range(finalize.MAX_ATTEMPTS + 2):
        sweep(root, [], finalize_one=failing)
    assert len(calls) == finalize.MAX_ATTEMPTS
    fin = finalize.read_status(run)
    assert fin["needs_person"] is True and len(fin["history"]) == finalize.MAX_ATTEMPTS


# ---------- is the machine busy ----------

PS = """\
  100     1 /bin/bash /opt/releases/harness-v1/benchmarks/spec-bench/harness/run.sh install-a --record
  200   100 uv run --quiet finalize_pending.py --exclude /r/a
  201   200 /cache/python finalize_pending.py --exclude /r/a
  300     1 bash /srv/checkout/benchmarks/spec-bench/harness/run.sh install-b --record
  310   300 uv run --quiet drive.py --run-dir /r/b --base-url cloud
  311   310 /cache/python drive.py --run-dir /r/b --base-url cloud
  400     1 /cache/python rescore.py /r/c --bundle /r/c/workspace.bundle --final
  500     1 vim drive.py
  600     1 /bin/zsh -c cat run.sh | grep drive.py
  700     1 bash /srv/checkout/run.sh
"""


def test_other_runs_and_rescores_are_seen_and_this_sweeps_own_run_is_not():
    found = fp.harness_processes(PS, own_pid=201)
    assert [line.split()[0] for line in found] == ["300", "310", "311", "400"]
    # From inside run b's story loop: its own run.sh and uv are its ancestors; run a and the re-score are others.
    assert [line.split()[0] for line in fp.harness_processes(PS, own_pid=311)] == ["100", "400"]


def test_with_nothing_else_running_the_machine_is_free():
    lines = "\n".join(PS.splitlines()[:3] + PS.splitlines()[7:])
    assert fp.harness_processes(lines, own_pid=201) == []


# ---------- the command ----------

@pytest.fixture
def quiet_machine(monkeypatch, tmp_path):
    """No look at the real machine's processes (it may well be running a benchmark), and a scoring home of the
    test's own for the lock."""
    import scoring_tools
    monkeypatch.setenv(scoring_tools.HOME_ENV, str(tmp_path / "scoring-home"))
    monkeypatch.setattr(fp, "busy", lambda: [])
    monkeypatch.setattr(fp, "pack_ref", lambda name: REF)


def test_the_command_sweeps_the_root_it_is_given_and_never_fails(root, quiet_machine, monkeypatch, capsys):
    make_run(root, f"{COMBO}/unscored")
    mine = make_run(root, f"{COMBO}/mine", state="failed")
    calls = []
    monkeypatch.setattr(fp, "finalize_one", scorer(calls))
    assert fp.main(["--root", str(root), "--exclude", str(mine), "--record"]) == 0
    assert [(c[0], c[2]) for c in calls] == [("unscored", True)]
    assert "unscored" in capsys.readouterr().out

    def broken(*a, **k):
        raise RuntimeError("the sweep itself broke")
    monkeypatch.setattr(fp, "sweep", broken)
    assert fp.main(["--root", str(root)]) == 0                          # run.sh is never failed by it
    assert "the sweep itself broke" in capsys.readouterr().out


def test_list_shows_what_is_pending_and_what_needs_a_person_and_changes_nothing(root, quiet_machine, monkeypatch, capsys):
    make_run(root, f"{COMBO}/unscored", fin=RETRYABLE)
    make_run(root, f"{COMBO}/stuck", fin=NEEDS_PERSON)
    calls = []
    monkeypatch.setattr(fp, "finalize_one", scorer(calls))
    assert fp.main(["--root", str(root), "--list"]) == 0
    out = capsys.readouterr().out
    assert calls == [] and re.search(r"unscored.*score.*uv not found", out)
    assert re.search(r"stuck.*needs a person.*build failed", out)


def test_two_sweeps_do_not_run_at_once(root, quiet_machine, monkeypatch, capsys):
    make_run(root, f"{COMBO}/unscored")
    calls = []
    monkeypatch.setattr(fp, "finalize_one", scorer(calls))
    with fp.exclusive() as mine:
        assert mine
        assert fp.main(["--root", str(root)]) == 0
    assert calls == [] and "another sweep" in capsys.readouterr().out
    assert fp.main(["--root", str(root)]) == 0 and len(calls) == 1      # the lock is released with its holder


def test_the_command_is_stopped_for_good_shortly_after_its_budget(root, quiet_machine, monkeypatch, capsys):
    """Whatever a step is doing when the budget plus HARD_STOP_GRACE_S has passed, the sweep ends: run.sh waits
    for it, so it can hold a run up by no more than that."""
    make_run(root, f"{COMBO}/unscored")
    monkeypatch.setattr(fp, "HARD_STOP_GRACE_S", 0)
    monkeypatch.setattr(fp, "RESCORE_RESERVE_S", 0)

    def hangs(run, pack, record, timeout_s, action):
        try:
            time.sleep(30)
        except Exception:               # even a step that swallows ordinary errors is stopped
            time.sleep(30)
    monkeypatch.setattr(fp, "finalize_one", hangs)
    t0 = time.monotonic()
    assert fp.main(["--root", str(root), "--budget-s", "1"]) == 0
    assert time.monotonic() - t0 < 10 and "time budget" in capsys.readouterr().out
    assert signal.getsignal(signal.SIGALRM) is signal.SIG_DFL          # and the alarm is put away
    assert not (root / COMBO / "unscored" / finalize.STATUS).exists()   # being stopped is not an attempt


def test_the_default_root_is_the_results_root_not_where_the_code_is():
    import roots
    assert fp.default_root() == roots.RESULTS_ROOT


# ---------- a released harness: the code in a read-only directory, the results in the checkout ----------

from test_roots import TAG, make_release, probe, writable_again  # noqa: E402,F401 - writable_again is a fixture

SWEEP_AS_A_RELEASE = (
    "import json, sys, finalize, finalize_pending as fp\n"
    "fp.busy = lambda: []\n"
    "def scored(run, pack, record, timeout_s, action):\n"
    "    out = {'rescore': 'done', 'score': '4/5', 'needs_person': False, 'pack': pack}\n"
    "    finalize.write_status(run, out)\n"
    "    return out\n"
    "fp.finalize_one = scored\n"
    "sys.exit(fp.main(sys.argv[1:]))\n")


def results_checkout(tmp_path: Path) -> Path:
    results = tmp_path / "checkout"
    write(results / "benchmarks" / PACK / "spec/stories/001-a/story.md", "# A story\n")
    write(results / "benchmarks" / PACK / "bench.json", {"name": PACK, "pack_ref": REF})
    return results


def test_a_released_harness_sweeps_the_results_checkout_not_its_own_directory(tmp_path, writable_again):
    release = make_release(tmp_path, read_only=True)
    results = results_checkout(tmp_path)
    run = make_run(results, f"{COMBO}/unscored", fin=RETRYABLE)
    harness = release / "benchmarks/spec-bench/harness"
    listed = probe("import sys, finalize_pending as fp; sys.exit(fp.main(['--list']))", results, tmp_path, harness=harness)
    assert listed.returncode == 0 and f"{COMBO}/unscored\tscore\tuv not found on PATH" in listed.stdout, listed.stdout + listed.stderr
    swept = probe(SWEEP_AS_A_RELEASE, results, tmp_path, harness=harness)
    assert swept.returncode == 0, swept.stdout + swept.stderr
    assert finalize.read_status(run) == {"rescore": "done", "score": "4/5", "needs_person": False, "pack": f"benchmarks/{PACK}"}
    assert not list(release.rglob(finalize.STATUS))                     # nothing of it where the code is


def test_a_checkout_sweeps_itself_the_same_way(tmp_path):
    """One root: the same sweep, told its root (the tests never sweep the checkout they run from)."""
    results = results_checkout(tmp_path)
    run = make_run(results, f"{COMBO}/unscored", fin=RETRYABLE)
    swept = probe(SWEEP_AS_A_RELEASE, None, tmp_path, "--root", str(results),
                  env={"SPEC_BENCH_PACK_DIR": str(results / "benchmarks" / PACK)})
    assert swept.returncode == 0, swept.stdout + swept.stderr
    assert finalize.read_status(run)["score"] == "4/5"


def test_a_release_with_no_results_root_says_so_and_still_does_not_fail_its_caller(tmp_path):
    release = make_release(tmp_path)
    r = probe("import sys, finalize_pending as fp; sys.exit(fp.main([]))", None, tmp_path,
              harness=release / "benchmarks/spec-bench/harness")
    assert r.returncode == 0 and TAG in r.stdout and "SPEC_BENCH_RESULTS_ROOT" in r.stdout


# ---------- run.sh ----------

def _line(pattern: str, start: int = 0) -> int:
    for i, line in enumerate(RUN_SH.splitlines()):
        if i >= start and re.search(pattern, line) and not line.lstrip().startswith("#"):
            return i
    raise AssertionError(f"run.sh has no command matching {pattern!r} from line {start}")


SWEEP = r"finalize_pending\.py"


def test_run_sh_sweeps_at_the_start_while_the_machine_is_free():
    """After the self-test (a broken harness must not sweep) and before the model server starts."""
    first = _line(SWEEP)
    assert _line(r"pytest[^\n]*test_pipeline\.py") < first < _line(r'echo "starting \$SERVER_CMD')
    assert first < _line(r"uv run --quiet drive\.py")


def test_run_sh_sweeps_again_at_the_end_after_its_own_finalize():
    own = _line(r"uv run --quiet finalize\.py")
    assert _line(SWEEP, own) > own > _line(r"uv run --quiet drive\.py")


def test_run_sh_can_never_fail_because_of_the_sweep_and_leaves_its_own_run_out():
    calls = [l for l in RUN_SH.splitlines() if re.search(SWEEP, l) and not l.lstrip().startswith("#")]
    assert len(calls) == 2
    for call in calls:
        assert call.rstrip().endswith("|| true"), call                 # set -e: whatever it returns, the run goes on
        assert '--exclude "$RUN_DIR"' in call and "${RECORD:+--record}" in call
        assert "2>&1" in call                                          # its messages are not this run's errors
        assert "--even-if-busy" not in call


def test_run_sh_remembers_its_tools_for_later_rescores_before_it_sweeps():
    remember = _line(r"scoring_tools\.py\"? remember")
    assert RUN_SH.splitlines()[remember].rstrip().endswith("|| true")
    assert _line(r"playwright-platform\.sh") < remember < _line(SWEEP)
