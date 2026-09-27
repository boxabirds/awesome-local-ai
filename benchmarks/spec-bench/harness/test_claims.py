"""claims.py: the agent's final statement per story, from pi and Claude Code event streams."""
import gzip
import json

import claims


def pi_end(text, thinking="internal reasoning"):
    return json.dumps({"type": "message_end", "message": {"role": "assistant", "content": [
        {"type": "thinking", "thinking": thinking}, {"type": "text", "text": text}]}})


def test_pi_takes_the_last_assistant_text_and_never_the_thinking():
    lines = [pi_end("first"), json.dumps({"type": "message_end", "message": {"role": "user", "content": [
        {"type": "text", "text": "tool output"}]}}), pi_end("Story done, all tests pass."), json.dumps({"type": "agent_settled"})]
    assert claims.final_message(lines) == "Story done, all tests pass."


def test_claude_takes_the_result_event():
    lines = [json.dumps({"type": "assistant", "message": {"content": [{"type": "text", "text": "working"}]}}),
             json.dumps({"type": "result", "subtype": "success", "result": "Story 12 is built and committed."})]
    assert claims.final_message(lines) == "Story 12 is built and committed."


def test_no_final_message_is_none_and_bad_lines_are_skipped():
    assert claims.final_message(["not json", json.dumps({"type": "turn_start"})]) is None


def test_write_claims_writes_one_file_per_story_with_a_heading(tmp_path):
    run = tmp_path / "run"
    for sid, text in (("01", "one done"), ("02", None)):
        d = run / "stories" / sid
        d.mkdir(parents=True)
        with gzip.open(d / claims.EVENTS, "wt") as f:
            f.write((pi_end(text) if text else json.dumps({"type": "turn_start"})) + "\n")
    written = claims.write_claims(run, tmp_path / "out")
    assert written == ["01"]
    assert (tmp_path / "out" / "story-01.md").read_text() == "# Story 01\none done\n"
