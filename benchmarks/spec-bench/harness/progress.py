"""Live story and task progress for a Vidi run (see CONTROL.md).

The harness answers "where is each story, and each of its tasks?" from evidence in
the workspace, never from the agent's own account:

- A story's tasks come from the table in its tasks.md (number, title, type,
  implemented component) and the TC ids each task names.
- A test task is `written` when its TC ids appear on lines this story added,
  `committed` when they appear on lines this story committed (or a commit
  message names the task), and `verified` when, at the end of the story, it is
  committed and the agent's gate step for its type exited 0.
- An implementation task has no TC ids of its own. It takes the lowest status of
  the test tasks for the same component, raised to `committed` if a commit names it.

Only lines added since the story began count, because TC numbers restart in every
story. This is evidence, not proof: the audit (audit.md) is the final word.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from collections import deque
from pathlib import Path

TASK_ROW_RE = re.compile(r"^\|\s*(\d+)\s*\|\s*(.+?)\s*\|\s*[^|]*\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$")
TASK_HEAD_RE = re.compile(r"^###\s+(\d+)\.")
TC_RE = re.compile(r"TC-(\d+)")
TC_RANGE_RE = re.compile(r"TC-(\d+)\s*(?:to|–|-|\.\.)\s*TC-(\d+)")
TASK_MENTION_RE = re.compile(r"\btasks?\s+(\d+(?:\s*(?:,|and|&|-|–|to)\s*\d+)*)", re.I)
STATUS_ORDER = ["not-started", "written", "committed", "verified"]
IMPLEMENTATION = "implementation"
# Which gate step proves a test task of each type.
GATE_STEP_FOR_TYPE = {"test:unit": "test:unit", "test:ui-component": "test:component",
                      "test:integration": "test:integration", "test:e2e": "test:e2e"}
TEST_PATH_RE = re.compile(r"(^|/)(tests?|__tests__|e2e)/|\.(test|spec)\.[cm]?[jt]sx?$")
STUB_RE = re.compile(r"\b(TODO|FIXME|stub(bed)?|not implemented|placeholder|fake[A-Z]\w*|mock[A-Z]\w*)\b", re.I)
RECENT_ACTIVITY = 12
ACTIVITY_CHARS = 140


def _expand_tcs(text: str) -> list[str]:
    ids: set[int] = set()
    for a, b in TC_RANGE_RE.findall(text):
        ids.update(range(int(a), int(b) + 1))
    ids.update(int(x) for x in TC_RE.findall(text))
    return [f"TC-{i:02d}" for i in sorted(ids)]


def parse_tasks(tasks_md: Path) -> list[dict]:
    """The task table of a story's tasks.md, with the TC ids each task names (title + its section)."""
    text = tasks_md.read_text()
    tasks: list[dict] = []
    for line in text.splitlines():
        m = TASK_ROW_RE.match(line)
        if m:
            tasks.append({"n": int(m.group(1)), "title": m.group(2), "type": m.group(3).strip(),
                          "implements": [c.strip() for c in m.group(4).split(",") if c.strip()]})
    sections: dict[int, list[str]] = {}
    current = None
    for line in text.splitlines():
        h = TASK_HEAD_RE.match(line)
        if h:
            current = int(h.group(1))
        if current is not None:
            sections.setdefault(current, []).append(line)
    for t in tasks:
        own = t["title"] + "\n" + "\n".join(sections.get(t["n"], []))
        t["tcs"] = [] if t["type"] == IMPLEMENTATION else _expand_tcs(own)
    return tasks


def _git(ws: Path, *args: str) -> str:
    # No optional locks: the agent is using the same repository while the harness reads it.
    p = subprocess.run(["git", *args], cwd=ws, capture_output=True, text=True, errors="replace",
                       env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"})
    return p.stdout if p.returncode == 0 else ""


def _added_tcs(diff: str) -> set[str]:
    """TC ids on added lines of test files in a unified diff."""
    out: set[str] = set()
    path = ""
    for line in diff.splitlines():
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and path and TEST_PATH_RE.search(path):
            out.update(_expand_tcs(line))
    return out


def evidence(ws: Path, base: str) -> dict:
    """What this story has added since `base`: TC ids written (working tree), TC ids committed,
    tasks named in commit messages, and when HEAD last moved."""
    written = _added_tcs(_git(ws, "diff", "-U0", base))
    for f in _git(ws, "ls-files", "--others", "--exclude-standard").splitlines():
        if TEST_PATH_RE.search(f):
            try:
                written.update(_expand_tcs((ws / f).read_text(errors="replace")))
            except OSError:
                pass
    committed = _added_tcs(_git(ws, "diff", "-U0", base, "HEAD"))
    named: set[int] = set()
    for msg in _git(ws, "log", "--format=%s%n%b", f"{base}..HEAD").splitlines():
        for grp in TASK_MENTION_RE.findall(msg):
            nums = [int(x) for x in re.findall(r"\d+", grp)]
            if re.search(r"\d\s*(?:-|–|to)\s*\d", grp) and len(nums) == 2 and nums[0] < nums[1]:
                named.update(range(nums[0], nums[1] + 1))
            else:
                named.update(nums)
    head = _git(ws, "rev-parse", "HEAD").strip()
    last_commit = _git(ws, "log", "-1", "--format=%ct").strip() if head and head != base else ""
    return {"written": written, "committed": committed, "named": named,
            "last_commit_at": float(last_commit) if last_commit else None, "head": head}


def task_table(tasks: list[dict], ev: dict, gate: dict | None = None) -> list[dict]:
    """Each task with its status. `gate` (the story-end gate result) is needed for `verified`."""
    steps = (gate or {}).get("steps", {})
    out = []
    for t in tasks:
        row = {k: t[k] for k in ("n", "title", "type", "implements", "tcs")}
        if t["tcs"]:
            found = len(set(t["tcs"]) & ev["written"])
            done = len(set(t["tcs"]) & ev["committed"])
            status = ("committed" if done == len(t["tcs"]) or t["n"] in ev["named"]
                      else "written" if found or done else "not-started")
            step = GATE_STEP_FOR_TYPE.get(t["type"])
            if status == "committed" and step and steps.get(step, {}).get("exit") == 0:
                status = "verified"
            row.update(status=status, found=max(found, done), total=len(t["tcs"]))
        else:
            row.update(status=None, found=None, total=None)
        out.append(row)
    for row in out:
        if row["status"] is not None:
            continue
        linked = [r["status"] for r in out if r["tcs"] and set(r["implements"]) & set(row["implements"])]
        status = min(linked, key=STATUS_ORDER.index) if linked else "not-started"
        if row["n"] in ev["named"] and STATUS_ORDER.index(status) < STATUS_ORDER.index("committed"):
            status = "committed"
        row["status"] = status
    return out


def tasks_signature(table: list[dict]) -> str:
    return json.dumps([(r["n"], r["status"], r.get("found")) for r in table])


def short_call(e: dict) -> str | None:
    """One tool call as a short line, from a pi or OpenCode event."""
    if e.get("type") == "tool_execution_start":             # pi
        name, args = e.get("toolName"), e.get("args") or {}
    elif e.get("type") == "tool_use":                        # OpenCode
        part = e.get("part") or {}
        name, args = part.get("tool"), (part.get("state") or {}).get("input") or {}
    else:
        return None
    what = args.get("command") or args.get("path") or args.get("filePath") or ""
    what = re.sub(r"^cd \S+ && ", "", str(what).strip()).replace("\n", " ")
    line = f"{name}: {what}"
    return line if len(line) <= ACTIVITY_CHARS else line[:ACTIVITY_CHARS - 1] + "…"


class EventTally:
    """Counts calls, output tokens and compactions from an agent event log, reading only what
    was appended since the last call (a long story's log is hundreds of MB)."""

    def __init__(self, client, events: Path, empty_state):
        self.client, self.events = client, events
        self.st = empty_state()
        self.offset = 0
        self.recent: deque[str] = deque(maxlen=RECENT_ACTIVITY)

    def update(self) -> dict:
        if self.events.exists():
            with self.events.open("rb") as f:
                f.seek(self.offset)
                chunk = f.read()
            end = chunk.rfind(b"\n") + 1
            self.offset += end
            for raw in chunk[:end].splitlines():
                if b'"message_update"' in raw[:40] or b'"tool_execution_update"' in raw[:40]:
                    continue
                try:
                    e = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                self.client.scan(e, self.st)
                c = short_call(e)
                if c:
                    self.recent.append(c)
        return {"calls": self.st["steps"], "output_tokens": self.st["tokens"]["output"],
                "compactions": self.st["compactions"], "recent_activity": list(self.recent)}


def _story_minutes(s: dict) -> float | None:
    if "agent_minutes" in s:
        return s["agent_minutes"]
    if s.get("agent", {}).get("seconds") is not None:
        return round(s["agent"]["seconds"] / 60, 1)
    return None


def _void(accept_file: Path) -> bool:
    """A held-out score the machine couldn't produce (gates.harness_fault), e.g. no browser."""
    import gates
    try:
        acc = json.loads(accept_file.read_text())
        return bool(acc.get("harness_fault") or gates.harness_fault(acc.get("tests", []), acc.get("runner_tail", "")))
    except (OSError, json.JSONDecodeError):
        return False


def baselines(repo_root: Path, story_id: int, exclude: Path) -> list[dict]:
    """The same story in every other recorded run: other harness runs and the reference builds."""
    out = []
    runs = [*(repo_root / "combinations").glob("**/benchmarks/vidi/*/metrics.json"),
            *(repo_root / "benchmarks" / "reference" / "vidi").glob("*/run-*/metrics.json")]
    for mf in sorted(runs):
        if mf.parent.resolve() == exclude.resolve():
            continue
        try:
            m = json.loads(mf.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        s = m.get("stories", {}).get(str(story_id))
        if not s or not s.get("finished"):
            continue
        status = next((p["status"] for p in m.get("processed", []) if p["id"] == story_id), "DONE")
        own = (s.get("accept") or {}).get("by_story", {}).get(f"{story_id:02d}")
        if own is None and (mf.parent / "accept.json").exists():
            # A reference build is scored once at the end, all stories built (not at each story's end).
            try:
                own = json.loads((mf.parent / "accept.json").read_text()).get("by_story", {}).get(f"{story_id:02d}")
            except (OSError, json.JSONDecodeError):
                pass
        story_accept = mf.parent / "stories" / f"{story_id:02d}" / "accept.json"
        if own is not None and story_accept.exists() and _void(story_accept):
            own = None  # scored without a working browser: says nothing about the build
        rel = mf.parent.relative_to(repo_root)
        label = (" ".join([str(Path(*rel.parts[1:-3])), rel.parts[-1]]) if rel.parts[0] == "combinations"
                 else " ".join(["reference", *rel.parts[3:]]))  # reference <stack> <run-id>
        # Reference builds have no harness gate; their agents' own build and tests passed (README).
        gate_green = (s.get("gate") or {}).get("all_green", True if rel.parts[0] != "combinations" else None)
        out.append({"source": label, "status": status, "gate_green": gate_green, "agent_minutes": _story_minutes(s),
                    "calls": s.get("agent", {}).get("steps") or s.get("api_calls"),
                    "output_tokens": (s.get("agent", {}).get("tokens") or {}).get("output") or s.get("output_tokens"),
                    "accept": own})
    return out


def base_health(gate: dict, table: list[dict], own_accept: dict | None, base: list[dict]) -> dict:
    """The verdict on a PARTIAL story: can later stories build on it? Never stops the run.

    green: gate green, every task that isn't verified is a test task, and the story's own held-out
           tests do no worse than the worst healthy baseline for the story: DONE with a green gate
           (all must pass if there is none).
    amber: gate green, but an implementation task isn't verified or the held-out tests fall short.
    red:   the gate is red."""
    unverified = [r for r in table if r["status"] != "verified"]
    impl_gap = [r["n"] for r in unverified if r["type"] == IMPLEMENTATION]
    rates = [b["accept"]["passed"] / b["accept"]["total"] for b in base
             if b["status"] == "DONE" and b.get("gate_green") and b.get("accept") and b["accept"].get("total")]
    floor = min(rates) if rates else 1.0
    own = own_accept or {}
    rate = own["passed"] / own["total"] if own.get("total") else None
    heldout_ok = rate is None or rate >= floor
    if not gate.get("all_green"):
        verdict = "red"
    elif impl_gap or not heldout_ok:
        verdict = "amber"
    else:
        verdict = "green"
    return {"verdict": verdict, "gate_green": bool(gate.get("all_green")),
            "unverified_tasks": [r["n"] for r in unverified], "unverified_implementation_tasks": impl_gap,
            "heldout": own or None, "heldout_floor": round(floor, 3), "heldout_ok": heldout_ok}


def stub_markers(ws: Path, base: str) -> list[str]:
    """Added lines in product code (not tests) that look like stubs, fakes or placeholders."""
    out = []
    path = ""
    for line in _git(ws, "diff", "-U0", base, "HEAD", "--", "src").splitlines():
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else ""
        elif line.startswith("+") and path and not TEST_PATH_RE.search(path) and STUB_RE.search(line):
            out.append(f"{path}: {line[1:].strip()[:ACTIVITY_CHARS]}")
    return out


def heldout_changes(partial_accept: dict, now_tests: list[dict], story_id: int) -> dict:
    """How a PARTIAL story's held-out tests changed since it was ended: fixed (fail→pass, a later
    agent filled a gap) and regressed (pass→fail)."""
    tag = f"story-{story_id:02d}"
    before = {t["title"]: t["status"] for t in partial_accept.get("tests", []) if tag in (t.get("file") or "")}
    fixed, regressed = [], []
    for t in now_tests:
        if tag not in (t.get("file") or "") or t["title"] not in before:
            continue
        if before[t["title"]] != "passed" and t["status"] == "passed":
            fixed.append(t["title"])
        elif before[t["title"]] == "passed" and t["status"] not in ("passed", "skipped"):
            regressed.append(t["title"])
    return {"fixed": fixed, "regressed": regressed}


def write_json_atomic(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(doc, indent=2))
    os.replace(tmp, path)


def write_progress(run: Path, scope: dict, stories: list[dict], metrics: dict, live: dict | None) -> None:
    """progress.json: every story in scope, processed (DONE/PARTIAL), running (live) or pending."""
    processed = {p["id"]: p for p in metrics.get("processed", [])}
    rows = []
    for s in stories:
        sid = s["id"]
        if sid in processed:
            rows.append(processed[sid])
        elif live and live["id"] == sid:
            rows.append(live)
        else:
            rows.append({"id": sid, "status": "pending"})
    write_json_atomic(run / "progress.json", {"updated_at": time.time(), "scope": scope.get("name"), "stories": rows})
