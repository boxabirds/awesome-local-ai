#!/usr/bin/env bash
# swift-start.sh -- enter Swift A/B benchmark mode on this machine.
#
# One command does the whole "all this":
#   1. refuse to double-start if a bench is already running
#   2. stop the installed baseline server to free the GPU -- this ends any agent
#      session running on it (pi / opencode). That is the point; do it on purpose.
#   3. wait, confirmed by nvidia-smi, until the VRAM is actually released
#   4. launch benchmarks/swift-ab.sh detached under nohup (first run downloads
#      Swift Q4_K_M ~17 GB), logging to <repo>/logs/swift-ab.log
#
# Reverse it with ./swift-stop.sh (kills the bench, restores the baseline, and
# checks the GPU with nvidia-smi on the way).
#
#   bash swift-start.sh           ask first, then run (verbose logging on)
#   bash swift-start.sh --yes     don't ask
#   bash swift-start.sh --quiet   turn off the verbose debug in the log
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSUME_YES=0
PASS_VERBOSE=1                       # chatty by default; --quiet turns it off
while (( $# )); do
  case "$1" in
    --yes|-y)      ASSUME_YES=1; shift ;;
    -v|--verbose)  PASS_VERBOSE=1; shift ;;
    --quiet|-q)    PASS_VERBOSE=0; shift ;;
    --help|-h)     grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $1 (try --help)" >&2; exit 2 ;;
  esac
done

BASELINE_PAT='qwen38-27b/llama.cpp/build/bin/llama-server'
BENCH_PAT='benchmarks/swift-ab.sh'
BENCH_PORT="${BENCH_PORT:-18099}"
BASE_PORT="${BASE_PORT:-8080}"
NEED_FREE_MIB="${NEED_FREE_MIB:-19000}"
LOG="${LOG:-$REPO_ROOT/logs/swift-ab.log}"
mkdir -p "$(dirname "$LOG")"

free_mib()  { nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' '; }
healthy()   { curl -sf "http://127.0.0.1:$1/health" >/dev/null 2>&1; }
wait_free() { # <need_mib> <tries> -- one line on the outcome
  local need="$1" tries="$2" i free
  for ((i=1;i<=tries;i++)); do
    free="$(free_mib)"; free="${free:-0}"
    (( free >= need )) && { echo "  VRAM free after $((i-1))s: ${free} MiB"; return 0; }
    sleep 1
  done
  echo "  VRAM still ${free} MiB after ${tries}s (need ~${need})" >&2
  return 1
}

echo "swift-start: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"

# 1) already running?
if pgrep -f "$BENCH_PAT" >/dev/null 2>&1; then
  echo "A Swift bench is already running (pid: $(pgrep -f "$BENCH_PAT" | tr '\n' ' '))."
  echo "  watch:        tail -f $LOG"
  echo "  stop+restore: bash $REPO_ROOT/swift-stop.sh"
  exit 0
fi

if (( ! ASSUME_YES )) && [[ -t 0 ]]; then
  echo
  echo "This will:"
  echo "  * stop the baseline server on :$BASE_PORT (ends any agent running on it)"
  echo "  * start the Swift A/B bench (first run downloads Swift Q4_K_M ~17 GB)"
  read -r -p "Continue? [Y/n] " r
  case "${r:-y}" in [Nn]*) echo "Aborted."; exit 0 ;; esac
fi

# 2) free the GPU by stopping the baseline (only it, and only if it is the :8080 server)
if healthy "$BASE_PORT"; then
  echo "Stopping baseline server on :$BASE_PORT ..."
  pkill -f "$BASELINE_PAT"
else
  echo "Nothing healthy on :$BASE_PORT -- will report what actually holds the GPU."
fi

# 3) wait for VRAM to actually release (nvidia-smi-confirmed), else diagnose
if wait_free "$NEED_FREE_MIB" 30; then
  echo "GPU is free."
else
  echo "ERROR: GPU did not free after stopping the baseline. Compute processes:" >&2
  nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv 2>/dev/null >&2 || true
  echo "Free it manually, then re-run." >&2
  exit 1
fi
echo

# 4) launch the bench detached (stdin from /dev/null so no prompt can hang it)
echo "Launching Swift A/B bench -> $LOG   (first run downloads Swift Q4_K_M)"
bench_flags=(--yes); (( PASS_VERBOSE )) && bench_flags+=(--verbose)
nohup bash "$REPO_ROOT/benchmarks/swift-ab.sh" "${bench_flags[@]}" </dev/null >"$LOG" 2>&1 &
echo "  bench PID: $!"
echo
echo "Watch it:         tail -f $LOG"
echo "Stop + restore:   bash $REPO_ROOT/swift-stop.sh"
echo
echo "When it's done, send back the final comparison table plus"
echo "  benchmarks/results/base.tsv  and  benchmarks/results/swift.tsv"
echo "and whether the Swift line said 'speculative decoding LIVE' or the WARNING."
