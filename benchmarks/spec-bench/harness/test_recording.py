"""drive.py's recording path: each run's agent has a temporary directory of its own (item 2), and the conversation
log committed with each story is lossless (item 4).

Temp dir dimensions: the agent's environment; behaviour in the real sandbox (skipped where the platform's sandbox
tool is missing): own temp usable, /tmp and another run's temp hidden, the held-out suite's scratch hidden, mktemp
still works.
Log dimensions: round trip (every non-delta event identical bar home redaction; deltas dropped but the first of each
model call); timing kept (accounting and conversation give the same answer as from the full log); size; the readers
(claims, annotate, history, progress) read it as before; publishing leaves it whole up to its own cap."""
from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

import pytest

import drive
import publicise
import hostenv
import sandbox
from sandbox_testing import agent_run

HOME = str(Path.home())
T0 = 1_790_000_000.0
MIN_COMPRESSION = 10     # the lossless log is at least this many times smaller than the full log (real: ~44x)


# ======================= item 2: a temporary directory per run =======================

def test_the_agent_s_tmpdir_is_its_own_run_s(tmp_path):
    work = tmp_path / "work" / "run-a"
    env = drive.agent_env(work, view=work)
    own = work / drive.AGENT_TMP
    assert own.is_dir()
    assert env["TMPDIR"] == env["TMP"] == env["TEMP"] == str(sandbox.tmp_view(work, enforced=True) if not hostenv.IS_MAC
                                                              else own)


def test_two_runs_get_different_temp_dirs(tmp_path):
    a, b = drive.agent_env(tmp_path / "a", view=tmp_path / "a"), drive.agent_env(tmp_path / "b", view=tmp_path / "b")
    assert (tmp_path / "a" / drive.AGENT_TMP).is_dir() and (tmp_path / "b" / drive.AGENT_TMP).is_dir()
    assert (tmp_path / "a" / drive.AGENT_TMP) != (tmp_path / "b" / drive.AGENT_TMP)


needs_sandbox = pytest.mark.needs_sandbox      # conftest.py: skipped where the sandbox tool is missing


@pytest.fixture
def two_runs():
    """Two runs' work dirs where real runs keep them (the sandbox hides WORK_ROOT but the agent's own)."""
    tag = uuid.uuid4().hex[:8]
    mine, other = drive.WORK_ROOT / f"_test_tmp_mine_{tag}", drive.WORK_ROOT / f"_test_tmp_other_{tag}"
    for d in (mine, other):
        (d / "workspace").mkdir(parents=True, exist_ok=True)
    try:
        yield mine, other
    finally:
        shutil.rmtree(mine, ignore_errors=True)
        shutil.rmtree(other, ignore_errors=True)


def _in_sandbox(own: Path, script: str) -> subprocess.CompletedProcess:
    return agent_run(["/bin/sh", "-c", script], own)


@needs_sandbox
def test_the_agent_writes_and_reads_its_own_temp_dir(two_runs):
    mine, _ = two_runs
    r = _in_sandbox(mine, 'echo mine > "$TMPDIR/f" && cat "$TMPDIR/f"')
    assert r.returncode == 0 and r.stdout.strip() == "mine", r.stderr
    assert (mine / drive.AGENT_TMP / "f").read_text().strip() == "mine"          # the run's own tmp, on the host




# ======================= packages outside the workspace =======================
# Node and TypeScript look for packages in node_modules of every directory above the workspace. The Macs had
# ~/node_modules/@types/node: Sonnet 5.5 v2-r1 (1 Oct 2026) never declared @types/node, its build passed where the
# agent worked and failed from a clean clone, and the run has no score of record.

@pytest.fixture
def run_under_a_home_with_packages():
    """A run's work dir under a stand-in for the home directory that has node_modules and a package.json, placed
    where the sandbox hides nothing else (not under WORK_ROOT or a temp dir, which are hidden anyway)."""
    home = Path.home() / f".spec-bench-sandbox-test-{uuid.uuid4().hex[:8]}"
    own = home / "bench" / "work" / "run"
    (own / "workspace" / "node_modules" / "mine").mkdir(parents=True)
    (own / "workspace" / "node_modules" / "mine" / "index.js").write_text("module.exports = 'mine';\n")
    (home / "node_modules" / "leak").mkdir(parents=True)
    (home / "node_modules" / "leak" / "index.js").write_text("module.exports = 'leaked';\n")
    (home / "package.json").write_text('{"name": "home", "private": true}\n')
    try:
        yield home, own
    finally:
        shutil.rmtree(home, ignore_errors=True)


@needs_sandbox
def test_the_agent_cannot_read_packages_above_its_run(run_under_a_home_with_packages):
    home, own = run_under_a_home_with_packages
    r = _in_sandbox(own, f'cat "{home}/node_modules/leak/index.js"; ls "{home}/node_modules"; cat "{home}/package.json"')
    assert "leaked" not in r.stdout and "leak" not in r.stdout and '"home"' not in r.stdout, r.stdout


@needs_sandbox
@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_node_resolves_the_workspace_s_packages_and_none_from_above(run_under_a_home_with_packages):
    home, own = run_under_a_home_with_packages
    outside = subprocess.run(["node", "-e", "console.log(require('leak'))"], cwd=own / "workspace", capture_output=True, text=True)
    assert outside.stdout.strip() == "leaked"                  # the leak is real without the sandbox
    r = _in_sandbox(own, "node -e \"console.log(require('mine'))\"; node -e \"console.log(require('leak'))\"")
    assert "mine" in r.stdout and "leaked" not in r.stdout and "Cannot find module 'leak'" in r.stderr, r.stderr[-600:]

def test_claude_code_is_told_to_keep_its_temp_files_in_the_run_s_own(tmp_path):
    env = drive.agent_env(tmp_path / "run-a", view=tmp_path / "run-a")
    assert env["CLAUDE_CODE_TMPDIR"] == env["TMPDIR"]


@needs_sandbox
def test_claude_code_s_temp_dir_works_in_the_sandbox_when_the_shared_one_exists(two_runs):
    """1 Oct 2026, the Sonnet 5.5 reference run: Claude Code keeps its temp files in ${CLAUDE_CODE_TMPDIR:-/tmp}/claude-<uid>.
    With /tmp denied, the sandboxed agent couldn't see that /tmp/claude-<uid> (made by any other Claude Code on the
    machine) existed, and its mkdir failed with EEXIST: the preflight's Claude session never started."""
    mine, _ = two_runs
    shared = Path("/tmp") / f"claude-{os.getuid()}"
    made = not shared.exists()
    shared.mkdir(exist_ok=True)
    try:
        r = _in_sandbox(mine, 'd="${CLAUDE_CODE_TMPDIR:-/tmp}/claude-$(id -u)"; mkdir -p "$d" && echo ok > "$d/f" && cat "$d/f"')
        assert r.returncode == 0 and r.stdout.strip() == "ok", r.stderr
    finally:
        if made:
            shared.rmdir()

@needs_sandbox
def test_another_run_s_temp_dir_is_not_visible(two_runs):
    mine, other = two_runs
    drive.agent_env(other)
    (other / drive.AGENT_TMP / "leftover").write_text("other run")
    r = _in_sandbox(mine, f'cat "{other / drive.AGENT_TMP / "leftover"}"; ls "{other / drive.AGENT_TMP}"')
    assert "other run" not in r.stdout and "leftover" not in r.stdout


@needs_sandbox
def test_what_another_run_left_in_tmp_is_not_visible(two_runs):
    """A run found another run's leftover git worktree at /tmp/vidi-baseline."""
    mine, _ = two_runs
    leftover = Path("/tmp") / f"_test-leftover-{uuid.uuid4().hex[:8]}"
    leftover.mkdir()
    try:
        (leftover / "HEAD").write_text("other run's worktree")
        r = _in_sandbox(mine, f'cat "{leftover}/HEAD"; ls /tmp')
        assert "other run's worktree" not in r.stdout and leftover.name not in r.stdout
    finally:
        shutil.rmtree(leftover, ignore_errors=True)


@needs_sandbox
def test_the_held_out_suite_s_scratch_is_not_visible(two_runs):
    """The suite keeps its app's state in os.tmpdir()/vidi-accept-*: the harness's temp dir (/tmp on Linux, the
    user temp dir on macOS), outside the sandbox."""
    mine, _ = two_runs
    scratch = Path(tempfile.mkdtemp(prefix="vidi-accept-", dir=tempfile.gettempdir()))
    try:
        (scratch / "board.json").write_text("suite state")
        r = _in_sandbox(mine, f'cat "{scratch}/board.json"; ls "{scratch.parent}"')
        assert "suite state" not in r.stdout and scratch.name not in r.stdout
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


@needs_sandbox
def test_mktemp_and_git_still_work_in_the_sandbox(two_runs):
    """Agents run `mktemp -d` (canvas-mlx-01 story 4) and git; macOS's mktemp ignores TMPDIR."""
    mine, _ = two_runs
    r = _in_sandbox(mine, 'd=$(mktemp -d) && echo ok > "$d/f" && cat "$d/f" && rm -r "$d" && '
                          'git init -q . && git -c user.name=a -c user.email=a@a commit -q --allow-empty -m x && echo git-ok')
    assert r.returncode == 0 and r.stdout.split() == ["ok", "git-ok"], r.stderr
    assert "error" not in r.stderr.lower(), r.stderr    # no xcrun cache complaints on every git call


# ======================= item 4: lossless conversation logs =======================

def _pi_call(t: float, n_deltas: int, text: str, tool: str) -> list[dict]:
    """A pi model call as pi streams it: every message_update repeats the partial message so far."""
    out = [{"_rx": t, "type": "message_start", "message": {"role": "assistant", "content": []}}]
    for i in range(1, n_deltas + 1):
        out.append({"_rx": t + i * 0.05, "type": "message_update",
                    "assistantMessageEvent": {"type": "text_delta", "delta": text[i - 1:i]},
                    "message": {"role": "assistant", "content": [{"type": "text", "text": text[:i]}]}})
    end = t + n_deltas * 0.05 + 0.1
    out.append({"_rx": end, "type": "message_end", "message": {
        "role": "assistant", "stopReason": "toolUse",
        "content": [{"type": "thinking", "thinking": "think " * 400}, {"type": "text", "text": text},
                    {"type": "toolCall", "id": f"t{t}", "name": "read", "arguments": {"path": f"{HOME}/w/{tool}"}}],
        "usage": {"input": 1000, "output": n_deltas, "cacheRead": 5000, "cacheWrite": 0}}})
    out.append({"_rx": end, "type": "tool_execution_start", "toolCallId": f"t{t}", "toolName": "read",
                "args": {"path": f"{HOME}/w/{tool}"}})
    out += [{"_rx": end + 0.01 * k, "type": "tool_execution_update", "partialResult": "x" * 100} for k in range(3)]
    out.append({"_rx": end + 0.5, "type": "tool_execution_end", "toolCallId": f"t{t}", "toolName": "read",
                "result": {"content": [{"type": "text", "text": "file body " * 800}]}, "isError": False})
    return out


def _story(calls: int, n_deltas: int = 60) -> list[dict]:
    ev = [{"_rx": T0, "type": "session", "id": "s1", "cwd": f"{HOME}/.vidi-bench/work/x"},
          {"_rx": T0, "type": "agent_start"}]
    for i in range(calls):
        ev += _pi_call(T0 + 1 + i * 10, n_deltas, f"call {i} " + "word " * 30, f"f{i}.ts")
    return ev + [{"_rx": T0 + 2 + calls * 10, "type": "agent_end"}]


def _raw(tmp_path: Path, events: list[dict], extra_lines: str = "") -> Path:
    raw = tmp_path / "stories" / "01" / "agent-events.jsonl"
    raw.parent.mkdir(parents=True, exist_ok=True)
    raw.write_text("".join(json.dumps(e, separators=(",", ":")) + "\n" for e in events) + extra_lines)
    return raw


def _read_gz(gz: Path) -> list[dict]:
    with gzip.open(gz, "rt") as f:
        return [json.loads(l) for l in f if l.strip()]


def _redacted(e: dict) -> dict:
    return json.loads(json.dumps(e).replace(HOME, "~"))


def _plain(gz: Path, dest: Path) -> Path:
    with gzip.open(gz, "rt") as src:
        dest.write_text(src.read())
    return dest


def test_other_files_keep_the_512_kb_cap(tmp_path):
    run = tmp_path / "run"
    run.mkdir()
    (run / "big.json").write_text("x" * (publicise.DEFAULT_SIZE_LIMIT + 1))
    assert drive.make_publishable(run) == [str(run / "big.json")]


def test_the_publish_gate_still_reads_the_log(tmp_path):
    """heldout.staged_problems treats the log as the agent's own work (it never saw the suite), as before."""
    import publicise
    assert publicise.is_own_work("combinations/x/benchmarks/vidi/r/stories/01/agent-events.compact.jsonl.gz")
    assert not publicise.is_private("combinations/x/benchmarks/vidi/r/stories/01/agent-events.compact.jsonl.gz")
