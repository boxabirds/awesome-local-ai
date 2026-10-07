#!/usr/bin/env bash
# run.sh -- "how does this setup implement <pack>?" for any installed combination and benchmark pack.
#
#   benchmarks/spec-bench/harness/run.sh <install-id> [--pack benchmarks/vidi] [--client pi|opencode]
#       [--scope NAME | --epic NAME] [--run-id ID] [--only 1,2] [--record] [--meter]
#       [--from-run DIR (--only N | --from-story N)]
#
# Starts the combination's own server launcher (<install-id>-server) on a bench
# port and drives a coding agent (pi by default) through the pack's stories one at
# a time (drive.py). The pack defaults to vidi, and its scope to the pack's default.
# Per-request timing comes from the server's own log where it keeps one (MTPLX).
# Results land next to the combination:
#   combinations/<COMBINATION>/benchmarks/<pack-name>/<run-id>/
# Re-running with the same --run-id resumes at the first unfinished story.
# BENCH_CONTEXT=<tokens> overrides the context (server and agent together); CLIENT_THINKING=<level>
# makes pi send a reasoning effort (for servers that can't apply one).
# A partial rerun (diagnostic, not comparable with full runs): --only N --from-run <finished run dir>
# runs story N alone on that run's code as it was when the story before ended; --from-story N --from-run <dir>
# runs story N and every later story of the scope, each built on the one before in this run.
set -euo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Two roots, the same checkout unless $SPEC_BENCH_RESULTS_ROOT is set (roots.py, the one place that decides):
# CODE_ROOT is the tree this harness is in; RESULTS_ROOT is the checkout of main where runs are written, committed
# and pushed, and where a combination's config lives. dbench runs the harness of a release from the release's own
# directory with the variable naming the node's checkout.
CODE_ROOT="$(python3 "$HARNESS/roots.py" code)"
BENCH_PORT="${BENCH_PORT:-18010}"
PROXY_PORT="${PROXY_PORT:-18100}"
REASONING_EFFORT="${REASONING_EFFORT:-low}"
SERVER_READY_TIMEOUT_S=900
POLL_S=5
THERMAL_TIMEOUT_S=1800

usage() { sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

[[ $# -ge 1 && "$1" != -h && "$1" != --help ]] || { usage; exit 0; }
RESULTS_ROOT="$(python3 "$HARNESS/roots.py" results)" || exit 1
INSTALL_ID="$1"; shift
PACK="benchmarks/vidi"; SCOPE=""; EPIC=""; RUN_ID="$(date +%Y%m%d-%H%M)"; ONLY=""; METER=0; CLIENT_NAME=pi; RECORD=""; FROM_RUN=""; FROM_STORY=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pack) PACK="${2%/}"; shift 2 ;;
    --scope) SCOPE="$2"; shift 2 ;;
    --epic) EPIC="$2"; shift 2 ;;
    --run-id) RUN_ID="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --client) CLIENT_NAME="$2"; shift 2 ;;
    --from-run) FROM_RUN="$(cd "$2" && pwd)"; shift 2 ;;
    --from-story) FROM_STORY="$2"; shift 2 ;;
    # Commit and push this run's directory after every story (a per-story record).
    --record) RECORD=1; shift ;;
    # Diagnosis only: put the metering proxy between agent and server. It rewrites
    # requests slightly (stream_options.include_usage) and was never cleared as a
    # factor in the MTPLX long-context freezes, so it is off by default.
    --meter) METER=1; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

[[ -z "$FROM_RUN" || "$ONLY" =~ ^[0-9]+$ || "$FROM_STORY" =~ ^[0-9]+$ ]] || { echo "--from-run needs --only N (that one story) or --from-story N (story N and every later story of the scope)" >&2; exit 2; }

ENV_FILE="$HOME/.local/share/$INSTALL_ID/install.env"
[[ -f "$ENV_FILE" ]] || { echo "$INSTALL_ID is not installed (no $ENV_FILE)" >&2; exit 1; }
COMBINATION="$(sed -n 's/^COMBINATION="\(.*\)"/\1/p' "$ENV_FILE")"
BACKEND="$(sed -n 's/^BACKEND="\(.*\)"/\1/p' "$ENV_FILE")"
COMBO_DIR="$RESULTS_ROOT/combinations/$COMBINATION"
CONFIG="$COMBO_DIR/config.sh"
# A reference stack (benchmarks/reference/install-stack.sh) names its own config and results folder.
RUN_BASE="$(sed -n 's/^RUN_BASE="\(.*\)"/\1/p' "$ENV_FILE")"
[[ -n "$RUN_BASE" ]] && CONFIG="$RESULTS_ROOT/$(sed -n 's/^CONFIG_FILE="\(.*\)"/\1/p' "$ENV_FILE")"
. "$HARNESS/config-value.sh"
CONTEXT_LIMIT="$(cfg CONTEXT_LIMIT "$CONFIG")"; OUTPUT_LIMIT="$(cfg OUTPUT_LIMIT "$CONFIG")"
# BENCH_CONTEXT overrides the combination's context for this run, for the server (CTX) and the agent's
# compaction limit together; changing only one would leave the other deciding when the agent compacts.
if [[ -n "${BENCH_CONTEXT:-}" ]]; then
  [[ "$BENCH_CONTEXT" =~ ^[0-9]+$ ]] || { echo "BENCH_CONTEXT must be a number of tokens" >&2; exit 1; }
  CONTEXT_LIMIT="$BENCH_CONTEXT"; export CTX="$BENCH_CONTEXT"
fi
SERVER_CMD="$INSTALL_ID-server"
# A cloud backend (BACKEND="anthropic" in install.env) has no local server: the client talks to the provider.
CLOUD=0; [[ "$BACKEND" == anthropic ]] && CLOUD=1
[[ "$CLOUD" == 1 ]] || command -v "$SERVER_CMD" >/dev/null || { echo "no $SERVER_CMD on PATH" >&2; exit 1; }

# A harness release carries the harness, not the combination: its launcher and profile reach a machine only by
# running its installer. Refuse rather than spend hours, or a run's restarts, on a configuration that is not the
# one in this checkout (A-046).
. "$HARNESS/installed-config.sh"
installed_config_drift "$INSTALL_ID" "$BACKEND" "$COMBO_DIR" "$RESULTS_ROOT" >&2 || exit 1

# The pack's name (benchmarks/<name>, or bench.json's "name") names the results folder and the records.
export SPEC_BENCH_PACK_NAME
SPEC_BENCH_PACK_NAME="$(cd "$HARNESS" && python3 -c 'import sys, pack; print(pack.load(sys.argv[1]).name)' "$PACK")" \
  || { echo "no benchmark pack at $PACK" >&2; exit 1; }
# No --scope or --epic: the pack's default_scope (vidi: canvas), or every story when it has none.
[[ -z "$SCOPE$EPIC" ]] && SCOPE="$(cd "$HARNESS" && python3 -c 'import sys, pack; print(pack.load(sys.argv[1]).default_scope or "")' "$PACK")"
RUN_DIR="$COMBO_DIR/benchmarks/$SPEC_BENCH_PACK_NAME/$RUN_ID"
# A reference stack is registered once (install-stack.sh, from benchmarks/reference/<pack>/<stack>) and runs
# every pack: its runs go under the pack being run, benchmarks/reference/<this pack>/<stack>/<run-id>.
[[ "$RUN_BASE" == benchmarks/reference/*/* ]] && RUN_BASE="benchmarks/reference/$SPEC_BENCH_PACK_NAME/${RUN_BASE##*/}"
[[ -n "$RUN_BASE" ]] && RUN_DIR="$RESULTS_ROOT/$RUN_BASE/$RUN_ID"
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

# A run the swap or memory guard stopped resumes only once the machine has recovered (machine_fit.py), checked
# before anything here takes memory: the preflight's builds and the model server. Until then it exits 75, and
# dbench waits instead of counting a restart (1 Oct 2026: a restart 30 s after the swap guard, unchecked).
(cd "$HARNESS" && uv run --quiet machine_fit.py "$RUN_DIR") || exit $?

# The agent's sandbox (sandbox.py): every agent session runs in tools/agent-sandbox, which deny everything the run was
# not given. It is built once per change of its source on this machine (cargo, from the release's own copy) and
# kept; this fails before anything starts if it cannot be had. SPEC_BENCH_SANDBOX=permissive runs the agent with no
# sandbox at all, for the harness's own tests: it cannot record a benchmark.
if [[ "${SPEC_BENCH_SANDBOX:-enforced}" == permissive && -n "$RECORD" ]]; then
  echo "SPEC_BENCH_SANDBOX=permissive runs the agent with no sandbox: it cannot record a benchmark (--record)" >&2; exit 1
fi
SANDBOX_JSON="$(python3 "$HARNESS/sandbox.py" identity)" || { echo "the agent's sandbox is not available; not starting the run" >&2; exit 1; }
echo "agent sandbox: $SANDBOX_JSON"

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
  # The browser matching the suite's Playwright version: launched, and installed only if it does not launch.
  "$HARNESS/ensure-browser.sh" "$ACCEPTANCE" || { echo "the held-out suite can't launch its browser; not starting the run" >&2; exit 1; }
  # The agents' own browsers (PLAYWRIGHT_BROWSERS_PATH in their sandbox, and linked from the default
  # location in their sandbox home): the same Chromium, so no story starts without one.
  AGENT_BROWSERS="$(cd "$HARNESS" && python3 -c 'import hostenv, pathlib; print(hostenv.agent_playwright_cache(pathlib.Path.home()))')"
  "$HARNESS/ensure-browser.sh" "$ACCEPTANCE" "$AGENT_BROWSERS" || { echo "the agents' browser ($AGENT_BROWSERS) can't launch; not starting the run" >&2; exit 1; }
else
  echo "pack $SPEC_BENCH_PACK_NAME has no held-out suite: acceptance will be reported n/a"
fi

echo "sandbox preflight (agent toolchain inside the sandbox)"
(cd "$HARNESS" && uv run --quiet preflight.py --client "$CLIENT_NAME") || { echo "preflight failed; not starting the run" >&2; exit 1; }

# harness self-test: the whole story loop, end to end, on known answers (test_pipeline.py), before any model
# server starts. A harness change that crashes at the end of a story costs hours per story otherwise (30 Sep
# 2026). A skipped self-test (no node or npm) is a failure: it proved nothing. SKIP_SELF_TEST=1 waives it for
# one run, in an emergency only.
if [[ "${SKIP_SELF_TEST:-0}" != 1 ]]; then
  echo "harness self-test (the story loop, end to end, on known answers)"
  SELF_TEST_OUT=$(cd "$HARNESS" && uv run --quiet --with pytest pytest -q -x -rs -p no:cacheprovider test_pipeline.py 2>&1)
  SELF_TEST_RC=$?
  if [[ $SELF_TEST_RC -ne 0 ]] || grep -q "skipped" <<<"$SELF_TEST_OUT"; then
    echo "$SELF_TEST_OUT" | tail -20 >&2
    echo "harness self-test failed or skipped; not starting the run" >&2; exit 1
  fi
else
  echo "harness self-test WAIVED (SKIP_SELF_TEST=1)"
fi

# Earlier runs on this machine that ended without their score of record get it now, while the machine is free:
# the self-test has passed and no model server is up (finalize_pending.py: bounded by its own time budget, most
# recent first, and it refuses while another run is active). First remember this start's PATH (and Playwright's
# platform override), so a re-score started later from a barer shell finds the same uv, node and npm
# (scoring_tools.py). Neither can fail or stop this run; the sweep's messages are not this run's errors.
python3 "$HARNESS/scoring_tools.py" remember || true
(cd "$HARNESS" && uv run --quiet finalize_pending.py --exclude "$RUN_DIR" ${RECORD:+--record} 2>&1) || true

# A cloud model doesn't run on this machine: its run is never held up for the machine's power or temperature
# (the conditions are still recorded with each story).
NO_CONDITION_WAIT=""; [[ "$CLOUD" == 1 ]] && NO_CONDITION_WAIT=1
if [[ "$(uname)" == Darwin && "$CLOUD" == 0 ]]; then
  echo "cooling to thermal nominal"
  python3 -c "
import sys; sys.path.insert(0, '$CODE_ROOT/benchmarks/perf')
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
PACK_VERSION="$("$HARNESS/pack-version.sh" "$PACK_DIR" "$SPEC_BENCH_PACK_NAME")"  # this pack's own tag, e.g. vidi-v1

SERVER_LOG=""
[[ "$BACKEND" == mtplx ]] && SERVER_LOG="$HOME/.mtplx/logs/request-log-$BENCH_PORT.jsonl"
case "$CLIENT_NAME" in
  pi) CLIENT_VERSION="$(pi --version 2>/dev/null)" ;;
  opencode) CLIENT_VERSION="$(opencode --version 2>/dev/null)" ;;
  claude) CLIENT_VERSION="$(claude --version 2>/dev/null | head -1)" ;;
  *) echo "unknown client $CLIENT_NAME" >&2; exit 2 ;;
esac
[[ "$CLOUD" == 1 ]] || curl -s -m 5 "127.0.0.1:$BENCH_PORT/health" > "$RUN_DIR/server-health.json" || true

# The harness this start runs (roots.py): its commit, and the release it is (null when run from a checkout).
HARNESS_COMMIT="$(python3 "$HARNESS/roots.py" harness-commit)"
HARNESS_RELEASE="$(python3 "$HARNESS/roots.py" release-tag)"
HARNESS_RELEASE_JSON="$(python3 "$HARNESS/roots.py" release-json)"
# A resumed run can change setup between stories (e.g. a memory limit); keep every start.
# Effort is a setting of the local server; a cloud client runs at its own default (no flag is passed).
EFFORT_RECORDED="$REASONING_EFFORT"; [[ "$CLOUD" == 1 ]] && EFFORT_RECORDED="client default"
# What this start actually runs (engine build, server command line, model files, manifest): identity.py.
IDENTITY_PORT="$BENCH_PORT"; [[ "$CLOUD" == 1 ]] && IDENTITY_PORT=0
IDENTITY_JSON="$(python3 "$HARNESS/identity.py" --env-file "$ENV_FILE" --port "$IDENTITY_PORT" 2>/dev/null)" || IDENTITY_JSON=""
[[ -n "$IDENTITY_JSON" ]] || IDENTITY_JSON=null
# The settings the engine actually applies (effort, thinking, budget, context, KV, draft, sampling, quantisation),
# read from that command line against what this run asked for: engine_settings.py. Unknowns say why.
# --startup-log: the server's own output for this start, where an engine prints what it settled on as it loaded
# (Strata's expert cache sizes itself to the free VRAM, so only the log says what this run had).
ENGINE_SETTINGS_JSON="$(printf '%s' "$IDENTITY_JSON" | python3 "$HARNESS/engine_settings.py" \
  --requested-effort "$EFFORT_RECORDED" --client "$CLIENT_NAME" --client-thinking "${CLIENT_THINKING:-}" \
  --context-limit "$CONTEXT_LIMIT" --startup-log "$RUN_DIR/server.log" 2>/dev/null)" || ENGINE_SETTINGS_JSON=""
[[ -n "$ENGINE_SETTINGS_JSON" ]] || ENGINE_SETTINGS_JSON=null
[[ -f "$RUN_DIR/run.json" ]] && { tr -d '\n' < "$RUN_DIR/run.json"; echo; } >> "$RUN_DIR/run-history.jsonl"
cat > "$RUN_DIR/run.json" <<JSON
{"install_id": "$INSTALL_ID", "combination": "$COMBINATION", "model_id": "$MODEL_ID",
 "pack": "$SPEC_BENCH_PACK_NAME", "scope": "${SCOPE:-${EPIC:+epic:$EPIC}}", "metered": $METER, "reasoning_effort": "$EFFORT_RECORDED", "client_thinking": "${CLIENT_THINKING:-}", "known_good_from": "${FROM_RUN#"$RESULTS_ROOT"/}", "context_limit": $CONTEXT_LIMIT,
 "output_limit": $OUTPUT_LIMIT, "backend_version": "$( [[ "$BACKEND" == mtplx ]] && mtplx --version 2>/dev/null | awk '{print $NF}' )", "mtplx_memory_limit_bytes": "$( [[ "$BACKEND" == mtplx ]] && echo "${MTPLX_MEMORY_LIMIT_BYTES:-default}" )", "compact_at": "${COMPACT_AT:-client default}", "client": "$CLIENT_NAME", "client_version": "$CLIENT_VERSION", "backend": "$BACKEND", "host": "$HOST_DESC",
 "harness_commit": "$HARNESS_COMMIT", "harness_release": $HARNESS_RELEASE_JSON, "pack_version": "$PACK_VERSION", "started_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "sandbox": $SANDBOX_JSON,
 "identity": $IDENTITY_JSON,
 "engine_settings": $ENGINE_SETTINGS_JSON}
JSON

cd "$HARNESS"
record_event started "harness $HARNESS_COMMIT${HARNESS_RELEASE:+ ($HARNESS_RELEASE)}, client $CLIENT_NAME, model $MODEL_ID"
uv run --quiet drive.py --run-dir "$RUN_DIR" --base-url "$AGENT_URL" --client "$CLIENT_NAME" \
  ${SERVER_LOG:+--server-log "$SERVER_LOG"} \
  --install-env "$ENV_FILE" \
  --model-id "$MODEL_ID" --pack "$PACK" ${SCOPE:+--scope "$SCOPE"} ${EPIC:+--epic "$EPIC"} \
  --context-limit "$CONTEXT_LIMIT" --output-limit "$OUTPUT_LIMIT" \
  ${ONLY:+--only "$ONLY"} ${RECORD:+--record} ${COMPACT_AT:+--compact-at "$COMPACT_AT"} \
  ${CLIENT_THINKING:+--client-thinking "$CLIENT_THINKING"} ${FROM_RUN:+--from-run "$FROM_RUN"} \
  ${FROM_STORY:+--from-story "$FROM_STORY"} \
  ${NO_CONDITION_WAIT:+--no-condition-wait}
uv run --quiet report.py "$RUN_DIR"
# The run's history as workspace.bundle, and its final build re-scored under the suite at the pack's tag
# (finalize.py), so a finished run is scored and judgeable without anyone doing it by hand. Never fails the run;
# what it could not do this time is in finalize.json, and the sweep (below, and at every later start) retries it.
uv run --quiet finalize.py "$RUN_DIR" --pack "$PACK" ${RECORD:+--record} || true
FINISHED=1
record_event finished
# And once more for any other run still waiting for its score (this one just had its own try, and is left out).
uv run --quiet finalize_pending.py --exclude "$RUN_DIR" ${RECORD:+--record} 2>&1 || true
