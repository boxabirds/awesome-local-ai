#!/usr/bin/env bash
# Run the app locally.
#
#   ./scripts/run.sh          serve the built SPA + API from one worker
#   ./scripts/run.sh dev      Vite hot reload on :5173, proxying /api to the worker
#   ./scripts/run.sh test     start a server, run unit + e2e suites, shut down
#
#   PORT=9000 ./scripts/run.sh       pin the worker port instead of auto-picking
#
# Resilience: picks a free port, retries if something grabs it first, tears down
# the whole worker process tree on any exit path, and never waits on a server
# that has already died.
set -euo pipefail
# Job control, so each background child leads its own process group and a group
# kill reaches the workerd that wrangler forks. Without this, workerd outlives
# the script and keeps holding the port.
set -m

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=scripts/lib.sh
source "${REPO_ROOT}/scripts/lib.sh"

MODE="${1:-serve}"
MIN_NODE_MAJOR=20
DEFAULT_WORKER_PORT=8787
PORT_SCAN_LIMIT=20
BIND_ATTEMPTS=3
VITE_PORT=5173
VITE_PORT_SCAN_LIMIT=10
HEALTH_TIMEOUT_SECONDS=45
D1_BINDING="DB"

WORKER_LOG="$(mktemp "${TMPDIR:-/tmp}/pointing-poker-worker.XXXXXX")"
WORKER_PID=""
VITE_PID=""
CLEANED_UP=0

# --------------------------------------------------------------------------
# Teardown
# --------------------------------------------------------------------------
# Runs on every exit path including Ctrl-C and `set -e` aborts. Guarded against
# re-entry, and it must never change the exit code the script is already
# carrying, or a failing test would report success.
cleanup() {
  local exit_code=$?
  (( CLEANED_UP )) && return $exit_code
  CLEANED_UP=1
  trap - INT TERM EXIT

  [[ -n "$VITE_PID" ]] && stop_tree "$VITE_PID"
  [[ -n "$WORKER_PID" ]] && stop_tree "$WORKER_PID"
  rm -f "$WORKER_LOG"
  return $exit_code
}
trap 'cleanup; exit' INT TERM
trap cleanup EXIT

# --------------------------------------------------------------------------
# Preconditions
# --------------------------------------------------------------------------
require_node "$MIN_NODE_MAJOR"
dependencies_look_installed \
  || die "Dependencies are missing or incomplete. Run ./scripts/install.sh first."

# Static Assets serves ./dist. Without it the worker answers the API fine but
# every page request 404s, which looks like a routing bug and is not one.
ensure_build() {
  if [[ ! -f dist/index.html ]]; then
    log "No build found; building"
    npm run build || die "Frontend build failed."
  fi
}

ensure_migrations() {
  apply() { npx wrangler d1 migrations apply "$D1_BINDING" --local >/dev/null 2>&1; }
  log "Applying local D1 migrations"
  # Applying an already-applied migration is a no-op, so this stays cheap.
  retry "$RETRY_ATTEMPTS" "$RETRY_BASE_SECONDS" apply \
    || die "Local migrations failed. If .wrangler/state is corrupt, delete it and re-run."
}

# --------------------------------------------------------------------------
# Port selection
# --------------------------------------------------------------------------
choose_port() {
  if [[ -n "${PORT:-}" ]]; then
    port_is_free "$PORT" || die "Port ${PORT} is already in use."
    printf '%s' "$PORT"
    return 0
  fi
  pick_port "$DEFAULT_WORKER_PORT" "$PORT_SCAN_LIMIT" \
    || die "No free port in ${DEFAULT_WORKER_PORT}..$(( DEFAULT_WORKER_PORT + PORT_SCAN_LIMIT - 1 ))."
}

# --------------------------------------------------------------------------
# Worker
# --------------------------------------------------------------------------
# Between picking a port and wrangler binding it, another process can take it.
# Rather than dying on a raw kj::Exception, try the next free port.
start_worker() {
  local quiet="$1" attempt port

  for (( attempt = 1; attempt <= BIND_ATTEMPTS; attempt++ )); do
    port="$(choose_port)"
    BASE_URL="http://127.0.0.1:${port}"
    WORKER_PORT="$port"

    if [[ "$quiet" == "quiet" ]]; then
      npx wrangler dev --port "$port" --local >"$WORKER_LOG" 2>&1 &
    else
      npx wrangler dev --port "$port" --local 2>&1 | tee "$WORKER_LOG" &
    fi
    WORKER_PID=$!

    local status=0
    wait_for_health "${BASE_URL}/health" "$WORKER_PID" "$HEALTH_TIMEOUT_SECONDS" || status=$?

    case "$status" in
      0)
        log "Worker healthy on ${BASE_URL}"
        return 0
        ;;
      2)
        # Exited during startup. A port race is worth another go; anything else
        # is a real error and retrying would just hide it.
        WORKER_PID=""
        if grep -qi "address already in use" "$WORKER_LOG" 2>/dev/null; then
          warn "Port ${port} was taken between the check and the bind; trying another"
          continue
        fi
        warn "The worker exited during startup. Last lines of its log:"
        tail -20 "$WORKER_LOG" >&2
        return 1
        ;;
      *)
        warn "The worker never answered /health within ${HEALTH_TIMEOUT_SECONDS}s. Last lines:"
        tail -20 "$WORKER_LOG" >&2
        stop_tree "$WORKER_PID"
        WORKER_PID=""
        return 1
        ;;
    esac
  done

  warn "Could not bind a port after ${BIND_ATTEMPTS} attempts."
  return 1
}

# --------------------------------------------------------------------------
# Modes
# --------------------------------------------------------------------------
case "$MODE" in
  serve)
    PORT_TO_USE="$(choose_port)"
    ensure_migrations
    ensure_build
    [[ "$PORT_TO_USE" == "${PORT:-$DEFAULT_WORKER_PORT}" ]] \
      || warn "Port ${DEFAULT_WORKER_PORT} is taken; using ${PORT_TO_USE}."
    log "Worker + SPA on http://127.0.0.1:${PORT_TO_USE}"
    log "Open a room, then share the URL with a second browser to see it sync."
    # Hand the terminal to wrangler: it owns Ctrl-C from here, and there is no
    # background child left for the trap to clean up.
    cleanup
    exec npx wrangler dev --port "$PORT_TO_USE" --local
    ;;

  dev)
    choose_port >/dev/null
    ensure_migrations
    ensure_build
    start_worker "loud" || die "Could not start the worker."

    VITE_ACTUAL_PORT="$(pick_port "$VITE_PORT" "$VITE_PORT_SCAN_LIMIT")" \
      || die "No free port for Vite in ${VITE_PORT}..$(( VITE_PORT + VITE_PORT_SCAN_LIMIT - 1 ))."
    [[ "$VITE_ACTUAL_PORT" == "$VITE_PORT" ]] \
      || warn "Port ${VITE_PORT} is taken; Vite will use ${VITE_ACTUAL_PORT}."

    log "Vite on http://127.0.0.1:${VITE_ACTUAL_PORT} (edit src/ and it hot-reloads)"
    # vite.config.ts reads VITE_WORKER_PORT to point its /api proxy, including
    # the WebSocket upgrade, at whichever port the worker actually got.
    VITE_WORKER_PORT="$WORKER_PORT" \
      npx vite --port "$VITE_ACTUAL_PORT" --strictPort &
    VITE_PID=$!

    # Exit as soon as either half dies, rather than leaving a half-running stack.
    # A poll, not `wait -n`: that needs bash 5.1+ and stock macOS ships 3.2.
    while kill -0 "$WORKER_PID" 2>/dev/null && kill -0 "$VITE_PID" 2>/dev/null; do
      sleep 1
    done
    warn "One of the two servers exited; shutting the other down."
    ;;

  test)
    choose_port >/dev/null
    ensure_migrations
    ensure_build
    start_worker "quiet" || die "Could not start a server to test against."

    log "Running unit tests"
    npm test

    log "Running e2e suite against ${BASE_URL}"
    E2E_BASE_URL="$BASE_URL" node tests/e2e.mjs
    log "All suites passed."
    ;;

  -h|--help)
    sed -n '2,12p' "$0"
    ;;

  *)
    die "Unknown mode '${MODE}'. Use: serve | dev | test"
    ;;
esac
