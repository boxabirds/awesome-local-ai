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
import functools
import hashlib
import json
import os
import shutil
import stat
import signal
import subprocess
import sys
import tempfile
import time
import traceback
import re
import threading
from urllib.parse import urlparse
from collections import deque
from pathlib import Path

import attempts
import engine_settings
import machine_fit
import containment
import gates
import heldout
import history
import hostenv
import machine_names
import pack as packmod
import packdir
import progress
import progress_file
import provenance
import publicise
import roots
from hostenv import IS_MAC, THERMAL_OK, mem_free_pct
from clients import CLIENTS, PI_THINKING_LEVELS, empty_state

HARNESS = Path(__file__).resolve().parent
# Two roots (roots.py), the same checkout unless $SPEC_BENCH_RESULTS_ROOT says otherwise. REPO_ROOT is where results
# live: run directories, the records committed and pushed, other runs' records, combination config. CODE_ROOT is
# the tree this harness is in (a release's own directory on a benchmark node): only its own files are read there.
REPO_ROOT = roots.RESULTS_ROOT
CODE_ROOT = roots.CODE_ROOT
BENCHMARKS = CODE_ROOT / "benchmarks"
# drive.py's exit code when the machine lacks something the run needs (a browser, …). Distinct from a
# crash (1) so a supervisor (dbench) stops instead of restarting into the same wall.
EXIT_MISSING_RESOURCES = 3
# The pack being run (--pack, vidi unless told otherwise): its spec/, scope/, prompts/ and held-out
# suite, from the private pack repo or benchmarks/<name> (packdir, pack). set_pack() switches it.
PK = packmod.load(packdir.DEFAULT_PACK)
PACK = PK.dir
# Agents work OUTSIDE the repo: inside it, the harness and the held-out suite are a `cd ..` away.
# All benchmark state lives under one hidden folder, never loose in the home directory: work/ (one
# folder per run), keys/ (grading keys), reference/ (imported builds and transcripts), series logs.
BENCH_HOME = hostenv.bench_home()
# Where the agents work: WORK_ROOT/<id>/workspace, the id a hash of the run's long name (work_dir_for). Short and
# neutral on purpose: the agent's cwd is under it, pi puts the cwd in the system prompt and every command shows it,
# and the old name (~/.vidi-bench/work/<model>__<engine>__…__benchmarks__vidi__<run>) told every model it was in a
# benchmark (46 Qwen stories said so; 594 tool calls mistyped it). A fixed path such as /w is not possible without
# root on either platform (bwrap can't make a mount point on the host's /, sandbox-exec can't remap a path, and a
# symlink is resolved by node's process.cwd()), so the directory is real and its name is short. The long name is
# kept for people and tools as a symlink under the bench home (WORK_LINKS, link_work_dir).
# What the model can still see: its cwd and $HOME, ~/.w/<id>/workspace and ~/.w/<id>/agent-home (and `pwd`, error
# messages and git's paths under them); in a process listing on macOS the sandbox profile with the paths it denies
# (the bench home, the results checkout), on Linux bwrap's arguments with the same; PATH, which may name
# ~/.dbench/tools; its browsers' path ~/.cache/vidi-agent-ms-playwright (vidi is the app's name, in the spec too).
WORK_ROOT_NAME = ".w"
WORK_ROOT = Path(os.environ.get("VIDI_WORK_ROOT", Path.home() / WORK_ROOT_NAME)).resolve()
WORK_LINKS = BENCH_HOME / "work"
WORK_ID_CHARS = 10
# The harness's, run.sh's and dbench's own variables name the results checkout, the bench home and the run: the
# agent inherits none of them (inherited_env). PATH is inherited as it is, whatever it names.
HARNESS_ENV_PREFIXES = ("VIDI_", "SPEC_BENCH_", "DBENCH_", "BENCH_")
# Nothing the agent runs may read these: the harness + held-out suite and every run's records (both roots: the
# results checkout, and the code's own directory when it is a release), the user's own agent
# config/skills/sessions, and other runs' work directories (WORK_ROOT minus the agent's own).
SANDBOX_DENY = [*dict.fromkeys([REPO_ROOT, CODE_ROOT]), *(Path.home() / p for p in
                (".claude", ".agents", ".codex", ".config/opencode", ".local/share/opencode", ".mtplx",
                 ".dbench",
                 # the RTX 4090 machine's file share held a clone of this repo, reference builds and all (25 Sep 2026).
                 "sambashare")),
                # The private pack checkout, whichever pack is running: it holds every pack's held-out suite.
                *[r for r in [packdir.private_checkout()] if r.is_dir()],
                # The held-out suite's browsers: an agent's `playwright install` would delete them.
                hostenv.playwright_cache(Path.home()),
                # All bench state (keys, reference builds, other runs); the agent's own run is reopened.
                BENCH_HOME]
# Denied trees that must still be readable, read-only: dbench installs the agents' tools (pi, uv) under
# ~/.dbench/tools, while the rest of ~/.dbench (token, jobs, repo checkouts, other runs' builds) stays hidden.
SANDBOX_REOPEN_RO = [Path.home() / ".dbench" / "tools"]
# Each run's agent has a temporary directory of its own, inside its run's work dir (so the sandbox already opens it
# to that agent alone): TMPDIR points there, and the machine's shared temp dirs are out of reach. Agents shared /tmp
# until 30 Sep 2026, when a run found another run's leftover git worktree at /tmp/vidi-baseline; the held-out suite
# also keeps its app's state in the harness's temp dir (os.tmpdir()/vidi-accept-*).
AGENT_TMP = "tmp"
# In a run's work dir: the agent's repository, and in it the pack's spec. The spec is the agent's to read and never
# to write: its files' read-only mode is only a hint (the agent is the same user), so the sandbox refuses the
# write (sandboxed). 13 recorded runs have stories in which the agent changed it, mostly the Status column of a
# story's tasks.md (one rewrote the file): its own progress goes in PROGRESS.md instead (progress_file.py).
WORKSPACE_DIR = "workspace"
SPEC_DIR = "spec"
# CLAUDE_CODE_TMPDIR: Claude Code ignores TMPDIR for its own temp files and uses /tmp/claude-<uid> unless this is
# set; with /tmp denied it couldn't see that dir existed and failed to start (EEXIST, 1 Oct 2026).
TMP_ENV = ("TMPDIR", "TMP", "TEMP", "CLAUDE_CODE_TMPDIR")
# Linux: bound over by the run's own temp dir (bwrap), so a hard-coded /tmp path still works, privately.
SHARED_TMP = [Path("/tmp"), Path("/var/tmp")]
# macOS: denied (sandbox-exec can't remap a path), with the per-user temp dir (confstr, what os.tmpdir() gives the
# harness and what BSD mktemp uses whatever TMPDIR says). In that dir only names mktemp makes (tmp.XXXXXXXX, unguessable
# and, since the dir can't be listed, unfindable) and xcrun's cache (/usr/bin/git's shim writes it on every call) stay
# open, so `mktemp -d` and git keep working.
USER_TEMP_OPEN = r"(tmp\.|xcrun_db)"
CONTEXT_BANDS = [(0, 16_000), (16_000, 32_000), (32_000, 64_000), (64_000, 100_000), (100_000, 10**9)]
CONDITION_POLL_S = 30        # how often run conditions are sampled during a story / while waiting
# The mirror is committed into the outer repo: no nested .git (it would become a
# broken gitlink), no copy of the spec (it lives in the pack), no build output.
MIRROR_EXCLUDES = [".git", "spec", "node_modules", "dist", ".wrangler", "test-results", "playwright-report"]
# Per-token stream deltas are ~99% of an agent event log: each repeats the partial message so far. The published log
# (compact_events) drops them, except the first of each model call: its arrival is when prefill ended, which
# accounting.py needs to split a call's time into prefill and decode.
STREAM_DELTA_EVENTS = {"message_update", "tool_execution_update"}
FIRST_CHUNK_EVENT = "message_update"
DELTA_TYPE = re.compile(r'"type":\s*"(message_update|tool_execution_update)"')
DELTA_PREFIX = 80            # a stamped line names its type within its first bytes: skip a delta without parsing it
# tests/privacy-test.sh: committed benchmark files carry no home paths, and stay within their kind's size limit
# (publicise.size_limit, the one table both use).
# The conversation log is the exception (owner's decision, 30 Sep 2026): it is published whole, nothing truncated,
# because a record that cuts what the model read and wrote can't be audited. Measured: a 30.9 MB story compacts to
# about 0.7 MB gzipped. Its own cap is GitHub's: pushes warn on files over 50 MB and are refused over 100 MB, and a
# refused push would stop every later story's record. Past the cap (never seen) strings are cut, and the log says so.
MB = 1024 * 1024
EVENT_LOG_MAX_BYTES = publicise.EVENT_LOG_LIMIT
LOG_CUT_MARK = "harness_log_cut"
# Only past EVENT_LOG_MAX_BYTES: long strings are cut to this, then shorter (EVENT_STRING_STEPS).
EVENT_STRING_MAX = 2000
# Git-ignored bookkeeping read by local tools; must keep real absolute paths.
LOCAL_ONLY_FILES = {"work_dir.txt", "current_story", "progress.json"}
TEXT_SUFFIXES = {".json", ".jsonl", ".md", ".txt", ".log", ".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".jsonc", ".sh"}
SPEC = PK.spec
PROMPT_TMPL = PK.template


def set_pack(p: str | Path) -> None:
    """Point the harness at another pack (drive.py --pack)."""
    global PK, PACK, SPEC, PROMPT_TMPL
    PK = packmod.load(p)
    PACK, SPEC, PROMPT_TMPL = PK.dir, PK.spec, PK.template
LOOP_REPEAT_LIMIT = 8        # identical consecutive tool calls that mark a story as stalled
KILL_GRACE_S = 10
# If OpenCode dies on an error (server stall, 409, dropped stream) the same session is resumed,
# as a person at the keyboard would. Same rule for every arm; every resume is recorded.
MAX_AGENT_RESUMES = 3
# Story cap (user decision, 25 Sep): across 51 finished stories none took over 3.84 h of agent time. Past the
# time limit a story ends as PARTIAL. One intervention per story (owner's decision, 1 Oct 2026, with Inspect and
# tau-bench: at most one fixed nudge per story, logged and disclosed): the first clean stop that isn't a verified
# finish gets the one stop message; a second such stop ends the story, by the harness, as PARTIAL. Before, up to
# five. Engine faults are not interventions about the model and are handled apart (MAX_TOOLCALL_TEXT_RESUMES,
# MAX_AGENT_RESUMES): they don't use up the message. All three are counted in the record's `interventions`.
SECONDS_PER_HOUR = 3600
MAX_STORY_AGENT_S = 4 * SECONDS_PER_HOUR
MAX_NUDGES = 1
CAP_BY = "harness (cap)"                                      # who ended a story at its time cap
STOP_SENT_BY = "harness (stop message already sent)"          # ...and at its second stop without a verified finish
STOP_SENT_REASON = "story cap: the stop message was sent and the story was still not finished (one message per story)"
# How a story ended (the record's end_reason): what the existing fields say, in one word.
AGENT_FINISHED = "agent-finished"                             # a verified DONE line at its first stop
STOP_MESSAGE_THEN_FINISHED = "stop-message-then-finished"     # a verified DONE line after the one message
STOP_MESSAGE_EXHAUSTED = "stop-message-exhausted"             # a second stop without one: ended by the harness
CAP_TIME = "cap-time"                                         # MAX_STORY_AGENT_S of agent time
OPERATOR_SKIP = "operator-skip"                               # dbench skip-story
ENGINE_FAULT_GAVE_UP = "engine-fault-gave-up"                 # errors past MAX_AGENT_RESUMES, or no session at all
STALLED = "stalled"                                           # the loop detector stopped it
HARNESS_FAULT = "harness-fault"                               # the reply check itself failed: taken as it stands
# The console line for each stop message sent, up to its number: "<this> 2 of 5 sent". dbench counts a job's stop
# messages from it (tools/dbench/src/events.rs, which holds these words too and still reads the line of before
# 1 Oct 2026, "agent stopped without committing — nudge N: …", in stored job logs).
STOP_SENT_LINE = "agent stopped before the story was finished — message"
RESUME_BACKOFF_S = 60
RESUME_PROMPT = "Continue with the task from where you left off."
# The stop rule (owner's decision and wording, 1 Oct 2026). Every time the agent stops cleanly the harness asks one
# thing: is the story finished, on evidence (story_finished)? If not, the agent gets STOP_MESSAGE_TMPL in the same
# session, the same text every time, up to MAX_NUDGES times; then the story is capped (recorded PARTIAL, its work
# committed by the harness). Before, the harness looked only at commits since the story began: none, and the agent
# was told to "continue"; any, and the story was accepted. Over the 227 nudges in the repo's logs that led to a
# commit 15% of the time: agents that had finished but not committed did busywork or built the next stories (gufo
# v2-r1 story 10 built 11 and 12; v2-r4 story 4 spent 33 agent-minutes re-running its suites), and a stall after an
# early task's commit was accepted as a finished story. Each part of the message answers a case in those logs:
# combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/analysis/README.md. Tests: test_stop_rule.py.
STOP_MESSAGE_TMPL = """\
This is an automated message from a script. Nobody reads your replies and nobody can answer questions. You will get this same message every time you stop, until story {n} is finished in the way described here.

You are working on story {n}, "{title}", and nothing else. Its tasks are in {tasks_path}; your progress on them is in PROGRESS.md.

Do the first of these that applies:

1. Your last message contained a tool call written as text: it was not run. Make the call again as a real tool call.
2. A task in PROGRESS.md is not done: carry on with it now. Do not write a summary first.
3. Something cannot be done on this machine (for example a browser that is not installed): write what and why in NOTES.md and treat that task as finished.
4. Every task is finished: do not re-check or improve anything. Run
   git add -A && git commit -m "story {n}: {title}"
   then git rev-parse HEAD.

When the commit is made, reply with exactly this one line and stop:

STORY {n} DONE <commit hash>

Do not start any other story. Do not offer further work. Do not ask what to do next."""
# The same line is asked for at the end of the story's own prompt (render_prompt), after the pack's template, which
# is the pack's and is not edited here: an agent that does as it is asked finishes on its first stop, with no message.
DONE_LINE_PROMPT_TMPL = ("After that commit, run `git rev-parse HEAD` and end your final reply with exactly this line: "
                         "STORY {n} DONE <commit hash>. The story is not finished until you have sent it.")
# In the same paragraph: the spec can't be written (sandboxed), and where the agent's account of its tasks goes.
SPEC_READ_ONLY_PROMPT = ("`spec/` is read-only: you cannot change it, and the Status column in tasks.md is not yours to "
                         "update. Track your progress on the tasks in `PROGRESS.md` (todo, doing, done, blocked).")
# The DONE line, on a line of its own; code or bold marks around it (a model's habit) are not part of it.
DONE_HASH_MIN_CHARS = 7
DONE_HASH_MAX_CHARS = 40
DONE_LINE = re.compile(rf"^[ \t`*]*STORY (\d+) DONE ([0-9a-fA-F]{{{DONE_HASH_MIN_CHARS},{DONE_HASH_MAX_CHARS}}})[ \t`*]*$", re.M)
# An engine can fail to parse a tool call and hand it back as plain text: gufo b722a61 did with an
# `edit` whose JSON argument held raw newlines (gufo-org/gufo#304, 28 Sep). The agent then sees a
# text reply with no tool call and stops as if finished, mid-work. It is the stop message's first case; such a stop
# is counted apart from the nudges (toolcall_text_resumes, up to a cap) and logged in the run's interventions
# (same rule for every engine; llama.cpp never triggered it in ~4,400 turns).
TOOLCALL_TEXT_MARKERS = ("<tool_call>",)
MAX_TOOLCALL_TEXT_RESUMES = 3
# pi's bash tool has no default timeout. An agent that backgrounds a server inside a tool call
# (`(wrangler dev &)`) leaves children holding the tool's output pipe and the call never returns.
# After this long with the last event a tool call and nothing streamed, the harness does what a
# person would: Ctrl-C the processes under the workspace. The agent then sees the tool end.
TOOL_HANG_S = 10 * 60
TOOL_HANG_POLL_S = 30
KILL_GRACE_S = 2          # between SIGTERM and SIGKILL for a hung tool's process group
TOOL_EVENT_TYPES = {"tool_execution_start", "tool_execution_update", "tool_use"}
EVENT_TAIL_BYTES = 64 * 1024
GIT_IDENTITY = {"GIT_AUTHOR_NAME": "vidi-agent", "GIT_AUTHOR_EMAIL": "agent@vidi.invalid",
                "GIT_COMMITTER_NAME": "vidi-agent", "GIT_COMMITTER_EMAIL": "agent@vidi.invalid"}


def sh(cmd: list[str], cwd: Path, env: dict | None = None, check: bool = True) -> str:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors="replace", env={**os.environ, **(env or {})})
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


@functools.lru_cache(maxsize=None)
def user_temp_dir() -> Path | None:
    """macOS's per-user temp dir (/var/folders/…/T), resolved; None elsewhere. Python's os.confstr doesn't know
    the name, so getconf is asked, once."""
    if not IS_MAC:
        return None
    p = subprocess.run(["getconf", "DARWIN_USER_TEMP_DIR"], capture_output=True, text=True)
    d = p.stdout.strip()
    return Path(d).resolve() if p.returncode == 0 and d else None


# Node and TypeScript resolve packages from node_modules in every directory above the workspace, and npm takes
# the nearest package.json above as the project. A package on the machine (the Macs had ~/node_modules/@types/node)
# then stands in for one the agent never declared: Sonnet 5.5 v2-r1's build passed where the agent worked and
# failed from a clean clone (1 Oct 2026). Hidden from the agent, in every directory above its run.
OUTSIDE_PACKAGE_DIRS = ("node_modules",)
OUTSIDE_PACKAGE_FILES = ("package.json", "package-lock.json")


def outside_packages(own_dir: Path) -> list[Path]:
    """The package directories and manifests of every directory above own_dir, existing or not."""
    return [a / name for a in own_dir.resolve().parents for name in (*OUTSIDE_PACKAGE_DIRS, *OUTSIDE_PACKAGE_FILES)]


def sandboxed(cmd: list[str], own_dir: Path) -> list[str]:
    """Wrap cmd in a sandbox that hides everything in SANDBOX_DENY except own_dir, with own_dir/AGENT_TMP as the
    agent's only temp dir, and own_dir's workspace spec read-only.

    macOS: sandbox-exec; SBPL applies the last matching rule, so the allow that re-opens own_dir wins even though
    it sits under WORK_ROOT, and the deny after it closes the spec to writing again. Linux: bubblewrap (see
    hostenv.bwrap_wrap), which mounts in order: the spec's read-only bind comes after own_dir's.
    """
    own_tmp = own_dir / AGENT_TMP
    own_tmp.mkdir(parents=True, exist_ok=True)   # bwrap can't bind a missing source; agent_env makes it too
    spec = own_dir / WORKSPACE_DIR / SPEC_DIR
    if not IS_MAC:
        args = hostenv.bwrap_wrap([], own_dir, [*SANDBOX_DENY, WORK_ROOT, *outside_packages(own_dir)],
                                  reopen_ro=SANDBOX_REOPEN_RO)
        own = str(own_dir.resolve())
        assert args[-4:] == ["--bind", own, own, "--"], "hostenv.bwrap_wrap must end by binding own_dir back"
        # After the masks (bwrap mounts in order; a later mount covers an earlier one) and before own_dir, which
        # may itself sit under /tmp and must stay visible.
        tmp = [a for p in SHARED_TMP for a in ("--bind", str(own_tmp.resolve()), str(p))]
        spec_ro = ["--ro-bind", str(spec.resolve()), str(spec.resolve())] if spec.is_dir() else []
        return [*args[:-4], *tmp, *args[-4:-1], *spec_ro, "--", *cmd]
    user_tmp = user_temp_dir()
    denied = [*SANDBOX_DENY, WORK_ROOT, *(p.resolve() for p in SHARED_TMP), *([user_tmp] if user_tmp else [])]
    deny = " ".join([*(f"(subpath {_sb_quote(p)})" for p in denied),
                     *(f"({'subpath' if p.name in OUTSIDE_PACKAGE_DIRS else 'literal'} {_sb_quote(p)})"
                       for p in outside_packages(own_dir))])
    user_tmp_rules = (f"(allow file-read-metadata (literal {_sb_quote(user_tmp)}))"
                      f'(allow file-read* file-write* (regex #"^{re.escape(str(user_tmp))}/{USER_TEMP_OPEN}"))'
                      if user_tmp else "")
    # Tools resolve real paths by lstat()ing every ancestor of a path (node's realpath, the
    # wrangler watcher). Allow metadata only -- stat, not reading or listing -- on the
    # ancestors of own_dir, so path resolution works while siblings stay hidden.
    reopen = [p for p in SANDBOX_REOPEN_RO if p.exists()]
    ancestors = " ".join(f"(literal {_sb_quote(a)})" for d in [own_dir, *reopen] for a in d.resolve().parents)
    reopen_rules = "".join(f"(allow file-read* (subpath {_sb_quote(p)}))" for p in reopen)
    profile = (f"(version 1)(allow default)"
               f"(deny file-read* file-write* {deny})"
               f"(allow file-read-metadata {ancestors})"
               f"{user_tmp_rules}"
               f"{reopen_rules}"
               f"(allow file-read* file-write* (subpath {_sb_quote(own_dir)}))"
               f"(deny file-write* (subpath {_sb_quote(spec)}))")
    return ["sandbox-exec", "-p", profile, *cmd]


def combination_label(run: Path) -> str:
    """e.g. qwen/3.8/flash-next/macos/128GB/mtplx-pi for a run under that combination."""
    try:
        rel = run.resolve().relative_to(REPO_ROOT / "combinations")
        return "/".join(rel.parts[:-3])  # drop benchmarks/<pack>/<run-id>
    except ValueError:
        pass
    try:  # a reference stack: benchmarks/reference/<pack>/<stack>/<run-id>
        rel = run.resolve().relative_to(REPO_ROOT / "benchmarks" / "reference")
        return "/".join(["reference", *rel.parts[1:-1]])
    except ValueError:
        return run.name


def work_dir_name(run: Path) -> str:
    """The run's long name, after its place in the repo: the symlink's name under WORK_LINKS, and what the work
    dir was called before 1 Oct 2026."""
    try:
        rel = run.resolve().relative_to(REPO_ROOT / "combinations")
    except ValueError:
        try:  # anywhere else in the repo (reference stacks): named by its full repo path
            rel = run.resolve().relative_to(REPO_ROOT)
        except ValueError:
            rel = Path(run.resolve().name)
    return "__".join(rel.parts)


def work_id(name: str) -> str:
    return hashlib.sha256(name.encode()).hexdigest()[:WORK_ID_CHARS]


def work_dir_for(run: Path) -> Path:
    """Stable per-run work directory outside the repo: WORK_ROOT/<id>, the id from the run's long name, so it is
    the same on every machine and says nothing to the agent."""
    return WORK_ROOT / work_id(work_dir_name(run))


def link_work_dir(run: Path, work: Path) -> None:
    """The run's long name as a symlink to its work dir, for people and tools (fetch-work.sh, logscan). A run that
    began under an earlier harness has a real directory at the long name: it is moved to the short path, so its
    next story runs there, and the link put in its place."""
    link = WORK_LINKS / work_dir_name(run)
    WORK_LINKS.mkdir(parents=True, exist_ok=True)
    if link.is_dir() and not link.is_symlink():
        if work.exists():
            raise SystemExit(f"both {link} (a run from before) and {work} exist: which is the run's work must be decided by hand")
        work.parent.mkdir(parents=True, exist_ok=True)
        os.rename(link, work)
        print(f"work dir moved to {work} (its long name is now a link)", flush=True)
    if not link.is_symlink():
        link.symlink_to(work)


def inherited_env(environ, denied: tuple[Path, ...] | None = None) -> dict:
    """The environment the agent inherits: everything but the harness's own variables (HARNESS_ENV_PREFIXES) and,
    PATH apart, any variable naming a root the sandbox denies (the results checkout, the code, the bench home):
    a tool's own variable can name the harness's directory (pyenv's PYENV_DIR did), and naming a hidden path
    only tells the agent what it is."""
    roots_ = [str(p) for p in (denied if denied is not None else (REPO_ROOT, CODE_ROOT, BENCH_HOME))]
    return {k: v for k, v in environ.items()
            if not k.startswith(HARNESS_ENV_PREFIXES) and (k == "PATH" or not any(r in v for r in roots_))}


def mirror(ws: Path, dest: Path) -> None:
    """Copy the workspace source into the results folder; the agent's git history goes alongside as text."""
    dest.mkdir(parents=True, exist_ok=True)
    excludes = [f"--exclude=/{e}" for e in MIRROR_EXCLUDES]
    subprocess.run(["rsync", "-a", "--delete", *excludes, f"{ws}/", f"{dest}/"], check=True)
    log = subprocess.run(["git", "log", "--stat", "--format=commit %H%n%an  %ad%n%n    %s%n"], cwd=ws,
                         capture_output=True, text=True, errors="replace").stdout
    (dest.parent / "workspace-git-log.txt").write_text(log)


# If a log is over EVENT_LOG_MAX_BYTES, strings are cut in these steps until it fits;
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
    """Gzip the agent event log, lossless but for the stream deltas: every other event exactly as the agent wrote
    it (its line, home paths redacted, nothing truncated), and the first delta of each model call for its timing.
    Lines that aren't a JSON object (a line cut off when the agent was killed) are dropped."""
    import gzip
    out = raw.with_name(raw.stem + ".compact.jsonl.gz")
    first_chunk_due = False            # an assistant message has started and its first chunk isn't kept yet
    with raw.open(errors="replace") as src, gzip.open(out, "wt") as dst:
        for line in src:
            m = DELTA_TYPE.search(line[:DELTA_PREFIX])
            if m and not (first_chunk_due and m.group(1) == FIRST_CHUNK_EVENT):
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(e, dict):
                continue
            t = e.get("type")
            if t in STREAM_DELTA_EVENTS and not (first_chunk_due and t == FIRST_CHUNK_EVENT):
                continue                  # a delta whose type wasn't at the start of its line
            if t == FIRST_CHUNK_EVENT:
                first_chunk_due = False
            elif t == "message_start":
                msg = e.get("message")
                first_chunk_due = isinstance(msg, dict) and msg.get("role") == "assistant"
            dst.write(_redact(line.rstrip("\n")) + "\n")
    return out


def _cut_to_fit(f: Path) -> None:
    """The safety valve past EVENT_LOG_MAX_BYTES: strings cut in steps until the log fits, a first line saying so."""
    import gzip
    with gzip.open(f, "rt", errors="replace") as src:
        events = [json.loads(l) for l in src if l.strip()]
    events = [e for e in events if not (isinstance(e, dict) and e.get("type") == LOG_CUT_MARK)]
    for limit in EVENT_STRING_STEPS:
        mark = {"type": LOG_CUT_MARK, "limit_bytes": EVENT_LOG_MAX_BYTES, "string_max": limit}
        with gzip.open(f, "wt") as dst:
            dst.write("\n".join(_redact(json.dumps(x)) for x in [mark, *(_truncate(e, limit) for e in events)]) + "\n")
        if f.stat().st_size <= EVENT_LOG_MAX_BYTES:
            break


def _over_limit(f: Path) -> bool:
    return f.stat().st_size > publicise.size_limit(f.as_posix())


def make_publishable(run: Path) -> list[str]:
    """Make a run dir safe to commit: redact home paths everywhere, compact any raw event log that
    is not git-ignored, and cut a compact log only if it is over its own cap. Returns files still over their cap."""
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
            # Written redacted by compact_events; left byte for byte as it is unless it is over its cap.
            if f.stat().st_size > EVENT_LOG_MAX_BYTES:
                _cut_to_fit(f)
        elif f.suffix in TEXT_SUFFIXES:
            try:
                t = f.read_text()
            except UnicodeDecodeError:
                continue
            if str(Path.home()) in t:
                f.write_text(_redact(t))
    return [str(f) for f in run.rglob("*") if f.is_file() and ".git" not in f.parts and "node_modules" not in f.parts
            and not (f.name == "agent-events.jsonl" and f.parent.parent.name == "stories")
            and _over_limit(f)]


RUN_GITIGNORE = """# Written by benchmarks/spec-bench/harness/drive.py. Raw agent logs are kept compacted
# (agent-events.compact.jsonl.gz); machine-local bookkeeping stays out of git.
stories/*/agent-events.jsonl
current_story
work_dir.txt
progress.json
control/
# Held-out detail (publicise.py): kept on this machine and in the private repo, never in this one.
""" + "\n".join(publicise.gitignore_lines()) + "\n"
REFUSED_SHOWN = 3       # problems a refused commit names in its one-line error; the rest are in PUBLISH_REFUSED
COMMIT_MESSAGE = "(the commit message)"   # where a refused commit's message problem is said to be
COMMIT_TRAILER = "\n\nCo-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"


def _rebase_in_progress(repo_root: Path, git: list[str]) -> bool:
    for name in ("rebase-merge", "rebase-apply"):
        p = subprocess.run([*git, "rev-parse", "--git-path", name], cwd=repo_root,
                           capture_output=True, text=True).stdout.strip()
        if p and (repo_root / p).exists():
            return True
    return False


def record_refusal(repo_root: Path, run: Path, git: list[str]) -> str | None:
    """Why this run must not be recorded in this checkout, or None when it may be. Checked before anything is
    written or staged. The reason goes into metrics.json, which is public, so it names no path; the paths are
    printed (the job log).

    - The run must be inside the root: a results root that is not the one the run was written under (a variable
      not honoured, a stale path) would otherwise commit something else's files, or nothing.
    - The root must be the top of a git checkout. git looks upwards for a repository, so a root that is merely
      inside one (a release's directory under a home that is a checkout) would commit into that one.
    - The root must not be a checkout named off limits (roots.NO_RECORD_ENV; the tests name the one they run from)."""
    root, where = repo_root.resolve(), run.resolve()
    why = None
    if any(root == p or p in root.parents for p in roots.off_limits()):
        why = f"records may not be committed in this checkout in this process (${roots.NO_RECORD_ENV})"
    elif where == root or root not in where.parents:
        why = "the run's directory is not inside the results root"
    else:
        top = (subprocess.run([*git, "rev-parse", "--show-toplevel"], cwd=root, capture_output=True, text=True)
               if root.is_dir() else None)
        if top is None or top.returncode != 0 or Path(top.stdout.strip()).resolve() != root:
            why = "the results root is not the top of a git checkout"
    if why:
        print(f"record: NOT RECORDED, {why}: run {where}, results root {root}", file=sys.stderr, flush=True)
    return why


def record_story(repo_root: Path, run: Path, message: str, git: list[str] | None = None,
                 private: Path | None = None) -> dict:
    """Commit exactly this run's directory and push, so every story leaves a durable record.

    Only the run dir is staged: anything else uncommitted in the repo is left alone. A credential in a staged file
    is replaced by a marker naming it before the commit, and counted (credentials_redacted). Held-out detail never is
    (publicise.py): each result gets its public summary, the run's private files are git-ignored (and untracked
    if an older harness committed them) and copied to the private repo (record_private), and every staged file
    is checked for held-out test titles first; if one has any, nothing is committed (refuse).
    Nothing at all is done, and the reason returned, when the run doesn't belong in this checkout (record_refusal).
    A failed push is reported, never fatal: the benchmark carries on. When the remote has
    changed this run's own files (a rename of its combination, say), the pull-and-rebase
    conflicts: it is aborted, the story stays committed locally and is reported `unpushed`,
    and the next story's push carries the backlog once the remote no longer conflicts."""
    git = git or ["git"]
    out: dict = {"committed": False, "pushed": False}
    refused = record_refusal(repo_root, run, git)
    if refused:
        return {**out, "error": f"not recorded: {refused}"}
    if _rebase_in_progress(repo_root, git):
        # Left by a harness killed mid-rebase: committing into it would bury the story.
        subprocess.run([*git, "rebase", "--abort"], cwd=repo_root, capture_output=True, text=True)
        out["recovered"] = "aborted a rebase left in progress by an earlier run"
    (run / ".gitignore").write_text(RUN_GITIGNORE)
    heldout.make_public(run)
    too_big = make_publishable(run)
    rel = str(run.resolve().relative_to(repo_root.resolve()))
    out["over_size_limit"] = [f for f in too_big if not publicise.is_private(
        str(Path(f).resolve().relative_to(repo_root.resolve())))]
    private = heldout.private_repo() if private is None else private
    # The detail first: whatever happens to the public commit, the private repo has it.
    out["private"] = record_private(repo_root, run, message, private, git)
    # The commit is built in an index of its own, from HEAD plus this run: exactly what is checked is what is
    # committed, a private file an older harness committed can be dropped from it (a `commit -- <run>` would take
    # it back from the working tree), and nothing else staged in the checkout goes in with it.
    with tempfile.TemporaryDirectory(prefix="record-index-") as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        if subprocess.run([*git, "rev-parse", "-q", "--verify", "HEAD"], cwd=repo_root, capture_output=True).returncode == 0:
            subprocess.run([*git, "read-tree", "HEAD"], cwd=repo_root, env=env, capture_output=True)
        untracked = untrack_private(repo_root, rel, git, env)
        if untracked:
            out["untracked_private"] = len(untracked)
        add = subprocess.run([*git, "add", "--", rel], cwd=repo_root, capture_output=True, text=True, env=env)
        if add.returncode != 0:
            return {**out, "error": add.stderr[-500:]}
        # The credential scan (credentials.py), on exactly what is staged: nothing reaches the commit round it.
        redacted, unscanned = heldout.redact_staged(repo_root, rel, git, env)
        if redacted:
            out["credentials_redacted"] = {"count": len(redacted), "names": sorted(set(redacted))}
            print(f"record: {len(redacted)} credential(s) redacted from what is published: "
                  f"{', '.join(out['credentials_redacted']['names'])}", flush=True)
        names, problems = heldout.local_names()
        problems += unscanned
        problems += heldout.staged_problems(repo_root, rel, git, heldout.fingerprints(private), env, names)
        problems += heldout.message_problems(message, names, COMMIT_MESSAGE)
        if problems:
            return {**out, **refuse(run, problems, names)}
        (run / publicise.PUBLISH_REFUSED).unlink(missing_ok=True)
        commit = subprocess.run([*git, "commit", "-q", "-m", message + COMMIT_TRAILER], cwd=repo_root,
                                capture_output=True, text=True, env=env)
        if commit.returncode != 0:
            return {**out, "error": (commit.stdout + commit.stderr)[-500:]}
    # The checkout's own index catches up with the commit for this run; the rest of it is left as it was.
    subprocess.run([*git, "reset", "-q", "--", rel], cwd=repo_root, capture_output=True)
    out["committed"] = True
    out["commit"] = subprocess.run([*git, "rev-parse", "--short", "HEAD"], cwd=repo_root,
                                   capture_output=True, text=True).stdout.strip()
    return {**out, **push_with_rebase(repo_root, git)}


EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"   # git's well-known id of the empty tree


def push_with_rebase(repo_root: Path, git: list[str]) -> dict:
    """Push HEAD to origin; if the remote moved, replay our commits onto it and try once more. Never raises:
    returns {"pushed"} plus, when it didn't, {"unpushed", "error"}.

    The replay is git plumbing (replay_onto_remote), never pull --rebase --autostash: other processes edit files
    in this checkout (an agent building the benchmarker, 1 Oct 2026), and an autostash takes their uncommitted
    work away and writes it back. Only the files the remote changed are checked out, and only if none of them
    has uncommitted edits; otherwise nothing moves and the commits stay local, pushed by a later record."""
    out: dict = {"pushed": False}
    push = subprocess.run([*git, "push", "-q", "origin", "HEAD"], cwd=repo_root, capture_output=True, text=True)
    if push.returncode != 0:
        replay = replay_onto_remote(repo_root, git)
        if "error" in replay:
            return {**out, "unpushed": True, "error": replay["error"]}
        push = subprocess.run([*git, "push", "-q", "origin", "HEAD"], cwd=repo_root, capture_output=True, text=True)
    out["pushed"] = push.returncode == 0
    if not out["pushed"]:
        out["unpushed"] = True
        out["error"] = push.stderr[-500:]
    return out


def replay_onto_remote(repo_root: Path, git: list[str]) -> dict:
    """Our commits since the remote's branch, made again on top of it, without a rebase or a stash: each commit's
    tree is merged in an index of its own (_merged_tree), then the checkout moves with a two-tree read-tree, which
    updates only the files that differ and refuses, moving nothing, if one of them has uncommitted edits.
    {} or {"error"}. Plain plumbing that git 2.34 has (the RTX 4090 machine's): no merge-tree --write-tree."""
    def run(*args: str, env: dict | None = None, input: str | None = None) -> subprocess.CompletedProcess:
        return subprocess.run([*git, *args], cwd=repo_root, capture_output=True, text=True, env=env, input=input)
    branch = run("symbolic-ref", "-q", "--short", "HEAD").stdout.strip()
    if not branch:
        return {"error": "the checkout is not on a branch, so there is nothing to replay onto the remote's"}
    fetch = run("fetch", "-q", "origin", branch)
    if fetch.returncode != 0:
        return {"error": "fetch failed: " + fetch.stderr[-300:]}
    old = run("rev-parse", "HEAD").stdout.strip()
    tip = run("rev-parse", "FETCH_HEAD").stdout.strip()
    ours = run("rev-list", "--reverse", "--topo-order", f"{tip}..{old}").stdout.split()
    new = tip
    for c in ours:
        parent = run("rev-parse", "-q", "--verify", f"{c}^").stdout.strip() or EMPTY_TREE   # a root commit: none
        tree = _merged_tree(repo_root, git, parent, new, c)
        if tree is None:
            return {"error": "the remote changed the same files as our commits: the story is committed locally and "
                             "unpushed, and a later record pushes it once the remote no longer conflicts"}
        who = run("log", "-1", "--format=%an%x00%ae%x00%ad%x00%B", "--date=raw", c).stdout.split("\0", 3)
        env = {**os.environ, "GIT_AUTHOR_NAME": who[0], "GIT_AUTHOR_EMAIL": who[1], "GIT_AUTHOR_DATE": who[2]}
        made = run("commit-tree", tree, "-p", new, "-F", "-", env=env, input=who[3])
        if made.returncode != 0:
            return {"error": made.stderr[-300:]}
        new = made.stdout.strip()
    moved = run("read-tree", "-m", "-u", old, new)
    if moved.returncode != 0:
        return {"error": "the remote changed files with uncommitted edits here; nothing was moved, the story is "
                         "committed locally and unpushed. " + moved.stderr[-300:]}
    run("update-ref", "-m", "record: replayed onto the remote", f"refs/heads/{branch}", new, old)
    return {}


def _merged_tree(repo_root: Path, git: list[str], base: str, ours: str, theirs: str) -> str | None:
    """The three-way merge of two trees in an index of its own, file by file: a file changed on one side only takes
    that side; one both changed, differently, is a conflict (None). Records touch only their own run dir."""
    with tempfile.TemporaryDirectory(prefix="replay-index-") as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        if subprocess.run([*git, "read-tree", "-m", "--aggressive", base, ours, theirs], cwd=repo_root, env=env,
                          capture_output=True).returncode != 0:
            return None
        if subprocess.run([*git, "ls-files", "-u"], cwd=repo_root, env=env, capture_output=True, text=True).stdout:
            return None
        tree = subprocess.run([*git, "write-tree"], cwd=repo_root, env=env, capture_output=True, text=True)
        return tree.stdout.strip() if tree.returncode == 0 else None


def untrack_private(repo_root: Path, rel: str, git: list[str], env: dict | None = None) -> list[str]:
    """Drop from the index the run's private files that an older harness committed; the files stay on disk."""
    listed = subprocess.run([*git, "ls-files", "-z", "--", rel], cwd=repo_root, capture_output=True, env=env)
    tracked = [p for p in listed.stdout.decode().split("\0") if p and publicise.is_private(p)]
    if tracked:
        subprocess.run([*git, "rm", "-q", "--cached", "--pathspec-from-file=-", "--pathspec-file-nul"],
                       cwd=repo_root, input="\0".join(tracked).encode(), capture_output=True, env=env)
    return tracked


def refuse(run: Path, problems: list[dict], names: set[str] = frozenset()) -> dict:
    """Don't commit (the index the commit was built in is thrown away): keep what was found in a private file and
    name it on stdout. What is returned goes into metrics.json, which is public, so it names each file (with any
    local machine name in its path masked) and a digest of any title or name found, not the title or name."""
    (run / publicise.PUBLISH_REFUSED).write_text(json.dumps({"at": time.time(), "problems": problems}, indent=2))
    for p in problems:
        print(f"record: NOT COMMITTED, {p['why']} in {p['file']}"
              f"{': ' + p['fingerprint'] if p['fingerprint'] else ''}", flush=True)
    found = [{"file": machine_names.redact(p["file"], names), "why": p["why"],
              "fingerprint": heldout.digest(p["fingerprint"]) if p["fingerprint"] else None} for p in problems]
    shown = ", ".join(f"{f['file']} ({f['why']}{' ' + f['fingerprint'] if f['fingerprint'] else ''})"
                      for f in found[:REFUSED_SHOWN])
    return {"refused": found,
            "error": (f"not committed: {len({f['file'] for f in found})} staged file(s) must not be public: {shown}"
                      f"{' …' if len(found) > REFUSED_SHOWN else ''}; see {publicise.PUBLISH_REFUSED}")}


PRIVATE_BRANCH = "main"          # where the private repo keeps the archive of every run's detail
PRIVATE_PUSH_TRIES = 2          # once, and once more on the remote's new head if it moved in between


def record_private(repo_root: Path, run: Path, message: str, private: Path, git: list[str]) -> dict:
    """Copy the run's held-out detail to the private repo (heldout.copy_private) and push it to its main branch.

    The commit is built with git plumbing on the remote's main, never on the checkout's HEAD: the checkout sits
    detached at the pack's tag (setup-node.sh), because runs read their held-out suite from it, so a commit on
    HEAD lands on no branch and is never pushed (1 Oct 2026). HEAD, the branches and the checked-out files are
    left exactly as they were. Every call records all of the run's detail that the remote lacks, so a push that
    failed is made good by the next one; detail the remote already has is no commit and no error.
    Never fatal: a missing checkout, or a failed fetch or push, is reported."""
    if not (private / ".git").exists():
        return {"skipped": f"no private checkout at {private}"}
    copied = heldout.copy_private(run, repo_root, private)
    out: dict = {"copied": len(copied), "committed": False, "pushed": False}
    dest = f"{heldout.PRIVATE_RUNS}/{run.resolve().relative_to(repo_root.resolve()).as_posix()}"
    files = heldout.private_files(run, repo_root)
    if not files:
        return out
    tracking = f"refs/remotes/origin/{PRIVATE_BRANCH}"
    for _ in range(PRIVATE_PUSH_TRIES):
        fetch = subprocess.run([*git, "fetch", "-q", "origin", f"+refs/heads/{PRIVATE_BRANCH}:{tracking}"],
                               cwd=private, capture_output=True, text=True)
        built = _private_commit(private, tracking, run, files, dest, message, git)
        if "error" in built:
            return {**out, "error": built["error"]}
        if built["commit"] is None:            # the remote has all of it already
            out["pushed"] = fetch.returncode == 0
            return out
        out["committed"] = True
        push = subprocess.run([*git, "push", "-q", "origin", f"{built['commit']}:refs/heads/{PRIVATE_BRANCH}"],
                              cwd=private, capture_output=True, text=True)
        if push.returncode == 0:
            out["pushed"] = True
            out.pop("error", None)
            return out
        out["error"] = ((fetch.stderr if fetch.returncode != 0 else "") + push.stderr)[-500:]
        if fetch.returncode != 0:              # offline: trying again on the same stale head won't help
            break
    return out


def _private_commit(private: Path, base_ref: str, run: Path, files: list[str], dest: str, message: str,
                    git: list[str]) -> dict:
    """A commit on base_ref holding the run's private files at dest, made in an index of its own (no checkout
    involved): {"commit": sha}, {"commit": None} when base_ref has them all already, or {"error"}."""
    base = subprocess.run([*git, "rev-parse", "-q", "--verify", f"{base_ref}^{{commit}}"], cwd=private,
                          capture_output=True, text=True).stdout.strip()
    if not base:
        return {"error": f"the private repo has no {base_ref} to record onto"}
    with tempfile.TemporaryDirectory(prefix="private-index-") as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        r = subprocess.run([*git, "read-tree", base], cwd=private, capture_output=True, text=True, env=env)
        if r.returncode != 0:
            return {"error": r.stderr[-500:]}
        hashed = subprocess.run([*git, "hash-object", "-w", "--stdin-paths"], cwd=private, capture_output=True,
                                text=True, input="".join(f"{(run / f).resolve()}\n" for f in files))
        if hashed.returncode != 0:
            return {"error": hashed.stderr[-500:]}
        info = "".join(f"100644 {sha}\t{dest}/{f}\n" for sha, f in zip(hashed.stdout.split(), files))
        for step, stdin in (([*git, "update-index", "--add", "--index-info"], info), ([*git, "write-tree"], None)):
            r = subprocess.run(step, cwd=private, capture_output=True, text=True, env=env, input=stdin)
            if r.returncode != 0:
                return {"error": r.stderr[-500:]}
        tree = r.stdout.strip()
    if tree == subprocess.run([*git, "rev-parse", f"{base}^{{tree}}"], cwd=private, capture_output=True,
                              text=True).stdout.strip():
        return {"commit": None}
    commit = subprocess.run([*git, "commit-tree", tree, "-p", base, "-F", "-"], cwd=private, capture_output=True,
                            text=True, input=message + COMMIT_TRAILER)
    if commit.returncode != 0:
        return {"error": commit.stderr[-500:]}
    return {"commit": commit.stdout.strip()}


def load_metrics(run: Path) -> dict:
    """metrics.json with its held-out detail (heldout.py): a resumed run carries on with everything."""
    return heldout.load_metrics(run)


def save_metrics(run: Path, m: dict) -> None:
    """metrics.json as it may be published, and the held-out detail beside it, git-ignored."""
    heldout.save_metrics(run, m)


SPEC_FILE_MODE = 0o444


def spec_files_read_only(ws: Path) -> None:
    """The spec's files read-only, as a hint to the agent; directories stay writable so runs can be mirrored and
    deleted. What stops a write is the sandbox (sandboxed), and behind it the check after every story (restore_spec)."""
    for f in (ws / SPEC_DIR).rglob("*"):
        if f.is_file():
            f.chmod(SPEC_FILE_MODE)


def first_commit(ws: Path) -> str:
    """The workspace's first commit: the harness's, holding the spec as the pack has it."""
    return sh(["git", "rev-list", "--max-parents=0", "HEAD"], ws).split()[-1]


def restore_spec(ws: Path, spec_commit: str, sid: int) -> list[str]:
    """Put the workspace's spec back as it is in spec_commit (a harness commit: never HEAD, which may hold the
    agent's own change), in a harness commit when the agent had committed its change, and return the files that
    differed, so a status edited in a tasks.md can be told from changed requirements or design. Later stories
    then build on the pack's spec, and only the story in which the change was made is flagged."""
    changed = {*sh(["git", "diff", "--name-only", spec_commit, "--", SPEC_DIR], ws).splitlines(),
               *sh(["git", "ls-files", "--others", "--", SPEC_DIR], ws).splitlines()}
    for d in [ws / SPEC_DIR, *(p for p in (ws / SPEC_DIR).rglob("*") if p.is_dir() and not p.is_symlink())]:
        d.chmod(d.stat().st_mode | stat.S_IRWXU)        # a directory the agent closed can still be emptied
    shutil.rmtree(ws / SPEC_DIR)
    sh(["git", "checkout", spec_commit, "--", SPEC_DIR], ws)
    spec_files_read_only(ws)
    sh(["git", "add", "-A", "--", SPEC_DIR], ws)
    if sh(["git", "diff", "--cached", "--name-only", "--", SPEC_DIR], ws).strip():
        sh(["git", "commit", "-qm", f"harness: spec restored after story {sid}", "--", SPEC_DIR], ws, GIT_IDENTITY)
    return sorted(changed)


def begin_progress_file(ws: Path, sid: int, title: str, tasks: list[dict]) -> None:
    """The story's PROGRESS.md (progress_file.py), every task at todo, in a harness commit of its own: made before
    the story's starting commit is taken, so it is never the agent's commit nor among the story's own lines."""
    progress_file.write(ws, sid, title, tasks)
    sh(["git", "add", "-f", "--", progress_file.FILE], ws)
    if sh(["git", "diff", "--cached", "--name-only", "--", progress_file.FILE], ws).strip():
        sh(["git", "commit", "-qm", f"harness: {progress_file.FILE} for story {sid}", "--", progress_file.FILE], ws,
           GIT_IDENTITY)


def setup_workspace(ws: Path) -> None:
    """Fresh repo containing only README.md (as story 1's design assumes) plus the read-only spec."""
    if (ws / ".git").exists():
        return
    ws.mkdir(parents=True)
    (ws / "README.md").write_text("# vidi6\n\nA shared board for thinking together.\n")
    shutil.copytree(SPEC, ws / SPEC_DIR)
    spec_files_read_only(ws)
    sh(["git", "init", "-q", "-b", "main"], ws)
    sh(["git", "add", "-A"], ws)
    sh(["git", "commit", "-qm", "harness: empty repository with spec"], ws, GIT_IDENTITY)



# ---- known-good mode (EVALUATION-POLICY rule 7) --------------------------------------------------
KNOWN_GOOD_BY = "known-good base"


def known_good_base(ref_run: Path, sid: int) -> dict:
    """Another run's code as it was when the story before sid ended, and the stories it had processed
    by then: the base a known-good run builds story sid on (and, in a continuation, every story after it:
    the reference run supplies only the base, so it need not have run those)."""
    bundle = ref_run / "workspace.bundle"
    if not bundle.exists():
        raise SystemExit(f"known-good: {ref_run} has no workspace.bundle")
    m = json.loads((ref_run / "metrics.json").read_text())
    processed = load_processed(m, [{"id": int(k)} for k in sorted(m["stories"], key=int)])
    ids = [p["id"] for p in processed]
    if sid not in ids:
        raise SystemExit(f"known-good: the reference run never processed story {sid}")
    before = processed[:ids.index(sid)]
    if not before:
        raise SystemExit(f"known-good: story {sid} is the reference run's first; run it from empty instead")
    return {"bundle": bundle, "from_run": ref_run, "story": sid,
            "commit": m["stories"][str(before[-1]["id"])]["commit"],
            "processed": [{**p, "ended_by": KNOWN_GOOD_BY} for p in before]}


WORKSPACE_BRANCH_REF = "refs/heads/main"     # the one branch a workspace has


def setup_workspace_from(ws: Path, base: dict, spec: Path) -> None:
    """The workspace as the reference run left it at base["commit"], on main, with every later commit
    gone: the bundle holds the whole run, including how the story about to be built was done."""
    if (ws / ".git").exists():
        return
    ws.parent.mkdir(parents=True, exist_ok=True)
    sh(["git", "clone", "-q", "--no-checkout", str(base["bundle"]), str(ws)], ws.parent)
    # A bundle doesn't say which branch HEAD was on, and git guesses among those at its commit: main, whatever it took.
    sh(["git", "symbolic-ref", "HEAD", WORKSPACE_BRANCH_REF], ws)
    sh(["git", "reset", "-q", "--hard", base["commit"]], ws)
    sh(["git", "remote", "remove", "origin"], ws)
    for ref in sh(["git", "for-each-ref", "--format=%(refname)"], ws).split():
        if ref != WORKSPACE_BRANCH_REF:
            sh(["git", "update-ref", "-d", ref], ws)
    sh(["git", "reflog", "expire", "--expire=now", "--all"], ws)
    sh(["git", "gc", "-q", "--prune=now"], ws)
    # The agent works from this pack's spec either way; a reference built before a spec revision gets it
    # in a harness commit, recorded (the summary says so).
    base["spec_updated"] = _spec_hash(ws / "spec") != _spec_hash(spec)
    if base["spec_updated"]:
        shutil.rmtree(ws / "spec")
        shutil.copytree(spec, ws / "spec", ignore=shutil.ignore_patterns(*FINDER_FILES))
        sh(["git", "add", "-A", "spec"], ws)
        sh(["git", "commit", "-qm", "harness: spec updated to this pack's version (known-good base)"], ws, GIT_IDENTITY)
    spec_files_read_only(ws)


NPM_CI_TIMEOUT_S = 900


def install_base_deps(ws: Path) -> None:
    """The dependencies the reference run's agent had installed by then (a bundle holds no node_modules),
    from the base's own lockfile, so neither the base's score nor the story's time pays for them."""
    if (ws / "package-lock.json").exists() and not (ws / "node_modules").exists():
        p = subprocess.run(["npm", "ci", "--no-audit", "--no-fund"], cwd=ws, capture_output=True, text=True,
                           timeout=NPM_CI_TIMEOUT_S)
        if p.returncode != 0:
            raise SystemExit(f"known-good: npm ci failed in the base: {p.stderr[-2000:]}")


FINDER_FILES = (".DS_Store",)


def _spec_hash(root: Path) -> str:
    """The spec's content, without the files macOS Finder drops into folders."""
    h = hashlib.sha256()
    for f in sorted(root.rglob("*")):
        if f.is_file() and f.name not in FINDER_FILES:
            h.update(str(f.relative_to(root)).encode())
            h.update(f.read_bytes())
    return h.hexdigest()

def link_agent_browsers(home: Path, real_home: Path) -> None:
    """Put the agents' browsers where Playwright looks by default in the agent's home, as well as in
    PLAYWRIGHT_BROWSERS_PATH, so an agent that checks `~/Library/Caches/ms-playwright` (or
    `~/.cache/ms-playwright`) finds them instead of searching the disk."""
    default = hostenv.playwright_cache(home)
    target = hostenv.agent_playwright_cache(real_home)
    if default.is_symlink() or default.exists():
        return
    default.parent.mkdir(parents=True, exist_ok=True)
    default.symlink_to(target, target_is_directory=True)


def agent_env(work: Path) -> dict:
    """Isolated HOME + XDG so the user's own config, skills and plugins never reach the agent."""
    home = work / "agent-home"
    home.mkdir(parents=True, exist_ok=True)
    tmp = work / AGENT_TMP
    tmp.mkdir(parents=True, exist_ok=True)
    real_home = Path.home()
    link_agent_browsers(home, real_home)
    return {
        "HOME": str(home),
        **{k: str(tmp) for k in TMP_ENV},
        # Node tools (OpenCode, pi) trust $PWD; an inherited one points into the denied repo.
        "PWD": str(work / "workspace"),
        "OLDPWD": str(work / "workspace"),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "XDG_DATA_HOME": str(home / ".local" / "share"),
        "XDG_CACHE_HOME": str(home / ".cache"),
        "XDG_STATE_HOME": str(home / ".local" / "state"),
        # Shared caches only: identical for every run and they hold no instructions.
        "npm_config_cache": str(real_home / ".npm"),
        "PLAYWRIGHT_BROWSERS_PATH": str(hostenv.agent_playwright_cache(real_home)),
        "WRANGLER_SEND_METRICS": "false",
        **GIT_IDENTITY,
    }


def stories_so_far(processed: list[dict], this_id: int) -> str:
    """The prompt's account of the stories before this one. With every story DONE it is the line
    every run has always had; a PARTIAL story is named, with its unverified tasks and one rule."""
    if not any(p["status"] == PARTIAL for p in processed):
        done = ", ".join(str(p["id"]) for p in processed)
        return f"Stories already implemented in this repository, in order: {done or 'none (empty repository)'}."
    listed = ", ".join(f"{p['id']} ({'partial' if p['status'] == PARTIAL else 'done'})" for p in processed)
    lines = [f"Stories already processed in this repository, in order: {listed}."]
    for p in processed:
        if p["status"] != PARTIAL:
            continue
        n = p["id"]
        open_tasks = [str(t["n"]) for t in p.get("tasks", []) if t.get("status") != "verified"]
        lines.append(
            f"Story {n} was ended before it was complete. Tasks in its tasks.md that were not verified then: "
            f"{', '.join(open_tasks) or 'none recorded'}. Do not do those tasks for their own sake. If story "
            f"{this_id} needs behaviour story {n} was meant to provide and it is missing, implement it to story "
            f"{n}'s design and record it in `NOTES.md` under \"Gap filled from story {n}\". Never stub, mock or "
            f"fake product code to stand in for it.")
    return "\n".join(lines)


def harness_paragraph(story_id: int) -> str:
    """The harness's own last paragraph of a story's prompt: how the agent says the story is finished (the stop
    rule), and where its progress goes now that the spec is read-only."""
    return f"{DONE_LINE_PROMPT_TMPL.format(n=story_id)} {SPEC_READ_ONLY_PROMPT}"


def render_prompt(story: dict, title: str, processed: list[dict], scope: dict) -> str:
    """The pack's template filled in, then the harness's request for the DONE line.
    processed: the queue of stories already processed, each {"id", "status": DONE|PARTIAL, ...}."""
    story_dir = f"spec/stories/{story['dir']}"
    text = (PROMPT_TMPL.read_text()
            .replace("{{APP_LINE}}", PK.app_line)
            .replace("{{RULES}}", PK.rules)
            .replace("{{ID}}", str(story["id"]))
            .replace("{{TITLE}}", title)
            .replace("{{SPEC_DIR}}", "spec/")
            .replace("{{STORY_DIR}}", story_dir)
            .replace("{{STORIES_SO_FAR}}", stories_so_far(processed, story["id"]))
            .replace("{{SCOPE_NOTE}}", scope.get("out_of_scope_note", "")))
    return f"{text.rstrip()}\n\n{harness_paragraph(story['id'])}\n"


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
    kill_workspace_tools(ws)
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
                if CONTAINMENT:
                    CONTAINMENT.reap_interrupted()   # what the cut-off call started, incl. servers it detached
                with self.log.open("a") as f:
                    f.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {self.events.parent.name}: "
                            f"interrupted a tool call silent for {TOOL_HANG_S}s (killed processes under the workspace)\n")
                print(f"    tool call silent {TOOL_HANG_S // 60} min — interrupted (Ctrl-C equivalent)", flush=True)

    def stop(self) -> int:
        self._halt.set()
        self.join()
        return self.interruptions


def stop_message(story_id: int, title: str, tasks_path: str) -> str:
    """What the agent is told each time it stops before its story is finished: the same text every time."""
    return STOP_MESSAGE_TMPL.format(n=story_id, title=title, tasks_path=tasks_path)


def story_finished(reply_text: str, story_id: int, ws: Path) -> bool:
    """A story is finished only on evidence: the agent's last reply has `STORY <id> DONE <hash>` for this story on
    a line of its own, the hash (7 to 40 hex characters) is the start of the workspace's HEAD, and nothing in the
    workspace is left uncommitted. Anything else is not finished, and so is a workspace git can't read."""
    hashes = [h.lower() for n, h in DONE_LINE.findall(reply_text) if int(n) == story_id]
    if not hashes:
        return False
    try:
        head = sh(["git", "rev-parse", "HEAD"], ws).strip().lower()
        clean = not sh(["git", "status", "--porcelain"], ws).strip()
    except (RuntimeError, OSError):
        return False
    return clean and bool(head) and any(head.startswith(h) for h in hashes)


def final_reply_text(events_path: Path) -> str:
    """The text of the session's last assistant message ("" if there is none or no events file)."""
    last = ""
    try:
        lines = events_path.read_text(errors="replace").splitlines()
    except OSError:
        return ""
    for line in lines:
        try:
            message = json.loads(line).get("message")
        except (ValueError, AttributeError):
            continue
        # Not every event's message is a model message: Claude Code's record of a refused tool call has a string.
        if not isinstance(message, dict) or message.get("role") != "assistant" or not isinstance(message.get("content"), list):
            continue
        last = "".join(c.get("text", "") for c in message["content"] if isinstance(c, dict) and c.get("type") == "text")
    return last


def tool_call_as_text(text: str) -> bool:
    """A reply that carries a tool call as plain text: the engine couldn't parse it (see TOOLCALL_TEXT_MARKERS)."""
    return any(marker in text for marker in TOOLCALL_TEXT_MARKERS)


def cap_reason(agent_s: float, nudges: int) -> str | None:
    """Why the story must end now, or None: over MAX_STORY_AGENT_S of agent time, or the stop message already
    sent (MAX_NUDGES) and the agent stopped again without a verified finish."""
    if agent_s >= MAX_STORY_AGENT_S:
        return f"story cap: {agent_s / SECONDS_PER_HOUR:.1f} h of agent time (cap {MAX_STORY_AGENT_S / SECONDS_PER_HOUR:.1f} h)"
    if nudges >= MAX_NUDGES:
        return STOP_SENT_REASON
    return None


def interventions_of(resumes: int, nudges: int, toolcall_text_resumes: int) -> dict:
    """Every time the harness stepped in during a story, by kind and in all: the one stop message (a decision
    about the model), and the engine-fault recoveries (a tool call written as text continued, an error resumed)."""
    return {"total": nudges + toolcall_text_resumes + resumes, "stop_message": nudges,
            "toolcall_text_resumes": toolcall_text_resumes, "error_resumes": resumes}


REPLY_CHECK_STEP = "reply check"           # the derived step whose fault leaves a story's end unjudged (harness-fault)


def end_reason(agent: dict, skip: dict | None, checked: bool = True) -> str:
    """How the story ended, in one word (the record's end_reason), from what its agent record and skip say;
    checked is false when the reply check itself faulted (STORY_FAULTS names REPLY_CHECK_STEP)."""
    if skip:
        by = skip.get("by")
        return (STOP_MESSAGE_EXHAUSTED if by == STOP_SENT_BY else CAP_TIME if by == CAP_BY else OPERATOR_SKIP)
    if agent.get("finished"):
        return STOP_MESSAGE_THEN_FINISHED if agent.get("nudges") else AGENT_FINISHED
    if agent.get("stalled"):
        return STALLED
    return ENGINE_FAULT_GAVE_UP if checked else HARNESS_FAULT


def _stop_check(events_path: Path, story_id: int, ws: Path) -> tuple[bool, bool]:
    """What the agent's last reply shows: (the story is finished, the reply is a tool call written as text)."""
    reply = final_reply_text(events_path)
    return story_finished(reply, story_id, ws), tool_call_as_text(reply)


def stamp(line: str, t: float) -> str:
    """An agent event line with its arrival time added as "_rx" (pi times no tool runs itself).
    A string splice, not a re-dump: most lines are large stream deltas."""
    if not line.startswith("{"):
        return line
    body = line[1:].lstrip()
    return f'{{"_rx":{t:.3f}' + ("" if body.startswith("}") else ",") + body


# What a tool call was for, from its command: the first match wins.
from accounting import TOOL_KINDS, tool_kind as _tool_kind  # noqa: E402  (one definition, shared)


def _stamped_events(events: Path):
    """The stamped events of a log, streamed (a story's log runs to hundreds of MB), deltas skipped."""
    try:
        f = events.open(errors="replace")
    except OSError:
        return
    with f:
        for line in f:
            if line.startswith('{"_rx"') and not any(f'"type":"{d}"' in line[:60] for d in STREAM_DELTA_EVENTS):
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue  # cut off when the agent was killed mid-write, or by a crash
                yield e  # always an object: the line starts with '{"_rx"' and parsed


def time_split(events: Path, server_log: Path, t_from: float, t_to: float) -> dict:
    """Where a story's wall time went: accounting.py (a partition of the window, with its checks)."""
    import accounting
    return accounting.time_split(events, server_log, t_from, t_to)


# The running story's containment (containment.StoryContainment; tools/agent-containment/PROPOSAL.md):
# the agent session, its tool calls, the hang guard and the conditions sampler all report to it.
CONTAINMENT = None


def run_agent(client, ws: Path, env: dict, model_id: str, prompt: str, events_path: Path,
              resume_from: str | None = None, fork: bool = True) -> dict:
    """Run (or resume) one sandboxed agent session; returns counts, session id, error and loop flag."""
    cmd = hostenv.oom_first(sandboxed(client.command(model_id, prompt, resume_from, fork=fork), own_dir=ws.parent))
    if CONTAINMENT:
        cmd = CONTAINMENT.wrap(cmd)
    t0 = time.monotonic()
    full_env = {**inherited_env(os.environ), **env, **client.env()}
    for k in getattr(client, "env_remove", ()):  # e.g. an API key that would override subscription auth
        full_env.pop(k, None)
    proc = subprocess.Popen(cmd, cwd=ws, env=full_env, stdin=subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, start_new_session=True)
    if CONTAINMENT:
        CONTAINMENT.started(proc.pid)
    global AGENT_ROOT_PID
    AGENT_ROOT_PID = proc.pid
    loops = LoopDetector()
    st = empty_state()
    stalled = False
    with events_path.open("a") as ev:
        for line in proc.stdout:  # type: ignore[union-attr]
            ev.write(stamp(line, time.time()))
            ev.flush()
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(e, dict):      # JSON, but not an event: in the log as it arrived, counted by skipped_output
                continue
            if CONTAINMENT and e.get("type") == "tool_execution_start":
                CONTAINMENT.note_tool_start()
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
    AGENT_ROOT_PID = None
    if STORY_SKIP.is_set():
        st["error"] = None  # the operator ended the story: not an agent failure, nothing to resume
    elif proc.returncode not in (0, None) and not st["error"] and not stalled:
        st["error"] = f"agent exited with status {proc.returncode}"
    return {"exit": proc.returncode, "seconds": round(time.monotonic() - t0, 1), "stalled": stalled, **st}


# A line of the agent's output that is valid JSON but not an object (`42`, `null`, `[1]`) is not an event: it is
# skipped, as a line that is not JSON is, and never silently. It stays in the story's log as it arrived, the
# story's record counts such lines and keeps the first few, and the console says how many (main).
SKIPPED_OUTPUT_SAMPLES = 3
SKIPPED_OUTPUT_SAMPLE_CHARS = 200


def skipped_output(events: Path) -> dict | None:
    """The lines of a story's log that are JSON but not objects, over every attempt: how many, and the first few,
    each cut to its limit. None where there are none (or no log)."""
    if not events.exists():
        return None
    count, samples = 0, []
    with events.open(errors="replace") as f:
        for line in f:
            if line.startswith("{"):         # an event, or one cut off mid-write: either way not one of these
                continue
            try:
                json.loads(line)
            except json.JSONDecodeError:
                continue
            count += 1
            if len(samples) < SKIPPED_OUTPUT_SAMPLES:
                samples.append(line.rstrip("\n")[:SKIPPED_OUTPUT_SAMPLE_CHARS])
    return {"count": count, "samples": samples} if count else None


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
        if not isinstance(e, dict):
            continue
        st = empty_state()
        client.scan(e, st)
        sid = st["session"] or sid
    return sid


def run_story_agent(client, ws: Path, env: dict, model_id: str, prompt: str, events_path: Path, story: dict,
                    continue_session: str | None = None, on_cap=None) -> dict:
    """First attempt, plus fork-resumes after errors and the one stop message after the first clean stop that isn't
    a verified finish (the stop rule: STOP_MESSAGE_TMPL); a second such stop ends the story (on_cap(reason, by)).
    story: {"id", "title", "tasks_path"}, what the message names. With continue_session (a harness restart
    mid-story), the agent's own session is continued."""
    if not continue_session:
        events_path.unlink(missing_ok=True)
    run_dir = events_path.parent.parent.parent
    guard = ToolHangGuard(events_path, ws, run_dir / "interventions.md")
    guard.start()
    message = stop_message(story["id"], story["title"], story["tasks_path"])
    finished = False
    if continue_session:
        attempts = [run_agent(client, ws, env, model_id, RESUME_PROMPT, events_path,
                              resume_from=continue_session, fork=False)]
    else:
        attempts = [run_agent(client, ws, env, model_id, prompt, events_path)]
    resumes = nudges = toolcall_text_resumes = 0
    while not RUN_ABORT.is_set() and not STORY_SKIP.is_set():
        last = attempts[-1]
        if last["error"] and not last["stalled"] and last["session"] and resumes < MAX_AGENT_RESUMES:
            resumes += 1
            print(f"    agent error: {last['error'][:160]} — fork-resuming session in {RESUME_BACKOFF_S}s", flush=True)
            time.sleep(RESUME_BACKOFF_S)
            attempts.append(run_agent(client, ws, env, model_id, RESUME_PROMPT, events_path,
                                      resume_from=last["session"], fork=True))
        elif not last["error"] and not last["stalled"] and last["session"]:
            # A clean stop. A fault in the check itself is the harness's, not the agent's: it is recorded, the
            # agent is not sent the message blind, and the story is taken as it stands.
            checked = derived(REPLY_CHECK_STEP, lambda: _stop_check(events_path, story["id"], ws), None, run=run_dir)
            if checked is None:
                break
            finished, toolcall_as_text = checked
            if finished:
                break
            if toolcall_as_text and toolcall_text_resumes < MAX_TOOLCALL_TEXT_RESUMES:
                toolcall_text_resumes += 1
                why = (f"story {events_path.parent.name}: the agent's last reply was a tool call written as text "
                       f"(not run); continued the session ({toolcall_text_resumes}/{MAX_TOOLCALL_TEXT_RESUMES})")
                print(f"    {why}", flush=True)
                log_intervention(run_dir, why)
            elif nudges >= MAX_NUDGES:
                if on_cap:
                    on_cap(cap_reason(sum(a["seconds"] for a in attempts), nudges), STOP_SENT_BY)
                break
            else:
                nudges += 1
                print(f"    {STOP_SENT_LINE} {nudges} of {MAX_NUDGES} sent", flush=True)
            attempts.append(run_agent(client, ws, env, model_id, message, events_path,
                                      resume_from=last["session"], fork=False))
        else:
            break
    interruptions = guard.stop()
    total = {k: sum(a[k] for a in attempts) for k in ("seconds", "steps", "tool_calls", "compactions")}
    total["tool_interruptions"] = interruptions
    total["tokens"] = {k: sum(a["tokens"][k] for a in attempts) for k in attempts[0]["tokens"]}
    return {**total, "exit": attempts[-1]["exit"], "stalled": attempts[-1]["stalled"],
            "resumes": resumes, "nudges": nudges, "toolcall_text_resumes": toolcall_text_resumes, "errors": [a["error"] for a in attempts if a["error"]],
            "ended_by_operator": STORY_SKIP.is_set(),
            "ended_in_error": bool(attempts[-1]["error"]), "sessions": [a["session"] for a in attempts],
            "finished": finished, "interventions": interventions_of(resumes, nudges, toolcall_text_resumes)}


# Processes that ARE the agent (or its sandbox wrapper): never killed while a story runs.
AGENT_PROC_MARKERS = ("pi-coding-agent", "sandbox-exec", "opencode", "claude ")


def is_agent_process(pid: int, run_dir: Path) -> bool:
    """The agent itself, by its command line with the run's own directory removed: combination
    directories are named after their client (mlxserve-opencode), so the path alone would match."""
    cmd = subprocess.run(["ps", "-o", "command=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    cmd = cmd.replace(str(run_dir), "")
    return cmd == "pi" or cmd.startswith("pi ") or any(m in cmd for m in AGENT_PROC_MARKERS)


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
        pids = {p for p in pids if not is_agent_process(p, ws.resolve().parent)}
    return pids


def kill_pids(pids: set[int]) -> None:
    for p in pids:
        try:
            os.kill(p, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass


def _pgid(pid: int) -> int | None:
    try:
        return os.getpgid(pid)
    except (ProcessLookupError, PermissionError):
        return None


def kill_process_groups(pids: set[int], spare_pgids: set[int]) -> None:
    """Kill each process with everything in its process group. A tool's children can leave the
    workspace (`find /` changes directory as it walks) yet still hold the tool's output pipe, so
    killing only the matching processes leaves the tool call hanging. Groups in spare_pgids (the
    harness's own, the agent's) are never signalled as a whole; their members are killed one by one."""
    groups, singles = set(), set()
    for p in pids:
        g = _pgid(p)
        if g is None:
            continue
        if g in spare_pgids:
            singles.add(p)
        else:
            groups.add(g)
    for sig in (signal.SIGTERM, signal.SIGKILL):
        for g in groups:
            try:
                os.killpg(g, sig)
            except (ProcessLookupError, PermissionError):
                pass
        if sig == signal.SIGTERM:
            kill_pids(singles)
            groups = {g for g in groups if _group_alive(g)}
            if not groups:
                return
            time.sleep(KILL_GRACE_S)


def _group_alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False


# The agent session the harness is running now (run_agent): the process it started, in a session of its own.
AGENT_ROOT_PID: int | None = None


def agent_started_pids(ws: Path) -> set[int]:
    """What the running agent session started outside its own process group: its tools (pi starts each bash tool
    call in a session of its own) and whatever they started. Found by parentage, so a tool that replaced its shell
    and left the workspace, with no workspace path in its command line or working directory, is still found
    (bash 5.2+ runs the last command of -c in place of the shell; `exec` does it in any). The agent's own group
    (its sandbox wrapper, the agent, its helpers) and anything that is the agent by its command line are left out."""
    root = AGENT_ROOT_PID
    if not root:
        return set()
    children: dict[int, list[int]] = {}
    group: dict[int, int] = {}
    for line in subprocess.run(["ps", "-A", "-o", "pid=,ppid=,pgid="], capture_output=True, text=True).stdout.splitlines():
        try:
            pid, ppid, pgid = (int(x) for x in line.split())
        except ValueError:
            continue
        children.setdefault(ppid, []).append(pid)
        group[pid] = pgid
    if root not in group:
        return set()
    found, queue = set(), [root]
    while queue:
        for c in children.get(queue.pop(), []):
            if c not in found:
                found.add(c)
                queue.append(c)
    run_dir = ws.resolve().parent
    return {p for p in found if group[p] != group[root] and not is_agent_process(p, run_dir)}


def kill_workspace_tools(ws: Path) -> None:
    """The hang guard's kill: every tool process in the workspace, and everything the agent started outside its
    own process group, each with its whole group, sparing the agent (and its group) and the harness."""
    everything = workspace_pids(ws)
    tools = (workspace_pids(ws, spare_agent=True) | agent_started_pids(ws)) - {AGENT_ROOT_PID}   # never the session itself
    spare = {os.getpgrp()} | {g for g in map(_pgid, [*(everything - tools), *([AGENT_ROOT_PID] if AGENT_ROOT_PID else [])])
                              if g is not None}
    kill_process_groups(tools, spare)


def kill_strays(ws: Path) -> None:
    """Dev servers or test runners the agent left running would skew the gates and the next story."""
    kill_process_groups(workspace_pids(ws), {os.getpgrp()})


def _median(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def server_stats(server_log: Path | None, t_start: float, t_end: float,
                 earlier: list[tuple[float, float]] | tuple = ()) -> dict:
    """Per-story numbers from the server's own request log (MTPLX), by time window: this attempt's, and each
    earlier attempt's window of a restarted story (attempts.py).

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
        t = r.get("logged_at_s") or 0
        if any(a <= t <= b for a, b in [(t_start, t_end), *earlier]):
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


def wait_for_conditions(wait: bool = True) -> dict:
    """Pause (never skip) until the machine is fit to measure: AC power, no Low Power Mode, nominal thermals.
    wait=False (a cloud model: --no-condition-wait) returns the conditions as they are, at once: the model
    doesn't run on this machine, so its run isn't held up for it (the Sonnet 5.5 reference sat for over an hour
    before a story on a laptop in use, 1 Oct 2026). The story's conditions are recorded either way, and one
    run under poor ones is marked degraded."""
    if not wait:
        return conditions()
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
MEM_REAP_PCT = 30           # below this, the agent's orphaned processes are reaped (containment.py)
MEM_SNAPSHOT_PCT = 20       # below this, record which processes hold the memory, at each new low
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
        self.gpu: list[dict] = []
        self.aborted = threading.Event()
        self.aborted_memory = False
        self.free_min_pct: float | None = None
        self.memory_snapshot: dict | None = None
        self._halt = threading.Event()

    def run(self):
        while not self._halt.wait(CONDITION_POLL_S):
            c = conditions()
            self.samples += 1
            if not conditions_ok(c):
                self.bad.append({**c, "t": time.time()})
            swap = swap_used_gb()
            self.swap_max = max(self.swap_max, swap)
            try:  # informational: a failed GPU reading must not stop the memory and swap guards below
                if (g := hostenv.gpu_sample()):
                    self.gpu.append(g)
            except Exception as e:  # noqa: BLE001
                print(f"    gpu sample failed: {e}", flush=True)
            fp, fp_peak = server_footprint_gb(self.server_port)
            if fp is not None:
                self.footprint_max = max(self.footprint_max or 0.0, fp)
                self.footprint_peak = max(self.footprint_peak or 0.0, fp_peak or 0.0)
            free = mem_free_pct()
            if free is not None and free < MEM_REAP_PCT and CONTAINMENT:
                CONTAINMENT.reap_pressure()
            if free is not None:
                if free < MEM_SNAPSHOT_PCT and (self.free_min_pct is None or free < self.free_min_pct):
                    self._snapshot(free)
                self.free_min_pct = free if self.free_min_pct is None else min(self.free_min_pct, free)
            if self.aborted.is_set():
                continue
            if swap - self.swap_start > SWAP_ABORT_GROWTH_GB:
                self._abort(f"SWAP GUARD: swap grew {swap - self.swap_start:.1f} GB during the story "
                            f"({self.swap_start:.1f} -> {swap:.1f} GB)")
            elif free is not None and free < MEM_FREE_ABORT_PCT:
                self.aborted_memory = True
                self._abort(f"MEMORY GUARD: free memory {free:.0f}% < {MEM_FREE_ABORT_PCT}%")

    def _snapshot(self, free: float) -> None:
        """What held the memory at the story's lowest point so far (the RTX 4090 machine's canvas-pi-03 story 5 lost
        about 28 GB to processes nobody could name afterwards)."""
        try:
            self.memory_snapshot = {"t": time.time(), "free_pct": free, **hostenv.memory_snapshot()}
        except Exception as e:  # noqa: BLE001  informational: must not stop the guards
            print(f"    memory snapshot failed: {e}", flush=True)

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
                "memory_snapshot": self.memory_snapshot,
                "server_footprint_max_gb": self.footprint_max, "server_footprint_peak_gb": self.footprint_peak,
                "gpu": hostenv.summarise_gpu(self.gpu)}


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
        sys.path.insert(0, str(BENCHMARKS / "perf"))
        from thermal import thermal_pressure  # benchmarks/perf/thermal.py
        return thermal_pressure()
    except Exception as e:  # noqa: BLE001 - informational only
        return f"unknown ({e})"


# ---- processed stories and operator control (CONTROL.md) ----------------------------------------
DONE = "DONE"          # the agent finished the story by itself
PARTIAL = "PARTIAL"    # the story was ended before it was complete (dbench skip-story)
CONTROL_DIR = "control"
SKIP_FILE = "skip-story.json"
OPERATOR = "operator"  # who ended a story by request, as public records say it (never the caller's address or name)
SKIP_POLL_S = 5
PROGRESS_POLL_S = 60
# Set when the operator ends the running story: no resume, no nudge; the run goes on to the next story.
STORY_SKIP = threading.Event()


def load_processed(metrics: dict, stories: list[dict]) -> list[dict]:
    """The processed-stories queue. Runs recorded before it existed have only finished stories,
    all ended by the agent itself: those become DONE, in scope order."""
    if "processed" in metrics:
        return metrics["processed"]
    finished = {int(k): v for k, v in metrics["stories"].items() if v.get("finished")}
    return [{"id": s["id"], "title": finished[s["id"]].get("title"), "status": DONE, "ended_by": "agent"}
            for s in stories if s["id"] in finished]


def pending_skip(run: Path, sid: int) -> dict | None:
    """The operator's skip-story request for story sid, if one is waiting. Who sent it (dbench writes the caller's
    address) stays in the git-ignored request: what the harness takes from it goes into public records, so its
    "by" is OPERATOR."""
    f = run / CONTROL_DIR / SKIP_FILE
    try:
        req = json.loads(f.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    return {**req, "by": OPERATOR} if req.get("story") == sid else None


def mark_skip_applied(run: Path, sid: int) -> None:
    f = run / CONTROL_DIR / SKIP_FILE
    if pending_skip(run, sid):
        os.replace(f, f.with_name(f"skip-story-{sid}.applied.json"))


class SkipWatcher(threading.Thread):
    """Watches for the operator's skip-story request for the running story; on one, stops the agent
    (every process in the workspace) and sets STORY_SKIP so nothing resumes or nudges it."""

    def __init__(self, run: Path, sid: int, ws: Path, now=time.time, poll_s: float = SKIP_POLL_S,
                 already_s: float = 0.0):
        super().__init__(daemon=True)
        self.run_dir, self.sid, self.ws = run, sid, ws
        self.now, self.poll_s = now, poll_s
        self.started = now()
        self.already_s = already_s     # agent time of the story's earlier harness attempts: the cap is the story's
        self.request: dict | None = None
        self._halt = threading.Event()

    def elapsed(self) -> float:
        return self.now() - self.started + self.already_s

    def _end(self, req: dict, who: str) -> None:
        self.request = req
        STORY_SKIP.set()
        print(f"    {who} ended story {self.sid} ({req.get('by')}): {req.get('reason')}", flush=True)
        kill_pids(workspace_pids(self.ws))

    def cap(self, reason: str, by: str = CAP_BY) -> None:
        """End the story at the story cap (its time, or the stop message already sent), as an operator skip would."""
        self._end({"story": self.sid, "reason": reason, "by": by, "at": self.now()}, "the story cap")

    def run(self):
        while not self._halt.wait(self.poll_s):
            req = pending_skip(self.run_dir, self.sid)
            if req:
                self._end(req, "operator")
                return
            reason = cap_reason(self.elapsed(), 0)
            if reason:
                self.cap(reason)
                return

    def stop(self) -> dict | None:
        self._halt.set()
        self.join()
        return self.request


def first_event_time(events: Path) -> float | None:
    """Unix time of the first timestamped event in an agent event log (pi: ISO or ms)."""
    if not events.exists():
        return None
    with events.open() as f:
        for line in f:
            try:
                ts = json.loads(line).get("timestamp")
            except (json.JSONDecodeError, AttributeError):
                continue
            if isinstance(ts, str):
                from datetime import datetime
                return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            if isinstance(ts, (int, float)):
                return ts / 1000 if ts > 1e11 else float(ts)
    return None


def reconstruct_agent(client, events: Path) -> dict:
    """Agent totals from a story's event log alone: a skip placed before a restart ends the story
    without starting the agent again, so its record comes from the log it already wrote."""
    tally = progress.EventTally(client, events, empty_state)
    t = tally.update()
    first = first_event_time(events)
    seconds = round(events.stat().st_mtime - first, 1) if first else 0.0
    st = tally.st
    return {"seconds": seconds, "steps": st["steps"], "tool_calls": st["tool_calls"], "compactions": st["compactions"],
            "tool_interruptions": 0, "tokens": st["tokens"], "exit": None, "stalled": False, "resumes": 0,
            "nudges": 0, "errors": [], "ended_in_error": False, "sessions": [st["session"]],
            "ended_by_operator": True, "reconstructed_from_log": True, "interventions": interventions_of(0, 0, 0)}


class ProgressWatcher(threading.Thread):
    """Keeps progress.json current while a story runs: its tasks (from workspace evidence), effort,
    baselines and recent activity. Cheap: git reads and the new tail of the event log, once a minute."""

    def __init__(self, run: Path, scope: dict, stories: list[dict], metrics: dict, live: dict,
                 ws: Path, base: str, tasks: list[dict], tally: progress.EventTally):
        super().__init__(daemon=True)
        self.run_dir, self.scope, self.stories, self.metrics = run, scope, stories, metrics
        self.live, self.ws, self.base, self.tasks, self.tally = live, ws, base, tasks, tally
        self.signature = None
        self._halt = threading.Event()

    def refresh(self) -> None:
        ev = progress.evidence(self.ws, self.base)
        table = progress.task_table(self.tasks, ev)
        sig = progress.tasks_signature(table)
        if sig != self.signature:
            self.signature = sig
            self.live["last_task_change_at"] = time.time()
        now = time.time()
        self.live.update(tasks=table, last_commit_at=ev["last_commit_at"], **self.tally.update(),
                         agent_minutes=round((now - self.live["started_at"]) / 60, 1))
        progress.write_progress(self.run_dir, self.scope, self.stories, self.metrics, self.live)

    def run(self):
        while True:
            try:
                self.refresh()
            except Exception as e:  # noqa: BLE001 - progress is informational; never stop a story for it
                print(f"    progress refresh failed: {e}", flush=True)
            if self._halt.wait(PROGRESS_POLL_S):
                return

    def stop(self) -> None:
        self._halt.set()
        self.join()


# Faults in the harness's own bookkeeping for the story being processed (derived()); kept in its record.
STORY_FAULTS: list[dict] = []
FAULT_ERROR_CHARS = 300
EMPTY_EVIDENCE = {"written": set(), "committed": set(), "named": set(), "last_commit_at": None, "head": ""}
NO_REQUESTS = {"requests": 0}
UNKNOWN_VERDICT = "unknown"


def derived(step: str, fn, default=None, run: Path | None = None):
    """fn(), for a step the story's result doesn't depend on (its profile, time split, summary, …): a fault in it
    is recorded with the story (harness_faults) and in the run's interventions, the step's result is `default`,
    and the story is still scored, committed and recorded. A bug in two such steps lost stories after hours of
    the agent's work (30 Sep and 1 Oct 2026). SystemExit (a guard stopping the run) is not caught.
    What a fault left out can be filled in afterwards from the logs (backfill_timing.py)."""
    try:
        return fn()
    except Exception as e:
        frame = traceback.extract_tb(e.__traceback__)[-1]
        STORY_FAULTS.append({"step": step, "error": f"{type(e).__name__}: {e}"[:FAULT_ERROR_CHARS],
                             "where": f"{Path(frame.filename).name}:{frame.lineno}"})
        print(f"    HARNESS FAULT in {step} ({type(e).__name__}: {str(e)[:160]}); the story is recorded without it",
              flush=True)
        if run is not None:
            derived("interventions log", lambda: log_intervention(
                run, f"harness fault in {step}: {type(e).__name__}: {str(e)[:160]} "
                     f"({Path(frame.filename).name}:{frame.lineno}); the story was recorded without it"))
        return default


def keep_faults(rec: dict) -> None:
    if STORY_FAULTS:
        rec["harness_faults"] = list(STORY_FAULTS)


def log_intervention(run: Path, text: str) -> None:
    f = run / "interventions.md"
    if not f.exists():
        f.write_text("# Interventions\n\nEvery manual or automatic intervention in this run, oldest first. "
                     "The run's numbers should be read with these in mind.\n\n")
    with f.open("a") as f:
        f.write(f"- {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {text}\n")



# ---- a story's attempts and provenance (attempts.py, provenance.py) --------------------------------------------

def begin_attempt(client, events: Path, prior: str | None, started: float, provenance: dict) -> list[dict]:
    """At a harness restart mid-story (prior: the agent's session found in the log), the story's earlier attempts,
    counted from its log, and a mark in the log where this attempt begins. A fresh story has none."""
    if not prior:
        return []
    earlier = attempts.earlier_attempts(client, events, before=started)
    attempts.write_restart_mark(events, started, attempts.next_attempt(earlier), provenance)
    return earlier


def record_attempts(rec: dict, earlier: list[dict]) -> None:
    """rec["agent"] over every attempt of the story, each attempt kept; unchanged for a story run once."""
    if not earlier:
        return
    rec["agent"] = attempts.combine(earlier, rec["agent"], rec["started"], rec["agent_finished"])
    rec["first_started"] = earlier[0]["started"]


def story_time_split(rec: dict, events: Path, server_log: Path) -> dict:
    """Where the story's time went (accounting.py), over each attempt's own window, summed, and checked against
    the agent's own clock (which stops between sessions and while the machine is suspended: accounting.check).
    The time the harness was down between attempts is no attempt's, so it isn't counted."""
    import accounting
    split = time_split(events, server_log, rec["started"], rec["agent_finished"])
    each = (rec.get("agent") or {}).get("attempts") or []
    if len(each) > 1:
        # Each attempt over its own window; this attempt's is the one just computed, unless the harness never ran
        # the agent this time (a skip placed before a restart), when every attempt is one the log recorded.
        splits = [split if a["source"] == "harness" else attempts.split_of(events, server_log, a) for a in each]
        for a, s in zip(each, splits):
            a["time_split"] = s
            if a["source"] == "log":
                # A log gives an attempt's span, its waits between sessions and any time the machine was suspended
                # included; the agent's clock (what the harness records for the attempt it ran) runs only while a
                # session does and the machine is awake. Same meaning for both.
                a["seconds"] = round(s["wall_s"] - s.get("between_sessions_s", 0.0) - s.get("suspended_s", 0.0), 1)
        rec["agent"]["seconds"] = round(sum(a.get("seconds") or 0 for a in each), 1)
        split = attempts.sum_splits(splits)
        if split.get("model"):   # summed splits can't recombine the attempts' draft figures: over every attempt's calls
            split["model"].update(accounting.draft_figures(events, server_log, [(a["started"], a["ended"]) for a in each]))
    acc = split["accounting"]
    clock = accounting.check(split, agent_seconds=(rec.get("agent") or {}).get("seconds"))
    acc["problems"] += [p for p in clock if p not in acc["problems"]]
    acc["ok"] = not acc["problems"]
    return split


def harness_provenance(code_root: Path) -> dict:
    """The harness this process loaded: its commit, whether it had uncommitted edits, and the release it is
    (harness_release: the tag dbench materialised it from, None when it runs from a checkout)."""
    return {**provenance.at_start(code_root), "harness_release": roots.release_tag(code_root)}


def story_provenance(harness: dict, started_under: str, scored_under: str) -> dict:
    """What a story ran under: the harness this process loaded, and the pack version when it was scored; the pack
    version at the story's start too, when the pack's checkout moved while the story ran."""
    out = {**harness, "pack_version": scored_under, "source": provenance.LIVE}
    if started_under != scored_under:
        out["started_under"] = {"pack_version": started_under}
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pack", default=packdir.DEFAULT_PACK,
                    help="the benchmark: its directory under benchmarks/ (default %(default)s)")
    ap.add_argument("--dry-run", action="store_true",
                    help="load the pack and scope, print the stories and the first prompt, run nothing")
    ap.add_argument("--run-dir", type=Path)
    ap.add_argument("--base-url", help="OpenAI-compatible /v1 the agent talks to")
    ap.add_argument("--client", choices=sorted(CLIENTS), default="pi")
    ap.add_argument("--server-log", type=Path, help="server's own per-request JSONL log (MTPLX)")
    ap.add_argument("--model-id")
    ap.add_argument("--scope", help="a named story list in the pack's scope/ (default: the pack's default_scope)")
    ap.add_argument("--epic", help="the stories an epic lists (spec/epics/<name>.md)")
    ap.add_argument("--context-limit", type=int, default=131072)
    ap.add_argument("--output-limit", type=int, default=32768)
    ap.add_argument("--compact-at", type=int, help="tokens of context at which the agent compacts (pi only)")
    ap.add_argument("--client-thinking", choices=PI_THINKING_LEVELS,
                    help="reasoning effort the agent sends with each request, for servers that can't apply one (pi only)")
    ap.add_argument("--no-condition-wait", action="store_true",
                    help="don't wait for AC power and nominal thermals before each story (cloud models)")
    ap.add_argument("--only", help="comma list of story ids to run (smoke tests)")
    ap.add_argument("--from-run", type=Path,
                    help="known-good mode (diagnostic): build on this finished run's code as it was when the story "
                         "before ended. With --only N: that one story. With --from-story N: story N and every later "
                         "story of the scope")
    ap.add_argument("--from-story", type=int, metavar="N",
                    help="with --from-run: run story N and every later story of the scope in order, each built on "
                         "the one before in this run (a known-good continuation)")
    ap.add_argument("--record", action="store_true",
                    help="after each story, commit this run's directory and push (a per-story record)")
    a = ap.parse_args()

    set_pack(a.pack)
    if not a.epic and not a.scope:
        a.scope = PK.default_scope
    scope = PK.scope(scope=a.scope, epic=a.epic)
    stories = scope["stories"]
    if a.only:
        wanted = {int(x) for x in a.only.split(",")}
        stories = [s for s in stories if s["id"] in wanted]
    scope_label = a.scope or (f"epic:{a.epic}" if a.epic else "all")
    # Known-good mode is told plainly which stories to run: one (--only N), or N and every later one (--from-story N).
    if a.from_story is not None:
        if not a.from_run:
            ap.error("--from-story needs --from-run: the finished run whose code the stories are built on")
        if a.only:
            ap.error("--from-run takes --only N or --from-story N, not both")
        in_scope = [s["id"] for s in scope["stories"]]
        if a.from_story not in in_scope:
            ap.error(f"--from-story {a.from_story}: story {a.from_story} is not in the scope "
                     f"({scope_label}: stories {in_scope})")
        stories = scope["stories"][in_scope.index(a.from_story):]
    elif a.from_run:
        if not a.only:
            ap.error("--from-run needs --only N (that one story, built on the reference run's code) or "
                     "--from-story N (story N and every later story of the scope)")
        if len(stories) != 1:
            ap.error("--from-run with --only runs exactly one story; for story N and every later one use "
                     "--from-story N")
    if a.dry_run:
        print(f"pack {PK.name} at {PK.dir}")
        print(f"scope {scope_label}: stories {[s['id'] for s in stories]}")
        print(f"held-out suite: {PK.acceptance or 'none (acceptance reported n/a)'}; gate: {PK.gate}")
        kg = known_good_base(a.from_run.resolve(), stories[0]["id"]) if a.from_run else None
        if kg:
            print(f"known-good base: {kg['from_run']} at {kg['commit'][:12]}, "
                  f"processed {[p['id'] for p in kg['processed']]}")
        if stories:
            print("--- first prompt ---")
            print(render_prompt(stories[0], story_title(stories[0]), kg["processed"] if kg else [], scope))
        return
    missing = [f"--{n.replace('_', '-')}" for n in ("run_dir", "base_url", "model_id") if not getattr(a, n)]
    if missing:
        ap.error(f"{', '.join(missing)} required (or --dry-run)")

    run = a.run_dir.resolve()
    run.mkdir(parents=True, exist_ok=True)
    work = work_dir_for(run)
    link_work_dir(run, work)
    ws = work / WORKSPACE_DIR
    known_good = known_good_base(a.from_run.resolve(), stories[0]["id"]) if a.from_run else None
    if known_good:
        setup_workspace_from(ws, known_good, SPEC)
        install_base_deps(ws)
    else:
        setup_workspace(ws)
    (run / "work_dir.txt").write_text(str(work))
    spec_hash = tree_hash(ws / SPEC_DIR)
    env = agent_env(work)
    if a.client_thinking and a.client != "pi":
        raise SystemExit("--client-thinking applies to pi only")
    client = CLIENTS[a.client](work, thinking=a.client_thinking) if a.client_thinking else CLIENTS[a.client](work)
    client.write_config(a.base_url, a.model_id, a.context_limit, a.output_limit, compact_at=a.compact_at)
    metrics = load_metrics(run)
    metrics.update({"pack": PK.name, "scope": scope_label, "model_id": a.model_id, "client": a.client,
                    "compact_at": a.compact_at, "client_thinking": a.client_thinking})
    if known_good:
        ref = known_good["from_run"]
        metrics.setdefault("known_good", {"from_run": str(ref.relative_to(REPO_ROOT)) if ref.is_relative_to(REPO_ROOT) else str(ref),
                                 "commit": known_good["commit"], "story": known_good["story"],
                                 "spec_updated": known_good.get("spec_updated", False),
                                 # The harness commit that holds this pack's spec (restore_spec): the base's
                                 # own, or the one that updated it.
                                 "spec_commit": sh(["git", "rev-parse", "HEAD"], ws).strip(),
                                 # False: that one story. True: it and every later story of the scope.
                                 "continues": a.from_story is not None})  # kept across restarts
        metrics.setdefault("processed", known_good["processed"])
    processed = load_processed(metrics, scope["stories"])
    metrics["processed"] = processed
    spec_commit = metrics.get("known_good", {}).get("spec_commit") or first_commit(ws)
    if known_good and not (run / history.BASE_DIR / "accept.json").exists():
        # The base's own held-out results, so the story's regressions and repairs can be measured.
        print(f"[known-good] scoring the base (stories {[p['id'] for p in processed]})", flush=True)
        acc = gates.accept(ws, processed, run / history.BASE_DIR, PK.acceptance)
        heldout.write_accept(run / history.BASE_DIR / "accept.json", acc)
        kill_strays(ws)
    derived("progress file", lambda: progress.write_progress(run, scope, stories, metrics, None), run=run)
    # Before any story is recorded: HEAD then is the harness this process loaded (the records move HEAD on).
    harness = harness_provenance(CODE_ROOT)

    for story in stories:
        sid = story["id"]
        if any(p["id"] == sid for p in processed):
            continue
        sdir = run / "stories" / f"{sid:02d}"
        sdir.mkdir(parents=True, exist_ok=True)
        (run / "current_story").write_text(str(sid))
        title = story_title(story)
        prompt = render_prompt(story, title, processed, scope)
        (sdir / "prompt.md").write_text(prompt)
        events = sdir / "agent-events.jsonl"
        STORY_SKIP.clear()
        STORY_FAULTS.clear()
        prior = last_session(client, events)
        # Where the story began: kept across harness restarts, so evidence counts the whole story.
        base_file = sdir / "base-commit"
        continued = bool(prior) and base_file.exists()
        tasks = progress.parse_tasks(SPEC / "stories" / story["dir"] / "tasks.md")
        if not continued:       # a story continued after a restart keeps the file as its agent left it
            begin_progress_file(ws, sid, title, tasks)
        head_before = sh(["git", "rev-parse", "HEAD"], ws).strip()
        base = base_file.read_text().strip() if continued else head_before
        base_file.write_text(base)
        partial_base = [p["id"] for p in processed if p["status"] == PARTIAL]
        live = {"id": sid, "title": title, "status": "running", "started_at": time.time(), "tasks": [],
                "partial_base": partial_base, "baselines": progress.baselines(REPO_ROOT, sid, run)}
        pack_started = provenance.pack_version(PK.dir, PK.name)
        earlier: list[dict] = []
        early = pending_skip(run, sid)
        if early:
            # Placed before a restart: end the story from what the agent already did; don't start it again.
            print(f"[story {sid}] {title} — ended by the operator before the agent restarted", flush=True)
            STORY_SKIP.set()
            rec: dict = {"title": title, "started": time.time(), "engine_settings": engine_settings.for_story(run)}
            rec["agent"] = reconstruct_agent(client, events)
            rec["agent_finished"] = time.time()
            # Every attempt is in the log; with more than one, each is kept and the agent time is theirs, not the
            # log's first-to-last span, which would count the time the harness was down.
            logged = attempts.earlier_attempts(client, events, before=rec["agent_finished"])
            if len(logged) > 1:
                rec["agent"].update(seconds=round(sum(a["seconds"] for a in logged), 1), restarted=True,
                                    harness_attempts=len(logged), attempts=logged)
                rec["first_started"] = logged[0]["started"]
            rec["conditions"] = {**summarise_conditions(0, []), "aborted_swap": False, "aborted_memory": False}
            skip = early
        else:
            print(f"[story {sid}] {title} — agent starting", flush=True)
            rec = {"title": title, "conditions_start": wait_for_conditions(wait=not a.no_condition_wait), "started": time.time(),
                   "engine_settings": engine_settings.for_story(run)}   # the settings of the server this story ran on
            # After a harness restart the story began earlier: its live clock counts the whole story, like its
            # call and token counts, and so does the record (record_attempts).
            live["started_at"] = (first_event_time(events) if prior else None) or rec["started"]
            sampler = ConditionSampler(ws, server_port=urlparse(a.base_url).port)
            sampler.start()
            if prior:
                print(f"[story {sid}] continuing the agent's own session {prior} after a harness restart", flush=True)
                rec["continued_session"] = prior
            earlier = begin_attempt(client, events, prior, rec["started"],
                                    {"harness_commit": harness["harness_commit"], "pack_version": pack_started})
            tally = progress.EventTally(client, events, empty_state)
            watcher = ProgressWatcher(run, scope, stories, metrics, live, ws, base, tasks, tally)
            watcher.start()
            skipper = SkipWatcher(run, sid, ws, already_s=sum(a["seconds"] for a in earlier))
            skipper.start()
            global CONTAINMENT
            CONTAINMENT = containment.StoryContainment(run.name, sid)
            rec["agent"] = run_story_agent(
                client, ws, env, a.model_id, prompt, events,
                {"id": sid, "title": title, "tasks_path": f"spec/stories/{story['dir']}/tasks.md"},
                continue_session=prior, on_cap=skipper.cap)
            rec["agent_finished"] = time.time()
            derived("totals over attempts", lambda: record_attempts(rec, earlier), run=run)
            skip = skipper.stop()
            watcher.stop()
            rec["conditions"] = sampler.stop()
            rec["containment"] = CONTAINMENT.finish()   # kills what is left in the story's scopes
            CONTAINMENT = None
        if rec["conditions"]["aborted_swap"] or rec["conditions"]["aborted_memory"]:
            kill_strays(ws)
            (run / "current_story").write_text("")
        stop_if_machine_unfit(run, sid, rec["conditions"])
        kill_strays(ws)
        (run / "current_story").write_text("")
        if rec["agent"]["steps"] == 0 and not skip:
            # The agent never reached the model: an infrastructure fault, not a story result.
            raise SystemExit(f"[story {sid}] agent made no model calls (exit {rec['agent']['exit']}); "
                             f"see {sdir / 'agent-events.jsonl'}. Not checkpointed.")

        rec["agent_commits"] = int(sh(["git", "rev-list", "--count", f"{head_before}..HEAD"], ws).strip())
        skipped = derived("skipped output lines", lambda: skipped_output(events), run=run)
        if skipped:
            rec["skipped_output"] = skipped
            print(f"[story {sid}] agent output: {skipped['count']} lines were JSON but not events; skipped, kept in "
                  f"the log", flush=True)
        # The backstop behind the sandbox's read-only spec: it should never fire. Where it does, this story is
        # flagged with the files that changed, and the spec is put back for the stories after it.
        if tree_hash(ws / SPEC_DIR) != spec_hash:
            rec["spec_tampered"] = True
            rec["spec_changed_files"] = derived("spec restore", lambda: restore_spec(ws, spec_commit, sid), [], run=run)

        print(f"[story {sid}] agent done in {rec['agent']['seconds']}s; running gates", flush=True)
        rec["provenance"] = derived("provenance", lambda: story_provenance(
            harness, pack_started, provenance.pack_version(PK.dir, PK.name)), run=run)
        rec["gate"] = gates.gate(ws, PK.gate)
        (sdir / "gate.json").write_text(json.dumps(rec["gate"], indent=2))
        kill_strays(ws)
        status = PARTIAL if skip else DONE
        acc = gates.accept(ws, [*processed, {"id": sid, "status": status}], sdir, PK.acceptance)
        heldout.write_accept(sdir / "accept.json", acc)
        rec["accept"] = {k: v for k, v in acc.items() if k != "tests"}
        # Task evidence before the snapshot below, which would make uncommitted work look committed.
        ev = derived("task evidence", lambda: progress.evidence(ws, base), dict(EMPTY_EVIDENCE), run=run)
        if not skip and pending_skip(run, sid):
            # Arrived as the agent finished by itself: the story is DONE; keep the request, unapplied.
            f = run / CONTROL_DIR / SKIP_FILE
            os.replace(f, f.with_name(f"skip-story-{sid}.too-late.json"))

        sh(["git", "add", "-A"], ws, GIT_IDENTITY)
        if sh(["git", "status", "--porcelain"], ws).strip():
            sh(["git", "commit", "-qm", f"harness: snapshot after story {sid} (uncommitted agent work)"], ws, GIT_IDENTITY)
        rec["commit"] = sh(["git", "rev-parse", "HEAD"], ws).strip()
        rec["requests"] = derived("server statistics", lambda: server_stats(
            a.server_log, rec["started"], rec["agent_finished"],
            earlier=[(x["started"], x["ended"]) for x in earlier]), dict(NO_REQUESTS), run=run)
        # Over every attempt of a restarted story; the wall should agree with the agent's own clock, and a
        # disagreement is recorded with the other checks.
        rec["time_split"] = derived("time split", lambda: story_time_split(
            rec, sdir / "agent-events.jsonl", run / "server.log"), run=run)
        import conversation
        rec["conversation"] = derived("conversation profile", lambda: conversation.profile(
            sdir / "agent-events.jsonl", rec.get("first_started", rec["started"]), rec["agent_finished"]), run=run)
        rec["loc"] = derived("lines of code", lambda: loc(ws), {}, run=run)
        derived("workspace mirror", lambda: mirror(ws, run / "workspace"), run=run)
        rec["finished"] = time.time()
        # Where the story stands, from workspace evidence: its tasks, and, if it was ended early,
        # whether later stories can build on it (never stops the run).
        table = derived("task table", lambda: progress.task_table(tasks, ev, rec["gate"]), [], run=run)
        own = acc["by_story"].get(f"{sid:02d}")
        rec.update(status=status, ended_by="operator" if skip else "agent", partial_base=partial_base, tasks=table,
                   end_reason=end_reason(rec["agent"], skip, not any(f["step"] == REPLY_CHECK_STEP for f in STORY_FAULTS)))
        # Beside the evidence, what the agent itself said of each task (its PROGRESS.md): a claim, never proof.
        rec["tasks_claimed"] = derived("claimed task statuses", lambda: progress_file.claimed(ws),
                                       {"file": progress_file.UNPARSEABLE, "tasks": {}}, run=run)
        if partial_base:
            rec["stub_markers"] = derived("stub markers", lambda: progress.stub_markers(ws, base), [], run=run)
            rec["partial_heldout_changes"] = derived("held-out changes", lambda: {
                str(p): progress.heldout_changes(e, acc["tests"], p)
                for p, e in ((p, heldout.read_json(run, f"stories/{p:02d}/accept.json")) for p in partial_base)
                if e is not None}, {}, run=run)
        entry = {"id": sid, "title": title, "status": status, "ended_by": rec["ended_by"],
                 "started_at": rec["started"], "ended_at": rec["agent_finished"],
                 "agent_minutes": round(rec["agent"]["seconds"] / 60, 1), "calls": rec["agent"]["steps"],
                 "output_tokens": rec["agent"]["tokens"]["output"], "compactions": rec["agent"]["compactions"],
                 "last_commit_at": ev["last_commit_at"], "accept": own,
                 "partial_base": partial_base, "tasks": table, "baselines": live["baselines"]}
        if skip:
            health = derived("verdict", lambda: progress.base_health(rec["gate"], table, own, live["baselines"]), {
                "verdict": UNKNOWN_VERDICT, "gate_green": bool(rec["gate"].get("all_green")), "unverified_tasks": [],
                "unverified_implementation_tasks": [], "heldout": own, "heldout_floor": None, "heldout_ok": None},
                run=run)
            rec.update(skip=skip, verdict=health)
            entry.update(reason=skip.get("reason"), by=skip.get("by"), requested_at=skip.get("at"),
                         verdict=health["verdict"], health=health)
            mark_skip_applied(run, sid)
            log_intervention(run, (
                f"story {sid}: ended by the operator ({skip.get('by')}) after {entry['agent_minutes']} agent-min, "
                f"{entry['calls']} calls: {skip.get('reason')}. Recorded PARTIAL. Verdict {health['verdict']}: gate "
                f"{'green' if health['gate_green'] else 'red'}, tasks not verified {health['unverified_tasks'] or 'none'} "
                f"(implementation: {health['unverified_implementation_tasks'] or 'none'}), held-out "
                f"{(own or {}).get('passed')}/{(own or {}).get('total')} (floor {health['heldout_floor']}). "
                f"The run continued with the next story."))
        processed.append(entry)
        metrics["stories"][str(sid)] = rec
        keep_faults(rec)
        save_metrics(run, metrics)
        derived("progress file", lambda: progress.write_progress(run, scope, stories, metrics, None), run=run)
        if a.record:
            import report
            derived("summary", lambda: report.write_summary(run), run=run)
            derived("compacted log", lambda: compact_events(sdir / "agent-events.jsonl"), run=run)
            label = combination_label(run)
            outcome = "done" if status == DONE else "partial (ended by operator)"
            # Recorded with the faults so far; a fault in recording itself leaves the story on the machine, and
            # the next story's record carries it.
            keep_faults(rec)
            save_metrics(run, metrics)
            rec["record"] = derived("record", lambda: record_story(
                REPO_ROOT, run, f"{PK.name} {label} {run.name}: story {sid} {outcome}"),
                {"committed": False, "pushed": False, "error": "recording failed: see harness_faults"}, run=run)
        keep_faults(rec)
        if a.record or STORY_FAULTS:
            save_metrics(run, metrics)
        if a.record:
            r = rec["record"]
            print(f"[story {sid}] recorded: commit {r.get('commit', '-')} pushed={r['pushed']}"
                  f"{'  NOT PUSHED, kept locally; the next story retries' if r.get('unpushed') else ''}"
                  f"{'  ' + r['error'][:200] if r.get('error') else ''}", flush=True)
        print(f"[story {sid}] {status}{' verdict ' + rec['verdict']['verdict'] if skip else ''} "
              f"gate green={rec['gate'].get('all_green')} "
              f"accept {'n/a (no held-out suite)' if acc.get('skipped') else str(acc['passed']) + '/' + str(acc['total'])} "
              f"stalled={rec['agent']['stalled']}"
              f"{' DEGRADED (power/thermal) — timing not comparable' if rec['conditions']['degraded'] else ''}",
              flush=True)
        stop_if_missing_resources(sid, rec["gate"], acc)


def stop_if_machine_unfit(run: Path, sid: int, conditions: dict) -> None:
    """Stop the run if the swap or memory guard stopped the story: it isn't a story result, so nothing is
    checkpointed. The marker and the exit tell run.sh and dbench to wait for the machine to recover before the
    story runs again (machine_fit.py), instead of restarting at once as after a crash."""
    if not (conditions.get("aborted_swap") or conditions.get("aborted_memory")):
        return
    guard = "memory" if conditions.get("aborted_memory") else "swap"
    reason = (f"{guard} guard: swap {conditions.get('swap_start_gb')} -> {conditions.get('swap_max_gb')} GB, "
              f"free memory at least {conditions.get('free_min_pct')}%")
    machine_fit.record_unfit(run, sid, reason, conditions.get("swap_start_gb"), conditions.get("swap_max_gb"),
                             conditions.get("free_min_pct"))
    print(f"[story {sid}] stopped by the {reason}. Not checkpointed; the run resumes once the machine has "
          f"recovered (machine_fit.py).", file=sys.stderr, flush=True)
    sys.exit(machine_fit.EXIT_MACHINE_UNFIT)


def stop_if_missing_resources(sid: int, gate: dict, acc: dict) -> None:
    """Stop the run if the machine couldn't run a story's tests. The agent's work is recorded; only
    the scores are void, and every later story would hit the same wall."""
    fault = gate.get("harness_fault") or acc.get("harness_fault")
    if not fault:
        return
    label = "MISSING RESOURCES" if fault.startswith(gates.MISSING_RESOURCES) else "SCORING INTERRUPTED"
    why = fault.removeprefix(gates.MISSING_RESOURCES).removeprefix(gates.SCORING_INTERRUPTED).strip()
    print(f"{label}: {why}. Story {sid}'s scores are void: fix it, re-score the story "
          f"(gates.py), then re-run to continue with the next story.", file=sys.stderr, flush=True)
    sys.exit(EXIT_MISSING_RESOURCES)


if __name__ == "__main__":
    main()
