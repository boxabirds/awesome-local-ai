"""backfill_timing.py: a finished run's stories that have no model time get it from the full event logs the
machine kept, computed exactly as a live run computes it (drive.time_split)."""
import json
from pathlib import Path

import backfill_timing


def run_with(tmp_path: Path) -> Path:
    run = tmp_path / "run"
    for sid, model in (("1", None), ("2", {"source": "llama-log", "prefill_s": 1.0})):
        d = run / "stories" / f"0{sid}"
        d.mkdir(parents=True)
        (d / "agent-events.jsonl").write_text("\n".join(json.dumps(e) for e in [
            {"_rx": 10.0, "type": "message_start", "message": {"role": "assistant"}},
            {"_rx": 12.0, "type": "message_update"},
            {"_rx": 20.0, "type": "message_end", "message": {"role": "assistant", "usage": {"input": 2000, "output": 800}}},
        ]) + "\n")
    (run / "metrics.json").write_text(json.dumps({"stories": {
        "1": {"started": 0.0, "agent_finished": 60.0, "time_split": {"wall_s": 60.0, "model": None, "tools_s": 0.0, "compaction_s": 0.0, "other_s": 60.0}},
        "2": {"started": 0.0, "agent_finished": 60.0, "time_split": {"wall_s": 60.0, "model": {"source": "llama-log", "prefill_s": 1.0}, "tools_s": 0, "compaction_s": 0, "other_s": 59}},
    }}))
    return run


def test_fills_only_the_stories_without_model_time(tmp_path):
    run = run_with(tmp_path)
    assert backfill_timing.backfill(run) == ["1"]
    m = json.loads((run / "metrics.json").read_text())["stories"]
    assert m["1"]["time_split"]["model"]["source"] == "client-stream"
    assert m["1"]["time_split"]["model"]["prefill_s"] == 2.0 and m["1"]["time_split"]["other_s"] == 50.0
    assert m["1"]["time_split"]["backfilled"] is True
    assert m["2"]["time_split"]["model"] == {"source": "llama-log", "prefill_s": 1.0}   # left alone


def test_a_story_whose_full_log_is_gone_is_left_as_it_was(tmp_path):
    run = run_with(tmp_path)
    (run / "stories" / "01" / "agent-events.jsonl").unlink()
    assert backfill_timing.backfill(run) == []


def test_running_it_twice_changes_nothing_the_second_time(tmp_path):
    run = run_with(tmp_path)
    backfill_timing.backfill(run)
    assert backfill_timing.backfill(run) == []
