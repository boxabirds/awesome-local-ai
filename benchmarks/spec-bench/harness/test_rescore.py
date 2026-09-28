"""rescore.py: a finished run's held-out scores recomputed under another pack version, from each
story's recorded code, without touching the run's own scores."""
import json
from pathlib import Path

from rescore import checkpoints, out_dir


def _metrics(tmp_path: Path, stories: dict, processed: list) -> Path:
    (tmp_path / "metrics.json").write_text(json.dumps({"stories": stories, "processed": processed}))
    return tmp_path


def test_checkpoints_follow_the_processed_order_with_everything_built_so_far(tmp_path):
    run = _metrics(tmp_path,
                   {"1": {"commit": "aaa", "finished": 1}, "2": {"commit": "bbb", "finished": 1},
                    "5": {"commit": "ccc", "finished": 1}},
                   [{"id": 1, "status": "DONE"}, {"id": 2, "status": "PARTIAL"}, {"id": 5, "status": "DONE"}])
    cps = checkpoints(run)
    assert [(c["story"], c["commit"]) for c in cps] == [(1, "aaa"), (2, "bbb"), (5, "ccc")]
    assert cps[2]["processed"] == [{"id": 1, "status": "DONE"}, {"id": 2, "status": "PARTIAL"},
                                   {"id": 5, "status": "DONE"}]


def test_a_story_without_recorded_code_is_left_out(tmp_path):
    """Scored once at the end (Opus run-1) or never finished: no per-story code to score."""
    run = _metrics(tmp_path, {"1": {"commit": "aaa", "finished": 1}, "2": {"finished": 1}},
                   [{"id": 1, "status": "DONE"}, {"id": 2, "status": "DONE"}])
    assert [c["story"] for c in checkpoints(run)] == [1]


def test_rescores_go_beside_the_runs_own_scores(tmp_path):
    """Never over them: the original version's scores stay the record of what was measured then."""
    assert out_dir(tmp_path, "vidi-v1.2") == tmp_path / "rescore" / "vidi-v1.2"
