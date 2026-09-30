"""recount_tokens.py: a story's agent.tokens rebuilt from its own recorded event log, for records written
while ClaudeClient.scan kept only a session's last `result` (Opus v2-r3 story 12: 1,230 output tokens
recorded against 91,850)."""
import gzip
import json
from pathlib import Path

import pytest

import recount_tokens as rt
from test_clients import OPUS_V2R3_S12_RESULTS

REPO = Path(__file__).resolve().parents[3]
OPUS_V2R3 = REPO / "benchmarks" / "reference" / "vidi" / "opus-5.5" / "v2-r3"
TOKEN_KEYS = ("input", "output", "reasoning", "cache_read", "cache_write")
FIRST, SECOND = OPUS_V2R3_S12_RESULTS
SUMMED = {"input": 136, "output": 91850, "reasoning": 0, "cache_read": 11058709, "cache_write": 227208}
LAST_ONLY = {"input": 6, "output": 1230, "reasoning": 0, "cache_read": 476307, "cache_write": 1044}


def claude_events(*usages) -> list[dict]:
    out = [{"type": "system", "subtype": "init", "session_id": "s"}]
    for n, u in enumerate(usages):
        out += [{"type": "assistant", "message": {"id": f"m{n}", "content": [{"type": "text", "text": "ok"}]}},
                {"type": "result", "subtype": "success", "is_error": False, "session_id": "s", "usage": u,
                 "_rx": 1790753061.0 + n}]
    return out


def write_log(path: Path, events: list[dict], compact: bool = False) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = "".join(json.dumps(e) + "\n" for e in events) + "not json: a line cut off by a crash\n"
    if compact:
        with gzip.open(path, "wt") as f:
            f.write(text)
    else:
        path.write_text(text)
    return path


def run_with_story(tmp_path: Path, recorded: dict, client: str | None = "claude", log: str = rt.FULL_LOG,
                   events: list[dict] | None = None) -> Path:
    run = tmp_path / "run"
    sdir = run / "stories" / "12"
    write_log(sdir / log, events if events is not None else claude_events(FIRST, SECOND),
              compact=log.endswith(".gz"))
    metrics = {"stories": {"12": {"title": "t", "agent": {"steps": 2, "tokens": dict(recorded)}, "commit": "abc"}},
               "processed": [{"id": 12, "status": "DONE", "output_tokens": recorded["output"]}]}
    if client:
        metrics["client"] = client
    (run / "metrics.json").write_text(json.dumps(metrics, indent=2))
    return run


# ---------- reading a log ----------

def test_a_log_is_recounted_by_adding_every_result():
    assert rt.tokens_from_events("claude", claude_events(FIRST, SECOND)) == SUMMED


@pytest.mark.parametrize("log", [rt.FULL_LOG, rt.COMPACT_LOG])
def test_either_log_can_be_read_and_cut_off_lines_are_skipped(tmp_path, log):
    path = write_log(tmp_path / log, claude_events(FIRST, SECOND), compact=log.endswith(".gz"))
    assert rt.tokens_from_log("claude", path) == SUMMED


def test_the_full_log_is_preferred_to_the_compact_one(tmp_path):
    """The compact log is the full one without stream deltas and with long strings cut: the same counts, but
    the full one is the original, so it wins when both are there."""
    sdir = tmp_path / "stories" / "12"
    write_log(sdir / rt.COMPACT_LOG, claude_events(FIRST), compact=True)
    assert rt.story_log(sdir) == sdir / rt.COMPACT_LOG
    write_log(sdir / rt.FULL_LOG, claude_events(FIRST, SECOND))
    assert rt.story_log(sdir) == sdir / rt.FULL_LOG
    assert rt.story_log(tmp_path / "nothing") is None


def test_a_pi_log_recounts_to_what_pi_recorded():
    """The recount is generic: pi already added per message, so its records don't change."""
    events = [{"type": "message_end", "message": {"role": "assistant", "stopReason": "stop",
                                                  "usage": {"input": 5, "output": 7, "cacheRead": 11}}}] * 2
    assert rt.tokens_from_events("pi", events) == {"input": 10, "output": 14, "reasoning": 0, "cache_read": 22,
                                                   "cache_write": 0}


# ---------- a run ----------

def test_a_dry_run_reports_the_difference_and_writes_nothing(tmp_path):
    run = run_with_story(tmp_path, LAST_ONLY)
    before = (run / "metrics.json").read_text()
    [row] = rt.recount(run)
    assert row["story"] == "12" and row["changed"] is True
    assert row["recorded"] == LAST_ONLY and row["recomputed"] == SUMMED
    assert row["log"] == f"stories/12/{rt.FULL_LOG}"
    assert (run / "metrics.json").read_text() == before


def test_write_puts_the_recount_in_the_record_and_keeps_what_it_replaced(tmp_path):
    run = run_with_story(tmp_path, LAST_ONLY, log=rt.COMPACT_LOG)
    rt.recount(run, write=True)
    m = json.loads((run / "metrics.json").read_text())
    agent = m["stories"]["12"]["agent"]
    assert agent["tokens"] == SUMMED
    assert agent[rt.PROVENANCE]["previous"] == LAST_ONLY
    assert agent[rt.PROVENANCE]["from"] == f"stories/12/{rt.COMPACT_LOG}"
    assert m["processed"][0]["output_tokens"] == SUMMED["output"]       # the per-story table reads this copy
    assert agent["steps"] == 2 and m["stories"]["12"]["commit"] == "abc" and m["client"] == "claude"


def test_a_record_that_already_agrees_is_left_alone(tmp_path):
    run = run_with_story(tmp_path, SUMMED)
    before = (run / "metrics.json").read_text()
    [row] = rt.recount(run, write=True)
    assert row["changed"] is False
    assert (run / "metrics.json").read_text() == before


def test_rerunning_the_recount_is_harmless(tmp_path):
    run = run_with_story(tmp_path, LAST_ONLY)
    rt.recount(run, write=True)
    once = (run / "metrics.json").read_text()
    [row] = rt.recount(run, write=True)
    assert row["changed"] is False and (run / "metrics.json").read_text() == once
    assert json.loads(once)["stories"]["12"]["agent"][rt.PROVENANCE]["previous"] == LAST_ONLY


def test_a_story_without_a_log_is_reported_and_kept(tmp_path):
    run = run_with_story(tmp_path, LAST_ONLY)
    (run / "stories" / "12" / rt.FULL_LOG).unlink()
    before = (run / "metrics.json").read_text()
    [row] = rt.recount(run, write=True)
    assert row["log"] is None and row["changed"] is False and "no event log" in row["note"]
    assert (run / "metrics.json").read_text() == before


def test_a_log_with_no_usage_at_all_does_not_zero_a_record(tmp_path):
    """A log that lost its result events (a cut-off file) says nothing about the tokens: keep the record."""
    run = run_with_story(tmp_path, LAST_ONLY, events=[{"type": "system", "subtype": "init", "session_id": "s"}])
    [row] = rt.recount(run, write=True)
    assert row["changed"] is False and "no token usage" in row["note"]
    assert json.loads((run / "metrics.json").read_text())["stories"]["12"]["agent"]["tokens"] == LAST_ONLY


def test_a_run_that_does_not_name_its_client_needs_one(tmp_path):
    run = run_with_story(tmp_path, LAST_ONLY, client=None)
    with pytest.raises(SystemExit, match="client"):
        rt.recount(run)
    [row] = rt.recount(run, client="claude")
    assert row["recomputed"] == SUMMED


def test_the_cli_prints_a_row_per_story_and_writes_only_when_asked(tmp_path, capsys):
    run = run_with_story(tmp_path, LAST_ONLY)
    assert rt.main([str(run)]) == 0
    out = capsys.readouterr().out
    assert "1230 -> 91850" in out and "dry run" in out
    assert json.loads((run / "metrics.json").read_text())["stories"]["12"]["agent"]["tokens"] == LAST_ONLY
    assert rt.main([str(run), "--write"]) == 0
    assert json.loads((run / "metrics.json").read_text())["stories"]["12"]["agent"]["tokens"] == SUMMED


# ---------- the real record ----------

@pytest.mark.skipif(not (OPUS_V2R3 / "stories" / "12" / rt.COMPACT_LOG).exists(), reason="Opus v2-r3 record not here")
def test_the_real_opus_v2_r3_story_12_log_recounts_to_91850_output_tokens():
    """Read-only: the committed compact log of the story the bug was found on."""
    got = rt.tokens_from_log("claude", rt.story_log(OPUS_V2R3 / "stories" / "12"))
    assert got["output"] == SUMMED["output"] and got["input"] == SUMMED["input"]
