#!/usr/bin/env bash
# Start the planning poker app locally (API + WebSocket + built SPA) via Miniflare.
#
# Usage:
#   ./scripts/run.sh [port]             start on port (default 8787)
#   ./scripts/run.sh --restart [port]   stop any existing instance on that port first
#
# Behavior:
#   - If this app is already serving on the port: print the URL and exit 0.
#   - If another process holds the port: automatically use the next free port.
#   - Wait for the server to become healthy before reporting ready.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="8787"
RESTART=0
for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 1 ;;
    *) PORT="$arg" ;;
  esac
done

if ! [[ "$PORT" =~ ^[0-9]+$ ]]; then
  echo "port must be a number, got: $PORT" >&2
  exit 1
fi

app_running() {
  curl -sf -m 2 "http://127.0.0.1:$1/health" >/dev/null 2>&1
}

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && return 0
    return 1
  fi
}

if [ "$RESTART" -eq 1 ] && port_busy "$PORT"; then
  echo "==> Stopping existing process on port $PORT"
  pkill -f "wrangler dev --port $PORT" 2>/dev/null || true
  for _ in $(seq 1 20); do
    port_busy "$PORT" || break
    sleep 0.5
  done
  if port_busy "$PORT"; then
    echo "port $PORT is still busy after attempting to stop the old server" >&2
    exit 1
  fi
fi

if app_running "$PORT"; then
  echo "Planning poker is already running: http://localhost:$PORT"
  echo "  (restart it with: ./scripts/run.sh --restart $PORT)"
  exit 0
fi

if port_busy "$PORT"; then
  echo "==> Port $PORT is in use by another process; searching for a free port"
  found=""
  for p in $(seq "$PORT" $((PORT + 20))); do
    if ! port_busy "$p"; then
      found="$p"
      break
    fi
  done
  if [ -z "$found" ]; then
    echo "no free port found in $PORT..$((PORT + 20))" >&2
    exit 1
  fi
  echo "==> Using port $found instead"
  PORT="$found"
fi

if [ ! -d node_modules ]; then
  echo "==> node_modules missing, installing"
  ./scripts/install.sh
fi

if [ ! -f frontend/dist/index.html ]; then
  echo "==> frontend bundle missing, building"
  npm run build
fi

echo "==> Starting wrangler dev (Miniflare) on http://localhost:$PORT"
npx wrangler dev --port "$PORT" &
WRANGLER_PID=$!
trap 'kill "$WRANGLER_PID" 2>/dev/null || true; exit 130' INT TERM

READY=0
for _ in $(seq 1 60); do
  if app_running "$PORT"; then
    READY=1
    break
  fi
  if ! kill -0 "$WRANGLER_PID" 2>/dev/null; then
    echo "wrangler dev exited unexpectedly (see log above)" >&2
    exit 1
  fi
  sleep 1
done

if [ "$READY" -eq 1 ]; then
  echo "==> Ready: http://localhost:$PORT"
  echo "    Open the URL, start a game, and share the /game/<id> link with your team."
fi

wait "$WRANGLER_PID"
