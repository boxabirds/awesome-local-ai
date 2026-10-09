"""backup.py: one nightly backup of the bench state to every repository, then a capacity forecast and a staleness check for each.

restic is behind a runner here (a recording fake), so these tests need neither restic nor a remote machine.
"""
import json
import sqlite3
import subprocess
from pathlib import Path

import pytest

import backup

NOW = 1_800_000_000.0
GB = 1_000_000_000


class FakeRestic:
    """Records every command; answers `stats` with a size per repo, `cat config` as present, and fails any repo named in `broken`."""
    def __init__(self, sizes, broken=()):
        self.sizes, self.broken, self.calls = dict(sizes), set(broken), []

    def __call__(self, cmd):
        self.calls.append(cmd)
        repo = cmd[cmd.index("-r") + 1]
        ok = repo not in self.broken
        sub = next(c for c in cmd if c in ("backup", "forget", "stats", "cat", "init"))
        out = json.dumps({"total_size": self.sizes.get(repo, 0)}) if sub == "stats" else ""
        return subprocess.CompletedProcess(cmd, 0 if ok else 1, out, "" if ok else "repository unreachable")


def state_dir(tmp_path):
    s = tmp_path / "state"
    for d in ("collected", "recordings", "judging", "annotate", "keys", "insights", "backups"):
        (s / d).mkdir(parents=True)
    (s / "recording-secret").write_text("x")
    for name in ("conversations", "analytics"):
        con = sqlite3.connect(s / "insights" / f"{name}.db")
        con.execute("create table t(a)")
        con.execute("insert into t values (1)")
        con.commit()
        con.close()
    return s


def config(tmp_path, repos=("/r/local", "sftp:u@backuphost:/r/remote")):
    return backup.Config(state=state_dir(tmp_path), password_file=tmp_path / "pw", free={r: 100 * GB for r in repos}, repos=list(repos))


def test_each_repo_gets_a_backup_with_the_password_file_the_staged_databases_and_without_the_live_ones(tmp_path):
    cfg, fake = config(tmp_path), FakeRestic({})
    backup.run(cfg, fake, now=NOW)
    for repo in cfg.repos:
        b = next(c for c in fake.calls if c[c.index("-r") + 1] == repo and "backup" in c)
        assert "--password-file" in b and str(cfg.password_file) in b
        assert str(cfg.state / "backups" / "staging") in b and str(cfg.state / "collected") in b
        assert str(cfg.state / "backups" / "staging" / "..") not in b
        ex = [b[i + 1] for i, c in enumerate(b) if c == "--exclude"]
        assert "insights/*.db" in ex and "insights/*.db-wal" in ex and "backups" in ex, "the live databases and the backups folder are not backed up as they are"
    staged = cfg.state / "backups" / "staging"
    for name in ("conversations", "analytics"):
        assert sqlite3.connect(staged / f"{name}.db").execute("pragma integrity_check").fetchone() == ("ok",)


def test_old_snapshots_are_forgotten_by_policy_after_each_backup(tmp_path):
    cfg, fake = config(tmp_path), FakeRestic({})
    backup.run(cfg, fake, now=NOW)
    forget = [c for c in fake.calls if "forget" in c]
    assert len(forget) == 2 and all("--keep-daily" in c and "14" in c and "--keep-weekly" in c and "8" in c and "--prune" in c for c in forget)


def test_the_run_records_size_history_and_warns_when_a_target_has_under_a_month_left(tmp_path):
    cfg = config(tmp_path)
    cfg.free["sftp:u@backuphost:/r/remote"] = 40 * GB
    hist = backup.history_file(cfg)
    day = 86400.0
    seed = [{"repo": "sftp:u@backuphost:/r/remote", "t": NOW - 7 * day, "bytes": 10 * GB}, {"repo": "/r/local", "t": NOW - 7 * day, "bytes": 10 * GB}]
    hist.write_text("".join(json.dumps(p) + "\n" for p in seed))
    fake = FakeRestic({"/r/local": 12 * GB, "sftp:u@backuphost:/r/remote": 38 * GB})      # remote grows 4 GB a day, local 0.3
    status = backup.run(cfg, fake, now=NOW)
    remote, local = status["repos"]["sftp:u@backuphost:/r/remote"], status["repos"]["/r/local"]
    assert remote["capacity"]["status"] == "warn" and remote["capacity"]["days_left"] == pytest.approx(10.0)
    assert local["capacity"]["status"] == "ok"
    assert [w for w in status["warnings"] if "backuphost" in w], status["warnings"]
    assert len(hist.read_text().splitlines()) == 4, "this run's two sizes are appended to the history"


def test_one_repo_failing_does_not_stop_the_other_and_is_not_a_good_backup(tmp_path):
    cfg = config(tmp_path)
    fake = FakeRestic({}, broken={"sftp:u@backuphost:/r/remote"})
    status = backup.run(cfg, fake, now=NOW)
    assert status["repos"]["/r/local"]["ok"] and not status["repos"]["sftp:u@backuphost:/r/remote"]["ok"]
    assert status["exit"] == 1 and status["repos"]["/r/local"]["last_good"] == NOW and status["repos"]["sftp:u@backuphost:/r/remote"]["last_good"] is None
    assert any("backuphost" in w and "failed" in w for w in status["warnings"])


def test_a_repo_that_failed_tonight_keeps_its_earlier_last_good_time_and_goes_stale_after_36_hours(tmp_path):
    cfg = config(tmp_path, repos=("/r/local",))
    backup.run(cfg, FakeRestic({}), now=NOW)
    later = NOW + 40 * 3600
    status = backup.run(cfg, FakeRestic({}, broken={"/r/local"}), now=later)
    r = status["repos"]["/r/local"]
    assert r["last_good"] == NOW and r["staleness"]["status"] == "stale"
    assert any("last good backup 40 hours ago" in w for w in status["warnings"])


def test_a_repository_that_does_not_exist_yet_is_initialised_first(tmp_path):
    cfg = config(tmp_path, repos=("/r/new",))

    class NoRepo(FakeRestic):
        def __call__(self, cmd):
            if "cat" in cmd and "config" in cmd:
                self.calls.append(cmd)
                return subprocess.CompletedProcess(cmd, 1, "", "Is there a repository at the following location?")
            return super().__call__(cmd)

    fake = NoRepo({})
    backup.run(cfg, fake, now=NOW)
    subs = [next(c for c in cmd if c in ("cat", "init", "backup")) for cmd in fake.calls if any(c in cmd for c in ("cat", "init", "backup"))]
    assert subs[:3] == ["cat", "init", "backup"]


def test_the_status_file_is_written_for_the_monitor(tmp_path):
    cfg = config(tmp_path)
    backup.run(cfg, FakeRestic({}), now=NOW)
    on_disk = json.loads(backup.status_file(cfg).read_text())
    assert on_disk["at"] == NOW and set(on_disk["repos"]) == set(cfg.repos) and on_disk["exit"] == 0


def test_the_launchd_job_is_rendered_for_a_user_not_stored_in_the_repo(tmp_path):
    import plistlib
    home, script = tmp_path / "home", tmp_path / "repo" / "ops" / "backup" / "backup.py"
    p = plistlib.loads(backup.render_plist(home=home, script=script).encode())
    assert p["Label"] == backup.LAUNCHD_LABEL and p["StartCalendarInterval"] == {"Hour": backup.RUN_HOUR, "Minute": backup.RUN_MINUTE}
    assert p["ProgramArguments"][-1] == str(script) and p["EnvironmentVariables"]["HOME"] == str(home)
    assert p["StandardOutPath"] == str(home / ".dbench" / "bench-backup.log")
