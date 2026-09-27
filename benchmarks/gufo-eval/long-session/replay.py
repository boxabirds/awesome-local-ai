# /// script
# requires-python = ">=3.11"
# ///
"""Replay a captured agent request against a server and measure what comes back.

    uv run replay.py --url http://127.0.0.1:PORT --engine NAME --requests replay-*.json --out FILE.jsonl
        [--repeats 3] [--variant as-is|effort-low] [--max-tokens N]

The request is sent as captured from pi (system prompt, tools, history with prior reasoning, no
sampling fields, so the server's own defaults apply, as in the benchmark runs), except the model
name, which becomes the one the server lists. Streamed, so time to first token is measured on the
client. Records prompt tokens as the server reports them, generated tokens, reasoning and content
length, and whether the reply ends in a tool call whose arguments parse as JSON.
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.request
from pathlib import Path

REQUEST_TIMEOUT_S = 1800
LISTING_TIMEOUT_S = 10
VARIANTS = {"as-is": {}, "effort-low": {"reasoning_effort": "low"}}


def served_model(url: str) -> str:
    with urllib.request.urlopen(f"{url}/v1/models", timeout=LISTING_TIMEOUT_S) as r:
        data = json.loads(r.read()).get("data") or [{}]
    return data[0].get("id", "default")


def replay(url: str, body: dict) -> dict:
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    t0 = time.monotonic()
    t_first = None
    reasoning, content, usage, finish = [], [], {}, None
    calls: dict[int, dict] = {}
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_S) as r:
        for raw in r:
            line = raw.decode(errors="replace").strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[5:])
            usage = chunk.get("usage") or usage
            for c in chunk.get("choices") or []:
                d = c.get("delta") or {}
                piece = (d.get("reasoning_content") or d.get("reasoning") or "")
                if piece or d.get("content") or d.get("tool_calls"):
                    t_first = t_first or time.monotonic()
                reasoning.append(piece)
                content.append(d.get("content") or "")
                for tc in d.get("tool_calls") or []:
                    slot = calls.setdefault(tc.get("index", 0), {"name": "", "args": ""})
                    fn = tc.get("function") or {}
                    slot["name"] += fn.get("name") or ""
                    slot["args"] += fn.get("arguments") or ""
                finish = c.get("finish_reason") or finish
    t_end = time.monotonic()

    def parses(s: str) -> bool:
        try:
            json.loads(s)
            return True
        except ValueError:
            return False

    return {"seconds": round(t_end - t0, 1), "ttft_s": round(t_first - t0, 2) if t_first else None,
            "prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens"),
            "reasoning_chars": len("".join(reasoning)), "content_chars": len("".join(content)),
            "tool_calls": [c["name"] for c in calls.values()],
            "tool_args_valid": all(parses(c["args"]) for c in calls.values()) if calls else None,
            "finish": finish}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True)
    ap.add_argument("--engine", required=True)
    ap.add_argument("--requests", nargs="+", type=Path, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--repeats", type=int, default=3)
    ap.add_argument("--variant", choices=list(VARIANTS), default="as-is")
    ap.add_argument("--max-tokens", type=int, default=0, help="cap max_completion_tokens (0: as captured)")
    a = ap.parse_args()
    model = served_model(a.url)
    # repeats of one request back to back: llama.cpp keeps one prompt per slot, so interleaving
    # requests would re-read the whole prompt (minutes at 100k on this machine) every time
    for path in a.requests:
        for rep in range(1, a.repeats + 1):
            body = json.loads(path.read_text())
            body.update(model=model, stream=True, stream_options={"include_usage": True}, **VARIANTS[a.variant])
            if a.max_tokens:
                body["max_completion_tokens"] = min(body.get("max_completion_tokens") or a.max_tokens, a.max_tokens)
            try:
                r = replay(a.url, body)
            except Exception as e:  # a failure is a result too
                r = {"error": f"{type(e).__name__}: {e}"}
            r.update({"engine": a.engine, "variant": a.variant, "request": path.name, "repeat": rep})
            with open(a.out, "a") as f:
                f.write(json.dumps(r) + "\n")
            print(json.dumps(r), flush=True)


if __name__ == "__main__":
    main()
