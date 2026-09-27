#!/usr/bin/env bash
# mtp-depth.sh -- llama.cpp MTP draft depth 3 vs 4 on tritus, under the coding agents' conditions.
#
#   benchmarks/gufo-eval/mtp-depth.sh [--prompts DIR] [--depths "3 4"] [--fills 2048,32768,65536] [--repeats 3]
#
# The canvas runs draft 4 tokens a step (config.sh: "not yet measured against 3"). In canvas-vk-01/02
# they accepted 3.6-3.9 tokens a step at depth 4, about what a depth-3 session accepted (3.6), so the
# 4th draft token may cost a verification slot for nothing. This measures it: the same server as
# test-a.sh's llama.cpp arm, only --spec-draft-n-max changes; the agents' sampler (temperature 1.0,
# thinking on); test A's exact-length prompts. The unique line goes last, so repeats reuse the
# cached prefix and only decode is compared (prefill figures here are not meaningful).
# Writes benchmarks/gufo-eval/results/<timestamp>-<host>-mtp-depth/.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"

DEPTHS="3 4"
FILLS="2048,32768,65536"
REPEATS=3
PROMPTS=""
CTX=131072
PORT=18291
LOAD_TIMEOUT_S=1200
MODELS="$HOME/gufo/models/qwen3.8-flash-next"
MODEL_REL="UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf"
MTP_REL="MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
LLAMA_BIN="$HOME/.local/share/qwen38-flash-next-strix/llama.cpp/build/bin"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompts) PROMPTS="$2"; shift 2 ;;
    --depths) DEPTHS="$2"; shift 2 ;;
    --fills) FILLS="$2"; shift 2 ;;
    --repeats) REPEATS="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
# Default: the prompts of the newest test A run.
[[ -n "$PROMPTS" ]] || PROMPTS="$(ls -d "$HERE"/results/*/prompts 2>/dev/null | grep -v mtp-depth | sort | tail -1)"
for n in ${FILLS//,/ }; do
  [[ -s "$PROMPTS/fill-$n.txt" ]] || { echo "no prompt $PROMPTS/fill-$n.txt (run test-a.sh first)" >&2; exit 1; }
done

OUT="$HERE/results/$(date -u +%Y%m%d-%H%M%S)-$(hostname -s)-mtp-depth"
mkdir -p "$OUT"
SPID=""

wait_up() {
  local t0; t0=$(date +%s)
  until curl -sf -m 2 "127.0.0.1:$PORT/v1/models" >/dev/null; do
    sleep 2
    kill -0 "$SPID" 2>/dev/null || { echo "server exited"; return 1; }
    (( $(date +%s) - t0 > LOAD_TIMEOUT_S )) && { echo "no response in ${LOAD_TIMEOUT_S}s"; return 1; }
  done
}

stop_server() {
  [[ -n "$SPID" ]] && kill -- "-$SPID" 2>/dev/null
  while pgrep -f "llama-server.*--port $PORT" >/dev/null; do sleep 1; done
  SPID=""
}

{
  echo "# MTP draft depth $(date -u +%FT%TZ) on $(hostname -s); prompts $PROMPTS"
  echo "llama.cpp: $(git -C "$LLAMA_BIN/../.." log --oneline -1 2>/dev/null)"
  echo "depths: $DEPTHS; fills: $FILLS; repeats: $REPEATS; decode 400 tokens; agent sampler, thinking on"
} > "$OUT/versions.txt"

for d in $DEPTHS; do
  cmd=("$LLAMA_BIN/llama-server" -m "$MODELS/$MODEL_REL" -ngl 99 -c "$CTX" -fa on --jinja -np 1
    --host 127.0.0.1 --port "$PORT" --device Vulkan0 --spec-draft-device Vulkan0
    -md "$MODELS/$MTP_REL" --spec-type draft-mtp --spec-draft-n-max "$d" --spec-draft-ngl 99
    --spec-draft-p-min 0.0 --ctx-checkpoints 8)
  echo "depth $d: ${cmd[*]}" >> "$OUT/versions.txt"
  setsid nohup "${cmd[@]}" > "$OUT/server-depth-$d.log" 2>&1 < /dev/null &
  SPID=$!
  if ! wait_up; then echo "depth $d did not start; see $OUT/server-depth-$d.log" | tee -a "$OUT/results.jsonl"; stop_server; continue; fi
  echo "== depth $d"
  uv run "$HERE/throughput.py" --engine llamacpp --label "draft-depth-$d" --sampling agent --reuse-prefix \
    --url "http://127.0.0.1:$PORT" --prompts "$PROMPTS" --out "$OUT/results.jsonl" --fills "$FILLS" --repeats "$REPEATS"
  stop_server
done
echo "done: $OUT"
