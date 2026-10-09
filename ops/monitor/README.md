# The monitor

Watches the benchmark without anyone's session being open. Two parts, scheduled separately on the Mac that runs
the benchmarker:

| Part | What | Needs Claude | Schedule |
|---|---|---|---|
| `monitor.py` (detector) | One read-only pass: the benchmarker's `/api/faults` and `/api/state`, `dbench` status on every node (idle machines, queues that don't start, unreachable nodes, failed or restarted jobs, stories with no progress, waits for a fit machine), the run records that changed on origin/main (story flags, a model server's memory climbing between stories, runs that ended unscored, a repair that left something), commits on main by another author or under a test's fixture path, whether main's harness still imports, and a memory sample of a remote Mac that is serving a model. Appends what is new to `ops/monitor-log.jsonl`, rewrites `ops/monitor-status.json`. | no | every 10 min (`TICK_S`) |
| `triage.py` | Gives the log's new lines to `claude -p`, which buckets each one and writes or updates its entry in `ops/anomaly-tracking.md`. Claude may read, run a short list of read-only commands and edit that one file; the script runs the privacy test, commits the file by path and pushes. It records and proposes; it never fixes code. | yes | every 30 min (`TRIAGE_EVERY_S`) |

Python, standard library only: the detector is glue around JSON that `dbench`, `gh`, `git` and the benchmarker
already produce, and it was ported from a script that had run the same checks for a day.

## Status

`ops/monitor-status.json`, rewritten every tick (times in UK local time):

- `state`: `ok`, or `detecting only: triage has not run since <time>; …`, or
  `detecting only: triage failed at <time> (<exit code and message>); …`, or
  `triage stopped: Claude usage limit reached at <time>; detections are still being logged (N waiting)`.
- `detector_last_run`, `triage_last_run`, `triage_outcome`, `triage_message`, `untriaged`, `urgent_untriaged`.

A change of state raises one macOS notification; so does an urgent detection. **Urgent means something needs the owner now:** a machine unreachable for 15 minutes, a job that stopped for good, a queue that is not starting, a story that has not moved for 30 minutes, a run that needs a person to be scored, a commit by another author or under a fixture path, a harness that fails to import. Anything that only costs data quality (a story's time breakdown, a repair that could not finish) is logged for triage and never urgent. The status is for whoever runs the
benchmark: it is not shown in the benchmarker.

The usage-limit state is recognised from how the `claude` run ended: a non-zero exit or an error result whose
text matches the CLI's own words for it (`triage.USAGE_LIMIT`: "usage limit reached", "You've hit your limit",
"You're out of extra usage", "Credit balance is too low", "spend limit reached", `billing_error`,
`rate_limit_error`). The run's full output is kept in `ops/monitor-state/triage-last-output.txt`.

## The backup

The detector also reads `state/backups/status.json` in the private bench repository, written by `ops/backup/backup.py` after every
run (override the path with `BENCH_BACKUP_STATUS`), and logs three facts, none of them urgent: `backup_stale` (a repository's last good
backup is over 36 hours old, judged at each tick, so a job that stopped running shows too), `backup_failed` (the last run failed, with
its error) and `backup_capacity` (under a month of room at the last week's growth, with the figures). The repositories are named
"local" and "remote"; no host name or path is logged.

## Running it

    python3 ops/monitor/monitor.py --dry-run     # what a tick would log; writes nothing
    python3 ops/monitor/monitor.py               # one tick
    python3 ops/monitor/triage.py --no-push      # one triage, without committing
    uv run --quiet --with pytest pytest ops/monitor

    ops/monitor/install.sh detector              # LaunchAgent com.awesome-local-ai.monitor-detector
    ops/monitor/install.sh triage                # LaunchAgent com.awesome-local-ai.monitor-triage
    ops/monitor/install.sh all --print           # show the plists without installing
    launchctl bootout gui/$(id -u)/com.awesome-local-ai.monitor-detector    # stop one

## Files

`ops/monitor-log.jsonl`, `ops/monitor-status.json` and `ops/monitor-state/` (the detector's memory, triage's
bookkeeping, memory samples, the agents' output) are written where the monitor runs and are git-ignored. Machines
are named by hardware in all of them; node names are read from `dbench` at run time and never stored.
