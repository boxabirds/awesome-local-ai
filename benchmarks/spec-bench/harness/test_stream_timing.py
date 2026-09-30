"""stream_timing.py: each model call's prefill and decode time, from the agent client's own streamed events
(pi's full agent-events.jsonl): request sent, first streamed chunk, last chunk, and the call's tokens."""
import json
from pathlib import Path

import stream_timing


def events(tmp_path: Path, calls: list[tuple[float, float, float, int, int, int]]) -> Path:
    """calls: (sent, first chunk, end, fresh input, cached input, output)."""
    out = []
    for sent, first, end, inp, cached, outp in calls:
        out.append({"_rx": sent, "type": "message_start", "message": {"role": "assistant"}})
        out.append({"_rx": first, "type": "message_update", "assistantMessageEvent": {"type": "thinking_start"}})
        out.append({"_rx": (first + end) / 2, "type": "message_update", "assistantMessageEvent": {"type": "text_delta"}})
        out.append({"_rx": end, "type": "message_end", "message": {"role": "assistant", "usage": {"input": inp, "cacheRead": cached, "output": outp}}})
        out.append({"_rx": end + 1, "type": "tool_execution_start"})
    # the user's and system messages have starts and ends too, and don't count
    out.insert(0, {"_rx": 0, "type": "message_start", "message": {"role": "user"}})
    out.insert(1, {"_rx": 0, "type": "message_end", "message": {"role": "user"}})
    p = tmp_path / "agent-events.jsonl"
    p.write_text("\n".join(json.dumps(e) for e in out) + "\n")
    return p


def test_each_assistant_call_splits_at_its_first_streamed_chunk(tmp_path):
    calls = stream_timing.calls(events(tmp_path, [(10.0, 12.0, 20.0, 2000, 0, 800), (30.0, 30.5, 34.5, 100, 5000, 400)]))
    assert [(c.prefill_s, c.decode_s, c.input, c.cached, c.output) for c in calls] == [(2.0, 8.0, 2000, 0, 800), (0.5, 4.0, 100, 5000, 400)]


def test_a_story_totals_rates_as_tokens_over_seconds(tmp_path):
    s = stream_timing.summary(stream_timing.calls(events(tmp_path, [(10.0, 12.0, 20.0, 2000, 0, 800), (30.0, 30.5, 34.5, 100, 5000, 400)])))
    assert s["requests"] == 2
    assert s["prefill_s"] == 2.5 and s["decode_s"] == 12.0
    assert s["prefill_tokens"] == 2100 and s["decode_tokens"] == 1200
    assert s["prefill_tok_s"] == round(2100 / 2.5, 1) and s["decode_tok_s"] == round(1200 / 12.0, 1)
    assert s["source"] == "client-stream"


def test_a_call_that_never_streamed_counts_its_whole_time_as_prefill(tmp_path):
    p = tmp_path / "e.jsonl"
    p.write_text("\n".join(json.dumps(e) for e in [
        {"_rx": 1.0, "type": "message_start", "message": {"role": "assistant"}},
        {"_rx": 4.0, "type": "message_end", "message": {"role": "assistant", "usage": {"input": 10, "output": 0}}},
    ]))
    [c] = stream_timing.calls(p)
    assert (c.prefill_s, c.decode_s) == (3.0, 0.0)


def test_no_assistant_calls_is_none(tmp_path):
    p = tmp_path / "e.jsonl"
    p.write_text("")
    assert stream_timing.summary(stream_timing.calls(p)) is None


def test_time_split_times_the_model_from_the_stream_when_there_is_no_server_log(tmp_path):
    import drive
    ev = events(tmp_path, [(10.0, 12.0, 20.0, 2000, 0, 800), (30.0, 30.5, 34.5, 100, 5000, 400)])
    ts = drive.time_split(ev, tmp_path / "no-server.log", 0.0, 60.0)
    assert ts["model"]["source"] == "client-stream"
    assert (ts["model"]["prefill_s"], ts["model"]["decode_s"]) == (2.5, 12.0)
    assert ts["other_s"] == round(60.0 - ts["tools_s"] - 14.5, 1)   # model time is no longer "other"


def test_a_compactions_own_model_call_counts_as_compaction_not_model(tmp_path):
    import drive
    p = events(tmp_path, [(10.0, 12.0, 20.0, 2000, 0, 800), (30.0, 30.5, 34.5, 100, 5000, 400)])
    lines = p.read_text().splitlines()
    lines.insert(len(lines) - 4, json.dumps({"_rx": 29.0, "type": "compaction_start"}))
    lines.append(json.dumps({"_rx": 36.0, "type": "compaction_end"}))
    p.write_text("\n".join(lines) + "\n")
    ts = drive.time_split(p, tmp_path / "no-server.log", 0.0, 60.0)
    assert ts["model"]["requests"] == 1 and ts["compactions"] == 1
