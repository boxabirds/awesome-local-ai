"""Check 1 (long-context cache retention): each way the server can lose the conversation must fail it, by name."""

import json

from pibodies import conversation_bodies
from tfcheck import long_context as lc

TURNS = 34                 # x RESULT_CHARS / fake_server.CHARS_PER_TOKEN: grows past 150k tokens
RESULT_CHARS = 18_000
FAST = 1e-6                # seconds per prefilled token: fast enough that timing never decides the cache tests
KEEP = 1_000_000           # a keep-prompt limit that never binds unless a test says so
TEST_TTFT_FIXED_S = 0.5    # the real default (5 s) is sized for a Mac; the fake answers in milliseconds


def run(url, **kw):
    args = dict(model="bench", keep_limit=KEEP, ttft_fixed_s=TEST_TTFT_FIXED_S)
    args.update(kw)
    return lc.run(url, conversation_bodies(TURNS, RESULT_CHARS), **args)


def test_a_server_that_keeps_every_turn_passes(fake):
    st, url = fake(cache="keep", sec_per_token=FAST)
    r = run(url)
    assert r["verdict"] == "PASS", r["reason"]
    assert r["turns"][-1]["prompt_tokens"] >= lc.TARGET_TOKENS
    assert r["max_prompt_tokens"] >= lc.TARGET_TOKENS
    for t in r["turns"][1:]:
        assert t["cached_tokens"] >= t["previous_prompt_tokens"] - lc.CACHE_TOLERANCE_TOKENS
        assert t["new_tokens"] == t["prompt_tokens"] - t["cached_tokens"]
        assert t["ttft_s"] > 0 and t["prefill_tps"] > 0
    # it stops once past the target: no turn beyond the first one over it
    assert sum(t["prompt_tokens"] >= lc.TARGET_TOKENS for t in r["turns"]) == 1


def test_requests_are_pis_bodies_with_only_model_and_reply_limit_changed(fake):
    st, url = fake(cache="keep", sec_per_token=FAST)
    run(url)
    sent = st.requests[0]
    original = conversation_bodies(TURNS, RESULT_CHARS)[0]
    assert sent["model"] == "bench"
    assert sent["max_completion_tokens"] == lc.REPLY_TOKENS
    assert sent["messages"] == original["messages"] and sent["tools"] == original["tools"]
    assert sent["stream"] is True and sent["stream_options"] == {"include_usage": True}


def test_a_server_that_never_reuses_fails_at_the_second_turn(fake):
    st, url = fake(cache="drop", sec_per_token=FAST)
    r = run(url)
    assert r["verdict"] == "FAIL"
    assert r["first_failing_turn"] == 2
    assert "turn 2" in r["reason"] and "re-prefilled" in r["reason"]


def test_a_server_that_drops_the_cache_past_100k_fails_at_that_turn(fake):
    threshold = 100_000
    st, url = fake(cache="drop_above", drop_above=threshold, sec_per_token=FAST)
    r = run(url)
    assert r["verdict"] == "FAIL"
    first_bad = next(t for t in r["turns"][1:] if t["previous_prompt_tokens"] > threshold)
    assert r["first_failing_turn"] == first_bad["turn"]
    assert f"turn {first_bad['turn']}" in r["reason"] and "cached 0" in r["reason"]
    # it does not grind on through every remaining turn once it has failed
    assert len(r["turns"]) <= first_bad["turn"] + lc.TURNS_AFTER_FAILURE


def test_cached_tokens_that_are_claimed_but_not_real_fail_on_time_to_first_token(fake):
    st, url = fake(cache="lie_slow", sec_per_token=2e-5)
    r = run(url, ttft_fixed_s=0.05)
    assert r["verdict"] == "FAIL"
    assert "time to first token" in r["reason"]
    assert r["first_failing_turn"] > 1


def test_running_out_of_recorded_turns_before_the_target_fails(fake):
    st, url = fake(cache="keep", sec_per_token=FAST)
    r = lc.run(url, conversation_bodies(5, RESULT_CHARS), model="bench", keep_limit=KEEP,
               ttft_fixed_s=TEST_TTFT_FIXED_S)
    assert r["verdict"] == "FAIL"
    assert "ran out of recorded turns" in r["reason"]


def test_a_keep_prompt_limit_below_the_target_lowers_the_target(fake):
    keep = 60_000
    st, url = fake(cache="keep", sec_per_token=FAST)
    r = run(url, keep_limit=keep)
    assert r["target_tokens"] == keep - lc.REPLY_TOKENS - lc.KEEP_MARGIN_TOKENS
    assert r["verdict"] == "PASS", r["reason"]
    assert all(t["prompt_tokens"] + lc.REPLY_TOKENS <= keep for t in r["turns"])


def test_a_server_that_reports_no_cached_tokens_fails(fake):
    st, url = fake(cache="keep", sec_per_token=FAST, report_cached=False)
    r = run(url)
    assert r["verdict"] == "FAIL"
    assert "cached_tokens" in r["reason"]


def test_a_context_refusal_before_the_target_fails_with_the_servers_words(fake):
    st, url = fake(cache="keep", sec_per_token=FAST, window=80_000)
    r = run(url)
    assert r["verdict"] == "FAIL"
    assert "context_length_exceeded" in r["reason"]


def test_results_and_summary_are_written(fake, tmp_path):
    st, url = fake(cache="drop", sec_per_token=FAST)
    r = run(url)
    lc.write_outputs(r, tmp_path)
    doc = json.loads((tmp_path / "results.json").read_text())
    assert doc["verdict"] == "FAIL" and doc["turns"]
    md = (tmp_path / "summary.md").read_text()
    assert "FAIL" in md and "turn 2" in md and "| turn |" in md


def test_bodies_are_read_in_order_from_a_directory(tmp_path):
    for i, b in enumerate(conversation_bodies(3, 10)):
        (tmp_path / f"{i:04d}.json").write_text(json.dumps(b))
    (tmp_path / "index.json").write_text("{}")          # not a body
    got = list(lc.load_bodies(tmp_path))
    assert [len(b["messages"]) for b in got] == [2, 4, 6, 8]
