#!/usr/bin/env bash
# Bash wrapper for the production start script (mirrors scripts/start.mjs).
# Resilient to an already-running server on the target port.
#   ./scripts/start.sh                 # build dist/ if needed, then serve on $PORT (default 8788)
#   ./scripts/start.sh --dev           # delegate to the resilient dev orchestrator (scripts/dev.mjs)
#   PORT=9000 ./scripts/start.sh       # use a different port
#   SKIP_BUILD=1 ./scripts/start.sh    # do not auto-build dist/
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8788}"
DEV=0
for arg in "$@"; do
  case "$arg" in
    --dev) DEV=1 ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "start.sh: unknown arg '$arg' (see --help)" >&2; exit 2 ;;
  esac
done

if [ "$DEV" -eq 1 ]; then
  exec env WS_PORT="${WS_PORT:-$PORT}" node scripts/dev.mjs
fi

# Return 0 if our planning-poker server already answers on the port
# (its served page contains id="root"; a foreign HTTP service does not).
is_our_server() {
  local body
  body="$(curl -s --max-time 2 "http://127.0.0.1:${PORT}/" 2>/dev/null || true)"
  case "$body" in
    *'id="root"'*) return 0 ;;
    *) return 1 ;;
  esac
}

# Return 0 if anything is listening on the TCP port. Prefers nc, falls back
# to bash /dev/tcp (macOS ships GNU nc where `-w` is the timeout).
port_occupied() {
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 127.0.0.1 "$PORT" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") >/dev/null 2>&1
  fi
}

if is_our_server; then
  echo "[prod] a compatible server already listens on :${PORT} — assuming it serves the app. Nothing to start."
  exit 0
fi

if port_occupied; then
  echo "[prod] ERROR: port ${PORT} is occupied by a non-planning-poker service." >&2
  echo "[prod]        free it (npm run stop) or use PORT=<port> ./scripts/start.sh. Aborting." >&2
  exit 1
fi

if [ ! -f dist/index.html ] && [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "[build] no dist/ found — running production build first..."
  npx vite build
fi

echo "[prod] starting production server on :${PORT} (serves dist/ + WebSocket)"
exec env NODE_ENV=production PORT="$PORT" node server/server.js
