"""run-series.sh: runs strictly one after another; the background mode really runs them."""
import os
import subprocess
import time
from pathlib import Path

SCRIPT = Path(__file__).parent / "run-series.sh"
FAKE_RUN = """#!/usr/bin/env bash
run="$3"; echo "start $run $(date +%s%N)" >> "$TRACE"; sleep {sleep}; echo "end $run $(date +%s%N)" >> "$TRACE"
[[ "$run" == fail-me ]] && exit 3; exit 0
"""
POLL_S = 0.2
BACKGROUND_TIMEOUT_S = 30


def setup(tmp_path: Path, sleep: float = 0.3) -> dict:
    fake = tmp_path / "fake-run.sh"
    fake.write_text(FAKE_RUN.format(sleep=sleep))
    fake.chmod(0o755)
    return {**os.environ, "HOME": str(tmp_path), "RUN_SH": str(fake), "TRACE": str(tmp_path / "trace")}


def trace(tmp_path: Path) -> list[tuple[str, str, int]]:
    p = tmp_path / "trace"
    return [(k, r, int(t)) for k, r, t in (l.split() for l in p.read_text().splitlines())] if p.exists() else []


def sequential(events) -> bool:
    spans = {}
    for kind, run, t in events:
        spans.setdefault(run, {})[kind] = t
    runs = list(spans)
    return all(spans[a]["end"] <= spans[b]["start"] for a, b in zip(runs, runs[1:]))


def test_runs_are_strictly_sequential(tmp_path):
    env = setup(tmp_path)
    r = subprocess.run([str(SCRIPT), "inst", "--runs", "r1,r2,r3"], env=env, capture_output=True, text=True)
    ev = trace(tmp_path)
    assert r.returncode == 0 and [x[1] for x in ev if x[0] == "start"] == ["r1", "r2", "r3"] and sequential(ev)


def test_a_failed_run_stops_the_series(tmp_path):
    env = setup(tmp_path)
    r = subprocess.run([str(SCRIPT), "inst", "--runs", "r1,fail-me,r3"], env=env, capture_output=True, text=True)
    assert r.returncode == 3 and "r3" not in {x[1] for x in trace(tmp_path)}


def test_background_really_runs_every_run_and_reports_status(tmp_path):
    env = setup(tmp_path, sleep=1)
    r = subprocess.run([str(SCRIPT), "inst", "--runs", "r1,r2", "--background"], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    time.sleep(POLL_S * 3)
    status = subprocess.run([str(SCRIPT), "--status"], env=env, capture_output=True, text=True).stdout
    assert "series running" in status
    deadline = time.time() + BACKGROUND_TIMEOUT_S
    while time.time() < deadline and len([e for e in trace(tmp_path) if e[0] == "end"]) < 2:
        time.sleep(POLL_S)
    ev = trace(tmp_path)
    assert [x[1] for x in ev if x[0] == "end"] == ["r1", "r2"] and sequential(ev)
    time.sleep(POLL_S * 5)
    assert "no series running" in subprocess.run([str(SCRIPT), "--status"], env=env, capture_output=True, text=True).stdout
