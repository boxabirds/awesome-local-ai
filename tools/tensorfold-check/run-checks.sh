#!/usr/bin/env bash
# run-checks.sh -- TensorFold's acceptance checks on this Mac, end to end (horizon/tensorfold.md, "How to run the
# checks").
#
#   tools/tensorfold-check/run-checks.sh [--even-if-busy] [--port N] [--log <pi agent-events log>] [--help]
#
#   1. refuses to start while the Mac is benchmarking (busy.sh) unless --even-if-busy
#   2. installs the pinned TensorFold and fetches the pinned checkpoint (lib/tensorfold.sh; both idempotent)
#   3. renders a recorded pi session into the requests pi sends (capture_pi_requests.mjs, with pi's own code)
#   4. starts `tensorfold serve` exactly as the combination will (tensorfold_serve_argv), window fitted, and reads
#      the keep-prompt limit from its startup line
#   5. check 1: long-context cache retention; check 2: tool calls with pi's requests
#   6. stops the server by its PID, prints PASS/FAIL with the evidence, and, when both pass, the one-story
#      dbench submission for check 3
#
# Each run gets its own folder under ~/.local/share/awesome-local-ai/tensorfold-check/runs/<UTC time>/ (run.log,
# install.log, server.log, bodies/, keep-limit.json, check1/, check2/, verdict.json). Re-running is safe: the install
# and the weights are reused, and a new folder is made.
#
# Exit: 0 both checks pass, 1 a check failed, 2 the checks could not run, 3 the machine is busy.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COMBINATION="qwen/3.8/flash-next/macos/128GB/tensorfold-pi"
CFG="$REPO_ROOT/combinations/$COMBINATION/config.sh"
# The longest recorded mlx-serve session on this Mac with no truncated strings: 652 turns, which grow one
# uncompacted conversation past 135k tokens at about turn 45.
DEFAULT_LOG="combinations/qwen/3.8/flash-next/macos/128GB/mlxserve-pi/benchmarks/vidi/v2-r2/stories/10/agent-events.compact.jsonl.gz"
# Far from the bench ports (18010 server, 18100 proxy) and the combinations' 8010-8012.
DEFAULT_PORT=18950
# A ~105 GiB checkpoint loading from SSD, plus TensorFold's startup probes and kernel builds.
LOAD_TIMEOUT_S=1800
POLL_S=5
# run.sh (the harness) waits this long for a server to answer before it gives up on a run (SERVER_READY_TIMEOUT_S).
HARNESS_READY_TIMEOUT_S=900
# TensorFold saves nothing at shutdown with --snapshot-dir none; a minute is plenty to free its memory.
STOP_TIMEOUT_S=60
SMOKE_RUN_ID="tensorfold-smoke-01"
EXIT_FAILED=1; EXIT_ERROR=2; EXIT_BUSY=3

usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

EVEN_IF_BUSY=0; PORT="$DEFAULT_PORT"; LOG="$REPO_ROOT/$DEFAULT_LOG"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --even-if-busy) EVEN_IF_BUSY=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option $1" >&2; exit "$EXIT_ERROR" ;;
  esac
done

# ---- 1. busy? ----------------------------------------------------------------------------------------------------
. "$HERE/busy.sh"
busy="$(tfc_busy_reasons)"
if [[ -n "$busy" ]]; then
  if [[ "$EVEN_IF_BUSY" == 1 ]]; then
    printf 'busy, continuing (--even-if-busy):\n%s\n' "$busy" | sed '2,$s/^/  /'
  else
    printf 'Refusing to start: this Mac is busy.\n%s\nRun again when it is free, or pass --even-if-busy.\n' \
      "$(printf '%s\n' "$busy" | sed 's/^/  /')" >&2
    exit "$EXIT_BUSY"
  fi
fi

RUNS_ROOT="${TFC_RUNS_ROOT:-$HOME/.local/share/awesome-local-ai/tensorfold-check/runs}"
RUN_DIR="$RUNS_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$RUN_DIR"

SERVER_PID=""
stop_server() {
  [[ -n "$SERVER_PID" ]] || return 0
  if kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "stopping the server (pid $SERVER_PID)"
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    local waited=0
    while kill -0 "$SERVER_PID" 2>/dev/null && (( waited < STOP_TIMEOUT_S )); do sleep 1; waited=$((waited + 1)); done
    if kill -0 "$SERVER_PID" 2>/dev/null; then kill -KILL "$SERVER_PID" 2>/dev/null || true; fi
  fi
  wait "$SERVER_PID" 2>/dev/null || true
  SERVER_PID=""
}

pyrun() { (cd "$HERE" && uv run --quiet --no-project --python "${TFC_PYTHON:-$TENSORFOLD_PYTHON}" python -m "$@"); }

run_all() {
  trap 'stop_server' EXIT
  trap 'stop_server; exit 130' INT TERM
  echo "run folder: $RUN_DIR"

  # ---- 2. install and weights (lib/tensorfold.sh: the same code the combination's installer runs) ----------------
  LOG_FILE="$RUN_DIR/install.log"; export LOG_FILE
  . "$REPO_ROOT/lib/common.sh"
  . "$REPO_ROOT/lib/hf.sh"
  . "$CFG"
  . "$REPO_ROOT/lib/tensorfold.sh"
  ( ensure_backend && backend_fetch_model && printf '%s\n%s\n' "$TENSORFOLD_BIN" "$MODEL_ARTIFACT" > "$RUN_DIR/.resolved" ) \
    || { echo "could not install TensorFold or fetch the weights; see $RUN_DIR/install.log" >&2; return "$EXIT_ERROR"; }
  local bin model_dir; { read -r bin; read -r model_dir; } < "$RUN_DIR/.resolved"; rm -f "$RUN_DIR/.resolved"

  # ---- 3. pi's requests ---------------------------------------------------------------------------------------------
  [[ -f "$LOG" ]] || { echo "no agent log at $LOG" >&2; return "$EXIT_ERROR"; }
  command -v pi >/dev/null && command -v node >/dev/null \
    || { echo "pi and node must be on PATH: the requests are rendered with pi's own code" >&2; return "$EXIT_ERROR"; }
  echo "pi $(pi --version 2>/dev/null | head -1) renders the session in ${LOG#"$REPO_ROOT"/}"
  node "$HERE/capture_pi_requests.mjs" --log "$LOG" --out "$RUN_DIR/bodies" --model "$MODEL_ALIAS_DEFAULT" \
       --context-window "$CONTEXT_LIMIT" --max-tokens "$OUTPUT_LIMIT" || return "$EXIT_ERROR"

  # ---- 4. the server ------------------------------------------------------------------------------------------------
  if curl -s --max-time 2 -o /dev/null "http://127.0.0.1:${PORT}/" 2>/dev/null; then
    echo "something already answers on port $PORT; pass --port" >&2; return "$EXIT_ERROR"
  fi
  local -a argv=() env_kv=()
  local line
  while IFS= read -r line; do argv+=("$line"); done < <(tensorfold_serve_argv "$model_dir" "$PORT" "$MODEL_ALIAS_DEFAULT" fit 1)
  while IFS= read -r line; do env_kv+=("$line"); done < <(tensorfold_serve_env)
  printf '%q ' env "${env_kv[@]}" "$bin" "${argv[@]}" > "$RUN_DIR/server-command.txt"; echo >> "$RUN_DIR/server-command.txt"
  echo "starting: $(cat "$RUN_DIR/server-command.txt")"
  env "${env_kv[@]}" "$bin" "${argv[@]}" > "$RUN_DIR/server.log" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$RUN_DIR/server.pid"
  local waited=0
  until pyrun tfcheck.startup "$RUN_DIR/server.log" --wait-check; do
    if ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "the server exited while loading; its last lines:" >&2
      tail -n 20 "$RUN_DIR/server.log" | sed 's/^/  /' >&2
      return "$EXIT_ERROR"
    fi
    if (( waited >= LOAD_TIMEOUT_S )); then
      echo "the server did not start serving within ${LOAD_TIMEOUT_S}s; see $RUN_DIR/server.log" >&2
      return "$EXIT_ERROR"
    fi
    sleep "$POLL_S"; waited=$((waited + POLL_S))
  done
  pyrun tfcheck.startup "$RUN_DIR/server.log" > "$RUN_DIR/keep-limit.json" \
    || { echo "no keep-prompt limit in the server's startup lines; see $RUN_DIR/server.log" >&2; return "$EXIT_ERROR"; }
  local keep pi_limit load_s
  keep="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["keep_limit"])' "$RUN_DIR/keep-limit.json")"
  pi_limit="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["pi_context_limit"])' "$RUN_DIR/keep-limit.json")"
  load_s="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["load_seconds"] or "")' "$RUN_DIR/keep-limit.json")"
  echo "keep-prompt limit: $keep tokens ($(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["line"])' "$RUN_DIR/keep-limit.json"))"

  # ---- 5. the checks ------------------------------------------------------------------------------------------------
  local base="http://127.0.0.1:${PORT}" rc1=0 rc2=0
  echo "check 1: one pi conversation grown turn by turn"
  pyrun tfcheck.long_context --base-url "$base" --model "$MODEL_ALIAS_DEFAULT" --bodies "$RUN_DIR/bodies" \
        --keep-limit "$keep" --out "$RUN_DIR/check1" || rc1=$?
  echo "check 2: tool calls with pi's requests"
  pyrun tfcheck.tool_calls --base-url "$base" --model "$MODEL_ALIAS_DEFAULT" --bodies "$RUN_DIR/bodies" \
        --out "$RUN_DIR/check2" || rc2=$?

  # ---- 6. stop, report ----------------------------------------------------------------------------------------------
  stop_server
  local v1 v2 r1 r2
  v1="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["verdict"])' "$RUN_DIR/check1/results.json" 2>/dev/null || echo ERROR)"
  r1="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["reason"])' "$RUN_DIR/check1/results.json" 2>/dev/null || echo "exit $rc1")"
  v2="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["verdict"])' "$RUN_DIR/check2/results.json" 2>/dev/null || echo ERROR)"
  r2="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["reason"])' "$RUN_DIR/check2/results.json" 2>/dev/null || echo "exit $rc2")"
  python3 -c 'import json,sys; json.dump({"check1": sys.argv[1], "check2": sys.argv[2], "keep_limit": int(sys.argv[3]),
    "pi_context_limit": int(sys.argv[4]), "tensorfold": sys.argv[5]}, open(sys.argv[6], "w"), indent=1)' \
    "$v1" "$v2" "$keep" "$pi_limit" "$TENSORFOLD_VERSION@$TENSORFOLD_COMMIT" "$RUN_DIR/verdict.json"
  echo
  echo "================================================================================"
  echo "check 1 (long-context cache retention): $v1: $r1"
  echo "  evidence: $RUN_DIR/check1/summary.md  $RUN_DIR/check1/results.json"
  echo "check 2 (tool calls with pi's requests): $v2: $r2"
  echo "  evidence: $RUN_DIR/check2/summary.md  $RUN_DIR/check2/results.json"
  echo "server: $RUN_DIR/server.log (command in server-command.txt); keep-prompt limit $keep tokens; loaded in ${load_s:-?} s"
  if [[ -n "$load_s" ]] && python3 -c 'import sys; sys.exit(0 if float(sys.argv[1]) > float(sys.argv[2]) else 1)' "$load_s" "$HARNESS_READY_TIMEOUT_S"; then
    echo "  WARNING: the harness waits ${HARNESS_READY_TIMEOUT_S} s for a server to answer (run.sh SERVER_READY_TIMEOUT_S);"
    echo "  this one took ${load_s} s, so check 3 would time out before the model is ready"
  fi
  if (( CONTEXT_LIMIT <= pi_limit )); then
    echo "pi context: CONTEXT_LIMIT=$CONTEXT_LIMIT in config.sh fits (at most keep-prompt limit - 16384 = $((keep - 16384)))"
  else
    echo "pi context: set CONTEXT_LIMIT=$pi_limit in combinations/$COMBINATION/config.sh before check 3:"
    echo "  pi reserves $OUTPUT_LIMIT reply tokens per request and compacts at CONTEXT_LIMIT - 16384, so"
    echo "  CONTEXT_LIMIT=$CONTEXT_LIMIT would send prompts the server cannot keep or admit"
  fi
  if [[ "$v1" == PASS && "$v2" == PASS ]]; then
    echo "check 3 (one-story smoke test), after installing the combination on this Mac"
    echo "  (./install-qwen-3.8-flash-next-macos-128GB-tensorfold-pi.sh), from a dbench client:"
    echo "  dbench submit ${DBENCH_NODE:-<this-node>} --id $SMOKE_RUN_ID --combination $COMBINATION --pack benchmarks/vidi --scope canvas --run-id $SMOKE_RUN_ID --stories 1 --no-record"
    echo "================================================================================"
    return 0
  fi
  echo "check 3 is not offered: checks 1 and 2 must both pass first"
  echo "================================================================================"
  return "$EXIT_FAILED"
}

set +e
run_all 2>&1 | tee "$RUN_DIR/run.log"
rc=${PIPESTATUS[0]}
exit "$rc"
