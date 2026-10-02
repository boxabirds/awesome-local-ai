"""One table of size limits for committed benchmark files (publicise.SIZE_LIMITS), used by both the harness
(drive.make_publishable reports files over their limit) and tests/privacy-test.sh (refuses them once committed).

1 Oct 2026: the harness held every file but the conversation log to a flat 512 KB, while the privacy test allowed
20 MB for workspace.bundle, so recording gufo v2-r3 warned that its 681 KB bundle was over the limit."""
import subprocess
import sys
from pathlib import Path

import pytest

import drive
import publicise

KB, MB = 1024, 1024 * 1024
HERE = Path(__file__).parent
PRIVACY_TEST = HERE.parents[2] / "tests" / "privacy-test.sh"
RUN = "combinations/a/stack/benchmarks/vidi/r1"


@pytest.mark.parametrize("path,limit", [
    (f"{RUN}/workspace.bundle", 20 * MB),
    (f"{RUN}/workspace/tests/big-image.png", 20 * MB),
    (f"{RUN}/stories/01/agent-events.compact.jsonl.gz", 50 * MB),
    (f"{RUN}/metrics.json", 2 * MB),
    (f"{RUN}/summary.md", 512 * KB),
    (f"{RUN}/stories/01/accept-summary.json", 512 * KB),
    ("benchmarks/reference/vidi/opus-5.5/v2-r1/metrics.json", 2 * MB),
])
def test_each_kind_of_file_has_its_limit(path, limit):
    assert publicise.size_limit(path) == limit


def _sized(p: Path, n: int) -> Path:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"\0" * n)
    return p


def test_the_harness_does_not_warn_about_a_bundle_within_its_own_limit(tmp_path):
    run = tmp_path / RUN
    _sized(run / "workspace.bundle", 681 * KB)               # gufo v2-r3's bundle
    assert drive.make_publishable(run) == []


def test_the_harness_still_warns_about_a_file_over_its_limit(tmp_path):
    run = tmp_path / RUN
    big = _sized(run / "server-health.bin", 600 * KB)
    _sized(run / "workspace.bundle", 21 * MB)
    assert sorted(drive.make_publishable(run)) == sorted([str(big), str(run / "workspace.bundle")])


def test_the_command_line_lists_only_tracked_files_over_their_limit(tmp_path):
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    _sized(tmp_path / RUN / "workspace.bundle", 681 * KB)
    _sized(tmp_path / RUN / "summary.md", 600 * KB)
    _sized(tmp_path / RUN / "untracked-and-big.md", 600 * KB)
    subprocess.run(["git", "add", f"{RUN}/workspace.bundle", f"{RUN}/summary.md"], cwd=tmp_path, check=True)
    out = subprocess.run([sys.executable, str(HERE / "publicise.py"), "over-limit", str(tmp_path)],
                         capture_output=True, text=True, check=True).stdout.splitlines()
    assert out == [f"{RUN}/summary.md\t{600 * KB}\t{512 * KB}"]


def test_documentation_under_benchmarks_is_not_a_benchmark_record(tmp_path):
    """2 Oct 2026: the interactive guide (benchmarks/docs/guide/index.html, 615 KB) is documentation, not evidence a run
    published; the flat limit for records turned the privacy test red. Records under benchmarks/<anything else> keep it."""
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    _sized(tmp_path / "benchmarks/docs/guide/index.html", 615 * KB)
    _sized(tmp_path / "benchmarks/docs/insights/findings.md", 615 * KB)
    _sized(tmp_path / "benchmarks/other-pack/summary.md", 600 * KB)
    subprocess.run(["git", "add", "-A"], cwd=tmp_path, check=True)
    out = subprocess.run([sys.executable, str(HERE / "publicise.py"), "over-limit", str(tmp_path)],
                         capture_output=True, text=True, check=True).stdout.splitlines()
    assert out == [f"benchmarks/other-pack/summary.md\t{600 * KB}\t{512 * KB}"]


def test_the_privacy_test_takes_its_limits_from_the_same_table():
    text = PRIVACY_TEST.read_text()
    assert "publicise.py\" over-limit" in text or "publicise.py over-limit" in text
    assert "limit_for" not in text                          # no second table to drift from this one
