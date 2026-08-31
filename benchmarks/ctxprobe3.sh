#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
PORT=${PORT:-18097}
SPEC=(-md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99)

try() {
  local name="$1"; shift
  local log="$OUT/p3-${name}.log"
  timeout 300 llama-server -m "$MODEL" -ngl 99 -fa on --jinja \
      --host 127.0.0.1 --port $PORT "$@" > "$log" 2>&1 &
  local pid=$! ok=0 i
  for i in $(seq 1 240); do
    kill -0 $pid 2>/dev/null || break
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 1
  done
  local vram="-"
  (( ok )) && vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader | head -1)
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
  (( ok )) && printf '%-32s LOADED  vram=%s  headroom=%s MiB\n' "$name" "$vram" "$(( USABLE_MIB - ${vram% *} ))" \
           || printf '%-32s FAILED\n' "$name"
}

echo "--- can we keep full q8_0 KV at 128k? ---"
try "128k-q8kv-mtp-ub256"  -c 131072 --cache-type-k q8_0 --cache-type-v q8_0 "${SPEC[@]}" -np 1 -b 1024 -ub 256
echo "--- how far with q5_1 KV? ---"
try "160k-q5_1kv-mtp-ub256" -c 163840 --cache-type-k q5_1 --cache-type-v q5_1 "${SPEC[@]}" -np 1 -b 1024 -ub 256
try "192k-q5_1kv-mtp-ub256" -c 196608 --cache-type-k q5_1 --cache-type-v q5_1 "${SPEC[@]}" -np 1 -b 1024 -ub 256
try "256k-q4_0kv-mtp-ub256" -c 262144 --cache-type-k q4_0 --cache-type-v q4_0 "${SPEC[@]}" -np 1 -b 1024 -ub 256

echo
echo "=== prefill cost of small ubatch (llama-bench, pp8192) ==="
llama-bench -m "$MODEL" -ngl 99 -fa 1 -p 8192 -n 64 -ub 256,512 -r 2 2>/dev/null | tail -12
echo DONE
