#!/usr/bin/env bash
# Re-fit profiles using only GPU-supported KV types (f16/bf16/q8_0/q4_0).
# Measures BOTH VRAM and real prefill throughput via the server.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
PORT=${PORT:-18087}
MM="$MMPROJ"
LS="$ROOT/llama.cpp/build/bin/llama-server"

try() {
  local name="$1" ctx="$2" kv="$3" vision="$4"; shift 4
  local log="$OUT/rf-$name.log"
  local args=(-m "$MODEL" -ngl 99 -fa on --jinja -c "$ctx"
    --cache-type-k "$kv" --cache-type-v "$kv"
    -md "$MTP" --spec-type draft-mtp --spec-draft-n-max 2 --spec-draft-ngl 99
    --spec-draft-type-k "$kv" --spec-draft-type-v "$kv"
    -np 1 -b 1024 -ub 256 --host 127.0.0.1 --port $PORT)
  [[ "$vision" == "1" ]] && args+=(--mmproj "$MM")

  timeout 400 "$LS" "${args[@]}" > "$log" 2>&1 &
  local pid=$! ok=0 i
  for i in $(seq 1 240); do
    kill -0 $pid 2>/dev/null || break
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 1
  done
  if ((!ok)); then printf '%-26s FAILED (OOM)\n' "$name"; kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3; return; fi

  local vram; vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
  # real prefill: send a ~6000 token prompt, read the server's own pp rate
  python3 - "$PORT" "$MODEL_ALIAS_DEFAULT" <<'PY' >/dev/null 2>&1
import json,sys,urllib.request
port=sys.argv[1]
body={"model":sys.argv[2],"max_tokens":8,
 "messages":[{"role":"user","content":("def process(items):\n    return [x*2 for x in items]\n"*400)+"\nReply OK."}]}
urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
  data=json.dumps(body).encode(),headers={"Content-Type":"application/json"}),timeout=600)
PY
  local pp; pp=$(grep -oE 'prompt eval time =[^(]*\( *[0-9.]+ ms per token, *[0-9.]+ tokens per second' "$log" \
                 | tail -1 | grep -oE '[0-9.]+ tokens per second' | grep -oE '^[0-9.]+')
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
  printf '%-26s ctx=%-7s kv=%-5s vram=%-6s free=%-5s prefill=%s tok/s\n' \
     "$name" "$ctx" "$kv" "$vram" "$((USABLE_MIB-vram))" "${pp:-?}"
}

echo "=== re-fitting with GPU-supported KV types only ==="
try "coding-128k-q4_0"   131072 q4_0 0
try "balanced-96k-q8_0"   98304 q8_0 0
try "max-160k-q4_0"      163840 q4_0 0
try "max-192k-q4_0"      196608 q4_0 0
try "vision-96k-q4_0"     98304 q4_0 1
try "vision-128k-q4_0"   131072 q4_0 1
echo DONE
