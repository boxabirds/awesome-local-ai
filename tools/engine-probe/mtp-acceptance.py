#!/usr/bin/env python3
"""Does a llama.cpp server's speculative (MTP) decoding pay under OUR sampler, not the model card's?

A model card's MTP figures are usually measured at temperature 0, where the draft is easy to predict. Our agent samples at the
model card's temperature 1.0 (top-p 0.95, top-k 20), where acceptance falls: the same effect cost a gufo comparison on 7 Oct 2026.
So the figure that decides whether MTP is worth running is the acceptance and the generation speed AT OUR SAMPLER.

This sends one long prompt, then one request for a long continuation at that sampler, and reads what llama.cpp's server log says
about the continuation: `draft acceptance = 0.69856 ( 146 accepted / 209 generated), mean len = 3.75` and
`eval time = ... (21.05 ms per token, 47.50 tokens per second)`. The log lines are the engine's own account, not derived.

    uv run tools/engine-probe/mtp-acceptance.py --base-url http://127.0.0.1:18010/v1 --model NAME --server-log /tmp/server.log
    uv run tools/engine-probe/mtp-acceptance.py --self-test
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request

TIMEOUT_S = 1800
PROMPT_TOKENS = 30000
CONTINUATION_TOKENS = 800
APPROX_CHARS_PER_TOKEN = 3.6
FILLER = "function step_{n}(x) {{ return (x * {n} + {m}) % 9973; }}\n"
SAMPLER = {"temperature": 1.0, "top_p": 0.95, "top_k": 20}

ACCEPTANCE = re.compile(r"draft acceptance = ([\d.]+) \(\s*(\d+) accepted /\s*(\d+) generated\), mean len =\s*([\d.]+)")
EVAL = re.compile(r"eval time =\s*([\d.]+) ms /\s*(\d+) tokens \(\s*([\d.]+) ms per token,\s*([\d.]+) tokens per second\)")
PROMPT_EVAL = re.compile(r"prompt eval time =\s*([\d.]+) ms /\s*(\d+) tokens")


def last_request(log_lines) -> dict:
    """The speed and draft figures of the LAST request in a llama.cpp server log that generated tokens.

    A prompt-only request logs a `prompt eval time` and an `eval time` of one token; the continuation is the last request whose
    eval covers more than a few tokens, so walk the log and keep the latest such one with the acceptance line that follows it."""
    best: dict = {}
    pending: dict | None = None
    for line in log_lines:
        m = EVAL.search(line)
        if m and "prompt eval" not in line:
            pending = {"decode_tokens": int(m.group(2)), "decode_tok_s": float(m.group(4))}
            continue
        a = ACCEPTANCE.search(line)
        if a and pending is not None and pending["decode_tokens"] > 8:
            best = {**pending, "draft_acceptance": float(a.group(1)), "accepted": int(a.group(2)), "drafted": int(a.group(3)),
                    "mean_accepted_len": float(a.group(4))}
            pending = None
    return best


def post(base_url: str, body: dict) -> dict:
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return json.load(r)


def self_test() -> None:
    # Real lines from the Swift 1.5 server on the RTX 4090 machine (8 Oct 2026): a long prompt, then a 200-token continuation.
    log = [
        "8.22.700.394 I slot print_timing: id  0 | task 278 | prompt eval time =  168978.04 ms / 182830 tokens (    0.92 ms per token,  1081.97 tokens per second)",
        "8.22.700.397 I slot print_timing: id  0 | task 278 |        eval time =    1300.68 ms /    78 tokens (   16.89 ms per token,    59.20 tokens per second)",
        "8.29.275.320 I slot print_timing: id  0 | task 477 |        eval time =    4189.37 ms /   200 tokens (   21.05 ms per token,    47.50 tokens per second)",
        "5.09.341.522 I slot print_timing: id  0 | task 218 | draft acceptance = 0.69856 (  146 accepted /   209 generated), mean len =  3.75",
    ]
    got = last_request(log)
    assert got == {"decode_tokens": 200, "decode_tok_s": 47.5, "draft_acceptance": 0.69856, "accepted": 146, "drafted": 209,
                   "mean_accepted_len": 3.75}, got
    # a log with no draft line has no acceptance to report: nothing is made up
    assert last_request(log[:3]) == {}
    # a one-token request (the prompt-only one) is not the continuation
    one = ["x | task 1 |        eval time =      30.00 ms /     1 tokens (   30.00 ms per token,    33.33 tokens per second)",
           "x | task 1 | draft acceptance = 1.00000 (  0 accepted /   0 generated), mean len =  0.00"]
    assert last_request(one) == {}
    print("self-test ok")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--model")
    ap.add_argument("--server-log")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
        return 0
    if not (a.base_url and a.model and a.server_log):
        ap.error("--base-url, --model and --server-log are required")
    text, n = [], 0
    while sum(map(len, text)) < PROMPT_TOKENS * APPROX_CHARS_PER_TOKEN:
        text.append(FILLER.format(n=n, m=(n * 7) % 101)); n += 1
    prompt = "".join(text) + "\nWrite a long JavaScript module of many small functions, with comments.\n"
    post(a.base_url, {"model": a.model, "messages": [{"role": "user", "content": prompt}], "max_tokens": 1, **SAMPLER})
    post(a.base_url, {"model": a.model, "messages": [{"role": "user", "content": prompt}], "max_tokens": CONTINUATION_TOKENS, **SAMPLER})
    with open(a.server_log, errors="replace") as f:
        got = last_request(f)
    print(json.dumps({"sampler": SAMPLER, "prompt_tokens_target": PROMPT_TOKENS, **got}, indent=1))
    return 0 if got else 1


if __name__ == "__main__":
    sys.exit(main())
