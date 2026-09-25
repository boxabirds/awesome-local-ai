"""judge_collect.py: judge results are checked, peeks in the transcript are caught, and the un-blinded
counts line up with our own audits."""
import json

import judge_collect as jc


def row(**kw):
    base = {"story": 3, "category": "functional", "severity": "high", "discrepancy": "d", "evidence": "e"}
    return {**base, **kw}


def test_malformed_rows_are_reported():
    rows = [row(), row(category="vibes"), row(severity="huge"), row(evidence=""), row(own_way="maybe")]
    problems = jc.row_problems(rows)
    assert len(problems) == 4 and any("vibes" in p for p in problems) and any("own_way" in p for p in problems)


def test_reads_outside_the_package_into_our_records_are_peeks():
    transcript = "\n".join([
        "cat /Users/j/expts/awesome-local-ai-bench-private/judging/vidi-v1/build-A/workspace/src/App.tsx",
        "ls /Users/j/expts/awesome-local-ai/benchmarks/reference/vidi/opus-5.5/run-1/AUDIT.md",
        "cat ~/.vidi-bench/keys/vidi-v1.json",
        "cat /Users/j/expts/awesome-local-ai-bench-private/packs/vidi/acceptance/tests/story-03.spec.ts",
        "ls /Users/j/Downloads/unrelated.txt",
    ])
    found = jc.peeks(transcript, "judging/vidi-v1")
    assert len(found) == 3
    assert not any("judging/vidi-v1" in p for p in found) and not any("Downloads" in p for p in found)


def test_report_unblinds_and_compares_with_our_audit(tmp_path):
    ours = tmp_path / "audit.jsonl"
    ours.write_text("\n".join(json.dumps(r) for r in [
        row(story=3), row(story=5, severity="medium"), row(story=5, category="weak-test", severity="low"),
        row(story=7, status="fixed-later")]))  # not counted: fixed in a later story
    files = {
        "build-A.jsonl": "\n".join(json.dumps(r) for r in [row(story=3, own_way="works"), row(story=9)]),
        "build-B.jsonl": json.dumps(row(story=1)),
        "test-faults.jsonl": "", "summary.md": "s",
        "transcript": "read /x/judging/vidi-v1/GRADING.md",
    }
    text = jc.report("vidi-v1", "gpt", files, {"A": "flash-next", "B": "opus"}, {"flash-next": ours})
    assert "Build A = flash-next" in text and "Build B = opus" in text
    assert "0 path(s) outside the package" in text
    assert "own way (held-out app faults): {'works': 1}" in text
    assert "story 5: judge 0, ours 1" in text and "story 9: judge 1, ours 0" in text
    assert "story 7" not in text
    assert "**Missing outputs:** test-faults.jsonl" in text  # empty counts as not written
