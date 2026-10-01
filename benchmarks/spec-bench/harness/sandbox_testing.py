"""What the tests that run something in the agent's real sandbox share: the command run as the agent runs it (the
world a run gets, the environment drive.agent_env makes, the workspace as its starting directory), and a stand-in for
the sandbox where a test is about something else."""
from __future__ import annotations

import os
import subprocess
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
    """In place of drive.launch_agent for a test of the session loop that runs a fake agent: no sandbox, the
    environment the harness has with the agent's on top (what the permissive mode is)."""
    return sandbox.Launch(argv=list(cmd), env={**os.environ, **env, **(secrets or {})})


def no_sandbox(monkeypatch) -> None:
    """For a test of the story loop that runs a fake agent as an ordinary process: no sandbox, and the agent sees its
    run's directory where it really is (not at /w, not under /Users/Shared). A test that is about the sandbox does
    not call this."""
    monkeypatch.setattr(drive, "launch_agent", unsandboxed)
    monkeypatch.setattr(sandbox, "view_root", lambda work, enforced=None: work)
    monkeypatch.setattr(sandbox, "tmp_view", lambda view, enforced=None: view / sandbox.TMP_DIR)
    monkeypatch.setattr(sandbox, "place_work_dir", lambda work, root=None, enforced=None: (work.mkdir(parents=True, exist_ok=True), work)[1])
