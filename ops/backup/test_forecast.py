"""forecast.py: when a backup repository's target will be full, from the last week's growth, and whether the last backup is stale.

Why: the lake, warehouse and analytics sit on one disk with no copy (9 Oct 2026). The owner asked for a warning at the end of every
backup when a repository has under a month of room left at the last week's rate. Benchmarking is not constant, so the rate follows
the week: a quiet week gives a long horizon and no alarm.
"""
import pytest

import forecast as fc

DAY = 86400.0
GB = 1_000_000_000
NOW = 1_800_000_000.0


def hist(*pairs):
    """History from (days ago, repository GB) pairs."""
    return [{"t": NOW - d * DAY, "bytes": int(gb * GB)} for d, gb in pairs]


def test_a_busy_week_at_4_gb_a_day_with_80_gb_free_has_20_days_left_and_warns():
    r = fc.forecast(hist((7, 10), (0, 38)), free_bytes=80 * GB, now=NOW)
    assert r["status"] == "warn" and r["growth_per_day"] == pytest.approx(4 * GB)
    assert r["days_left"] == pytest.approx(20.0) and "20 days" in r["message"] and "4.0 GB a day" in r["message"]


def test_a_quiet_week_has_a_long_horizon_and_no_warning():
    r = fc.forecast(hist((7, 40), (0, 40.7)), free_bytes=80 * GB, now=NOW)
    assert r["status"] == "ok" and r["days_left"] > 700


def test_exactly_the_warning_horizon_is_not_a_warning_and_a_day_under_is():
    assert fc.forecast(hist((7, 0), (0, 7)), free_bytes=30 * GB, now=NOW)["status"] == "ok"           # 1 GB a day, 30 days
    assert fc.forecast(hist((7, 0), (0, 7)), free_bytes=29 * GB, now=NOW)["status"] == "warn"


def test_only_the_last_week_counts():
    old_burst = hist((30, 0), (20, 100), (7, 100), (0, 100.7))   # a huge month ago, quiet since
    r = fc.forecast(old_burst, free_bytes=80 * GB, now=NOW)
    assert r["status"] == "ok" and r["growth_per_day"] == pytest.approx(0.1 * GB)


def test_a_shrinking_or_flat_repository_never_fills():
    for h in (hist((7, 40), (0, 40)), hist((7, 40), (0, 30))):
        r = fc.forecast(h, free_bytes=1 * GB, now=NOW)
        assert r["status"] == "ok" and r["days_left"] is None and "not growing" in r["message"]


def test_under_a_day_of_history_is_not_enough_and_says_so_without_a_figure():
    r = fc.forecast(hist((0.5, 4), (0, 5)), free_bytes=1 * GB, now=NOW)
    assert r["status"] == "no-history" and r["days_left"] is None and "not enough history" in r["message"]
    assert fc.forecast([], free_bytes=1 * GB, now=NOW)["status"] == "no-history"
    assert fc.forecast(hist((0, 5)), free_bytes=1 * GB, now=NOW)["status"] == "no-history"


def test_between_one_and_seven_days_of_history_gives_a_forecast_labelled_provisional():
    r = fc.forecast(hist((3, 10), (0, 22)), free_bytes=40 * GB, now=NOW)
    assert r["status"] == "warn" and r["days_left"] == pytest.approx(10.0) and "provisional" in r["message"] and "3 days" in r["message"]
    assert "provisional" not in fc.forecast(hist((7, 10), (0, 11)), free_bytes=40 * GB, now=NOW)["message"]


def test_a_backup_older_than_36_hours_is_stale():
    assert fc.staleness(last_good=NOW - 35 * 3600, now=NOW)["status"] == "ok"
    s = fc.staleness(last_good=NOW - 37 * 3600, now=NOW)
    assert s["status"] == "stale" and "37 hours" in s["message"]
    assert fc.staleness(last_good=None, now=NOW)["status"] == "stale"
