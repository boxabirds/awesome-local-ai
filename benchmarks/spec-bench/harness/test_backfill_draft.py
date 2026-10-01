"""backfill_draft.py: stories recorded without draft figures (gufo and mlx-serve v2 runs: their time came from pi's
stream, and only llama-server's log was read for drafts) get them from the server's log the run kept."""
import json
from pathlib import Path

import backfill_draft
import backfill_timing
import heldout
import llama_log
from test_backfill_timing import T0, restarted_run


IN = 100                  # every restarted_run call's prompt tokens
FIRST_OUT = 11            # its output tokens, made distinct here as a real run's are (no two alike in a server run)


def _mlx_serve_log(started: float, drafts: list[tuple[int, int, int]]) -> str:
    """mlx-serve's log as the real one (fixtures/engine-logs/mlx-serve-excerpt.txt): per request (accepts, drafted, attempts)
    and its tokens, the run's calls in order."""
    return llama_log.start_marker(started) + "".join(
        f"POST /v1/chat/completions (2 msgs, stream=true)\n"
        f"  [spec-stats] mode=mtp attempts={r} accepts={a} drafted={d} runtime_disabled=false\n"
        f"  <- {IN}+{FIRST_OUT + i} tokens streamed [prefill: 1.0 tok/s, decode: 1.0 tok/s] [tool_calls]\n"
        for i, (a, d, r) in enumerate(drafts))


def drafted_run(tmp_path: Path) -> Path:
    """restarted_run timed the way it was recorded (no draft figures), with the server's log beside it: story 1's
    five calls over two attempts, then story 2's one."""
    run = restarted_run(tmp_path)
    n = FIRST_OUT
    for sid in ("01", "02"):
        log = run / "stories" / sid / "agent-events.jsonl"
        events = [json.loads(line) for line in log.read_text().splitlines()]
        for e in events:
            if e["type"] == "message_end":
                e["message"]["usage"]["output"], n = n, n + 1
        log.write_text("".join(json.dumps(e) + "\n" for e in events))
    backfill_timing.backfill_attempts(run)
    backfill_timing.backfill(run)
    (run / "server.log").write_text(_mlx_serve_log(T0 - 60, [(3, 4, 1)] * 3 + [(1, 4, 1)] * 2 + [(2, 2, 1)]))
    return run


def test_draft_figures_are_filled_from_the_engine_s_log_for_every_story_and_attempt(tmp_path):
    run = drafted_run(tmp_path)
    before = heldout.load_metrics(run)["stories"]
    assert all("draft_acceptance" not in s["time_split"]["model"] for s in before.values())
    assert backfill_draft.backfill(run) == ["1", "2"]
    got = heldout.load_metrics(run)["stories"]
    assert got["1"]["time_split"]["model"]["draft_acceptance"] == round(11 / 20, 3)
    assert [a["time_split"]["model"]["draft_acceptance"] for a in got["1"]["agent"]["attempts"]] == [0.75, 0.25]
    assert got["2"]["time_split"]["model"]["draft_acceptance"] == 1.0
    assert got["2"]["time_split"]["model"]["mean_accepted_len"] == 3.0
    for sid in ("1", "2"):    # nothing else in the record changes
        new, old = json.loads(json.dumps(got[sid])), before[sid]
        for split in [new["time_split"]] + [a["time_split"] for a in (new["agent"].get("attempts") or [])]:
            for k in backfill_draft.DRAFT_KEYS:
                split["model"].pop(k, None)
        assert new == old
    assert backfill_draft.backfill(run) == []                   # a second pass changes nothing


def test_a_story_without_its_full_event_log_is_left_as_it_was(tmp_path):
    run = drafted_run(tmp_path)
    (run / "stories" / "02" / "agent-events.jsonl").unlink()
    assert backfill_draft.backfill(run) == ["1"]


def test_nothing_without_an_engine_log_that_has_draft_figures(tmp_path):
    run = drafted_run(tmp_path)
    (run / "server.log").unlink()
    assert backfill_draft.backfill(run) == []
    (run / "server.log").write_text("")
    assert backfill_draft.backfill(run) == []


def test_a_story_with_no_model_time_is_left_to_backfill_timing(tmp_path):
    run = drafted_run(tmp_path)
    m = heldout.load_metrics(run)
    m["stories"]["2"]["time_split"]["model"] = None
    heldout.save_metrics(run, m)
    assert backfill_draft.backfill(run) == ["1"]


def test_the_command_line_names_what_it_filled(tmp_path, capsys):
    run = drafted_run(tmp_path)
    backfill_draft.main([str(run)])
    assert capsys.readouterr().out.strip().endswith("draft: 1, 2")


def test_a_dry_run_prints_the_figures_and_writes_nothing(tmp_path, capsys):
    run = drafted_run(tmp_path)
    before = (run / "metrics.json").read_bytes()
    backfill_draft.main(["--dry-run", str(run)])
    out = capsys.readouterr().out
    assert "story 1: {'draft_acceptance': 0.55" in out and out.strip().endswith("draft: 1, 2")
    assert (run / "metrics.json").read_bytes() == before
