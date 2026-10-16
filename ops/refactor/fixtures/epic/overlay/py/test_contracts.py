"""The miniature project's new contract tests: they pass against the real functions and fail against the stand-ins."""
from minipy.core import record, run_dir


def test_a_record_keeps_the_first_items():
    assert record(["x", "y", "z"], 1) == ["x"]


def test_a_run_lives_under_its_root():
    assert run_dir("/data", "r1") == "/data/r1"


def test_a_run_is_named_by_its_id():
    assert run_dir("/data", "r1").endswith("r1")
