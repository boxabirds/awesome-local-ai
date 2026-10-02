#!/usr/bin/env python3
"""The monitor's detector: one cheap, read-only pass over the benchmark's own signals. No LLM.

Each tick it reads the benchmarker's fault feed and state (127.0.0.1:7760), `dbench` status across the nodes, the
records that changed on origin/main, and (for a Mac that serves a model) the server's memory. Whatever
is new since the last tick is appended to ops/monitor-log.jsonl, one JSON object per line; ops/monitor-status.json
is rewritten every tick; the owner gets one macOS notification per change of state. Judging a detection (which
bucket, what to fix) is not done here: triage.py hands the new lines to Claude and ops/anomaly-tracking.md gets the
entry.

    python3 ops/monitor/monitor.py            # one tick
    python3 ops/monitor/monitor.py --dry-run  # print what a tick would log; write nothing

Stdlib only. Machines are named by hardware in everything written: node names come from dbench at run time and
are replaced before a record is stored (the node list itself stays in ~/.config/dbench/nodes.toml).
Tests: test_monitor.py, on recorded inputs in fixtures/.
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import zoneinfo
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
OPS = REPO / "ops"
LOG = OPS / "monitor-log.jsonl"
STATUS = OPS / "monitor-status.json"
STATE_DIR = OPS / "monitor-state"            # git-ignored: the detector's memory between ticks
STATE = STATE_DIR / "detector.json"
TRIAGE_STATE = STATE_DIR / "triage.json"     # written by triage.py
MEMORY_LOG = STATE_DIR / "memory.jsonl"

BENCHMARKER = "http://127.0.0.1:7760"
TICK_S = 600                                 # the LaunchAgent's interval (install.sh reads it)
TRIAGE_EVERY_S = 1800                        # triage's interval
TRIAGE_LATE_S = 3 * TRIAGE_EVERY_S           # no triage for this long: "detecting only"
STALL_WARN_S = 20 * 60
STALL_STOP_S = 30 * 60
UNFIT_WAIT_STOP_S = 2 * 3600
UNREACHABLE_STOP_S = 15 * 60
QUEUE_NOT_STARTING_S = 15 * 60
LEAK_GB = 3.0                                # a server's footprint rising this much between consecutive stories
MANY_COMPACTIONS = 6
MEMORY_KEPT = 500
UK = zoneinfo.ZoneInfo("Europe/London")
UNFIT_WAIT_TEXT = "waiting for AC power"
TROUBLE = re.compile(r"Traceback|unfit|swap guard|memory guard|harness_fault|rejected|pushed=False|interrupted|"
                     r"exited [1-9]|preflight failed|self-test failed|no release|allow-unreleased")
FIXTURE_PATHS = ("combinations/kat/", "/benchmarks/kat/")
HOME_PATH = re.compile(r"/(Users|home)/[A-Za-z0-9._-]+")
SSH = ["ssh", "-n", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8"]
SENTINEL = "MONITOR_SENTINEL_OK"


# ---- small things ---------------------------------------------------------------------------------------------------

def uk_time(t: float) -> str:
    """A time for the owner: UK local, e.g. '1 Oct 2026 18:00 BST'."""
    d = datetime.datetime.fromtimestamp(t, UK)
    return f"{d.day} {d.strftime('%b %Y %H:%M %Z')}"


def utc(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def det(kind: str, id_: str, detail: str, machine: str = "", urgent: bool = False, **more) -> dict:
    return {"id": id_, "kind": kind, "machine": machine, "urgent": urgent, "detail": detail, **more}


def machine_labels(nodes: dict) -> dict[str, str]:
    """node name -> its hardware, as the records name a machine."""
    out = {}
    for name, v in (nodes or {}).items():
        n = (v or {}).get("node") or {}
        gpus = n.get("gpus") or []
        label = (gpus[0].get("name") if gpus else "") or n.get("cpu_brand") or f"{n.get('os', 'machine')}/{n.get('arch', '')}"
        out[name] = label
        if n.get("hostname"):
            out.setdefault(n["hostname"], label)
    return out


def redact(obj, labels: dict[str, str]):
    """The record with every node name replaced by its hardware and every home path by ~."""
    text = json.dumps(obj)
    for name in sorted(labels, key=len, reverse=True):
        if name:
            text = re.sub(r"(?<![A-Za-z0-9])" + re.escape(name) + r"(?![A-Za-z0-9])", labels[name].replace("\\", ""),
                          text, flags=re.I)
    text = HOME_PATH.sub("~", text)
    return json.loads(text)


def new_only(dets: list[dict], seen: dict, now: float) -> list[dict]:
    """Detections not seen before, in order; `seen` remembers them."""
    out = []
    for d in dets:
        if d["id"] not in seen:
            seen[d["id"]] = now
            out.append(d)
    return out


# ---- the faults feed ------------------------------------------------------------------------------------------------

def fault_detections(feed: list[dict], open_: dict, now: float) -> tuple[list[dict], dict]:
    """New faults, and faults that left the feed, against the ids open at the last tick."""
    dets, now_open = [], {}
    for f in feed:
        fid = f.get("id") or f"{f.get('kind')}:{f.get('combination')}:{f.get('run')}:{f.get('story', '')}"
        now_open[fid] = open_.get(fid, now)
        if fid not in open_:
            dets.append(det("fault." + str(f.get("kind")), fid, json.dumps(f.get("detail"))[:400],
                            machine=f.get("machine") or "", pack=f.get("pack"), combination=f.get("combination"),
                            run=f.get("run"), story=f.get("story")))
    for fid in open_:
        if fid not in now_open:
            dets.append(det("fault_cleared", f"cleared:{fid}:{int(now)}", f"left the feed; open since {utc(open_[fid])}"))
    return dets, now_open


# ---- machines, jobs and running stories -----------------------------------------------------------------------------

def _progress_key(job: dict) -> str:
    p = job.get("progress") or {}
    live = next((s for s in p.get("stories") or [] if s.get("status") == "running"), None) or {}
    return hashlib.md5(json.dumps([(p.get("log_tail") or [])[-3:], live.get("id"), live.get("calls"),
                                   live.get("output_tokens"), live.get("recent_activity")],
                                  sort_keys=True).encode()).hexdigest()


def node_detections(status: dict, nodes: dict, prev: dict, now: float) -> tuple[list[dict], dict]:
    """What the nodes and their jobs show now, against the last tick's state. Returns (detections, new state).
    Detections carry stable ids; the caller logs only ids it has not logged before."""
    dets: list[dict] = []
    state: dict = {}
    for name in sorted(set(status) | set(nodes)):
        jobs = status.get(name)
        meta = nodes.get(name) or {}
        was = prev.get(name) or {}
        rec: dict = {"jobs": {}, "prog": {}}
        if meta.get("status", "ok") != "ok" or not isinstance(jobs, list):
            since = was.get("unreachable_since") or now
            rec["unreachable_since"] = since
            dets.append(det("machine_unreachable", f"machine_unreachable:{name}:{int(since)}",
                            f"status {meta.get('status')}", machine=name))
            if now - since >= UNREACHABLE_STOP_S:
                dets.append(det("machine_unreachable_15m", f"machine_unreachable_15m:{name}:{int(since)}",
                                f"unreachable for {int((now - since) / 60)} min", machine=name, urgent=True))
            state[name] = rec
            if not isinstance(jobs, list):
                continue
        held = bool((meta.get("node") or {}).get("hold"))
        running = [j for j in jobs if j["state"].get("status") == "running"]
        queued = [j for j in jobs if j["state"].get("status") == "queued"]
        if not running:
            since = was.get("idle_since") or now
            rec["idle_since"] = since
            if not queued:
                dets.append(det("machine_idle", f"machine_idle:{name}:{int(since)}", "nothing running, nothing queued"
                                + (" (held)" if held else ""), machine=name, urgent=True))
            elif now - since >= QUEUE_NOT_STARTING_S:
                dets.append(det("queue_not_starting", f"queue_not_starting:{name}:{int(since)}",
                                f"{len(queued)} queued, nothing running for {int((now - since) / 60)} min"
                                + (" (node held)" if held else ""), machine=name, urgent=True))
        for j in jobs:
            st = j["state"].get("status")
            attempt = j.get("attempt") or 0
            rec["jobs"][j["id"]] = [st, attempt]
            old = (was.get("jobs") or {}).get(j["id"])
            if not was or old == [st, attempt]:
                continue
            hist = "; ".join((h.get("text") or "")[:160] for h in (j.get("history") or [])[-2:])
            if st == "failed":
                dets.append(det("job_failed", f"job_failed:{name}:{j['id']}", f"{j['state'].get('reason')} | {hist}"[:400],
                                machine=name, urgent=True, job=j["id"]))
            elif st == "running" and attempt > 1 and (old is None or attempt > old[1]):
                dets.append(det("job_restarted", f"job_restarted:{name}:{j['id']}:{attempt}",
                                f"attempt {attempt}: {hist}"[:400], machine=name, job=j["id"]))
            elif st == "cancelled":
                dets.append(det("job_cancelled", f"job_cancelled:{name}:{j['id']}", hist[:400], machine=name, job=j["id"]))
        for j in running:
            p = j.get("progress") or {}
            tail = p.get("log_tail") or []
            live = next((s for s in p.get("stories") or [] if s.get("status") == "running"), None)
            key = _progress_key(j)
            before = (was.get("prog") or {}).get(j["id"]) or {}
            since = before.get("since", now) if before.get("key") == key else now
            lines_seen = set(before.get("lines") or [])
            rec["prog"][j["id"]] = {"key": key, "since": since, "lines": (list(lines_seen | set(tail)))[-200:]}
            story = (live or {}).get("id") or p.get("current_story") or "?"
            idle = now - since
            waiting = bool(tail) and UNFIT_WAIT_TEXT in tail[-1] and not live
            where = f"{j['id']} story {story}"
            if waiting:
                if idle >= STALL_WARN_S:
                    dets.append(det("unfit_wait", f"unfit_wait:{name}:{j['id']}:{int(since)}",
                                    f"{where}: {tail[-1].strip()[:200]}", machine=name, job=j["id"]))
                if idle >= UNFIT_WAIT_STOP_S:
                    dets.append(det("unfit_wait_2h", f"unfit_wait_2h:{name}:{j['id']}:{int(since)}",
                                    f"{where}: waiting for a fit machine for {int(idle / 60)} min", machine=name,
                                    urgent=True, job=j["id"]))
            elif idle >= STALL_WARN_S:
                last = ((live or {}).get("recent_activity") or tail or [""])[-1]
                dets.append(det("story_no_progress", f"story_no_progress:{name}:{j['id']}:{story}:{int(since)}",
                                f"{where}: nothing has changed for {int(idle / 60)} min; last: {str(last)[:160]}",
                                machine=name, job=j["id"]))
                if idle >= STALL_STOP_S:
                    dets.append(det("story_stuck", f"story_stuck:{name}:{j['id']}:{story}:{int(since)}",
                                    f"{where}: no progress for {int(idle / 60)} min", machine=name, urgent=True,
                                    job=j["id"]))
            if was:
                for line in tail:
                    if line not in lines_seen and TROUBLE.search(line):
                        h = hashlib.md5(line.encode()).hexdigest()[:10]
                        dets.append(det("job_log", f"job_log:{name}:{j['id']}:{h}", line.strip()[:300], machine=name,
                                        job=j["id"]))
            lp = j.get("last_pull") or {}
            if lp and not lp.get("ok", True):
                dets.append(det("pull_failed", f"pull_failed:{name}:{j['id']}", str(lp.get("detail"))[:200],
                                machine=name, job=j["id"]))
        state[name] = rec
    return dets, state


# ---- story records --------------------------------------------------------------------------------------------------

def story_row(sid: str, s: dict) -> dict:
    a = s.get("agent") or {}
    acc = s.get("accept") or {}
    accg = (s.get("time_split") or {}).get("accounting")
    cond = s.get("conditions") or {}
    conv = s.get("conversation") or {}
    rec = s.get("record") or {}
    return {
        "sid": str(sid), "status": s.get("status"), "ended_by": s.get("ended_by"),
        "sec": a.get("seconds"), "steps": a.get("steps"), "tools": a.get("tool_calls"),
        "out": (a.get("tokens") or {}).get("output"), "nudges": a.get("nudges"), "comp": a.get("compactions"),
        "intr": a.get("tool_interruptions"), "errors": len(a.get("errors") or []), "tctext": a.get("toolcall_text_resumes"),
        "restarted": bool(a.get("restarted")), "p": acc.get("passed"), "t": acc.get("total"),
        "runner_exit": acc.get("runner_exit"), "acc_fault": acc.get("harness_fault"), "build_exit": acc.get("build_exit"),
        "accept_skipped": acc.get("skipped"), "gate": (s.get("gate") or {}).get("all_green"),
        "acct": None if accg is None else accg.get("ok"), "commits": s.get("agent_commits"),
        "unpushed": rec.get("pushed") is False or bool(rec.get("unpushed")),
        "faults": [f.get("step") for f in (s.get("harness_faults") or [])],
        "guard_stop": bool(cond.get("aborted_swap") or cond.get("aborted_memory")), "degraded": bool(cond.get("degraded")),
        "signals": conv.get("signals") or [], "tampered": bool(s.get("spec_tampered")),
        "outside": (s.get("outside_workspace") or {}).get("ok") is False,
        "fp_max": cond.get("server_footprint_max_gb"),
        "server_started": (s.get("engine_settings") or {}).get("server_started_at"),
    }


def story_flags(r: dict) -> list[str]:
    """What looks wrong in one recorded story, from the record alone."""
    f = []
    if r["status"] == "PARTIAL":
        f.append(f"PARTIAL(ended_by={r['ended_by']})")
    if r["status"] == "DONE" and r["gate"] is False:
        f.append("gate-red-on-DONE")
    if r["acc_fault"]:
        f.append("heldout-harness-fault")
    if not r.get("accept_skipped") and r["t"] == 0 and r["runner_exit"] not in (0, None):
        f.append("heldout-ran-no-tests")
    if r["t"] and r["p"] == 0:
        f.append("heldout-all-failed")
    if r["acct"] is False:
        f.append("accounting-failed")
    if r["faults"]:
        f.append("harness_faults:" + ",".join(str(x) for x in r["faults"]))
    if (r["comp"] or 0) >= MANY_COMPACTIONS:
        f.append(f"compactions={r['comp']}")
    if r["intr"]:
        f.append(f"tool_interruptions={r['intr']}")
    if r["errors"]:
        f.append(f"errors={r['errors']}")
    if (r["nudges"] or 0) >= 2:
        f.append(f"nudges={r['nudges']}")
    if r["tctext"]:
        f.append(f"toolcall_text={r['tctext']}")
    if r["status"] == "DONE" and r["commits"] == 0:
        f.append("DONE-with-0-commits")
    if r["status"] == "DONE" and (not r["steps"] or not r["tools"]):
        f.append("DONE-with-0-steps-or-tools")
    if not r["out"]:
        f.append("no-output-tokens")
    if r["unpushed"]:
        f.append("record-not-pushed")
    if r["guard_stop"]:
        f.append("guard-stop")
    if r["degraded"]:
        f.append("DEGRADED")
    if r["signals"]:
        f.append("signals:" + ",".join(r["signals"]))
    if r["tampered"]:
        f.append("spec-tampered")
    if r["outside"]:
        f.append("reached-outside-workspace")
    if r["build_exit"] not in (0, None):
        f.append(f"heldout-build-exit={r['build_exit']}")
    return f


def leak_suspects(rows: dict[str, dict]) -> list[tuple[str, float, float]]:
    """Stories whose server footprint is more than LEAK_GB above the story before, on the same server start. A story
    after a restarted one is excused: the restart began a server mid-story, and the next story is its climb to the
    plateau, not a leak."""
    out = []
    order = sorted(rows, key=lambda x: int(x))
    for a, b in zip(order, order[1:]):
        ra, rb = rows[a], rows[b]
        if not ra.get("fp_max") or not rb.get("fp_max") or ra.get("restarted"):
            continue
        if ra.get("server_started") != rb.get("server_started"):
            continue
        if rb["fp_max"] - ra["fp_max"] > LEAK_GB:
            out.append((b, ra["fp_max"], rb["fp_max"]))
    return out


def record_detections(run_dir: str, metrics: dict, finalize: dict | None, run_status: dict) -> list[dict]:
    dets = []
    rows = {str(k): story_row(k, v) for k, v in (metrics.get("stories") or {}).items() if isinstance(v, dict)}
    for sid, r in rows.items():
        flags = story_flags(r)
        if flags:
            dets.append(det("story_record", f"story_record:{run_dir}:{sid}:{r['status']}:{r['p']}",
                            f"story {sid} {r['status']} {r['p']}/{r['t']} held-out, {int((r['sec'] or 0) / 60)} agent-min: "
                            + "; ".join(flags), run_dir=run_dir, story=sid))
    for sid, a, b in leak_suspects(rows):
        dets.append(det("server_footprint_rose", f"server_footprint_rose:{run_dir}:{sid}",
                        f"story {sid}: the model server's footprint rose {a:.1f} -> {b:.1f} GB on one server start",
                        run_dir=run_dir, story=sid))
    ended = run_status.get("state") in ("finished", "stopped", "failed")
    if finalize is not None and finalize.get("rescore") not in ("done", None):
        dets.append(det("run_not_scored", f"run_not_scored:{run_dir}:{finalize.get('rescore')}:{finalize.get('attempts')}",
                        f"finalize: rescore={finalize.get('rescore')} kind={finalize.get('reason_kind')} "
                        f"needs_person={finalize.get('needs_person')}: {str(finalize.get('reason'))[:260]}",
                        run_dir=run_dir, urgent=bool(finalize.get("needs_person"))))
    left = ((finalize or {}).get("repair") or {}).get("left") or {}
    if left:
        dets.append(det("repair_left", f"repair_left:{run_dir}:{','.join(sorted(left))}",
                        "the automatic repair left: " + json.dumps(left)[:300], run_dir=run_dir, urgent=True))
    if ended and run_status.get("state") != "finished":
        dets.append(det("run_ended_early", f"run_ended_early:{run_dir}:{run_status.get('at')}",
                        f"{run_status.get('state')}: {str(run_status.get('reason'))[:260]}", run_dir=run_dir))
    return dets


# ---- commits on main ------------------------------------------------------------------------------------------------

def commit_detections(log: str, owner: str) -> list[dict]:
    """`git log --format=%h|%an|%s --name-only` of the new commits: another author's, or a test's fixture paths."""
    dets, cur = [], None
    for line in log.splitlines():
        m = re.match(r"^([0-9a-f]{7,40})\|([^|]*)\|(.*)$", line)
        if m:
            cur = m.groups()
            if owner and cur[1] != owner:
                dets.append(det("commit_foreign_author", f"commit_foreign_author:{cur[0]}",
                                f"{cur[0]} by '{cur[1]}': {cur[2][:160]}", urgent=True))
        elif cur and line.strip() and any(p in line for p in FIXTURE_PATHS) and not cur[2].startswith("Remove"):
            d = det("commit_fixture_path", f"commit_fixture_path:{cur[0]}", f"{cur[0]} adds {line.strip()[:160]}", urgent=True)
            if d["id"] not in {x["id"] for x in dets}:
                dets.append(d)
    return dets


# ---- the status the owner reads -------------------------------------------------------------------------------------

def compute_status(now: float, triage: dict, log_lines: int) -> dict:
    untriaged = max(0, log_lines - int(triage.get("triaged_through") or 0))
    last = triage.get("last_run")
    outcome = triage.get("outcome")
    waiting = f"detections are still being logged ({untriaged} waiting)"
    if not last:
        state = f"detecting only: triage has never run; {waiting}"
    elif outcome == "usage_limit":
        state = f"triage stopped: Claude usage limit reached at {uk_time(last)}; {waiting}"
    elif outcome == "failed":
        state = f"detecting only: triage failed at {uk_time(last)} ({str(triage.get('message'))[:200]}); {waiting}"
    elif now - last > TRIAGE_LATE_S:
        state = f"detecting only: triage has not run since {uk_time(last)}; {waiting}"
    else:
        state = "ok"
    return {"state": state, "detector_last_run": uk_time(now), "detector_last_run_utc": utc(now),
            "triage_last_run": uk_time(last) if last else None, "triage_outcome": outcome,
            "triage_message": triage.get("message"), "untriaged": untriaged, "log_lines": log_lines,
            "log": str(LOG.relative_to(REPO)), "anomalies": "ops/anomaly-tracking.md"}


def _state_class(state: str) -> str:
    """The part of the state that a change of is worth a notification: not the waiting count."""
    return re.sub(r"\(\d+ waiting\)", "", state)


def notify_on_change(state: str, st: dict, send) -> None:
    cls = _state_class(state)
    if st.get("notified") is None:
        st["notified"] = cls
        if cls != "ok":
            send(state)
        return
    if cls != st["notified"]:
        st["notified"] = cls
        send(state)


def macos_notify(message: str) -> None:
    script = f'display notification {json.dumps(message)} with title "Benchmark monitor"'
    try:
        subprocess.run(["osascript", "-e", script], capture_output=True, timeout=15, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        pass


# ---- collectors (the only part that touches the world; all read-only) -----------------------------------------------

def sh(cmd: list[str] | str, timeout: int = 90, cwd: Path = REPO) -> tuple[int, str, str]:
    try:
        r = subprocess.run(cmd, shell=isinstance(cmd, str), cwd=cwd, capture_output=True, text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"
    except OSError as e:
        return 127, "", str(e)


def fetch_json(path: str):
    import urllib.request
    with urllib.request.urlopen(BENCHMARKER + path, timeout=20) as r:
        return json.loads(r.read())


def git_json(path: str):
    rc, out, _ = sh(["git", "show", f"origin/main:{path}"])
    if rc != 0:
        return None
    try:
        return json.loads(out)
    except ValueError:
        return None


def run_dir_of(path: str) -> str | None:
    m = re.match(r"^(combinations/.*?/benchmarks/[^/]+/[^/]+)/", path) or re.match(r"^(benchmarks/reference/[^/]+/[^/]+/[^/]+)/", path)
    return m.group(1) if m else None


def collect_repo(st: dict, dets: list[dict]) -> None:
    rc, _, err = sh(["git", "fetch", "-q", "origin", "main"], 120)
    if rc != 0:
        dets.append(det("git_fetch_failed", f"git_fetch_failed:{int(time.time() // 3600)}", err[:200]))
        return
    head = sh(["git", "rev-parse", "origin/main"])[1].strip()
    prev = st.get("head")
    st["head"] = head
    if not prev or prev == head:
        return
    owner = sh(["git", "config", "user.name"])[1].strip()
    dets += commit_detections(sh(["git", "log", "--format=%h|%an|%s", "--name-only", f"{prev}..{head}"])[1], owner)
    files = sh(["git", "diff", "--name-only", prev, head])[1].splitlines()
    if any(f.startswith("benchmarks/spec-bench/harness/") for f in files):
        exp = STATE_DIR / "export"
        rc, out, err = sh(f"rm -rf '{exp}' && mkdir -p '{exp}' && git archive origin/main benchmarks/spec-bench/harness "
                          f"benchmarks/vidi | tar -x -C '{exp}' && cd '{exp}/benchmarks/spec-bench/harness' && "
                          f"uv run -q python -c 'import drive' 2>&1 | tail -3", 300)
        if rc != 0 or "Error" in out or "Traceback" in out:
            dets.append(det("harness_import_fails", f"harness_import_fails:{head[:8]}", (out or err)[-300:], urgent=True))
    for d in sorted({run_dir_of(f) for f in files} - {None}):
        metrics = git_json(f"{d}/metrics.json")
        if metrics is None:
            continue
        dets += record_detections(d, metrics, git_json(f"{d}/finalize.json"), git_json(f"{d}/run-status.json") or {})


MEMORY_SCRIPT = f"""P=$(pgrep -x mlx-serve | head -1)
[ -n "$P" ] && footprint -p $P 2>/dev/null | grep -o 'Footprint: [0-9.]* [KMGT]*B'
ps -axo rss,comm | sort -rn | head -8
sysctl vm.swapusage
echo {SENTINEL}
"""


def collect_memory(status: dict, nodes: dict, now: float) -> None:
    """For a remote Mac with a job running: the model server's footprint, the top processes and swap, kept so that
    a swap-guard stop comes with what held memory before it."""
    this = sh(["hostname"])[1].strip().lower()
    for name, meta in nodes.items():
        n = meta.get("node") or {}
        if n.get("os") != "macos" or str(n.get("hostname", "")).lower() == this or meta.get("status") != "ok":
            continue
        if not any(j["state"].get("status") == "running" for j in status.get(name) or []):
            continue
        try:
            r = subprocess.run([*SSH[:1], *SSH[2:], name, "bash -s"], input=MEMORY_SCRIPT, capture_output=True, text=True,
                               timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if SENTINEL not in r.stdout:
            continue
        lines = [l.strip() for l in r.stdout.splitlines() if l.strip() and SENTINEL not in l]
        top = []
        for l in lines:
            parts = l.split(None, 1)
            if len(parts) == 2 and parts[0].isdigit():
                top.append([round(int(parts[0]) / 1048576, 1), parts[1].rsplit("/", 1)[-1][:40]])
        snap = {"t": utc(now), "machine": machine_labels(nodes).get(name, "a Mac"),
                "server_footprint": next((l for l in lines if l.startswith("Footprint:")), None),
                "swap": next((l for l in lines if "swapusage" in l), None), "top_rss_gb": top}
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        kept = MEMORY_LOG.read_text().splitlines()[-MEMORY_KEPT:] if MEMORY_LOG.exists() else []
        MEMORY_LOG.write_text("\n".join(kept + [json.dumps(snap)]) + "\n")


def tick(now: float, dry_run: bool = False) -> dict:
    st = json.loads(STATE.read_text()) if STATE.exists() else {}
    first = not st
    dets: list[dict] = []
    status, nodes = {}, {}
    rc, out, err = sh(["dbench", "--json", "status"], 60)
    rc2, out2, _ = sh(["dbench", "--json", "nodes"], 60)
    try:
        status, nodes = json.loads(out), json.loads(out2)
    except ValueError:
        dets.append(det("dbench_error", f"dbench_error:{int(now // 3600)}", (err or out)[:200]))
    labels = machine_labels(nodes)
    if status:
        nd, st["nodes"] = node_detections(status, nodes, st.get("nodes") or {}, now)
        dets += nd
    try:
        fd, st["faults"] = fault_detections(fetch_json("/api/faults").get("faults") or [], st.get("faults") or {}, now)
        dets += fd
        state = fetch_json("/api/state")
        if state.get("updatedAt") and state.get("now") and state["now"] - state["updatedAt"] > 900:
            dets.append(det("benchmarker_stale", f"benchmarker_stale:{int(now // 3600)}",
                            f"state last updated {int((state['now'] - state['updatedAt']) / 60)} min ago"))
    except Exception as e:                       # noqa: BLE001 — any failure to read the feed is the detection
        dets.append(det("benchmarker_unreachable", f"benchmarker_unreachable:{int(now // 3600)}", str(e)[:200]))
    collect_repo(st, dets)
    seen = st.setdefault("seen", {})
    fresh = new_only(dets, seen, now)
    if first:                                    # the first tick is the baseline: what is already open is not news
        fresh = [det("baseline", f"baseline:{int(now)}", f"{len(dets)} conditions already present when the monitor started")]
    records = [redact({"t": utc(now), **d, "machine": labels.get(d.get("machine") or "", d.get("machine") or "")}, labels)
               for d in fresh]
    if dry_run:
        return {"would_log": records}
    OPS.mkdir(exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    if records:
        with LOG.open("a") as f:
            for r in records:
                f.write(json.dumps(r) + "\n")
    if status:
        collect_memory(status, nodes, now)
    triage = json.loads(TRIAGE_STATE.read_text()) if TRIAGE_STATE.exists() else {}
    log_lines = sum(1 for _ in LOG.open()) if LOG.exists() else 0
    status_out = compute_status(now, triage, log_lines)
    status_out["urgent_untriaged"] = sum(
        1 for i, l in enumerate(LOG.open()) if i >= int(triage.get("triaged_through") or 0) and json.loads(l).get("urgent")
    ) if LOG.exists() else 0
    STATUS.write_text(json.dumps(status_out, indent=1) + "\n")
    notify_on_change(status_out["state"], st, macos_notify)
    urgent = [r for r in records if r.get("urgent")]
    if urgent:
        macos_notify(f"{len(urgent)} urgent: " + "; ".join(f"{r['kind']} ({r.get('machine') or r.get('run_dir') or ''})" for r in urgent)[:180])
    for k in [k for k, t in seen.items() if now - t > 14 * 86400]:
        del seen[k]
    STATE.write_text(json.dumps(st))
    return {"logged": len(records), "status": status_out}


if __name__ == "__main__":
    print(json.dumps(tick(time.time(), dry_run="--dry-run" in sys.argv[1:]), indent=1))
