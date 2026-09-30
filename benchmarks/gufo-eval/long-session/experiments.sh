#!/usr/bin/env bash
# The overnight long-session experiments on the Strix Halo box, one server at a time, each stopped on exit.
#   experiments.sh DIR [--dry-run] [--only "E1 E2 ..."]
# E1 gufo as the benchmark runs it: effort probe + replays (as sent, and with effort low).
# E2 llama.cpp as the benchmark runs it (UD-IQ4_XS, Vulkan): effort probe + replays.
# E3 gufo with 4 draft tokens (llama.cpp's), E4 gufo with prior reasoning not replayed,
# E5 llama.cpp on gufo's UD-Q4_K_XL weights: replays.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
OUT="${1:?results dir}"; shift
DRY=""; ONLY="E1 E2 E3 E4 E5"
while [[ $# -gt 0 ]]; do case "$1" in --dry-run) DRY=1; shift ;; --only) ONLY="$2"; shift 2 ;; *) echo "unknown $1" >&2; exit 2 ;; esac; done
PORT=18097
READY_TIMEOUT_S=1200
REPEATS=3
REPLAY_MAX_TOKENS=12000
Q4_K_XL="$HOME/gufo/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf"
REQUESTS=("$OUT/replay-60k.json" "$OUT/replay-100k.json")
if [[ -n "$DRY" ]]; then REPEATS=1; REPLAY_MAX_TOKENS=64; REQUESTS=("$OUT/replay-60k.json"); fi
LOG="$OUT/log.md"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
SPID=""
BUSY='[l]lama-server|[g]ufo serve|[d]rive.py'

stop_server() {
  [[ -n "$SPID" ]] || return 0
  kill -TERM "$SPID" 2>/dev/null
  for _ in $(seq 60); do kill -0 "$SPID" 2>/dev/null || break; sleep 1; done
  kill -KILL "$SPID" 2>/dev/null
  for _ in $(seq 60); do pgrep -f "$BUSY" >/dev/null || break; sleep 1; done
  SPID=""
}
trap stop_server EXIT

start_server() { # name, then env assignments and the launcher command
  local name="$1"; shift
  if pgrep -fl "$BUSY"; then say "ABORT $name: something else is serving"; exit 1; fi
  env PORT="$PORT" "$@" > "$OUT/server-$name.log" 2>&1 < /dev/null &
  SPID=$!
  local t0; t0=$(date +%s)
  until curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" | grep -q '"id"' && curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; do
    kill -0 "$SPID" 2>/dev/null || { say "$name: server exited (see server-$name.log)"; SPID=""; return 1; }
    (( $(date +%s) - t0 > READY_TIMEOUT_S )) && { say "$name: not ready in ${READY_TIMEOUT_S}s"; return 1; }
    sleep 3
  done
  say "$name: ready after $(( $(date +%s) - t0 ))s"
}

probe()  { uv run --quiet "$HERE/effort_probe.py" --url "http://127.0.0.1:$PORT" --engine "$1" --out "$OUT/effort.jsonl" --repeats "$REPEATS" ${2:+--variants "$2"} ${DRY:+--variants none}; }
replays() { uv run --quiet "$HERE/replay.py" --url "http://127.0.0.1:$PORT" --engine "$1" --requests "${REQUESTS[@]}" --out "$OUT/replay.jsonl" --repeats "$REPEATS" --variant "${2:-as-is}" --max-tokens "$REPLAY_MAX_TOKENS"; }

run() { # experiment id, name, launcher env+command...; the body is in EXP_<id>
  local id="$1" name="$2"; shift 2
  [[ " $ONLY " == *" $id "* ]] || return 0
  say "$id $name: start${DRY:+ (dry run)}"
  start_server "$name" "$@" || { stop_server; return 0; }
  "EXP_$id" "$name"
  stop_server
  say "$id $name: done"
}
EXP_E1() { probe "$1"; replays "$1" as-is; [[ -n "$DRY" ]] || replays "$1" effort-low; }
EXP_E2() { probe "$1" "none,effort-low"; replays "$1" as-is; }
EXP_E3() { replays "$1" as-is; }
EXP_E4() { replays "$1" as-is; }
EXP_E5() { replays "$1" as-is; }

run E1 gufo              qwen38-flash-next-strix-gufo-server
run E2 llamacpp-iq4xs    GPU_BACKEND=vulkan qwen38-flash-next-strix-server
run E3 gufo-draft4       qwen38-flash-next-strix-gufo-server -d 4
run E4 gufo-nopreserve   qwen38-flash-next-strix-gufo-server --preserve-thinking off
run E5 llamacpp-q4kxl    GPU_BACKEND=vulkan MODEL="$Q4_K_XL" qwen38-flash-next-strix-server
say "experiments finished"
