"""benchmarker: one page with the live status of every benchmark run, and where each one is in
build -> score -> judge.

    uv run tools/benchmarker/benchmarker.py [--repo PATH] [--port 7760] [--judge-url URL]

Two sources, refreshed in the background:
  * dbench (`dbench status --json`, every DBENCH_EVERY_S): jobs queued and running on every node, with
    the current story and its live counts. Optional: without dbench only the repo is shown.
  * the repo's origin/main (`git fetch`, every FETCH_EVERY_S): every run record the harness has pushed
    (it commits and pushes after each story). Read straight from the fetched commit, so the working copy
    is never touched and local edits don't matter.

Standard library only.
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_REPO = HERE.parents[1]
DEFAULT_PORT = 7760                 # clear of the gallery (7800-7999) and the benchmark (8787, 18010-19811)
DEFAULT_JUDGE_URL = "http://127.0.0.1:7800/review"
FETCH_EVERY_S = 60
DBENCH_EVERY_S = 10
GIT_TIMEOUT_S = 120
DBENCH_TIMEOUT_S = 60
REF = "origin/main"
BRANCH = "main"
RUN_ROOTS = ("combinations", "benchmarks/reference")
RECENT_S = 24 * 3600               # a finished or cancelled job with no run record is shown this long

RUN_RE = re.compile(r"^(?:combinations/(?P<stack>.+)/benchmarks/(?P<pack>[^/]+)"
                    r"|benchmarks/reference/(?P<rpack>[^/]+)/(?P<rstack>[^/]+))/(?P<run>[^/]+)/(?P<rest>.+)$")


# ---------- pure parts (tested) ----------

def find_runs(paths: list[str]) -> list[dict]:
    """Runs are directories holding a run.json, under combinations/<stack>/benchmarks/<pack>/<run>/ or
    benchmarks/reference/<pack>/<stack>/<run>/. Also notes each run's re-scores and bundle."""
    runs: dict[tuple, dict] = {}
    extras: dict[tuple, dict] = {}
    for p in paths:
        m = RUN_RE.match(p)
        if not m:
            continue
        if m.group("stack"):
            stack, pack = m.group("stack"), m.group("pack")
        else:
            stack, pack = f"reference/{m.group('rstack')}", m.group("rpack")
        run, rest = m.group("run"), m.group("rest")
        key = (pack, stack, run)
        base = p[: len(p) - len(rest) - 1]
        e = extras.setdefault(key, {"rescores": [], "has_bundle": False})
        if rest == "run.json":
            runs[key] = {"pack": pack, "stack": stack, "run_id": run, "dir": base}
        elif rest == "workspace.bundle":
            e["has_bundle"] = True
        else:
            r = re.match(r"^rescore/([^/]+)/rescore\.json$", rest)
            if r and r.group(1) not in e["rescores"]:
                e["rescores"].append(r.group(1))
    out = []
    for key, run in runs.items():
        run.update({"rescores": sorted(extras[key]["rescores"]), "has_bundle": extras[key]["has_bundle"]})
        out.append(run)
    return out


def version_family(v: str) -> str:
    """"vidi-v2.0-pre1" -> "vidi-v2": results compare only within one major version."""
    m = re.match(r"^(.*?-v\d+)", v or "")
    return m.group(1) if m else ""


def row_family(row: dict, suite: str) -> str:
    """The version family a row belongs to: its record's pack version; a job with no record yet runs the
    pack's current version; a record written before runs recorded a version is "unversioned"."""
    if row.get("pack_version"):
        return version_family(row["pack_version"]) or "unversioned"
    return version_family(suite) if row.get("dir") is None else "unversioned"


def web_base(remote: str) -> str | None:
    m = re.match(r"^(?:git@github\.com:|https://github\.com/)([^/]+/[^/]+?)(?:\.git)?/?$", remote.strip())
    return f"https://github.com/{m.group(1)}" if m else None


def index_jobs(by_node: dict[str, list[dict]]) -> dict[tuple, dict]:
    """dbench jobs keyed by (combination, pack name, run id); the most recently updated job wins."""
    idx: dict[tuple, dict] = {}
    for node, jobs in by_node.items():
        for j in jobs:
            spec, prog = j.get("spec", {}), j.get("progress", {})
            stack = prog.get("combination") or spec.get("combination") or spec.get("install_id", "")
            pack = Path(spec.get("pack", "")).name
            key = (stack, pack, spec.get("run_id", ""))
            if key not in idx or j.get("updated_at", 0) > idx[key].get("updated_at", 0):
                idx[key] = {**j, "node": node}
    return idx


def stages(run: dict, job: dict | None, suite: str) -> dict:
    """Where the run is in build -> score -> judge, in words."""
    status = (job or {}).get("state", {}).get("status")
    if status == "running":
        prog = job.get("progress") or {}
        cur = prog.get("current_story")
        busy = next((st.get("id") for st in prog.get("stories") or [] if st.get("status") == "running"), None)
        if cur:
            build = f"running: story {cur}"
        elif busy:
            build = f"running: story {busy} (finishing)"     # agent done: gates, scoring, commit
        elif prog.get("stories"):
            build = "running: between stories"
        else:
            build = "running: starting"
    elif status == "queued":
        build = "queued"
    elif status == "failed":
        build = "failed: " + (job["state"].get("reason") or "no reason given")
    elif status == "cancelled":
        build = "cancelled"
    elif status == "done" and not run.get("state"):
        build = "finished (not recorded)"
    else:
        build = run.get("state") or "unknown"
    finished = run.get("state") == "finished" and status not in ("running", "queued")
    if not finished:
        score = "waiting for the build"
    elif suite in run.get("rescores", []):
        score = f"scored with {suite}"
    else:
        score = f"not scored with {suite}"
    if score != f"scored with {suite}":
        judge = "waiting for scoring"
    elif not run.get("has_bundle"):
        judge = "needs workspace.bundle"
    else:
        judge = "ready"
    return {"build": build, "score": score, "judge": judge}


def short_stack(combination: str) -> str:
    """"qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi" -> "3.8-swift-1.5/27b": the model part."""
    parts = combination.split("/")
    return "/".join(parts[1:3]) if len(parts) >= 3 else combination


def queue_positions(by_node: dict[str, list[dict]]) -> dict[str, dict]:
    """Each queued job's place on its node and the jobs ahead of it. dbench runs one job at a time,
    first in first out, except that a job being restarted after a failure goes to the front."""
    out = {}
    for jobs in by_node.values():
        running = [j for j in jobs if (j.get("state") or {}).get("status") == "running"]
        queued = [j for j in jobs if (j.get("state") or {}).get("status") == "queued"]
        # dbench's own order: (submission time, sequence, job id); restarts first
        queued.sort(key=lambda j: (0 if j.get("attempt", 0) else 1, j.get("submitted_at", 0), j.get("seq", 0),
                                   j.get("id", "")))
        def label(j, suffix=""):
            spec, prog = j.get("spec", {}), j.get("progress", {})
            return f"{short_stack(prog.get('combination') or spec.get('install_id', ''))} {spec.get('run_id', '')}{suffix}"
        ahead = [label(j, " (running)") for j in running]
        for j in queued:
            out[j["id"]] = {"position": len(ahead) + 1, "ahead": list(ahead)}
            ahead.append(label(j))
    return out


def live_from_job(job: dict) -> dict:
    """The live numbers of a job's running story: dbench lists every story of the run, so pick the one
    that is running (or the current one), never simply the last."""
    prog = job.get("progress") or {}
    cur = prog.get("current_story")
    stories = prog.get("stories") or []
    story = next((st for st in stories if st.get("status") == "running"), None) or \
        next((st for st in stories if cur is not None and str(st.get("id")) == str(cur)), None) or {}
    tasks = story.get("tasks") or []
    activity = story.get("recent_activity") or []
    return {"job_id": job.get("id"), "status": (job.get("state") or {}).get("status"),
            "attempt": (job.get("state") or {}).get("attempt"), "current_story": cur,
            "agent_minutes": story.get("agent_minutes"), "calls": story.get("calls"),
            "output_tokens": story.get("output_tokens"),
            "tasks_written": sum(1 for t in tasks if t.get("status") not in (None, "not-started")) if tasks else None,
            "tasks_total": len(tasks) or None,
            "last_activity": activity[-1] if activity else None,
            "last_task_change_at": story.get("last_task_change_at"),
            "log_tail": (prog.get("log_tail") or [])[-3:]}


def merge(runs: list[dict], jobs: dict[tuple, dict], now: float | None = None) -> list[dict]:
    """One row per run record, plus one per dbench job that has no record yet: queued and running jobs
    always, finished, failed or cancelled ones for RECENT_S."""
    now = time.time() if now is None else now
    rows, seen = [], set()
    for r in runs:
        key = (r["stack"], r["pack"], r["run_id"])
        seen.add(key)
        job = jobs.get(key)
        rows.append({**r, "job": job, "node": job["node"] if job else None})
    for key, job in jobs.items():
        status = job.get("state", {}).get("status")
        if key not in seen and (status in ("queued", "running") or now - job.get("updated_at", 0) < RECENT_S):
            stack, pack, run_id = key
            rows.append({"pack": pack, "stack": stack, "run_id": run_id, "dir": None, "rescores": [],
                         "has_bundle": False, "job": job, "node": job["node"], "stories": [], "scores": {},
                         "state": "", "pack_version": "", "state_at": ""})
    return rows


# ---------- reading the repo and dbench ----------

def git(repo: Path, *args: str, check: bool = True) -> str:
    r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True, timeout=GIT_TIMEOUT_S)
    if check and r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or f"git {' '.join(args)} failed")
    return r.stdout


def read_blobs(repo: Path, paths: list[str]) -> dict[str, str]:
    """Many files from origin/main in one `git cat-file --batch`."""
    if not paths:
        return {}
    spec = "".join(f"{REF}:{p}\n" for p in paths)
    r = subprocess.run(["git", "-C", str(repo), "cat-file", "--batch"], input=spec.encode(),
                       capture_output=True, timeout=GIT_TIMEOUT_S)
    out, data, pos = {}, r.stdout, 0
    for p in paths:
        nl = data.index(b"\n", pos)
        header = data[pos:nl].decode()
        pos = nl + 1
        if header.endswith("missing"):
            continue
        size = int(header.split()[-1])
        out[p] = data[pos:pos + size].decode("utf-8", "replace")
        pos += size + 1
    return out


def _json(text: str | None):
    try:
        return json.loads(text) if text else None
    except ValueError:
        return None


def load_runs(repo: Path) -> tuple[list[dict], dict[str, str]]:
    paths = git(repo, "ls-tree", "-r", "--name-only", REF, "--", *RUN_ROOTS).splitlines()
    runs = find_runs(paths)
    wanted = []
    for r in runs:
        d = r["dir"]
        wanted += [f"{d}/run.json", f"{d}/run-status.json", f"{d}/metrics.json"]
        wanted += [f"{d}/rescore/{v}/rescore.json" for v in r["rescores"]]
    packs = sorted({r["pack"] for r in runs})
    wanted += [f"benchmarks/{p}/bench.json" for p in packs]
    blobs = read_blobs(repo, wanted)
    suites = {p: (_json(blobs.get(f"benchmarks/{p}/bench.json")) or {}).get("pack_ref", "") for p in packs}
    for r in runs:
        d = r["dir"]
        meta = _json(blobs.get(f"{d}/run.json")) or {}
        status = _json(blobs.get(f"{d}/run-status.json")) or {}
        metrics = _json(blobs.get(f"{d}/metrics.json")) or {}
        stories = metrics.get("stories") or {}
        # metrics.json keys stories by id ("1", "2", …); older records list them in order
        pairs = (sorted(stories.items(), key=lambda kv: int(kv[0]) if str(kv[0]).isdigit() else 0)
                 if isinstance(stories, dict) else [(i + 1, st) for i, st in enumerate(stories)])
        r.update({
            "pack_version": meta.get("pack_version", ""), "started_at": meta.get("started_at", ""),
            "model_id": meta.get("model_id", ""), "client": meta.get("client", ""),
            "state": status.get("state", ""), "state_at": status.get("at", ""), "state_reason": status.get("reason", ""),
            "stories": [{"id": sid, "title": st.get("title", ""), "status": st.get("status", ""),
                         "passed": (st.get("accept") or {}).get("passed"), "total": (st.get("accept") or {}).get("total")}
                        for sid, st in pairs],
            "scores": {},
        })
        for v in r["rescores"]:
            rs = _json(blobs.get(f"{d}/rescore/{v}/rescore.json")) or {}
            res = rs.get("results") or []
            if res:
                last = res[-1]
                r["scores"][v] = {"passed": last.get("passed"), "total": last.get("total"),
                                  "flaky": sum(x.get("flaky", 0) or 0 for x in res), "at": rs.get("finished_at", "")}
    return runs, suites


def load_jobs() -> dict[str, list[dict]]:
    if not shutil.which("dbench"):
        raise RuntimeError("dbench not on PATH: showing the repo only")
    r = subprocess.run(["dbench", "status", "--json"], capture_output=True, text=True, timeout=DBENCH_TIMEOUT_S)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "dbench status failed")
    data = json.loads(r.stdout)
    return {n: j for n, j in data.items() if isinstance(j, list)}


# ---------- the live state ----------

class State:
    def __init__(self, repo: Path, judge_url: str):
        self.repo, self.judge_url = repo, judge_url
        self.lock = threading.Lock()
        self.runs: list[dict] = []
        self.suites: dict[str, str] = {}
        self.jobs: dict[str, list[dict]] = {}
        self.fetched_at = self.dbench_at = 0.0
        self.fetch_error = self.dbench_error = ""
        remote = git(repo, "remote", "get-url", "origin", check=False).strip()
        self.web = web_base(remote)

    def refresh_repo(self):
        try:
            git(self.repo, "fetch", "-q", "origin", BRANCH)
            runs, suites = load_runs(self.repo)
            with self.lock:
                self.runs, self.suites, self.fetch_error = runs, suites, ""
                self.fetched_at = time.time()
        except Exception as e:
            with self.lock:
                self.fetch_error = f"{type(e).__name__}: {e}"

    def refresh_dbench(self):
        try:
            jobs = load_jobs()
            with self.lock:
                self.jobs, self.dbench_error, self.dbench_at = jobs, "", time.time()
        except Exception as e:
            with self.lock:
                self.dbench_error = f"{type(e).__name__}: {e}"

    def snapshot(self) -> dict:
        with self.lock:
            rows = merge(self.runs, index_jobs(self.jobs))
            queue = queue_positions(self.jobs)
            for row in rows:
                suite = self.suites.get(row["pack"], "")
                row["suite"] = suite
                row["family"] = row_family(row, suite)
                row["stages"] = stages(row, row["job"], suite)
                job = row.pop("job")
                row["live"] = live_from_job(job) if job else None
                if row["live"] and row["live"]["job_id"] in queue:
                    row["live"]["queue"] = queue[row["live"]["job_id"]]
            return {"now": time.time(), "fetched_at": self.fetched_at, "fetch_error": self.fetch_error,
                    "dbench_at": self.dbench_at, "dbench_error": self.dbench_error,
                    "suites": self.suites, "web": self.web, "judge_url": self.judge_url, "branch": BRANCH,
                    "rows": rows}


def loop(every: float, fn):
    while True:
        fn()
        time.sleep(every)


def serve(state: State, port: int):
    page = (HERE / "page.html").read_bytes()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            if self.path in ("/", "/index.html"):
                body, ctype = page, "text/html; charset=utf-8"
            elif self.path == "/api/state":
                body, ctype = json.dumps(state.snapshot()).encode(), "application/json"
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"benchmarker: http://127.0.0.1:{port}  (repo {state.repo}, fetch every {FETCH_EVERY_S}s, "
          f"dbench every {DBENCH_EVERY_S}s)", flush=True)
    httpd.serve_forever()


def main() -> int:
    ap = argparse.ArgumentParser(description="Live status of benchmark runs: build, score, judge.")
    ap.add_argument("--repo", type=Path, default=DEFAULT_REPO, help="a clone of awesome-local-ai (default: this one)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--judge-url", default=DEFAULT_JUDGE_URL, help="the review page (tools/vidi-gallery)")
    a = ap.parse_args()
    state = State(a.repo.resolve(), a.judge_url)
    state.refresh_repo()
    state.refresh_dbench()
    threading.Thread(target=loop, args=(FETCH_EVERY_S, state.refresh_repo), daemon=True).start()
    threading.Thread(target=loop, args=(DBENCH_EVERY_S, state.refresh_dbench), daemon=True).start()
    serve(state, a.port)
    return 0


if __name__ == "__main__":
    sys.exit(main())
