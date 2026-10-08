#!/usr/bin/env bash
# The five checks before a series on a 24 GB card, for a llama.cpp 27B combination. Ten minutes of checks, not a story.
#
#   1. install     the combination's installer: build llama.cpp, find the weights, verify the pin
#   2. serve       the server at 131,072 tokens; the draft head (MTP) must be live in its log
#   3. capability  basic-capability.py: generation, a tool call, raw newlines in arguments, prompt reuse, a long prompt
#   4. mtp         mtp-acceptance.py: draft acceptance and decode speed AT OUR SAMPLER (the card's figures are greedy)
#   5. long        long-context.py at about 120k tokens
#
# A failure in 1 to 3 is a PLUMBING failure: a series would measure the plumbing, not the model, so it stops there. 4 and 5 report.
# Every step's output is kept under the directory named below. Nothing here is queued or recorded as a run.
#
#   tools/engine-probe/smoke-27b.sh <installer> <server-command> <model-alias> [--dry-run]
#   e.g. tools/engine-probe/smoke-27b.sh ./install-qwen-3.8-underdog-saluki-27b-ubuntu-nvidia4090-llamacpp-pi.sh \
#            underdog-qwen38-27b-server qwen3.8-underdog-saluki-27b
set -uo pipefail
INSTALLER="${1:-}"; SERVER_CMD="${2:-}"; MODEL="${3:-}"; DRY=0
[[ "${4:-}" == "--dry-run" ]] && DRY=1
[[ -n "$INSTALLER" && -n "$SERVER_CMD" && -n "$MODEL" ]] || { echo "usage: $0 <installer> <server-command> <model-alias> [--dry-run]" >&2; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-18010}"
CTX="${CTX:-131072}"
LONG_TOKENS="${LONG_TOKENS:-120000}"
READY_TIMEOUT_S=600
OUT="${OUT:-$HOME/smoke-$(date +%Y%m%d-%H%M%S)}"
BASE_URL="http://127.0.0.1:${PORT}/v1"

step() { echo; echo "== $*"; }
run() { if (( DRY )); then echo "   would run: $*"; else "$@"; fi; }
vram() { command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader || echo "no nvidia-smi"; }

step "plan (output in $OUT)"
echo "   1 install     $INSTALLER"
echo "   2 serve       $SERVER_CMD   CTX=$CTX PORT=$PORT   (MTP must be live)"
echo "   3 capability  basic-capability.py   against $BASE_URL as $MODEL"
echo "   4 mtp         mtp-acceptance.py     at temperature 1.0, top-p 0.95, top-k 20"
echo "   5 long        long-context.py       $LONG_TOKENS tokens"
(( DRY )) && { echo; echo "dry run: nothing was run."; exit 0; }

mkdir -p "$OUT"; SERVER_PID=""
trap '[[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null' EXIT

step "1 install"
"$INSTALLER" > "$OUT/install.log" 2>&1; rc=$?
tail -3 "$OUT/install.log"; (( rc == 0 )) || { echo "FAIL install (exit $rc); see $OUT/install.log"; exit 1; }

step "2 serve"
CTX="$CTX" PORT="$PORT" "$SERVER_CMD" > "$OUT/server.log" 2>&1 &
SERVER_PID=$!
for ((i = 0; i < READY_TIMEOUT_S; i += 5)); do
  curl -sf -m 3 "http://127.0.0.1:${PORT}/v1/models" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "FAIL the server exited; tail of $OUT/server.log:"; tail -5 "$OUT/server.log"; exit 1; }
  sleep 5
done
curl -sf -m 3 "http://127.0.0.1:${PORT}/v1/models" >/dev/null || { echo "FAIL the server did not answer in ${READY_TIMEOUT_S}s"; exit 1; }
echo "   up. VRAM: $(vram)"
if grep -qi "draft acceptance\|creating MTP draft context" "$OUT/server.log"; then echo "   MTP draft context present in the log"
else echo "   NOTE: no MTP line in the log yet (it may only print on the first request); checked again after step 4"; fi

step "3 capability (a failure here stops the smoke)"
uv run "$HERE/basic-capability.py" --base-url "$BASE_URL" --model "$MODEL" > "$OUT/capability.txt" 2>&1; rc=$?
tail -12 "$OUT/capability.txt"; (( rc == 0 )) || { echo "FAIL capability (exit $rc); see $OUT/capability.txt"; exit 1; }
echo "   VRAM: $(vram)"

step "4 mtp at our sampler"
uv run "$HERE/mtp-acceptance.py" --base-url "$BASE_URL" --model "$MODEL" --server-log "$OUT/server.log" | tee "$OUT/mtp.json"
echo "   VRAM: $(vram)"

step "5 long context"
uv run "$HERE/long-context.py" --base-url "$BASE_URL" --model "$MODEL" --tokens "$LONG_TOKENS" | tee "$OUT/long.json"
echo "   VRAM: $(vram)"

step "done. Output kept in $OUT"
