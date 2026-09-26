"""llama_log.py: each request's prefill, decode and MTP draft figures, read from llama-server's own
log (no proxy in the request path). The lines below are tritus's, verbatim (install smoke test)."""
import llama_log

SMOKE = """\
0.00.000.287 I srv  llama_server: initializing ...
0.41.759.972 I slot print_timing: id  0 | task 0 | prompt eval time =     745.92 ms /    45 tokens (   16.58 ms per token,    60.33 tokens per second)
0.41.759.977 I slot print_timing: id  0 | task 0 |        eval time =     836.19 ms /    24 tokens (   36.36 ms per token,    27.51 tokens per second)
0.41.759.978 I slot print_timing: id  0 | task 0 |       total time =    1582.10 ms /    69 tokens
0.41.759.984 I slot print_timing: id  0 | task 0 |    graphs reused =          6
0.41.759.990 I slot print_timing: id  0 | task 0 | draft acceptance = 0.57143 (   16 accepted /    28 generated), mean len =  3.29
"""
# While a request runs, the server prints progress lines under the same prefix: not requests.
PROGRESS = ("1.08.405.895 I slot print_timing: id  0 | task 1 | prompt processing, n_tokens =   1590, "
            "progress = 0.03, t =   4.05 s / 392.73 tokens per second\n"
            "6.07.879.078 I slot print_timing: id  0 | task 1 | n_gen =   2493, tg =  28.00 t/s, tg_3s =  30.76 t/s\n")
START = 1790390000.0


def test_a_finished_request_is_read_with_its_wall_clock_time():
    reqs = llama_log.parse(llama_log.start_marker(START) + SMOKE + PROGRESS)
    assert len(reqs) == 1
    r = reqs[0]
    assert abs(r["end"] - (START + 41.759990)) < 1e-3
    assert (r["prompt_n"], r["prompt_ms"], r["gen_n"], r["gen_ms"]) == (45, 745.92, 24, 836.19)
    assert (r["draft_accepted"], r["draft_generated"], r["mean_len"]) == (16, 28, 3.29)


def test_minutes_past_sixty_and_each_server_start_have_their_own_clock():
    later = SMOKE.replace("0.41.759", "75.02.000")
    reqs = llama_log.parse(llama_log.start_marker(START) + later + llama_log.start_marker(START + 9000) + SMOKE)
    assert [round(r["end"] - START, 1) for r in reqs] == [75 * 60 + 2.0, 9041.8]


def test_a_log_without_a_start_marker_has_no_wall_clock_so_no_requests():
    assert llama_log.parse(SMOKE) == []


def test_summary_over_a_story_window():
    two = llama_log.start_marker(START) + SMOKE + SMOKE.replace("0.41.7", "0.51.7").replace("task 0", "task 1")
    s = llama_log.summarise(llama_log.parse(two), START, START + 45)
    assert s["requests"] == 1 and s["prefill_s"] == 0.7 and s["decode_s"] == 0.8
    s = llama_log.summarise(llama_log.parse(two), START, START + 60)
    assert s["requests"] == 2 and s["decode_tokens"] == 48 and s["draft_acceptance"] == 0.571
    assert s["mean_accepted_len"] == 3.29 and s["decode_tok_s"] == round(48 / (2 * 0.83619), 1)
