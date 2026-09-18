#!/usr/bin/env bash
# Run the planning-poker app: WebSocket server + web client, as one command.
# The app binds 0.0.0.0 so teammates on your LAN can join via the printed
# network URL; --share additionally publishes a public URL through cloudflared.
#
#   ./scripts/run.sh                 # dev: ws server + Vite dev client (LAN-reachable)
#   ./scripts/run.sh --prod          # build dist/ if needed, then serve it + ws server
#   ./scripts/run.sh --share         # also open a cloudflared quick tunnel (public URL)
#   PORT=9000 ./scripts/run.sh       # set the WebSocket port (alias of WS_PORT)
#   WS_PORT=8787 APP_PORT=5173 ./scripts/run.sh
#   HOST=127.0.0.1 ./scripts/run.sh  # restrict binding to loopback (disable LAN share)
#   SKIP_BUILD=1 ./scripts/run.sh --prod   # reuse existing dist/ without rebuilding
#   NO_WATCH=1 ./scripts/run.sh      # start everything, then return (no monitor loop)
#
# Idempotent + resilient: already-running services are reused, not duplicated;
# a foreign service on the app port is a hard error. Stops cleanly on Ctrl-C.
# Portable to bash 3.2 (no wait -n).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() { sed -n '2,17p' "${BASH_SOURCE[0]}"; }

MODE=dev
SHARE=0
for arg in "$@"; do
  case "$arg" in
    --dev) MODE=dev ;;
    --prod) MODE=prod ;;
    --share) SHARE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "run.sh: unknown arg '$arg' (see --help)" >&2; exit 2 ;;
  esac
done

HOST_BIND="${HOST:-0.0.0.0}"
WS_PORT="${WS_PORT:-${PORT:-8787}}"
if [ "$MODE" = prod ]; then APP_PORT="${APP_PORT:-4173}"; else APP_PORT="${APP_PORT:-5173}"; fi

# --- toolchain ---
if command -v bun >/dev/null 2>&1; then
  PKGMAN=bun; RUNX=bunx
elif command -v npm >/dev/null 2>&1; then
  PKGMAN=npm; RUNX=npx
else
  echo "run.sh: need 'bun' or 'npm' on PATH." >&2; exit 1
fi
if command -v node >/dev/null 2>&1; then SERVER_RUNNER=node
elif [ "$PKGMAN" = bun ]; then SERVER_RUNNER=bun
else echo "run.sh: need 'node' (or bun) to run the server." >&2; exit 1; fi

# --- idempotent dep install ---
if [ ! -x node_modules/.bin/vite ]; then
  echo "[run] deps missing — running install ..."
  "$ROOT/scripts/install.sh"
fi

# --- network helpers ---
# Vite dev/preview binds IPv6-only by default ([::1]); the WS server binds dual.
# Probe BOTH stacks so idempotency/reuse detection does not miss them.
probe_tcp() { # <addr> <port>
  if command -v nc >/dev/null 2>&1; then
    nc -z -w 1 "$1" "$2" >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/${1}/${2}") >/dev/null 2>&1
  fi
}
port_occupied() {
  probe_tcp 127.0.0.1 "$1" || probe_tcp ::1 "$1"
}
# Is the app (Vite dev or preview) already serving our index on this port?
http_has_root() { # <addr>  (addr used literally in the URL, no brackets)
  local body
  body="$(curl -s --max-time 2 "http://${1}:${APP_PORT}/" 2>/dev/null || true)"
  case "$body" in *'id="root"'*) return 0 ;; *) return 1 ;; esac
}
app_is_up() {
  http_has_root localhost || http_has_root 127.0.0.1 || http_has_root '[::1]'
}
wait_until() { # <desc> <tries> <test-cmd...>
  local desc="$1" tries="$2"; shift 2
  local i=0
  while [ "$i" -lt "$tries" ]; do
    if "$@" >/dev/null 2>&1; then return 0; fi
    i=$((i + 1)); sleep 0.25
  done
  echo "run.sh: timed out waiting for $desc" >&2; return 1
}
# Best-effort LAN address of this machine (used only to print a share hint).
primary_ip() {
  local iface ip
  ip="$(ipconfig getifaddr en0 2>/dev/null || true)"
  [ -z "$ip" ] && ip="$(ipconfig getifaddr en1 2>/dev/null || true)"
  if [ -z "$ip" ] && command -v route >/dev/null 2>&1; then
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    [ -n "$iface" ] && ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  fi
  printf '%s' "$ip"
}

WS_PID=""
CLIENT_PID=""
TUNNEL_PID=""
cleanup() {
  [ -n "${CLEANED:-}" ] && return 0
  CLEANED=1
  echo ""
  echo "[run] shutting down ..."
  [ -n "$CLIENT_PID" ] && kill "$CLIENT_PID" 2>/dev/null || true
  [ -n "$WS_PID" ] && kill "$WS_PID" 2>/dev/null || true
  [ -n "$TUNNEL_PID" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  [ -n "${TUNNEL_LOG:-}" ] && rm -f "$TUNNEL_LOG" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- 1) WebSocket server ---
if port_occupied "$WS_PORT"; then
  echo "[ws] port ${WS_PORT} already in use — assuming a compatible server, reusing it."
else
  echo "[ws] starting WebSocket server on :${WS_PORT}"
  # shellcheck disable=SC2086
  env PORT="$WS_PORT" "$SERVER_RUNNER" server/server.js &
  WS_PID=$!
  if ! wait_until "ws server on :${WS_PORT}" 40 port_occupied "$WS_PORT"; then
    echo "[ws] ERROR: server did not come up." >&2; exit 1
  fi
fi

# --- 2) web client ---
if app_is_up; then
  echo "[app] an app is already serving :${APP_PORT} — reusing it (idempotent)."
else
  if port_occupied "$APP_PORT"; then
    echo "[app] ERROR: port ${APP_PORT} is occupied by a non-planning-poker service." >&2
    echo "[app]        free it or set APP_PORT=<port>. Aborting." >&2
    exit 1
  fi
  if [ "$MODE" = prod ]; then
    if [ ! -f dist/index.html ] && [ "${SKIP_BUILD:-0}" != "1" ]; then
      echo "[build] no dist/ — building first ..."
      "$RUNX" vite build
    fi
    echo "[app] serving dist/ (preview) on :${APP_PORT}, binding ${HOST_BIND}"
    env APP_PORT="$APP_PORT" WS_PORT="$WS_PORT" HOST="$HOST_BIND" "$RUNX" vite preview >/dev/null &
  else
    echo "[app] Vite dev client on :${APP_PORT}, binding ${HOST_BIND} (proxying /ws -> :${WS_PORT})"
    env APP_PORT="$APP_PORT" WS_PORT="$WS_PORT" HOST="$HOST_BIND" "$RUNX" vite >/dev/null &
  fi
  CLIENT_PID=$!
  if ! wait_until "client on :${APP_PORT}" 80 app_is_up; then
    echo "[app] ERROR: client did not become reachable on :${APP_PORT}." >&2
    exit 1
  fi
fi

# --- 3) sharing hints ---
LAN_IP="$(primary_ip)"
echo "[share] local   -> http://localhost:${APP_PORT}"
if [ -n "$LAN_IP" ] && [ "$HOST_BIND" != "127.0.0.1" ]; then
  echo "[share] network -> http://${LAN_IP}:${APP_PORT}   (give this to teammates on your LAN)"
fi
if [ "$SHARE" -eq 1 ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[share] --share requested but 'cloudflared' is not installed." >&2
    echo "[share]   install: brew install cloudflared   — then rerun with --share." >&2
  else
    echo "[share] starting cloudflared quick tunnel (public URL for anyone) ..."
    TUNNEL_LOG="$(mktemp -t pp-tunnel.XXXXXX)"
    cloudflared tunnel --url "http://localhost:${APP_PORT}" --no-autoupdate >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    PUB=""
    tries=0
    while [ "$tries" -lt 40 ]; do
      PUB="$(grep -Eo 'https://[a-zA-Z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -n 1)"
      [ -n "$PUB" ] && break
      sleep 0.5; tries=$((tries + 1))
    done
    if [ -n "$PUB" ]; then
      echo "[share] public   -> ${PUB}"
      echo "[share]   teammates open that URL, pick a name, and join the same room."
      echo "[share]   (Ctrl-C to stop the tunnel. Keep this window open to stay online.)"
    else
      echo "[share] WARN: tunnel started but no public URL was detected yet." >&2
      echo "[share]       check $TUNNEL_LOG or your connection." >&2
    fi
  fi
fi

# --- 4) monitor: tear everything down if either child dies ---
if [ "${NO_WATCH:-0}" = "1" ]; then
  echo "[run] NO_WATCH=1 — returning; services left running in background."
  trap - EXIT INT TERM
  CLIENT_PID=""; WS_PID=""
  exit 0
fi

while :; do
  if [ -n "$WS_PID" ] && ! kill -0 "$WS_PID" 2>/dev/null; then
    echo "[run] WebSocket server exited — stopping client."; break
  fi
  if [ -n "$CLIENT_PID" ] && ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    echo "[run] client exited — stopping server."; break
  fi
  sleep 1
done
