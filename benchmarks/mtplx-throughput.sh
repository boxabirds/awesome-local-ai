#!/usr/bin/env bash
# Controlled MTP vs autoregressive throughput on an MTPLX combination.
#
# The question: how much does native MTP speculative decoding actually buy on
# this machine, at a realistic context length?
#
# Runs each context in both modes against the same loaded model. `ar` is the
# only per-request MTP kill switch that works -- `enable_mtp` and `mtp` are
# accepted and silently ignored, which is how an earlier round of "MTP off"
# numbers turned out to be MTP on.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib.sh"

PORT="${PORT:-18092}"
CONTEXTS="${CONTEXTS:-1000,32000}"
LABEL="${LABEL:-$(basename "$MODEL")}"

[[ "${BACKEND:-}" == "mtplx" ]] || {
  echo "This harness measures an MTPLX install; \$BACKEND is '${BACKEND:-unset}'." >&2
  echo "Point it at one:  LOCAL_AI_INSTALL_REL=.local/share/<install-id> $0" >&2
  exit 1; }

echo "model    : $MODEL"
echo "contexts : $CONTEXTS"
echo "port     : $PORT"
echo "thermal  : $(python3 "$SCRIPT_DIR/thermal.py")"
echo

PORT="$PORT" "$SERVER_CMD" > "$OUT/mtplx-throughput-server.log" 2>&1 &
pid=$!
for i in $(seq 1 300); do
  kill -0 $pid 2>/dev/null || { echo "server died loading; tail of log:"; tail -20 "$OUT/mtplx-throughput-server.log"; exit 1; }
  curl -sf --max-time 3 "http://127.0.0.1:$PORT/v1/models" >/dev/null 2>&1 && break
  sleep 2
done

python3 -u "$SCRIPT_DIR/mtplx_throughput.py" \
  --model-id "$MODEL_ALIAS_DEFAULT" --label "$LABEL" \
  --contexts "$CONTEXTS" --outdir "$OUT" --port "$PORT"

kill $pid 2>/dev/null; wait $pid 2>/dev/null; sleep 3
echo BENCHDONE
