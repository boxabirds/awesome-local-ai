#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
PORT=${PORT:-18098}

try() {
  local name="$1"; shift
  local log="$OUT/p2-${name}.log"
  timeout 240 llama-server -m "$MODEL" -ngl 99 -fa on --jinja \
      --host 127.0.0.1 --port $PORT "$@" > "$log" 2>&1 &
  local pid=$!
  local ok=0 i
  for i in $(seq 1 200); do
    kill -0 $pid 2>/dev/null || break
    if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then ok=1; break; fi
    sleep 1
  done
  local vram="-"
  (( ok )) && vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader | head -1)
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
  if (( ok )); then printf '%-34s LOADED  vram=%s\n' "$name" "$vram"
  else printf '%-34s FAILED  %s\n' "$name" "$(grep -oE 'allocating [0-9.]+ MiB|failed to allocate compute [a-z]+ buffers' "$log" | head -2 | tr '\n' ' ')"; fi
}

SPEC=(-md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99)

echo "--- q8_0 KV, MTP, no vision: find ceiling ---"
try "80k-q8kv-mtp"    -c 81920  --cache-type-k q8_0 --cache-type-v q8_0 "${SPEC[@]}"
try "96k-q8kv-mtp"    -c 98304  --cache-type-k q8_0 --cache-type-v q8_0 "${SPEC[@]}"
try "96k-q8kv-mtp-ub256" -c 98304 --cache-type-k q8_0 --cache-type-v q8_0 "${SPEC[@]}" -np 1 -b 1024 -ub 256

echo "--- cheaper KV quant to reach 128k ---"
try "128k-q5_1kv-mtp-ub256" -c 131072 --cache-type-k q5_1 --cache-type-v q5_1 "${SPEC[@]}" -np 1 -b 1024 -ub 256
try "128k-q4_0kv-mtp-ub256" -c 131072 --cache-type-k q4_0 --cache-type-v q4_0 "${SPEC[@]}" -np 1 -b 1024 -ub 256

echo "--- sacrifice MTP instead ---"
try "128k-q8kv-nomtp-ub256"  -c 131072 --cache-type-k q8_0 --cache-type-v q8_0 -np 1 -b 1024 -ub 256
echo DONE
