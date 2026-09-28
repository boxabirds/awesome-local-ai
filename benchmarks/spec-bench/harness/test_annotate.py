"""annotate.py: attempts built from the run records, ordered for coverage, labels saved safely."""
import csv
import json
import threading

import pytest

import annotate


def ev(**kw):
    return json.dumps(kw)


def test_timeline_collapses_repeated_tools_and_marks_compactions_and_errors():
    lines = [ev(type="tool_execution_start", toolName="read", args={"path": "a.ts"}, _rx=100.0),
             ev(type="tool_execution_start", toolName="read", args={"path": "b.ts"}, _rx=130.0),
             ev(type="tool_execution_start", toolName="bash", args={"command": "npm test"}, _rx=160.0),
             ev(type="compaction_start", reason="threshold", _rx=220.0),
             ev(type="tool_execution_end", toolName="bash", isError=True, _rx=230.0)]
    tl = annotate.timeline(lines)
    assert [e["kind"] for e in tl] == ["tool", "tool", "compaction", "error"]
    assert tl[0]["count"] == 2 and tl[0]["last"] == "read b.ts"
    assert tl[2]["min"] == 2.0


def test_timeline_reads_claude_tool_uses():
    line = ev(type="assistant", timestamp="2026-09-25T10:00:00Z",
              message={"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]})
    assert annotate.timeline([line])[0]["text"] == "Bash ls"


LOG = """commit 3333333
a  Fri

    harness: snapshot after story 12 (uncommitted agent work)

commit 2222222
a  Fri

    story 12: images

commit 1111111
a  Fri

    story 11: pen
"""


def test_commits_are_matched_to_their_story_including_harness_snapshots():
    got = annotate.commits_for(LOG, 12)
    assert len(got) == 2 and "story 12: images" in got[0] and "snapshot after story 12" in got[1]
    assert len(annotate.commits_for(LOG, 11)) == 1
    assert annotate.commits_for(LOG, 1) == []  # "story 1" must not match "story 11" or "story 12"


def attempt(stack, run, story):
    return {"id": f"{stack}/{run}#{story:02d}", "stack": stack, "run": run, "story": story}


def test_order_interleaves_stacks_spreads_stories_and_is_stable():
    items = [attempt(s, r, n) for s in ("A", "B") for r in ("r1", "r2") for n in (1, 2, 3)]
    order = annotate.coverage_order([dict(a) for a in items])
    assert sorted(a["id"] for a in order) == sorted(a["id"] for a in items)
    assert all(order[i]["stack"] != order[i + 1]["stack"] for i in range(5))  # stacks alternate early
    first_a = [a["story"] for a in order if a["stack"] == "A"][:3]
    assert sorted(first_a) == [1, 2, 3]  # every story once before any repeats
    assert [a["id"] for a in annotate.coverage_order([dict(a) for a in items])] == [a["id"] for a in order]


def test_labels_are_saved_updated_and_validated(tmp_path):
    path, lock = tmp_path / "analysis" / "labels.csv", threading.Lock()
    annotate.write_label(path, "run#01", "skip", "is dragging a note meant to pan?", lock)
    annotate.write_label(path, "run#02", "fail", "", lock)
    annotate.write_label(path, "run#01", "fail", "pans on drag", lock)
    rows = list(csv.DictReader(path.open()))
    assert [(r["attempt"], r["verdict"], r["notes"]) for r in rows] == [("run#01", "fail", "pans on drag"), ("run#02", "fail", "")]
    with pytest.raises(ValueError):
        annotate.write_label(path, "run#03", "maybe", "", lock)


def test_attempts_build_from_the_real_records(tmp_path):
    attempts = annotate.load_attempts(annotate.REPO, tmp_path / "cache.json", rebuild=True)
    ids = {a["id"] for a in attempts}
    assert len(ids) == len(attempts) and len(attempts) >= 100
    pi03_s7 = next(a for a in attempts if a["id"].endswith("27b/ubuntu/nvidia4090/llamacpp-opencode/benchmarks/vidi/canvas-pi-03#07"))
    assert pi03_s7["title"].startswith("Select") and pi03_s7["timeline"] and pi03_s7["commits"]
    assert pi03_s7["behaviour"]["own_total"] == 8
    # cached on the second load
    again = annotate.load_attempts(annotate.REPO, tmp_path / "cache.json", rebuild=False)
    assert [a["id"] for a in again] == [a["id"] for a in attempts]


def test_review_leaves_out_known_good_runs(tmp_path):
    """EVALUATION-POLICY rule 7: known-good runs are diagnostic and never mixed with full runs."""
    runs = tmp_path / "combinations" / "some" / "stack" / "benchmarks" / "vidi"
    for name, extra in (("full-01", {}), ("kg-3", {"known_good": {"from_run": "x", "commit": "c", "story": 3}})):
        (runs / name).mkdir(parents=True)
        (runs / name / "metrics.json").write_text(json.dumps({"stories": {}, **extra}))
    assert [p.name for p in annotate.run_dirs(tmp_path)] == ["full-01"]
