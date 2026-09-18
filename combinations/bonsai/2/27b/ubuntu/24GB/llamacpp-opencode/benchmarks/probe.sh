#!/usr/bin/env bash
# Bonsai 2 27B profile probe -- same shape as awesome-local-ai's benchmarks/refit.sh,
# but pointed at the PrismML fork binary and with no MTP/draft flags.
EVAL="$HOME/.local/share/bonsai2-27b"
LS="$EVAL/llama.cpp/build/bin/llama-server"
M="$EVAL/models"
OUT="${OUT:-$EVAL/probe-results}"; mkdir -p "$OUT"
PORT=${PORT:-18099}
USABLE_MIB=${USABLE_MIB:-24047}
ALIAS="bonsai2-27b"

try() {
  local name="$1" pack="$2" ctx="$3" kv="$4" ub="$5" vision="$6"
  local log="$OUT/$name.log"
  local args=(-m "$M/Ternary-Bonsai-2-27B-${pack}.gguf" -a "$ALIAS"
    -ngl 99 -fa on --jinja -c "$ctx"
    --cache-type-k "$kv" --cache-type-v "$kv"
    -np 1 -b 1024 -ub "$ub" --host 127.0.0.1 --port $PORT)
  [[ "$vision" == "1" ]] && args+=(--mmproj "$M/Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf")

  timeout 420 "$LS" "${args[@]}" > "$log" 2>&1 &
  local pid=$! ok=0 i
  for i in $(seq 1 300); do
    kill -0 $pid 2>/dev/null || break
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && { ok=1; break; }
    sleep 1
  done
  if ((!ok)); then
    printf '%-28s %-7s ctx=%-7s kv=%-5s ub=%-4s FAILED\n' "$name" "$pack" "$ctx" "$kv" "$ub"
    kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3; return
  fi

  local vram; vram=$(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | head -1)
  # real prefill: ~6000 token prompt, read the server's own pp rate
  python3 - "$PORT" "$ALIAS" <<'PY' >/dev/null 2>&1
import json,sys,urllib.request
port=sys.argv[1]
body={"model":sys.argv[2],"max_tokens":8,
 "messages":[{"role":"user","content":("def process(items):\n    return [x*2 for x in items]\n"*400)+"\nReply OK."}]}
urllib.request.urlopen(urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",
  data=json.dumps(body).encode(),headers={"Content-Type":"application/json"}),timeout=900)
PY
  local pp; pp=$(grep -oE 'prompt eval time =[^(]*\( *[0-9.]+ ms per token, *[0-9.]+ tokens per second' "$log" \
                 | tail -1 | grep -oE '[0-9.]+ tokens per second' | grep -oE '^[0-9.]+')
  local nctx; nctx=$(curl -s "http://127.0.0.1:$PORT/props" | python3 -c 'import sys,json;print(json.load(sys.stdin)["default_generation_settings"]["n_ctx"])' 2>/dev/null)
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
  printf '%-28s %-7s ctx=%-7s kv=%-5s ub=%-4s vram=%-6s free=%-6s served=%-7s prefill=%s tok/s\n' \
     "$name" "$pack" "$ctx" "$kv" "$ub" "$vram" "$((USABLE_MIB-vram))" "${nctx:-?}" "${pp:-?}"
}
