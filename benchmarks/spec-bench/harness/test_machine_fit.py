"""machine_fit.py: a run the swap or memory guard stopped resumes only once the machine has recovered.

1 Oct 2026, mlx-serve v2-r2 story 9: swap grew 4 GB (2.3 -> 6.4 GB) and the swap guard stopped the run, saying
"check memory before resuming"; but it exited like any crash, and dbench restarted it 30 s later without looking.
Now the guard leaves a marker and exits EXIT_MACHINE_UNFIT; run.sh checks the machine before anything that would
take memory (the preflight's builds, the model server), and dbench waits instead of counting a restart."""
import json
import re
from pathlib import Path

import pytest

import machine_fit as mf

STOPPED = {"story": 9, "reason": "SWAP GUARD: swap grew 4.0 GB during the story (2.3 -> 6.4 GB)",
           "swap_start_gb": 2.31, "swap_max_gb": 6.36, "free_min_pct": 12.0}


def test_no_marker_is_fit(tmp_path):
    assert mf.check(tmp_path, swap_gb=50.0, free_pct=1.0) == (True, "")


@pytest.mark.parametrize("swap,free,fit", [
    (6.4, 40.0, False),                                   # swap still where the guard stopped it
    (2.31 + mf.SWAP_RECOVERED_MARGIN_GB + 0.1, 40.0, False),
    (2.6, mf.FREE_RECOVERED_PCT - 1, False),              # swap back, memory still short
    (2.6, mf.FREE_RECOVERED_PCT, True),                   # swap recovered, and just enough memory free
    (2.6, None, True),                                    # free memory unknown: swap decides
])
def test_fit_again_once_swap_is_back_near_the_story_s_start_and_memory_is_free(tmp_path, swap, free, fit):
    mf.record_unfit(tmp_path, **STOPPED)
    ok, why = mf.check(tmp_path, swap_gb=swap, free_pct=free)
    assert ok is fit
    assert (why == "") is fit and (fit or "story 9" in why)


def test_the_marker_says_what_stopped_the_run(tmp_path):
    mf.record_unfit(tmp_path, **STOPPED)
    m = json.loads((tmp_path / mf.UNFIT_FILE).read_text())
    assert m["story"] == 9 and m["swap_start_gb"] == 2.31 and "SWAP GUARD" in m["reason"] and m["at"] > 0


def test_main_waits_with_the_unfit_exit_and_clears_the_marker_once_fit(tmp_path, monkeypatch, capsys):
    mf.record_unfit(tmp_path, **STOPPED)
    monkeypatch.setattr(mf, "readings", lambda: (6.0, 40.0))
    assert mf.main([str(tmp_path)]) == mf.EXIT_MACHINE_UNFIT
    assert (tmp_path / mf.UNFIT_FILE).exists() and "MACHINE UNFIT" in capsys.readouterr().err
    monkeypatch.setattr(mf, "readings", lambda: (2.5, 45.0))
    assert mf.main([str(tmp_path)]) == 0
    assert not (tmp_path / mf.UNFIT_FILE).exists()


def test_the_exit_code_is_dbench_s():
    rs = (Path(__file__).parents[3] / "tools" / "dbench" / "src" / "runner.rs").read_text()
    assert re.search(rf"EXIT_MACHINE_UNFIT: i32 = {mf.EXIT_MACHINE_UNFIT};", rs)


def test_drive_stops_with_the_unfit_exit_when_a_guard_stopped_the_story(tmp_path):
    import drive
    for conditions in ({"aborted_swap": True, "aborted_memory": False, "swap_start_gb": 2.31, "swap_max_gb": 6.36,
                        "free_min_pct": 20.0},
                       {"aborted_swap": False, "aborted_memory": True, "swap_start_gb": 1.0, "swap_max_gb": 1.2,
                        "free_min_pct": 6.0}):
        with pytest.raises(SystemExit) as e:
            drive.stop_if_machine_unfit(tmp_path, 9, conditions)
        assert e.value.code == mf.EXIT_MACHINE_UNFIT
        assert json.loads((tmp_path / mf.UNFIT_FILE).read_text())["story"] == 9
    drive.stop_if_machine_unfit(tmp_path, 9, {"aborted_swap": False, "aborted_memory": False})   # carries on


RUN_SH = Path(__file__).with_name("run.sh").read_text()


def _line(pattern: str) -> int:
    return next(i for i, l in enumerate(RUN_SH.splitlines()) if re.search(pattern, l))


def test_run_sh_checks_the_machine_before_anything_takes_memory():
    check = _line(r"uv run[^\n]*machine_fit\.py")
    assert check < _line(r"preflight\.py") and check < _line(r"echo \"starting \$SERVER_CMD")
    assert "exit $?" in RUN_SH.splitlines()[check] or "exit \"$" in RUN_SH.splitlines()[check]
