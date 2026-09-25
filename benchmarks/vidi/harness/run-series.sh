#!/usr/bin/env bash
# run-series.sh -- run several benchmark runs strictly ONE AFTER ANOTHER (never in parallel).
#
#   benchmarks/vidi/harness/run-series.sh <install-id> --runs run-2,run-3 [--client claude] [--background]
#   benchmarks/vidi/harness/run-series.sh --status          # what the background series is doing
#   benchmarks/vidi/harness/run-series.sh --stop            # stop it (the current run's progress is kept)
#
# Each run is `run.sh <install-id> --run-id <run> --record [--client …]`: it resumes at the first
# unfinished story, and commits and pushes each story as it finishes. The next run starts only when the
# previous one has exited. --background detaches the series, keeps the machine awake (caffeinate on
# macOS), and writes ~/.vidi-bench/series.log and ~/.vidi-bench/series.pid.
set -uo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="$HOME/.vidi-bench"
LOG="$STATE_DIR/series.log"
PIDFILE="$STATE_DIR/series.pid"
mkdir -p "$STATE_DIR"

running_pid() { [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null && cat "$PIDFILE"; }

case "${1:-}" in
  --status)
    if pid="$(running_pid)"; then echo "series running (pid $pid); log: $LOG"; grep -E "^=== |\[story .*(starting|done|gate)" "$LOG" | tail -8
    else echo "no series running"; [[ -f "$LOG" ]] && tail -3 "$LOG"; fi
    exit 0 ;;
  --stop)
    if pid="$(running_pid)"; then
      pkill -TERM -P "$pid" 2>/dev/null; kill -TERM "$pid" 2>/dev/null
      pkill -f "harness/run.sh" 2>/dev/null; pkill -f "drive.py --run-dir" 2>/dev/null
      echo "stopped series $pid (re-run the same command to resume where it stopped)"; rm -f "$PIDFILE"
    else echo "no series running"; fi
    exit 0 ;;
  ""|-h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

INSTALL_ID="$1"; shift
RUNS=""; CLIENT=""; BACKGROUND=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runs) RUNS="$2"; shift 2 ;;
    --client) CLIENT="$2"; shift 2 ;;
    --background) BACKGROUND=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$RUNS" ]] || { echo "--runs run-a,run-b is required" >&2; exit 2; }
# The background copy is started with SERIES_CHILD=1: its own pid is the one in the pid file.
if [[ -z "${SERIES_CHILD:-}" ]] && pid="$(running_pid)"; then echo "a series is already running (pid $pid): --status or --stop first" >&2; exit 1; fi

if [[ "$BACKGROUND" == 1 ]]; then
  AWAKE=(); [[ "$(uname)" == Darwin ]] && AWAKE=(caffeinate -i)   # no idle sleep while the series runs
  SERIES_CHILD=1 nohup "${AWAKE[@]}" "$0" "$INSTALL_ID" --runs "$RUNS" ${CLIENT:+--client "$CLIENT"} >> "$LOG" 2>&1 &
  echo $! > "$PIDFILE"
  echo "series started in the background (pid $(cat "$PIDFILE")), runs in order: ${RUNS//,/ then }"
  echo "  watch:  tail -f $LOG     status: $0 --status     stop: $0 --stop"
  exit 0
fi

cd "$HARNESS/../../.." || exit 1
IFS=',' read -r -a list <<< "$RUNS"
for run in "${list[@]}"; do
  echo "=== $(date -u +%FT%TZ) starting $run"
  "${RUN_SH:-$HARNESS/run.sh}" "$INSTALL_ID" --run-id "$run" --record ${CLIENT:+--client "$CLIENT"}  # RUN_SH: tests only
  rc=$?
  echo "=== $(date -u +%FT%TZ) $run exited $rc"
  if [[ $rc -ne 0 ]]; then echo "=== stopping the series: $run failed (fix, then re-run to resume)"; rm -f "$PIDFILE"; exit $rc; fi
done
echo "=== $(date -u +%FT%TZ) series done"
rm -f "$PIDFILE"
