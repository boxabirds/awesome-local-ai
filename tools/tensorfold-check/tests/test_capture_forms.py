"""The recorded session run-checks.sh renders is now the raw event log where the checkout has it, else the compact
copy. capture_pi_requests.mjs must give the same request bodies from either form of the same session (a real excerpt
from the lake, with its per-token deltas in the raw form only)."""

import gzip
import json
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
CAPTURE = HERE.parent / "capture_pi_requests.mjs"
EXCERPT = HERE.parent.parent.parent / "benchmarks" / "spec-bench" / "harness" / "fixtures" / "events" / "pi"
TIMEOUT_S = 120
MODEL = "tf"

pytestmark = pytest.mark.skipif(not (shutil.which("pi") and shutil.which("node")),
                                reason="pi and node are needed: the requests are rendered with pi's own code")


def _bodies(log: Path, out: Path) -> list[dict]:
    subprocess.run(["node", str(CAPTURE), "--log", str(log), "--out", str(out), "--model", MODEL],
                   check=True, capture_output=True, text=True, timeout=TIMEOUT_S)
    return [json.loads(gzip.open(p, "rt").read()) for p in sorted(out.glob("*.json.gz"))]


def test_the_same_requests_come_from_the_raw_log_and_from_its_compact_copy(tmp_path):
    raw = _bodies(EXCERPT / "agent-events.jsonl", tmp_path / "raw")
    compact = _bodies(EXCERPT / "agent-events.compact.jsonl.gz", tmp_path / "compact")
    assert raw and raw == compact
