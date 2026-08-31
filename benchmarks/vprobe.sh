SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
PORT=${PORT:-18095}
MM="$MMPROJ"
SPEC=(-md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99)
try() { local n="$1"; shift
  timeout 300 llama-server -m "$MODEL" -ngl 99 -fa on --jinja --host 127.0.0.1 --port $PORT "$@" >"$OUT/v-$n.log" 2>&1 &
  local p=$! ok=0 i; for i in $(seq 1 240); do kill -0 $p 2>/dev/null||break; curl -sf http://127.0.0.1:$PORT/health>/dev/null 2>&1&&{ ok=1;break;}; sleep 1; done
  local v="-"; ((ok))&&v=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits|head -1)
  kill $p 2>/dev/null; wait $p 2>/dev/null; sleep 3
  ((ok)) && printf '%-36s LOADED  vram=%s MiB  free=%s MiB\n' "$n" "$v" "$((USABLE_MIB-v))" || printf '%-36s FAILED\n' "$n"; }

echo "--- vision ON + MTP + ub256 (the untested combination) ---"
try "vision-64k-q8kv-ub256"  -c 65536  --cache-type-k q8_0 --cache-type-v q8_0 "${SPEC[@]}" -np 1 -b 1024 -ub 256 --mmproj "$MM"
try "vision-96k-q5_1kv-ub256" -c 98304 --cache-type-k q5_1 --cache-type-v q5_1 "${SPEC[@]}" -np 1 -b 1024 -ub 256 --mmproj "$MM"
try "vision-128k-q5_1kv-ub256" -c 131072 --cache-type-k q5_1 --cache-type-v q5_1 "${SPEC[@]}" -np 1 -b 1024 -ub 256 --mmproj "$MM"
echo DONE
