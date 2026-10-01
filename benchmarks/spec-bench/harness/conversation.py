"""conversation.py — what the agent's conversation on one story looked like, counted from its event log. No LLM.

The profile records the signs that explained 4.5x differences between runs of the same setup (30 Sep 2026: one
64,000-character thinking block stayed in the context and made every later call think five times as much): how
much the model thought and when, how its context grew, what its tools did. It is recorded per story in
metrics.json as "conversation"; the benchmarker compares it with the same story in the combination's other runs.

Only events inside the story's window [t_from, t_to] count: a restarted story's log also holds earlier attempts.
A log without receive stamps (_rx: from before the harness stamped them) can't be placed in time: no profile.

Two clients' logs are read. pi's: one message_end per model call, thinking text included. Claude Code's (stream-json):
each content block of a model message is its own "assistant" event under the message's id, thinking text is
withheld (the blocks arrive empty), and while the model thinks the client streams running estimates of its
thinking tokens, restarting with each message. So a Claude profile has thinking_visible False and every
character count of thinking None (never 0: it isn't known), and estimated thinking tokens instead. The exact count
exists only per invocation: each closing "result" event carries that invocation's own total (not cumulative over a
resumed session), so thinking_tokens is their sum over the window; there is no exact count per call. A subagent's
messages (parent_tool_use_id set) are counted apart, as subagent_calls: they aren't the agent's own calls.
Tests: test_conversation.py.
"""
from __future__ import annotations

import json
import statistics
from pathlib import Path

VERSION = 2                    # 2: Claude's exact thinking total; estimated thinking per call around the largest
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
    calls: list[dict] = []               # per model call: thinking, estimated thinking, context, when
    text = args = tool_calls = errors = 0
    by_name: dict[str, int] = {}
    starts: dict = {}
    longest = None
    claude = False
    by_id: dict[str, dict] = {}          # Claude: the call each message id is, as its blocks arrive
    subagent: set[str] = set()
    estimate = None                      # Claude: the latest running estimate of the thinking in progress
    exact = None                         # Claude: the invocations' exact thinking tokens, from their results
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
                calls.append({"think": think, "estimate": None, "at": rx - t_from,
                              "context": int(u.get("input") or 0) + int(u.get("cacheRead") or 0)})
            elif t == "tool_execution_start":
                starts[e.get("toolCallId")] = (rx, e.get("toolName") or "?", str((e.get("args") or {}).get("command") or (e.get("args") or {}).get("path") or ""))
            elif t == "tool_execution_end":
                errors += bool(e.get("isError"))
                if (s := starts.pop(e.get("toolCallId"), None)) is not None:
                    longest = _longer(longest, rx - s[0], s)
            elif t == "system" and e.get("subtype") == "thinking_tokens":
                estimate = e.get("estimated_tokens")
            elif t == "result":
                n = ((e.get("usage") or {}).get("output_tokens_details") or {}).get("thinking_tokens")
                if isinstance(n, int):
                    exact = (exact or 0) + n
            elif t == "assistant" and isinstance(e.get("message"), dict):
                claude = True
                m = e["message"]
                mid = m.get("id")
                if e.get("parent_tool_use_id"):
                    subagent.add(mid)
                    estimate = None
                    continue
                call = by_id.get(mid)
                if call is None:
                    u = m.get("usage") if isinstance(m.get("usage"), dict) else {}
                    call = by_id[mid] = {"think": None, "estimate": estimate, "at": rx - t_from, "context": int(
                        u.get("input_tokens") or 0) + int(u.get("cache_read_input_tokens") or 0) + int(
                        u.get("cache_creation_input_tokens") or 0)}
                    calls.append(call)
                    estimate = None
                call["at"] = rx - t_from
                for b in m.get("content") if isinstance(m.get("content"), list) else []:
                    if b.get("type") == "text":
                        text += len(b.get("text") or "")
                    elif b.get("type") == "tool_use":
                        tool_calls += 1
                        name = b.get("name") or "?"
                        by_name[name] = by_name.get(name, 0) + 1
                        inp = b.get("input") if isinstance(b.get("input"), dict) else {}
                        args += len(json.dumps(inp))
                        starts[b.get("id")] = (rx, name, str(inp.get("command") or inp.get("file_path") or inp.get("path") or ""))
            elif t == "user" and not e.get("parent_tool_use_id") and isinstance(e.get("message"), dict):
                for b in e["message"].get("content") if isinstance(e["message"].get("content"), list) else []:
                    if isinstance(b, dict) and b.get("type") == "tool_result":
                        errors += bool(b.get("is_error"))
                        if (s := starts.pop(b.get("tool_use_id"), None)) is not None:
                            longest = _longer(longest, rx - s[0], s)
    for s in starts.values():            # never ended: it ran to the end of the story at least
        longest = _longer(longest, t_to - s[0], s)
    if not calls:
        return None
    jumps = [(calls[i]["context"] - calls[i - 1]["context"], i) for i in range(1, len(calls))]
    jump = max(jumps, default=(0, 0))
    # Only signs that are abnormal on any stack. A long thinking block isn't one: what's long depends on the
    # combination, so thinking is compared with the same story's other runs, by the benchmarker.
    signals = []
    if longest and longest["seconds"] >= HUNG_TOOL_S:
        signals.append("hung-command")
    ests = [c["estimate"] for c in calls]
    est_big = max((i for i, x in enumerate(ests) if x is not None), key=lambda i: (ests[i], -i), default=None)
    return {
        "version": VERSION, "calls": len(calls), "tool_calls": tool_calls, **_thinking(calls, visible=not claude),
        "text_chars": text, "tool_arg_chars": args,
        "thinking_tokens": exact,
        "thinking_estimated_tokens": sum(x for x in ests if x is not None) if est_big is not None else None,
        "largest_thinking_estimated": {"tokens": ests[est_big], "call": est_big + 1, "at_s": round(calls[est_big]["at"], 1)}
                                      if est_big is not None else None,
        # per call, around the largest block; a call with no estimate before it didn't think (0)
        "thinking_estimated_median_before": _median([x or 0 for x in ests[:est_big]]) if est_big is not None else None,
        "thinking_estimated_median_after": _median([x or 0 for x in ests[est_big + 1:]]) if est_big is not None else None,
        "context_start": calls[0]["context"], "context_end": calls[-1]["context"],
        "largest_context_jump": {"tokens": jump[0], "call": jump[1] + 1} if jump[0] > 0 else None,
        "tools_by_name": by_name, "tool_errors": errors, "longest_tool": longest, "signals": signals,
        "subagent_calls": len(subagent),
    }


def _thinking(calls: list[dict], visible: bool) -> dict:
    """Thinking in characters, per call and around the largest block; all None where the log withholds it."""
    if not visible:
        return {"thinking_visible": False, "thinking_chars": None, "thinking_median": None, "thinking_median_before": None,
                "thinking_median_after": None, "largest_thinking": None}
    thinks = [c["think"] for c in calls]
    big = max(range(len(calls)), key=lambda i: (thinks[i], -i)) if any(thinks) else None
    return {
        "thinking_visible": True, "thinking_chars": sum(thinks), "thinking_median": _median(thinks),
        "thinking_median_before": _median(thinks[:big]) if big is not None else None,
        "thinking_median_after": _median(thinks[big + 1:]) if big is not None else None,
        "largest_thinking": {"chars": thinks[big], "call": big + 1, "at_s": round(calls[big]["at"], 1)} if big is not None else None,
    }


def _longer(cur: dict | None, secs: float, start: tuple) -> dict | None:
    if cur is not None and cur["seconds"] >= secs:
        return cur
    return {"seconds": round(secs, 1), "name": start[1], "gist": start[2][:GIST_CHARS]}
