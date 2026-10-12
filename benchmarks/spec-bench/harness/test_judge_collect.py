"""judge_collect.py: judge results are checked, peeks in the transcript are caught, and the un-blinded
counts line up with our own audits."""
import json
import subprocess
from pathlib import Path

import pytest

import judge_collect as jc
import packdir


def row(**kw):
    base = {"story": 3, "category": "functional", "severity": "high", "discrepancy": "d", "evidence": "e"}
    return {**base, **kw}


def test_malformed_rows_are_reported():
    rows = [row(), row(category="vibes"), row(severity="huge"), row(evidence=""), row(own_way="maybe")]
    problems = jc.row_problems(rows)
    assert len(problems) == 4 and any("vibes" in p for p in problems) and any("own_way" in p for p in problems)


def test_reads_outside_the_package_into_our_records_are_peeks():
    transcript = "\n".join([
        "cat /Users/user/expts/awesome-local-ai-bench-private/judging/vidi-v1/build-A/workspace/src/App.tsx",
        "ls /Users/user/expts/awesome-local-ai/benchmarks/reference/vidi/opus-5.5/run-1/AUDIT.md",
        "cat ~/.vidi-bench/keys/vidi-v1.json",
        "cat /Users/user/expts/awesome-local-ai-bench-private/packs/vidi/acceptance/tests/story-03.spec.ts",
        "ls /Users/user/Downloads/unrelated.txt",
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


def test_overreach_and_gap_fill_rows_are_well_formed():
    assert jc.row_problems([row(category="overreach", severity="medium"), row(category="gap-fill", severity="low")]) == []


# ---- load_results: the judge's files, from a directory or from the private repo's origin/main ----

NAME, JUDGE = "vidi-v1", "judge-1"
PREFIX = f"gradings/{NAME}/results/{JUDGE}"


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", *args], cwd=cwd, capture_output=True,
                          text=True, check=True).stdout


def private_repo(tmp_path: Path, files: dict[str, str]) -> Path:
    """packs/vidi beside a checkout whose origin/main holds `files` under the judge's results folder."""
    bare, repo = tmp_path / "private.git", tmp_path / "private"
    git(tmp_path, "init", "-q", "--bare", "-b", "main", str(bare))
    git(tmp_path, "clone", "-q", str(bare), str(repo))
    git(repo, "checkout", "-q", "-b", "main")
    (repo / "packs" / "vidi").mkdir(parents=True)
    (repo / "packs" / "vidi" / "keep").write_text("x")
    for f, text in files.items():
        (repo / PREFIX / f).parent.mkdir(parents=True, exist_ok=True)
        (repo / PREFIX / f).write_text(text)
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "results")
    git(repo, "push", "-q", "origin", "main")
    return repo


def test_load_results_from_a_directory_reads_the_known_outputs_and_the_first_transcript(tmp_path):
    (tmp_path / "build-A.jsonl").write_text("a")
    (tmp_path / "summary.md").write_text("s")
    (tmp_path / "unrelated.txt").write_text("u")
    (tmp_path / "transcript-2.txt").write_bytes(b"second \xff")
    (tmp_path / "transcript-1.txt").write_bytes(b"first \xff")
    assert jc.load_results(NAME, JUDGE, tmp_path) == {"build-A.jsonl": "a", "summary.md": "s",
                                                      "transcript": "first \ufffd"}


def test_load_results_from_a_directory_without_a_transcript_has_none(tmp_path):
    (tmp_path / "test-faults.jsonl").write_text("f")
    assert jc.load_results(NAME, JUDGE, tmp_path) == {"test-faults.jsonl": "f"}


def test_load_results_without_a_private_repo_stops_with_a_message(tmp_path, monkeypatch):
    monkeypatch.setenv(packdir.ENV, str(tmp_path / "in-repo-pack"))      # a pack outside any private checkout
    with pytest.raises(SystemExit) as e:
        jc.load_results(NAME, JUDGE, None)
    assert e.value.code == "no private pack repo next to this one"


def test_load_results_from_the_private_repo_reads_origin_main_and_names_the_transcript(tmp_path, monkeypatch):
    private = private_repo(tmp_path, {"build-A.jsonl": "a\n", "summary.md": "# s\n", "transcript-1.txt": "the transcript"})
    # a later local commit that was never pushed: only origin/main counts
    (private / PREFIX / "summary.md").write_text("local only\n")
    git(private, "commit", "-qam", "unpushed")
    monkeypatch.setenv(packdir.ENV, str(private / "packs" / "vidi"))
    assert jc.load_results(NAME, JUDGE, None) == {"build-A.jsonl": "a\n", "summary.md": "# s\n",
                                                  "transcript": "the transcript"}


def test_load_results_from_the_private_repo_says_when_the_judge_has_submitted_nothing(tmp_path, monkeypatch):
    private = private_repo(tmp_path, {})
    git(private, "commit", "-q", "--allow-empty", "-m", "nothing")
    monkeypatch.setenv(packdir.ENV, str(private / "packs" / "vidi"))
    with pytest.raises(SystemExit) as e:
        jc.load_results(NAME, JUDGE, None)
    assert e.value.code == f"no {PREFIX} on the private repo's origin/main (run judge-submit.sh first)"
