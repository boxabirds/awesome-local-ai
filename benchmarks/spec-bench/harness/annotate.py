# /// script
# requires-python = ">=3.11"
# ///
"""Error analysis: review every story attempt in the run records and label it pass, fail or skip.

    uv run annotate.py [--port 8765] [--rebuild]

An attempt is one stack's try at one story in one run. For each, the page shows what was asked,
what the agent claimed, what it changed, how the behaviour eval scored it, and a condensed
timeline, on one screen. You label it:
- + (or =, or p): pass; - (or f): fail; space (or s): skip (unsure, a question, a scope issue: review
  later). Each saves and moves on. Keys act only when the notes box isn't active.
- n: write a note (Esc to leave the box). Notes matter most: they become the failure taxonomy.
- j/k or arrows: previous/next; t: timeline; 1-4: filter all / unlabelled / skipped / failed.

Runs on this machine only (127.0.0.1): the attempts quote held-out test titles and errors, so they
stay off external services. Labels are written on every change to
<private repo>/analysis/labels.csv, which is committed there, never to the public repo. The
attempt data is cached in <private>/state/annotate/ (git-ignored).

Attempts are ordered for coverage, not by run: stacks interleaved, stories spread, so new kinds of
failure show up early and you can stop when new attempts stop teaching you anything.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import http.server
import json
import random
import re
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
import claims  # noqa: E402
import packdir  # noqa: E402

EVENTS = "agent-events.compact.jsonl.gz"
VERDICTS = ("pass", "fail", "skip")
LABEL_FIELDS = ("attempt", "verdict", "notes", "updated_at")
ORDER_SEED = 20260927  # fixed, so the review order is the same every session
TIMELINE_ARG_CHARS = 90
ERROR_LINE_CHARS = 220
CLAIM_CHARS = 4000


# ---------- building attempts from the run records ----------

def run_dirs(repo: Path) -> list[Path]:
    """Every recorded vidi run: combinations/**/benchmarks/vidi/<run> and benchmarks/reference/vidi/<model>/<run>."""
    found = [p.parent for p in repo.glob("combinations/**/benchmarks/vidi/*/metrics.json")]
    found += [p.parent for p in repo.glob("benchmarks/reference/vidi/*/*/metrics.json")]
    return sorted(r for r in set(found) if not _known_good(r))


def _known_good(run: Path) -> bool:
    """A known-good run (EVALUATION-POLICY rule 7) is diagnostic: never reviewed beside full runs."""
    try:
        return bool(json.loads((run / "metrics.json").read_text()).get("known_good"))
    except (OSError, json.JSONDecodeError):
        return False


def stack_of(run: Path, repo: Path) -> str:
    rel = run.relative_to(repo).as_posix()
    if rel.startswith("combinations/"):
        return rel.removeprefix("combinations/").split("/benchmarks/")[0]
    return "reference/" + rel.split("/")[-2]


def story_entry(metrics: dict, sid: str) -> dict:
    st = metrics.get("stories") or {}
    if isinstance(st, dict):
        return st.get(str(int(sid))) or st.get(sid) or {}
    return next((s for s in st if str(s.get("id")) == str(int(sid))), {})


def first_line(text: str | None, limit: int = ERROR_LINE_CHARS) -> str:
    text = re.sub(r"\x1b\[[0-9;]*m", "", text or "")
    line = next((l.strip() for l in text.splitlines() if l.strip()), "")
    return line[:limit]


def short_args(args) -> str:
    if not isinstance(args, dict):
        return str(args)[:TIMELINE_ARG_CHARS]
    for k in ("command", "path", "file_path", "pattern", "url"):
        if args.get(k):
            return str(args[k]).replace("\n", " ")[:TIMELINE_ARG_CHARS]
    return json.dumps(args)[:TIMELINE_ARG_CHARS]


def timeline(lines) -> list[dict]:
    """Tool calls, compactions, errors and the like, with repeats of the same tool collapsed."""
    out: list[dict] = []
    t0 = None

    def add(kind: str, text: str, t: float | None):
        nonlocal t0
        if t is not None and t0 is None:
            t0 = t
        mins = round((t - t0) / 60, 1) if (t is not None and t0 is not None) else None
        if out and out[-1]["kind"] == kind == "tool" and out[-1]["text"].split(" ", 1)[0] == text.split(" ", 1)[0]:
            out[-1]["count"] += 1
            out[-1]["last"] = text
            return
        out.append({"kind": kind, "text": text, "min": mins, "count": 1, "last": text})

    for line in lines:
        try:
            e = json.loads(line)
        except (json.JSONDecodeError, TypeError):
            continue
        typ = e.get("type")
        t = e.get("_rx")
        if t is None and isinstance(e.get("timestamp"), str):
            try:
                t = datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")).timestamp()
            except ValueError:
                t = None
        if typ == "tool_execution_start":
            add("tool", f"{e.get('toolName')} {short_args(e.get('args'))}", t)
        elif typ == "tool_execution_end" and (e.get("isError") or (e.get("result") or {}).get("isError")):
            add("error", f"{e.get('toolName')} failed", t)
        elif typ == "compaction_start":
            add("compaction", f"compaction ({e.get('reason', '')})", t)
        elif typ == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if c.get("type") == "tool_use":
                    add("tool", f"{c.get('name')} {short_args(c.get('input'))}", t)
        elif typ == "system" and e.get("subtype") == "compact_boundary":
            add("compaction", "compaction", t)
        elif typ in ("error", "harness_nudge", "nudge"):
            add("error" if typ == "error" else "nudge", str(e.get("message") or e.get("text") or typ)[:TIMELINE_ARG_CHARS], t)
        elif typ == "message_end":
            m = e.get("message") or {}
            if m.get("stopReason") == "error" or m.get("errorMessage"):
                add("error", f"model error: {first_line(m.get('errorMessage') or 'error')}", t)
    return out


def commits_for(log: str, sid: int) -> list[str]:
    """The commit blocks for one story, by subject ('story N:' or a harness snapshot after story N)."""
    blocks = [b for b in re.split(r"(?m)^(?=commit [0-9a-f]{7,40}\b)", log) if b.strip()]
    pat = re.compile(rf"^\s+(story {sid}\b|harness: snapshot after story {sid}\b)", re.M)
    return [b.strip() for b in reversed(blocks) if pat.search(b)]


def build_attempt(run: Path, repo: Path, sdir: Path, metrics: dict, log: str) -> dict | None:
    sid = sdir.name
    accept_path, events_path = sdir / "accept.json", sdir / EVENTS
    if not accept_path.exists() or not events_path.exists():
        return None
    accept = json.loads(accept_path.read_text())
    own = (accept.get("by_story") or {}).get(sid) or {}
    failed = [{"title": t.get("title"), "error": first_line(t.get("error"))}
              for t in accept.get("tests") or [] if t.get("status") != "passed" and t.get("file", "").startswith(f"story-{sid}")]
    with gzip.open(events_path, "rt", errors="replace") as f:
        lines = f.readlines()
    s = story_entry(metrics, sid)
    agent = s.get("agent") or {}
    gate = {}
    if (sdir / "gate.json").exists():
        gate = json.loads((sdir / "gate.json").read_text())
    return {
        "id": f"{run.relative_to(repo).as_posix()}#{sid}",
        "stack": stack_of(run, repo),
        "run": run.name,
        "story": int(sid),
        "title": s.get("title") or "",
        "tasks": [{"n": t.get("n"), "title": t.get("title"), "type": t.get("type"), "status": t.get("status")}
                  for t in s.get("tasks") or []],
        "completion": {"status": s.get("status"), "ended_by": s.get("ended_by"),
                       "agent_minutes": round((agent.get("seconds") or 0) / 60, 1), "tool_calls": agent.get("tool_calls"),
                       "compactions": agent.get("compactions"), "nudges": agent.get("nudges"),
                       "resumes": agent.get("resumes"), "ended_in_error": agent.get("ended_in_error")},
        "self_check_green": gate.get("all_green"),
        "behaviour": {"own_passed": own.get("passed"), "own_total": own.get("total"),
                      "cumulative": f"{accept.get('passed')}/{accept.get('total')}", "failed": failed},
        "claims": (claims.final_message(lines) or "")[:CLAIM_CHARS],
        "commits": commits_for(log, int(sid)),
        "timeline": timeline(lines),
    }


def coverage_order(attempts: list[dict]) -> list[dict]:
    """Stacks interleaved round-robin; within a stack, stories spread and runs shuffled, deterministically."""
    rng = random.Random(ORDER_SEED)
    by_stack: dict[str, list[dict]] = {}
    for a in attempts:
        by_stack.setdefault(a["stack"], []).append(a)
    def round_robin(groups: list[list[dict]]) -> list[dict]:
        out = []
        while any(groups):
            for g in groups:
                if g:
                    out.append(g.pop(0))
        return out

    queues = []
    for stack in sorted(by_stack):
        by_story: dict[int, list[dict]] = {}
        for a in by_stack[stack]:
            by_story.setdefault(a["story"], []).append(a)
        groups = [by_story[s] for s in sorted(by_story)]
        for g in groups:
            rng.shuffle(g)  # which run's attempt comes first
        rng.shuffle(groups)  # which story comes first
        queues.append(round_robin(groups))  # one of each story before any story repeats
    rng.shuffle(queues)
    return round_robin(queues)  # stacks interleaved


def fingerprint(runs: list[Path]) -> str:
    h = hashlib.sha256()
    for r in runs:
        for p in sorted(r.glob("stories/*/accept.json")) + [r / "metrics.json"]:
            h.update(f"{p}:{p.stat().st_mtime_ns}".encode())
    return h.hexdigest()[:16]


def load_attempts(repo: Path, cache: Path, rebuild: bool) -> list[dict]:
    runs = run_dirs(repo)
    fp = fingerprint(runs)
    if cache.exists() and not rebuild:
        data = json.loads(cache.read_text())
        if data.get("fingerprint") == fp:
            return data["attempts"]
    attempts = []
    for run in runs:
        metrics = json.loads((run / "metrics.json").read_text())
        log = (run / "workspace-git-log.txt").read_text() if (run / "workspace-git-log.txt").exists() else ""
        if not (run / "stories").is_dir():
            print(f"  {run.relative_to(repo)}: no per-story records (built outside the harness), skipped")
            continue
        for sdir in sorted(p for p in (run / "stories").iterdir() if p.is_dir()):
            a = build_attempt(run, repo, sdir, metrics, log)
            if a:
                attempts.append(a)
        print(f"  {run.relative_to(repo)}: {sum(1 for a in attempts if a['id'].startswith(run.relative_to(repo).as_posix()))} attempts")
    attempts = coverage_order(attempts)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"fingerprint": fp, "attempts": attempts}))
    return attempts


# ---------- labels ----------

def read_labels(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with path.open(newline="") as f:
        return {r["attempt"]: r for r in csv.DictReader(f)}


def write_label(path: Path, attempt: str, verdict: str, notes: str, lock: threading.Lock) -> dict:
    if verdict not in VERDICTS and verdict != "":
        raise ValueError(f"verdict must be one of {VERDICTS}")
    with lock:
        labels = read_labels(path)
        labels[attempt] = {"attempt": attempt, "verdict": verdict, "notes": notes,
                           "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        with tmp.open("w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=LABEL_FIELDS)
            w.writeheader()
            for row in sorted(labels.values(), key=lambda r: r["attempt"]):
                w.writerow({k: row.get(k, "") for k in LABEL_FIELDS})
        tmp.replace(path)  # atomic: a crash never leaves a half-written file
        return labels[attempt]


# ---------- server ----------

def make_handler(attempts: list[dict], labels_path: Path):
    lock = threading.Lock()
    page = (HERE / "annotate.html").read_text()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, code: int, body: bytes, ctype: str = "application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/":
                self.send(200, page.encode(), "text/html; charset=utf-8")
            elif self.path == "/api/state":
                labels = read_labels(labels_path)
                index = [{"id": a["id"], "stack": a["stack"], "run": a["run"], "story": a["story"],
                          "verdict": labels.get(a["id"], {}).get("verdict", ""),
                          "notes": labels.get(a["id"], {}).get("notes", "")} for a in attempts]
                self.send(200, json.dumps(index).encode())
            elif self.path.startswith("/api/attempt/"):
                i = int(self.path.rsplit("/", 1)[1])
                self.send(200, json.dumps(attempts[i]).encode())
            else:
                self.send(404, b"{}")

        def do_POST(self):
            if self.path != "/api/label":
                self.send(404, b"{}")
                return
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            try:
                row = write_label(labels_path, body["attempt"], body.get("verdict", ""), body.get("notes", ""), lock)
                self.send(200, json.dumps(row).encode())
            except (KeyError, ValueError) as e:
                self.send(400, json.dumps({"error": str(e)}).encode())

    return Handler


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--rebuild", action="store_true", help="rebuild the attempt cache from the records")
    ap.add_argument("--no-browser", action="store_true")
    a = ap.parse_args()
    private = packdir.private_checkout()
    if not private.is_dir():
        raise SystemExit(f"no private repo at {private}: the labels and attempt data belong there")
    print("building attempts from the run records…")
    attempts = load_attempts(REPO, private / "state" / "annotate" / "attempts.json", a.rebuild)
    labels_path = private / "analysis" / "labels.csv"
    server = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(attempts, labels_path))
    url = f"http://127.0.0.1:{a.port}/"
    print(f"{len(attempts)} attempts; labels in {labels_path}\nopen {url}  (Ctrl-C to stop)")
    if not a.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
