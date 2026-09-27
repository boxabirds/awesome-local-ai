"""uv run --with pytest pytest benchmarks/gufo-eval/test_throughput.py"""
import throughput


def test_greedy_is_the_default_and_starts_with_a_unique_line():
    b = throughput.body("PROMPT", 400)
    assert b["temperature"] == 0 and b["chat_template_kwargs"] == {"enable_thinking": False}
    assert b["messages"][0]["content"].startswith("run ")


def test_agent_sampling_matches_the_combinations_thinking_sampler():
    b = throughput.body("PROMPT", 400, sampling="agent")
    assert (b["temperature"], b["top_p"], b["top_k"], b["min_p"]) == (1.0, 0.95, 20, 0.0)
    assert b["chat_template_kwargs"] == {"enable_thinking": True} and "reasoning_effort" not in b


def test_a_reusable_prefix_puts_the_unique_line_last():
    c = throughput.body("PROMPT", 400, reuse_prefix=True)["messages"][0]["content"]
    assert c.startswith("PROMPT") and "\nrun " in c
    other = throughput.body("PROMPT", 400, reuse_prefix=True)["messages"][0]["content"]
    assert c != other and c[:len("PROMPT")] == other[:len("PROMPT")]
