"""migrate_rescore_to_record.py: a v2 run that ended before finalize.json existed, and has a full final re-score made
by hand under the pack's tag, gets the finalize.json finalize.py would have written for that re-score, without
scoring anything again. Anything that is not exactly that is left alone, with why."""
import json
from pathlib import Path

import pytest

import finalize
import migrate_rescore_to_record as mig

VERSION = "vidi-v2.0-pre2"
FINAL = 12
TOTAL = 75
COMMITS = {n: f"{n:02d}" * 20 for n in range(1, FINAL + 1)}     # one fake 40-char commit per story


def pack_ref_of(name: str) -> str | None:
    return VERSION if name == "vidi" else None


def detail_tests(passed: int, total: int = TOTAL) -> list[dict]:
    """Held-out detail: the first `passed` pass, every failure a different assertion (no shared cause)."""
    return [{"file": f"story-{1 + i % FINAL:02d}.spec.ts", "title": f"t{i}",
             "status": "passed" if i < passed else "failed",
             "error": "" if i < passed else f"Error: expect(locator).toHaveText #{i}"} for i in range(total)]


def make_run(root: Path, name: str = "v2-r1", *, pack_version: str = VERSION, state: str = "finished",
             invalid: dict | None = None, live: int = 70, record: int = 71, rescore_story: int = FINAL,
             rescore_total: int = TOTAL, rescore_commit: str | None = None, fault: str | None = None,
             rescore: bool = True) -> Path:
    run = root / "combinations" / "x" / "benchmarks" / "vidi" / name
    run.mkdir(parents=True)
    rj = {"pack": "vidi", "pack_version": pack_version}
    if invalid:
        rj["invalid"] = invalid
    (run / "run.json").write_text(json.dumps(rj))
    (run / "run-status.json").write_text(json.dumps({"state": state, "reason": "", "at": "2026-09-30T00:00:00Z"}))
    stories = {str(n): {"commit": COMMITS[n], "finished": True} for n in range(1, FINAL + 1)}
    stories[str(FINAL)]["accept"] = {"passed": live, "total": TOTAL}
    (run / "metrics.json").write_text(json.dumps({
        "stories": stories, "processed": [{"id": n, "status": "done"} for n in range(1, FINAL + 1)]}))
    (run / "workspace.bundle").write_bytes(b"# v2 git bundle\n")
    if rescore:
        out = run / "rescore" / VERSION
        (out / "stories" / f"{rescore_story:02d}").mkdir(parents=True)
        row = {"story": rescore_story, "passed": record, "total": rescore_total, "harness_fault": fault}
        if rescore_commit:
            row["commit"] = rescore_commit
        (out / "rescore.json").write_text(json.dumps({"pack_version": VERSION, "finished_at": "2026-09-30T09:00:00Z",
                                                      "results": [row]}))
        (out / "stories" / f"{rescore_story:02d}" / "accept.json").write_text(json.dumps(
            {"passed": record, "total": rescore_total, "tests": detail_tests(record, rescore_total)}))
    return run


def snapshot(run: Path) -> dict:
    return {p.relative_to(run).as_posix(): p.read_bytes() for p in sorted(run.rglob("*")) if p.is_file()}


def test_an_eligible_run_gets_the_record_finalize_would_have_written(tmp_path):
    run = make_run(tmp_path, live=70, record=71)
    rows = mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T13:00:00Z")
    assert [(r["run"], r["eligible"]) for r in rows] == [(run, True)]
    fin = json.loads((run / finalize.STATUS).read_text())
    assert fin["version"] == VERSION and fin["pack_ref"] == VERSION and fin["at"] == "2026-10-01T13:00:00Z"
    assert fin["bundle"] == finalize.BUNDLE
    assert fin["rescore"] == "done" and fin["score"] == "71/75" and fin["reason"] == ""
    assert fin["reason_kind"] == finalize.KIND_SCORED and fin["needs_person"] is False
    assert fin["retries_exhausted"] is False and fin["max_attempts"] == finalize.MAX_ATTEMPTS
    assert fin["attempts"] == 0 and fin["last_attempt_at"] is None and fin["history"] == []
    # the guard, as finalize computes it, from the run's own live score and the re-score
    assert fin["guard"] == finalize.guard(run, VERSION)
    assert fin["guard"]["live"] == "70/75" and fin["guard"]["difference"] == 1 and fin["guard"]["flagged"] is None
    # the agent logs were not read here: unjudged, the way finalize records a scan it couldn't make, never ok
    ow = fin["outside_workspace"]
    assert ow["ok"] is None and ow["reached"] == [] and "not judged" in ow["error"]
    # says where it came from: an existing re-score, by migration, not a fresh one
    m = fin["migrated"]
    assert m["at"] == "2026-10-01T13:00:00Z" and m["from"] == f"rescore/{VERSION}/rescore.json"
    assert m["rescored_at"] == "2026-09-30T09:00:00Z" and "not a fresh re-score" in m["note"]
    assert "repair" not in fin                         # no records were repaired: the sweep still can
    # and finalize itself takes it as already scored: it would not re-score it
    assert finalize.scored_already(run, VERSION) == (True, None)


def test_a_dry_run_writes_nothing(tmp_path):
    run = make_run(tmp_path)
    before = snapshot(run)
    rows = mig.migrate([run], pack_ref_of, write=False)
    assert rows[0]["eligible"] and rows[0]["score"] == "71/75"
    assert snapshot(run) == before


def test_the_rescore_and_run_records_are_not_touched(tmp_path):
    run = make_run(tmp_path)
    before = snapshot(run)
    mig.migrate([run], pack_ref_of, write=True)
    after = snapshot(run)
    assert set(after) - set(before) == {finalize.STATUS}
    assert all(after[k] == v for k, v in before.items())


def test_an_existing_finalize_json_is_never_overwritten(tmp_path):
    run = make_run(tmp_path)
    (run / finalize.STATUS).write_text('{"rescore": "failed", "reason": "kept as it was"}\n')
    rows = mig.migrate([run], pack_ref_of, write=True)
    assert not rows[0]["eligible"] and "already has finalize.json" in rows[0]["why"]
    assert (run / finalize.STATUS).read_text() == '{"rescore": "failed", "reason": "kept as it was"}\n'


def test_running_twice_changes_nothing_the_second_time(tmp_path):
    run = make_run(tmp_path)
    mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T13:00:00Z")
    first = (run / finalize.STATUS).read_bytes()
    rows = mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T14:00:00Z")
    assert not rows[0]["eligible"] and (run / finalize.STATUS).read_bytes() == first


@pytest.mark.parametrize("kwargs, why", [
    ({"pack_version": "vidi-v2.0-pre1+94b980f-dirty"}, "ran under vidi-v2.0-pre1+94b980f-dirty"),
    ({"pack_version": ""}, "unrecorded suite version"),
    ({"state": "stopped"}, "not finished"),
    ({"state": "started"}, "not finished"),
    ({"invalid": {"reason": "read another run's build"}}, "marked invalid"),
    ({"rescore": False}, "no re-score under vidi-v2.0-pre2"),
    ({"rescore_story": 11}, "scored story 11"),
    ({"rescore_commit": "ab" * 20}, "earlier commit"),
    ({"rescore_total": 31, "record": 30}, "31 tests, not the whole suite's 75"),
    ({"fault": "scoring interrupted: runner crashed"}, "harness fault"),
    ({"live": 60, "record": 71}, "guard flagged"),
])
def test_each_ineligible_run_is_left_alone_with_why(tmp_path, kwargs, why):
    run = make_run(tmp_path, **kwargs)
    before = snapshot(run)
    rows = mig.migrate([run], pack_ref_of, write=True)
    assert not rows[0]["eligible"] and why in rows[0]["why"], rows[0]["why"]
    assert snapshot(run) == before                     # nothing written, nothing moved (no set-aside here)


def test_a_rescore_row_with_the_final_commit_is_eligible(tmp_path):
    run = make_run(tmp_path, rescore_commit=COMMITS[FINAL])
    assert mig.migrate([run], pack_ref_of, write=False)[0]["eligible"]


def test_a_pack_with_another_tag_is_left_alone(tmp_path):
    run = make_run(tmp_path)
    rows = mig.migrate([run], lambda name: "vidi-v2.0-pre3", write=False)
    assert not rows[0]["eligible"] and "pack's tag is vidi-v2.0-pre3" in rows[0]["why"]


def test_discovery_finds_runs_under_combinations_and_reference(tmp_path):
    a = make_run(tmp_path, "v2-r1")
    ref = tmp_path / "benchmarks" / "reference" / "vidi" / "opus" / "v2-r1"
    ref.mkdir(parents=True)
    assert set(mig.discover(tmp_path)) == {a, ref}


def test_main_dry_run_prints_and_writes_nothing(tmp_path, capsys):
    run = make_run(tmp_path)
    assert mig.main(["--dry-run", "--root", str(tmp_path)], pack_ref_of=pack_ref_of) == 0
    out = capsys.readouterr().out
    assert "eligible" in out and "71/75" in out and not (run / finalize.STATUS).exists()


def test_main_write_writes(tmp_path):
    run = make_run(tmp_path)
    assert mig.main(["--write", str(run)], pack_ref_of=pack_ref_of) == 0
    assert json.loads((run / finalize.STATUS).read_text())["score"] == "71/75"


def test_main_needs_dry_run_or_write(tmp_path):
    with pytest.raises(SystemExit):
        mig.main([str(tmp_path)], pack_ref_of=pack_ref_of)


# ---------- a run built under an earlier version, named on the command line (--built-under) ----------

EARLIER = "vidi-v2.0-pre1"
EARLIER_RAN = "vidi-v2.0-pre1+94b980f-dirty"
REPAIR = {"repaired": ["1", "2"], "left": {}, "accounting_version": 4, "harness_commit": "9244bc5a",
          "at": "2026-10-01T15:03:29Z"}


def test_a_run_built_under_the_named_earlier_version_gets_its_record_and_says_so(tmp_path):
    run = make_run(tmp_path, pack_version=EARLIER_RAN, live=0, record=75)
    rows = mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T16:00:00Z", built_under=EARLIER)
    assert rows[0]["eligible"], rows[0]["why"]
    fin = json.loads((run / finalize.STATUS).read_text())
    assert fin["version"] == VERSION and fin["pack_ref"] == VERSION and fin["score"] == "75/75"
    assert fin["rescore"] == "done" and fin["reason_kind"] == finalize.KIND_SCORED
    b = fin["built_under"]
    assert b["version"] == EARLIER and b["pack_version"] == EARLIER_RAN and b["scored_under"] == VERSION
    assert EARLIER in b["note"] and VERSION in b["note"]
    # the guard is finalize's own, unchanged: the live score was made under another version, so not comparable
    assert fin["guard"] == finalize.guard(run, VERSION)
    assert fin["guard"]["comparable"] is False and fin["guard"]["live_version"] == EARLIER_RAN
    assert fin["guard"]["flagged"] is None


def test_without_the_option_such_a_run_is_still_left(tmp_path):
    run = make_run(tmp_path, pack_version=EARLIER_RAN)
    rows = mig.migrate([run], pack_ref_of, write=True)
    assert not rows[0]["eligible"] and f"ran under {EARLIER_RAN}" in rows[0]["why"]
    assert not (run / finalize.STATUS).exists()


def test_a_run_built_under_the_tag_carries_no_built_under(tmp_path):
    run = make_run(tmp_path)
    mig.migrate([run], pack_ref_of, write=True)
    assert "built_under" not in json.loads((run / finalize.STATUS).read_text())


@pytest.mark.parametrize("ran", [VERSION, "vidi-v2.0-pre0+abc", "vidi-v2.0-pre11", "kat-v1"])
def test_the_option_covers_only_runs_built_under_exactly_the_named_version(tmp_path, ran):
    run = make_run(tmp_path, pack_version=ran)
    before = snapshot(run)
    rows = mig.migrate([run], pack_ref_of, write=True, built_under=EARLIER)
    assert not rows[0]["eligible"] and f"ran under {ran}, not the named {EARLIER}" in rows[0]["why"], rows[0]["why"]
    assert snapshot(run) == before


def test_the_option_does_not_excuse_an_unrecorded_version(tmp_path):
    run = make_run(tmp_path, pack_version="")
    rows = mig.migrate([run], pack_ref_of, write=True, built_under=EARLIER)
    assert not rows[0]["eligible"] and "unrecorded suite version" in rows[0]["why"]


@pytest.mark.parametrize("kwargs, why", [
    ({"state": "stopped"}, "not finished"),
    ({"invalid": {"reason": "read another run's build"}}, "marked invalid"),
    ({"rescore": False}, "no re-score under vidi-v2.0-pre2"),
    ({"rescore_story": 11}, "scored story 11"),
    ({"rescore_commit": "ab" * 20}, "earlier commit"),
    ({"rescore_total": 31, "record": 30}, "31 tests, not the whole suite's 75"),
    ({"fault": "scoring interrupted: runner crashed"}, "harness fault"),
])
def test_the_option_keeps_every_other_condition(tmp_path, kwargs, why):
    run = make_run(tmp_path, pack_version=EARLIER_RAN, **kwargs)
    before = snapshot(run)
    rows = mig.migrate([run], pack_ref_of, write=True, built_under=EARLIER)
    assert not rows[0]["eligible"] and why in rows[0]["why"], rows[0]["why"]
    assert snapshot(run) == before


def test_the_option_keeps_the_guard(tmp_path):
    run = make_run(tmp_path, pack_version=EARLIER_RAN)
    (run / "rescore" / VERSION / "stories" / f"{FINAL:02d}" / "accept.json").unlink()   # nothing to check a cause in
    before = snapshot(run)
    rows = mig.migrate([run], pack_ref_of, write=True, built_under=EARLIER)
    assert not rows[0]["eligible"] and "guard flagged" in rows[0]["why"], rows[0]["why"]
    assert snapshot(run) == before


def test_main_built_under_applies_only_to_runs_named_on_the_command_line(tmp_path, capsys):
    make_run(tmp_path, pack_version=EARLIER_RAN)
    with pytest.raises(SystemExit):                    # a search of the whole root is never given the exception
        mig.main(["--write", "--root", str(tmp_path), "--built-under", EARLIER], pack_ref_of=pack_ref_of)
    assert "only to runs named" in capsys.readouterr().err


def test_main_built_under_must_name_another_version_than_the_tag(tmp_path, capsys):
    run = make_run(tmp_path)
    with pytest.raises(SystemExit):
        mig.main(["--write", "--built-under", VERSION, str(run)], pack_ref_of=pack_ref_of)
    assert "names an earlier version" in capsys.readouterr().err
    assert not (run / finalize.STATUS).exists()


def test_main_built_under_writes_the_named_run_and_leaves_the_others_named(tmp_path, capsys):
    named = make_run(tmp_path, "v2-r1", pack_version=EARLIER_RAN)
    other = make_run(tmp_path, "v2-r2", pack_version="vidi-v2.0-pre0+abc")
    assert mig.main(["--write", "--built-under", EARLIER, str(named), str(other)], pack_ref_of=pack_ref_of) == 0
    out = capsys.readouterr().out
    assert json.loads((named / finalize.STATUS).read_text())["built_under"]["version"] == EARLIER
    assert not (other / finalize.STATUS).exists()
    assert f"built under {EARLIER}" in out and "1 eligible of 2" in out


# ---------- a finalize.json that holds no score: only the sweep's repair block ----------

def test_a_finalize_json_holding_only_a_repair_block_gets_the_score_and_keeps_the_block(tmp_path):
    run = make_run(tmp_path)
    (run / finalize.STATUS).write_text(json.dumps({"repair": REPAIR}, indent=2) + "\n")
    before = snapshot(run)
    rows = mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T16:00:00Z")
    assert rows[0]["eligible"], rows[0]["why"]
    fin = json.loads((run / finalize.STATUS).read_text())
    assert fin["repair"] == REPAIR                     # the repair that was made stays on record, as it was
    assert fin["rescore"] == "done" and fin["score"] == "71/75" and fin["version"] == VERSION
    after = snapshot(run)
    assert set(after) == set(before) and [k for k in before if after[k] != before[k]] == [finalize.STATUS]
    # finalize reads it as scored, and the sweep keeps the repair it already made
    assert finalize.read_status(run)["rescore"] == "done"


def test_a_dry_run_leaves_a_repair_only_finalize_json_as_it_is(tmp_path):
    run = make_run(tmp_path)
    (run / finalize.STATUS).write_text(json.dumps({"repair": REPAIR}))
    before = snapshot(run)
    assert mig.migrate([run], pack_ref_of, write=False)[0]["eligible"]
    assert snapshot(run) == before


def test_a_repair_only_one_is_written_once(tmp_path):
    run = make_run(tmp_path)
    (run / finalize.STATUS).write_text(json.dumps({"repair": REPAIR}))
    mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T16:00:00Z")
    first = (run / finalize.STATUS).read_bytes()
    rows = mig.migrate([run], pack_ref_of, write=True, now="2026-10-01T17:00:00Z")
    assert not rows[0]["eligible"] and (run / finalize.STATUS).read_bytes() == first


@pytest.mark.parametrize("text", [
    '{"rescore": "done", "score": "70/75", "version": "vidi-v2.0-pre2"}',     # a score of record
    '{"score": "70/75"}',
    '{"rescore": "failed", "reason": "runner crashed", "attempts": 2}',         # an attempt's outcome and its count
    '{"rescore": "flagged", "repair": {"repaired": []}}',
    '{"repair": {"repaired": []}, "needs_person": true}',                       # anything beside the repair block
    '{"repair": {"repaired": []}, "history": []}',
    '{"repair": "not a block"}',
    '{}',                                                                       # not what the sweep writes
    '[]',
    'not json',
    '',
])
def test_a_finalize_json_holding_anything_else_is_never_overwritten(tmp_path, text):
    run = make_run(tmp_path)
    (run / finalize.STATUS).write_text(text)
    rows = mig.migrate([run], pack_ref_of, write=True)
    assert not rows[0]["eligible"] and "already has finalize.json" in rows[0]["why"]
    assert (run / finalize.STATUS).read_text() == text


def test_a_finalize_json_that_changed_since_the_check_is_not_overwritten(tmp_path):
    run = make_run(tmp_path)
    (run / finalize.STATUS).write_text(json.dumps({"repair": REPAIR}))
    why, found = mig.check(run, pack_ref_of)
    assert why is None and mig.unchanged(run, found)
    (run / finalize.STATUS).write_text(json.dumps({"repair": REPAIR, "rescore": "done", "score": "70/75"}))
    assert not mig.unchanged(run, found)
    bare = make_run(tmp_path, "v2-r9")
    why, found = mig.check(bare, pack_ref_of)
    assert mig.unchanged(bare, found)
    (bare / finalize.STATUS).write_text(json.dumps({"repair": REPAIR}))
    assert not mig.unchanged(bare, found)
