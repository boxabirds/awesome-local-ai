#!/bin/bash
# Replay captured client request bodies through NadirClaw, one FRESH server per
# body directory. NadirClaw's session cache is in-memory, upgrade-only and keyed
# on the system prompt + first user message, so reusing one server lets a cloud
# pin from one client's run leak into the next.
#
# usage: nadirclaw_probe_fresh.sh BODY_DIR [BODY_DIR ...]
#
# env:
#   NADIRCLAW   path to the nadirclaw executable (default: nadirclaw on PATH)
#   PYTHON      python used for the stub and probe (default: python3)
#   NC_PORT     NadirClaw port (default 18856)
#   STUB_PORT   stub upstream port (default 18010)
#   WORK        scratch dir for the throwaway HOME and logs (default: mktemp -d)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NADIRCLAW="${NADIRCLAW:-$(command -v nadirclaw)}"
PYTHON="${PYTHON:-python3}"
NC_PORT="${NC_PORT:-18856}"
STUB_PORT="${STUB_PORT:-18010}"
WORK="${WORK:-$(mktemp -d)}"
HEALTH_POLL_TRIES=300
HEALTH_POLL_INTERVAL_S=0.2

mkdir -p "$WORK/home/.nadirclaw"
# Stub credentials only. The server runs under env -i, so keys exported in your
# shell (which would otherwise take precedence over this file) never reach it.
cat > "$WORK/home/.nadirclaw/.env" <<EOF
NADIRCLAW_SIMPLE_MODEL=openai/local-flash
NADIRCLAW_COMPLEX_MODEL=openai/cloud-big
NADIRCLAW_API_BASE=http://127.0.0.1:${STUB_PORT}/v1
OPENAI_API_KEY=sk-stub-openai
EOF

STUB_LOG="$WORK/stub.jsonl"
"$PYTHON" "$HERE/stub.py" "$STUB_PORT" "$STUB_LOG" > "$WORK/stub.out" 2>&1 &
STUB_PID=$!
NC_PID=""
cleanup() { [[ -n "$NC_PID" ]] && kill "$NC_PID" 2>/dev/null || true; kill "$STUB_PID" 2>/dev/null || true; }
trap cleanup EXIT

for dir in "$@"; do
  [[ -n "$NC_PID" ]] && { kill "$NC_PID" 2>/dev/null || true; wait "$NC_PID" 2>/dev/null || true; }
  env -i PATH=/usr/bin:/bin HOME="$WORK/home" "$NADIRCLAW" serve --port "$NC_PORT" \
    < /dev/null > "$WORK/serve.log" 2>&1 &
  NC_PID=$!
  for _ in $(seq 1 "$HEALTH_POLL_TRIES"); do
    curl -s -m 1 "localhost:${NC_PORT}/health" > /dev/null && break
    sleep "$HEALTH_POLL_INTERVAL_S"
  done
  "$PYTHON" "$HERE/nadirclaw_route_probe.py" "http://127.0.0.1:${NC_PORT}" "$STUB_LOG" "$dir"
  grep -aE "Agentic override|Reasoning override" "$WORK/serve.log" | sed 's/^[0-9:]* INFO *//' || true
done
