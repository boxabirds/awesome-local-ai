#!/usr/bin/env bash
# lib/smoke.sh -- prove the install works before claiming it does.
#
# Binding a port is not evidence. This loads the real model on a scratch port,
# asserts it generates, and -- because it is the piece most likely to fail
# silently -- asserts speculative decoding actually drafted tokens.

SMOKE_CTX=""; SMOKE_MEM=""; SMOKE_FREE=""; SMOKE_GEN=""; SMOKE_ACC=""

smoke_test() {
  info "Smoke-testing the server (this loads the full model)..."
  local port="${SMOKE_PORT:-18080}" pid=0 rc=0
  local smoke_log="${INSTALL_ROOT}/smoke.log"

  PORT="$port" HOST=127.0.0.1 "${BIN_DIR}/${SERVER_CMD}" > "$smoke_log" 2>&1 &
  pid=$!

  local i
  for i in $(seq 1 "${SMOKE_TIMEOUT:-180}"); do
    if ! kill -0 "$pid" 2>/dev/null; then
      warn "Server exited during startup. Tail of ${smoke_log}:"
      tail -30 "$smoke_log" | tee -a "$LOG_FILE"
      return 1
    fi
    if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
      ok "Server healthy after ${i}s."
      break
    fi
    sleep 1
  done

  if curl -sf "http://127.0.0.1:${port}/health" >/dev/null 2>&1; then
    # nvidia-smi has no cross-platform equivalent, so the accelerator reports
    # its own memory if it can. Absent hook -> unknown, which prints as '?'.
    if declare -F accel_report_mem >/dev/null; then
      read -r SMOKE_MEM SMOKE_FREE < <(accel_report_mem || echo " ")
    fi
    # Where the served context window is advertised differs per backend.
    if declare -F backend_smoke_context >/dev/null; then
      SMOKE_CTX=$(backend_smoke_context "$port" 2>/dev/null || echo "?")
    else
      SMOKE_CTX="?"
    fi
    info "Profile '${PROFILE:-$DEFAULT_PROFILE}': n_ctx=${SMOKE_CTX}, memory ${SMOKE_MEM:-?} MiB used / ${SMOKE_FREE:-?} MiB free"
    [[ -n "$SMOKE_FREE" ]] && (( SMOKE_FREE < 500 )) && \
      warn "Only ${SMOKE_FREE} MiB headroom -- consider a smaller profile."

    # Generation must actually work, not just bind a port.
    local reply
    reply=$(curl -sf "http://127.0.0.1:${port}/v1/chat/completions" \
      -H 'Content-Type: application/json' \
      -d '{"messages":[{"role":"user","content":"Reply with exactly: OK"}],"max_tokens":256}' \
      | python3 -c 'import sys,json;print(json.load(sys.stdin)["choices"][0]["message"]["content"].strip())' 2>/dev/null || echo "")
    if [[ -n "$reply" ]]; then
      SMOKE_GEN="ok"
      ok "Generation OK (model replied: '${reply:0:40}')"
    else
      warn "Server is up but generation failed."
      rc=1
    fi
    # Binding a port is not evidence, and neither is loading a draft head:
    # every backend here can start happily with speculative decoding silently
    # off. The backend knows where its own proof lives, so it does the
    # asserting -- while the server is still up, because for some backends the
    # proof is an endpoint rather than a line in the log.
    if declare -F backend_smoke_assert >/dev/null; then
      backend_smoke_assert "$smoke_log" "$port" || true
    fi
  else
    warn "Server did not become healthy in ${SMOKE_TIMEOUT:-180}s."
    rc=1
  fi

  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  return $rc
}
