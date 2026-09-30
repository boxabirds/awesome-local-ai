"""publicise.py: what of a run may be public. Held-out test detail never is; its counts are.

MECE by what decides the answer:
  A. which paths are private      B. the public summary of a held-out result    C. metrics.json
  D. reports in markdown          E. fingerprints of the held-out suite          F. finding leaks
Run: uv run --with pytest pytest test_publicise.py
"""
import json
import subprocess
from pathlib import Path

import pytest

import publicise as pub

RUN = "combinations/qwen/3.8/x/gufo-pi/benchmarks/vidi/v2-r1"
REF = "benchmarks/reference/vidi/opus-5.5/v2-r1"


# ---------- A. which paths are private ----------

@pytest.mark.parametrize("rel", [
    f"{RUN}/stories/02/accept.json",
    f"{RUN}/stories/02/accept-report.json",
    f"{RUN}/stories/02/artifacts/story-02-abc/error-context.md",
    f"{RUN}/stories/02/screenshots/a.png",
    f"{RUN}/stories/02/scoring-2/accept-report.json",
    f"{RUN}/stories/02/pre-suite-fix/accept.json",
    f"{RUN}/rescore/vidi-v2.0-pre2/stories/12/accept.json",
    f"{RUN}/rescore/vidi-v2.0-pre2/stories/12/artifacts/x/trace.zip",
    f"{RUN}/accept-final.json",
    f"{RUN}/accept.json",
    f"{REF}/stories/03/accept-report.json",
    f"{REF}/AUDIT.md",                                       # audits triage each held-out failure by its title
    f"{RUN}/audit.jsonl",
    "benchmarks/vidi/acceptance/tests/story-01.spec.ts",
    "benchmarks/vidi/acceptance/package.json",
])
def test_A1_held_out_detail_is_private(rel):
    assert pub.is_private(rel)


@pytest.mark.parametrize("rel", [
    f"{RUN}/metrics.json",
    f"{RUN}/summary.md",
    f"{RUN}/stories/02/gate.json",                          # the agent's own checks
    f"{RUN}/stories/02/agent-events.compact.jsonl.gz",
    f"{RUN}/stories/02/accept-summary.json",
    f"{RUN}/rescore/vidi-v2.0-pre2/rescore.json",
    f"{RUN}/workspace/tests/e2e/screenshots/a.png",          # the agent's own work, whatever its names
    f"{RUN}/workspace/artifacts/accept.json",
    f"{RUN}/workspace/test-results/x/error-context.md",
    "benchmarks/vidi/spec-v2/stories/001/prd.md",
    "benchmarks/vidi/audit.md",                              # the audit rubric, not an audit
    "benchmarks/vidi/acceptance-notes.md",
])
def test_A2_everything_else_is_public(rel):
    assert not pub.is_private(rel)


@pytest.mark.parametrize("rel,summary", [
    (f"{RUN}/stories/02/accept.json", f"{RUN}/stories/02/accept-summary.json"),
    (f"{RUN}/rescore/v/stories/12/accept.json", f"{RUN}/rescore/v/stories/12/accept-summary.json"),
    (f"{RUN}/accept-final.json", f"{RUN}/accept-final-summary.json"),
    (f"{RUN}/accept.json", f"{RUN}/accept-summary.json"),
    (f"{RUN}/stories/02/accept-report.json", None),
    (f"{RUN}/stories/02/pre-suite-fix/accept.json", None),   # a superseded scoring: nothing to summarise
    (f"{RUN}/metrics.json", None),
])
def test_A3_a_held_out_result_has_a_public_summary_beside_it(rel, summary):
    assert pub.summary_path(rel) == summary


# ---------- B. the public summary of a held-out result ----------

ACCEPT = {"skipped": False, "build_exit": 0, "runner_exit": 1, "runner_tail": "Error: locator('x') expected 'red'",
          "passed": 9, "total": 10, "on_partial": {"passed": 0, "total": 0}, "by_story": {"02": {"passed": 9, "total": 10}},
          "setup_fallbacks": {"tests": 1, "by_owner": {"02": 1}}, "harness_fault": None,
          "install": {"ok": True, "command": "npm ci", "fallback": False},
          "tests": [{"file": "story-02.spec.ts", "line": 9, "title": "t @ref prd:x", "status": "failed", "error": "e"}],
          "scores": [9, 9, 9], "flaky": ["story-02.spec.ts:9 t"]}


def test_B1_the_summary_keeps_counts_and_drops_every_test_and_the_runner_output():
    s = pub.summarise_accept(ACCEPT)
    assert s == {"skipped": False, "build_exit": 0, "runner_exit": 1, "passed": 9, "total": 10,
                 "on_partial": {"passed": 0, "total": 0}, "by_story": {"02": {"passed": 9, "total": 10}},
                 "setup_fallbacks": {"tests": 1, "by_owner": {"02": 1}}, "harness_fault": None,
                 "install": {"ok": True, "command": "npm ci", "fallback": False}, "scores": [9, 9, 9], "flaky": 1}


def test_B2_an_unknown_field_is_left_out_not_passed_through():
    assert "new_detail" not in pub.summarise_accept({**ACCEPT, "new_detail": "anything"})


def test_B3_a_minimal_result_summarises():
    assert pub.summarise_accept({"passed": 0, "total": 0}) == {"passed": 0, "total": 0}


# ---------- C. metrics.json ----------

def test_C1_each_storys_held_out_result_loses_its_runner_output_and_tests():
    m = {"stories": {"2": {"accept": dict(ACCEPT), "agent": {"seconds": 5}}}, "processed": [2]}
    out = pub.strip_metrics(m)
    assert out["stories"]["2"]["accept"] == pub.summarise_accept(ACCEPT)
    assert out["stories"]["2"]["agent"] == {"seconds": 5} and out["processed"] == [2]


def test_C2_a_story_without_a_held_out_result_is_unchanged():
    m = {"stories": {"1": {"agent": {"seconds": 5}}}}
    assert pub.strip_metrics(m) == m


def test_C3_held_out_tests_a_story_broke_or_fixed_become_counts():
    m = {"stories": {"5": {"partial_heldout_changes": {"3": {"fixed": ["t1 @ref prd:a", "t2"], "regressed": []}, "4": {"regressed": ["t3"]}}}}}
    assert pub.strip_metrics(m)["stories"]["5"]["partial_heldout_changes"] == {"3": {"fixed": 2, "regressed": 0}, "4": {"regressed": 1}}


def test_C4_the_input_is_not_modified():
    m = {"stories": {"2": {"accept": dict(ACCEPT)}}}
    pub.strip_metrics(m)
    assert "tests" in m["stories"]["2"]["accept"]


# ---------- D. reports in markdown ----------

def test_D1_quoted_test_titles_and_errors_go_counts_stay():
    line = ("  - story 1: 10/10 → 0/10; broke 10: “golden path @ref prd:golden-path”; “zoom step @ref prd:zoom.step” …. "
            "Most common error: `TimeoutError: locator.click: Timeout 5000ms exceeded.`")
    assert pub.redact_markdown(line) == "  - story 1: 10/10 → 0/10; broke 10."


def test_D2_a_line_with_only_counts_is_unchanged():
    line = "  - story 3: 1/7 → 5/7; fixed 4"
    assert pub.redact_markdown(line) == line


def test_D3_other_text_is_untouched():
    text = "# Summary\n\n| Story | Commits |\n|---|---|\n| 1 | 2 by the agent |\n"
    assert pub.redact_markdown(text) == text


# ---------- E. fingerprints of the held-out suite ----------

def _private_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "private"
    tests = repo / "packs" / "vidi" / "acceptance" / "tests"
    tests.mkdir(parents=True)
    g = ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(repo)]
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    (tests / "story-01.spec.ts").write_text("test('zoom buttons step 100 to 125 @ref prd:zoom.step', async () => {});\n"
                                           "  test(\"double-quoted title is found too @ref prd:a.b\", async () => {});\n")
    subprocess.run([*g, "add", "."], check=True)
    subprocess.run([*g, "commit", "-qm", "v1"], check=True)
    subprocess.run([*g, "tag", "vidi-v1"], check=True)
    (tests / "story-01.spec.ts").write_text("test('a title only in the later version @ref prd:later', async () => {});\n")
    subprocess.run([*g, "commit", "-qam", "v2"], check=True)
    subprocess.run([*g, "tag", "vidi-v2"], check=True)
    return repo


def test_E1_titles_from_every_tagged_version_with_and_without_their_anchor(tmp_path):
    fps = pub.fingerprints(_private_repo(tmp_path))
    assert "zoom buttons step 100 to 125 @ref prd:zoom.step" in fps
    assert "zoom buttons step 100 to 125" in fps
    assert "double-quoted title is found too" in fps
    assert "a title only in the later version" in fps


def test_E2_titles_too_short_to_be_distinctive_are_not_fingerprints(tmp_path):
    repo = _private_repo(tmp_path)
    (repo / "packs/vidi/acceptance/tests/story-02.spec.ts").write_text("test('undo', async () => {});\n")
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(repo), "add", "."], check=True)
    subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "-C", str(repo), "commit", "-qm", "x"], check=True)
    subprocess.run(["git", "-C", str(repo), "tag", "vidi-v3"], check=True)
    assert "undo" not in pub.fingerprints(repo)


# ---------- F. finding leaks ----------

FPS = {"zoom buttons step 100 to 125", "zoom buttons step 100 to 125 @ref prd:zoom.step"}


def test_F1_a_held_out_title_anywhere_is_a_leak():
    assert pub.leaks('{"x": "… zoom buttons step 100 to 125 failed"}', FPS) == ["zoom buttons step 100 to 125"]


def test_F2_the_anchor_marker_alone_is_a_leak():
    assert pub.leaks("some test @ref prd:sticky.create", FPS) == ["@ref prd:"]


def test_F3_clean_text_has_no_leaks():
    assert pub.leaks("story 1: 10/10 → 0/10; broke 10.", FPS) == []


# ---------- G. which leaks count ----------

def test_G1_the_agents_own_work_and_its_own_checks_are_not_checked():
    # Agents write tests from the same spec sentences the held-out titles come from; they never saw the suite.
    text = "a made-up step the agent also named @ref prd:x"
    assert pub.leaks_in_file(f"{RUN}/workspace/tests/e2e/a.spec.ts", text, FPS | {"a made-up step the agent also named"}) == []
    assert pub.leaks_in_file(f"{RUN}/stories/07/gate.json", text, FPS | {"a made-up step the agent also named"}) == []


def test_G2_metrics_are_checked_without_the_agents_own_gate_output():
    fps = FPS | {"a made-up step the agent also named"}
    m = {"stories": {"7": {"gate": {"steps": {"e2e": {"tail": "a made-up step the agent also named"}}}}}}
    assert pub.leaks_in_file(f"{RUN}/metrics.json", json.dumps(m), fps) == []
    m["stories"]["7"]["verdict"] = "failed: a made-up step the agent also named"
    assert pub.leaks_in_file(f"{RUN}/metrics.json", json.dumps(m), fps) == ["a made-up step the agent also named"]


def test_G3_outside_run_records_only_titles_count_not_the_anchor_mark():
    # Docs and code may explain the "@ref prd:" convention; only a run record carrying it is a leak.
    assert pub.leaks_in_file("benchmarks/spec-bench/EVALUATION-POLICY.md", "titles end @ref prd:<anchor>", FPS) == []
    assert pub.leaks_in_file(f"{RUN}/summary.md", "“x @ref prd:a”", FPS) == ["@ref prd:"]
    assert pub.leaks_in_file("tools/x.rs", "zoom buttons step 100 to 125", FPS) == ["zoom buttons step 100 to 125"]
