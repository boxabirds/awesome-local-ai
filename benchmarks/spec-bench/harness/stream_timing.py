"""stream_timing.py <agent-events.jsonl> — each model call's prefill and decode time, from the agent client's own
streamed events, and a story's totals.

pi writes every assistant message as message_start (the request is sent), message_update events as chunks stream
back, and message_end (with the call's tokens). The first chunk marks the end of prefill; the rest is decode. This
times the model for any OpenAI-compatible server, with nothing between the agent and the server (no proxy), and
works on runs already made, from the full log each machine keeps (stories/NN/agent-events.jsonl; the compact copy
in git drops the updates). The client sees network time too, which on the same machine is negligible.
"""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path

DECIMALS = 1


@dataclass
class Call:
    prefill_s: float
    decode_s: float
    input: int
    cached: int
    output: int
    end: float = 0.0


def calls(path: Path) -> list[Call]:
    out: list[Call] = []
    start = first = None
    if not Path(path).is_file():  # a story that ended before the agent logged anything
        return out
    for line in Path(path).read_text(errors="replace").splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t, rx = e.get("type"), e.get("_rx")
        role = (e.get("message") or {}).get("role")
        if t == "message_start" and role == "assistant":
            start, first = rx, None
        elif t == "message_update" and start is not None and first is None:
            first = rx
        elif t == "message_end" and role == "assistant" and start is not None:
            u = e["message"].get("usage") or {}
            if isinstance(u, str):  # a compacted log keeps usage as text; the full one as an object
                u = {}
            split = first if first is not None else rx  # nothing streamed: all of it was waiting
            out.append(Call(round(split - start, 3), round(rx - split, 3), int(u.get("input") or 0),
                            int(u.get("cacheRead") or 0), int(u.get("output") or 0), rx))
            start = first = None
    return out


def summary(cs: list[Call]) -> dict | None:
    """A story's model time like the harness's time_split["model"]: prefill counts fresh input only (cached
    input costs almost nothing to read), decode counts output."""
    if not cs:
        return None
    pre_s, dec_s = sum(c.prefill_s for c in cs), sum(c.decode_s for c in cs)
    pre_n, dec_n = sum(c.input for c in cs), sum(c.output for c in cs)
    return {
        "source": "client-stream", "requests": len(cs),
        "prefill_s": round(pre_s, DECIMALS), "prefill_tokens": pre_n,
        "prefill_tok_s": round(pre_n / pre_s, DECIMALS) if pre_s else None,
        "decode_s": round(dec_s, DECIMALS), "decode_tokens": dec_n,
        "decode_tok_s": round(dec_n / dec_s, DECIMALS) if dec_s else None,
        "cached_tokens": sum(c.cached for c in cs),
    }


if __name__ == "__main__":
    print(json.dumps(summary(calls(Path(sys.argv[1]))), indent=2))
