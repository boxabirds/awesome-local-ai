"""accounting.py — where a story's wall time went, as a partition of its window, with the checks recorded beside it.

Every second of the story's window [t_from, t_to] has exactly one owner: compaction, a tool call, the model's prefill,
its generation (decode), the harness waiting to start the agent's next session after one ended (between sessions), or
other (the agent's own overhead and gaps). When things overlap the higher one owns the second: compaction > tool >
prefill > decode > between sessions. So the parts can't overlap, can't go negative, and always sum to the wall
time, whatever the log holds: an earlier attempt of the story, a tool call that never ended, a compaction's own model
call, concurrent requests.

Model time comes from llama-server's log when it has requests in the window, else from the agent client's own streamed
events (pi: request sent, first chunk, last chunk), which match the server's log to within 0.5% where both exist.
Claude Code's stream (a cloud model, no server log) gives each message's blocks when they are complete and, while the
model thinks, estimates of its thinking: a call runs from the agent's step before it (a tool's result, the session's
start) to its first output (thinking or a block) to its last block. Its output tokens aren't in the stream (each
block carries a running count of a few), so its decode tokens and both rates are None. Rates
(tok/s) come from the counted calls' own durations; the owned seconds are what the partition gave each part. A call is
counted (requests, tokens, rates) when it lies wholly inside the window and isn't a compaction's own call.

check() re-derives the invariants from a finished split, so a stored record can be checked too; time_split() records
them as "accounting": {version, ok, problems, abandoned_calls}. Tests: test_accounting.py.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

import llama_log

VERSION = 3                     # bump when the calculation changes; records say which one made them
TOLERANCE_S = 0.3               # rounding each part to 0.1 s can move a sum by this much
AGENT_CLOCK_TOLERANCE = 0.01    # the wall and the agent's own clock agree within 1% (or 1 s)
DECIMALS = 1
MS_PER_S = 1000.0
PRIORITY = ("compaction", "tool", "prefill", "decode", "between_sessions")

TOOL_KINDS = [("e2e", re.compile(r"playwright|test:e2e")),
              ("unit", re.compile(r"vitest|test:unit|test:component|test:integration|npm (run )?test")),
              ("build", re.compile(r"npm (ci|install|i\b)|npm run build|vite build|\btsc\b|typecheck"))]
RX = re.compile(r'^\{"_rx":\s*([0-9.]+)')


def claude_tool_kind(name: str, tool_input: dict) -> str:
    """tool_kind for Claude Code's tools: Bash commands by what they run, every other tool by its name."""
    if name != "Bash":
        return (name or "other").lower()
    cmd = str((tool_input or {}).get("command", ""))
    return next((k for k, rx in TOOL_KINDS if rx.search(cmd)), "bash")


def tool_kind(e: dict) -> str:
    """e2e, unit, build for the agent's own test and build commands; the tool's name for reads and edits; bash else."""
    if e.get("toolName") != "bash":
        return e.get("toolName") or "other"
    cmd = (e.get("args") or {}).get("command", "")
    return next((k for k, rx in TOOL_KINDS if rx.search(cmd)), "bash")


@dataclass
class Call:
    """One model call: request sent, prefill ends (first streamed chunk), decode ends."""
    sent: float
    first: float
    end: float
    fresh: int
    cached: int
    out: int | None


CLIENT_STREAM, CLAUDE_STREAM = "client-stream", "claude-stream"


@dataclass
class Parsed:
    tools: list = field(default_factory=list)        # (start, end, kind)
    compactions: list = field(default_factory=list)  # (start, end)
    between: list = field(default_factory=list)      # (session ended, next session started)
    calls: list = field(default_factory=list)        # Call, from the client's stream
    problems: list = field(default_factory=list)
    abandoned: int = 0
    source: str = CLIENT_STREAM                     # whose stream the calls came from


def parse(events: Path, t_to: float) -> Parsed:
    """Tool calls, compactions and streamed model calls from a pi or Claude Code event log, pairing starts with ends."""
    out = Parsed()
    starts: dict = {}              # tool call id -> (start, kind)
    comp_open = None
    call = None                    # [sent, first] of the model call in flight
    steps: list[float] = []        # when the agent started each model call or its session ended: a tool that never ended stopped by then
    settled = None                 # when the last session ended, until the next one starts
    claude: dict = {}              # Claude Code: message id -> its Call
    cs = {"step": None, "thinking_from": None, "ended": None, "background": False}   # Claude Code: see _claude_event
    try:
        f = Path(events).open(errors="replace")
    except OSError:
        return out
    with f:
        for line in f:
            if '"type":"message_update"' in line[:80] or '"type": "message_update"' in line[:80]:
                if call is not None and call[1] is None and (m := RX.match(line)):
                    call[1] = float(m.group(1))
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue           # cut off when the agent was killed mid-write
            if not isinstance(e, dict) or "_rx" not in e:
                continue
            t, rx = e.get("type"), e["_rx"]
            role = (e.get("message") or {}).get("role") if isinstance(e.get("message"), dict) else None
            if t == "tool_execution_start":
                starts[e.get("toolCallId")] = (rx, tool_kind(e))
            elif t == "tool_execution_end":
                if (s := starts.pop(e.get("toolCallId"), None)) is None:
                    out.problems.append(f"a tool call ended without starting ({e.get('toolCallId')})")
                else:
                    out.tools.append((s[0], rx, s[1]))
            elif t in ("agent_end", "agent_settled"):
                settled = rx
                steps.append(rx)
            elif t == "session" and settled is not None:
                out.between.append((settled, max(settled, rx)))
                settled = None
            elif t == "compaction_start":
                comp_open = rx
            elif t == "compaction_end" and comp_open is not None:
                out.compactions.append((comp_open, rx))
                comp_open = None
            elif t == "message_start" and role == "assistant":
                if call is not None:
                    out.abandoned += 1         # the previous call never ended: the session was cut off
                call = [rx, None]
                steps.append(rx)
            elif t in ("assistant", "user", "result") or (t == "system" and e.get("subtype") in CLAUDE_SYSTEM):
                _claude_event(e, rx, out, claude, starts, steps, cs)
            elif t == "message_end" and role == "assistant" and call is not None:
                u = e["message"].get("usage")
                u = u if isinstance(u, dict) else {}
                first = call[1] if call[1] is not None else rx   # nothing streamed: all of it was waiting
                out.calls.append(Call(call[0], first, rx, int(u.get("input") or 0), int(u.get("cacheRead") or 0), int(u.get("output") or 0)))
                call = None
    if call is not None:
        out.abandoned += 1
    for tid, (start, kind) in starts.items():
        stop = min((s for s in steps if s > start), default=t_to)
        out.tools.append((start, max(start, stop), kind))
        out.problems.append(f"tool call {tid} never ended; counted to the agent's next step")
    if comp_open is not None:
        out.compactions.append((comp_open, max(comp_open, t_to)))
        out.problems.append("a compaction never ended; counted to the window's end")
    return out


CLAUDE_SYSTEM = ("init", "thinking_tokens", "task_notification")
BACKGROUND = "background"       # the tool kind of an agent waiting, its turn ended, for a command it left running


def _claude_event(e: dict, rx: float, out: Parsed, claude: dict, starts: dict, steps: list, cs: dict) -> None:
    """One event of Claude Code's stream into out. cs carries the agent's last step (a block, a tool's result, a
    session start: a call is sent from there), when the model started thinking before a message's first block, when
    the last session ended, and whether a command it left running in the background finished since. A subagent's
    events (parent_tool_use_id set) are left out: they run inside the agent's own Task tool call.

    Between a session's end (result) and the next start (init): if a background command finished in between,
    Claude Code itself started the turn to report it, and the wait was the agent's (tool time, kind background;
    Opus v2-r3 story 12); otherwise the harness started a new session, and the wait is between sessions."""
    t, sub = e.get("type"), e.get("subtype")
    if e.get("parent_tool_use_id"):
        if t == "assistant":
            cs["thinking_from"] = None
        return
    if t == "system" and sub == "thinking_tokens":
        if cs["thinking_from"] is None:
            cs["thinking_from"] = rx
        return
    if t == "system" and sub == "task_notification":
        cs["background"] = cs["ended"] is not None
        return
    if t == "system":                                      # init: a session starts
        if cs["ended"] is not None:
            gap = (cs["ended"], max(cs["ended"], rx))
            (out.tools.append((*gap, BACKGROUND)) if cs["background"] else out.between.append(gap))
        cs.update(step=rx, thinking_from=None, ended=None, background=False)
        return
    if t == "result":                                      # the session ended
        steps.append(rx)
        cs.update(step=rx, thinking_from=None, ended=rx, background=False)
        return
    m = e.get("message") if isinstance(e.get("message"), dict) else {}
    blocks = [b for b in (m.get("content") if isinstance(m.get("content"), list) else []) if isinstance(b, dict)]
    if t == "user":
        for b in blocks:
            if b.get("type") == "tool_result":
                if (s := starts.pop(b.get("tool_use_id"), None)) is None:
                    out.problems.append(f"a tool call ended without starting ({b.get('tool_use_id')})")
                else:
                    out.tools.append((s[0], rx, s[1]))
        cs["step"] = rx
        return
    out.source = CLAUDE_STREAM
    mid = m.get("id")
    c = claude.get(mid)
    if c is None:
        u = m.get("usage") if isinstance(m.get("usage"), dict) else {}
        first = min(cs["thinking_from"], rx) if cs["thinking_from"] is not None else rx
        c = claude[mid] = Call(cs["step"] if cs["step"] is not None else first, first, rx,
                               int(u.get("input_tokens") or 0) + int(u.get("cache_creation_input_tokens") or 0),
                               int(u.get("cache_read_input_tokens") or 0), None)
        out.calls.append(c)
        steps.append(first)
    c.end = rx
    for b in blocks:
        if b.get("type") == "tool_use":
            tool_input = b.get("input") if isinstance(b.get("input"), dict) else {}
            starts[b.get("id")] = (rx, claude_tool_kind(b.get("name") or "", tool_input))
    cs.update(step=rx, thinking_from=None)


def _partition(t_from: float, t_to: float, intervals: list) -> tuple[dict, dict]:
    """Seconds owned by each part, and tool seconds by kind: a sweep over the window, one owner per stretch."""
    rank = {c: i for i, c in enumerate(PRIORITY)}
    edges = []
    for i, (a, b, cat, kind) in enumerate(intervals):
        a, b = max(a, t_from), min(b, t_to)
        if b > a:
            edges.append((a, 1, i))
            edges.append((b, -1, i))
    edges.sort(key=lambda x: (x[0], x[1]))
    owned = {c: 0.0 for c in (*PRIORITY, "other")}
    kinds: dict[str, float] = {}
    active: set[int] = set()
    at = t_from
    for t, delta, i in edges + [(t_to, 0, -1)]:
        if t > at:
            if not active:
                owned["other"] += t - at
            else:
                best = min(active, key=lambda j: (rank[intervals[j][2]], intervals[j][0], j))
                cat = intervals[best][2]
                owned[cat] += t - at
                if cat == "tool":
                    kinds[intervals[best][3]] = kinds.get(intervals[best][3], 0.0) + t - at
            at = t
        if delta == 1:
            active.add(i)
        elif delta == -1:
            active.discard(i)
    return owned, kinds


def _in_compaction(t: float, comps: list) -> bool:
    return any(a <= t <= b for a, b in comps)


def time_split(events: Path, server_log: Path, t_from: float, t_to: float) -> dict:
    """Where the story's time [t_from, t_to] went, as recorded in metrics.json's time_split."""
    p = parse(events, t_to)
    problems = list(p.problems)
    if t_to < t_from:
        problems.append("the window ends before it starts")
        t_to = t_from
    comps = p.compactions
    reqs = llama_log.parse(server_log.read_text(errors="replace")) if server_log and Path(server_log).exists() else []
    in_window = [r for r in reqs if t_from <= r["end"] <= t_to]
    if in_window:
        source = "llama-log"
        spans = [(r["end"] - (r["gen_ms"] + r["prompt_ms"]) / MS_PER_S, r["end"] - r["gen_ms"] / MS_PER_S, r["end"]) for r in reqs]
        counted = [r for r in in_window if r["end"] - (r["gen_ms"] + r["prompt_ms"]) / MS_PER_S >= t_from and not _in_compaction(r["end"], comps)]
        pre_n, dec_n = sum(r["prompt_n"] for r in counted), sum(r["gen_n"] for r in counted)
        pre_raw, dec_raw = sum(r["prompt_ms"] for r in counted) / MS_PER_S, sum(r["gen_ms"] for r in counted) / MS_PER_S
        extra = {k: v for k, v in llama_log.summarise(counted, t_from, t_to).items() if k in ("draft_acceptance", "mean_accepted_len")} if counted else {}
        cached = 0
    elif p.calls:
        source = p.source
        spans = [(c.sent, c.first, c.end) for c in p.calls]
        counted = [c for c in p.calls if c.sent >= t_from and c.end <= t_to and not _in_compaction(c.end, comps)]
        pre_n, cached = sum(c.fresh for c in counted), sum(c.cached for c in counted)
        dec_n = None if source == CLAUDE_STREAM else sum(c.out for c in counted)
        # A cloud API's time to first output is queueing and network as much as reading: no rate is made of it.
        pre_raw = sum(c.first - c.sent for c in counted) if source != CLAUDE_STREAM else 0
        dec_raw = sum(c.end - c.first for c in counted) if dec_n is not None else 0
        extra = {}
    else:
        source, spans, counted = None, [], []
    intervals = ([(a, b, "compaction", None) for a, b in comps] + [(a, b, "tool", k) for a, b, k in p.tools]
                 + [(s, f, "prefill", None) for s, f, _ in spans] + [(f, e, "decode", None) for _, f, e in spans]
                 + [(a, b, "between_sessions", None) for a, b in p.between])
    owned, kinds = _partition(t_from, t_to, intervals)
    r = lambda x: round(x, DECIMALS)
    model = None
    if source:
        model = {"source": source, "requests": len(counted),
                 "prefill_s": r(owned["prefill"]), "prefill_tokens": pre_n,
                 "prefill_tok_s": r(pre_n / pre_raw) if pre_raw else None,
                 "decode_s": r(owned["decode"]), "decode_tokens": dec_n,
                 "decode_tok_s": r(dec_n / dec_raw) if dec_raw else None,
                 "cached_tokens": cached, **extra}
    split = {
        "wall_s": r(t_to - t_from), "model": model, "tools_s": r(owned["tool"]),
        "tools_by_kind": {k: r(v) for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]) if r(v) > 0},
        "compaction_s": r(owned["compaction"]),
        "compactions": sum(1 for a, b in comps if min(b, t_to) > max(a, t_from)),
        "between_sessions_s": r(owned["between_sessions"]),
        "other_s": r(owned["other"]),
    }
    problems += check(split)
    split["accounting"] = {"version": VERSION, "ok": not problems, "problems": problems, "abandoned_calls": p.abandoned}
    return split


def check(split: dict, agent_seconds: float | None = None) -> list[str]:
    """The invariants of a split, re-derived from its numbers (so a stored record can be checked too)."""
    m = split.get("model") or {}
    parts = {"prefill": m.get("prefill_s", 0.0), "decode": m.get("decode_s", 0.0), "tools": split["tools_s"],
             "compaction": split["compaction_s"], "between_sessions": split.get("between_sessions_s", 0.0), "other": split["other_s"]}
    out = [f"negative {k}: {v} s" for k, v in parts.items() if v < 0]
    wall = split["wall_s"]
    if abs(sum(parts.values()) - wall) > TOLERANCE_S:
        out.append(f"parts sum to {sum(parts.values()):.1f} s, not the wall's {wall:.1f} s")
    kinds = split.get("tools_by_kind") or {}
    if abs(sum(kinds.values()) - split["tools_s"]) > 0.05 * (len(kinds) + 1):
        out.append(f"tools by kind sum to {sum(kinds.values()):.1f} s, not tools' {split['tools_s']:.1f} s")
    if agent_seconds is not None:   # the agent's clock runs only while a session does
        expected = agent_seconds + parts["between_sessions"]
        if abs(expected - wall) > max(1.0, AGENT_CLOCK_TOLERANCE * wall):
            out.append(f"wall {wall:.1f} s differs from the agent's own clock ({agent_seconds:.1f} s"
                       + (f" + {parts['between_sessions']:.1f} s between sessions" if parts["between_sessions"] else "") + ")")
    return out
