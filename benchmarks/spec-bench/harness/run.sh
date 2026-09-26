#!/usr/bin/env bash
# run.sh -- "how does this setup implement <pack>?" for any installed combination and benchmark pack.
#
#   benchmarks/spec-bench/harness/run.sh <install-id> [--pack benchmarks/vidi] [--client pi|opencode]
#       [--scope NAME | --epic NAME] [--run-id ID] [--only 1,2] [--record] [--meter]
#
# Starts the combination's own server launcher (<install-id>-server) on a bench
# port and drives a coding agent (pi by default) through the pack's stories one at
# a time (drive.py). The pack defaults to vidi, and its scope to the pack's default.
# Per-request timing comes from the server's own log where it keeps one (MTPLX).
# Results land next to the combination:
#   combinations/<COMBINATION>/benchmarks/<pack-name>/<run-id>/
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

usage() { sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

[[ $# -ge 1 && "$1" != -h && "$1" != --help ]] || { usage; exit 0; }
INSTALL_ID="$1"; shift
PACK="benchmarks/vidi"; SCOPE=""; EPIC=""; RUN_ID="$(date +%Y%m%d-%H%M)"; ONLY=""; METER=0; CLIENT_NAME=pi; RECORD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pack) PACK="${2%/}"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --epic) EPIC="$2"; shift 2 ;;
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
. "$HARNESS/config-value.sh"
CONTEXT_LIMIT="$(cfg CONTEXT_LIMIT "$CONFIG")"; OUTPUT_LIMIT="$(cfg OUTPUT_LIMIT "$CONFIG")"
SERVER_CMD="$INSTALL_ID-server"
# A cloud backend (BACKEND="anthropic" in install.env) has no local server: the client talks to the provider.
CLOUD=0; [[ "$BACKEND" == anthropic ]] && CLOUD=1
[[ "$CLOUD" == 1 ]] || command -v "$SERVER_CMD" >/dev/null || { echo "no $SERVER_CMD on PATH" >&2; exit 1; }

# The pack's name (benchmarks/<name>, or bench.json's "name") names the results folder and the records.
export SPEC_BENCH_PACK_NAME
SPEC_BENCH_PACK_NAME="$(cd "$HARNESS" && python3 -c 'import sys, pack; print(pack.load(sys.argv[1]).name)' "$PACK")" \
  || { echo "no benchmark pack at $PACK" >&2; exit 1; }
# No --scope or --epic: the pack's default_scope (vidi: canvas), or every story when it has none.
[[ -z "$SCOPE$EPIC" ]] && SCOPE="$(cd "$HARNESS" && python3 -c 'import sys, pack; print(pack.load(sys.argv[1]).default_scope or "")' "$PACK")"
RUN_DIR="$COMBO_DIR/benchmarks/$SPEC_BENCH_PACK_NAME/$RUN_ID"
[[ -n "$RUN_BASE" ]] && RUN_DIR="$REPO_ROOT/$RUN_BASE/$RUN_ID"
mkdir -p "$RUN_DIR"
echo "run dir: $RUN_DIR"

# With --record, the run's start, end and failures are pushed too (record_event.py), not only its
# stories: a run that refuses to start or dies mid-story would otherwise commit nothing at all.
ERR_LOG="$(mktemp)"
exec 2> >(tee -a "$ERR_LOG" >&2)
ERR_FLUSH_S=0.5      # let tee write the last error line before it's read
ERR_REASON_LINES=3
record_event() { [[ -n "$RECORD" ]] && (cd "$HARNESS" && uv run --quiet record_event.py "$RUN_DIR" "$@") || true; }

SERVER_PID=""; PROXY_PID=""; STOPPED=""; FINISHED=""
cleanup() {
  local rc=$?
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  [[ -n "$SERVER_PID" ]] && { kill -TERM -- "-$SERVER_PID" 2>/dev/null || true; }
  if [[ -z "$FINISHED" ]]; then
    sleep "$ERR_FLUSH_S"
    local why; why="exit $rc: $(tail -n "$ERR_REASON_LINES" "$ERR_LOG" | tr '\n' ' ')"
    if [[ -n "$STOPPED" ]]; then record_event stopped "$why"; elif [[ $rc -ne 0 ]]; then record_event failed "$why"; fi
  fi
  rm -f "$ERR_LOG"
  # The run's own status, whatever the last line above returned: under set -e a false test
  # here (e.g. no server to stop, on a cloud stack) otherwise becomes the script's exit code.
  exit "$rc"
}
trap cleanup EXIT
trap 'STOPPED=1; exit 143' INT TERM

if [[ "$CLOUD" == 0 ]] && curl -s -m 2 "127.0.0.1:$BENCH_PORT/v1/models" >/dev/null; then
  echo "port $BENCH_PORT already serving; refusing to benchmark against an unknown server" >&2; exit 1
fi

. "$HARNESS/playwright-platform.sh"   # Ubuntu newer than Playwright knows: use its 24.04 Chromium
# The held-out suite's own toolchain: installed here so a fresh checkout on a new node runs unattended.
# A pack without a suite (a spec only, so far) skips this and reports acceptance as n/a.
ACCEPTANCE="$(python3 "$HARNESS/packdir.py" --pack "$PACK" acceptance)"  # private pack repo, or the public pack
if [[ -d "$ACCEPTANCE/tests" ]]; then
  if [[ ! -d "$ACCEPTANCE/node_modules" || "$ACCEPTANCE/package-lock.json" -nt "$ACCEPTANCE/node_modules" ]]; then
    echo "installing the acceptance suite's dependencies"
    (cd "$ACCEPTANCE" && npm ci --no-audit --no-fund --silent) || { echo "acceptance suite install failed" >&2; exit 1; }
  fi
  # Every run: the browser matching the suite's Playwright version (a no-op when it's already there).
  (cd "$ACCEPTANCE" && npx playwright install chromium >/dev/null) || { echo "playwright browser install failed" >&2; exit 1; }
  "$HARNESS/check-browser.sh" "$ACCEPTANCE" || { echo "the held-out suite can't launch its browser; not starting the run" >&2; exit 1; }
else
  echo "pack $SPEC_BENCH_PACK_NAME has no held-out suite: acceptance will be reported n/a"
fi

echo "sandbox preflight (agent toolchain inside the sandbox)"
(cd "$HARNESS" && uv run --quiet preflight.py --client "$CLIENT_NAME") || { echo "preflight failed; not starting the run" >&2; exit 1; }

if [[ "$(uname)" == Darwin ]]; then
  echo "cooling to thermal nominal"
  python3 -c "
import sys; sys.path.insert(0, '$REPO_ROOT/benchmarks/perf')
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
# New session so the whole server process tree can be stopped (macOS has no setsid(1)). The log is
# appended, never truncated: each start opens with a marker giving its wall-clock time, which
# llama_log.py needs to place each request's timings (the server's own clock starts at 0).
PORT="$BENCH_PORT" REASONING_EFFORT="$REASONING_EFFORT" \
  python3 -c 'import os, sys, time
sys.path.insert(0, sys.argv[1]); import llama_log
print(llama_log.start_marker(time.time()), end="", flush=True)
os.setsid(); os.execvp(sys.argv[2], sys.argv[2:])' "$HARNESS" "$SERVER_CMD" \
  >> "$RUN_DIR/server.log" 2>&1 &
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

. "$HARNESS/host-desc.sh"
HOST_DESC="$(host_desc)"

# Which bench this run belongs to: results only compare within one version (see the private repo README).
PACK_DIR="$(python3 "$HARNESS/packdir.py" --pack "$PACK")"
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
 "pack": "$SPEC_BENCH_PACK_NAME", "scope": "${SCOPE:-${EPIC:+epic:$EPIC}}", "metered": $METER, "reasoning_effort": "$EFFORT_RECORDED", "context_limit": $CONTEXT_LIMIT,
 "output_limit": $OUTPUT_LIMIT, "backend_version": "$( [[ "$BACKEND" == mtplx ]] && mtplx --version 2>/dev/null | awk '{print $NF}' )", "mtplx_memory_limit_bytes": "$( [[ "$BACKEND" == mtplx ]] && echo "${MTPLX_MEMORY_LIMIT_BYTES:-default}" )", "compact_at": "${COMPACT_AT:-client default}", "client": "$CLIENT_NAME", "client_version": "$CLIENT_VERSION", "backend": "$BACKEND", "host": "$HOST_DESC",
 "harness_commit": "$(git -C "$REPO_ROOT" rev-parse --short HEAD)", "pack_version": "$PACK_VERSION", "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON

cd "$HARNESS"
record_event started "harness $(git -C "$REPO_ROOT" rev-parse --short HEAD), client $CLIENT_NAME, model $MODEL_ID"
uv run --quiet drive.py --run-dir "$RUN_DIR" --base-url "$AGENT_URL" --client "$CLIENT_NAME" \
  ${SERVER_LOG:+--server-log "$SERVER_LOG"} \
  --model-id "$MODEL_ID" --pack "$PACK" ${SCOPE:+--scope "$SCOPE"} ${EPIC:+--epic "$EPIC"} \
  --context-limit "$CONTEXT_LIMIT" --output-limit "$OUTPUT_LIMIT" \
  ${ONLY:+--only "$ONLY"} ${RECORD:+--record} ${COMPACT_AT:+--compact-at "$COMPACT_AT"}
uv run --quiet report.py "$RUN_DIR"
FINISHED=1
record_event finished
