"""What the tests that run something in the agent's real sandbox share: the command run as the agent runs it (the
world a run gets, the environment drive.agent_env makes, the workspace as its starting directory), and a stand-in for
the sandbox where a test is about something else."""
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
from pathlib import Path

import drive
import sandbox

TEST_TIMEOUT_S = 300


def agent_run(cmd: list[str], own_dir: Path, env: dict | None = None, world: sandbox.World | None = None,
              secrets: dict[str, str] | None = None, timeout: int = TEST_TIMEOUT_S) -> subprocess.CompletedProcess:
    """`cmd` in the real sandbox, as the agent runs it, with `own_dir` as the run's directory. Its working directory is
    the run's workspace (made if missing), so a command names files relative to it, as the agent does."""
    own_dir = Path(own_dir)
    (own_dir / drive.WORKSPACE_DIR).mkdir(parents=True, exist_ok=True)
    world = world or sandbox.World(run=own_dir.name)
    launch = drive.launch_agent(cmd, own_dir, {**drive.agent_env(own_dir), **(env or {})}, secrets, world)
    try:
        return subprocess.run(launch.argv, cwd=own_dir / drive.WORKSPACE_DIR, env=launch.env, pass_fds=launch.fds,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout)
    finally:
        launch.close()


def unsandboxed(cmd: list[str], own_dir: Path, env: dict, secrets: dict[str, str] | None = None,
                world: sandbox.World | None = None) -> sandbox.Launch:
    """In place of drive.launch_agent for a test of the session loop that runs a fake agent: no sandbox, but the same
    allow-listed environment (PATH from the harness, the rest as asked), so a fake agent sees what a real one would."""
    return sandbox.Launch(argv=list(cmd), env=sandbox.process_env({"PATH": os.environ.get("PATH", ""), **env}))


FAKE_IDENTITY = '{"version": "0.0.0", "platform": "test", "policy_hash": "' + "0" * 64 + '"}'
_fake_binary: list[Path] = []


def fake_sandbox_env() -> dict:
    """For a test that runs run.sh (and so `sandbox.py identity`) from a directory with no tools/agent-sandbox: a stand-in
    for the binary that answers `identity` and nothing else. The real one is built by the tests that run in it."""
    if not _fake_binary:
        f = Path(tempfile.mkdtemp(prefix="spec-bench-fake-sandbox-")) / "agent-sandbox"
        f.write_text(f"#!/bin/sh\n[ \"$1\" = identity ] && echo '{FAKE_IDENTITY}'\n")
        f.chmod(f.stat().st_mode | stat.S_IXUSR)
        _fake_binary.append(f)
    return {sandbox.BINARY_ENV: str(_fake_binary[0])}


def no_sandbox(monkeypatch) -> None:
    """For a test of the story loop that runs a fake agent as an ordinary process: no sandbox, and the agent sees its
    run's directory where it really is (not at /w, not under the Mac's shared folder). A test that is about the sandbox does
    not call this."""
    monkeypatch.setattr(drive, "launch_agent", unsandboxed)
    monkeypatch.setattr(sandbox, "view_root", lambda work, enforced=None: work)
    monkeypatch.setattr(sandbox, "tmp_view", lambda view, enforced=None: view / sandbox.TMP_DIR)
