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


def fake_pack(tmp_path: Path) -> Path:
    """The smallest real pack: one story, and a held-out suite directory."""
    pack = tmp_path / "pack"
    (pack / "spec" / "stories" / "001-a").mkdir(parents=True)
    (pack / "spec" / "stories" / "001-a" / "story.md").write_text("# A story\n")
    (pack / "acceptance" / "tests").mkdir(parents=True)
    return pack


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
    shutil.copytree(HARNESS, repo / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    (repo / "stack.env").write_text("CONTEXT_LIMIT=0\nOUTPUT_LIMIT=0\n")
    home = tmp_path / "home"
    install = home / ".local/share/fake-stack"
    install.mkdir(parents=True)
    (install / "install.env").write_text('COMBINATION="x"\nBACKEND="anthropic"\nMODEL_ID="m"\n'
                                         'RUN_BASE="runs/fake"\nCONFIG_FILE="stack.env"\n')
    pack = fake_pack(tmp_path)  # its acceptance/ has no package.json: npm ci fails
    env = {**os.environ, **IDENTITY, "HOME": str(home), "VIDI_PACK_DIR": str(pack),
           "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache/uv"))}
    r = subprocess.run([str(repo / "benchmarks/spec-bench/harness/run.sh"), "fake-stack", "--run-id", "r9",
                        "--client", "claude", "--record"], env=env, capture_output=True, text=True)
    assert r.returncode != 0
    msg = last_pushed(remote)
    assert msg.startswith("vidi r9 r9: run failed:") and "acceptance suite install failed" in msg, (msg, r.stderr)


def test_a_cloud_run_that_completes_exits_0(tmp_path):
    # A cloud stack has no server to stop. run.sh's exit trap once ended on a false test for one,
    # which under `set -e` turned a finished run into exit 1 and stopped the series (opus run-2 → run-3).
    repo, _ = repo_with_remote(tmp_path)
    shutil.copytree(HARNESS, repo / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    (repo / "stack.env").write_text("CONTEXT_LIMIT=0\nOUTPUT_LIMIT=0\n")
    home = tmp_path / "home"
    install = home / ".local/share/fake-stack"
    install.mkdir(parents=True)
    (install / "install.env").write_text('COMBINATION="x"\nBACKEND="anthropic"\nMODEL_ID="m"\n'
                                         'RUN_BASE="runs/fake"\nCONFIG_FILE="stack.env"\n')
    pack = fake_pack(tmp_path)
    (pack / "acceptance" / "node_modules").mkdir(parents=True)
    (pack / "acceptance" / "package-lock.json").write_text("{}")
    # Every tool the run would use succeeds without doing anything; python3 only answers the thermal wait.
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for tool in ("uv", "npm", "npx", "node", "claude"):
        (stubs / tool).write_text("#!/bin/sh\nexit 0\n")
    real_python = shutil.which("python3")
    (stubs / "python3").write_text(f'#!/bin/sh\ncase "$*" in *wait_for_thermal*) echo "  thermal=nominal"; exit 0;; esac\n'
                                   f'exec "{real_python}" "$@"\n')
    for f in stubs.iterdir():
        f.chmod(0o755)
    env = {**os.environ, **IDENTITY, "HOME": str(home), "VIDI_PACK_DIR": str(pack),
           "PATH": f"{stubs}:{os.environ['PATH']}"}
    r = subprocess.run([str(repo / "benchmarks/spec-bench/harness/run.sh"), "fake-stack", "--run-id", "r1",
                        "--client", "claude"], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout[-1500:] + r.stderr[-1500:]


def test_a_run_stopped_for_missing_resources_exits_3_and_records_why(tmp_path):
    """drive.py exits 3 when the machine can't run the tests (e.g. no browser). run.sh must pass the
    3 on (dbench stops rather than restarts on it) and record the reason, not a generic failure."""
    repo, remote = repo_with_remote(tmp_path)
    shutil.copytree(HARNESS, repo / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    (repo / "stack.env").write_text("CONTEXT_LIMIT=0\nOUTPUT_LIMIT=0\n")
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "init"], check=True, env={**os.environ, **IDENTITY})
    subprocess.run(["git", "-C", str(repo), "push", "-q", "origin", "HEAD:main"], check=True, capture_output=True)
    home = tmp_path / "home"
    install = home / ".local/share/fake-stack"
    install.mkdir(parents=True)
    (install / "install.env").write_text('COMBINATION="x"\nBACKEND="anthropic"\nMODEL_ID="m"\n'
                                         'RUN_BASE="runs/fake"\nCONFIG_FILE="stack.env"\n')
    pack = fake_pack(tmp_path)
    (pack / "acceptance" / "node_modules").mkdir(parents=True)
    (pack / "acceptance" / "package-lock.json").write_text("{}")
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for tool in ("npm", "npx", "node", "claude"):
        (stubs / tool).write_text("#!/bin/sh\nexit 0\n")
    real_python, real_uv = shutil.which("python3"), shutil.which("uv")
    (stubs / "python3").write_text(f'#!/bin/sh\ncase "$*" in *wait_for_thermal*) echo "  thermal=nominal"; exit 0;; esac\n'
                                   f'exec "{real_python}" "$@"\n')
    (stubs / "uv").write_text('#!/bin/sh\ncase "$*" in\n'
                              '  *drive.py*) echo "MISSING RESOURCES: the agent\'s e2e tests '
                              'have no browser (browser not installed). Story 3\'s scores are void." >&2; exit 3;;\n'
                              f'  *record_event.py*) exec "{real_uv}" "$@";;\nesac\nexit 0\n')
    for f in stubs.iterdir():
        f.chmod(0o755)
    env = {**os.environ, **IDENTITY, "HOME": str(home), "VIDI_PACK_DIR": str(pack),
           "PATH": f"{stubs}:{os.environ['PATH']}",
           "UV_CACHE_DIR": os.environ.get("UV_CACHE_DIR", str(Path.home() / ".cache/uv"))}
    r = subprocess.run([str(repo / "benchmarks/spec-bench/harness/run.sh"), "fake-stack", "--run-id", "r4",
                        "--client", "claude", "--record"], env=env, capture_output=True, text=True)
    assert r.returncode == 3, r.stdout[-1500:] + r.stderr[-1500:]
    msg = last_pushed(remote)
    assert "missing resources" in msg.lower() and "browser not installed" in msg, (msg, r.stderr[-1500:])


def test_a_reference_stack_puts_each_packs_runs_under_that_pack(tmp_path):
    # One installed reference stack (e.g. Claude Code + Opus, registered from benchmarks/reference/vidi/opus-5.5)
    # runs every pack; a todoodle run must land in benchmarks/reference/todoodle/<stack>/, not among vidi's runs.
    repo, _ = repo_with_remote(tmp_path)
    shutil.copytree(HARNESS, repo / "benchmarks/spec-bench/harness",
                    ignore=shutil.ignore_patterns("__pycache__", ".pytest_cache", "node_modules"))
    shutil.copytree(HARNESS.parent.parent / "todoodle", repo / "benchmarks/todoodle")
    (repo / "stack.env").write_text("CONTEXT_LIMIT=0\nOUTPUT_LIMIT=0\n")
    home = tmp_path / "home"
    install = home / ".local/share/fake-stack"
    install.mkdir(parents=True)
    (install / "install.env").write_text('COMBINATION="reference/fake-stack"\nBACKEND="anthropic"\nMODEL_ID="m"\n'
                                         'RUN_BASE="benchmarks/reference/vidi/fake-stack"\nCONFIG_FILE="stack.env"\n')
    stubs = tmp_path / "bin"
    stubs.mkdir()
    for tool in ("uv", "npm", "npx", "node", "claude"):
        (stubs / tool).write_text("#!/bin/sh\nexit 0\n")
    real_python = shutil.which("python3")
    (stubs / "python3").write_text(f'#!/bin/sh\ncase "$*" in *wait_for_thermal*) echo "  thermal=nominal"; exit 0;; esac\n'
                                   f'exec "{real_python}" "$@"\n')
    for f in stubs.iterdir():
        f.chmod(0o755)
    env = {**os.environ, **IDENTITY, "HOME": str(home), "PATH": f"{stubs}:{os.environ['PATH']}"}
    env.pop("SPEC_BENCH_PACK_DIR", None)
    env.pop("VIDI_PACK_DIR", None)
    r = subprocess.run([str(repo / "benchmarks/spec-bench/harness/run.sh"), "fake-stack", "--pack", "benchmarks/todoodle",
                        "--run-id", "r1", "--client", "claude"], env=env, capture_output=True, text=True)
    assert (repo / "benchmarks/reference/todoodle/fake-stack/r1").is_dir(), r.stdout[-1500:] + r.stderr[-1500:]
    assert not (repo / "benchmarks/reference/vidi/fake-stack/r1").exists()
