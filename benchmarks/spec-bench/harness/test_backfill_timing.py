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


# ---------- the lossless log, restarted stories and provenance (30 Sep 2026) ----------

import gzip

import attempts
import heldout

T0 = 1_790_000_000.0


def _pi_session(t: float, calls: int) -> list[dict]:
    out = [{"_rx": t, "type": "session", "id": "s1"}]
    for i in range(calls):
        c = t + 1 + i * 20
        out += [{"_rx": c, "type": "message_start", "message": {"role": "assistant"}},
                {"_rx": c + 2, "type": "message_update", "delta": "a"},
                {"_rx": c + 3, "type": "message_update", "delta": "b"},
                {"_rx": c + 10, "type": "message_end", "message": {"role": "assistant", "content": [{"type": "text", "text": "x" * 3000}],
                                                                   "usage": {"input": 100, "output": 5}}},
                {"_rx": c + 10, "type": "tool_execution_start", "toolCallId": f"{c}", "toolName": "bash", "args": {"command": "ls"}},
                {"_rx": c + 15, "type": "tool_execution_end", "toolCallId": f"{c}", "toolName": "bash"}]
    return out


def restarted_run(tmp_path: Path) -> Path:
    """A run recorded before this fix: story 1 restarted mid-way (two harness attempts in its log, the record
    covering the last), story 2 run once; the old truncated compact logs; run.sh's two starts."""
    run = tmp_path / "run"
    logs = {"1": _pi_session(T0, 3) + _pi_session(T0 + 5000, 2), "2": _pi_session(T0 + 9000, 1)}
    for sid, events in logs.items():
        d = run / "stories" / f"0{sid}"
        d.mkdir(parents=True)
        (d / "agent-events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in events))
        with gzip.open(d / "agent-events.compact.jsonl.gz", "wt") as f:     # the old kind: cut strings, no deltas
            f.write("".join(json.dumps({**e, "message": {"role": "assistant", "content": "cut…[truncated 9 chars]"}}
                                       if e["type"] == "message_end" else e) + "\n"
                            for e in events if e["type"] != "message_update"))
    agent = lambda steps, seconds: {"seconds": seconds, "steps": steps, "tool_calls": steps, "compactions": 0,
                                    "tokens": {"input": 100 * steps, "output": 5 * steps}, "sessions": ["s1"], "nudges": 0}
    heldout.save_metrics(run, {"client": "pi", "stories": {
        "1": {"started": T0 + 4999.5, "agent_finished": T0 + 5041, "agent": agent(2, 41.5)},
        "2": {"started": T0 + 8999.5, "agent_finished": T0 + 9021, "agent": agent(1, 21.5)}},
        "processed": [{"id": 1, "agent_minutes": 0.7, "calls": 2, "output_tokens": 10, "compactions": 0},
                      {"id": 2, "agent_minutes": 0.4, "calls": 1, "output_tokens": 5, "compactions": 0}]})
    (run / "run-history.jsonl").write_text(json.dumps({"started_at": "2026-09-21T13:46:00Z", "harness_commit": "aaa1111",
                                                       "pack_version": "demo-v1"}) + "\n")
    (run / "run.json").write_text(json.dumps({"started_at": "2026-09-21T15:08:00Z", "harness_commit": "bbb2222",
                                              "pack_version": "demo-v2"}))
    return run


def test_the_lossless_log_is_rebuilt_from_the_machine_s_full_log(tmp_path):
    run = restarted_run(tmp_path)
    assert backfill_timing.backfill_events(run) == ["01", "02"]
    text = gzip.open(run / "stories" / "01" / "agent-events.compact.jsonl.gz", "rt").read()
    assert "truncated" not in text and "x" * 3000 in text and '"message_update"' in text


def test_a_story_without_its_full_log_keeps_its_published_log(tmp_path):
    run = restarted_run(tmp_path)
    (run / "stories" / "02" / "agent-events.jsonl").unlink()
    before = (run / "stories" / "02" / "agent-events.compact.jsonl.gz").read_bytes()
    assert backfill_timing.backfill_events(run) == ["01"]
    assert (run / "stories" / "02" / "agent-events.compact.jsonl.gz").read_bytes() == before


def test_a_restarted_story_is_recomputed_over_every_attempt(tmp_path):
    run = restarted_run(tmp_path)
    assert backfill_timing.backfill_attempts(run) == ["1"]
    m = heldout.load_metrics(run)
    s1 = m["stories"]["1"]
    assert s1["agent"]["restarted"] and s1["agent"]["harness_attempts"] == 2 and s1["agent"]["steps"] == 5
    assert s1["time_split"]["attempts"] == 2 and s1["time_split"]["model"]["requests"] == 5
    assert s1["first_started"] == T0
    p1 = next(p for p in m["processed"] if p["id"] == 1)
    assert p1["calls"] == 5 and p1["output_tokens"] == 25 and p1["agent_minutes"] == round(s1["agent"]["seconds"] / 60, 1)
    assert "restarted" not in m["stories"]["2"]["agent"]
    assert backfill_timing.backfill_attempts(run) == []               # idempotent


def test_a_restarted_story_recomputed_from_an_old_published_log_keeps_its_counts_only(tmp_path):
    """On the Mac, where only the published log is: counts across attempts, no time split from a log without timing."""
    run = restarted_run(tmp_path)
    for d in ("01", "02"):
        (run / "stories" / d / "agent-events.jsonl").unlink()
    assert backfill_timing.backfill_attempts(run) == ["1"]
    s1 = heldout.load_metrics(run)["stories"]["1"]
    assert s1["agent"]["steps"] == 5 and s1["time_split_covers"] == attempts.TIME_SPLIT_LAST_ONLY
    assert "time_split" not in s1


def test_recompute_of_a_restarted_story_s_timing_keeps_every_attempt(tmp_path):
    run = restarted_run(tmp_path)
    backfill_timing.backfill_attempts(run)
    assert "1" in backfill_timing.backfill(run, recompute=True)
    ts = heldout.load_metrics(run)["stories"]["1"]["time_split"]
    assert ts["attempts"] == 2 and ts["model"]["requests"] == 5 and ts["backfilled"] is True


def test_provenance_is_filled_from_the_run_s_starts(tmp_path):
    run = restarted_run(tmp_path)
    backfill_timing.backfill_attempts(run)
    assert backfill_timing.backfill_provenance(run) == ["1", "2"]
    s = heldout.load_metrics(run)["stories"]
    # T0 is 14:13 UTC: story 1 started under the first start (13:46) and was restarted and scored under the second
    # (15:08); story 2 ran wholly under the second.
    assert attempts._epoch("2026-09-21T13:46:00Z") < T0 < attempts._epoch("2026-09-21T15:08:00Z") < T0 + 5000
    assert s["1"]["provenance"] == {"harness_commit": "bbb2222", "pack_version": "demo-v2", "source": "run-history",
                                    "run_started_at": "2026-09-21T15:08:00Z",
                                    "started_under": {"harness_commit": "aaa1111", "pack_version": "demo-v1"}}
    assert s["2"]["provenance"]["pack_version"] == "demo-v2" and "started_under" not in s["2"]["provenance"]


def test_backfill_all_runs_each_step_in_order_and_reports_them(tmp_path):
    run = restarted_run(tmp_path)
    report = backfill_timing.backfill_all(run)
    assert list(report) == ["events", "attempts", "timing", "conversation", "provenance"]
    assert report["events"] == ["01", "02"] and report["attempts"] == ["1"]
