#!/usr/bin/env bash
# Compare KV cache quantisation on long-context retrieval.
# Same haystack, same queries, same greedy sampling -- only KV type varies.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
D="$OUT"
PORT=${PORT:-18086}
CTX=${CTX:-65536}
HAY=${HAY:-60000}
# The 128k run is this same script: CTX=131072 HAY=120000 KVS=q4_0 ./run-niah.sh
KVS=${KVS:-"q8_0 q4_0 f16"}

for kv in $KVS; do
  echo "=============================================================="
  echo "KV = $kv   (ctx $CTX, haystack ~$HAY tokens)"
  echo "=============================================================="
  PORT=$PORT CTX=$CTX KV_TYPE=$kv VISION=0 "$SERVER_CMD" > "$D/niah-$kv.log" 2>&1 &
  pid=$!
  ok=0
  for i in $(seq 1 300); do
    kill -0 $pid 2>/dev/null || break
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 1
  done
  if (( ok )); then
    echo "vram: $(nvidia-smi --query-gpu=memory.used --format=csv,noheader)"
    python3 "$SCRIPT_DIR/niah.py" "$PORT" "$HAY" 2>&1 | tee "$D/niah-$kv.out"
  else
    echo "FAILED TO LOAD (likely OOM at ctx=$CTX with kv=$kv)"
    tail -3 "$D/niah-$kv.log"
  fi
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 4
  echo
done
echo ALLDONE
