"""One nightly backup of the bench state (the lake, the warehouse, the analytics and their neighbours) to every configured restic repository,
then, for each, a capacity forecast and a staleness check (forecast.py). Run by launchd once a day; see README.md.

    uv run ops/backup/backup.py --config ~/.config/bench-backup/config.toml
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import subprocess
import sys
import time
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

import forecast

DATABASES = ("conversations", "analytics")          # state/insights/<name>.db: staged by SQLite's online backup, never copied live
STATE_PATHS = ("collected", "recordings", "judging", "annotate", "keys", "recording-secret", "insights")   # relative to state/
EXCLUDES = ("insights/*.db", "insights/*.db-wal", "insights/*.db-shm", "insights/conv_full.db.zst", "backups")
KEEP_DAILY, KEEP_WEEKLY = "14", "8"
STAGING = Path("backups") / "staging"
HISTORY, STATUS = "history.jsonl", "status.json"


@dataclass
class Config:
    state: Path                                  # ~/expts/awesome-local-ai-bench-private/state
    password_file: Path                          # the restic password, mode 600
    repos: list[str] = field(default_factory=list)   # restic repository URLs: a path, or sftp:user@host:/path
    free: dict = field(default_factory=dict)         # repo -> free bytes (tests); otherwise measured by free_bytes()
    ssh_hosts: dict = field(default_factory=dict)    # sftp repo -> ssh target to run df on


def history_file(cfg: Config) -> Path:
    return cfg.state / "backups" / HISTORY


def status_file(cfg: Config) -> Path:
    return cfg.state / "backups" / STATUS


def stage_databases(cfg: Config) -> Path:
    """A consistent copy of each live database (SQLite's online backup), checked, in staging/ (replaced each run)."""
    staged = cfg.state / STAGING
    shutil.rmtree(staged, ignore_errors=True)
    staged.mkdir(parents=True)
    for name in DATABASES:
        src = sqlite3.connect(f"file:{cfg.state / 'insights' / (name + '.db')}?mode=ro", uri=True)
        dst = sqlite3.connect(staged / f"{name}.db")
        src.backup(dst)
        check = dst.execute("pragma integrity_check").fetchone()
        dst.close()
        src.close()
        if check != ("ok",):
            raise RuntimeError(f"{name}.db: integrity check of the staged copy gave {check}")
    return staged


def restic(cfg: Config, repo: str, *args: str) -> list[str]:
    return ["restic", "-r", repo, "--password-file", str(cfg.password_file), *args]


def backup_one(cfg: Config, run, repo: str, staged: Path) -> int:
    """Back up to one repo (initialising it first if it isn't there), apply the retention policy, return its size in bytes."""
    if run(restic(cfg, repo, "cat", "config")).returncode != 0:
        init = run(restic(cfg, repo, "init"))
        if init.returncode != 0:
            raise RuntimeError(f"init failed: {init.stderr.strip()}")
    paths = [str(cfg.state / p) for p in STATE_PATHS] + [str(staged)]
    flags = [x for e in EXCLUDES for x in ("--exclude", e)]
    done = run(restic(cfg, repo, "backup", "--tag", "bench-state", *flags, *paths))
    if done.returncode != 0:
        raise RuntimeError(f"backup failed: {done.stderr.strip()}")
    run(restic(cfg, repo, "forget", "--keep-daily", KEEP_DAILY, "--keep-weekly", KEEP_WEEKLY, "--prune"))
    stats = run(restic(cfg, repo, "stats", "--mode", "raw-data", "--json"))
    if stats.returncode != 0:
        raise RuntimeError(f"stats failed: {stats.stderr.strip()}")
    return int(json.loads(stats.stdout)["total_size"])


def free_bytes(cfg: Config, repo: str) -> int:
    """Free space where the repository lives: a local path here, an sftp repository's host over ssh (df)."""
    if repo in cfg.free:
        return cfg.free[repo]
    if repo.startswith("sftp:"):
        host, _, path = repo[len("sftp:"):].partition(":")
        out = subprocess.run(["ssh", host, "df", "-B1", "--output=avail", path], capture_output=True, text=True, check=True).stdout
        return int(out.strip().splitlines()[-1])
    path = Path(repo)
    while not path.exists():
        path = path.parent
    return shutil.disk_usage(path).free


def read_history(cfg: Config) -> list[dict]:
    f = history_file(cfg)
    return [json.loads(line) for line in f.read_text().splitlines() if line.strip()] if f.exists() else []


def previous_good(cfg: Config) -> dict:
    f = status_file(cfg)
    if not f.exists():
        return {}
    return {repo: r.get("last_good") for repo, r in json.loads(f.read_text()).get("repos", {}).items()}


def run(cfg: Config, runner=None, now: float | None = None) -> dict:
    """One backup of every repo. A repo that fails does not stop the others. Returns (and writes) the status for the monitor."""
    runner = runner or (lambda cmd: subprocess.run(cmd, capture_output=True, text=True))
    now = time.time() if now is None else now
    (cfg.state / "backups").mkdir(parents=True, exist_ok=True)
    earlier = previous_good(cfg)
    status: dict = {"at": now, "repos": {}, "warnings": [], "exit": 0}
    try:
        staged = stage_databases(cfg)
    except Exception as e:   # no repo can be backed up without the staged databases
        status.update(exit=1, warnings=[f"databases not staged: {e}"])
        status_file(cfg).write_text(json.dumps(status, indent=1))
        return status
    appended = []
    for repo in cfg.repos:
        r: dict = {"ok": False, "last_good": earlier.get(repo)}
        try:
            size = backup_one(cfg, runner, repo, staged)
            r.update(ok=True, last_good=now, bytes=size)
            appended.append({"repo": repo, "t": now, "bytes": size})
        except Exception as e:
            r["error"] = str(e)
            status["exit"] = 1
            status["warnings"].append(f"{repo}: backup failed: {e}")
        mine = [p for p in read_history(cfg) + appended if p["repo"] == repo]
        if r["ok"]:
            r["capacity"] = forecast.forecast(mine, free_bytes(cfg, repo), now)
            if r["capacity"]["status"] == "warn":
                status["warnings"].append(f"{repo}: {r['capacity']['message']}")
        r["staleness"] = forecast.staleness(r["last_good"], now)
        if r["staleness"]["status"] == "stale":
            status["warnings"].append(f"{repo}: {r['staleness']['message']}")
        status["repos"][repo] = r
    with history_file(cfg).open("a") as f:
        f.writelines(json.dumps(p) + "\n" for p in appended)
    status_file(cfg).write_text(json.dumps(status, indent=1))
    return status


def load_config(path: Path) -> Config:
    raw = tomllib.loads(Path(path).expanduser().read_text())
    return Config(state=Path(raw["state"]).expanduser(), password_file=Path(raw["password_file"]).expanduser(), repos=list(raw["repos"]))


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="~/.config/bench-backup/config.toml")
    cfg = load_config(Path(ap.parse_args(argv).config))
    status = run(cfg)
    for repo, r in status["repos"].items():
        print(f"{repo}: {'ok' if r['ok'] else 'FAILED'}; {r.get('capacity', {}).get('message', '')}; {r['staleness']['message']}")
    for w in status["warnings"]:
        print(f"WARNING: {w}")
    return status["exit"]


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
