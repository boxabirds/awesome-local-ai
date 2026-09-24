#!/usr/bin/env python3
"""Reproduce: MTPLX refuses a coding agent's compaction request while the agent's own long
conversation stays resident, so the conversation can neither continue nor be compacted.

Stdlib only. Point it at an MTPLX server (Flash-Next Optimized-Speed, default memory limit,
--context-window 131072) that nothing else is using:

    python3 compaction_refusal.py --base-url http://127.0.0.1:8000/v1 --model <model-id>

What it does, mirroring what the pi coding agent sent (see the report):
  1. Grows ONE conversation turn by turn to ~115k tokens (each request extends the previous
     one, so MTPLX reuses the prefix and keeps that session resident).
  2. Sends a DIFFERENT ~74k-token request with no shared prefix. That is what pi's
     compaction request looks like: a new prompt holding the older part of the conversation
     plus "summarise this".
Observed in the real session: step 2 is refused with HTTP 507 (memory_refusal), every time.

Status: written from the server's request log of the real incident; NOT yet run as a
standalone script (the only machine that can run it was busy with the benchmark).
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.error
import urllib.request

WORDS_PER_TOKEN = 0.75          # rough English average; MTPLX's request log gives the exact count
TURN_WORDS = 6_000              # ~8k tokens added per turn, like a coding agent's tool output
SESSION_TARGET_TOKENS = 115_000  # pi compacts at window (131072) - reserve (16384) = 114688
COMPACTION_PROMPT_TOKENS = 74_000
REPLY_TOKENS = 16
TIMEOUT_S = 1_800


def filler(n_words: int, seed: int) -> str:
    rng = random.Random(seed)
    vocab = ("board note canvas zoom pan render test build commit file function state "
             "sync socket durable object selection resize handle arrow shape text").split()
    return " ".join(rng.choice(vocab) for _ in range(n_words))


def chat(base: str, model: str, messages: list[dict]) -> tuple[int, str]:
    body = json.dumps({"model": model, "messages": messages, "max_tokens": REPLY_TOKENS,
                       "stream": False}).encode()
    req = urllib.request.Request(f"{base}/chat/completions", body, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            return r.status, json.load(r)["choices"][0]["message"].get("content") or ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:400]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--model", required=True)
    a = ap.parse_args()

    messages = [{"role": "system", "content": "You are a coding agent. Reply with OK."}]
    turn = 0
    while (approx := sum(len(m["content"].split()) for m in messages) / WORDS_PER_TOKEN) < SESSION_TARGET_TOKENS:
        turn += 1
        messages.append({"role": "user", "content": f"Tool output {turn}:\n" + filler(TURN_WORDS, turn)})
        status, reply = chat(a.base_url, a.model, messages)
        print(f"session turn {turn}: ~{approx:,.0f} tokens -> HTTP {status}")
        if status != 200:
            sys.exit(f"the long session itself failed: {reply}")
        messages.append({"role": "assistant", "content": reply or "OK"})

    summary_request = [
        {"role": "system", "content": "Summarise the conversation below for a coding agent."},
        {"role": "user", "content": filler(int(COMPACTION_PROMPT_TOKENS * WORDS_PER_TOKEN), seed=10_000)},
    ]
    status, reply = chat(a.base_url, a.model, summary_request)
    print(f"compaction-style request (~{COMPACTION_PROMPT_TOKENS:,} new tokens) -> HTTP {status}")
    print(reply)
    sys.exit(0 if status == 507 else 1)  # exit 0 = reproduced


if __name__ == "__main__":
    main()
