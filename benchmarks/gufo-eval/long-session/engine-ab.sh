#!/usr/bin/env bash
# The same captured agent requests against several gufo builds, one server at a time, on the Strix Halo box.
#   engine-ab.sh DIR REQUESTS_DIR [--dry-run]
# It answers one question: does draft acceptance (and so decode speed) differ between builds when the requests
# are identical and the server's flags are identical? Each build runs from a copy of the gufo-pi install manifest
# with only the image and version changed, so the launcher, profile, sampler and weights are the benchmark's own.
# The 0.5.0 build runs twice, first and last, as the measure of run-to-run noise.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HOME/.local/bin:$PATH"
OUT="${1:?results dir}"; REQ_DIR="${2:?captured requests dir}"; shift 2
DRY=""; [[ "${1:-}" == "--dry-run" ]] && DRY=1
PORT=18097
READY_TIMEOUT_S=1500
REPEATS=4
REPLAY_MAX_TOKENS=3000
BUSY='[l]lama-server|[g]ufo serve|[g]ufo-runtime|[d]rive.py'
BASE_ROOT="$HOME/.local/share/qwen38-flash-next-strix-gufo"
IMG="ghcr.io/gufo-org/toolboxes/gufo-runtime"
REQUESTS=("$REQ_DIR/replay-30k.json" "$REQ_DIR/replay-60k.json" "$REQ_DIR/replay-100k.json")
if [[ -n "$DRY" ]]; then REPEATS=1; REPLAY_MAX_TOKENS=64; REQUESTS=("$REQ_DIR/replay-30k.json"); fi
mkdir -p "$OUT"; LOG="$OUT/log.md"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
SPID=""
stop_server() {
  [[ -n "$SPID" ]] || return 0
  kill -TERM "$SPID" 2>/dev/null
  for _ in $(seq 90); do kill -0 "$SPID" 2>/dev/null || break; sleep 1; done
  SPID=""
  for _ in $(seq 90); do pgrep -f "$BUSY" >/dev/null || break; sleep 1; done
}
trap stop_server EXIT

phase() { # label, image reference, version string the binary reports
  local label="$1" image="$2" version="$3" root="$OUT/root-$1"
  if pgrep -fl "$BUSY"; then say "ABORT $label: something else is serving"; return 1; fi
  mkdir -p "$root"
  sed -e "s|^GUFO_IMAGE=.*|GUFO_IMAGE=$image|" -e "s|^GUFO_VERSION=.*|GUFO_VERSION=$version|" "$BASE_ROOT/install.env" > "$root/install.env"
  cp "$BASE_ROOT/profiles.tsv" "$BASE_ROOT/help.txt" "$root/"
  say "$label: start ($image)"
  env PORT="$PORT" LOCAL_AI_INSTALL_REL=unused LOCAL_AI_ROOT="$root" "$HOME/.local/bin/local-ai-gufo-server" > "$OUT/server-$label.log" 2>&1 < /dev/null &
  SPID=$!
  local t0; t0=$(date +%s)
  until curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" | grep -q '"id"' && curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; do
    kill -0 "$SPID" 2>/dev/null || { say "$label: server exited (see server-$label.log)"; SPID=""; return 1; }
    (( $(date +%s) - t0 > READY_TIMEOUT_S )) && { say "$label: not ready in ${READY_TIMEOUT_S}s"; stop_server; return 1; }
    sleep 3
  done
  say "$label: ready after $(( $(date +%s) - t0 ))s"
  uv run --quiet "$HERE/replay.py" --url "http://127.0.0.1:$PORT" --engine "$label" --requests "${REQUESTS[@]}" \
    --out "$OUT/replay.jsonl" --repeats "$REPEATS" --max-tokens "$REPLAY_MAX_TOKENS" > "$OUT/replay-$label.out" 2>&1
  say "$label: replays finished (exit $?)"
  stop_server
}

phase b722a61-a "$IMG@sha256:51f3cae01632174f2f53e402beb817231b703e96dad822b4300e694bd8a388d5" b722a61
phase v0.5.0-a  "$IMG@sha256:371a731c5286d698c77daa2507300588e24dc063c7c665895331001410dc06b4" 0.5.0
phase v0.17.0   "$IMG@sha256:a3df87bca3d33aef3df6f5c509ee54f743c0cb6e2cb5dbc83f2ebac2289349d2" 0.17.0
phase v0.5.0-b  "$IMG@sha256:371a731c5286d698c77daa2507300588e24dc063c7c665895331001410dc06b4" 0.5.0
say "engine-ab finished"
