"""finalize.py: at the end of a run, bundle the workspace's history and re-score the final build under the
pack's exact suite version, so every finished run can be scored and judged without anyone doing it by hand."""
import json
import subprocess
from pathlib import Path

import finalize

IDENTITY = ["-c", "user.name=t", "-c", "user.email=t@t"]


def workspace_with_history(tmp_path: Path) -> Path:
    """A run's work dir as drive.py leaves it: <work>/workspace, a git repo with one commit per story."""
    work = tmp_path / "work"
    ws = work / "workspace"
    ws.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", "-b", "main", str(ws)], check=True)
    for n in (1, 2):
        (ws / f"f{n}.txt").write_text(str(n))
        subprocess.run(["git", *IDENTITY, "-C", str(ws), "add", "."], check=True)
        subprocess.run(["git", *IDENTITY, "-C", str(ws), "commit", "-q", "-m", f"story {n}"], check=True)
    return work


def run_dir(tmp_path: Path, work: Path) -> Path:
    run = tmp_path / "run"
    run.mkdir()
    (run / "work_dir.txt").write_text(str(work) + "\n")
    return run


def fake_rescore(passed: int, total: int, calls: list):
    """Stands in for rescore.py --final: writes what it would, without a browser."""
    def rescore(run: Path, bundle: Path, version: str) -> None:
        calls.append((run, bundle, version))
        out = run / "rescore" / version
        out.mkdir(parents=True)
        (out / "rescore.json").write_text(json.dumps({"pack_version": version, "results": [{"story": 2, "passed": passed, "total": total}]}))
    return rescore


def test_decide_rescores_only_under_the_exact_pack_ref():
    assert finalize.decide("vidi-v2.0-pre2", "vidi-v2.0-pre2", already=False) == ("rescore", "")
    action, why = finalize.decide("vidi-v2.0-pre2+22a2164", "vidi-v2.0-pre2", already=False)
    assert action == "skip" and "vidi-v2.0-pre2+22a2164" in why and "vidi-v2.0-pre2" in why
    assert finalize.decide("vidi-v2.0-pre2", "vidi-v2.0-pre2", already=True)[0] == "skip"
    assert finalize.decide("vidi-v1", "", already=False) == ("rescore", "")  # a pack without a pinned private suite


def test_a_finished_run_gets_its_bundle_and_final_score_and_says_so(tmp_path):
    work = workspace_with_history(tmp_path)
    run = run_dir(tmp_path, work)
    calls, messages = [], []
    out = finalize.finalize(run, pack_ref="vidi-v2.0-pre2", version="vidi-v2.0-pre2",
                            rescore=fake_rescore(74, 75, calls), record=messages.append)
    heads = subprocess.run(["git", "bundle", "list-heads", str(run / "workspace.bundle")], capture_output=True, text=True).stdout
    head = subprocess.run(["git", "-C", str(work / "workspace"), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
    assert head in heads                                        # the bundle ends at the final story's commit
    assert calls == [(run, run / "workspace.bundle", "vidi-v2.0-pre2")]
    assert out["score"] == "74/75" and out["rescore"] == "done"
    assert json.loads((run / "finalize.json").read_text())["score"] == "74/75"
    assert messages == ["final score 74/75 under vidi-v2.0-pre2"]


def test_a_suite_checkout_off_its_tag_is_not_scored_and_the_record_says_why(tmp_path):
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    calls, messages = [], []
    out = finalize.finalize(run, pack_ref="vidi-v2.0-pre2", version="vidi-v2.0-pre2+22a2164",
                            rescore=fake_rescore(75, 75, calls), record=messages.append)
    assert calls == []
    assert (run / "workspace.bundle").is_file()                 # still judgeable once scored by hand
    assert out["rescore"] == "skipped"
    assert "not re-scored" in messages[0] and "vidi-v2.0-pre2+22a2164" in messages[0]


def test_a_run_already_finalized_is_left_alone(tmp_path):
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    calls = []
    finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=fake_rescore(75, 75, calls), record=None)
    finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=fake_rescore(75, 75, calls), record=None)
    assert len(calls) == 1


def test_a_failed_rescore_is_reported_not_raised(tmp_path):
    run = run_dir(tmp_path, workspace_with_history(tmp_path))
    messages = []

    def broken(run, bundle, version):
        raise RuntimeError("no browser")
    out = finalize.finalize(run, "vidi-v2.0-pre2", "vidi-v2.0-pre2", rescore=broken, record=messages.append)
    assert out["rescore"] == "failed" and "no browser" in out["reason"]
    assert (run / "workspace.bundle").is_file()
    assert "re-score failed" in messages[0]
