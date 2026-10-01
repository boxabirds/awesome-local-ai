"""attempts.py — a story's agent totals across every harness attempt, not only the last one.

A harness restart mid-story (a crash, an operator's resubmit, a machine reboot) continues the agent's own session,
and the story's log (stories/NN/agent-events.jsonl) keeps everything every attempt wrote. Until 30 Sep 2026 the
record kept only the last attempt's agent seconds, calls and tokens: canvas-gufo-r3 story 5 was recorded at 18
minutes and 27 tool calls while its log holds two harness attempts, 90 minutes and 284 tool calls.

What counts as an attempt: one harness process working on the story. Nudges, fork-resumes after an error and
tool-call-as-text continuations happen inside one attempt (run_story_agent sums them already). An earlier attempt is
everything in the log stamped before the current attempt started: the log is deleted when a story starts fresh, so
anything older came from an attempt the harness no longer remembers. Earlier attempts are told apart by the mark
the harness writes into the log at each restart (restart_mark), else by run.sh's start times (run-history.jsonl).

- earlier_attempts: each earlier attempt's counts, from the log (the client's own event reader, clients.scan).
- combine: the story's agent record, totals over all attempts, each attempt kept, marked "restarted".
- sum_splits: one time split (accounting.py) from each attempt's own window; the gap while the harness was down
  belongs to no attempt, so it is not agent time and is not counted. A tool call or compaction a restart cut off
  is listed with the attempt it started in (interrupted_tools, each with its "attempt").
- recompute: the same for a record written before this, from its log; backfill_timing.py calls it.
Tests: test_attempts.py.
"""
from __future__ import annotations

import contextlib
import gzip
import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

import accounting

# Events stamped this long before the current attempt's start belong to an earlier one (clock and write jitter).
RESTART_SLACK_S = 1.0
RESTART_MARK = accounting.RESTART_MARK    # an event type no client emits; every reader of the log skips it
DECIMALS = 1
STREAM_DELTAS = ("message_update", "tool_execution_update")
DELTA_PREFIX = 80                         # a delta's type is in its first bytes: skip it without parsing
# Summed over attempts; everything else about how the story ended is the last attempt's.
SUMMED = ("seconds", "steps", "tool_calls", "compactions", "tool_interruptions", "resumes", "nudges",
          "toolcall_text_resumes")
# Per-attempt detail kept from the harness's own record of the current attempt.
ATTEMPT_FIELDS = ("seconds", "steps", "tool_calls", "compactions", "tool_interruptions", "tokens", "sessions",
                  "resumes", "nudges", "toolcall_text_resumes", "errors")
SPLIT_SUMMED = ("wall_s", "tools_s", "compaction_s", "compactions", "between_sessions_s", "other_s", "suspended_s")
MODEL_SUMMED = ("requests", "prefill_s", "prefill_tokens", "decode_s", "decode_tokens", "cached_tokens")
RATES = (("prefill_tok_s", "prefill_tokens"), ("decode_tok_s", "decode_tokens"))
TIME_SPLIT_LAST_ONLY = "last attempt"
NO_SERVER_LOG = "no-server.log"           # a path that doesn't exist: model time then comes from the client's stream


def restart_mark(t: float, attempt: int, provenance: dict) -> dict:
    """The event the harness writes into a story's log when it restarts the story: where the next attempt begins."""
    return {"_rx": round(t, 3), "type": RESTART_MARK, "attempt": attempt, **provenance}


def write_restart_mark(events: Path, t: float, attempt: int, provenance: dict) -> None:
    with events.open("a") as f:
        f.write(json.dumps(restart_mark(t, attempt, provenance), separators=(",", ":")) + "\n")


@contextlib.contextmanager
def plain_log(path: Path):
    """The log as a plain file: accounting.py and conversation.py read plain text, and the published log is gzipped.
    A .gz is copied out to a temporary file, removed afterwards."""
    if not str(path).endswith(".gz"):
        yield Path(path)
        return
    with tempfile.NamedTemporaryFile("w", suffix=".jsonl", delete=False) as out, \
            gzip.open(path, "rt", errors="replace") as src:
        shutil.copyfileobj(src, out)
    try:
        yield Path(out.name)
    finally:
        Path(out.name).unlink(missing_ok=True)


def _open(path: Path):
    return gzip.open(path, "rt", errors="replace") if str(path).endswith(".gz") else Path(path).open(errors="replace")


def events(path: Path, deltas: bool = False):
    """The log's events, streamed (a story's full log runs to hundreds of MB); stream deltas skipped unless asked."""
    try:
        f = _open(path)
    except OSError:
        return
    with f:
        for line in f:
            if not deltas and any(f'"{d}"' in line[:DELTA_PREFIX] for d in STREAM_DELTAS):
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue          # cut off when the agent was killed mid-write
            if isinstance(e, dict):
                yield e


def has_stream_timing(path: Path) -> bool:
    """Whether the log keeps when each model call's first chunk arrived (the full log, or the lossless compact one):
    without it, accounting.py can't tell prefill from decode, and a compact log from before 30 Sep also cut strings."""
    try:
        f = _open(path)
    except OSError:
        return False
    with f:
        return any('"message_update"' in line[:DELTA_PREFIX] for line in f)


def _attempt(n: int) -> dict:
    from clients import empty_state
    return {"attempt": n, "source": "log", "started": None, "ended": None, "state": empty_state(), "sessions": []}


def earlier_attempts(client, path: Path, before: float, starts: list[float] | tuple = ()) -> list[dict]:
    """The attempts before the current one (events stamped before `before`), oldest first, each with its counts.
    starts: when the harness (re)started (run-history.jsonl), used only where the log has no restart marks."""
    from clients import empty_state
    if not Path(path).exists():
        return []
    out: list[dict] = []
    cur = _attempt(1)
    marked = False
    bounds = sorted(starts)
    for e in events(path):
        rx = e.get("_rx")
        if not isinstance(rx, (int, float)) or rx >= before:
            continue
        if e.get("type") == RESTART_MARK:
            marked = True
            out.append(cur)
            cur = _attempt(int(e.get("attempt") or len(out) + 1))
            continue
        if not marked and bounds and cur["started"] is not None and any(cur["started"] < b <= rx for b in bounds):
            out.append(cur)
            cur = _attempt(len(out) + 1)
        cur["started"] = rx if cur["started"] is None else cur["started"]
        cur["ended"] = rx
        client.scan(e, cur["state"])
        probe = empty_state()
        if e.get("type") in ("session", "system", "step_start") or "sessionID" in e:
            client.scan(e, probe)
            if probe["session"] and probe["session"] not in cur["sessions"]:
                cur["sessions"].append(probe["session"])
    out.append(cur)
    found = [a for a in out if a["started"] is not None]
    return [{"attempt": i + 1, "source": "log", "started": a["started"], "ended": a["ended"],
             "seconds": round(a["ended"] - a["started"], DECIMALS),
             "steps": a["state"]["steps"], "tool_calls": a["state"]["tool_calls"],
             "compactions": a["state"]["compactions"], "tokens": dict(a["state"]["tokens"]), "sessions": a["sessions"]}
            for i, a in enumerate(found)]


def next_attempt(earlier: list[dict]) -> int:
    return len(earlier) + 1


def current_attempt(agent: dict, n: int, started: float, ended: float) -> dict:
    """The harness's own record of the attempt it just ran, as one entry of agent["attempts"]."""
    return {"attempt": n, "source": "harness", "started": started, "ended": ended,
            **{k: agent[k] for k in ATTEMPT_FIELDS if k in agent}}


def combine(earlier: list[dict], current: dict, started: float, ended: float) -> dict:
    """The story's agent record over every attempt. With no earlier attempt, the current record unchanged."""
    if not earlier:
        return current
    each = [*earlier, current_attempt(current, next_attempt(earlier), started, ended)]
    out = dict(current)
    for k in SUMMED:
        if k in current:
            out[k] = sum(a.get(k) or 0 for a in each)
    out["seconds"] = round(out["seconds"], DECIMALS)
    keys = list(current.get("tokens") or {}) + [k for a in earlier for k in a["tokens"] if k not in (current.get("tokens") or {})]
    out["tokens"] = {k: sum((a.get("tokens") or {}).get(k, 0) for a in each) for k in dict.fromkeys(keys)}
    out["sessions"] = [s for a in each for s in a.get("sessions") or []]
    out["errors"] = [e for a in each for e in a.get("errors") or []]
    out.update(restarted=True, harness_attempts=len(each), attempts=each)
    return out


ATTEMPT_ENTRY_ONLY = ("attempt", "source", "started", "ended", "time_split")   # what an entry adds to the agent's own record


def recount(rec: dict, path: Path, client_name: str, starts: list[float] | tuple = ()) -> dict | None:
    """For a restarted story whose record already has its attempts: rec["agent"] with the attempts the log recorded
    counted again from the log, and the attempt the harness ran kept as it is; None when nothing changes (or the
    story ran once, or its log is gone). A client that counted a log's steps only on its first pass recorded 0
    steps for the earlier attempts of Sonnet 5.5 v2-r1 story 9 (1 Oct 2026); recompute() leaves such records alone."""
    from clients import CLIENTS
    agent = rec.get("agent") or {}
    each = agent.get("attempts") or []
    if len(each) < 2 or each[-1].get("source") != "harness" or not Path(path).exists():
        return None
    last = each[-1]
    earlier = earlier_attempts(CLIENTS[client_name](Path(path).parent), path, before=last["started"] - RESTART_SLACK_S,
                               starts=starts)
    if not earlier:
        return None
    own = {**{k: v for k, v in agent.items() if k not in ("attempts", "restarted", "harness_attempts")},
           **{k: v for k, v in last.items() if k not in ATTEMPT_ENTRY_ONLY}}
    new = combine(earlier, own, last["started"], last["ended"])
    for a, old in zip(new["attempts"], each):
        if "time_split" in old:
            a["time_split"] = old["time_split"]
    return None if new == agent else new


def sum_splits(splits: list[dict]) -> dict:
    """One time split from each attempt's own: parts summed, so it is still a partition of the time the attempts
    ran; rates are tokens over the summed raw seconds (tokens / rate, per attempt), never a mean of rates."""
    if len(splits) == 1:
        return splits[0]
    r = lambda x: round(x, DECIMALS)
    out: dict = {k: r(sum(s.get(k) or 0 for s in splits)) if k != "compactions" else sum(s.get(k) or 0 for s in splits)
                 for k in SPLIT_SUMMED}
    kinds: dict[str, float] = {}
    for s in splits:
        for k, v in (s.get("tools_by_kind") or {}).items():
            kinds[k] = kinds.get(k, 0.0) + v
    out["tools_by_kind"] = {k: r(v) for k, v in sorted(kinds.items(), key=lambda kv: -kv[1])}
    models = [s["model"] for s in splits if s.get("model")]
    model = None
    if models:
        model = {"source": "+".join(sorted({m["source"] for m in models}))}
        # A count no attempt knows (Claude Code's stream gives no output tokens: decode_tokens None) stays unknown.
        model.update({k: (r if k.endswith("_s") else int)(sum(m.get(k) or 0 for m in models))
                      if any(m.get(k) is not None for m in models) else None for k in MODEL_SUMMED})
        for rate, tokens in RATES:
            raw = sum(m[tokens] / m[rate] for m in models if m.get(rate))
            model[rate] = r(model[tokens] / raw) if raw else None
    out["model"] = model
    problems = [f"attempt {i + 1}: {p}" for i, s in enumerate(splits) for p in (s.get("accounting") or {}).get("problems", [])]
    problems += accounting.check(out)
    accs = [s.get("accounting") or {} for s in splits]
    out["accounting"] = {"version": min(a.get("version", 0) for a in accs), "ok": not problems,
                         "problems": problems,
                         "abandoned_calls": sum(a.get("abandoned_calls", 0) for a in accs),
                         "interrupted_tools": [{"attempt": i + 1, **t} for i, a in enumerate(accs) for t in a.get("interrupted_tools", [])],
                         "interrupted_compactions": sum(a.get("interrupted_compactions", 0) for a in accs)}
    out["attempts"] = len(splits)
    return out


def split_of(path: Path, server_log: Path, attempt: dict) -> dict:
    return accounting.time_split(path, server_log, attempt["started"], attempt["ended"])


def _epoch(stamp: str) -> float | None:
    try:
        return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return None


def run_starts(run: Path) -> list[float]:
    """When run.sh started the run, each time: run-history.jsonl (every earlier run.json) and run.json."""
    out = []
    lines = (run / "run-history.jsonl").read_text().splitlines() if (run / "run-history.jsonl").exists() else []
    if (run / "run.json").exists():
        lines.append((run / "run.json").read_text())
    for line in lines:
        try:
            t = _epoch(json.loads(line).get("started_at", ""))
        except (ValueError, AttributeError):
            t = None
        if t:
            out.append(t)
    return sorted(out)


def recompute(rec: dict, path: Path, client_name: str, starts: list[float] | tuple = (),
              server_log: Path | None = None) -> dict | None:
    """For a record written before restarts were counted: the fields of rec to replace, or None when the story ran
    in one attempt or was recomputed already. Counts always; the time split and conversation profile only from a
    log that keeps stream timing and whole strings (has_stream_timing), else the old split stays and says so."""
    from clients import CLIENTS
    agent = rec.get("agent") or {}
    if agent.get("attempts") or "started" not in rec or "agent_finished" not in rec or not Path(path).exists():
        return None
    client = CLIENTS[client_name](Path(path).parent)
    earlier = earlier_attempts(client, path, before=rec["started"] - RESTART_SLACK_S, starts=starts)
    if not earlier:
        return None
    out = {"agent": combine(earlier, agent, rec["started"], rec["agent_finished"]), "first_started": earlier[0]["started"]}
    if has_stream_timing(path):
        import conversation
        server_log = server_log or Path(path).parent / NO_SERVER_LOG
        with plain_log(path) as plain:
            splits = [split_of(plain, server_log, a) for a in earlier]
            last = rec.get("time_split") or accounting.time_split(plain, server_log, rec["started"], rec["agent_finished"])
            for a, s in zip(out["agent"]["attempts"], [*splits, last]):
                a["time_split"] = s
            out["time_split"] = sum_splits([*splits, last])
            if (p := conversation.profile(plain, earlier[0]["started"], rec["agent_finished"])) is not None:
                out["conversation"] = p
    else:
        out["time_split_covers"] = TIME_SPLIT_LAST_ONLY
    return out
