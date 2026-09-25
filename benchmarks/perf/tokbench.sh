#!/usr/bin/env bash
# Controlled throughput comparison: thinking on vs off.
# Separates RATE (tok/s) from VOLUME (tokens emitted) -- they are different
# things and only volume should change with thinking.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"
D="$OUT"
PORT=${PORT:-18083}

run_cfg() {
  local think="$1"
  THINKING="$think" PORT=$PORT "$SERVER_CMD" > "$D/tb-$think.log" 2>&1 &
  local pid=$!
  for i in $(seq 1 240); do
    kill -0 $pid 2>/dev/null || break
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  echo "=== THINKING=$think ==="
  python3 - "$PORT" "$MODEL_ALIAS_DEFAULT" <<'PY'
import json,sys,time,urllib.request
port, alias = sys.argv[1], sys.argv[2]
PROMPTS=[
 "Write a Python function that merges two sorted lists.",
 "Explain the difference between a process and a thread, briefly.",
 "Write a bash one-liner that finds the 5 largest files under a directory.",
]
tot_tok=tot_gen=0
rates=[]
for i,p in enumerate(PROMPTS):
    b={"model":alias,"max_tokens":1200,
       "messages":[{"role":"user","content":p}]}
    t0=time.time()
    d=json.load(urllib.request.urlopen(urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=json.dumps(b).encode(),headers={"Content-Type":"application/json"}),timeout=900))
    dt=time.time()-t0
    n=d["usage"]["completion_tokens"]
    r=d["choices"][0]["message"].get("reasoning_content") or ""
    rate=n/dt
    rates.append(rate); tot_tok+=n; tot_gen+=dt
    print(f"  p{i}: {n:4d} tok  {dt:6.2f}s  {rate:6.1f} tok/s  reasoning={len(r):5d}c")
print(f"  TOTAL: {tot_tok} tok in {tot_gen:.1f}s  ->  {tot_tok/tot_gen:.1f} tok/s aggregate")
PY
  # server-reported rate, which excludes HTTP/parsing overhead
  echo -n "  server-reported eval: "
  grep -oE 'eval time =[^(]*\([^)]*tokens per second' "$D/tb-$think.log" | grep -v prompt \
    | grep -oE '[0-9.]+ tokens per second' | grep -oE '^[0-9.]+' | paste -sd' ' -
  echo -n "  draft acceptance: "
  grep -oE 'draft acceptance = [0-9.]+' "$D/tb-$think.log" | grep -oE '[0-9.]+$' | paste -sd' ' -
  kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 4
  echo
}

run_cfg 1
run_cfg 0
echo BENCHDONE
