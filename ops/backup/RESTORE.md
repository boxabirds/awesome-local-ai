# Restoring the bench state from a backup

## What this is

The benchmark's raw evidence (every run's logs and machine readings, and the databases built from them) lives in one folder on one Mac and
is not in git. A daily job backs it up to two repositories; this explains how to get it back. It is written to be read by someone who has
not seen the system before.

This sits beside two backup repositories of the bench state (the lake, the warehouse and analytics databases, recordings and
neighbours). Both hold the same data: one on the Mac that makes the backups, one on another machine, reached over ssh. They are
[restic](https://restic.net) repositories (format version 2): encrypted, compressed, deduplicated. **You cannot read them without
restic and the repository password.** Nothing in them is plain text.

## What you need

1. **restic**, version 0.14 or newer (`brew install restic`; `apt install restic` or the release binary on Linux).
2. **The repository password.** It is not in this file. The backup job reads it from `~/.config/bench-backup/password`; the owner keeps
   another copy in a password manager. Without it the backups are unrecoverable.
3. **Access to the repository:** a path for a local one; for the remote one, ssh to the machine that holds it (the job uses
   `sftp:<host>:<directory>/repo`; the host and directory are in `~/.config/bench-backup/config.toml`, or in this file's own location).

In the commands below set these once (use your own paths):

    export RESTIC_REPOSITORY=<the repository, e.g. ~/bench-backup-local/repo or sftp:<host>:<directory>/repo>
    export RESTIC_PASSWORD_FILE=<a file holding the password>

## Check that you can open it

    restic cat config              # prints the repository id: the password is right
    restic snapshots               # one line per backup run, newest last; the Time and Size columns say which to use
    restic check                   # reads the structure back; "no errors were found". Add --read-data to read every byte (slow)

## Restore everything

    restic restore latest --target /path/to/empty/folder

Files come back under the target at their **original absolute path**, for example
`<target>/Users/<user>/expts/awesome-local-ai-bench-private/state/collected/...`. Move or copy the `state/` folder to where it belongs
(`~/expts/awesome-local-ai-bench-private/state/`). Use a snapshot id from `restic snapshots` instead of `latest` for an earlier day.

## Restore part of it

    restic restore latest --target /tmp/restore --include '<absolute path to a folder or file>'

or browse it as a folder (needs macFUSE on a Mac, FUSE on Linux) and copy what you want:

    mkdir /tmp/backup-view && restic mount /tmp/backup-view

## The two databases

The live `conversations.db` and `analytics.db` are **not** backed up as they are (a database being written to can be copied torn).
The backup holds a consistent copy of each, taken with SQLite's online backup and integrity-checked, in the snapshot at
`<state>/backup-staging/conversations.db` and `<state>/backup-staging/analytics.db`. Restore those two files, put them at
`<state>/insights/conversations.db` and `<state>/insights/analytics.db`, and check them:

    sqlite3 conversations.db 'pragma integrity_check'      # prints ok

If the databases are lost but the lake (`state/collected/`) and the public repository are intact, the warehouse can be rebuilt
(`dbench ingest`, see `ops/RUNBOOK-lake-warehouse.md`), though that is slow and anything hand-made in them (labels, reviews) is not
rebuildable. Analytics is rebuilt with `dbench analyse`.

## After a total loss, in this order

1. Install restic and put the password file back.
2. Restore the snapshot (above) and move `state/` into the private bench repository's folder.
3. Clone the public repository and the private bench repository if they are gone too (the lake and databases are only the *state*).
4. Start `dbench collect` (it resumes from the lake's copies) and the benchmarker.
5. Run one backup by hand (`uv run ops/backup/backup.py`) and read its output before the nightly job runs again.

## Things that bite

- `restic restore` **overwrites** files that already exist at the target (its `--overwrite` default is `always`). Restore into an empty folder and move files in; never straight over the live state.
- The remote repository needs the machine to be up (it dual-boots: if it is in Windows, ssh fails; wait and retry).
- A wrong password says "wrong password or no key found"; a missing repository says "Is there a repository at the following location?".
- Do not copy files into a repository folder by hand, and do not delete files from it: restic manages `data/`, `index/`, `snapshots/`,
  `keys/` and `locks/` itself. A stale lock after a crash is cleared with `restic unlock`.
