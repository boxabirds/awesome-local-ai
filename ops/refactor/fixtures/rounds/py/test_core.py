from cutpy.core import publish_all


def test_publish_all_records_a_run():
    assert publish_all("r", "x") == "ok:r/x"


def test_publish_all_reports_a_failure():
    assert publish_all("r", "") == "failed"
