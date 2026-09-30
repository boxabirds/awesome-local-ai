"""conversation.py — what the agent's conversation on one story looked like, counted from its event log. No LLM.

The profile records the signs that explained 4.5x differences between runs of the same setup (30 Sep 2026: one
64,000-character thinking block stayed in the context and made every later call think five times as much): how
much the model thought and when, how its context grew, what its tools did. It is recorded per story in
metrics.json as "conversation"; the benchmarker compares it with the same story in the combination's other runs.

Only events inside the story's window [t_from, t_to] count: a restarted story's log also holds earlier attempts.
A log without receive stamps (_rx: from before the harness stamped them) can't be placed in time: no profile.
Tests: test_conversation.py.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

VERSION = 1
LONG_THINKING_CHARS = 20_000   # one block this long put gufo v2-r1 story 2 into its verbose mode
HUNG_TOOL_S = 600              # a single tool call of ten minutes: a dev server or watcher left running
GIST_CHARS = 120
UPDATE_PREFIX = 80             # message_update lines are most of a log; skip them without parsing


def _median(xs: list[int]) -> int | None:
    return int(statistics.median(xs)) if xs else None


def profile(events: Path, t_from: float, t_to: float) -> dict | None:
    """The story's conversation profile, as metrics.json records it; None if the log has no timed model call."""
    try:
        f = Path(events).open(errors="replace")
    except OSError:
        return None
    calls: list[dict] = []               # per model call: thinking, context, when
    text = args = tool_calls = errors = 0
    by_name: dict[str, int] = {}
    starts: dict = {}
    longest = None
    with f:
        for line in f:
            if '"message_update"' in line[:UPDATE_PREFIX]:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue                 # cut off when the agent was killed mid-write
            rx = e.get("_rx") if isinstance(e, dict) else None
            if rx is None or not (t_from <= rx <= t_to):
                continue
            t = e.get("type")
            if t == "message_end" and (e.get("message") or {}).get("role") == "assistant":
                m = e["message"]
                content = m.get("content") if isinstance(m.get("content"), list) else []
                think = sum(len(b.get("thinking") or "") for b in content if b.get("type") == "thinking")
                text += sum(len(b.get("text") or "") for b in content if b.get("type") == "text")
                for b in content:
                    if b.get("type") == "toolCall":
                        tool_calls += 1
                        by_name[b.get("name") or "?"] = by_name.get(b.get("name") or "?", 0) + 1
                        args += len(json.dumps(b.get("arguments") or {}))
                u = m.get("usage") if isinstance(m.get("usage"), dict) else {}
                calls.append({"think": think, "at": rx - t_from, "context": int(u.get("input") or 0) + int(u.get("cacheRead") or 0)})
            elif t == "tool_execution_start":
                starts[e.get("toolCallId")] = (rx, e.get("toolName") or "?", str((e.get("args") or {}).get("command") or (e.get("args") or {}).get("path") or ""))
            elif t == "tool_execution_end":
                errors += bool(e.get("isError"))
                if (s := starts.pop(e.get("toolCallId"), None)) is not None:
                    longest = _longer(longest, rx - s[0], s)
    for s in starts.values():            # never ended: it ran to the end of the story at least
        longest = _longer(longest, t_to - s[0], s)
    if not calls:
        return None
    thinks = [c["think"] for c in calls]
    big = max(range(len(calls)), key=lambda i: (thinks[i], -i)) if any(thinks) else None
    jumps = [(calls[i]["context"] - calls[i - 1]["context"], i) for i in range(1, len(calls))]
    jump = max(jumps, default=(0, 0))
    signals = []
    if big is not None and thinks[big] >= LONG_THINKING_CHARS:
        signals.append("long-thinking-block")
    if longest and longest["seconds"] >= HUNG_TOOL_S:
        signals.append("hung-command")
    return {
        "version": VERSION, "calls": len(calls), "tool_calls": tool_calls, "thinking_chars": sum(thinks),
        "text_chars": text, "tool_arg_chars": args, "thinking_median": _median(thinks),
        "thinking_median_before": _median(thinks[:big]) if big is not None else None,
        "thinking_median_after": _median(thinks[big + 1:]) if big is not None else None,
        "largest_thinking": {"chars": thinks[big], "call": big + 1, "at_s": round(calls[big]["at"], 1)} if big is not None else None,
        "context_start": calls[0]["context"], "context_end": calls[-1]["context"],
        "largest_context_jump": {"tokens": jump[0], "call": jump[1] + 1} if jump[0] > 0 else None,
        "tools_by_name": by_name, "tool_errors": errors, "longest_tool": longest, "signals": signals,
    }


def _longer(cur: dict | None, secs: float, start: tuple) -> dict | None:
    if cur is not None and cur["seconds"] >= secs:
        return cur
    return {"seconds": round(secs, 1), "name": start[1], "gist": start[2][:GIST_CHARS]}
