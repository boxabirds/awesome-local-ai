#!/usr/bin/env bash
# gate-between-runs.sh -- run a microbench plan in the gap between two benchmark runs, and start
# the next runs only if it passes.
#
# 1. Waits until WAIT_LOG contains a line matching WAIT_FOR (e.g. the series log's "run X exited").
# 2. Stops the series process group (found with pgrep -f SERIES_MATCH) before the next run gets going.
#    If that run had already started a story, nothing is deleted: the gate holds and reports.
# 3. Starts the model server (SERVER_CMD, on PORT), waits until it answers, runs PLAN, stops it.
# 4. PASS: runs ON_PASS (e.g. start a new series with the changed setting). FAIL: writes HOLD and stops.
#
# Settings (environment): WAIT_LOG WAIT_FOR SERIES_MATCH NEXT_RUN_DIR NEXT_WORK_DIR SERVER_CMD PORT
#   PLAN OUT ON_PASS LOG. DRY_RUN=1 prints what it would do after the wait and changes nothing.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POLL_S=5
READY_TIMEOUT_S=900
: "${WAIT_LOG:?}" "${WAIT_FOR:?}" "${SERIES_MATCH:?}" "${NEXT_RUN_DIR:?}" "${NEXT_WORK_DIR:?}"
: "${SERVER_CMD:?}" "${PORT:?}" "${PLAN:?}" "${OUT:?}" "${ON_PASS:?}" "${LOG:?}"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
act() { if [[ "${DRY_RUN:-0}" == 1 ]]; then say "DRY RUN: $*"; else "$@"; fi; }

say "gate: waiting for /$WAIT_FOR/ in $WAIT_LOG"
until grep -qE "$WAIT_FOR" "$WAIT_LOG" 2>/dev/null; do sleep "$POLL_S"; done
say "gate: seen; stopping the series"

series_pid="$(pgrep -f "$SERIES_MATCH" | head -1)"
if [[ -n "$series_pid" ]]; then
  pgid="$(ps -o pgid= -p "$series_pid" | tr -d ' ')"
  if [[ "$pgid" == "$series_pid" ]]; then act kill -TERM -- "-$pgid"; else act kill -TERM "$series_pid"; fi
  for _ in $(seq 1 60); do pgrep -f "$SERIES_MATCH" >/dev/null || break; sleep 2; done
  pgrep -f "$SERIES_MATCH" >/dev/null && { say "gate: series did not stop; HOLD"; echo stuck > "$OUT.HOLD"; exit 1; }
fi

# The next run may have begun setting up. Clean it only if no story had started.
if compgen -G "$NEXT_RUN_DIR/stories/*/agent-events.jsonl" >/dev/null; then
  say "gate: $NEXT_RUN_DIR already started a story; not deleting anything; HOLD"
  echo "next run already started" > "$OUT.HOLD"; exit 1
fi
act rm -rf "$NEXT_RUN_DIR" "$NEXT_WORK_DIR"

say "gate: starting the server on :$PORT"
mkdir -p "$OUT"
if [[ "${DRY_RUN:-0}" == 1 ]]; then say "DRY RUN: $SERVER_CMD"; exit 0; fi
PORT="$PORT" python3 -c "
import os, subprocess, sys
p = subprocess.Popen(['bash', '-c', os.environ['SERVER_CMD']], start_new_session=True, stdin=subprocess.DEVNULL,
                     stdout=open(sys.argv[1], 'w'), stderr=subprocess.STDOUT)
print(p.pid)" "$OUT/server.log" > "$OUT/server.pid"
server_pgid="$(cat "$OUT/server.pid")"
waited=0
until curl -sf -m 5 "http://127.0.0.1:$PORT/v1/models" >/dev/null; do
  sleep "$POLL_S"; waited=$((waited + POLL_S))
  if (( waited > READY_TIMEOUT_S )); then say "gate: server not ready; HOLD"; kill -TERM -- "-$server_pgid"; echo "server not ready" > "$OUT.HOLD"; exit 1; fi
done
say "gate: server ready after ${waited}s; running $PLAN"
uv run --quiet "$HERE/microbench.py" --url "http://127.0.0.1:$PORT" --plan "$PLAN" --out "$OUT" --label gate >> "$LOG" 2>&1
rc=$?
kill -TERM -- "-$server_pgid" 2>/dev/null; sleep 10; kill -KILL -- "-$server_pgid" 2>/dev/null
case "$rc" in
  0) say "gate: PASS; starting: $ON_PASS"
     python3 -c "
import os, subprocess
subprocess.Popen(['bash', '-c', os.environ['ON_PASS']], start_new_session=True, stdin=subprocess.DEVNULL,
                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)" ;;
  *) say "gate: FAIL (exit $rc); HOLD, nothing started. See $OUT/verdict.json"; echo "microbench failed" > "$OUT.HOLD" ;;
esac
