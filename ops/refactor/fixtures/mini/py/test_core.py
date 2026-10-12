from minipy.core import record, run_dir


def test_record_keeps_only_what_fits_under_the_limit():
    assert record(["a", "b", "c"], 2) == ["a", "b"]


def test_run_dir_joins_the_root_and_the_run_id():
    assert run_dir("/data", "r1") == "/data/r1"
