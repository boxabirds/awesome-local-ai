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
KIB_PER_GIB=1048576

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
# A reference stack (benchmarks/reference/install-stack.sh) names its own config and results folder.
RUN_BASE="$(sed -n 's/^RUN_BASE="\(.*\)"/\1/p' "$ENV_FILE")"
[[ -n "$RUN_BASE" ]] && CONFIG="$REPO_ROOT/$(sed -n 's/^CONFIG_FILE="\(.*\)"/\1/p' "$ENV_FILE")"
cfg() { sed -n "s/^$1=\"\{0,1\}\([^\"]*\)\"\{0,1\}.*/\1/p" "$CONFIG" | head -1; }
CONTEXT_LIMIT="$(cfg CONTEXT_LIMIT)"; OUTPUT_LIMIT="$(cfg OUTPUT_LIMIT)"
SERVER_CMD="$INSTALL_ID-server"
# A cloud backend (BACKEND="anthropic" in install.env) has no local server: the client talks to the provider.
CLOUD=0; [[ "$BACKEND" == anthropic ]] && CLOUD=1
[[ "$CLOUD" == 1 ]] || command -v "$SERVER_CMD" >/dev/null || { echo "no $SERVER_CMD on PATH" >&2; exit 1; }

RUN_DIR="$COMBO_DIR/benchmarks/vidi/$RUN_ID"
[[ -n "$RUN_BASE" ]] && RUN_DIR="$REPO_ROOT/$RUN_BASE/$RUN_ID"
mkdir -p "$RUN_DIR"
echo "run dir: $RUN_DIR"

SERVER_PID=""; PROXY_PID=""
cleanup() {
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && { kill -TERM -- "-$SERVER_PID" 2>/dev/null || true; }
}
trap cleanup EXIT INT TERM

if [[ "$CLOUD" == 0 ]] && curl -s -m 2 "127.0.0.1:$BENCH_PORT/v1/models" >/dev/null; then
  echo "port $BENCH_PORT already serving; refusing to benchmark against an unknown server" >&2; exit 1
fi

# The held-out suite's own toolchain: installed here so a fresh checkout on a new node runs unattended.
ACCEPTANCE="$(python3 "$HARNESS/packdir.py" acceptance)"  # private pack repo, or benchmarks/vidi
if [[ ! -d "$ACCEPTANCE/node_modules" || "$ACCEPTANCE/package-lock.json" -nt "$ACCEPTANCE/node_modules" ]]; then
  echo "installing the acceptance suite's dependencies"
  (cd "$ACCEPTANCE" && npm ci --no-audit --no-fund --silent) || { echo "acceptance suite install failed" >&2; exit 1; }
fi
# Every run: the browser matching the suite's Playwright version (a no-op when it's already there).
(cd "$ACCEPTANCE" && npx playwright install chromium >/dev/null) || { echo "playwright browser install failed" >&2; exit 1; }
"$HARNESS/check-browser.sh" "$ACCEPTANCE" || { echo "the held-out suite can't launch its browser; not starting the run" >&2; exit 1; }

echo "sandbox preflight (agent toolchain inside the sandbox)"
(cd "$HARNESS" && uv run --quiet preflight.py --client "$CLIENT_NAME") || { echo "preflight failed; not starting the run" >&2; exit 1; }

if [[ "$(uname)" == Darwin ]]; then
  echo "cooling to thermal nominal"
  python3 -c "
import sys; sys.path.insert(0, '$REPO_ROOT/benchmarks')
from thermal import wait_for_thermal
print('  thermal=' + wait_for_thermal('nominal', timeout_s=$THERMAL_TIMEOUT_S))"
fi  # elsewhere the driver waits for fit conditions (hostenv) before every story

if [[ "$CLOUD" == 1 ]]; then
  MODEL_ID="$(sed -n 's/^MODEL_ID="\(.*\)"/\1/p' "$ENV_FILE")"
  [[ -n "$MODEL_ID" ]] || { echo "cloud install $INSTALL_ID has no MODEL_ID in $ENV_FILE" >&2; exit 1; }
  echo "cloud backend $BACKEND: model $MODEL_ID (no local server)"
  AGENT_URL="cloud"
else
echo "starting $SERVER_CMD on :$BENCH_PORT (effort=$REASONING_EFFORT)"
# New session so the whole server process tree can be stopped (macOS has no setsid(1)).
PORT="$BENCH_PORT" REASONING_EFFORT="$REASONING_EFFORT" \
  python3 -c 'import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])' "$SERVER_CMD" \
  > "$RUN_DIR/server.log" 2>&1 &
SERVER_PID=$!
for ((waited = 0; waited < SERVER_READY_TIMEOUT_S; waited += POLL_S)); do
  # -f: while loading, llama-server answers /v1/models with a 503 error body, not the model list.
  curl -sf -m 2 "127.0.0.1:$BENCH_PORT/v1/models" >/dev/null && break
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
fi  # local server

if [[ "$(uname)" == Darwin ]]; then
  HOST_DESC="$(sysctl -n machdep.cpu.brand_string) $(( $(sysctl -n hw.memsize) / 1073741824 ))GB"
else
  GPU_DESC="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1 | tr -d ',')"
  HOST_DESC="$(lscpu | sed -n 's/^Model name: *//p') $(( $(awk '/MemTotal/ {print $2}' /proc/meminfo) / KIB_PER_GIB ))GB${GPU_DESC:+, $GPU_DESC}"
fi

# Which bench this run belongs to: results only compare within one version (see the private repo README).
PACK_DIR="$(python3 "$HARNESS/packdir.py")"
PACK_VERSION="$(git -C "$PACK_DIR" describe --tags --always --dirty 2>/dev/null || echo "in-repo@$(git -C "$REPO_ROOT" rev-parse --short HEAD)")"

SERVER_LOG=""
[[ "$BACKEND" == mtplx ]] && SERVER_LOG="$HOME/.mtplx/logs/request-log-$BENCH_PORT.jsonl"
case "$CLIENT_NAME" in
  pi) CLIENT_VERSION="$(pi --version 2>/dev/null)" ;;
  opencode) CLIENT_VERSION="$(opencode --version 2>/dev/null)" ;;
  claude) CLIENT_VERSION="$(claude --version 2>/dev/null | head -1)" ;;
  *) echo "unknown client $CLIENT_NAME" >&2; exit 2 ;;
esac
[[ "$CLOUD" == 1 ]] || curl -s -m 5 "127.0.0.1:$BENCH_PORT/health" > "$RUN_DIR/server-health.json" || true

# A resumed run can change setup between stories (e.g. a memory limit); keep every start.
# Effort is a setting of the local server; a cloud client runs at its own default (no flag is passed).
EFFORT_RECORDED="$REASONING_EFFORT"; [[ "$CLOUD" == 1 ]] && EFFORT_RECORDED="client default"
[[ -f "$RUN_DIR/run.json" ]] && { tr -d '\n' < "$RUN_DIR/run.json"; echo; } >> "$RUN_DIR/run-history.jsonl"
cat > "$RUN_DIR/run.json" <<JSON
{"install_id": "$INSTALL_ID", "combination": "$COMBINATION", "model_id": "$MODEL_ID",
 "scope": "$SCOPE", "metered": $METER, "reasoning_effort": "$EFFORT_RECORDED", "context_limit": $CONTEXT_LIMIT,
 "output_limit": $OUTPUT_LIMIT, "backend_version": "$( [[ "$BACKEND" == mtplx ]] && mtplx --version 2>/dev/null | awk '{print $NF}' )", "mtplx_memory_limit_bytes": "$( [[ "$BACKEND" == mtplx ]] && echo "${MTPLX_MEMORY_LIMIT_BYTES:-default}" )", "compact_at": "${COMPACT_AT:-client default}", "client": "$CLIENT_NAME", "client_version": "$CLIENT_VERSION", "backend": "$BACKEND", "host": "$HOST_DESC",
 "harness_commit": "$(git -C "$REPO_ROOT" rev-parse --short HEAD)", "pack_version": "$PACK_VERSION", "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON

cd "$HARNESS"
uv run --quiet drive.py --run-dir "$RUN_DIR" --base-url "$AGENT_URL" --client "$CLIENT_NAME" \
  ${SERVER_LOG:+--server-log "$SERVER_LOG"} \
  --model-id "$MODEL_ID" --scope "$SCOPE" --context-limit "$CONTEXT_LIMIT" --output-limit "$OUTPUT_LIMIT" \
  ${ONLY:+--only "$ONLY"} ${RECORD:+--record} ${COMPACT_AT:+--compact-at "$COMPACT_AT"}
uv run --quiet report.py "$RUN_DIR"
