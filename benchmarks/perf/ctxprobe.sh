#!/usr/bin/env bash
# Probe how much context fits under various configurations.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
PORT=${PORT:-18099}

try() {
  local name="$1"; shift
  local log="$OUT/probe-${name}.log"
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
  if (( ok )); then
    vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader | head -1)
  fi
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  sleep 3
  if (( ok )); then
    printf '%-28s LOADED   vram=%-10s ' "$name" "$vram"
  else
    printf '%-28s FAILED   %-18s ' "$name" ""
  fi
  grep -oE 'KV self size *= *[0-9.]+ MiB|compute buffer size = *[0-9.]+ MiB' "$log" | tr '\n' ' ' | head -c 150
  grep -qiE 'out of memory|failed to allocate|cudaMalloc failed' "$log" && printf ' <OOM>'
  echo
}

echo "=== baseline (current launcher settings) ==="
try "32k+vision+mtp"   -c 32768  --cache-type-k q8_0 --cache-type-v q8_0 -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99 --mmproj "$MMPROJ"

echo "=== drop vision ==="
try "64k+mtp-novision"  -c 65536  --cache-type-k q8_0 --cache-type-v q8_0 -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99
try "128k+mtp-novision" -c 131072 --cache-type-k q8_0 --cache-type-v q8_0 -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99

echo "=== drop vision, single slot, smaller batch ==="
try "128k+mtp-np1-ub256" -c 131072 --cache-type-k q8_0 --cache-type-v q8_0 -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99 -np 1 -b 1024 -ub 256
try "192k+mtp-np1-ub256" -c 196608 --cache-type-k q8_0 --cache-type-v q8_0 -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99 -np 1 -b 1024 -ub 256

echo "=== drop MTP too (max context) ==="
try "256k-nomtp-np1"     -c 262144 --cache-type-k q8_0 --cache-type-v q8_0 -np 1 -b 1024 -ub 256
echo DONE
