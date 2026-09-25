#!/usr/bin/env bash
# local-ai-session -- on-demand server lifecycle for awesome-local-ai.
#
# Starts the model server when a client needs it and shuts it down once nobody
# is using it, so a 20 GB model is not sitting on the accelerator all day.
#
 # ONE implementation serves every combination and every client. The lifecycle
 # (locking, client registry, idle reaper, config-drift warning) lives here;
 # the ~40 lines that differ per client -- how to write its provider config and
 # how to launch it -- live in $ROOT/client-<client>.sh, installed from
 # lib/clients/<client>.sh. The client to run is named by LOCAL_AI_CLIENT
 # (exported by the per-client command, e.g. <install-id>-pi), falling back to
 # the $CLIENT default baked into the manifest.
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
# Server flags (only take effect when a server is actually started):
#   <cmd> --host <addr>    which address the server listens on.
#                          127.0.0.1 (default) = only this machine can reach it.
#                          0.0.0.0 = every interface, so other machines on your
#                          network or tailnet can reach it too.
#   <cmd> --port <port>    which port to listen on (default 8080)
#
# Env: PORT PROFILE IDLE_TIMEOUT MODEL_ID PROVIDER HOST
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

# Which client adapter to load: the one the invoking command pinned, or the
# default baked into the manifest. Newer installs ship a client-<name>.sh per
# client; older ones ship only client.sh, so fall back to it.
RUN_CLIENT="${LOCAL_AI_CLIENT:-$CLIENT}"
if [[ -f "$ROOT/client-${RUN_CLIENT}.sh" ]]; then
  # shellcheck disable=SC1090
  . "$ROOT/client-${RUN_CLIENT}.sh"
else
  # shellcheck disable=SC1091
  . "$ROOT/client.sh"
fi

export PATH="$HOME/.local/bin:$PATH"

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
# Seconds with zero clients before shutdown. A combination whose model takes
# minutes to load sets a longer default in its manifest, since reloading 90 GB
# after every five-minute pause costs more than keeping it resident.
IDLE_TIMEOUT="${IDLE_TIMEOUT:-${IDLE_TIMEOUT_DEFAULT:-300}}"
POLL_INTERVAL="${POLL_INTERVAL:-10}"
MODEL_ID="${MODEL_ID:-$MODEL_ALIAS_DEFAULT}"
PROVIDER="${PROVIDER:-$DEFAULT_PROVIDER}"
SERVER_START_TIMEOUT="${SERVER_START_TIMEOUT:-${SERVER_START_TIMEOUT_DEFAULT:-300}}"

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
# NOTE the exec. Without it, `detached cmd &` records the wrong pid: because
# detached is a shell function, bash cannot turn the background job into a
# plain fork+exec, so $! is a leftover bash wrapper while setsid puts the real
# process in a new pid, process group AND session. Killing the wrapper then
# leaves the model server running -- ~22 GB parked on the accelerator, which is
# the one thing this lifecycle exists to prevent. exec makes the subshell
# become setsid, which becomes the server, so $! is the process we started.
detached() {
  if command -v setsid >/dev/null 2>&1; then
    exec setsid "$@"
  else
    exec nohup "$@"
  fi
}

# Startup is serialised on fd 9, held open on $LOCK_FILE, so two simultaneous
# invocations cannot both launch a server. flock(1) is util-linux and macOS has
# none, so fall back to perl's flock(2) -- perl ships with macOS -- on the same
# inherited descriptor. The lock belongs to the open file description, which our
# fd 9 keeps alive after perl exits: exactly how `flock 9` itself works. One
# pair of helpers, like detached(), so a new call site cannot reintroduce the
# Linux-only form.
_lock_fd9() { # LOCK_EX | LOCK_UN
  if command -v flock >/dev/null 2>&1; then
    if [[ "$1" == LOCK_UN ]]; then flock -u 9; else flock 9; fi
  else
    perl -MFcntl=:flock -e \
      'open(my $fh, ">&=", 9) or die "fd 9: $!\n"; flock($fh, $ARGV[0] eq "LOCK_UN" ? LOCK_UN : LOCK_EX) or die "flock: $!\n"' "$1"
  fi
}
lock_startup() { exec 9>"$LOCK_FILE"; _lock_fd9 LOCK_EX; }
unlock_startup() { _lock_fd9 LOCK_UN; }

server_healthy() { curl -sf --max-time 3 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; }

# Settings that change how the server behaves. Recorded at launch so a later
# invocation asking for something different is told, rather than silently
# handed a server configured the old way.
server_config_sig() {
  printf 'PROFILE=%s CTX=%s KV_TYPE=%s VISION=%s THINKING=%s EFFORT=%s THINKING_BUDGET=%s NP=%s UB=%s HOST=%s' \
    "$PROFILE" "${CTX:-default}" "${KV_TYPE:-default}" "${VISION:-default}" \
    "${THINKING:-1}" "${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}" \
    "${THINKING_BUDGET:-none}" "${NP:-default}" "${UB:-default}" "${HOST:-127.0.0.1}"
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

# Which pid is listening on our port. Asked only to verify our own stop, never
# to adopt a server we did not start.
listener_pid() {
  local p=""
  if command -v lsof >/dev/null 2>&1; then
    p="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | head -1)"
  fi
  if [[ -z "$p" ]] && command -v ss >/dev/null 2>&1; then
    p="$(ss -H -ltnp "sport = :${PORT}" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)"
  fi
  printf '%s' "$p"
}

# The address:port the server is actually bound to, for --status. Read from the
# live listener rather than from config, so it reflects reality even for a
# server this script did not start. Match the field that ends in the port
# (the local address) rather than a fixed column: ss drops columns when a
# filter is given, so positions are not stable.
listen_addr() {
  local a=""
  if command -v ss >/dev/null 2>&1; then
    a="$(ss -H -ltn "sport = :${PORT}" 2>/dev/null \
      | awk -v p=":${PORT}" '{for(i=1;i<=NF;i++) if ($i ~ p"$") {print $i; exit}}')"
  fi
  printf '%s' "${a:-${HOST:-127.0.0.1}:${PORT}}"
}

# Is this pid serving OUR model? Checked before signalling anything we did not
# get a pid for directly, so a stale ownership flag can never make us kill
# somebody else's server that happens to be on the same port.
_is_our_server_pid() {
  local pid="$1" cmd=""
  [[ -n "${MODEL_FILE:-}" ]] || return 1
  if [[ -r "/proc/$pid/cmdline" ]]; then
    cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null)"
  else
    cmd="$(ps -o command= -p "$pid" 2>/dev/null)"
  fi
  case "$cmd" in
    *"$MODEL_FILE"*) return 0 ;;
  esac
  return 1
}

# Killing the recorded pid is not proof the server is gone. Verify against the
# port, and finish the job if our model server outlived the signal.
_verify_stopped() {
  server_healthy || return 0
  local lp; lp="$(listener_pid)"
  if [[ -z "$lp" ]]; then
    log "still serving on ${PORT} after stop, listener unknown"
    say "WARNING: something is still serving on :${PORT}; it could not be identified."
    return 0
  fi
  if ! _is_our_server_pid "$lp"; then
    log "still serving on ${PORT} by pid ${lp}, not our model -- leaving it alone"
    return 0
  fi
  log "our server ${lp} outlived the stop; terminating it"
  kill "$lp" 2>/dev/null || true
  for _ in $(seq 1 30); do server_healthy || break; sleep 1; done
  if server_healthy; then
    kill -9 "$lp" 2>/dev/null || true
    for _ in $(seq 1 10); do server_healthy || break; sleep 1; done
  fi
  if server_healthy; then
    say "WARNING: a server is still running on :${PORT} (pid ${lp}); stop it by hand."
  else
    log "cleaned up leaked server ${lp}"
  fi
}

stop_server() {
  local pid owned=0
  [[ -f "$OWNED_FLAG" ]] && owned=1
  if ! pid="$(owned_server_pid)"; then
    log "no owned server to stop"
    rm -f "$SERVER_PID_FILE" "$OWNED_FLAG"
    # The flag without a live pid is the signature of a leak: the process we
    # recorded is gone but the server it started may not be.
    (( owned )) && _verify_stopped
    return 0
  fi
  log "stopping server pid $pid"
  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 30); do kill -0 "$pid" 2>/dev/null || break; sleep 1; done
  kill -0 "$pid" 2>/dev/null && { log "server did not exit, SIGKILL"; kill -9 "$pid" 2>/dev/null || true; }
  rm -f "$SERVER_PID_FILE" "$OWNED_FLAG" "$CONFIG_FILE"
  _verify_stopped
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
  local n sp addr reach
  n="$(count_clients)"
  if server_healthy; then
    sp="$(owned_server_pid || echo '')"
    addr="$(listen_addr)"
    case "$addr" in
      0.0.0.0:*|*"[::]"*) reach="all interfaces" ;;
      127.0.0.1:*|localhost:*) reach="this machine only" ;;
      *) reach="one interface only" ;;
    esac
    echo "server    : running on ${addr} [${reach}]$( [[ -n "$sp" ]] && echo " (pid $sp, managed)" || echo " (not managed by this script)" )"
    echo "model     : $(curl -s --max-time 3 "http://127.0.0.1:${PORT}/v1/models" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("models") or d.get("data"))[0].get("model") or (d.get("models") or d.get("data"))[0].get("id"))' 2>/dev/null || echo '?')"
    if [[ "$ACCEL" == "cuda" ]] && command -v nvidia-smi >/dev/null 2>&1; then
      echo "vram      : $(nvidia-smi --query-gpu=memory.used --format=csv,noheader 2>/dev/null | head -1)"
    elif [[ "$ACCEL" == "strix-halo" ]]; then
      local d
      for d in /sys/bus/pci/devices/*; do
        [[ "$(cat "$d/device" 2>/dev/null)" == "0x1586" && -r "$d/mem_info_gtt_used" ]] || continue
        echo "gtt       : $(( $(cat "$d/mem_info_gtt_used") / 1048576 )) of $(( $(cat "$d/mem_info_gtt_total") / 1048576 )) MiB"
        break
      done
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
      # Print the leading comment block (everything up to the first code line),
      # so the help keeps working as the header grows or shrinks.
      awk 'NR==1{next} /^set -euo pipefail/{exit} {print}' "$SELF" \
        | sed 's/^# \{0,1\}//' | sed "s|<cmd>|$SERVER_CMD_SESSION|g"
      exit 0 ;;
esac

SERVER_ONLY=0
[[ "${1:-}" == "--server-only" ]] && { SERVER_ONLY=1; shift; }
[[ "${1:-}" == "--" ]] && shift

# Server-facing flags: pull them out of the argument list and turn them into
# the environment the server launcher reads. Everything left over is the
# client's own arguments. Without this, e.g. `--host` would leak through to
# the client (which has no such flag) and the server would keep its default.
CLIENT_ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) [[ $# -ge 2 ]] || { say "--host needs an address (e.g. 0.0.0.0)"; exit 1; }
            HOST="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || { say "--port needs a number"; exit 1; }
            PORT="$2"; shift 2 ;;
    *)      CLIENT_ARGS+=("$1"); shift ;;
  esac
done
export HOST PORT

# Serialise startup so two simultaneous invocations cannot both launch a server.
lock_startup

if (( SERVER_ONLY )); then
  start_server
  start_watcher
  unlock_startup
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
unlock_startup
exec 9>&-

say "Launching ${CLIENT_DISPLAY_NAME} with ${PROVIDER}/${MODEL_ID} (server stops ${IDLE_TIMEOUT}s after last client exits)."
# ${arr[@]+"${arr[@]}"} expands to nothing when empty; a bare "${arr[@]}" is an
# unbound-variable error under `set -u` on bash < 4.4 (macOS ships 3.2).
client_exec "${CLIENT_ARGS[@]+"${CLIENT_ARGS[@]}"}"
