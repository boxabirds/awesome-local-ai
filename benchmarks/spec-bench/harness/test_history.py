"""history.py: how a run's changes happened, from the agent's commits and the held-out suite's results
after every story, not from the final state alone. The real case: gruntus canvas-pi-03, where story 7
broke typing into sticky notes and with it most of stories 1-5's held-out tests."""
import json
import re
from pathlib import Path

import pytest

import history
import report
from drive import REPO_ROOT

GRUNTUS_RUN = (REPO_ROOT / "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/benchmarks/vidi"
               / "canvas-pi-03")

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


@pytest.mark.skipif(not GRUNTUS_RUN.exists(), reason="no canvas-pi-03 records in this checkout")
def test_gruntus_story_7_is_found_as_the_story_that_broke_stories_1_to_5():
    h = history.analyse(GRUNTUS_RUN)
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
    assert "## How it happened" in report.summary(GRUNTUS_RUN)


QUINTUS_RUN = (REPO_ROOT / "combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/benchmarks/vidi"
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
        "- 2026-09-26T11:10:05Z story 1: quintus froze (last system log 11:10Z) and the watchdog restarted it.\n")
    m = json.loads((run / "metrics.json").read_text())
    m["stories"]["1"]["agent"] = {"seconds": 1200.0}
    m["stories"]["2"]["agent"] = {"seconds": 240.0}
    (run / "metrics.json").write_text(json.dumps(m))
    return run


def test_a_freeze_mid_story_is_dead_time_not_agent_time(tmp_path):
    h = history.analyse(interrupted_run(tmp_path))
    [i] = h["interruptions"]
    assert i["story"] == "1" and i["kind"] == "machine freeze" and round(i["gap_s"]) == 1920
    assert "quintus froze" in i["cause"]
    s1 = h["stories"]["1"]
    # events at 0-9 min and 41-60 min: a 60 min span minus the 32 min gap is 28 min of work
    assert round(s1["active_s"]) == 3600 - 1920
    assert round(s1["dead_s"]) == 1920 and s1["recorded_s"] == 1200.0
    assert "dead_s" not in h["stories"]["2"] or h["stories"]["2"]["dead_s"] == 0


def test_the_report_states_interruptions_and_totals(tmp_path):
    text = history.render(interrupted_run(tmp_path))
    assert "### Interruptions and dead time" in text
    assert "machine freeze" in text and "1 machine freeze" in text and "32 min" in text


@pytest.mark.skipif(not QUINTUS_RUN.exists(), reason="no quintus canvas-pi-03 records in this checkout")
def test_quintus_freeze_2_is_found_in_story_3_with_its_logged_cause():
    h = history.analyse(QUINTUS_RUN)
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
