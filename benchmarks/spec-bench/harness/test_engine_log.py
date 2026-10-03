"""engine_log.py: MTP draft figures from the logs of gufo and mlx-serve, each request placed by the agent's call
with its tokens. The logs are real excerpts (fixtures/engine-logs): gufo v2-r4 and mlx-serve v2-r2, story 1."""
from pathlib import Path

import pytest

import engine_log
import llama_log
from accounting import Call

LOGS = Path(__file__).resolve().parent / "fixtures" / "engine-logs"
START = 1_790_000_000.0


def text(name: str, start: float = START) -> str:
    return llama_log.start_marker(start) + (LOGS / name).read_text()


def call(sent: float, fresh: int, cached: int, out: int | None) -> Call:
    return Call(sent, sent + 1, sent + 2, fresh, cached, out)


def test_gufo_s_chat_requests_are_read_and_its_other_requests_are_not():
    reqs = engine_log.parse(text("gufo-excerpt.txt"))
    assert [(r["prompt"], r["gen"]) for r in reqs] == [(2049, 103), (5534, 55), (12596, 53), (15603, 70)]
    assert [(r["draft_accepted"], r["draft_generated"]) for r in reqs] == [(76, 90), (47, 49), (39, 45), (49, 62)]
    assert all(r["start"] == START and "mean_len" not in r for r in reqs)


def test_mlx_serve_s_requests_are_read_from_their_spec_stats_and_token_lines():
    reqs = engine_log.parse(text("mlx-serve-excerpt.txt"))
    assert [(r["prompt"], r["gen"]) for r in reqs] == [(2093, 201), (11658, 206), (15149, 335), (15533, 67)]
    assert [(r["draft_accepted"], r["draft_generated"]) for r in reqs] == [(83, 95), (62, 99), (166, 234), (41, 46)]
    # llama.cpp's "mean len": 1 + drafts accepted per verification round (mlx-serve's attempts)
    assert [r["mean_len"] for r in reqs] == [pytest.approx(1 + a / n) for a, n in ((83, 30), (62, 23), (166, 68), (41, 15))]


def test_an_mlx_serve_request_cut_off_before_its_tokens_line_is_not_a_request_and_lends_nothing_to_the_next():
    one = (LOGS / "mlx-serve-excerpt.txt").read_text()
    cut = one[:one.index("  <- 2093+201")]                     # the first request never finished
    reqs = engine_log.parse(llama_log.start_marker(START) + cut + one[one.index("POST /v1/chat/completions (5 msgs"):])
    assert [r["prompt"] for r in reqs] == [11658, 15149, 15533] and reqs[0]["draft_accepted"] == 62


def test_a_request_with_no_draft_figures_is_still_a_request_to_match():
    reqs = engine_log.parse(llama_log.start_marker(START) + "  <- 10+2 tokens streamed [prefill: 1 tok/s, decode: 1 tok/s] [stop]\n")
    assert reqs == [{"start": START, "prompt": 10, "gen": 2}]


def test_each_server_start_begins_its_own_run_and_lines_before_any_start_belong_to_one_from_the_beginning():
    reqs = engine_log.parse((LOGS / "gufo-excerpt.txt").read_text() + text("gufo-excerpt.txt", START + 100))
    assert [r["start"] for r in reqs] == [float("-inf")] * 4 + [START + 100] * 4


def test_calls_match_requests_by_tokens_in_order_within_the_server_run_up_when_sent():
    reqs = engine_log.parse(text("gufo-excerpt.txt") + text("gufo-excerpt.txt", START + 100))
    calls = [call(START + 1, 2049, 0, 103), call(START + 2, 1, 1, 1), call(START + 3, 3382, 2152, 55),
             call(START + 101, 3382, 2152, 55), call(START + 102, 2049, 0, 103)]
    got = engine_log.match(reqs, calls)
    assert got[0] is reqs[0] and got[1] is None and got[2] is reqs[1]
    assert got[3] is reqs[5] and got[4] is None             # in order: r4 of the second run came before its r5


def test_a_call_without_output_tokens_matches_nothing():
    """Claude Code's stream carries no output count; no engine log is beside it anyway."""
    assert engine_log.match(engine_log.parse(text("gufo-excerpt.txt")), [call(START + 1, 2049, 0, None)]) == [None]


def test_draft_figures_for_the_counted_calls_only():
    reqs = engine_log.parse(text("gufo-excerpt.txt"))
    calls = [call(START + i, f, c, o) for i, (f, c, o) in enumerate([(2049, 0, 103), (3382, 2152, 55), (7007, 5589, 53)])]
    assert engine_log.draft(text("gufo-excerpt.txt"), calls, calls[1:]) == {"draft_acceptance": round(86 / 94, 3), "mean_accepted_len": None}
    assert engine_log.draft(text("gufo-excerpt.txt"), calls, []) == {}
    assert engine_log.draft("", calls, calls) == {}
    assert reqs  # the log itself was read


def test_draft_figures_with_nothing_drafted_are_none_as_llama_log_s():
    t = llama_log.start_marker(START) + "  <- 10+2 tokens streamed [prefill: 1 tok/s, decode: 1 tok/s] [stop]\n"
    c = call(START + 1, 4, 6, 2)
    assert engine_log.draft(t, [c], [c]) == {"draft_acceptance": None, "mean_accepted_len": None}


def test_a_story_s_calls_start_where_most_of_them_match_not_at_another_story_s_request_with_the_same_tokens():
    """A story's log is one stretch of the server run: an earlier story's request with its first call's tokens
    must not take that call, nor push the story's other calls out of order."""
    line = "  <- {}+{} tokens streamed [prefill: 1 tok/s, decode: 1 tok/s] [stop]\n"
    t = llama_log.start_marker(START) + "".join(line.format(p, g) for p, g in ((10, 1), (20, 2), (10, 1), (30, 3), (40, 4)))
    reqs = engine_log.parse(t)
    calls = [call(START + 1, 10, 0, 1), call(START + 2, 30, 0, 3), call(START + 3, 40, 0, 4)]
    assert engine_log.match(reqs, calls) == [reqs[2], reqs[3], reqs[4]]
    assert engine_log.match(reqs, calls)[0] is reqs[2]


# ---------- Strata: its engine log, one line per request ----------
# Real lines from the RTX 4090 machine, Strata v0.1.36 (2 Oct 2026): a short tool-call check, then a five-turn
# conversation of about 54k tokens and a three-turn one of about 128k, whose later turns reuse the first one's prompt. The lines for the expert cache's hit
# rate follow each request and are not requests.

def test_strata_s_request_lines_are_read_and_its_cache_lines_are_not():
    reqs = engine_log.parse(text("strata-excerpt.txt"))
    assert len(reqs) == 10      # 11 "strata serve: prompt" lines, one of them the prompt-chunk setting
    assert reqs[0] == {"start": START, "prompt": 369, "gen": 46, "draft_accepted": 33, "draft_generated": 38}


def test_strata_prompt_is_the_whole_prompt_cached_or_read():
    reqs = engine_log.parse(text("strata-excerpt.txt"))
    # "54497 tokens = 54460 reused + 37 read": the agent records input + cacheRead = 54497
    assert [r["prompt"] for r in reqs][2:6] == [54465, 54497, 54548, 54601]
    assert reqs[3]["gen"] == 114 and (reqs[3]["draft_accepted"], reqs[3]["draft_generated"]) == (73, 89)


def test_strata_gives_no_rounds_so_no_mean_accepted_length():
    assert all("mean_len" not in r for r in engine_log.parse(text("strata-excerpt.txt")))


def test_strata_requests_are_matched_to_the_agent_s_calls_by_tokens():
    reqs = engine_log.parse(text("strata-excerpt.txt"))
    calls = [call(START + 1, 37, 54460, 114), call(START + 2, 56, 54492, 98)]
    got = engine_log.match(reqs, calls)
    assert [g["gen"] for g in got] == [114, 98]


def test_strata_draft_acceptance_is_accepted_over_drafted_for_the_counted_calls():
    calls = [call(START + 1, 37, 54460, 114), call(START + 2, 56, 54492, 98)]
    d = engine_log.draft(text("strata-excerpt.txt"), calls, calls)
    assert d == {"draft_acceptance": round((73 + 72) / (89 + 75), 3), "mean_accepted_len": None}


def test_a_strata_request_with_no_draft_clause_is_still_a_request():
    line = "strata serve: prompt 100 tokens = 0 reused + 100 read in 50 ms (2000.0 tok/s), 10 generated in 100 ms (100.0 tok/s), 1 checkpoints\n"
    reqs = engine_log.parse(llama_log.start_marker(START) + line)
    assert reqs == [{"start": START, "prompt": 100, "gen": 10}]
