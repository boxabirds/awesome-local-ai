"""history.py: how a run's changes happened, from the agent's commits and the held-out suite's results
after every story, not from the final state alone. The real case: the RTX 4090 machine's canvas-pi-03, where story 7
broke typing into sticky notes and with it most of stories 1-5's held-out tests."""
import json
import re
from pathlib import Path

import pytest

import heldout
import history
import report
from drive import REPO_ROOT

RTX4090_RUN = (REPO_ROOT / "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi"
               / "canvas-pi-03")

# The real runs' held-out detail lives in the private repo's copy (the public record has counts only): these tests
# read it there, read-only, and are skipped where it isn't checked out.
REAL_PRIVATE = REPO_ROOT.parent / "awesome-local-ai-bench-private"
has_private = pytest.mark.skipif(not (REAL_PRIVATE / heldout.PRIVATE_RUNS).is_dir(), reason="no private repo copy of the runs")


@pytest.fixture
def real_private(monkeypatch):
    monkeypatch.setenv(heldout.PRIVATE_ENV, str(REAL_PRIVATE))

LOG = """commit bbbb
vidi-agent  Sat Sep 26 09:44:15 2026 +0100

    story 2: Capture ideas


 src/client/objects/StickyNote.tsx | 202 ++---------
 src/client/board/Marquee.tsx      | 101 ++++++
 2 files changed, 151 insertions(+), 152 deletions(-)

commit aaaa
harness  Sat Sep 26 08:00:00 2026 +0100

    harness: snapshot after story 1 (uncommitted agent work)


 package.json | 3 +-
 1 file changed, 2 insertions(+), 1 deletion(-)

commit 0000
harness  Sat Sep 26 07:00:00 2026 +0100

    harness: empty repository with spec

"""


def test_the_workspace_log_parses_into_commits_with_their_files():
    cs = history.parse_git_log(LOG)
    assert [c["hash"] for c in cs] == ["bbbb", "aaaa", "0000"]
    assert cs[0]["subject"] == "story 2: Capture ideas"
    assert cs[0]["files"] == [("src/client/objects/StickyNote.tsx", 202), ("src/client/board/Marquee.tsx", 101)]
    assert (cs[0]["insertions"], cs[0]["deletions"]) == (151, 152)
    assert cs[1]["by_harness"] and not cs[0]["by_harness"]
    assert cs[2]["files"] == []


def fake_run(tmp_path: Path) -> Path:
    """Two stories. Story 2 breaks one of story 1's tests and fixes the other."""
    run = tmp_path / "run"
    (run / "workspace-git-log.txt").parent.mkdir(parents=True)
    (run / "workspace-git-log.txt").write_text(LOG)
    t = lambda title, status, err="": {"file": "tests/story-01.spec.ts", "title": title, "status": status, "error": err}
    after = {1: [t("pans", "passed"), t("zooms", "failed", "Error: zoom wrong")],
             2: [t("pans", "failed", "\x1b[31mError: expect(locator).toHaveCount(expected) failed\x1b[39m\nLocator: x"),
                 t("zooms", "passed"),
                 {"file": "tests/story-02.spec.ts", "title": "creates", "status": "passed", "error": ""}]}
    stories = {}
    for sid, base, commit in ((1, "0000", "aaaa"), (2, "aaaa", "bbbb")):
        d = run / "stories" / f"{sid:02d}"
        d.mkdir(parents=True)
        (d / "base-commit").write_text(base + "\n")
        (d / "accept.json").write_text(json.dumps({"tests": after[sid]}))
        by = {"01": {"passed": sum(x["status"] == "passed" for x in after[sid] if "01" in x["file"]), "total": 2}}
        if sid == 2:
            by["02"] = {"passed": 1, "total": 1}
        stories[str(sid)] = {"title": f"Story {sid}", "commit": commit, "agent_commits": 0 if sid == 1 else 1,
                             "accept": {"by_story": by}}
    (run / "metrics.json").write_text(json.dumps({"stories": stories}))
    return run


def test_each_story_gets_its_own_commits(tmp_path):
    h = history.analyse(fake_run(tmp_path))
    assert [c["hash"] for c in h["stories"]["1"]["commits"]] == ["aaaa"]
    assert [c["hash"] for c in h["stories"]["2"]["commits"]] == ["bbbb"]


def test_a_story_that_breaks_and_fixes_earlier_tests_is_named_with_the_tests_and_the_error(tmp_path):
    h = history.analyse(fake_run(tmp_path))
    [chg] = h["changes"]
    assert (chg["by_story"], chg["of_story"], chg["before"], chg["after"]) == ("2", "01", "1/2", "1/2")
    assert chg["broke"] == ["pans"] and chg["fixed"] == ["zooms"]
    assert chg["common_error"] == "Error: expect(locator).toHaveCount(expected) failed / Locator: x"


def test_the_report_has_a_how_it_happened_section(tmp_path):
    text = history.render(fake_run(tmp_path))
    assert "## How it happened" in text and "Story 2 broke 1" in text and "StickyNote.tsx" in text
    assert "fixed 1" in text and "harness snapshot" in text


@has_private
@pytest.mark.skipif(not RTX4090_RUN.exists(), reason="no canvas-pi-03 records in this checkout")
def test_rtx4090_story_7_is_found_as_the_story_that_broke_stories_1_to_5(real_private):
    h = history.analyse(RTX4090_RUN)
    by7 = {c["of_story"]: c for c in h["changes"] if c["by_story"] == "7"}
    assert {"01", "02", "03", "04", "05"} <= set(by7), by7.keys()
    assert sum(len(c["broke"]) for c in by7.values()) >= 10
    assert all(c["by_story"] != "8" or not c["broke"] or len(c["broke"]) < len(by7["02"]["broke"])
               for c in h["changes"])                          # story 7 is the big one
    files = [f for c in h["stories"]["7"]["commits"] for f, _ in c["files"]]
    assert "src/client/objects/StickyNote.tsx" in files and "src/client/board/useTransformGesture.ts" in files
    # what broke it is in the source, not the tests or the lockfile
    src = history.source_files(h["stories"]["7"]["commits"])
    assert src[0][0].endswith("useTransformGesture.ts") and not any(re.search(r"\.(test|spec)\.|(^|/)tests?/", f) for f, _ in src)
    assert not any(f.endswith("package-lock.json") for f, _ in history.source_files(h["stories"]["1"]["commits"]))
    # the error says what was wrong: the typed text never arrived
    typed = next(c for c in h["changes"] if c["by_story"] == "7" and c["of_story"] == "02")
    assert "Received" in typed["common_error"], typed["common_error"]
    assert "## How it happened" in report.summary(RTX4090_RUN)


M5_MAX_RUN = (REPO_ROOT / "combinations/qwen/3.8/flash-next/macos/128GB/mtplx-pi/benchmarks/vidi"
               / "canvas-pi-03")


def interrupted_run(tmp_path: Path) -> Path:
    """One story whose machine froze mid-way and was restarted 30 min later, then another clean story."""
    import gzip
    run = fake_run(tmp_path)
    import datetime as dt
    t0 = dt.datetime(2026, 9, 26, 11, 0, tzinfo=dt.timezone.utc).timestamp()
    def events(times):
        return "".join(json.dumps({"type": "message_end", "message": {"role": "assistant", "timestamp": int(t * 1000)}}) + "\n"
                       for t in times)
    # work 11:00-11:09, freeze at 11:10, restart 11:39, work again 11:41-12:00: a 32 min gap
    s1 = [t0 + 60 * i for i in range(10)] + [t0 + 2460 + 60 * i for i in range(20)]
    s2 = [t0 + 4000 + 60 * i for i in range(5)]           # 12:06-12:10, after the restart: clean
    for sid, times in (("01", s1), ("02", s2)):
        with gzip.open(run / "stories" / sid / "agent-events.compact.jsonl.gz", "wt") as f:
            f.write(events(times))
    (run / "run-history.jsonl").write_text(json.dumps({"started_at": "2026-09-26T11:00:00Z"}) + "\n"
                                           + json.dumps({"started_at": "2026-09-26T11:39:00Z"}) + "\n")
    (run / "interventions.md").write_text(
        "- 2026-09-26T11:10:05Z story 1: the M5 Max froze (last system log 11:10Z) and the watchdog restarted it.\n")
    m = json.loads((run / "metrics.json").read_text())
    m["stories"]["1"]["agent"] = {"seconds": 1200.0}
    m["stories"]["2"]["agent"] = {"seconds": 240.0}
    (run / "metrics.json").write_text(json.dumps(m))
    return run


def test_a_freeze_mid_story_is_dead_time_not_agent_time(tmp_path):
    h = history.analyse(interrupted_run(tmp_path))
    [i] = h["interruptions"]
    assert i["story"] == "1" and i["kind"] == "machine freeze" and round(i["gap_s"]) == 1920
    assert "the M5 Max froze" in i["cause"]
    s1 = h["stories"]["1"]
    # events at 0-9 min and 41-60 min: a 60 min span minus the 32 min gap is 28 min of work
    assert round(s1["active_s"]) == 3600 - 1920
    assert round(s1["dead_s"]) == 1920 and s1["recorded_s"] == 1200.0
    assert "dead_s" not in h["stories"]["2"] or h["stories"]["2"]["dead_s"] == 0


def test_the_report_states_interruptions_and_totals(tmp_path):
    text = history.render(interrupted_run(tmp_path))
    assert "### Interruptions and dead time" in text
    assert "machine freeze" in text and "1 machine freeze" in text and "32 min" in text


@pytest.mark.skipif(not M5_MAX_RUN.exists(), reason="no M5 Max canvas-pi-03 records in this checkout")
def test_m5_max_freeze_2_is_found_in_story_3_with_its_logged_cause():
    h = history.analyse(M5_MAX_RUN)
    s3 = [i for i in h["interruptions"] if i["story"] == "3"]
    assert s3 and s3[0]["kind"] == "machine freeze" and 20 * 60 <= s3[0]["gap_s"] <= 25 * 60, s3
    st = h["stories"]["3"]
    # the recorded agent time covers only the attempt after the restart
    assert st["active_s"] > st["recorded_s"] + 30 * 60


def test_notes_that_are_not_interruptions_mark_no_dead_time(tmp_path):
    run = interrupted_run(tmp_path)
    with (run / "interventions.md").open("a") as f:
        f.write("- 2026-09-26T11:05:00Z story 1: ended by the operator (harness (cap)) after 100 agent-min. Recorded PARTIAL.\n"
                "- 2026-09-26T11:03:00Z held-out suite fixed mid-run (commit above).\n")
    h = history.analyse(run)
    assert [i["kind"] for i in h["interruptions"]] == ["machine freeze"]


def _write_accept(run: Path, sid: int, results: dict[tuple[str, str], str]) -> None:
    d = run / "stories" / f"{sid:02d}"
    d.mkdir(parents=True, exist_ok=True)
    tests = [{"file": f, "title": t, "status": s} for (f, t), s in results.items()]
    (d / "accept.json").write_text(json.dumps({"passed": sum(s == "passed" for s in results.values()),
                                               "total": len(results), "tests": tests}))


def test_per_story_separates_new_work_regressions_and_repairs(tmp_path):
    """EVALUATION-POLICY rule 6: each story's own held-out tests, the earlier tests it broke and
    the ones it repaired, beside the cumulative score."""
    a1, a2 = ("story-01.spec.ts", "a1"), ("story-01.spec.ts", "a2")
    b1, b2 = ("story-02.spec.ts", "b1"), ("story-02.spec.ts", "b2")
    c1 = ("story-03.spec.ts", "c1")
    _write_accept(tmp_path, 1, {a1: "passed", a2: "failed"})
    _write_accept(tmp_path, 2, {a1: "failed", a2: "failed", b1: "passed", b2: "passed"})   # breaks a1
    _write_accept(tmp_path, 3, {a1: "passed", a2: "passed", b1: "failed", b2: "passed", c1: "passed"})  # repairs a1, a2; breaks b1
    rows = {r["story"]: r for r in history.per_story(tmp_path)}
    assert (rows[1]["new_passed"], rows[1]["new_total"], rows[1]["regressions"], rows[1]["repairs"]) == (1, 2, 0, 0)
    assert (rows[2]["new_passed"], rows[2]["new_total"], rows[2]["regressions"], rows[2]["repairs"]) == (2, 2, 1, 0)
    assert (rows[3]["new_passed"], rows[3]["regressions"], rows[3]["repairs"]) == (1, 1, 2)
    assert (rows[3]["cumulative_passed"], rows[3]["cumulative_total"]) == (4, 5)


def test_per_story_table_leads_the_summary(tmp_path):
    _write_accept(tmp_path, 1, {("story-01.spec.ts", "a1"): "passed"})
    text = history.render_per_story(tmp_path)
    assert "New work" in text and "Regressions" in text and "Repairs" in text and "Cumulative" in text
    assert "| 1 | 1/1 | 0 | 0 | 1/1 |" in text


def test_known_good_run_measures_regressions_against_its_base(tmp_path):
    """A known-good run scores the held-out suite on its base before the agent starts, so the one
    story it runs still shows what it broke and repaired."""
    a1, a2 = ("story-01.spec.ts", "a1"), ("story-01.spec.ts", "a2")
    c1 = ("story-03.spec.ts", "c1")
    base = tmp_path / "base"
    base.mkdir()
    (base / "accept.json").write_text(json.dumps({"tests": [{"file": a1[0], "title": a1[1], "status": "passed"},
                                                            {"file": a2[0], "title": a2[1], "status": "failed"}]}))
    _write_accept(tmp_path, 3, {a1: "failed", a2: "passed", c1: "passed"})
    [row] = history.per_story(tmp_path)
    assert (row["story"], row["new_passed"], row["regressions"], row["repairs"]) == (3, 1, 1, 1)


def test_known_good_summary_says_it_is_diagnostic(tmp_path):
    """EVALUATION-POLICY rule 7: never read as a full run."""
    (tmp_path / "run.json").write_text(json.dumps({"model_id": "m", "scope": "canvas"}))
    (tmp_path / "metrics.json").write_text(json.dumps({"stories": {}, "known_good": {
        "from_run": "benchmarks/reference/vidi/opus-5.5/run-3", "commit": "abc1234def", "story": 7,
        "spec_updated": True}}))
    text = report.summary(tmp_path)
    assert "Known-good mode (diagnostic)" in text
    assert "opus-5.5/run-3" in text and "abc1234" in text
    assert "not comparable with full runs" in text
    assert "spec was brought up to this pack's version" in text


def test_per_story_counts_setup_fallbacks_and_shows_them_only_when_used(tmp_path):
    """EVALUATION-POLICY rule 8: how many held-out tests needed a setup fallback at each checkpoint.
    Runs scored without any (every v1.1 score) keep the table as it was."""
    a1, b1 = ("story-01.spec.ts", "a1"), ("story-02.spec.ts", "b1")
    _write_accept(tmp_path, 1, {a1: "passed"})
    _write_accept(tmp_path, 2, {a1: "passed", b1: "passed"})
    assert "Setup fallbacks" not in history.render_per_story(tmp_path)
    f = tmp_path / "stories" / "02" / "accept.json"
    doc = json.loads(f.read_text())
    doc["tests"][1]["setup_fallbacks"] = ["createNote (partial); story 2; TC-35"]
    f.write_text(json.dumps(doc))
    rows = {r["story"]: r for r in history.per_story(tmp_path)}
    assert (rows[1]["fallbacks"], rows[2]["fallbacks"]) == (0, 1)
    assert "| Setup fallbacks |" in history.render_per_story(tmp_path)


def test_per_story_shows_flaky_tests_when_a_checkpoint_was_scored_more_than_once(tmp_path):
    a1, a2 = ("story-01.spec.ts", "a1"), ("story-01.spec.ts", "a2")
    _write_accept(tmp_path, 1, {a1: "passed", a2: "failed"})
    assert "Flaky" not in history.render_per_story(tmp_path)
    f = tmp_path / "stories" / "01" / "accept.json"
    doc = json.loads(f.read_text())
    doc["tests"][0]["statuses"] = ["passed", "passed", "passed"]
    doc["tests"][1]["statuses"] = ["failed", "passed", "failed"]
    f.write_text(json.dumps(doc))
    assert history.per_story(tmp_path)[0]["flaky"] == 1
    assert "| Flaky |" in history.render_per_story(tmp_path)
