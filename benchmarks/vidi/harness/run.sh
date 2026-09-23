#!/usr/bin/env bash
# run.sh -- "how does this setup implement Vidi?" for any installed combination.
#
#   benchmarks/vidi/harness/run.sh <install-id> [--client pi|opencode] [--scope canvas] [--run-id ID] [--only 1,2] [--record] [--meter]
#
# Starts the combination's own server launcher (<install-id>-server) on a bench
# port and drives a coding agent (pi by default) through the scope one story at
# a time (drive.py). Per-request timing comes from the server's own log where it
# keeps one (MTPLX). Results land next to the combination:
#   combinations/<COMBINATION>/benchmarks/vidi/<run-id>/
# Re-running with the same --run-id resumes at the first unfinished story.
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HARNESS/../../.." && pwd)"
BENCH_PORT="${BENCH_PORT:-18010}"
PROXY_PORT="${PROXY_PORT:-18100}"
REASONING_EFFORT="${REASONING_EFFORT:-low}"
SERVER_READY_TIMEOUT_S=900
POLL_S=5
THERMAL_TIMEOUT_S=1800

usage() { sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

[[ $# -ge 1 && "$1" != -h && "$1" != --help ]] || { usage; exit 0; }
INSTALL_ID="$1"; shift
SCOPE=canvas; RUN_ID="$(date +%Y%m%d-%H%M)"; ONLY=""; METER=0; CLIENT_NAME=pi; RECORD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --scope) SCOPE="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --client) CLIENT_NAME="$2"; shift 2 ;;
    # Commit and push this run's directory after every story (a per-story record).
    --record) RECORD=1; shift ;;
    # Diagnosis only: put the metering proxy between agent and server. It rewrites
    # requests slightly (stream_options.include_usage) and was never cleared as a
    # factor in the MTPLX long-context freezes, so it is off by default.
    --meter) METER=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

ENV_FILE="$HOME/.local/share/$INSTALL_ID/install.env"
[[ -f "$ENV_FILE" ]] || { echo "$INSTALL_ID is not installed (no $ENV_FILE)" >&2; exit 1; }
COMBINATION="$(sed -n 's/^COMBINATION="\(.*\)"/\1/p' "$ENV_FILE")"
BACKEND="$(sed -n 's/^BACKEND="\(.*\)"/\1/p' "$ENV_FILE")"
COMBO_DIR="$REPO_ROOT/combinations/$COMBINATION"
CONFIG="$COMBO_DIR/config.sh"
cfg() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}.*/\1/p" "$CONFIG" | head -1; }
CONTEXT_LIMIT="$(cfg CONTEXT_LIMIT)"; OUTPUT_LIMIT="$(cfg OUTPUT_LIMIT)"
SERVER_CMD="$INSTALL_ID-server"
command -v "$SERVER_CMD" >/dev/null || { echo "no $SERVER_CMD on PATH" >&2; exit 1; }

RUN_DIR="$COMBO_DIR/benchmarks/vidi/$RUN_ID"
mkdir -p "$RUN_DIR"
echo "run dir: $RUN_DIR"

SERVER_PID=""; PROXY_PID=""
cleanup() {
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && { kill -TERM -- "-$SERVER_PID" 2>/dev/null || true; }
}
trap cleanup EXIT INT TERM

if curl -s -m 2 "127.0.0.1:$BENCH_PORT/v1/models" >/dev/null; then
  echo "port $BENCH_PORT already serving; refusing to benchmark against an unknown server" >&2; exit 1
fi

echo "cooling to thermal nominal"
python3 -c "
import sys; sys.path.insert(0, '$REPO_ROOT/benchmarks')
from thermal import wait_for_thermal
print('  thermal=' + wait_for_thermal('nominal', timeout_s=$THERMAL_TIMEOUT_S))"

echo "starting $SERVER_CMD on :$BENCH_PORT (effort=$REASONING_EFFORT)"
# New session so the whole server process tree can be stopped (macOS has no setsid(1)).
PORT="$BENCH_PORT" REASONING_EFFORT="$REASONING_EFFORT" \
  python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$SERVER_CMD" \
  > "$RUN_DIR/server.log" 2>&1 &
SERVER_PID=$!
for ((waited = 0; waited < SERVER_READY_TIMEOUT_S; waited += POLL_S)); do
  curl -s -m 2 "127.0.0.1:$BENCH_PORT/v1/models" >/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { echo "server exited; see $RUN_DIR/server.log" >&2; exit 1; }
  sleep "$POLL_S"
done
MODEL_ID="$(curl -s "127.0.0.1:$BENCH_PORT/v1/models" | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"][0]["id"])')"
echo "serving model: $MODEL_ID"

if [[ "$METER" == 1 ]]; then
  uv run --quiet "$HARNESS/meter_proxy.py" --upstream "http://127.0.0.1:$BENCH_PORT" --port "$PROXY_PORT" \
    --log "$RUN_DIR/requests.jsonl" --story-file "$RUN_DIR/current_story" > "$RUN_DIR/proxy.log" 2>&1 &
  PROXY_PID=$!
  for ((waited = 0; waited < 60; waited += 1)); do
    curl -s -m 2 "127.0.0.1:$PROXY_PORT/v1/models" >/dev/null && break; sleep 1
  done
  AGENT_URL="http://127.0.0.1:$PROXY_PORT/v1"
else
  AGENT_URL="http://127.0.0.1:$BENCH_PORT/v1"
fi

SERVER_LOG=""
[[ "$BACKEND" == mtplx ]] && SERVER_LOG="$HOME/.mtplx/logs/request-log-$BENCH_PORT.jsonl"
case "$CLIENT_NAME" in
  pi) CLIENT_VERSION="$(pi --version 2>/dev/null)" ;;
  opencode) CLIENT_VERSION="$(opencode --version 2>/dev/null)" ;;
  *) echo "unknown client $CLIENT_NAME" >&2; exit 2 ;;
esac
curl -s -m 5 "127.0.0.1:$BENCH_PORT/health" > "$RUN_DIR/server-health.json" || true

# A resumed run can change setup between stories (e.g. a memory limit); keep every start.
[[ -f "$RUN_DIR/run.json" ]] && { tr -d '\n' < "$RUN_DIR/run.json"; echo; } >> "$RUN_DIR/run-history.jsonl"
cat > "$RUN_DIR/run.json" <<JSON
{"install_id": "$INSTALL_ID", "combination": "$COMBINATION", "model_id": "$MODEL_ID",
 "scope": "$SCOPE", "metered": $METER, "reasoning_effort": "$REASONING_EFFORT", "context_limit": $CONTEXT_LIMIT,
 "output_limit": $OUTPUT_LIMIT, "mtplx_memory_limit_bytes": "${MTPLX_MEMORY_LIMIT_BYTES:-default (75% of RAM)}", "client": "$CLIENT_NAME", "client_version": "$CLIENT_VERSION", "backend": "$BACKEND", "host": "$(sysctl -n machdep.cpu.brand_string) $(( $(sysctl -n hw.memsize) / 1073741824 ))GB",
 "harness_commit": "$(git -C "$REPO_ROOT" rev-parse --short HEAD)", "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON

cd "$HARNESS"
uv run --quiet drive.py --run-dir "$RUN_DIR" --base-url "$AGENT_URL" --client "$CLIENT_NAME" \
  ${SERVER_LOG:+--server-log "$SERVER_LOG"} \
  --model-id "$MODEL_ID" --scope "$SCOPE" --context-limit "$CONTEXT_LIMIT" --output-limit "$OUTPUT_LIMIT" \
  ${ONLY:+--only "$ONLY"} ${RECORD:+--record}
uv run --quiet report.py "$RUN_DIR"
