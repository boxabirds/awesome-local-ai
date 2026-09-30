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


def test_recompute_redoes_backfilled_stories_and_any_whose_parts_overran_the_wall(tmp_path):
    run = run_with(tmp_path)
    m = json.loads((run / "metrics.json").read_text())
    m["stories"]["2"]["time_split"]["other_s"] = -500            # parts that added up to more than the wall
    (run / "metrics.json").write_text(json.dumps(m))
    assert backfill_timing.backfill(run) == ["1"]               # plain backfill: only the missing one
    assert backfill_timing.backfill(run, recompute=True) == ["1", "2"]
    assert json.loads((run / "metrics.json").read_text())["stories"]["2"]["time_split"]["other_s"] >= 0


def test_recompute_redoes_any_story_made_by_an_older_version_of_the_accounting(tmp_path):
    import accounting
    run = run_with(tmp_path)
    m = json.loads((run / "metrics.json").read_text())
    m["stories"]["2"]["time_split"]["accounting"] = {"version": accounting.VERSION - 1, "ok": True, "problems": []}
    (run / "metrics.json").write_text(json.dumps(m))
    assert "2" in backfill_timing.backfill(run, recompute=True)
    assert json.loads((run / "metrics.json").read_text())["stories"]["2"]["time_split"]["accounting"]["version"] == accounting.VERSION


def test_a_story_recorded_before_the_harness_kept_a_time_split_gets_one(tmp_path):
    run = run_with(tmp_path)
    m = json.loads((run / "metrics.json").read_text())
    del m["stories"]["1"]["time_split"]
    (run / "metrics.json").write_text(json.dumps(m))
    assert backfill_timing.backfill(run) == ["1"]
    ts = json.loads((run / "metrics.json").read_text())["stories"]["1"]["time_split"]
    assert ts["wall_s"] == 60.0 and ts["model"]["prefill_s"] == 2.0 and ts["accounting"]["ok"]


def test_conversation_profiles_are_filled_where_missing_and_kept_where_present(tmp_path):
    run = run_with(tmp_path)
    m = json.loads((run / "metrics.json").read_text())
    for rec in m["stories"].values():
        rec["agent_finished"] = 60.0
    m["stories"]["2"]["conversation"] = {"version": 1, "calls": 99}
    (run / "metrics.json").write_text(json.dumps(m))
    assert backfill_timing.backfill_conversation(run) == ["1"]
    got = json.loads((run / "metrics.json").read_text())["stories"]
    assert got["1"]["conversation"]["calls"] == 1 and got["2"]["conversation"] == {"version": 1, "calls": 99}
    assert backfill_timing.backfill_conversation(run) == []           # a second pass changes nothing


def test_a_log_that_cant_be_profiled_records_nothing(tmp_path):
    run = run_with(tmp_path)
    (run / "stories" / "01" / "agent-events.jsonl").write_text('{"type": "session"}\n')  # no stamps, no calls
    assert "1" not in backfill_timing.backfill_conversation(run)
    assert "conversation" not in json.loads((run / "metrics.json").read_text())["stories"]["1"]
