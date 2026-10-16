from cutpy.core import publish


def test_publish_adds_a_run():
    assert publish("r", "x") == "ok:r/x"


def test_publish_amends_a_run():
    assert publish("r", "x", amend=True) == "ok:r/x"


def test_publish_reports_a_failed_add():
    assert publish("r", "") == "failed"


def test_publish_reports_a_failed_amend():
    assert publish("r", "", amend=True) == "failed"
