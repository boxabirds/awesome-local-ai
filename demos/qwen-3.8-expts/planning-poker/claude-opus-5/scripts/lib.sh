#!/usr/bin/env bash
# Shared helpers for install.sh and run.sh.
#
# Design rules, learned the hard way on this project:
#   - Depend only on bash builtins, node, and npm. `nc`, `lsof` and `curl` are
#     used when present but never required.
#   - Every wait has a deadline and a reason for giving up.
#   - Every spawned server is killed by process group, because wrangler forks a
#     workerd child that survives a kill on its parent and keeps the port.

# Everything here is written for bash 3.2, the version stock macOS still ships,
# so no associative arrays, no `wait -n`, no `${var,,}`.
MIN_BASH_MAJOR=3
if [[ -z "${BASH_VERSINFO:-}" ]] || (( BASH_VERSINFO[0] < MIN_BASH_MAJOR )); then
  echo "These scripts need bash ${MIN_BASH_MAJOR}+. Run them with bash, not sh." >&2
  exit 1
fi

RETRY_ATTEMPTS=3
RETRY_BASE_SECONDS=3
STOP_GRACE_SECONDS=8
PORT_RELEASE_TIMEOUT_SECONDS=10

# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------
if [[ -t 1 ]]; then
  C_INFO=$'\033[0;36m'; C_WARN=$'\033[0;33m'; C_ERR=$'\033[0;31m'; C_OFF=$'\033[0m'
else
  C_INFO=""; C_WARN=""; C_ERR=""; C_OFF=""
fi

log()  { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
warn() { printf '%s/!\\%s %s\n' "$C_WARN" "$C_OFF" "$*" >&2; }
die()  { printf '%sxxx%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

# --------------------------------------------------------------------------
# Retry
# --------------------------------------------------------------------------
# Wraps a command that can fail for reasons that pass: a registry blip, a
# transient D1 lock. Doubles the delay between attempts.
retry() {
  local attempts="$1" delay="$2"; shift 2
  local attempt=1
  until "$@"; do
    if (( attempt >= attempts )); then
      return 1
    fi
    warn "Attempt ${attempt}/${attempts} failed; retrying in ${delay}s"
    sleep "$delay"
    delay=$(( delay * 2 ))
    (( attempt++ ))
  done
  return 0
}

# --------------------------------------------------------------------------
# Ports
# --------------------------------------------------------------------------
# bash's /dev/tcp is a builtin, so this works on a box with no netcat.
port_is_free() {
  local port="$1"
  ! (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null
}

# Returns the first free port at or above $1, or fails after $2 candidates.
pick_port() {
  local start="$1" limit="$2" candidate
  for (( candidate = start; candidate < start + limit; candidate++ )); do
    if port_is_free "$candidate"; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

wait_for_port_release() {
  local port="$1" waited=0
  while ! port_is_free "$port"; do
    if (( waited >= PORT_RELEASE_TIMEOUT_SECONDS )); then
      return 1
    fi
    sleep 1
    (( waited++ ))
  done
  return 0
}

# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
# curl is not guaranteed; node is, because we checked for it during install.
http_ok() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1
  else
    node -e '
      const url = process.argv[1];
      const timeout = AbortSignal.timeout(3000);
      fetch(url, { signal: timeout })
        .then((r) => process.exit(r.ok ? 0 : 1))
        .catch(() => process.exit(1));
    ' "$url" >/dev/null 2>&1
  fi
}

# Waits for a server to answer, giving up early if its process has already died
# — otherwise a crash at startup costs the full timeout before anyone sees why.
#   0 = healthy, 1 = timed out, 2 = process exited
wait_for_health() {
  local url="$1" pid="$2" timeout="$3" waited=0
  while (( waited < timeout )); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 2
    fi
    if http_ok "$url"; then
      return 0
    fi
    sleep 1
    (( waited++ ))
  done
  return 1
}

# --------------------------------------------------------------------------
# Process lifecycle
# --------------------------------------------------------------------------
# Requires `set -m` in the caller: with job control on, a background child
# leads its own process group, so negating its pid reaches the whole tree.
# Falls back to a plain kill when the group is not addressable.
stop_tree() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  kill -0 "$pid" 2>/dev/null || return 0

  kill -TERM "-${pid}" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  local waited=0
  while kill -0 "$pid" 2>/dev/null && (( waited < STOP_GRACE_SECONDS )); do
    sleep 1
    (( waited++ ))
  done

  if kill -0 "$pid" 2>/dev/null; then
    warn "Process ${pid} ignored SIGTERM; sending SIGKILL"
    kill -KILL "-${pid}" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  fi

  wait "$pid" 2>/dev/null || true
}

# --------------------------------------------------------------------------
# Preconditions
# --------------------------------------------------------------------------
require_node() {
  local min_major="$1"
  command -v node >/dev/null 2>&1 \
    || die "Node is not installed. Install Node ${min_major}+ and re-run."
  command -v npm >/dev/null 2>&1 \
    || die "npm is not on PATH, though node is. Check your Node installation."

  local major
  major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  if (( major < min_major )); then
    # The e2e suite uses the global WebSocket and fetch, both Node 20+.
    die "Node ${min_major}+ required, found $(node -v 2>/dev/null || echo unknown)."
  fi
}

# node_modules can exist but be unusable after an interrupted install, which
# then fails much later with a confusing missing-module error.
dependencies_look_installed() {
  [[ -d node_modules ]] \
    && [[ -x node_modules/.bin/vite ]] \
    && [[ -x node_modules/.bin/wrangler ]] \
    && [[ -x node_modules/.bin/vitest ]]
}
