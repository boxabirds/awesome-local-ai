#!/usr/bin/env bash
# Starts a gufo image as gufo issue 631's report started it, runs gufo-wedge against it, and stops the server.
#   run-on-strix.sh DIR LABEL IMAGE_REFERENCE VERSION [gufo-wedge args...]
# The server is the benchmark's launcher on a copy of the gufo-pi install manifest with only the image changed, plus
# the report's flags: two sessions, a context of 262144, a disk cache of 64 GiB and the automatic RAM tier.
# Exit: 0 every attempt answered, 1 wedge, 2 the server did not come up or the probe failed.
set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"
OUT="${1:?results dir}"; LABEL="${2:?label}"; IMAGE="${3:?image reference}"; VERSION="${4:?version}"; shift 4
PORT=18097
READY_TIMEOUT_S=1500
SESSIONS=2
CONTEXT=262144
CACHE_DISK_DIR=/tmp/gufo-cache
CACHE_DISK_BYTES=68719476736
MODEL_ALIAS=qwen3.8-flash-next-gufo
BASE_ROOT="$HOME/.local/share/qwen38-flash-next-strix-gufo"
WEDGE="${GUFO_WEDGE:-gufo-wedge}"
mkdir -p "$OUT"; LOG="$OUT/log.md"; ROOT="$OUT/root-$LABEL"
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
# by process name and by running containers, never by command-line text: this script's own arguments name the image
if pgrep -x llama-server >/dev/null || [[ -n "$(podman ps -q 2>/dev/null)" ]]; then say "ABORT $LABEL: something else is serving"; exit 2; fi
mkdir -p "$ROOT"
sed -e "s|^GUFO_IMAGE=.*|GUFO_IMAGE=$IMAGE|" -e "s|^GUFO_VERSION=.*|GUFO_VERSION=$VERSION|" "$BASE_ROOT/install.env" > "$ROOT/install.env"
cp "$BASE_ROOT/profiles.tsv" "$BASE_ROOT/help.txt" "$ROOT/"
say "$LABEL: start ($IMAGE)"
# ALLOW_COEXIST: the launcher's own guard matches command-line text and would match this script (its arguments name the
# image); the check above has already shown that nothing else is serving
env ALLOW_COEXIST=1 PORT="$PORT" SESSIONS="$SESSIONS" CTX="$CONTEXT" LOCAL_AI_INSTALL_REL=unused LOCAL_AI_ROOT="$ROOT" \
  "$HOME/.local/bin/local-ai-gufo-server" --cache-disk "$CACHE_DISK_DIR" --cache-disk-bytes "$CACHE_DISK_BYTES" \
  > "$OUT/server-$LABEL.log" 2>&1 < /dev/null &
SPID=$!
stop_server() {
  kill -TERM "$SPID" 2>/dev/null
  for _ in $(seq 90); do kill -0 "$SPID" 2>/dev/null || break; sleep 1; done
}
trap stop_server EXIT
t0=$(date +%s)
until curl -sf -m 3 "http://127.0.0.1:$PORT/v1/models" | grep -q '"id"' && curl -sf -m 3 "http://127.0.0.1:$PORT/health" >/dev/null; do
  kill -0 "$SPID" 2>/dev/null || { say "$LABEL: server exited (see server-$LABEL.log)"; exit 2; }
  (( $(date +%s) - t0 > READY_TIMEOUT_S )) && { say "$LABEL: not ready in ${READY_TIMEOUT_S}s"; exit 2; }
  sleep 3
done
say "$LABEL: ready after $(( $(date +%s) - t0 ))s"
"$WEDGE" --base-url "http://127.0.0.1:$PORT" --model "$MODEL_ALIAS" --dump-dir "$OUT" "$@" | tee "$OUT/wedge-$LABEL.jsonl"
rc=${PIPESTATUS[0]}
say "$LABEL: gufo-wedge exit $rc"
exit "$rc"
