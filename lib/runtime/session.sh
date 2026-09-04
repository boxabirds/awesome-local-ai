#!/usr/bin/env bash
# local-ai-session -- on-demand server lifecycle for awesome-local-ai.
#
# Starts the model server when a client needs it and shuts it down once nobody
# is using it, so a 20 GB model is not sitting on the accelerator all day.
#
# ONE implementation serves every combination and every client. The lifecycle
# (locking, client registry, idle reaper, config-drift warning) lives here;
# the ~40 lines that differ per client -- how to write its provider config and
# how to launch it -- live in $ROOT/client.sh, installed from
# lib/clients/<client>.sh.
#
# Behaviour:
#   * Starts the server only if one is not already serving on $PORT.
#   * Registers this invocation as a client, then runs the client in the
#     foreground (TUIs need the terminal).
#   * A single detached watcher reaps the server once no client has been alive
#     for $IDLE_TIMEOUT seconds (default 300).
#   * Running this again registers a new client, which resets the idle
#     countdown and reuses the already-running server.
#   * Only ever stops a server it started. One you launched yourself is left
#     alone.
#
# Usage:
#   <cmd>                  start server (if needed) + client
#   <cmd> --status         show server, clients, idle timer
#   <cmd> --stop           stop watcher and owned server now
#   <cmd> --server-only    start server + watcher, no client
#   <cmd> -- <args...>     pass args through to the client
#
#   THINKING=0 <cmd>       disable reasoning (faster, terser)
#   PROFILE=vision <cmd>   enable image input
#
# Env: PORT PROFILE IDLE_TIMEOUT MODEL_ID PROVIDER
#      plus anything the server launcher understands -- CTX, KV_TYPE, VISION,
#      THINKING, THINKING_BUDGET, NP, UB -- which is passed straight through.
#      NOTE: these only apply when a server is actually started. If one is
#      already running it is reused as-is, and the script warns if your
#      requested settings differ from the running server's.

set -euo pipefail

: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
[[ -n "${HOME:-}" ]] || { echo "local-ai-session: cannot determine HOME." >&2; exit 1; }

[[ -n "${LOCAL_AI_INSTALL_REL:-}" ]] || {
  echo "local-ai-session: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. qwen38-27b-opencode) instead." >&2
  exit 1; }

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-session: no install manifest at $ROOT/install.env" >&2; exit 1; }
# shellcheck disable=SC1091
. "$ROOT/install.env"
# shellcheck disable=SC1091
. "$ROOT/client.sh"

export PATH="$HOME/.local/bin:$PATH"

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-300}"     # seconds with zero clients before shutdown
POLL_INTERVAL="${POLL_INTERVAL:-10}"
MODEL_ID="${MODEL_ID:-$MODEL_ALIAS_DEFAULT}"
PROVIDER="${PROVIDER:-$DEFAULT_PROVIDER}"
SERVER_START_TIMEOUT="${SERVER_START_TIMEOUT:-300}"

STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/$INSTALL_ID"
CLIENTS_DIR="$STATE_DIR/clients"
SERVER_PID_FILE="$STATE_DIR/server.pid"
OWNED_FLAG="$STATE_DIR/server.owned"
WATCHER_PID_FILE="$STATE_DIR/watcher.pid"
LOCK_FILE="$STATE_DIR/lock"
LOG_FILE="$STATE_DIR/session.log"
SERVER_LOG="$STATE_DIR/server.log"
CONFIG_FILE="$STATE_DIR/server.config"

mkdir -p "$CLIENTS_DIR"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

log() { printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"; }
say() { printf '%s\n' "$*" >&2; }
now() { date +%s; }

# Run a command detached from our controlling terminal so it survives the
# client exiting. setsid does that properly, but macOS has no setsid -- there,
# nohup leaves the process in our group and merely immune to SIGHUP, which is
# enough: the idle watcher stops the server explicitly rather than relying on
# signal delivery. One helper, so a new call site cannot reintroduce the
# unguarded form.
detached() {
  if command -v setsid >/dev/null 2>&1; then
    setsid "$@"
  else
    nohup "$@"
  fi
}

server_healthy() { curl -sf --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; }

# Settings that change how the server behaves. Recorded at launch so a later
# invocation asking for something different is told, rather than silently
# handed a server configured the old way.
server_config_sig() {
  printf 'PROFILE=%s CTX=%s KV_TYPE=%s VISION=%s THINKING=%s EFFORT=%s THINKING_BUDGET=%s NP=%s UB=%s' \
    "$PROFILE" "${CTX:-default}" "${KV_TYPE:-default}" "${VISION:-default}" \
    "${THINKING:-1}" "${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}" \
    "${THINKING_BUDGET:-none}" "${NP:-default}" "${UB:-default}"
}

# A registered pid counts as a live client if it is alive AND looks like the
# client binary. The mtime grace window covers the gap between registering and
# exec'ing the client, when the process is still this shell.
is_live_client() {
  local pid="$1" f="$2" age
  kill -0 "$pid" 2>/dev/null || return 1
  age=$(( $(now) - $(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null || echo 0) ))
  (( age < 60 )) && return 0
  client_matches_pid "$pid"
}

# Prune dead registrations; echo how many clients remain.
count_clients() {
  local n=0 f pid
  shopt -s nullglob
  for f in "$CLIENTS_DIR"/*; do
    pid="$(basename "$f")"
    if is_live_client "$pid" "$f"; then n=$((n+1)); else rm -f "$f"; fi
  done
  shopt -u nullglob
  printf '%s' "$n"
}

owned_server_pid() {
  [[ -f "$OWNED_FLAG" && -f "$SERVER_PID_FILE" ]] || return 1
  local p; p="$(cat "$SERVER_PID_FILE" 2>/dev/null || true)"
  [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null && printf '%s' "$p"
}

stop_server() {
  local pid
  if ! pid="$(owned_server_pid)"; then
    log "no owned server to stop"
    rm -f "$SERVER_PID_FILE" "$OWNED_FLAG"
    return 0
  fi
  log "stopping server pid $pid"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && { log "server did not exit, SIGKILL"; kill -9 "$pid" 2>/dev/null || true; }
  rm -f "$SERVER_PID_FILE" "$OWNED_FLAG" "$CONFIG_FILE"
  log "server stopped"
}

start_server() {
  if server_healthy; then
    # Something is already serving. If we did not start it, never kill it.
    if ! owned_server_pid >/dev/null; then
      log "reusing server on :$PORT that this script does not own"
      say "Reusing existing server on :${PORT} (not managed by this script)."
      return 0
    fi
    # Reusing our own server: settings passed now had no effect on it.
    local want running
    want="$(server_config_sig)"
    running="$(cat "$CONFIG_FILE" 2>/dev/null || echo '')"
    if [[ -n "$running" && "$want" != "$running" ]]; then
      say ""
      say "NOTE: reusing the server already running on :${PORT}; your settings were NOT applied."
      say "  running  : $running"
      say "  you asked: $want"
      say "  To apply them: $SERVER_CMD_SESSION --stop  &&  <your env> $SERVER_CMD_SESSION"
      say ""
      log "reuse with differing config; running=[$running] wanted=[$want]"
    fi
    return 0
  fi

  command -v "$SERVER_CMD" >/dev/null 2>&1 || {
    say "$SERVER_CMD not found on PATH. Run the install script first."; exit 1; }

  say "Starting ${DISPLAY_NAME} server (PROFILE=$PROFILE) on :${PORT}..."
  log "starting server PROFILE=$PROFILE PORT=$PORT"
  server_config_sig > "$CONFIG_FILE"
  # Everything else (CTX, KV_TYPE, VISION, THINKING, ...) is inherited from
  # this script's environment.
  #
  PORT="$PORT" PROFILE="$PROFILE" detached "$SERVER_CMD" >>"$SERVER_LOG" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$SERVER_PID_FILE"
  : > "$OWNED_FLAG"

  local i
  for i in $(seq 1 "$SERVER_START_TIMEOUT"); do
    if ! kill -0 "$pid" 2>/dev/null; then
      say "Server exited during startup. Last lines of $SERVER_LOG:"
      tail -15 "$SERVER_LOG" >&2
      rm -f "$SERVER_PID_FILE" "$OWNED_FLAG"
      exit 1
    fi
    server_healthy && { say "Server ready after ${i}s."; log "server ready pid $pid after ${i}s"; return 0; }
    sleep 1
  done
  say "Server did not become healthy in ${SERVER_START_TIMEOUT}s; see $SERVER_LOG"
  exit 1
}

start_watcher() {
  local wp
  if [[ -f "$WATCHER_PID_FILE" ]]; then
    wp="$(cat "$WATCHER_PID_FILE" 2>/dev/null || true)"
    [[ -n "$wp" ]] && kill -0 "$wp" 2>/dev/null && return 0   # already watching
  fi
  LOCAL_AI_INSTALL_REL="$LOCAL_AI_INSTALL_REL" detached "$SELF" --watcher >/dev/null 2>&1 < /dev/null &
  log "watcher started pid $!"
}

# ---- the reaper -----------------------------------------------------------
watcher_loop() {
  echo $$ > "$WATCHER_PID_FILE"
  trap 'rm -f "$WATCHER_PID_FILE"' EXIT
  log "watcher running (idle timeout ${IDLE_TIMEOUT}s)"
  local n idle last_seen
  last_seen="$(now)"
  while true; do
    if ! server_healthy; then
      log "server no longer healthy; watcher exiting"
      rm -f "$SERVER_PID_FILE" "$OWNED_FLAG"
      exit 0
    fi
    n="$(count_clients)"
    if (( n > 0 )); then
      last_seen="$(now)"
    else
      idle=$(( $(now) - last_seen ))
      if (( idle >= IDLE_TIMEOUT )); then
        log "no clients for ${idle}s (>= ${IDLE_TIMEOUT}s); shutting server down"
        stop_server
        exit 0
      fi
    fi
    sleep "$POLL_INTERVAL"
  done
}

show_status() {
  local n sp
  n="$(count_clients)"
  if server_healthy; then
    sp="$(owned_server_pid || echo '')"
    echo "server    : running on :${PORT}$( [[ -n "$sp" ]] && echo " (pid $sp, managed)" || echo " (not managed by this script)" )"
    echo "model     : $(curl -s --max-time 3 "http://127.0.0.1:${PORT}/v1/models" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("models") or d.get("data"))[0].get("model") or (d.get("models") or d.get("data"))[0].get("id"))' 2>/dev/null || echo '?')"
    if [[ "$ACCEL" == "cuda" ]] && command -v nvidia-smi >/dev/null 2>&1; then
      echo "vram      : $(nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>/dev/null | head -1)"
    fi
  else
    echo "server    : not running"
  fi
  if [[ -f "$WATCHER_PID_FILE" ]] && kill -0 "$(cat "$WATCHER_PID_FILE")" 2>/dev/null; then
    echo "watcher   : running (pid $(cat "$WATCHER_PID_FILE"), idle timeout ${IDLE_TIMEOUT}s)"
  else
    echo "watcher   : not running"
  fi
  [[ -f "$CONFIG_FILE" ]] && echo "config    : $(cat "$CONFIG_FILE")"
  echo "clients   : $n"
  echo "state dir : $STATE_DIR"
  echo "log       : $LOG_FILE"
}

# ---- entry points ---------------------------------------------------------
SERVER_CMD_SESSION="${SESSION_CMD:-local-ai-session}"

case "${1:-}" in
  --watcher) watcher_loop; exit 0 ;;
  --status)  show_status; exit 0 ;;
  --stop)
      if [[ -f "$WATCHER_PID_FILE" ]]; then
        kill "$(cat "$WATCHER_PID_FILE")" 2>/dev/null || true
        rm -f "$WATCHER_PID_FILE"
      fi
      stop_server
      say "Stopped."
      exit 0 ;;
  -h|--help)
      sed -n '2,40p' "$SELF" | sed 's/^# \{0,1\}//' | sed "s|<cmd>|$SERVER_CMD_SESSION|g"
      exit 0 ;;
esac

SERVER_ONLY=0
[[ "${1:-}" == "--server-only" ]] && { SERVER_ONLY=1; shift; }
[[ "${1:-}" == "--" ]] && shift

# Serialise startup so two simultaneous invocations cannot both launch a server.
exec 9>"$LOCK_FILE"
flock 9

if (( SERVER_ONLY )); then
  start_server
  start_watcher
  flock -u 9
  say "Server running on :${PORT}. Idle shutdown in ${IDLE_TIMEOUT}s if no client connects."
  say "Status: $SERVER_CMD_SESSION --status"
  exit 0
fi

client_ensure_installed
client_write_config
start_server

# Register before exec: this shell's pid becomes the client's pid after exec,
# so the registration dies exactly when the client does.
touch "$CLIENTS_DIR/$$"
log "client registered pid $$ (clients now $(count_clients))"
start_watcher
flock -u 9
exec 9>&-

say "Launching ${CLIENT_DISPLAY_NAME} with ${PROVIDER}/${MODEL_ID} (server stops ${IDLE_TIMEOUT}s after last client exits)."
client_exec "$@"
