#!/usr/bin/env bash
# What does reasoning_effort actually cost?
#
# The Qwen3.8 chat template defaults reasoning_effort to 'xhigh' when the field
# is unset, and the levels are prompt instructions rather than a hard budget --
# so the only way to know what a level costs is to measure it.
#
# Greedy (temperature 0, top_k 1) because the thinking sampling preset is
# temp 1.0, and at that temperature a handful of prompts cannot separate the
# levels from sampling noise. One server load covers every level: the levels
# are applied per request, which also demonstrates that clients can override
# the server default per call.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

PORT=${PORT:-18091}
LEVELS=${LEVELS:-"low medium xhigh"}

PORT=$PORT "$SERVER_CMD" > "$OUT/effort.log" 2>&1 &
pid=$!
for i in $(seq 1 300); do
  kill -0 $pid 2>/dev/null || break
  curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
  echo "server did not start; see $OUT/effort.log"; tail -5 "$OUT/effort.log"; exit 1
fi

python3 - "$PORT" "$LEVELS" <<'PY'
import json, sys, urllib.request
PORT, LEVELS = sys.argv[1], sys.argv[2].split()
PROMPTS = [
  "Write a Python function that merges two sorted lists.",
  "Explain the difference between a process and a thread, briefly.",
  "Write a bash one-liner that finds the 5 largest files under a directory.",
  "What does the -ub flag control in llama.cpp?",
  "Refactor this to remove the nested loop: for i in a:\n  for j in b:\n    if i==j: out.append(i)",
]
def ask(prompt, effort):
    body = {"messages":[{"role":"user","content":prompt}], "max_tokens":2000,
            "temperature":0, "top_k":1, "top_p":1.0, "reasoning_effort":effort}
    d = json.load(urllib.request.urlopen(urllib.request.Request(
        f"http://127.0.0.1:{PORT}/v1/chat/completions",
        data=json.dumps(body).encode(), headers={"Content-Type":"application/json"}), timeout=900))
    m = d["choices"][0]["message"]
    return len(m.get("reasoning_content") or ""), d["usage"]["completion_tokens"]

print(f"{len(PROMPTS)} prompts, greedy (temperature 0, top_k 1), one server load\n")
print(f"{'effort':8} {'reasoning chars':>16} {'completion tokens':>18}")
totals = {}
for effort in LEVELS:
    rc = tc = 0
    for p in PROMPTS:
        r, t = ask(p, effort); rc += r; tc += t
    totals[effort] = (rc, tc)
    print(f"{effort:8} {rc:16d} {tc:18d}")
if "low" in totals and "xhigh" in totals:
    lo, hi = totals["low"], totals["xhigh"]
    print(f"\nxhigh vs low:  reasoning {hi[0]/lo[0]:.2f}x   total output {hi[1]/lo[1]:.2f}x")
PY

kill $pid 2>/dev/null; wait $pid 2>/dev/null
echo EFFORTDONE
