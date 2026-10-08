#!/usr/bin/env python3
"""Ten minutes that say whether a server holds a long context: one long prompt, one hidden fact, one short answer.

Not a benchmark and not a story. It sends ONE request whose prompt is about --tokens tokens of filler code with a
secret string planted near the start, asks for the string back, then asks for a short continuation to time decoding.
It reports: whether the secret came back, the prompt tokens the server counted, how long the prompt took to read,
the decode speed on the second request (which reuses the prompt), and the cached prefix the server reported.

Memory and swap are read by the caller around this run (the node's own tools: vm_stat / memory_pressure, free,
nvidia-smi); this script only talks to the server.

    uv run tools/engine-probe/long-context.py --base-url http://127.0.0.1:8011/v1 --model NAME --tokens 250000
    uv run tools/engine-probe/long-context.py --self-test
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

TIMEOUT_S = 1500
SECRET = "KESTREL-4417-ORCHID"
FILLER_LINE = "function step_{n}(x) {{ return (x * {n} + {m}) % 9973; }}\n"
APPROX_CHARS_PER_TOKEN = 3.6  # code filler; the server's own count is what is reported
DECODE_TOKENS = 200
CALIBRATION_TOKENS = 4000
# A thinking model spends tokens reasoning before it answers; a small limit returns an empty reply.
ANSWER_TOKENS = 4096
# Later filler lines have longer numbers, so the small sample reads a little denser than the whole prompt.
CALIBRATION_DRIFT = 0.92
MIN_RETRIEVAL_SHARE = 1.0


def build_prompt(tokens: int, chars_per_token: float = APPROX_CHARS_PER_TOKEN) -> str:
    """Filler code of about `tokens` tokens with the secret on the first line and a question at the end."""
    lines = [f"// The access phrase for this file is {SECRET}. Remember it.\n"]
    chars, n = len(lines[0]), 0
    target = int(tokens * chars_per_token)
    while chars < target:
        line = FILLER_LINE.format(n=n, m=(n * 7) % 101)
        lines.append(line)
        chars += len(line)
        n += 1
    lines.append("\nQuestion: what is the access phrase stated in the first line? Answer with the phrase only.\n")
    return "".join(lines)


def post(base_url: str, body: dict) -> dict:
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", json.dumps(body).encode(),
                                 {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"server answered {e.code}: {e.read().decode(errors='replace')[:400]}")


def retrieved(answer: str) -> bool:
    return SECRET in (answer or "")


def summarise(first: dict, first_s: float, second: dict, second_s: float) -> dict:
    u1, u2 = first.get("usage", {}), second.get("usage", {})
    out = u2.get("completion_tokens") or 0
    answer = (first["choices"][0]["message"].get("content") or "")
    cached = (u2.get("prompt_tokens_details") or {}).get("cached_tokens")
    return {
        "retrieved_secret": retrieved(answer),
        "prompt_tokens": u1.get("prompt_tokens"),
        "first_request_s": round(first_s, 1),
        "prefill_tok_s": round(u1["prompt_tokens"] / first_s) if u1.get("prompt_tokens") and first_s else None,
        "second_request_s": round(second_s, 1),
        "second_completion_tokens": out,
        "second_cached_tokens": cached,
        "answer_head": answer.strip()[:80],
    }


def measured_chars_per_token(base_url: str, model: str) -> float:
    """Ask the server how many tokens a small sample of the filler is: its tokenizer, not a guess, sizes the prompt."""
    sample = build_prompt(CALIBRATION_TOKENS)
    used = post(base_url, {"model": model, "messages": [{"role": "user", "content": sample}], "max_tokens": 1,
                           "temperature": 0})["usage"]["prompt_tokens"]
    return len(sample) / used


def run(base_url: str, model: str, tokens: int) -> dict:
    prompt = build_prompt(tokens, measured_chars_per_token(base_url, model) * CALIBRATION_DRIFT)
    msg = [{"role": "user", "content": prompt}]
    t = time.time()
    first = post(base_url, {"model": model, "messages": msg, "max_tokens": ANSWER_TOKENS, "temperature": 0})
    first_s = time.time() - t
    msg2 = msg + [{"role": "assistant", "content": first["choices"][0]["message"].get("content") or ""},
                  {"role": "user", "content": f"Now write {DECODE_TOKENS} tokens of any JavaScript."}]
    t = time.time()
    second = post(base_url, {"model": model, "messages": msg2, "max_tokens": DECODE_TOKENS, "temperature": 0})
    return summarise(first, first_s, second, time.time() - t)


def self_test() -> None:
    p = build_prompt(1000)
    assert p.startswith("// The access phrase") and SECRET in p.splitlines()[0]
    assert abs(len(p) / APPROX_CHARS_PER_TOKEN - 1000) < 100
    assert "Question:" in p.splitlines()[-2] or "Question:" in p
    # a prompt sized with a measured ratio is that many characters per token, not the default guess
    dense = build_prompt(1000, 1.7)
    assert abs(len(dense) / 1.7 - 1000) < 100 and len(dense) < len(build_prompt(1000))
    assert retrieved(f"it is {SECRET}.") and not retrieved("I do not know") and not retrieved(None)
    first = {"choices": [{"message": {"content": SECRET}}], "usage": {"prompt_tokens": 250000}}
    second = {"choices": [{"message": {"content": "x"}}],
              "usage": {"completion_tokens": 200, "prompt_tokens_details": {"cached_tokens": 249900}}}
    s = summarise(first, 250.0, second, 5.0)
    assert s["retrieved_secret"] and s["prefill_tok_s"] == 1000 and s["second_cached_tokens"] == 249900
    miss = summarise({"choices": [{"message": {"content": "no"}}], "usage": {}}, 1.0, {"choices": [], "usage": {}}, 1.0)
    assert not miss["retrieved_secret"] and miss["prefill_tok_s"] is None
    print("self-test ok")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--model")
    ap.add_argument("--tokens", type=int)
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
        return 0
    if not (a.base_url and a.model and a.tokens):
        ap.error("--base-url, --model and --tokens are required")
    result = run(a.base_url, a.model, a.tokens)
    print(json.dumps(result, indent=1))
    return 0 if result["retrieved_secret"] else 1


if __name__ == "__main__":
    sys.exit(main())
