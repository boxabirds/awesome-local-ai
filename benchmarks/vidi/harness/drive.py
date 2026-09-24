# /// script
# requires-python = ">=3.11"
# ///
"""Drive a coding agent (OpenCode) through a Vidi scope, one story per fresh session.

Expects a model server behind the metering proxy (run.sh starts both). For each
story: render the prompt, run `opencode run` in the workspace with an isolated
HOME/config, watch for loops, then run the agent's own gate and the held-out
acceptance suite, snapshot the workspace in git, and checkpoint metrics.json.

    uv run drive.py --run-dir <dir> --base-url http://127.0.0.1:18010/v1 --model-id <id> \
        [--client pi|opencode] [--scope canvas] [--context-limit 131072] [--output-limit 32768] \
        [--server-log ~/.mtplx/logs/request-log-18010.jsonl]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import time
import re
import threading
from urllib.parse import urlparse
from collections import deque
from pathlib import Path

import gates
import hostenv
from hostenv import IS_MAC, THERMAL_OK, mem_free_pct
from clients import CLIENTS, empty_state

HARNESS = Path(__file__).resolve().parent
VIDI = HARNESS.parent
REPO_ROOT = VIDI.parent.parent
# Agents work OUTSIDE the repo: inside it, the harness and the held-out suite are a `cd ..` away.
WORK_ROOT = Path(os.environ.get("VIDI_WORK_ROOT", Path.home() / ".vidi-bench" / "work")).resolve()
# Nothing the agent runs may read these: the harness + held-out suite, the user's own agent
# config/skills/sessions, and other runs' work directories (WORK_ROOT minus the agent's own).
SANDBOX_DENY = [REPO_ROOT, *(Path.home() / p for p in
                (".claude", ".agents", ".codex", ".config/opencode", ".local/share/opencode", ".mtplx",
                 ".dbench/token", ".dbench/jobs"))]
CONTEXT_BANDS = [(0, 16_000), (16_000, 32_000), (32_000, 64_000), (64_000, 100_000), (100_000, 10**9)]
CONDITION_POLL_S = 30        # how often run conditions are sampled during a story / while waiting
# The mirror is committed into the outer repo: no nested .git (it would become a
# broken gitlink), no copy of the spec (it lives in benchmarks/vidi/spec), no build output.
MIRROR_EXCLUDES = [".git", "spec", "node_modules", "dist", ".wrangler", "test-results", "playwright-report"]
# Per-token stream deltas are ~99% of an agent event log and carry nothing the report uses.
STREAM_DELTA_EVENTS = {"message_update", "tool_execution_update"}
# tests/privacy-test.sh: committed benchmark files stay under 512 KB and carry no home paths.
PUBLISH_MAX_BYTES = 512 * 1024
# Whole file bodies the agent read or wrote are kept as a marked prefix; the record keeps the
# conversation's shape, tool calls and timings, not every byte of every file.
EVENT_STRING_MAX = 2000
# Git-ignored bookkeeping read by local tools; must keep real absolute paths.
LOCAL_ONLY_FILES = {"work_dir.txt", "current_story"}
TEXT_SUFFIXES = {".json", ".jsonl", ".md", ".txt", ".log", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".jsonc", ".sh"}
SPEC = VIDI / "spec"
PROMPT_TMPL = VIDI / "prompts" / "story.md.tmpl"
LOOP_REPEAT_LIMIT = 8        # identical consecutive tool calls that mark a story as stalled
KILL_GRACE_S = 10
# If OpenCode dies on an error (server stall, 409, dropped stream) the same session is resumed,
# as a person at the keyboard would. Same rule for every arm; every resume is recorded.
MAX_AGENT_RESUMES = 3
RESUME_BACKOFF_S = 60
RESUME_PROMPT = "Continue with the task from where you left off."
# A reasoning model can end a turn with thinking only and no tool call; the agent then exits 0 as
# if finished (canvas-pi-01 story 2: 3 minutes, one task in). If a session ends with no commit, the
# harness continues the same session with RESUME_PROMPT, as a person would. Counted as nudges.
# No cap (user decision, 24 Sep): the only stop is a nudge that makes no model call at all.
# pi's bash tool has no default timeout. An agent that backgrounds a server inside a tool call
# (`(wrangler dev &)`) leaves children holding the tool's output pipe and the call never returns.
# After this long with the last event a tool call and nothing streamed, the harness does what a
# person would: Ctrl-C the processes under the workspace. The agent then sees the tool end.
TOOL_HANG_S = 10 * 60
TOOL_HANG_POLL_S = 30
TOOL_EVENT_TYPES = {"tool_execution_start", "tool_execution_update", "tool_use"}
EVENT_TAIL_BYTES = 64 * 1024
GIT_IDENTITY = {"GIT_AUTHOR_NAME": "vidi-agent", "GIT_AUTHOR_EMAIL": "agent@vidi.invalid",
                "GIT_COMMITTER_NAME": "vidi-agent", "GIT_COMMITTER_EMAIL": "agent@vidi.invalid"}


def sh(cmd: list[str], cwd: Path, env: dict | None = None, check: bool = True) -> str:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, env={**os.environ, **(env or {})})
    if check and p.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)} failed: {p.stderr}")
    return p.stdout


def tree_hash(root: Path) -> str:
    h = hashlib.sha256()
    for f in sorted(root.rglob("*")):
        if f.is_file():
            h.update(str(f.relative_to(root)).encode())
            h.update(f.read_bytes())
    return h.hexdigest()


def _sb_quote(p: Path) -> str:
    return '"' + str(p.resolve()).replace('\\', '\\\\').replace('"', '\\"') + '"'


def sandboxed(cmd: list[str], own_dir: Path) -> list[str]:
    """Wrap cmd in a sandbox that hides everything in SANDBOX_DENY except own_dir.

    macOS: sandbox-exec; SBPL applies the last matching rule, so the final allow re-opens
    own_dir even though it sits under WORK_ROOT. Linux: bubblewrap (see hostenv.bwrap_wrap).
    """
    if not IS_MAC:
        return hostenv.bwrap_wrap(cmd, own_dir, [*SANDBOX_DENY, WORK_ROOT])
    deny = " ".join(f"(subpath {_sb_quote(p)})" for p in [*SANDBOX_DENY, WORK_ROOT])
    # Tools resolve real paths by lstat()ing every ancestor of a path (node's realpath, the
    # wrangler watcher). Allow metadata only -- stat, not reading or listing -- on the
    # ancestors of own_dir, so path resolution works while siblings stay hidden.
    ancestors = " ".join(f"(literal {_sb_quote(a)})" for a in own_dir.resolve().parents)
    profile = (f"(version 1)(allow default)"
               f"(deny file-read* file-write* {deny})"
               f"(allow file-read-metadata {ancestors})"
               f"(allow file-read* file-write* (subpath {_sb_quote(own_dir)}))")
    return ["sandbox-exec", "-p", profile, *cmd]


def combination_label(run: Path) -> str:
    """e.g. qwen/3.8/flash-next/macos/128GB/mtplx-opencode for a run under that combination."""
    try:
        rel = run.resolve().relative_to(REPO_ROOT / "combinations")
        return "/".join(rel.parts[:-3])  # drop benchmarks/vidi/<run-id>
    except ValueError:
        return run.name


def work_dir_for(run: Path) -> Path:
    """Stable per-run work directory outside the repo, named after the run's place in it."""
    try:
        rel = run.resolve().relative_to(REPO_ROOT / "combinations")
    except ValueError:
        rel = Path(run.resolve().name)
    return WORK_ROOT / "__".join(rel.parts)


def mirror(ws: Path, dest: Path) -> None:
    """Copy the workspace source into the results folder; the agent's git history goes alongside as text."""
    dest.mkdir(parents=True, exist_ok=True)
    excludes = [f"--exclude=/{e}" for e in MIRROR_EXCLUDES]
    subprocess.run(["rsync", "-a", "--delete", *excludes, f"{ws}/", f"{dest}/"], check=True)
    log = subprocess.run(["git", "log", "--stat", "--format=commit %H%n%an  %ad%n%n    %s%n"], cwd=ws,
                         capture_output=True, text=True).stdout
    (dest.parent / "workspace-git-log.txt").write_text(log)


# If a compacted log is still over PUBLISH_MAX_BYTES, strings are cut further, in these steps;
# every event is kept, only long strings get shorter.
EVENT_STRING_STEPS = (EVENT_STRING_MAX, 500, 200, 80)


def _truncate(v, limit: int = EVENT_STRING_MAX):
    if isinstance(v, str) and len(v) > limit:
        return v[:limit] + f"…[truncated {len(v) - limit} chars]"
    if isinstance(v, dict):
        return {k: _truncate(x, limit) for k, x in v.items()}
    if isinstance(v, list):
        return [_truncate(x, limit) for x in v]
    return v


def _redact(text: str) -> str:
    return text.replace(str(Path.home()), "~")


def compact_events(raw: Path) -> Path:
    """Gzip the agent event log without stream deltas, long strings truncated, home redacted."""
    import gzip
    out = raw.with_name(raw.stem + ".compact.jsonl.gz")
    with raw.open() as src, gzip.open(out, "wt") as dst:
        for line in src:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(e, dict) and e.get("type") not in STREAM_DELTA_EVENTS:
                dst.write(_redact(json.dumps(_truncate(e))) + "\n")
    return out


def make_publishable(run: Path) -> list[str]:
    """Make a run dir safe to commit: redact home paths everywhere, compact any raw event log that
    is not git-ignored, and recompact oversized compact logs. Returns files still over the limit."""
    import gzip
    for raw in run.rglob("agent-events.jsonl"):
        if raw.parent.parent.name != "stories":        # stories/*/agent-events.jsonl is git-ignored
            compact_events(raw)
            raw.unlink()
    for f in run.rglob("*"):
        if not f.is_file() or ".git" in f.parts or "node_modules" in f.parts:
            continue
        if f.name in LOCAL_ONLY_FILES:          # git-ignored, machine-local: keep real paths
            continue
        if f.name.endswith(".compact.jsonl.gz"):
            with gzip.open(f, "rt") as src:
                events = [json.loads(l) for l in src if l.strip()]
            for limit in EVENT_STRING_STEPS:
                with gzip.open(f, "wt") as dst:
                    dst.write("\n".join(_redact(json.dumps(_truncate(e, limit))) for e in events) + "\n")
                if f.stat().st_size <= PUBLISH_MAX_BYTES:
                    break
        elif f.suffix in TEXT_SUFFIXES:
            try:
                t = f.read_text()
            except UnicodeDecodeError:
                continue
            if str(Path.home()) in t:
                f.write_text(_redact(t))
    return [str(f) for f in run.rglob("*") if f.is_file() and ".git" not in f.parts and "node_modules" not in f.parts
            and not (f.name == "agent-events.jsonl" and f.parent.parent.name == "stories")
            and f.stat().st_size > PUBLISH_MAX_BYTES]


RUN_GITIGNORE = """# Written by benchmarks/vidi/harness/drive.py. Raw agent logs are kept compacted
# (agent-events.compact.jsonl.gz); machine-local bookkeeping stays out of git.
stories/*/agent-events.jsonl
current_story
work_dir.txt
"""
COMMIT_TRAILER = "\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"


def record_story(repo_root: Path, run: Path, message: str, git: list[str] | None = None) -> dict:
    """Commit exactly this run's directory and push, so every story leaves a durable record.

    Only the run dir is staged: anything else uncommitted in the repo is left alone.
    A failed push is reported, never fatal: the benchmark carries on."""
    git = git or ["git"]
    (run / ".gitignore").write_text(RUN_GITIGNORE)
    too_big = make_publishable(run)
    rel = str(run.resolve().relative_to(repo_root.resolve()))
    out: dict = {"committed": False, "pushed": False, "over_size_limit": too_big}
    add = subprocess.run([*git, "add", "--", rel], cwd=repo_root, capture_output=True, text=True)
    if add.returncode != 0:
        return {**out, "error": add.stderr[-500:]}
    commit = subprocess.run([*git, "commit", "-q", "-m", message + COMMIT_TRAILER, "--", rel],
                            cwd=repo_root, capture_output=True, text=True)
    if commit.returncode != 0:
        return {**out, "error": (commit.stdout + commit.stderr)[-500:]}
    out["committed"] = True
    out["commit"] = subprocess.run([*git, "rev-parse", "--short", "HEAD"], cwd=repo_root,
                                   capture_output=True, text=True).stdout.strip()
    push = subprocess.run([*git, "push", "-q", "origin", "HEAD"], cwd=repo_root, capture_output=True, text=True)
    if push.returncode != 0:
        # The remote moved during a long run: replay our commit on top, keeping any
        # uncommitted work in the repo exactly as it was, then try once more.
        branch = subprocess.run([*git, "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root,
                                capture_output=True, text=True).stdout.strip()
        subprocess.run([*git, "pull", "-q", "--rebase", "--autostash", "origin", branch],
                       cwd=repo_root, capture_output=True, text=True)
        push = subprocess.run([*git, "push", "-q", "origin", "HEAD"], cwd=repo_root, capture_output=True, text=True)
    out["pushed"] = push.returncode == 0
    if not out["pushed"]:
        out["error"] = push.stderr[-500:]
    return out


def load_metrics(run: Path) -> dict:
    p = run / "metrics.json"
    return json.loads(p.read_text()) if p.exists() else {"stories": {}}


def save_metrics(run: Path, m: dict) -> None:
    (run / "metrics.json").write_text(json.dumps(m, indent=2))


def setup_workspace(ws: Path) -> None:
    """Fresh repo containing only README.md (as story 1's design assumes) plus the read-only spec."""
    if (ws / ".git").exists():
        return
    ws.mkdir(parents=True)
    (ws / "README.md").write_text("# vidi6\n\nA shared board for thinking together.\n")
    shutil.copytree(SPEC, ws / "spec")
    # Files read-only as a hint; directories stay writable so runs can be mirrored and
    # deleted. Real protection is the hash check + restore after every story.
    for f in (ws / "spec").rglob("*"):
        if f.is_file():
            f.chmod(0o444)
    sh(["git", "init", "-q", "-b", "main"], ws)
    sh(["git", "add", "-A"], ws)
    sh(["git", "commit", "-qm", "harness: empty repository with spec"], ws, GIT_IDENTITY)


def agent_env(work: Path) -> dict:
    """Isolated HOME + XDG so the user's own config, skills and plugins never reach the agent."""
    home = work / "agent-home"
    home.mkdir(parents=True, exist_ok=True)
    real_home = Path.home()
    return {
        "HOME": str(home),
        # Node tools (OpenCode, pi) trust $PWD; an inherited one points into the denied repo.
        "PWD": str(work / "workspace"),
        "OLDPWD": str(work / "workspace"),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local" / "share"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_STATE_HOME": str(home / ".local" / "state"),
        # Shared caches only: identical for every run and they hold no instructions.
        "npm_config_cache": str(real_home / ".npm"),
        "PLAYWRIGHT_BROWSERS_PATH": str(hostenv.playwright_cache(real_home)),
        "WRANGLER_SEND_METRICS": "false",
        **GIT_IDENTITY,
    }


def render_prompt(story: dict, title: str, done: list[int], scope: dict) -> str:
    story_dir = f"spec/stories/{story['dir']}"
    return (PROMPT_TMPL.read_text()
            .replace("{{ID}}", str(story["id"]))
            .replace("{{TITLE}}", title)
            .replace("{{SPEC_DIR}}", "spec/")
            .replace("{{STORY_DIR}}", story_dir)
            .replace("{{DONE}}", ", ".join(map(str, done)) if done else "none (empty repository)")
            .replace("{{SCOPE_NOTE}}", scope.get("out_of_scope_note", "")))


def story_title(story: dict) -> str:
    first = (SPEC / "stories" / story["dir"] / "story.md").read_text().splitlines()[0]
    return first.lstrip("# ").strip()


class LoopDetector:
    """Flags an agent that repeats the identical tool call LOOP_REPEAT_LIMIT times in a row."""

    def __init__(self, limit: int = LOOP_REPEAT_LIMIT):
        self.recent: deque[str] = deque(maxlen=limit)

    def tool_call(self, tool: str | None, tool_input: object) -> bool:
        return self.key(json.dumps([tool, tool_input], sort_keys=True))

    def key(self, k: str) -> bool:
        self.recent.append(k)
        return len(self.recent) == self.recent.maxlen and len(set(self.recent)) == 1


def _last_event_type(events: Path) -> str | None:
    with events.open("rb") as f:
        f.seek(0, os.SEEK_END)
        f.seek(max(0, f.tell() - EVENT_TAIL_BYTES))
        for line in reversed(f.read().decode(errors="replace").splitlines()):
            try:
                return json.loads(line).get("type")
            except (json.JSONDecodeError, AttributeError):
                continue
    return None


def tool_hang_check(events: Path, ws: Path, idle_s: float = TOOL_HANG_S) -> bool:
    """Interrupt a tool call that has been silent for idle_s; True if it did.

    Kills only processes whose command line contains the workspace path. The agent
    itself (pi retitles its process to "pi") and anything outside the workspace survive."""
    if not events.exists() or time.time() - events.stat().st_mtime < idle_s:
        return False
    if _last_event_type(events) not in TOOL_EVENT_TYPES:
        return False
    kill_pids(workspace_pids(ws, spare_agent=True))
    return True


class ToolHangGuard(threading.Thread):
    def __init__(self, events: Path, ws: Path, log: Path):
        super().__init__(daemon=True)
        self.events, self.ws, self.log = events, ws, log
        self.interruptions = 0
        self._halt = threading.Event()

    def run(self):
        while not self._halt.wait(TOOL_HANG_POLL_S):
            if tool_hang_check(self.events, self.ws):
                self.interruptions += 1
                with self.log.open("a") as f:
                    f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {self.events.parent.name}: "
                            f"interrupted a tool call silent for {TOOL_HANG_S}s (killed processes under the workspace)\n")
                print(f"    tool call silent {TOOL_HANG_S // 60} min — interrupted (Ctrl-C equivalent)", flush=True)

    def stop(self) -> int:
        self._halt.set()
        self.join()
        return self.interruptions


def needs_nudge(attempt: dict, commits: int) -> bool:
    """The agent quit cleanly without committing anything: continue it rather than accept an early stop."""
    return commits == 0 and not attempt["stalled"] and not attempt["error"] and bool(attempt["session"])


def keep_nudging(attempt: dict, commits: int, nudges: int) -> bool:
    """Nudge again unless the agent committed, or the previous nudge made no progress (zero model calls)."""
    if nudges > 0 and attempt.get("steps", 0) == 0:
        return False
    return needs_nudge(attempt, commits)


def commits_since(ws: Path, head: str) -> int:
    return int(sh(["git", "rev-list", "--count", f"{head}..HEAD"], ws).strip())


def run_agent(client, ws: Path, env: dict, model_id: str, prompt: str, events_path: Path,
              resume_from: str | None = None, fork: bool = True) -> dict:
    """Run (or resume) one sandboxed agent session; returns counts, session id, error and loop flag."""
    cmd = sandboxed(client.command(model_id, prompt, resume_from, fork=fork), own_dir=ws.parent)
    t0 = time.monotonic()
    proc = subprocess.Popen(cmd, cwd=ws, env={**os.environ, **env, **client.env()}, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    loops = LoopDetector()
    st = empty_state()
    stalled = False
    with events_path.open("a") as ev:
        for line in proc.stdout:  # type: ignore[union-attr]
            ev.write(line)
            ev.flush()
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            key = client.scan(e, st)
            if key is not None and loops.key(key):
                stalled = True
                os.killpg(proc.pid, signal.SIGTERM)
                break
    try:
        proc.wait(timeout=KILL_GRACE_S if stalled else None)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    if proc.returncode not in (0, None) and not st["error"] and not stalled:
        st["error"] = f"agent exited with status {proc.returncode}"
    return {"exit": proc.returncode, "seconds": round(time.monotonic() - t0, 1), "stalled": stalled, **st}


def last_session(client, events_path: Path) -> str | None:
    """The most recent agent session id in a story's event log (None if there is none)."""
    if not events_path.exists():
        return None
    sid = None
    for line in events_path.open():
        try:
            e = json.loads(line)
        except json.JSONDecodeError:
            continue
        st = empty_state()
        client.scan(e, st)
        sid = st["session"] or sid
    return sid


def run_story_agent(client, ws: Path, env: dict, model_id: str, prompt: str, events_path: Path,
                    continue_session: str | None = None) -> dict:
    """First attempt plus fork-resumes after errors and nudges after no-commit stops. With
    continue_session (a harness restart mid-story), the agent's own session is continued."""
    if not continue_session:
        events_path.unlink(missing_ok=True)
    guard = ToolHangGuard(events_path, ws, events_path.parent.parent.parent / "interventions.md")
    guard.start()
    head = sh(["git", "rev-parse", "HEAD"], ws).strip()
    if continue_session:
        attempts = [run_agent(client, ws, env, model_id, RESUME_PROMPT, events_path,
                              resume_from=continue_session, fork=False)]
    else:
        attempts = [run_agent(client, ws, env, model_id, prompt, events_path)]
    resumes = nudges = 0
    while not RUN_ABORT.is_set():
        last = attempts[-1]
        if last["error"] and not last["stalled"] and last["session"] and resumes < MAX_AGENT_RESUMES:
            resumes += 1
            print(f"    agent error: {last['error'][:160]} — fork-resuming session in {RESUME_BACKOFF_S}s", flush=True)
            time.sleep(RESUME_BACKOFF_S)
            attempts.append(run_agent(client, ws, env, model_id, RESUME_PROMPT, events_path,
                                      resume_from=last["session"], fork=True))
        elif keep_nudging(last, commits_since(ws, head), nudges):
            nudges += 1
            print(f"    agent stopped without committing — nudge {nudges}: continuing the session", flush=True)
            attempts.append(run_agent(client, ws, env, model_id, RESUME_PROMPT, events_path,
                                      resume_from=last["session"], fork=False))
        else:
            break
    interruptions = guard.stop()
    total = {k: sum(a[k] for a in attempts) for k in ("seconds", "steps", "tool_calls", "compactions")}
    total["tool_interruptions"] = interruptions
    total["tokens"] = {k: sum(a["tokens"][k] for a in attempts) for k in attempts[0]["tokens"]}
    return {**total, "exit": attempts[-1]["exit"], "stalled": attempts[-1]["stalled"],
            "resumes": resumes, "nudges": nudges, "errors": [a["error"] for a in attempts if a["error"]],
            "ended_in_error": bool(attempts[-1]["error"]), "sessions": [a["session"] for a in attempts]}


# Processes that ARE the agent (or its sandbox wrapper): never killed while a story runs.
AGENT_PROC_MARKERS = ("pi-coding-agent", "sandbox-exec", "opencode")


def workspace_pids(ws: Path, spare_agent: bool = False) -> set[int]:
    """Processes running in the workspace: its path in their command line OR their working directory
    inside it. Agents start servers with relative paths (`node node_modules/vite/bin/vite.js preview`),
    so the command line alone misses them."""
    root = str(ws.resolve())
    pids = {int(x) for x in subprocess.run(["pgrep", "-f", root], capture_output=True, text=True).stdout.split()}
    out = subprocess.run(["lsof", "-d", "cwd", "-Fpn"], capture_output=True, text=True).stdout
    pid = None
    for line in out.splitlines():
        if line.startswith("p"):
            pid = int(line[1:])
        elif line.startswith("n") and pid and (line[1:] == root or line[1:].startswith(root + "/")):
            pids.add(pid)
    pids.discard(os.getpid())
    if spare_agent:
        def is_agent(p: int) -> bool:
            cmd = subprocess.run(["ps", "-o", "command=", "-p", str(p)], capture_output=True, text=True).stdout.strip()
            return cmd == "pi" or cmd.startswith("pi ") or any(m in cmd for m in AGENT_PROC_MARKERS)
        pids = {p for p in pids if not is_agent(p)}
    return pids


def kill_pids(pids: set[int]) -> None:
    for p in pids:
        try:
            os.kill(p, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass


def kill_strays(ws: Path) -> None:
    """Dev servers or test runners the agent left running would skew the gates and the next story."""
    kill_pids(workspace_pids(ws))


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def server_stats(server_log: Path | None, t_start: float, t_end: float) -> dict:
    """Per-story numbers from the server's own request log (MTPLX), by time window.

    Measured by the server, not by a proxy in the request path. Backends that keep
    no such log get only the client-reported token counts in rec["agent"]."""
    if not server_log or not server_log.exists():
        return {}
    recs = []
    for line in server_log.read_text().splitlines():
        try:
            r = json.loads(line)
        except json.JSONDecodeError:
            continue
        if t_start <= (r.get("logged_at_s") or 0) <= t_end:
            recs.append(r)
    bands = {}
    for lo, hi in CONTEXT_BANDS:
        in_band = [r for r in recs if lo <= (r.get("context_len") or 0) < hi]
        if in_band:
            bands[f"{lo // 1000}-{hi // 1000 if hi < 10**9 else '+'}k"] = {
                "requests": len(in_band), "decode_tok_s_median": _median(r.get("decode_tok_s") for r in in_band)}
    return {
        "requests": len(recs),
        "prompt_tokens": sum(r.get("prompt_tokens") or 0 for r in recs),
        "completion_tokens": sum(r.get("completion_tokens") or 0 for r in recs),
        "cached_tokens": sum(r.get("cached_tokens") or 0 for r in recs),
        "ttft_median_s": _median(r.get("ttft_s") for r in recs),
        "prefill_tok_s_median": _median(r.get("prefill_tok_s") for r in recs),
        "decode_tok_s_median": _median(r.get("decode_tok_s") for r in recs),
        "max_context": max((r.get("context_len") or 0 for r in recs), default=0),
        "decode_by_context": bands,
    }


def loc(ws: Path) -> dict:
    out = sh(["git", "ls-files", "src", "tests"], ws, check=False).split()
    lines = sum(len((ws / f).read_text(errors="replace").splitlines()) for f in out if (ws / f).is_file())
    return {"files": len(out), "lines": lines}


def parse_power(pmset_batt: str, pmset_g: str) -> dict:
    """AC vs battery from `pmset -g batt`; Low Power Mode from `pmset -g` (lowpowermode or powermode ≠ 0)."""
    modes = [int(m) for m in re.findall(r"^\s*(?:lowpowermode|powermode)\s+(\d+)", pmset_g, re.M)]
    return {"ac": "'AC Power'" in pmset_batt, "low_power": any(modes)}


def conditions() -> dict:
    if not IS_MAC:
        return {**hostenv.linux_power(), "thermal": hostenv.linux_thermal()}
    batt = subprocess.run(["pmset", "-g", "batt"], capture_output=True, text=True).stdout
    g = subprocess.run(["pmset", "-g"], capture_output=True, text=True).stdout
    return {**parse_power(batt, g), "thermal": thermal()}


def conditions_ok(c: dict) -> bool:
    return c["ac"] and not c["low_power"] and c["thermal"] in THERMAL_OK


def wait_for_conditions() -> dict:
    """Pause (never skip) until the machine is fit to measure: AC power, no Low Power Mode, nominal thermals."""
    announced = False
    while not conditions_ok(c := conditions()):
        if not announced:
            print(f"  waiting for AC power, no Low Power Mode, nominal thermals: now {c}", flush=True)
            announced = True
        time.sleep(CONDITION_POLL_S)
    return c


# 24 Sep: a leaking process pushed the Mac into swap while MTPLX held ~90 GB of GPU memory, and
# the machine kernel-panicked (watchdog timeout). If swap grows this much during a story, the
# harness stops the agent and the run before memory pressure can take the machine down.
SWAP_ABORT_GROWTH_GB = 4.0
# Free memory below this share stops the run the same way (was an external watchdog loop).
MEM_FREE_ABORT_PCT = 8
MIB_PER_GIB = 1024


def parse_swap_gb(sysctl_swapusage: str) -> float:
    m = re.search(r"used = ([\d.]+)M", sysctl_swapusage)
    return float(m.group(1)) / MIB_PER_GIB if m else 0.0


FOOTPRINT_UNITS = {"KB": 1 / 1024 ** 2, "MB": 1 / 1024, "GB": 1.0, "TB": 1024.0}


def parse_footprint_gb(footprint_out: str) -> tuple[float | None, float | None]:
    """(phys_footprint, phys_footprint_peak) in GB from macOS `footprint -p <pid>` output."""
    def grab(key):
        m = re.search(rf"^\s*{key}:\s*([\d.]+)\s*(KB|MB|GB|TB)", footprint_out, re.M)
        return float(m.group(1)) * FOOTPRINT_UNITS[m.group(2)] if m else None
    return grab("phys_footprint"), grab("phys_footprint_peak")


def server_pid(port: int) -> int | None:
    """The process listening on the model server's port, whatever the backend."""
    out = subprocess.run(["lsof", "-nP", "-t", f"-iTCP:{port}", "-sTCP:LISTEN"], capture_output=True, text=True).stdout.split()
    return int(out[0]) if out else None


def server_footprint_gb(port: int | None) -> tuple[float | None, float | None]:
    pid = server_pid(port) if port else None
    if not pid:
        return None, None
    if not IS_MAC:
        return hostenv.linux_process_gb(pid)
    return parse_footprint_gb(subprocess.run(["footprint", "-p", str(pid)], capture_output=True, text=True).stdout)


def swap_used_gb() -> float:
    if not IS_MAC:
        return hostenv.linux_swap_used_gb()
    return parse_swap_gb(subprocess.run(["sysctl", "-n", "vm.swapusage"], capture_output=True, text=True).stdout)


# Set by the swap guard; the resume/nudge loop must not restart an agent the guard just stopped.
RUN_ABORT = threading.Event()


class ConditionSampler(threading.Thread):
    """Samples run conditions while a story runs; any bad sample marks the story as degraded.
    Swap growth past SWAP_ABORT_GROWTH_GB kills the agent's processes and sets `aborted`."""

    def __init__(self, ws: Path | None = None, server_port: int | None = None):
        super().__init__(daemon=True)
        self.server_port = server_port
        self.footprint_max = None
        self.footprint_peak = None
        self.bad: list[dict] = []
        self.samples = 0
        self.ws = ws
        self.swap_start = swap_used_gb()
        self.swap_max = self.swap_start
        self.aborted = threading.Event()
        self.aborted_memory = False
        self.free_min_pct: float | None = None
        self._halt = threading.Event()

    def run(self):
        while not self._halt.wait(CONDITION_POLL_S):
            c = conditions()
            self.samples += 1
            if not conditions_ok(c):
                self.bad.append({**c, "t": time.time()})
            swap = swap_used_gb()
            self.swap_max = max(self.swap_max, swap)
            fp, fp_peak = server_footprint_gb(self.server_port)
            if fp is not None:
                self.footprint_max = max(self.footprint_max or 0.0, fp)
                self.footprint_peak = max(self.footprint_peak or 0.0, fp_peak or 0.0)
            free = mem_free_pct()
            if free is not None:
                self.free_min_pct = free if self.free_min_pct is None else min(self.free_min_pct, free)
            if self.aborted.is_set():
                continue
            if swap - self.swap_start > SWAP_ABORT_GROWTH_GB:
                self._abort(f"SWAP GUARD: swap grew {swap - self.swap_start:.1f} GB during the story "
                            f"({self.swap_start:.1f} -> {swap:.1f} GB)")
            elif free is not None and free < MEM_FREE_ABORT_PCT:
                self.aborted_memory = True
                self._abort(f"MEMORY GUARD: free memory {free:.0f}% < {MEM_FREE_ABORT_PCT}%")

    def _abort(self, why: str) -> None:
        self.aborted.set()
        RUN_ABORT.set()
        print(f"    {why} — stopping the agent to protect the machine", flush=True)
        if self.ws:
            kill_pids(workspace_pids(self.ws))

    def stop(self) -> dict:
        self._halt.set()
        self.join()
        return {**summarise_conditions(self.samples, self.bad), "swap_start_gb": round(self.swap_start, 2),
                "swap_max_gb": round(self.swap_max, 2),
                "aborted_swap": self.aborted.is_set() and not self.aborted_memory,
                "aborted_memory": self.aborted_memory, "free_min_pct": self.free_min_pct,
                "server_footprint_max_gb": self.footprint_max, "server_footprint_peak_gb": self.footprint_peak}


def summarise_conditions(samples: int, bad: list[dict]) -> dict:
    """Power problems (battery, Low Power Mode) make a story DEGRADED: an unfair handicap.
    Thermal throttling under sustained load is how the setup really performs, so it is
    reported as a share of samples, not treated as a fault. Every story starts at nominal."""
    power_bad = [b for b in bad if not b["ac"] or b["low_power"]]
    throttled = [b for b in bad if b["thermal"] not in THERMAL_OK]
    return {"samples": samples, "degraded": bool(power_bad),
            "throttled_share": round(len(throttled) / samples, 2) if samples else 0.0,
            "bad_samples": bad}


def thermal() -> str:
    try:
        import sys
        sys.path.insert(0, str(VIDI.parent))
        from thermal import thermal_pressure  # benchmarks/thermal.py
        return thermal_pressure()
    except Exception as e:  # noqa: BLE001 - informational only
        return f"unknown ({e})"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--base-url", required=True, help="OpenAI-compatible /v1 the agent talks to")
    ap.add_argument("--client", choices=sorted(CLIENTS), default="pi")
    ap.add_argument("--server-log", type=Path, help="server's own per-request JSONL log (MTPLX)")
    ap.add_argument("--model-id", required=True)
    ap.add_argument("--scope", default="canvas")
    ap.add_argument("--context-limit", type=int, default=131072)
    ap.add_argument("--output-limit", type=int, default=32768)
    ap.add_argument("--compact-at", type=int, help="tokens of context at which the agent compacts (pi only)")
    ap.add_argument("--only", help="comma list of story ids to run (smoke tests)")
    ap.add_argument("--record", action="store_true",
                    help="after each story, commit this run's directory and push (a per-story record)")
    a = ap.parse_args()

    run = a.run_dir.resolve()
    run.mkdir(parents=True, exist_ok=True)
    scope = json.loads((VIDI / "scope" / f"{a.scope}.json").read_text())
    stories = scope["stories"]
    if a.only:
        wanted = {int(x) for x in a.only.split(",")}
        stories = [s for s in stories if s["id"] in wanted]
    work = work_dir_for(run)
    ws = work / "workspace"
    setup_workspace(ws)
    (run / "work_dir.txt").write_text(str(work))
    spec_hash = tree_hash(ws / "spec")
    env = agent_env(work)
    client = CLIENTS[a.client](work)
    client.write_config(a.base_url, a.model_id, a.context_limit, a.output_limit, compact_at=a.compact_at)
    metrics = load_metrics(run)
    metrics.update({"scope": a.scope, "model_id": a.model_id, "client": a.client, "compact_at": a.compact_at})
    done = [int(k) for k, v in metrics["stories"].items() if v.get("finished")]

    for story in stories:
        sid = story["id"]
        if sid in done:
            continue
        sdir = run / "stories" / f"{sid:02d}"
        sdir.mkdir(parents=True, exist_ok=True)
        (run / "current_story").write_text(str(sid))
        title = story_title(story)
        prompt = render_prompt(story, title, done, scope)
        (sdir / "prompt.md").write_text(prompt)
        print(f"[story {sid}] {title} — agent starting", flush=True)
        rec: dict = {"title": title, "conditions_start": wait_for_conditions(), "started": time.time()}
        head_before = sh(["git", "rev-parse", "HEAD"], ws).strip()
        sampler = ConditionSampler(ws, server_port=urlparse(a.base_url).port)
        sampler.start()
        prior = last_session(client, sdir / "agent-events.jsonl")
        if prior:
            print(f"[story {sid}] continuing the agent's own session {prior} after a harness restart", flush=True)
            rec["continued_session"] = prior
        rec["agent"] = run_story_agent(client, ws, env, a.model_id, prompt, sdir / "agent-events.jsonl",
                                       continue_session=prior)
        rec["agent_finished"] = time.time()
        rec["conditions"] = sampler.stop()
        if rec["conditions"]["aborted_swap"]:
            kill_strays(ws)
            (run / "current_story").write_text("")
            raise SystemExit(f"[story {sid}] stopped by the swap guard (swap {rec['conditions']['swap_start_gb']} -> "
                             f"{rec['conditions']['swap_max_gb']} GB). Not checkpointed; check memory before resuming.")
        kill_strays(ws)
        (run / "current_story").write_text("")
        if rec["agent"]["steps"] == 0:
            # The agent never reached the model: an infrastructure fault, not a story result.
            raise SystemExit(f"[story {sid}] agent made no model calls (exit {rec['agent']['exit']}); "
                             f"see {sdir / 'agent-events.jsonl'}. Not checkpointed.")

        if tree_hash(ws / "spec") != spec_hash:
            rec["spec_tampered"] = True
            sh(["git", "checkout", "--", "spec"], ws, check=False)
        rec["agent_commits"] = int(sh(["git", "rev-list", "--count", f"{head_before}..HEAD"], ws).strip())

        print(f"[story {sid}] agent done in {rec['agent']['seconds']}s; running gates", flush=True)
        rec["gate"] = gates.gate(ws)
        (sdir / "gate.json").write_text(json.dumps(rec["gate"], indent=2))
        kill_strays(ws)
        acc = gates.accept(ws, done + [sid], sdir)
        (sdir / "accept.json").write_text(json.dumps(acc, indent=2))
        rec["accept"] = {k: v for k, v in acc.items() if k != "tests"}

        sh(["git", "add", "-A"], ws, GIT_IDENTITY)
        if sh(["git", "status", "--porcelain"], ws).strip():
            sh(["git", "commit", "-qm", f"harness: snapshot after story {sid} (uncommitted agent work)"], ws, GIT_IDENTITY)
        rec["commit"] = sh(["git", "rev-parse", "HEAD"], ws).strip()
        rec["requests"] = server_stats(a.server_log, rec["started"], rec["agent_finished"])
        rec["loc"] = loc(ws)
        mirror(ws, run / "workspace")
        rec["finished"] = time.time()
        metrics["stories"][str(sid)] = rec
        save_metrics(run, metrics)
        done.append(sid)
        if a.record:
            import report
            (run / "summary.md").write_text(report.summary(run))
            compact_events(sdir / "agent-events.jsonl")
            label = combination_label(run)
            rec["record"] = record_story(REPO_ROOT, run, f"vidi {label} {run.name}: story {sid} done")
            save_metrics(run, metrics)
            r = rec["record"]
            print(f"[story {sid}] recorded: commit {r.get('commit', '-')} pushed={r['pushed']}"
                  f"{'  ' + r['error'][:200] if r.get('error') else ''}", flush=True)
        print(f"[story {sid}] gate green={rec['gate'].get('all_green')} "
              f"accept {acc['passed']}/{acc['total']} stalled={rec['agent']['stalled']}"
              f"{' DEGRADED (power/thermal) — timing not comparable' if rec['conditions']['degraded'] else ''}",
              flush=True)


if __name__ == "__main__":
    main()
