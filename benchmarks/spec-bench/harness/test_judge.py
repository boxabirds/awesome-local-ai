"""judge.py: work-dir naming, and a whole judging run with a stand-in judge that tries to peek."""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

import judge
import packdir

mac_only = pytest.mark.skipif(sys.platform != "darwin", reason="sandbox-exec is macOS only")


def test_work_dir_name_drops_the_combinations_prefix():
    assert judge.work_dir_name("combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/canvas-pi-03") \
        == "qwen__3.8__27b__ubuntu__nvidia4090__llamacpp-pi__benchmarks__vidi__canvas-pi-03"
    assert judge.work_dir_name("benchmarks/reference/vidi/opus-5.5/run-2") == "benchmarks__reference__vidi__opus-5.5__run-2"


def test_last_accept_is_the_final_story_with_results(tmp_path):
    for sid in ("01", "02", "03"):
        (tmp_path / "stories" / sid).mkdir(parents=True)
    for sid in ("01", "02"):
        (tmp_path / "stories" / sid / "accept.json").write_text("{}")
    assert judge.last_accept(tmp_path) == tmp_path / "stories" / "02" / "accept.json"


FAKE_JUDGE = """#!/bin/sh
# Stand-in for codex: try to read the real user's codex config, then write the four outputs.
if cat "$REAL_SECRET" >/dev/null 2>&1; then peek=read; else peek=refused; fi
echo "{\\"peek\\": \\"$peek\\"}"
for f in build-A.jsonl build-B.jsonl test-faults.jsonl; do : > "$f"; done
echo "# summary ($peek)" > summary.md
"""


@mac_only
def test_a_judging_run_collects_outputs_and_the_judge_cannot_read_home(tmp_path, monkeypatch):
    real_secret = Path.home() / ".codex" / "config.toml"
    if not real_secret.exists():
        pytest.skip("needs a file in the real home to try to read")
    bindir = tmp_path / "tools" / "bin"
    bindir.mkdir(parents=True)
    fake = bindir / "codex"
    fake.write_text(FAKE_JUDGE)
    fake.chmod(0o755)
    codex_home = tmp_path / "codex-home"
    codex_home.mkdir()
    (codex_home / "auth.json").write_text("{}")
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setenv("REAL_SECRET", str(real_secret))
    node_dir = Path(shutil.which("node")).parent
    monkeypatch.setenv("PATH", f"{bindir}:{node_dir}:{Path(sys.executable).parent}:/usr/bin:/bin")
    package = tmp_path / "job" / "package"
    package.mkdir(parents=True)
    (package / "GRADING.md").write_text("brief")
    args = argparse.Namespace(model=None, effort=None, label="fake")
    results = judge.run_judge(tmp_path / "job" / "run-1", package, args)
    assert sorted(p.name for p in results.iterdir()) == sorted([*judge.OUTPUTS, "transcript.jsonl"])
    assert json.loads((results / "transcript.jsonl").read_text()) == {"peek": "refused"}
    assert (results / "summary.md").read_text() == "# summary (refused)\n"
    # the judge worked on a clone: the original package is untouched
    assert not (package / "summary.md").exists()


def test_a_whole_run_rescore_wins_over_the_last_story(tmp_path):
    (tmp_path / "stories" / "12").mkdir(parents=True)
    (tmp_path / "stories" / "12" / "accept.json").write_text("{}")
    (tmp_path / "accept-final.json").write_text("{}")
    assert judge.last_accept(tmp_path) == tmp_path / "accept-final.json"


def test_scorer_faults_are_caught_on_real_records(tmp_path):
    ref = judge.REPO / "benchmarks" / "reference" / "vidi" / "opus-5.5"
    # run-2's story 12 as it was first recorded (re-scored since): every test failed to launch a browser
    broken = tmp_path / "accept.json"
    broken.write_text(json.dumps({"passed": 0, "total": 75, "tests": [{"title": "golden path", "status": "failed",
        "error": "Error: browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium"}]}))
    good = ref / "run-3" / "stories" / "12" / "accept.json"
    assert "no browser" in judge.scorer_fault(broken)
    if not good.exists():
        pytest.skip("the real held-out results have left the public repo (publicise.py); they are in the private copy")
    assert judge.scorer_fault(good) is None
    # run-2's final build was re-scored whole on 25 Sep; that is what a judge gets
    assert judge.last_accept(ref / "run-2").name == "accept-final.json"
    assert judge.scorer_fault(judge.last_accept(ref / "run-2")) is None


def test_scored_commit_is_the_last_recorded_story_commit(tmp_path):
    (tmp_path / "metrics.json").write_text(json.dumps({"stories": {"11": {"commit": "aaa"}, "12": {"commit": "bbb"}, "13": {}}}))
    assert judge.scored_commit(tmp_path) == "bbb"
    real = judge.REPO / "combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1"
    assert judge.scored_commit(real).startswith("b478230")


LOG = """commit bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
vidi-agent  Fri Sep 25 17:07:33 2026 +0100

    story 2: notes

 src/b.ts | 1 +

commit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
vidi-agent  Fri Sep 25 16:00:00 2026 +0100

    story 1: pan

 src/a.ts | 1 +
"""


def test_commit_log_is_put_in_build_order():
    out = judge.commits_oldest_first(LOG)
    assert out.index("story 1: pan") < out.index("story 2: notes")
    assert out.count("commit ") == 2


def fake_record(tmp_path, scored="bbbbbbb"):
    rec = tmp_path / "rec"
    (rec / "workspace" / "src").mkdir(parents=True)
    (rec / "workspace" / "src" / "b.ts").write_text("export const b = 1\n")
    (rec / "workspace-git-log.txt").write_text(LOG)
    (rec / "metrics.json").write_text(json.dumps({"stories": {"2": {"commit": scored}}}))
    return rec


def test_record_workspace_becomes_a_one_commit_repo(tmp_path):
    judge.record_workspace(fake_record(tmp_path), tmp_path / "ws")
    files = subprocess.run(["git", "-C", str(tmp_path / "ws"), "ls-files"], capture_output=True, text=True).stdout.split()
    assert files == ["src/b.ts"]


def test_a_snapshot_that_is_not_the_scored_commit_is_refused(tmp_path):
    with pytest.raises(SystemExit, match="score was taken on"):
        judge.record_workspace(fake_record(tmp_path, scored="ccccccc"), tmp_path / "ws")


# Every finished record in the repository, not a named few: records are archived (4 Oct 2026 took the v1 runs this test
# named), and a test of "every record" must not fail because one has gone, nor pass because none are left.
FEWEST_FINISHED_RECORDS = 10


def test_every_finished_record_snapshot_matches_its_scored_commit():
    logs = subprocess.run(["git", "-C", str(judge.REPO), "ls-files", "--", "combinations/*/workspace-git-log.txt",
                           "benchmarks/reference/*/workspace-git-log.txt"], capture_output=True, text=True, check=True).stdout.split()
    status = lambda r: json.loads((r / "run-status.json").read_text()) if (r / "run-status.json").exists() else {}
    finished = [r for r in (judge.REPO / p.rsplit("/", 1)[0] for p in logs) if status(r).get("state") == "finished"]
    assert len(finished) >= FEWEST_FINISHED_RECORDS
    # Opus run-1 was built outside the harness and has no run-status.json; its snapshot is checked all the same.
    for r in [*finished, judge.REPO / "benchmarks/reference/vidi/opus-5.5/run-1"]:
        head = (r / "workspace-git-log.txt").read_text().split("\n", 1)[0].split()[-1]
        assert head.startswith(judge.scored_commit(r)[:7]), r


def test_claims_come_from_agent_reports_for_a_run_built_outside_the_harness(tmp_path):
    run1 = judge.REPO / "benchmarks" / "reference" / "vidi" / "opus-5.5" / "run-1"
    ids = judge.record_claims(run1, tmp_path / "claims")
    assert "01" in ids and (tmp_path / "claims" / "story-01.md").read_text().strip()


BROWSERLESS = {"passed": 0, "total": 75, "tests": [{"title": "golden path", "status": "failed",
               "error": "Error: browserType.launch: Executable doesn't exist at ~/Library/Caches/ms-playwright/chromium"}]}
EXECUTABLE = 0o755
WRITES_THE_FOUR_OUTPUTS = """#!/bin/sh
for f in build-A.jsonl build-B.jsonl test-faults.jsonl; do : > "$f"; done
echo "# summary" > summary.md
"""


class JudgingJob:
    """What `judge.py --name ...` needs, all inside tmp_path: two recorded runs in the results repo, a private repo that
    ignores state/, and a pack in it with its spec, scope, held-out suite and grading brief."""

    def __init__(self, tmp_path, monkeypatch, accept=None):
        self.tmp = tmp_path
        self.repo = tmp_path / "awesome-local-ai"
        self.private = tmp_path / "awesome-local-ai-bench-private"
        self.private.mkdir()
        subprocess.run(["git", "init", "-q", str(self.private)], check=True)
        (self.private / ".gitignore").write_text("/state/\n")
        pack = self.private / "packs" / "vidi"
        (pack / "spec").mkdir(parents=True)
        (pack / "spec" / "spec.md").write_text("spec")
        (pack / "scope").mkdir()
        (pack / "scope" / "canvas.json").write_text('{"stories": []}')
        (pack / "acceptance" / "tests").mkdir(parents=True)
        (pack / "acceptance" / "tests" / "story-01.spec.ts").write_text("test")
        (pack / "acceptance" / "package.json").write_text("{}")  # the suite's package.json is copied; it has no lock file
        (pack / "GRADING.md").write_text("grade it")
        self.repo.mkdir()
        for name in ("alpha", "beta"):
            rec = fake_record(self.repo / name)
            (rec / "accept.json").write_text(json.dumps(accept or {"passed": 3, "total": 4, "tests": []}))
            (rec / "agent-reports").mkdir()
            (rec / "agent-reports" / "story-01.md").write_text(f"{name} says done")
        monkeypatch.setattr(judge, "REPO", self.repo)
        monkeypatch.setattr(packdir, "REPO_ROOT", self.repo)
        monkeypatch.setenv(packdir.ENV, str(pack))

    def argv(self, monkeypatch, *args, name="job"):
        builds = ["--build", "opus=alpha/rec", "--build", "pi=beta/rec"]
        monkeypatch.setattr("sys.argv", ["judge.py", "--name", name, "--label", "fake", *builds, *args])


def test_the_command_needs_macos(tmp_path, monkeypatch):
    JudgingJob(tmp_path, monkeypatch).argv(monkeypatch)
    monkeypatch.setattr(judge.sys, "platform", "linux")
    with pytest.raises(SystemExit, match="judge.py needs macOS"):
        judge.main()


def test_the_command_needs_exactly_two_builds(tmp_path, monkeypatch):
    JudgingJob(tmp_path, monkeypatch)
    monkeypatch.setattr("sys.argv", ["judge.py", "--name", "job", "--label", "fake", "--build", "opus=alpha/rec"])
    with pytest.raises(SystemExit, match="exactly two --build entries"):
        judge.main()


def test_the_command_writes_nothing_where_the_private_repo_does_not_ignore_state(tmp_path, monkeypatch):
    job = JudgingJob(tmp_path, monkeypatch)
    (job.private / ".gitignore").write_text("")
    job.argv(monkeypatch)
    with pytest.raises(SystemExit, match="must ignore /state/ before anything is written there"):
        judge.main()
    assert not (job.private / "state").exists()


def test_the_command_refuses_a_name_that_was_used(tmp_path, monkeypatch):
    job = JudgingJob(tmp_path, monkeypatch)
    (job.private / "state" / "keys").mkdir(parents=True)
    (job.private / "state" / "keys" / "job.json").write_text("{}")
    job.argv(monkeypatch)
    with pytest.raises(SystemExit, match="exists; choose a new name"):
        judge.main()


def test_the_command_refuses_a_run_whose_final_score_is_a_scorer_fault(tmp_path, monkeypatch):
    job = JudgingJob(tmp_path, monkeypatch)
    (job.repo / "beta" / "rec" / "accept.json").write_text(json.dumps(BROWSERLESS))
    job.argv(monkeypatch)
    with pytest.raises(SystemExit, match="pi: .*accept.json is a scorer fault, not a result .*no browser.* Re-score the run before judging it"):
        judge.main()
    assert not (job.private / "state" / "judging" / "job" / "package").exists()


def test_prepare_only_builds_the_blinded_package_with_real_commit_logs_and_stops(tmp_path, monkeypatch, capsys):
    job = JudgingJob(tmp_path, monkeypatch)
    job.argv(monkeypatch, "--prepare-only")
    judge.main()
    package = job.private / "state" / "judging" / "job" / "package"
    key = json.loads((job.private / "state" / "keys" / "job.json").read_text())
    assert sorted(key.values()) == ["opus", "pi"]
    for letter in key:
        commits = (package / f"build-{letter}" / "commits.txt").read_text()
        assert commits.index("story 1: pan") < commits.index("story 2: notes")  # build order, from the record's log
    assert (package / "acceptance" / "package.json").read_text() == "{}"
    assert not (package / "acceptance" / "playwright.config.ts").exists()  # the pack has none to copy
    assert not (job.private / "state" / "judging" / "job" / "run-1").exists()  # the judge was not run
    out = capsys.readouterr().out.splitlines()
    assert "opus: claims for stories 01" in out and "pi: claims for stories 01" in out
    assert out[-4:-1] == ["installing dependencies in package/acceptance", "installing dependencies in package/build-A/workspace",
                          "installing dependencies in package/build-B/workspace"]
    assert out[-1] == f"package ready, judge not run: {package}"


@mac_only
def test_a_whole_command_judges_collects_and_unblinds(tmp_path, monkeypatch, capsys):
    job = JudgingJob(tmp_path, monkeypatch)
    bindir = tmp_path / "tools" / "bin"
    bindir.mkdir(parents=True)
    (bindir / "codex").write_text(WRITES_THE_FOUR_OUTPUTS)
    (bindir / "codex").chmod(EXECUTABLE)
    codex_home = tmp_path / "codex-home"
    codex_home.mkdir()
    (codex_home / "auth.json").write_text("{}")
    monkeypatch.setenv("CODEX_HOME", str(codex_home))
    monkeypatch.setenv("PATH", f"{bindir}:{Path(shutil.which('node')).parent}:{os.environ['PATH']}")
    audit = tmp_path / "audit.jsonl"
    audit.write_text("")
    job.argv(monkeypatch, "--audit", f"opus={audit}", "--audit", f"pi={audit}")
    judge.main()
    results = job.private / "state" / "judging" / "job" / "results" / "fake-run-1"
    assert sorted(p.name for p in results.iterdir() if p.name != "report.md") == sorted([*judge.OUTPUTS, "transcript.jsonl"])
    assert (results / "report.md").exists()  # judge_collect ran on it, with the key and the audits
    out = capsys.readouterr().out.splitlines()
    assert "run-1: judge exited 0; missing outputs: none" in out
    assert out[-1] == f"done: {job.private / 'state' / 'judging' / 'job' / 'results'}"
