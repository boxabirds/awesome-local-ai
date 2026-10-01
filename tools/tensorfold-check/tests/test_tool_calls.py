"""Check 2 (tool calls with pi's real requests): each failure shape must fail the check with the right message."""

import json

from pibodies import PI_TOOLS, conversation_bodies
from tfcheck import schema
from tfcheck import tool_calls as tc


def bodies():
    return conversation_bodies(12, 200)


def test_a_server_that_calls_tools_properly_passes(fake):
    st, url = fake()
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "PASS", r["reason"]
    assert r["samples"] and all(s["structured"] for s in r["samples"])
    assert r["effort"]["high_reasoning_tokens"] > r["effort"]["low_reasoning_tokens"]


def test_tool_calls_returned_as_text_fail_as_gufo_304(fake):
    st, url = fake(tools="text")
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "FAIL"
    assert "<tool_call>" in r["reason"] and "as text" in r["reason"]


def test_stringified_numbers_fail_naming_the_argument(fake):
    st, url = fake(tools="stringify")
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "FAIL"
    assert "timeout" in r["reason"] and "string" in r["reason"] and "number" in r["reason"]


def test_a_streamed_call_that_differs_from_the_plain_one_fails(fake):
    st, url = fake(tools="stream_mismatch")
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "FAIL"
    assert "stream" in r["reason"]


def test_replies_without_any_tool_call_fail(fake):
    st, url = fake(tools="prose")
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "FAIL"
    assert "structured tool call" in r["reason"]


def test_an_ignored_reasoning_effort_fails(fake):
    st, url = fake(effort="ignored")
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "FAIL"
    assert "reasoning_effort" in r["reason"] and "did not change" in r["reason"]


def test_a_rejected_reasoning_effort_fails(fake):
    st, url = fake(effort="rejected")
    r = tc.run(url, bodies(), model="bench")
    assert r["verdict"] == "FAIL"
    assert "reasoning_effort" in r["reason"] and "400" in r["reason"]


def test_requests_keep_pis_body_and_add_only_a_fixed_seed(fake):
    st, url = fake()
    tc.run(url, bodies(), model="bench")
    sent = [b for b in st.requests if "reasoning_effort" not in b]
    assert sent, "no plain request was sent"
    for b in sent:
        assert b["model"] == "bench" and b["tools"] == PI_TOOLS and b["seed"] == tc.SEED
        assert b["max_completion_tokens"] == tc.REPLY_TOKENS
    # each sample goes out both streamed and not, as the same request otherwise
    streamed = [b for b in sent if b["stream"]]
    plain = [b for b in sent if not b["stream"]]
    assert len(streamed) == len(plain)


def test_samples_are_turns_where_pi_was_waiting_on_a_tool_result():
    picked = tc.pick_samples(bodies(), tc.SAMPLES)
    assert 0 < len(picked) <= tc.SAMPLES
    assert all(b["messages"][-1]["role"] == "tool" for _, b in picked)


def test_results_are_written(fake, tmp_path):
    st, url = fake(tools="text")
    r = tc.run(url, bodies(), model="bench")
    tc.write_outputs(r, tmp_path)
    assert json.loads((tmp_path / "results.json").read_text())["verdict"] == "FAIL"
    assert "FAIL" in (tmp_path / "summary.md").read_text()


# ---- the argument type checker -------------------------------------------------------------------------------
READ = PI_TOOLS[0]["function"]["parameters"]
BASH = PI_TOOLS[1]["function"]["parameters"]
EDIT = {"type": "object", "required": ["path", "edits"], "additionalProperties": False, "properties": {
    "path": {"type": "string"},
    "edits": {"type": "array", "items": {"type": "object", "required": ["oldText", "newText"],
                                         "properties": {"oldText": {"type": "string"}, "newText": {"type": "string"}},
                                         "additionalProperties": False}}}}


def test_schema_accepts_well_typed_arguments():
    assert schema.problems({"path": "a", "offset": 1, "limit": None}, READ) == []
    assert schema.problems({"command": "ls", "timeout": 30}, BASH) == []
    assert schema.problems({"path": "a", "edits": [{"oldText": "x", "newText": "y"}]}, EDIT) == []


def test_schema_lets_a_nullable_property_be_left_out():
    assert schema.problems({"path": "a"}, READ) == []


def test_schema_flags_stringified_numbers_and_booleans():
    assert any("offset" in p and "string" in p for p in schema.problems({"path": "a", "offset": "5"}, READ))
    assert any("boolean" in p for p in schema.problems({"flag": "true"}, {
        "type": "object", "properties": {"flag": {"type": "boolean"}}}))


def test_schema_flags_missing_required_and_unexpected_properties():
    assert any("command" in p and "missing" in p for p in schema.problems({"timeout": 3}, BASH))
    assert any("bogus" in p for p in schema.problems({"command": "ls", "bogus": 1}, BASH))


def test_schema_checks_array_items():
    assert any("edits[0].newText" in p for p in schema.problems({"path": "a", "edits": [{"oldText": "x", "newText": 3}]}, EDIT))
    assert any("edits" in p and "string" in p for p in schema.problems({"path": "a", "edits": "[]"}, EDIT))
