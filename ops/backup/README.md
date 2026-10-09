# Backup of the bench state

## What this is for

The benchmark's results are public (they are in git), but the evidence behind them is not, and it is expensive to make: days of machine
time per run. It lives in the private bench repository's `state/` folder on this Mac, which is git-ignored, so before this backup it
existed once, on one disk.

- **The lake** (`collected/`) is a byte-for-byte copy, pulled from each benchmark machine, of every run's raw logs: what the agent said
  and did, the machine's readings, the model server's log. The public repository keeps only compacted records of them, and a machine
  may clear a run's folder, so the lake is often the only full copy.
- **The warehouse and analytics databases** (`insights/`) are built from the lake and the public records. The benchmarker's
  conversation pages and our analyses read them. They can be rebuilt, slowly, except for anything made in them by hand (labels, reviews).
- **Recordings, judging, annotate and keys** are the rest of that folder.

This job copies all of it, every day, to two places: a repository on this Mac and one on another machine (the RTX 4090 box, over ssh), so
that a dead disk, a bad migration or a deleted folder does not cost us runs. It is not a backup of the public repository (git is that)
or of the benchmark machines' own working files. After each backup it also says how long each target has left at the last week's rate of
growth. **To get something back, read `RESTORE.md`.**

Status: **installed 9 Oct 2026**, running daily at 03:30; the first backups to both repositories were checked by restoring files and
both databases from each. `test_forecast.py` and `test_backup.py` test the logic with a fake restic and, where restic is installed,
with the real one.

## What a run does

1. Takes a consistent copy of each live database with SQLite's online backup and checks the copy (`pragma integrity_check`). The live
   `.db`, `-wal` and `-shm` files are excluded; the copies in `state/backup-staging/` are backed up instead.
2. For each repository: creates it if it isn't there, `restic backup` (deduplicated, compressed, encrypted), then
   `restic forget --keep-daily 14 --keep-weekly 8 --prune`, then `restic stats --mode raw-data` for its size.
3. Appends each repository's size to `state/backups/history.jsonl`, measures the free space where it lives, and forecasts
   (`forecast.py`): the repository's growth between the oldest and newest size within the last 7 days, and the free space divided by it.
   Under 30 days left: a `WARNING:` line. Under a day of history: "not enough history yet". One to seven days: the forecast
   is labelled provisional.
4. Checks the age of each repository's last good backup: over 36 hours is stale.
5. Writes `state/backups/status.json` (what the monitor reads: per repository, ok, last good time, capacity, staleness, warnings).
   Exit code 1 if any repository failed. One failing repository does not stop the other.

## To install (each step needs the owner's yes)

```sh
brew install restic                                           # this Mac only: the backup machine needs just sshd and a directory
mkdir -p ~/.config/bench-backup && chmod 700 ~/.config/bench-backup
openssl rand -base64 32 > ~/.config/bench-backup/password && chmod 600 ~/.config/bench-backup/password
# KEEP A COPY OF THAT PASSWORD ELSEWHERE (a password manager): without it every backup is unreadable.
ssh <backup-host> 'mkdir -p ~/bench-backup'
cp ops/backup/config.example.toml ~/.config/bench-backup/config.toml
uv run ops/backup/backup.py --print-plist > ~/Library/LaunchAgents/com.awesome-local-ai.bench-backup.plist   # paths for this user, not stored in the repo
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.awesome-local-ai.bench-backup.plist
```

Then run it once by hand (`uv run ops/backup/backup.py`), read its output, and restore one file from each repository into a
scratch directory (`restic -r REPO --password-file PW restore latest --target /tmp/restore-test --include PATH`) before trusting it.

## Why Python and not Rust

It is glue around restic, ssh and launchd, with one small calculation; the harness it sits beside is Python, and what matters
here (the forecast and the orchestration) is covered by tests either way. Move it if it grows.
