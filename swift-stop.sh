#!/usr/bin/env bash
# swift-stop.sh -- leave Swift A/B benchmark mode; restore the baseline server.
# The opposite of swift-start.sh:
#   1. stop the bench (swift-ab.sh) -- its trap kills the bench's own llama-server
#   2. belt-and-suspenders: kill any server still loading the Swift model, or
#      still listening on the bench port
#   3. wait, confirmed by nvidia-smi, until the VRAM is released
#   4. restart the installed baseline server (detached) and confirm :8080 health
#   5. final nvidia-smi + /v1/models snapshot
#
# It never touches a baseline server it did not need to stop, and it leaves the
# machine in normal state: the :8080 endpoint back up, ready for your agent.
#
#   bash swift-stop.sh           do it
#   bash swift-stop.sh --yes     don't ask before killing the bench
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSUME_YES=0
case "${1:-}" in
  --yes|-y) ASSUME_YES=1 ;;
  --help|-h) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
esac

BASELINE_PAT='qwen38-27b/llama.cpp/build/bin/llama-server'
BENCH_PAT='benchmarks/swift-ab.sh'
SWIFT_DL_PAT='ukisai/Swift-Qwen3.8-27B-GGUF'
BENCH_PORT="${BENCH_PORT:-18099}"
BASE_PORT="${BASE_PORT:-8080}"
FREE_NEED_MIB="${FREE_NEED_MIB:-20000}"
BASE_SERVER="${HOME}/.local/bin/qwen38-27b-server"
BASE_LOG="${BASE_LOG:-$REPO_ROOT/logs/qwen38-27b-server.log}"
mkdir -p "$(dirname "$BASE_LOG")"

free_mib()  { nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' '; }
healthy()   { curl -sf "http://127.0.0.1:$1/health" >/dev/null 2>&1; }
bench_up()  { pgrep -f "$BENCH_PAT" >/dev/null 2>&1; }
kill_port() { # <port>
  local port="$1" pid
  pid="$(ss -ltnp 2>/dev/null | grep ":${port} " | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)"
  [[ -n "$pid" ]] && { echo "  killing pid $pid still on :$port"; kill "$pid" 2>/dev/null; }
  return 0
}
wait_free() { # <need_mib> <tries>
  local need="$1" tries="$2" i free
  for ((i=1;i<=tries;i++)); do
    free="$(free_mib)"; free="${free:-0}"
    (( free >= need )) && { echo "  VRAM free after $((i-1))s: ${free} MiB"; return 0; }
    sleep 1
  done
  echo "  VRAM still ${free} MiB after ${tries}s (need ~${need})" >&2
  return 1
}
wait_health() { # <port> <tries>
  local port="$1" tries="$2" i
  for ((i=1;i<=tries;i++)); do healthy "$port" && { echo "  up after $((i-1))s"; return 0; }; sleep 1; done
  return 1
}

echo "swift-stop: $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"

# 1) stop the bench
if bench_up; then
  if (( ! ASSUME_YES )) && [[ -t 0 ]]; then
    read -r -p "Stop the running bench? [Y/n] " r
    case "${r:-y}" in [Nn]*) echo "Aborted."; exit 0 ;; esac
  fi
  echo "Stopping bench (pid: $(pgrep -f "$BENCH_PAT" | tr '\n' ' ')) ..."
  pkill -f "$BENCH_PAT" 2>/dev/null        # its trap kills the bench's own server
  pkill -f "$SWIFT_DL_PAT" 2>/dev/null      # the hf downloader, if still mid-download
  kill_port "$BENCH_PORT"                   # whatever still holds the bench port
else
  echo "No bench running."
fi

# 2) confirm the GPU released -- only meaningful when the baseline is not already holding it
if healthy "$BASE_PORT"; then
  echo "  (baseline already on :$BASE_PORT; skipping the empty-GPU check)"
else
  wait_free "$FREE_NEED_MIB" 30 || echo "  note: VRAM still busy; check nvidia-smi before continuing."
fi

# 3) ensure the baseline server is up (detached)
if healthy "$BASE_PORT"; then
  echo "Baseline already up on :$BASE_PORT."
else
  [[ -x "$BASE_SERVER" ]] || { echo "ERROR: $BASE_SERVER not found; start your server manually." >&2; exit 1; }
  echo "Starting baseline server (detached) -> $BASE_LOG"
  nohup "$BASE_SERVER" </dev/null >"$BASE_LOG" 2>&1 &
  if wait_health "$BASE_PORT" 120; then
    echo "Baseline is up on :$BASE_PORT."
  else
    echo "ERROR: baseline did not come up on :$BASE_PORT; tail of $BASE_LOG:" >&2
    tail -15 "$BASE_LOG" >&2
    exit 1
  fi
fi

# 4) final snapshot
echo
echo "=== nvidia-smi ==="
nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv 2>/dev/null
echo "=== :$BASE_PORT /v1/models ==="
curl -s -m 5 "http://127.0.0.1:$BASE_PORT/v1/models" 2>/dev/null \
  | python3 -c 'import json,sys; [print("  ", m["id"]) for m in json.load(sys.stdin).get("data",[])]' 2>/dev/null \
  || echo "  (none)"
echo
echo "Machine is back in normal state. Launch your agent (pi / opencode) against :$BASE_PORT as usual."
