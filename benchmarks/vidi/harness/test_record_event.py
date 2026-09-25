"""record_event.py: a run's start, end and failures are committed and pushed, not only its stories,
so a machine that can only be watched through its commits can't fail silently."""
import json
import os
import shutil
import subprocess
from pathlib import Path

HARNESS = Path(__file__).parent
IDENTITY = {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


def repo_with_remote(tmp_path: Path) -> tuple[Path, Path]:
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
    repo = tmp_path / "repo"
    subprocess.run(["git", "clone", "-q", str(remote), str(repo)], check=True, capture_output=True)
    return repo, remote


def last_pushed(remote: Path) -> str:
    return subprocess.run(["git", "--git-dir", str(remote), "log", "-1", "--format=%s", "main"],
                          capture_output=True, text=True).stdout.strip()


def test_records_the_event_in_the_run_dir_and_pushes_it(tmp_path, monkeypatch):
    import record_event
    for k, v in IDENTITY.items():
        monkeypatch.setenv(k, v)
    repo, remote = repo_with_remote(tmp_path)
    run = repo / "combos" / "x" / "benchmarks" / "vidi" / "r1"
    run.mkdir(parents=True)
    res = record_event.record(repo, run, "failed", "the held-out suite can't launch its browser")
    assert res["pushed"], res
    status = json.loads((run / "run-status.json").read_text())
    assert status["state"] == "failed" and "browser" in status["reason"]
    assert last_pushed(remote) == "vidi r1 r1: run failed: the held-out suite can't launch its browser"


def test_a_run_that_refuses_to_start_says_so_in_a_pushed_commit(tmp_path):
    # A copy of the harness in a throwaway repo, a cloud stack, and a held-out suite that can't install.
    repo, remote = repo_with_remote(tmp_path)
    shutil.copytree(HARNESS, repo / "benchmarks/vidi/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    (repo / "stack.env").write_text("CONTEXT_LIMIT=0\nOUTPUT_LIMIT=0\n")
    home = tmp_path / "home"
    install = home / ".local/share/fake-stack"
    install.mkdir(parents=True)
    (install / "install.env").write_text('COMBINATION="x"\nBACKEND="anthropic"\nMODEL_ID="m"\n'
                                         'RUN_BASE="runs/fake"\nCONFIG_FILE="stack.env"\n')
    pack = tmp_path / "pack"
    (pack / "acceptance").mkdir(parents=True)  # no package.json: npm ci fails
    env = {**os.environ, **IDENTITY, "HOME": str(home), "VIDI_PACK_DIR": str(pack),
           "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache/uv"))}
    r = subprocess.run([str(repo / "benchmarks/vidi/harness/run.sh"), "fake-stack", "--run-id", "r9",
                        "--client", "claude", "--record"], env=env, capture_output=True, text=True)
    assert r.returncode != 0
    msg = last_pushed(remote)
    assert msg.startswith("vidi r9 r9: run failed:") and "acceptance suite install failed" in msg, (msg, r.stderr)
