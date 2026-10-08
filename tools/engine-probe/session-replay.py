#!/usr/bin/env python3
"""Replay a recorded agent session against a model server, reading the server's memory as it goes.

The harness records every agent session as pi streamed it (`stories/NN/agent-events.jsonl`): the system prompt, the task,
each assistant message with its tool calls, each tool result, each compaction. From it this rebuilds the request the agent
made for every model call, in order, and sends them to a server, so the server sees the SAME sizes, in the SAME order, with
the same text, without the agent having to do hours of work. After every few requests it reads how the server process's
memory divides (macOS `footprint -p` by category; Linux RssAnon / RssFile).

Written on 8 Oct 2026 to find whether MTPLX 2.12.2's growing host memory is a leak or a sizing problem. A synthetic test of
equal-sized prompts showed memory that follows the context length and is given back; the failed run's own log showed a step
from 6.65 to 11.5 GiB of host memory that no synthetic pattern reproduced.

What is exact and what is not:
  exact      the system prompt (its sections joined as pi joins them), the task, every assistant message, every tool call and
             result, the tool definitions (pi 0.87.1's four, fixtures/pi-tools.json), and the order and number of requests.
  estimated  what a COMPACTION kept. pi's event records the summary and how big the context became (`estimatedTokensAfter`)
             but not which messages it kept; the most recent messages that fit that size are used.
  different  the model's answers: each request asks for a few tokens, not what the model wrote, so the history the server
             caches is the recorded one, not what it would have said.
Every request's token count as the SERVER counted it is recorded beside what the agent's model reported for the same call,
so how close the replay is can be read off, not assumed.

    uv run tools/engine-probe/session-replay.py --base-url http://127.0.0.1:18010/v1 --model NAME --port 18010 \\
        --events stories/01/agent-events.jsonl stories/02/agent-events.jsonl --out /tmp/replay.jsonl
    uv run tools/engine-probe/session-replay.py --self-test
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "benchmarks" / "spec-bench" / "harness"))

TOOLS_FIXTURE = HERE / "fixtures" / "pi-tools.json"
APPROX_CHARS_PER_TOKEN = 3.6
ANSWER_TOKENS = 16
TIMEOUT_S = 1800
READ_EVERY = 5
SUMMARY_PREFIX = "The conversation so far has been compacted into this summary:\n\n"


def text_of(content) -> str:
    """The text of a message's content: a string, or the text parts of a list of parts."""
    if isinstance(content, str):
        return content
    return "".join(p.get("text", "") for p in content or [] if p.get("type") == "text")


def estimate_tokens(message: dict) -> int:
    return int(len(json.dumps(message)) / APPROX_CHARS_PER_TOKEN)


def to_openai(message: dict, with_reasoning: bool = False) -> dict:
    """pi's message as the OpenAI chat message pi sends for it."""
    role = message["role"]
    if role == "user":
        return {"role": "user", "content": text_of(message.get("content"))}
    if role == "toolResult":
        return {"role": "tool", "tool_call_id": message["toolCallId"], "content": text_of(message.get("content"))}
    parts = message.get("content") or []
    out: dict = {"role": "assistant", "content": text_of(parts) or None}
    calls = [{"id": p["id"], "type": "function", "function": {"name": p["name"], "arguments": json.dumps(p.get("arguments", {}))}}
             for p in parts if isinstance(p, dict) and p.get("type") == "toolCall"]
    if calls:
        out["tool_calls"] = calls
    if with_reasoning:
        thinking = "".join(p.get("thinking", "") for p in parts if isinstance(p, dict) and p.get("type") == "thinking")
        if thinking:
            out["reasoning_content"] = thinking
    return out


def after_compaction(history: list[dict], summary: str, tokens_after: int) -> list[dict]:
    """The context a compaction left: the summary, then the most recent messages that fit what pi says the context became.

    pi records which message it kept from (`firstKeptEntryId`) but the events carry no entry ids, so this is an estimate:
    walk back from the newest message until the size is reached, starting the kept tail at a user or assistant message
    (a tool result with its call dropped would not be a valid conversation)."""
    head = {"role": "user", "content": [{"type": "text", "text": SUMMARY_PREFIX + summary}]}
    budget = max(0, tokens_after - estimate_tokens(head))
    kept: list[dict] = []
    used = 0
    for m in reversed(history):
        used += estimate_tokens(m)
        if used > budget:
            break
        kept.append(m)
    kept.reverse()
    while kept and kept[0]["role"] == "toolResult":
        kept.pop(0)
    return [head] + kept


def turns_from_events(lines, with_reasoning: bool = False) -> list[dict]:
    """One dict per model call, in order: the messages the agent sent and the prompt size its model reported."""
    system = ""
    history: list[dict] = []
    turns: list[dict] = []
    pending: dict | None = None
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        kind = e.get("type")
        if kind == "message_end":
            m = e["message"]
            if m["role"] == "system":
                system = "\n\n".join(m.get("sections", {}).values()) or text_of(m.get("content"))
            else:
                history.append(m)
        elif kind == "turn_start":
            pending = {"messages": [{"role": "system", "content": system}] + [to_openai(m, with_reasoning) for m in history]}
        elif kind == "turn_end" and pending is not None:
            u = (e.get("message") or {}).get("usage") or {}
            pending["expected_tokens"] = (u.get("input") or 0) + (u.get("cacheRead") or 0) + (u.get("cacheWrite") or 0)
            turns.append(pending)
            pending = None
        elif kind == "compaction_end" and not e.get("aborted"):
            r = e.get("result") or {}
            if r.get("summary"):
                history = after_compaction(history, r["summary"], int(r.get("estimatedTokensAfter") or 0))
    return turns


def post(base_url: str, body: dict) -> dict:
    req = urllib.request.Request(base_url.rstrip("/") + "/chat/completions", json.dumps(body).encode(), {"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return json.load(r)


def self_test() -> None:
    def ev(t, **kw):
        return json.dumps({"type": t, **kw})
    asst = lambda calls, usage: {"role": "assistant", "content": [{"type": "thinking", "thinking": "hm"}, *calls], "usage": usage}
    call = {"type": "toolCall", "id": "c1", "name": "bash", "arguments": {"command": "ls"}}
    lines = [
        ev("message_end", message={"role": "system", "content": "", "sections": {"preamble": "You are pi.", "rules": "Be brief."}}),
        ev("message_end", message={"role": "user", "content": [{"type": "text", "text": "Do story 1."}]}),
        ev("turn_start"),
        ev("message_end", message=asst([call], {})),
        ev("turn_end", message=asst([call], {"input": 100, "cacheRead": 50, "cacheWrite": 0})),
        ev("message_end", message={"role": "toolResult", "toolCallId": "c1", "toolName": "bash", "content": [{"type": "text", "text": "a\nb"}]}),
        ev("turn_start"),
        ev("turn_end", message=asst([], {"input": 20, "cacheRead": 160})),
    ]
    turns = turns_from_events(lines)
    assert len(turns) == 2 and [t["expected_tokens"] for t in turns] == [150, 180]
    first, second = turns[0]["messages"], turns[1]["messages"]
    assert first[0] == {"role": "system", "content": "You are pi.\n\nBe brief."}
    assert [m["role"] for m in first] == ["system", "user"]
    assert [m["role"] for m in second] == ["system", "user", "assistant", "tool"]
    assert second[2]["tool_calls"][0]["function"] == {"name": "bash", "arguments": json.dumps({"command": "ls"})}
    assert "reasoning_content" not in second[2]
    assert turns_from_events(lines, with_reasoning=True)[1]["messages"][2]["reasoning_content"] == "hm"
    assert second[3] == {"role": "tool", "tool_call_id": "c1", "content": "a\nb"}
    # a compaction replaces the older history with its summary and a recent tail that is a valid conversation
    big = [{"role": "user", "content": "x" * 3600}, {"role": "assistant", "content": [{"type": "text", "text": "y" * 3600}]},
           {"role": "toolResult", "toolCallId": "c", "toolName": "bash", "content": [{"type": "text", "text": "z" * 360}]}]
    out = after_compaction(big, "SUMMARY", tokens_after=estimate_tokens(big[2]) + estimate_tokens(big[1]) + 50)
    assert out[0]["content"][0]["text"] == SUMMARY_PREFIX + "SUMMARY"
    assert [m["role"] for m in out[1:]] == ["assistant", "toolResult"], "starts at the assistant message that holds the call"
    assert after_compaction(big, "S", tokens_after=1)[1:] == [], "nothing fits: just the summary"
    assert json.loads(TOOLS_FIXTURE.read_text())[0]["function"]["name"] == "read"
    print("self-test ok")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url")
    ap.add_argument("--model")
    ap.add_argument("--port", type=int)
    ap.add_argument("--events", nargs="+", help="agent-events.jsonl files, in story order")
    ap.add_argument("--out", default="session-replay.jsonl")
    ap.add_argument("--read-every", type=int, default=READ_EVERY, help="read the process's memory every N requests")
    ap.add_argument("--with-reasoning", action="store_true", help="send the model's recorded thinking back as reasoning_content")
    ap.add_argument("--limit", type=int, default=0, help="stop after this many requests (0 = all)")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        self_test()
        return 0
    if not (a.base_url and a.model and a.port and a.events):
        ap.error("--base-url, --model, --port and --events are required")
    import importlib.util
    spec = importlib.util.spec_from_file_location("memory_growth", HERE / "memory-growth.py")
    mg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mg)
    tools = json.loads(TOOLS_FIXTURE.read_text())
    pid = mg.server_pid(a.port)
    if not pid:
        print(f"nothing is listening on port {a.port}", file=sys.stderr)
        return 1
    out = open(a.out, "a")
    sent, deviations = 0, []
    for story_index, path in enumerate(a.events, 1):
        with open(path, errors="replace") as f:
            turns = turns_from_events(f, a.with_reasoning)
        for number, turn in enumerate(turns, 1):
            t = time.time()
            resp = post(a.base_url, {"model": a.model, "messages": turn["messages"], "tools": tools, "max_tokens": ANSWER_TOKENS, "temperature": 0})
            secs = time.time() - t
            u = resp.get("usage", {})
            sent += 1
            row = {"kind": "request", "n": sent, "file": story_index, "turn": number, "expected_tokens": turn["expected_tokens"],
                   "prompt_tokens": u.get("prompt_tokens"), "cached_tokens": (u.get("prompt_tokens_details") or {}).get("cached_tokens"),
                   "seconds": round(secs, 2), "at": round(time.time(), 1)}
            if u.get("prompt_tokens") and turn["expected_tokens"]:
                deviations.append(u["prompt_tokens"] / turn["expected_tokens"] - 1)
            if sent % a.read_every == 1 or a.read_every == 1:
                row.update(mg.read_process(pid))
            out.write(json.dumps(row) + "\n")
            out.flush()
            if a.limit and sent >= a.limit:
                break
        if a.limit and sent >= a.limit:
            break
    if deviations:
        print(f"{sent} requests; server's prompt tokens against the agent's model's: median {statistics.median(deviations):+.1%}, "
              f"5th to 95th percentile {sorted(deviations)[len(deviations) // 20]:+.1%} to {sorted(deviations)[-1 - len(deviations) // 20]:+.1%}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
