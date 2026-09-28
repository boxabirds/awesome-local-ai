#!/usr/bin/env bash
# Replay the request after which gufo returned a tool call as text (canvas-gufo-exp1 story 1),
# N times on gufo and on llama.cpp with the same UD-Q4_K_XL weights; count leaked tool calls.
#   leak_repro.sh DIR [N]
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
OUT="${1:?results dir}"; N="${2:-8}"
PORT=18097
READY_TIMEOUT_S=1200
MAX_TOKENS=8000
Q4_K_XL="$HOME/gufo/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf"
BUSY='[l]lama-server|[g]ufo serve|[d]rive.py'
LOG="$OUT/log.md"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
SPID=""
stop_server() {
  [[ -n "$SPID" ]] || return 0
  kill -TERM "$SPID" 2>/dev/null
  for _ in $(seq 60); do kill -0 "$SPID" 2>/dev/null || break; sleep 1; done
  kill -KILL "$SPID" 2>/dev/null
  for _ in $(seq 60); do pgrep -f "$BUSY" >/dev/null || break; sleep 1; done
  SPID=""
}
trap stop_server EXIT
start_server() {
  local name="$1"; shift
  if pgrep -fl "$BUSY"; then say "ABORT $name: something else is serving"; exit 1; fi
  env PORT="$PORT" "$@" > "$OUT/server-leak-$name.log" 2>&1 < /dev/null &
  SPID=$!
  local t0; t0=$(date +%s)
  until curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" | grep -q '"id"' && curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; do
    kill -0 "$SPID" 2>/dev/null || { say "$name: server exited"; SPID=""; return 1; }
    (( $(date +%s) - t0 > READY_TIMEOUT_S )) && { say "$name: not ready"; return 1; }
    sleep 3
  done
}
for spec in "gufo|qwen38-flash-next-strix-gufo-server" "llamacpp-q4kxl|env GPU_BACKEND=vulkan MODEL=$Q4_K_XL qwen38-flash-next-strix-server"; do
  name="${spec%%|*}"; cmd="${spec#*|}"
  say "leak repro: $name x$N"
  # shellcheck disable=SC2086
  start_server "$name" $cmd || { stop_server; continue; }
  uv run --quiet "$HERE/replay.py" --url "http://127.0.0.1:$PORT" --engine "$name" --requests "$OUT/replay-leak.json" \
    --out "$OUT/leak-repro.jsonl" --repeats "$N" --max-tokens "$MAX_TOKENS"
  stop_server
done
say "leak repro finished"
