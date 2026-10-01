"""test_replay_real_logs.py — every recorded story log in the repo, through every reader of agent logs.

The readers were tested on logs written for the tests. On 1 Oct 2026 a real Claude Code event
({"type": "system", "subtype": "permission_denied", "message": "<a string>"}) crashed drive.final_reply_text at the
end of every story and ended three runs. The repo holds the logs of every recorded story; this replays each one
through each reader and checks that (1) none raises and (2) what must hold of its result does.

Logs are found by glob from the repo root (LOG_GLOBS), so a new run is replayed as soon as its record is committed.
The whole replay takes over two minutes, so a plain test run replays a sample (sample: every shape of event that
any log holds, and a log of every run, so every client and every combination), and REPLAY_ALL=1 replays every log:
the release gate.

    REPLAY_ALL=1 uv run --with pytest pytest -q test_replay_real_logs.py
    uv run --with pytest python test_replay_real_logs.py [--all]     # the same, printed: each log's problems, the totals

Readers replayed, each fed the log the way the harness feeds it (READERS): accounting (parse, time_split, check),
conversation.profile, drive (final_reply_text, tool_call_as_text, compact_events, last_session, _stamped_events,
_last_event_type, first_event_time, reconstruct_agent, story_time_split), clients (the run's own client's scan on
every event, and every other client's: none may raise on an event it doesn't know), attempts (events,
has_stream_timing, earlier_attempts, recompute, split_of), logscan (read_calls, scan), history (_event_times,
interruptions), annotate (timeline), claims (final_message), peek_audit (tool_calls, audit), progress (EventTally,
short_call), recount_tokens (tokens_from_log) and, for Claude Code's logs, preflight.claude_probe_verdict.
Not replayed: backfill_timing's steps, which rewrite a run's records and are made of the readers above.

What the recorded logs are, which decides what can be asked of each (Story):
- stamped: every event carries the harness's receive time (_rx). Logs from before the harness stamped them can't be
  placed in time: no time split and no conversation profile can be made of them, and nothing in them can be told
  apart from an earlier attempt of the story, so their counts are only at least the record's.
- cut: a log compacted before 30 Sep 2026 had its long strings cut (logscan.TRUNC_MARK) and every stream delta
  dropped. Counts of events survive that. Character counts, the split of a model call into prefill and decode, and
  a tool call's kind (read from its whole command) don't, so those are compared with the record only for a
  lossless log.
- redacted: every published log has home paths replaced by "~" (drive._redact), after the record's character
  counts were taken from the full log. So a lossless log's character counts are at most the record's, not equal.
- cut off: a tool call or compaction with no end event (the hang guard, a session's end, a harness restart, the
  story's cap) is an ordinary event. No log may make the current calculation report one as a problem, each is listed
  once, and a restarted story lists it with the attempt it started in.
- no server log: llama-server's log isn't published, so a split recorded from it ("llama-log") can't be remade
  here. Compactions and tools outrank model time (accounting.PRIORITY), so their seconds are the same either way.

Records known to be wrong, each made by code since fixed: STALE_RECORDS. The replay checks that each is still
wrong in the way written there, so a corrected record has to leave the table, and nothing else may differ.
"""
from __future__ import annotations

import copy
import functools
import gzip
import json
import os
import shutil
import sys
import tempfile
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path

import pytest

import accounting
import annotate
import attempts
import claims
import conversation
import drive
import heldout
import history
import logscan
import peek_audit
import preflight
import progress
import recount_tokens
from backfill_timing import DEFAULT_CLIENT
from clients import CLIENTS, empty_state

REPO = Path(__file__).resolve().parents[3]       # benchmarks/spec-bench/harness -> repo
LOG_NAME = logscan.COMPACT_LOG
LOG_GLOBS = (f"combinations/**/benchmarks/**/{LOG_NAME}", f"benchmarks/reference/**/{LOG_NAME}")
REPLAY_ALL_ENV = "REPLAY_ALL"
STORIES_DIR = "stories"                          # <run>/stories/NN/<log>: a log anywhere else has no record
RUN_FILES = ("metrics.json", "run.json")         # what makes a directory a run's
NO_WORK = Path("/nonexistent")                   # a client's work directory: scan never writes there
NO_WORK_ROOT = Path("/nonexistent/work")         # logscan.known_runs: the repo's runs only, whatever this machine holds
PROBE_SECRET = "story-01.spec.ts"                # what preflight's probe looks for in tool results
CLIENTS_WITH_LOGS = {"pi", "claude"}             # must be found; OpenCode has no recorded run yet (1 Oct 2026)
LOGSCAN_FORMAT = {"pi": "pi", "claude": "claude-code"}
PI_STEP, PI_TOOL_START, CLAUDE_STEP = "message_end", "tool_execution_start", "assistant"
UNPARSABLE = ("a line that isn't JSON",)          # among a log's shapes of event (shapes_of)

# How a cut string ends, as a log holds it: the old compaction wrote its events again, the "…" escaped.
CUT_MARKS = (logscan.TRUNC_MARK, json.dumps(logscan.TRUNC_MARK)[1:-1])

STATE_KEYS = set(empty_state())
COUNTS = ("steps", "tool_calls", "compactions")
SPLIT_KEYS = {"wall_s", "model", "tools_s", "tools_by_kind", "compaction_s", "compactions", "between_sessions_s",
              "other_s", "suspended_s", "accounting"}
MODEL_KEYS = {"source", "requests", "prefill_s", "prefill_tokens", "prefill_tok_s", "decode_s", "decode_tokens",
              "decode_tok_s", "cached_tokens"}
ACCOUNTING_KEYS = {"version", "ok", "problems", "abandoned_calls", "interrupted_tools", "interrupted_compactions"}
INTERRUPTED_KEYS = {"kind", "seconds", "ended_by"}          # one of accounting.interrupted_tools; with "attempt" when summed
ENDED_BY = {accounting.ENDED_BY_STEP, accounting.ENDED_BY_SESSION_END, accounting.ENDED_BY_RESTART,
            accounting.ENDED_BY_NEW_SESSION, accounting.ENDED_BY_WINDOW}
SAME_UNLESS_CUT_OFF = 3                          # the accounting version whose records still compare (replay_accounting)
NO_END_PROBLEM = "never ended"                   # what a cut-off tool call or compaction was reported as, before version 4
# Owned by compactions and tools, which outrank model time: the same whichever log the model's time came from.
SPLIT_ANY_SOURCE = ("wall_s", "compaction_s", "compactions", "tools_s")
# A model call's token counts, read from its message_end: the same with or without the stream's deltas.
MODEL_ANY_LOG = ("requests", "prefill_tokens", "decode_tokens", "cached_tokens")
LLAMA_LOG = "llama-log"                          # a split's model source when llama-server's log gave it
PROFILE_KEYS = {"version", "calls", "tool_calls", "thinking_visible", "thinking_chars", "thinking_median",
                "thinking_median_before", "thinking_median_after", "largest_thinking", "text_chars", "tool_arg_chars",
                "thinking_estimated_tokens", "largest_thinking_estimated", "context_start", "context_end",
                "largest_context_jump", "tools_by_name", "tool_errors", "longest_tool", "signals", "subagent_calls",
                "thinking_tokens"}
# Profile fields that count events or tokens: a lossless log gives exactly what the full log gave.
PROFILE_EXACT = ("version", "calls", "tool_calls", "thinking_visible", "thinking_estimated_tokens",
                 "largest_thinking_estimated", "context_start", "context_end", "largest_context_jump", "tools_by_name",
                 "tool_errors", "signals", "subagent_calls", "thinking_tokens")
# Profile fields that count characters: redaction can only have shortened what the published log holds.
PROFILE_CHARS = ("thinking_chars", "text_chars", "tool_arg_chars")
EARLIER_KEYS = {"attempt", "source", "started", "ended", "seconds", "steps", "tool_calls", "compactions", "tokens",
                "sessions"}
VERDICT_KEYS = {"version", "ok", "log", "truncated", "reaches"}
REACH_KEYS = {"route", "target", "calls", "example"}
TIMELINE_KEYS = {"kind", "text", "min", "count", "last"}
TIMELINE_KINDS = {"tool", "error", "compaction", "nudge"}

SONNET_V2_R2 = "benchmarks/reference/vidi/sonnet-5.5/v2-r2"
# (run, story) -> why its record is wrong, and the fields that are: {field: what the record holds}. The replay
# checks each field still holds that and still isn't what the log gives; every other field must agree as usual.
MLX_V2_R2 = "combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r2"
STALE_RECORDS = {
    (MLX_V2_R2, "4"): {
        "why": "run.sh restarted the harness twice during its first attempt, before restarts were marked in the log; the "
               "first time the agent's session was killed mid-turn and the next began 91.2 s later. Accounting version 3 "
               "counted a wait as between sessions only after a session that ended, so those 91.2 s were other (and "
               "agent time); version 4 counts the wait after a session that died too. The record also fails its clock "
               "check (an earlier attempt's waits counted twice, fixed 1 Oct 2026). backfill_timing.py --recompute on "
               "the machine that holds the full log corrects both",
        "fields": {"time_split.between_sessions_s": 205.8, "time_split.other_s": 109.6}},
    (SONNET_V2_R2, "2"): {
        "why": "its earlier attempt was counted by a client that had already read the log (drive.last_session), so "
               "its model calls counted as none (clients.py, fixed 1 Oct 2026); and attempts.sum_splits summed output "
               "tokens no attempt knew to 0 (fixed the same day). The run was still going then: backfill_timing.py "
               "recounts it (its recount step) once the run has finished",
        "fields": {"steps": 2, "time_split.model.decode_tokens": 0}},
}


def all_logs(repo: Path = REPO) -> list[Path]:
    """Every recorded story log under the repo, in a fixed order."""
    return sorted({p for g in LOG_GLOBS for p in repo.glob(g)})


def run_of(log: Path) -> Path | None:
    """The run a log belongs to: the nearest directory above it that holds a run's files."""
    return next((d for d in log.parents if any((d / f).is_file() for f in RUN_FILES)), None)


@functools.lru_cache(maxsize=None)
def run_info(run: Path) -> tuple[dict, str, tuple[float, ...]]:
    """(the run's metrics, its client, when run.sh started it). Runs recorded before the client was named were pi."""
    metrics = heldout.load_metrics(run)
    meta = json.loads((run / "run.json").read_text()) if (run / "run.json").is_file() else {}
    return metrics, metrics.get("client") or meta.get("client") or DEFAULT_CLIENT, tuple(attempts.run_starts(run))


def combination_of(run: Path) -> str:
    """What was benchmarked: the combination's folder, or the reference model's."""
    rel = run.relative_to(REPO).as_posix()
    return rel.split("/benchmarks/")[0] if rel.startswith("combinations/") else str(Path(rel).parent)


def shape(e) -> tuple:
    """What kind of event this is to a reader: its type, and the types of the parts readers reach into."""
    if not isinstance(e, dict):
        return (type(e).__name__,)
    m = e.get("message")
    content = m.get("content") if isinstance(m, dict) else None
    blocks = tuple(sorted({str(b.get("type")) if isinstance(b, dict) else type(b).__name__ for b in content})) \
        if isinstance(content, list) else type(content).__name__
    return (e.get("type"), e.get("subtype"), type(m).__name__, m.get("role") if isinstance(m, dict) else None, blocks, "_rx" in e)


@functools.lru_cache(maxsize=None)
def shapes_of(log: Path) -> frozenset:
    """Every shape of event in a log (shape), and UNPARSABLE if a line of it isn't JSON."""
    with gzip.open(log, "rt", errors="replace") as f:
        return frozenset(UNPARSABLE if e is None else shape(e) for e in map(_loads, f))


def sample(logs: list[Path]) -> list[Path]:
    """The logs a plain test run replays: the fewest that between them hold every shape of event any log holds
    (chosen greedily, the smaller log on a tie), so a new kind of event is replayed the day its log is committed;
    and for each run none of those came from, its median-sized log, so every client and combination is replayed."""
    size = {log: (log.stat().st_size, log.as_posix()) for log in logs}
    need, chosen = set().union(*map(shapes_of, logs)), []
    while need:
        best = min(logs, key=lambda log: (-len(shapes_of(log) & need), size[log]))
        chosen.append(best)
        need -= shapes_of(best)
    by_run: dict[Path | None, list[Path]] = {}
    for log in sorted(logs, key=size.get):
        by_run.setdefault(run_of(log), []).append(log)
    reached = {run_of(log) for log in chosen}
    return sorted(chosen + [of_run[len(of_run) // 2] for run, of_run in by_run.items() if run not in reached])


def replay_all() -> bool:
    return os.environ.get(REPLAY_ALL_ENV, "") not in ("", "0")


def _number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


@dataclass
class Story:
    """One recorded log, read once: where it is, its run's record of the story, and its events."""
    log: Path
    plain: Path                                  # the log gunzipped, in a temporary directory
    run: Path | None = None
    client: str = DEFAULT_CLIENT
    starts: tuple[float, ...] = ()
    sid: str | None = None                       # the story's key in metrics.json ("7"), when the log is stories/NN's
    rec: dict = field(default_factory=dict)
    lines: list[str] = field(default_factory=list)
    events: list[dict] = field(default_factory=list)

    @classmethod
    def load(cls, log: Path, tmp: Path) -> "Story":
        plain = tmp / logscan.FULL_LOG
        with gzip.open(log, "rt", errors="replace") as src, plain.open("w") as dst:
            shutil.copyfileobj(src, dst)
        s = cls(log, plain, run_of(log))
        if s.run is not None:
            metrics, s.client, s.starts = run_info(s.run)
            if log.parent.parent.name == STORIES_DIR and log.parent.name.isdigit():
                s.sid = str(int(log.parent.name))
                s.rec = (metrics.get("stories") or {}).get(s.sid) or {}
        s.lines = plain.read_text(errors="replace").splitlines()
        s.events = [e for e in map(_loads, s.lines) if isinstance(e, dict)]
        return s

    @property
    def name(self) -> str:
        return self.log.relative_to(REPO).as_posix()

    @functools.cached_property
    def stale(self) -> dict:
        """The fields of this story's record known to be wrong (STALE_RECORDS), with what the record holds."""
        key = (self.run.relative_to(REPO).as_posix(), self.sid) if self.run is not None else None
        return STALE_RECORDS.get(key, {"fields": {}})["fields"]

    @functools.cached_property
    def stamps(self) -> list[float]:
        return [e["_rx"] for e in self.events if _number(e.get("_rx"))]

    @property
    def stamped(self) -> bool:
        return bool(self.events) and len(self.stamps) == len(self.events)

    @functools.cached_property
    def cut(self) -> bool:
        return any(mark in line for line in self.lines for mark in CUT_MARKS)

    @functools.cached_property
    def has_deltas(self) -> bool:
        return any(e.get("type") == drive.FIRST_CHUNK_EVENT for e in self.events)

    @property
    def lossless(self) -> bool:
        """Everything the agent wrote but the stream's deltas: pi's keeps each call's first delta, Claude Code's has none."""
        return not self.cut and (self.has_deltas or self.client != "pi")

    @property
    def started(self) -> float:
        """When the record's own attempt began; with no record, the log's first stamp."""
        return self.rec.get("started", self.stamps[0] if self.stamps else 0.0)

    @property
    def t_from(self) -> float:
        return self.rec.get("first_started", self.started)

    @property
    def t_to(self) -> float:
        return self.rec.get("agent_finished", self.stamps[-1] if self.stamps else 0.0)

    @property
    def restarted(self) -> bool:
        """The record counts every harness attempt of the story (attempts.combine), not only its last."""
        return bool((self.rec.get("agent") or {}).get("attempts"))

    def scan(self, client: str, events: list[dict] | None = None) -> tuple[dict, list]:
        """(state, what scan returned for each event) from a fresh client of this kind."""
        c, st = CLIENTS[client](NO_WORK), empty_state()
        return st, [c.scan(e, st) for e in (self.events if events is None else events)]

    @functools.cached_property
    def whole(self) -> dict:
        """The run's own client's state after every event of the log."""
        return self.scan(self.client)[0]

    @functools.cached_property
    def own_attempt(self) -> dict:
        """The same after only the events of the record's own attempt (stamped logs)."""
        before = self.started - attempts.RESTART_SLACK_S
        return self.scan(self.client, [e for e in self.events if _number(e.get("_rx")) and e["_rx"] >= before])[0]

    @functools.cached_property
    def model_calls(self) -> int:
        """Model calls in the log, counted here from its events: pi's assistant message_end, Claude's message ids."""
        if self.client == "claude":
            return len({e["message"].get("id") for e in self.events
                        if e.get("type") == CLAUDE_STEP and isinstance(e.get("message"), dict)})
        return sum(1 for e in self.events if e.get("type") == PI_STEP and isinstance(e.get("message"), dict)
                   and e["message"].get("role") == "assistant")

    @functools.cached_property
    def tools_without_end(self) -> int:
        """Tool calls the log starts and never ends, counted here: every start (a repeated id starts another call)
        less every end that has a start. A subagent's calls (Claude Code) aren't the agent's."""
        open_: dict = {}
        ended = 0
        starts = 0
        for e in self.events:
            if not _number(e.get("_rx")):
                continue
            if self.client == "claude":
                if e.get("parent_tool_use_id") or e.get("type") not in (CLAUDE_STEP, "user"):
                    continue
                for b in _blocks(e):
                    if e["type"] == CLAUDE_STEP and b.get("type") == "tool_use":
                        starts += 1
                        open_[b.get("id")] = True
                    elif e["type"] == "user" and b.get("type") == "tool_result" and open_.pop(b.get("tool_use_id"), None):
                        ended += 1
            elif e.get("type") == PI_TOOL_START:
                starts += 1
                open_[e.get("toolCallId")] = True
            elif e.get("type") == "tool_execution_end" and open_.pop(e.get("toolCallId"), None):
                ended += 1
        return starts - ended

    @functools.cached_property
    def tool_starts(self) -> int:
        """Tool calls in the log, counted here: pi's tool_execution_start, Claude's tool_use blocks."""
        if self.client == "claude":
            return sum(1 for e in self.events if e.get("type") == CLAUDE_STEP for b in _blocks(e) if b.get("type") == "tool_use")
        return sum(1 for e in self.events if e.get("type") == PI_TOOL_START)


def _loads(line: str):
    try:
        return json.loads(line)
    except ValueError:
        return None


def _blocks(e: dict) -> list[dict]:
    m = e.get("message")
    content = m.get("content") if isinstance(m, dict) else None
    return [b for b in content if isinstance(b, dict)] if isinstance(content, list) else []


class Problems(list):
    """What a replay found wrong, each line naming its reader."""
    reader = ""

    def __init__(self):
        super().__init__()
        self.checked: set[str] = set()       # the record's fields compared with the log (agree)

    def expect(self, ok, what: str) -> bool:
        if not ok:
            self.append(f"{self.reader}: {what}")
        return bool(ok)

    def same(self, got, want, what: str) -> bool:
        return self.expect(got == want, f"{what}: {got!r}, expected {want!r}")

    def agree(self, s: Story, name: str, recorded, replayed, tolerance: float = 0.0) -> None:
        """A field of the story's record against what its log gives; a field listed as stale must still be stale."""
        same = abs(recorded - replayed) <= tolerance if _number(recorded) and _number(replayed) else recorded == replayed
        self.checked.add(name)
        if name in s.stale:
            self.expect(recorded == s.stale[name] and not same, f"the record's {name} ({recorded!r}; the log gives {replayed!r}) "
                        "is no longer wrong the way STALE_RECORDS says: correct its entry or remove it")
        else:
            self.expect(same, f"the record's {name} is {recorded!r}, the log gives {replayed!r}")

    def serialisable(self, v, what: str):
        """v through JSON and back, which must give v again (records are JSON); None if it can't be written."""
        try:
            back = json.loads(json.dumps(v))
        except (TypeError, ValueError) as ex:
            self.expect(False, f"{what} isn't JSON-serialisable ({ex})")
            return None
        self.expect(back == v, f"{what} changes when written as JSON and read back")
        return back


# ---------------------------------------------------------------- accounting.py

def replay_accounting(s: Story, p: Problems) -> None:
    parsed = accounting.parse(s.plain, s.t_to)
    p.expect(isinstance(parsed, accounting.Parsed), "parse didn't return a Parsed")
    p.expect(all(a <= b and isinstance(k, str) and k for a, b, k in parsed.tools), "a tool call ends before it starts, or has no kind")
    p.expect(all(a <= b for a, b in [*parsed.compactions, *parsed.between]), "a compaction or a wait between sessions ends before it starts")
    p.expect(all(c.sent <= c.first <= c.end for c in parsed.calls), "a model call isn't sent <= first output <= end")
    p.expect(all(c.fresh >= 0 and c.cached >= 0 for c in parsed.calls), "a model call has negative tokens")
    claude = parsed.source == accounting.CLAUDE_STREAM
    p.expect(parsed.source in (accounting.CLIENT_STREAM, accounting.CLAUDE_STREAM) and claude == (s.client == "claude" and bool(parsed.calls)),
             f"model calls from {parsed.source!r} in a {s.client} log")
    p.expect(all((c.out is None) == claude for c in parsed.calls), "output tokens are None exactly for Claude Code's calls")
    p.expect(parsed.abandoned >= 0 and all(isinstance(x, str) for x in parsed.problems), "abandoned or problems of the wrong type")
    p.expect(not any(NO_END_PROBLEM in x for x in parsed.problems), "a tool call or compaction with no end is reported as a problem")
    p.expect(all(t[:3] in parsed.tools and t[3] in ENDED_BY for t in parsed.cut_tools), "a cut-off tool call isn't among the tools, or has no known end")
    p.same(len(parsed.cut_tools), s.tools_without_end, "tool calls with no end event")
    p.expect(all(c in parsed.compactions for c in parsed.cut_compactions), "a cut-off compaction isn't among the compactions")
    p.expect(all(accounting.SUSPENSION_MIN_S <= d <= b - a for a, b, d in parsed.suspended), "a suspension shorter than the least, or longer than its session")
    p.expect(not parsed.suspended or s.client == "claude", "a suspension in a log whose client has no clock of its own")
    if not s.stamps:
        p.expect(not (parsed.tools or parsed.calls or parsed.compactions or parsed.between), "something timed in a log with no stamps")
    split = accounting.time_split(s.plain, s.plain.with_name(attempts.NO_SERVER_LOG), s.started, s.t_to)
    _check_split(split, p, "time_split")
    p.same(split["wall_s"], round(s.t_to - s.started, accounting.DECIMALS), "wall_s")
    p.same(split["accounting"]["interrupted_tools"],
           [{"kind": k, "seconds": round(min(b, s.t_to) - a, accounting.DECIMALS), "ended_by": by}
            for a, b, k, by in sorted(parsed.cut_tools) if s.started <= a <= s.t_to], "the tool calls cut off in the window")
    # Nothing but what the log itself holds (a tool call that ended without starting) is ever a problem.
    p.same(split["accounting"]["problems"], parsed.problems, "the split's problems are not the parse's")
    p.same(split["accounting"]["abandoned_calls"], parsed.abandoned, "abandoned calls")
    recorded = s.rec.get("time_split")
    if recorded and "accounting" in recorded:
        own = recorded["accounting"]["problems"]
        p.expect(all(x in own for x in accounting.check(recorded)), f"the recorded split breaks an invariant it doesn't report: {accounting.check(recorded)}")
        p.same(recorded["accounting"]["ok"], not own, "the recorded split's ok")
    if recorded and s.stamped and s.restarted:
        # A restarted story's split is its attempts' summed (drive.story_time_split): replayed the same way. What a
        # restart cut off is listed once, by the attempt it started in, however many attempts the log holds.
        again = drive.story_time_split(copy.deepcopy(s.rec), s.plain, s.plain.with_name(attempts.NO_SERVER_LOG))
        _check_split(again, p, "the story's split over its attempts")
        cut = again["accounting"]["interrupted_tools"]
        p.expect(all(set(t) == INTERRUPTED_KEYS | {"attempt"} for t in cut), "a summed split's interrupted tool lacks its attempt")
        p.expect(len(cut) <= len(parsed.cut_tools), f"{len(cut)} tool calls listed as cut off, the log has {len(parsed.cut_tools)}")
    else:
        again = split
    version = (recorded or {}).get("accounting", {}).get("version")
    # Version 4 gives what version 3 gave unless something in the log was cut off (a tool call, a compaction): those
    # records wait for backfill_timing.py --recompute, and until then only say so by their version.
    same_calculation = version == accounting.VERSION or (version == SAME_UNLESS_CUT_OFF and not parsed.cut_tools and not parsed.cut_compactions)
    if recorded and s.stamped and same_calculation:
        _same_split(s, recorded, again, p)


def _check_split(split: dict, p: Problems, what: str) -> None:
    p.same(set(split) - {"attempts"}, SPLIT_KEYS, f"{what}'s keys")
    p.same(set(split["accounting"]), ACCOUNTING_KEYS, f"{what}'s accounting keys")
    p.same(accounting.check(split), [], f"{what} breaks its own invariants")
    p.expect(0 <= split["suspended_s"] <= split["wall_s"], f"{what}'s suspended_s is outside its wall")
    cut = split["accounting"]["interrupted_tools"]
    p.expect(all(set(t) - {"attempt"} == INTERRUPTED_KEYS and t["ended_by"] in ENDED_BY and 0 <= t["seconds"] <= split["wall_s"]
                 for t in cut), f"{what}'s interrupted tools")
    p.expect(sum(t["seconds"] for t in cut) <= split["tools_s"] + accounting.TOLERANCE_S * (len(cut) + 1), f"{what}'s interrupted tools ran longer than its tools")
    n = split["accounting"]["interrupted_compactions"]
    p.expect(isinstance(n, int) and not isinstance(n, bool) and n >= 0, f"{what}'s interrupted compactions")
    p.expect(split["model"] is None or set(split["model"]) >= MODEL_KEYS, f"{what}'s model lacks keys")
    p.serialisable(split, what)


def _same_split(s: Story, recorded: dict, again: dict, p: Problems) -> None:
    """The recorded split against the one this log gives, as far as this log can give it (see the module's notes)."""
    for k in SPLIT_ANY_SOURCE:
        p.agree(s, f"time_split.{k}", recorded[k], again[k], accounting.TOLERANCE_S)
    if s.lossless or "time_split.tools_by_kind" in s.stale:
        # A tool call's kind is read from its whole command (`… && npx playwright test` at the end of a long one),
        # so a cut log gives other kinds for the same tool time. A kind that rounds to 0.0 was left out of records
        # made before 1 Oct 2026.
        theirs, ours = ({k: v for k, v in split["tools_by_kind"].items() if v > 0} for split in (recorded, again))
        close = set(theirs) == set(ours) and all(abs(v - ours[k]) <= accounting.TOLERANCE_S for k, v in theirs.items())
        p.agree(s, "time_split.tools_by_kind", theirs, theirs if close else ours)
    theirs, ours = recorded.get("model") or {}, again.get("model") or {}
    p.checked.add("time_split.model.source")
    if theirs.get("source") != ours.get("source"):
        # Recorded from llama-server's log, which isn't published: this log can't remake the model's part.
        p.expect(theirs.get("source") == LLAMA_LOG or "time_split.model.source" in s.stale,
                 f"the record's model time is from {theirs.get('source')!r}, the log's from {ours.get('source')!r}")
        return
    p.expect("time_split.model.source" not in s.stale, "the record's time_split.model.source is no longer wrong: remove it from STALE_RECORDS")
    for k in MODEL_ANY_LOG:
        p.agree(s, f"time_split.model.{k}", theirs.get(k), ours.get(k))
    model_s = lambda m: m.get("prefill_s", 0.0) + m.get("decode_s", 0.0)
    p.agree(s, "time_split.model seconds", round(model_s(theirs), accounting.DECIMALS), round(model_s(ours), accounting.DECIMALS), accounting.TOLERANCE_S)
    if s.lossless:                      # each call's first delta is there: prefill and decode split as they were
        for k in ("prefill_s", "decode_s"):
            p.agree(s, f"time_split.model.{k}", theirs.get(k), ours.get(k), accounting.TOLERANCE_S)
        for k in ("between_sessions_s", "other_s"):
            p.agree(s, f"time_split.{k}", recorded.get(k, 0.0), again.get(k, 0.0), accounting.TOLERANCE_S)


# ---------------------------------------------------------------- conversation.py

def replay_conversation(s: Story, p: Problems) -> None:
    prof = conversation.profile(s.plain, s.t_from, s.t_to)
    if not s.stamps:
        p.expect(prof is None, "a profile from a log with no stamps")
        return
    if prof is None:
        p.expect(not s.stamped or s.own_attempt["steps"] == 0, "no profile though the story's window holds model calls")
        return
    p.same(set(prof), PROFILE_KEYS, "the profile's keys")
    p.serialisable(prof, "the profile")
    p.same(prof["version"], conversation.VERSION, "version")
    p.same(prof["thinking_visible"], s.client != "claude", "thinking_visible")
    p.expect(prof["calls"] >= 1 and prof["tool_calls"] >= 0 and prof["tool_errors"] >= 0, "counts out of range")
    p.same(sum(prof["tools_by_name"].values()), prof["tool_calls"], "tools_by_name sums to tool_calls")
    p.expect((prof["thinking_chars"] is None) == (s.client == "claude"), "thinking_chars is None exactly where thinking is withheld")
    if s.stamped and s.t_from <= s.stamps[0] and s.stamps[-1] <= s.t_to:    # the window holds the whole log
        p.same(prof["calls"] + prof["subagent_calls"], s.model_calls, "model calls, the agent's and its subagents'")
    recorded = s.rec.get("conversation")
    if recorded and s.stamped and s.lossless and recorded.get("version") == conversation.VERSION:
        # A record keeps the keys of the conversation.py that made it: thinking_visible and subagent_calls came
        # with Claude Code's logs (1 Oct 2026) without a new version, so older records lack them.
        p.expect(set(recorded) <= PROFILE_KEYS, f"the recorded profile has keys the profile no longer has: {set(recorded) - PROFILE_KEYS}")
        for k in (k for k in PROFILE_EXACT if k in recorded):
            p.agree(s, f"conversation.{k}", recorded[k], prof[k])
        for k in (k for k in PROFILE_CHARS if recorded.get(k) is not None):
            p.expect(prof[k] is not None and prof[k] <= recorded[k], f"the record's conversation.{k} is {recorded[k]}, the log gives more: {prof[k]}")


# ---------------------------------------------------------------- drive.py

def replay_drive(s: Story, p: Problems) -> None:
    reply = drive.final_reply_text(s.plain)
    p.expect(isinstance(reply, str), f"final_reply_text returned a {type(reply).__name__}")
    p.expect(isinstance(drive.tool_call_as_text(reply), bool), "tool_call_as_text didn't return a bool")
    if s.client == "pi" and reply.strip():
        p.same(claims.final_message(s.lines), reply.strip(), "claims.final_message against final_reply_text")
    p.same(drive._last_event_type(s.plain), s.events[-1].get("type") if s.events else None, "_last_event_type")
    stamped = list(drive._stamped_events(s.plain))
    p.same(len(stamped), sum(1 for e in s.events if "_rx" in e and e.get("type") not in drive.STREAM_DELTA_EVENTS), "_stamped_events")
    session = drive.last_session(CLIENTS[s.client](NO_WORK), s.plain)
    p.expect(session is None or isinstance(session, str), f"last_session returned a {type(session).__name__}")
    p.expect((session is None) == (s.whole["session"] is None), "last_session finds a session exactly when the scan does")
    first = drive.first_event_time(s.plain)
    p.expect(first is None or _number(first), "first_event_time")
    agent = drive.reconstruct_agent(CLIENTS[s.client](NO_WORK), s.plain)
    for k in COUNTS:
        p.same(agent[k], s.whole[k], f"reconstruct_agent {k}")
    p.same(agent["tokens"], s.whole["tokens"], "reconstruct_agent tokens")
    # The published log is already compact: compacting it again changes nothing (no event lost, none rewritten).
    copy_of = s.plain.with_name("again.jsonl")
    shutil.copyfile(s.plain, copy_of)
    with gzip.open(drive.compact_events(copy_of), "rt", errors="replace") as f:
        again = f.read().splitlines()
    kept = [l for l in s.lines if isinstance(_loads(l), dict)]
    p.expect(again == kept, f"compact_events changed an already compact log ({len(kept)} events in, {len(again)} out)")


# ---------------------------------------------------------------- clients.py

def replay_clients(s: Story, p: Problems) -> None:
    st, keys = s.scan(s.client)
    p.expect(all(k is None or (isinstance(k, str) and isinstance(json.loads(k), list)) for k in keys), "scan returned something other than None or a loop key")
    p.expect(STATE_KEYS <= set(st), f"the state lost keys: {STATE_KEYS - set(st)}")
    p.serialisable(st, "the state")
    p.expect(all(isinstance(st[k], int) and st[k] >= 0 for k in COUNTS), "a count isn't a non-negative int")
    p.expect(all(isinstance(v, int) and v >= 0 for v in st["tokens"].values()), "a token count isn't a non-negative int")
    p.expect(st["session"] is None or isinstance(st["session"], str), "session isn't a string")
    p.expect(st["error"] is None or isinstance(st["error"], str), "error isn't a string")
    p.same(st["steps"], s.model_calls, "steps against the log's model calls")
    p.same(st["tool_calls"], s.tool_starts, "tool_calls against the log's tool calls")
    p.same(sum(k is not None for k in keys), st["tool_calls"], "loop keys, one per tool call")
    # The harness reads a restarted story's log several times with its one client (drive.last_session, then
    # attempts.earlier_attempts, then progress.EventTally): a client that has read it before counts the same again.
    client, again = CLIENTS[s.client](NO_WORK), [empty_state(), empty_state()]
    for st_n in again:
        for e in s.events:
            client.scan(e, st_n)
    p.expect(again[0] == again[1] == st, "the same client counts the log differently the second time it reads it")
    for name in sorted(set(CLIENTS) - {s.client}):       # an event it doesn't know must not stop a client
        s.scan(name)
    _against_record(s, p)


def _against_record(s: Story, p: Problems) -> None:
    """The record's counts against the log's. A record made in one attempt counts that attempt's events; one that
    counts every attempt (restarted), or was made from the log alone (drive.reconstruct_agent), counts the whole
    log. An unstamped log can't be divided into attempts, so it only bounds the record."""
    agent = s.rec.get("agent")
    if not agent:
        return
    log = s.whole if s.restarted or agent.get("reconstructed_from_log") or not s.stamped else s.own_attempt
    flat = lambda a: {**{k: a.get(k) for k in COUNTS}, **{f"tokens.{k}": v for k, v in (a.get("tokens") or {}).items()}}
    recorded, counted = flat(agent), flat(log)
    for k, v in recorded.items():
        if s.stamped:
            p.agree(s, k, v, counted.get(k))
        else:
            p.expect(counted.get(k, 0) >= v, f"the log's {k} {counted.get(k)} is less than the record's {v}")
    if s.stamped:
        p.expect(s.stamps[-1] <= s.t_to + attempts.RESTART_SLACK_S, f"the log goes on {s.stamps[-1] - s.t_to:.1f} s after the record says the agent finished")


# ---------------------------------------------------------------- attempts.py

def replay_attempts(s: Story, p: Problems) -> None:
    p.same(sum(1 for _ in attempts.events(s.log)), sum(1 for e in s.events if e.get("type") not in attempts.STREAM_DELTAS), "events()")
    p.same(sum(1 for _ in attempts.events(s.log, deltas=True)), len(s.events), "events(deltas=True)")
    p.same(attempts.has_stream_timing(s.log), s.has_deltas, "has_stream_timing")
    before = s.started - attempts.RESTART_SLACK_S
    earlier = attempts.earlier_attempts(CLIENTS[s.client](NO_WORK), s.log, before=before, starts=s.starts)
    p.serialisable(earlier, "earlier attempts")
    p.expect(all(set(a) == EARLIER_KEYS for a in earlier), "an earlier attempt's keys")
    p.same([a["attempt"] for a in earlier], list(range(1, len(earlier) + 1)), "earlier attempts are numbered from 1")
    spans = [t for a in earlier for t in (a["started"], a["ended"])]
    p.expect(spans == sorted(spans) and all(t < before for t in spans), "earlier attempts aren't in order, each before the record's own")
    p.expect(all(a["seconds"] >= 0 for a in earlier), "an earlier attempt took negative time")
    if s.stamped and s.client == "pi":                   # the attempts divide the log's events: nothing counted twice or lost
        for k in COUNTS:
            p.same(sum(a[k] for a in earlier) + s.own_attempt[k], s.whole[k], f"{k} over earlier attempts and the record's own")
    for a in earlier:
        _check_split(attempts.split_of(s.plain, s.plain.with_name(attempts.NO_SERVER_LOG), a), p, f"attempt {a['attempt']}'s split")
    if "agent" not in s.rec:
        return
    new = attempts.recompute(copy.deepcopy(s.rec), s.log, s.client, starts=s.starts)
    if not p.same(new is not None, bool(earlier) and not s.restarted, "recompute gives something exactly for an uncounted restart"):
        return
    if new is None:
        return
    p.serialisable(new, "the recomputed record")
    agent = new["agent"]
    p.expect(agent["restarted"] is True and agent["harness_attempts"] == len(agent["attempts"]) == len(earlier) + 1, "the recomputed attempts")
    for k in COUNTS:
        p.same(agent[k], s.whole[k], f"recomputed {k} against the whole log")
    p.same(new["first_started"], earlier[0]["started"], "first_started")
    if s.has_deltas:
        _check_split(new["time_split"], p, "the recomputed split")
    else:
        p.same(new.get("time_split_covers"), attempts.TIME_SPLIT_LAST_ONLY, "a log without stream timing leaves the split as it was")


# ---------------------------------------------------------------- logscan.py

@functools.lru_cache(maxsize=None)
def _known_runs() -> frozenset[str]:
    return logscan.known_runs(REPO, NO_WORK_ROOT)


def replay_logscan(s: Story, p: Problems) -> None:
    fmt, calls, cwds = logscan.read_calls(s.log)
    if s.model_calls or s.tool_starts:
        p.same(fmt, LOGSCAN_FORMAT[s.client], "the log's format")
    p.expect(all(isinstance(c.tool, str) and isinstance(c.result, str) for c in calls), "a call's tool or result isn't a string")
    p.expect(all(isinstance(c, str) for c in cwds), "a cwd isn't a string")
    p.expect(len(calls) >= s.tool_starts if s.client == "pi" else len(calls) == s.tool_starts,
             f"read_calls found {len(calls)} calls, the log has {s.tool_starts}")
    own = logscan.own_workspace_for(s.run) if s.run else NO_WORK
    v = logscan.scan(s.log, own, logscan.Context(known_runs=_known_runs()))
    p.same(set(v), VERDICT_KEYS, "the verdict's keys")
    p.serialisable(v, "the verdict")
    p.same(v["log"], {"file": s.log.name, "format": fmt, "calls": len(calls)}, "the verdict's log")
    p.expect(v["ok"] is None if fmt == "unknown" else v["ok"] == (not v["reaches"]), "ok doesn't follow from the reaches")
    p.expect(all(set(r) == REACH_KEYS and r["route"] in logscan.ROUTES and r["calls"] >= 1 for r in v["reaches"]), "a reach's shape")
    p.expect(s.cut or not v["truncated"], "a verdict says truncated of a log with nothing cut")


# ---------------------------------------------------------------- history.py

def replay_history(s: Story, p: Problems) -> None:
    if s.sid is None:
        return
    times = history._event_times(s.run, s.sid)
    p.expect(all(isinstance(t, float) and t > 0 for t in times) and times == sorted(times), "_event_times aren't sorted positive floats")
    if s.stamped:
        p.same(len(times), sum(1 for e in s.events if e.get("type") != drive.FIRST_CHUNK_EVENT), "_event_times, one per stamped event")
    found, per_story = history.interruptions(s.run, {s.sid: s.rec})
    p.serialisable([found, per_story], "interruptions")
    p.expect(all(i["story"] == s.sid and i["gap_s"] >= 0 and isinstance(i["kind"], str) for i in found), "an interruption's shape")
    for t in per_story.values():
        p.expect(t["dead_s"] >= 0 and t["active_s"] >= 0, f"negative active or dead time: {t}")
        p.same(t["dead_s"], sum(i["gap_s"] for i in found), "dead time is the interruptions' gaps")


# ---------------------------------------------------------------- annotate.py, claims.py

def replay_annotate(s: Story, p: Problems) -> None:
    timeline = annotate.timeline(s.lines)
    p.serialisable(timeline, "the timeline")
    p.expect(all(set(t) == TIMELINE_KEYS and t["kind"] in TIMELINE_KINDS and t["count"] >= 1 for t in timeline), "a timeline entry's shape")
    p.same(sum(t["count"] for t in timeline if t["kind"] == "tool"), s.tool_starts, "the timeline's tool calls")
    p.same(sum(t["count"] for t in timeline if t["kind"] == "compaction"), s.whole["compactions"] if s.client == "claude" else
           sum(1 for e in s.events if e.get("type") == "compaction_start"), "the timeline's compactions")
    if s.stamped:
        p.expect(all(_number(t["min"]) and t["min"] >= 0 for t in timeline), "a timeline entry of a stamped log has no time")


def replay_claims(s: Story, p: Problems) -> None:
    claim = claims.final_message(s.lines)
    p.expect(claim is None or (isinstance(claim, str) and claim == claim.strip() and claim), "final_message isn't None or stripped, non-empty text")
    results = [e["result"].strip() for e in s.events if e.get("type") == "result" and isinstance(e.get("result"), str) and e["result"].strip()]
    if results:
        p.same(claim, results[-1], "final_message is Claude Code's last result")


# ---------------------------------------------------------------- peek_audit.py

def replay_peek_audit(s: Story, p: Problems) -> None:
    calls = [c for e in s.events for c in peek_audit.tool_calls(e)]
    p.expect(all(isinstance(inp, dict) for _, inp in calls), "a tool call's input isn't a dict")
    p.same(len(calls), s.tool_starts, "tool_calls against the log's tool calls")
    report = peek_audit.audit([s.plain], allowed=[str(logscan.own_workspace_for(s.run) if s.run else NO_WORK)], sensitive=[str(REPO)])
    p.same(report.tool_calls, len(calls), "the audit's tool calls")
    p.expect(all(isinstance(x, str) for f in [*report.peeks, *report.review] for x in (f.tool, f.path, f.source)), "a finding's fields aren't strings")


# ---------------------------------------------------------------- progress.py, recount_tokens.py, preflight.py

def replay_progress(s: Story, p: Problems) -> None:
    tally = progress.EventTally(CLIENTS[s.client](NO_WORK), s.plain, empty_state).update()
    p.same({k: tally[k] for k in ("calls", "output_tokens", "compactions")},
           {"calls": s.whole["steps"], "output_tokens": s.whole["tokens"]["output"], "compactions": s.whole["compactions"]}, "the tally")
    lines = [l for l in map(progress.short_call, s.events) if l is not None]
    p.expect(all(isinstance(l, str) and len(l) <= progress.ACTIVITY_CHARS for l in lines), "a short_call line isn't a short string")
    p.same(tally["recent_activity"], lines[-progress.RECENT_ACTIVITY:], "recent activity is the last tool calls")


def replay_recount(s: Story, p: Problems) -> None:
    p.same(recount_tokens.tokens_from_log(s.client, s.log), s.whole["tokens"], "tokens_from_log")
    # The machine that ran the story may still hold its full log beside the published one, and that one is read first.
    p.expect(recount_tokens.story_log(s.log.parent) in (s.log, s.log.with_name(recount_tokens.FULL_LOG)), "story_log finds neither log")


def replay_preflight(s: Story, p: Problems) -> None:
    if s.client != "claude":
        return
    ok, why = preflight.claude_probe_verdict(s.events, PROBE_SECRET)
    p.expect(isinstance(ok, bool) and isinstance(why, str) and why, "claude_probe_verdict didn't return (bool, reason)")


READERS = (("accounting", replay_accounting), ("conversation", replay_conversation), ("drive", replay_drive),
           ("clients", replay_clients), ("attempts", replay_attempts), ("logscan", replay_logscan),
           ("history", replay_history), ("annotate", replay_annotate), ("claims", replay_claims),
           ("peek_audit", replay_peek_audit), ("progress", replay_progress), ("recount_tokens", replay_recount),
           ("preflight", replay_preflight))


def replay(s: Story) -> list[str]:
    """Every reader over one story's log: what raised, and what didn't hold."""
    out = Problems()
    for out.reader, reader in READERS:
        try:
            reader(s, out)
        except Exception as ex:      # the point of the replay: no reader may raise on a real log
            at = traceback.extract_tb(ex.__traceback__)[-1]
            out.append(f"{out.reader}: raised {type(ex).__name__}: {ex} ({Path(at.filename).name}:{at.lineno} in {at.name})")
    out.reader = "STALE_RECORDS"
    out.expect(set(s.stale) <= out.checked, f"names fields the replay never compared for this story: {sorted(set(s.stale) - out.checked)}")
    return list(out)


LOGS = all_logs()
REPLAYED = LOGS if replay_all() else sample(LOGS)


@pytest.mark.parametrize("log", REPLAYED, ids=lambda log: log.relative_to(REPO).as_posix())
def test_every_reader_reads_the_recorded_log(log, tmp_path):
    problems = replay(Story.load(log, tmp_path))
    assert not problems, f"{len(problems)} problems replaying {log.relative_to(REPO)}:\n" + "\n".join(problems)


def test_logs_are_found_for_every_client_that_has_recorded_runs():
    """The globs still find the records (a moved folder would otherwise replay nothing and pass), and name clients
    the harness has. OpenCode has no recorded run: its scan is replayed only on other clients' events."""
    found = {run_info(run)[1] for run in {run_of(log) for log in LOGS} if run is not None}
    assert CLIENTS_WITH_LOGS <= found <= set(CLIENTS)


def test_the_sample_covers_every_shape_of_event_and_every_run_client_and_combination():
    picked = sample(LOGS)
    runs = lambda logs: {run_of(log) for log in logs}
    assert set().union(*map(shapes_of, picked)) == set().union(*map(shapes_of, LOGS))
    assert runs(picked) == runs(LOGS)
    assert {run_info(r)[1] for r in runs(picked)} == {run_info(r)[1] for r in runs(LOGS)}
    assert {combination_of(r) for r in runs(picked)} == {combination_of(r) for r in runs(LOGS)}
    assert picked == sample(list(reversed(LOGS)))                # the same sample whatever order the logs come in


def test_every_stale_record_is_still_a_recorded_story():
    for run, sid in STALE_RECORDS:
        assert (REPO / run / STORIES_DIR / f"{int(sid):02d}" / LOG_NAME) in LOGS, f"{run} story {sid} is gone: remove it from STALE_RECORDS"


def main(argv: list[str]) -> int:
    logs = LOGS if "--all" in argv or replay_all() else sample(LOGS)
    t0, bad, kinds = time.monotonic(), 0, {}
    for log in logs:
        with tempfile.TemporaryDirectory() as tmp:
            s = Story.load(log, Path(tmp))
            problems = replay(s)
        kind = (s.client, "stamped" if s.stamped else "unstamped", "lossless" if s.lossless else "lossy")
        kinds[kind] = kinds.get(kind, 0) + 1
        if problems:
            bad += 1
            print(s.name, *problems, sep="\n    ")
    for kind, n in sorted(kinds.items()):
        print(f"{n:4d} {' '.join(kind)}")
    print(f"{len(logs)} logs replayed in {time.monotonic() - t0:.0f} s; {bad} with problems")
    return 1 if bad else 0


if __name__ == "__main__":
    os.environ.setdefault(heldout.PRIVATE_ENV, str(NO_WORK))     # as conftest.py does for the tests
    sys.exit(main(sys.argv[1:]))
