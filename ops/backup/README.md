# Backup of the bench state

The lake (`collected/`), the warehouse and analytics databases (`insights/`), the recordings and the other files under
`~/expts/awesome-local-ai-bench-private/state/` exist on one disk only. This backs them up every day to two restic
repositories: one on this Mac and one on another machine (the RTX 4090 box, over ssh), and after each backup says how long each target has left at
the last week's rate of growth.

Status: **built and tested; not installed.** `test_forecast.py` and `test_backup.py` run without restic (a recording fake
stands in for it). Nothing below has been run against a real restic repository yet.

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
