"""run.sh checks the harness end to end before every run: the known-answer pipeline (test_pipeline.py) runs
first, and a failed or skipped self-test stops the run before the model server starts.

Why: on 30 Sep 2026 a harness change crashed at the end of every story (a shadowed variable in drive.main);
a run then spent hours building a story only to lose it, twice. A test of the whole story loop catches that
in about a minute; run.sh must not start hours of work without it passing."""
import re
from pathlib import Path

RUN_SH = Path(__file__).with_name("run.sh").read_text()


def _line(pattern: str) -> int:
    for i, line in enumerate(RUN_SH.splitlines()):
        if re.search(pattern, line):
            return i
    raise AssertionError(f"run.sh has no line matching {pattern!r}")


def test_the_self_test_runs_the_known_answer_pipeline():
    assert re.search(r"pytest[^\n]*test_pipeline\.py", RUN_SH)


def test_it_runs_before_the_model_server_and_the_agents_start():
    self_test = _line(r"pytest[^\n]*test_pipeline\.py")
    assert self_test < _line(r"echo \"starting \$SERVER_CMD")                 # the model server starts here
    assert self_test < _line(r"uv run --quiet drive\.py")


def test_a_failed_or_skipped_self_test_stops_the_run():
    block = RUN_SH[RUN_SH.index("harness self-test"):]
    block = block[:block.index("\n\n")]
    assert "exit 1" in block
    assert "skipped" in block          # a self-test that couldn't run is not a pass


def test_the_self_test_can_be_waived_only_by_name_for_a_single_run():
    # An escape hatch for an emergency, never the default: SKIP_SELF_TEST=1 on the command, and it says so.
    assert "SKIP_SELF_TEST" in RUN_SH and 'SKIP_SELF_TEST:-0' in RUN_SH
