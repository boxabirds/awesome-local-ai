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
