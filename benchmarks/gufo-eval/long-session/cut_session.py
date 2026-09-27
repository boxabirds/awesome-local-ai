# /// script
# requires-python = ">=3.11"
# ///
"""Cut a recorded pi session just after a tool result, at about a given context size.

    uv run cut_session.py SESSION.jsonl --near-tokens 30000,60000,100000 --out DIR

Context size is estimated from the assistant messages' recorded usage (input + cache read) and
the cut is made after the last tool result before that point, so the next request is the one the
agent made there. The entries after a compaction replace the history before it, so a cut never
lands inside one. Writes DIR/cut-<N>k.jsonl.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

TOKENS_PER_K = 1000


def context_of(msg: dict) -> int | None:
    u = msg.get("usage") or {}
    n = (u.get("input") or 0) + (u.get("cacheRead") or 0)
    return n or None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session", type=Path)
    ap.add_argument("--near-tokens", required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    lines = a.session.read_text().splitlines()
    a.out.mkdir(parents=True, exist_ok=True)
    points = []  # (line index after a toolResult, context of the next assistant message)
    for i, l in enumerate(lines):
        d = json.loads(l)
        if d.get("type") != "message":
            continue
        m = d.get("message") or {}
        if m.get("role") == "assistant" and points and points[-1][1] is None:
            points[-1] = (points[-1][0], context_of(m))
        if m.get("role") == "toolResult":
            points.append((i, None))
    for target in (int(x) for x in a.near_tokens.split(",")):
        ok = [(i, c) for i, c in points if c and c <= target]
        if not ok:
            print(f"no cut at or below {target}")
            continue
        i, c = max(ok, key=lambda p: p[1])
        path = a.out / f"cut-{target // TOKENS_PER_K}k.jsonl"
        path.write_text("\n".join(lines[: i + 1]) + "\n")
        print(f"{path.name}: {i + 1} lines, next request context ~{c} tokens")


if __name__ == "__main__":
    main()
