"""run.sh's partial-rerun arguments (story 23, partial.job_inputs).

A partial rerun names the reference run as the lake knows it (--from-run) and brings its code and record as files
(--from-code, --from-metrics): run.sh refuses a partial rerun without both files, and the files without the run,
before it looks at the install or starts anything. Each refusal exits 2 with its own message.
"""
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
RUN_SH = HERE / "run.sh"
USAGE_EXIT = 2
NOT_INSTALLED_EXIT = 1
LAKE_RUN = "combinations/q/s/benchmarks/vidi/ref-run"
NEEDS_INPUTS = ("--from-run needs --from-code and --from-metrics: the reference run's code and record, which the job "
                "brings from the lake")
INPUTS_NEED_RUN = "--from-code and --from-metrics go with --from-run"


def run_sh(tmp_path: Path, *args: str) -> subprocess.CompletedProcess:
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    return subprocess.run(["bash", str(RUN_SH), "no-such-install", *args], cwd=tmp_path, capture_output=True,
                          text=True, env={"HOME": str(home), "PATH": "/usr/bin:/bin"})


@pytest.fixture
def inputs(tmp_path):
    code, metrics = tmp_path / "code.bundle", tmp_path / "metrics.json"
    code.write_bytes(b"bundle")
    metrics.write_text("{}")
    return str(code), str(metrics)


@pytest.mark.parametrize("args, message", [
    (("--from-run", LAKE_RUN, "--only", "3"), NEEDS_INPUTS),
    (("--from-run", LAKE_RUN, "--from-code", "CODE", "--only", "3"), NEEDS_INPUTS),
    (("--from-run", LAKE_RUN, "--from-metrics", "METRICS", "--only", "3"), NEEDS_INPUTS),
    (("--from-run", LAKE_RUN, "--from-code", "absent.bundle", "--from-metrics", "METRICS", "--only", "3"), NEEDS_INPUTS),
    (("--from-code", "CODE", "--from-metrics", "METRICS", "--only", "3"), INPUTS_NEED_RUN),
    (("--from-metrics", "METRICS"), INPUTS_NEED_RUN),
])
def test_a_partial_rerun_is_refused_without_both_inputs_or_inputs_without_the_run(tmp_path, inputs, args, message):
    by_name = {"CODE": inputs[0], "METRICS": inputs[1]}
    p = run_sh(tmp_path, *[by_name.get(a, a) for a in args])
    assert (p.returncode, p.stderr.strip()) == (USAGE_EXIT, message)


def test_a_partial_rerun_with_its_run_and_both_inputs_gets_past_the_argument_checks(tmp_path, inputs):
    p = run_sh(tmp_path, "--from-run", LAKE_RUN, "--from-code", inputs[0], "--from-metrics", inputs[1], "--only", "3")
    # The next check is the install, which this test does not have.
    assert p.returncode == NOT_INSTALLED_EXIT and "no-such-install is not installed" in p.stderr, p.stderr
