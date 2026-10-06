#!/usr/bin/env bash
# local-ai-gufo-server -- generic gufo-in-a-container launcher for
# awesome-local-ai.
#
# One launcher serves every gufo combination. Everything that varies -- the
# image digest, the base argv, the profiles -- is read at run time from the
# install manifest written by the installer:
#
#   $ROOT/install.env    key=value manifest (GUFO_* fields from lib/gufo.sh)
#   $ROOT/profiles.tsv   name|ctx|sessions|draft_tokens|prefill_chunk|need_mib|basis|summary
#   $ROOT/help.txt       combination-specific prose for --help
#
# No machine-specific paths: the install root and the weights resolve from
# $HOME at run time.
#
# The container runs in the background and this script waits on it, so a
# SIGTERM (the benchmark harness, the session manager, systemd) becomes a
# `podman stop` of the named container -- not an orphan still holding ~88 GB of
# the GPU's memory after its launcher died.

set -euo pipefail

: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
if [[ -z "${HOME:-}" ]]; then
  echo "local-ai-gufo-server: cannot determine HOME; set HOME or LOCAL_AI_ROOT." >&2
  exit 1
fi

if [[ -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-gufo-server: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. qwen38-flash-next-strix-gufo-server) instead of this file." >&2
  exit 1
fi

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-gufo-server: no install manifest at $ROOT/install.env" >&2
  echo "Re-run the install-*.sh script for this combination." >&2
  exit 1; }

# shellcheck disable=SC1091
. "$ROOT/install.env"

if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then
  ROOT="${!ROOT_ENV_VAR}"
fi

# The weights directory, relative to $HOME, overridable.
MODEL_CACHE="$HOME/$MODEL_SUBDIR"
if [[ -n "${MODEL_CACHE_ENV_VAR:-}" && -n "${!MODEL_CACHE_ENV_VAR:-}" ]]; then
  MODEL_CACHE="${!MODEL_CACHE_ENV_VAR}"
fi
MODEL="${MODEL:-$MODEL_CACHE/$MODEL_FILE}"

# ---- profile table --------------------------------------------------------
profile_row() {
  local want="$1" name rest
  while IFS='|' read -r name rest; do
    [[ -z "${name// }" || "$name" == \#* ]] && continue
    [[ "$name" == "$want" ]] && { printf '%s|%s' "$name" "$rest"; return 0; }
  done < "$ROOT/profiles.tsv"
  return 1
}

profile_names() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {printf "%s%s", sep, $1; sep="|"}' "$ROOT/profiles.tsv"
}

show_help() {
  cat <<HDR
${DISPLAY_NAME} server launcher (${BACKEND} in Podman + ${ACCEL})

USAGE
  ${SERVER_CMD} [--help] [extra 'gufo serve llm' args...]
  PROFILE=<name> ${SERVER_CMD}

  Unrecognised arguments are appended to gufo's argv inside the container,
  after everything the profile set.

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-9s %7s ctx  sessions %-2s  draft %-2s  prefill-chunk %-5s  %-19s %s\n", $1, $2, $3, $4, $5, $7, $8
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}

case "${1:-}" in
  -h|--help|help) show_help; exit 0 ;;
esac

command -v podman >/dev/null 2>&1 || {
  echo "${SERVER_CMD}: podman is not on PATH. Re-run the combination's installer." >&2
  exit 1; }

for rel in "$GUFO_MODEL_REL" "$GUFO_MTP_REL"; do
  [[ -f "$MODEL/$rel" ]] && continue
  echo "${SERVER_CMD}: weights not found: $MODEL/$rel" >&2
  echo "Set ${MODEL_CACHE_ENV_VAR:-GUFO_MODEL_CACHE} if they live elsewhere, or MODEL for the directory," >&2
  echo "or re-run the install script to (re)download." >&2
  exit 1
done

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "unknown PROFILE '$PROFILE' ($(profile_names))" >&2
  echo "run '${SERVER_CMD} --help' for the profile table" >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_SESSIONS D_DRAFT D_PREFILL_CHUNK D_NEED D_BASIS _ <<< "$row"

# Validated before anything slow: Qwen3.8's template RAISES on an effort it
# does not know, so a bad value would fail every request after a long load.
THINKING="${THINKING:-1}"
REASONING_EFFORT="${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}"
if [[ "$THINKING" != "0" && "$REASONING_EFFORT" != "default" ]] \
   && [[ " ${REASONING_EFFORTS:-default} " != *" $REASONING_EFFORT "* ]]; then
  echo "${SERVER_CMD}: REASONING_EFFORT='$REASONING_EFFORT' is not supported by this model's template." >&2
  echo "         Supported: ${REASONING_EFFORTS:-default} ('default' = the template's own)." >&2
  exit 1
fi

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
SESSIONS="${SESSIONS:-$D_SESSIONS}"
DRAFT_TOKENS="${DRAFT_TOKENS:-$D_DRAFT}"
PREFILL_CHUNK="${PREFILL_CHUNK:-$D_PREFILL_CHUNK}"
MODEL_ALIAS="${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"
CONTAINER_NAME="${INSTALL_ID}-${PORT}"

# ---- pre-flight: already running ------------------------------------------
if command -v curl >/dev/null 2>&1 \
   && curl -sf --max-time 2 "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1; then
  echo "${SERVER_CMD}: something is already serving on :${PORT}. Stop it first, or serve elsewhere:" >&2
  echo "         PORT=<other> ${SERVER_CMD}" >&2
  exit 1
fi

# A container of this name left by a launcher that was SIGKILLed: if it is
# still running it holds the GPU, so say so; if it exited, clear it.
if state="$(podman inspect --format '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null)"; then
  if [[ "$state" == "running" ]]; then
    echo "${SERVER_CMD}: container '${CONTAINER_NAME}' is already running (still loading, or orphaned)." >&2
    echo "         Stop it with:  podman stop ${CONTAINER_NAME}" >&2
    exit 1
  fi
  podman rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

# ---- pre-flight: another model already resident --------------------------
# Unified memory: two ~90 GB models do not fit in 128 GB. On 27 Sep 2026 a
# llama-server left running beside a newly started one ran the Strix Halo box out of
# memory and the kernel killed it. Refuse rather than race the OOM killer.
# Process NAMES, exactly: matching command lines (pgrep -f) would also catch a
# shell or a tail whose arguments merely mention llama-server.
# One model server at a time: each holds tens of gigabytes, and two on one machine means swap, which stops the
# story that is running (6 Oct 2026: an installer's smoke test beside a live run took swap 0.13 -> 35.47 GB).
# The pattern is the same in every launcher and knows every engine we run plus the common desktop ones: a
# launcher that only recognised its own kind let the others past. The process list is captured before it is
# filtered, so the filter's own text is not in it, and this shell is skipped by pid so it never matches itself.
if [[ "${ALLOW_COEXIST:-0}" != "1" ]]; then
  snapshot="$(ps -axo pid=,command= 2>/dev/null || true)"
  others="$(printf '%s\n' "$snapshot" | awk -v self="$$" '$1 == self { next }
    /llama-server|mtplx\.server|mtplx +serve|mlx-serve .*--serve|mlx-serve +serve|mlx_lm\.server|gufo +serve|gufo-runtime|tensorfold +serve|serve\/server\.py --engine strata|engine\/strata|MLX-Serve\.app|ollama +serve|LM Studio/ {
      sub(/^ +/, ""); print }')"
  if [[ -n "$others" ]]; then
    echo "${SERVER_CMD}: another model server is running:" >&2
    printf '%s\n' "$others" | cut -c1-160 | sed 's/^/           /' >&2
    echo "         Stop it first, or set ALLOW_COEXIST=1 if you are sure it is small." >&2
    exit 1
  fi
fi

# ---- argv -----------------------------------------------------------------
# The combination's base argv (flags no profile varies), one token per word.
# shellcheck disable=SC2206
BASE=( ${GUFO_BASE_ARGS:-} )

ARGS=(
  # Inside the container; the published port is mapped below.
  --host 0.0.0.0 --port "$GUFO_CONTAINER_PORT"
  --sessions "$SESSIONS"
  llm
  --model "${GUFO_CONTAINER_MODEL_DIR}/${GUFO_MODEL_REL}"
  --mtp-model "${GUFO_CONTAINER_MODEL_DIR}/${GUFO_MTP_REL}"
  --speculative mtp
  --draft-tokens "$DRAFT_TOKENS"
  --context "$CTX"
  --prefill-chunk "$PREFILL_CHUNK"
  # Stable id for API clients. gufo answers 404 model_not_found to any other.
  --served-model-name "$MODEL_ALIAS"
  # (the ${x+...} form: an empty array is "unbound" under set -u in bash 3.2)
  ${BASE[@]+"${BASE[@]}"}
)

# Thinking, its sampler and reasoning effort are server-side defaults, which a
# request that names its own still overrides. They are a matched pair, as in
# the llama.cpp launcher: the thinking preset with thinking off repeats itself.
if [[ "$THINKING" == "0" ]]; then
  # shellcheck disable=SC2206
  ARGS+=(--think off ${GUFO_SAMPLING_INSTRUCT:-})
else
  # shellcheck disable=SC2206
  ARGS+=(--think on ${SAMPLING_THINKING:-})
  if [[ "$REASONING_EFFORT" != "default" ]]; then ARGS+=(--reasoning-effort "$REASONING_EFFORT"); fi
fi

PODMAN=(
  run --rm --name "$CONTAINER_NAME"
  --userns=keep-id:uid="$(id -u)",gid="$(id -g)"
  --device /dev/kfd --device /dev/dri --group-add keep-groups
  --ulimit memlock=-1
  -p "${HOST}:${PORT}:${GUFO_CONTAINER_PORT}"
  -v "${MODEL}:${GUFO_CONTAINER_MODEL_DIR}:ro"
)

echo "${SERVER_CMD}: PROFILE=${PROFILE} (${D_BASIS}) ctx=${CTX} sessions=${SESSIONS} draft=${DRAFT_TOKENS} gufo ${GUFO_VERSION} -> http://${HOST}:${PORT}/v1" >&2

stop_container() {
  trap - TERM INT HUP
  echo "${SERVER_CMD}: stopping container ${CONTAINER_NAME}..." >&2
  podman stop -t "${STOP_TIMEOUT:-20}" "$CONTAINER_NAME" >/dev/null 2>&1 || true
  wait "$child" 2>/dev/null || true
  exit 0
}

podman "${PODMAN[@]}" "$GUFO_IMAGE" gufo serve "${ARGS[@]}" "$@" &
child=$!
trap stop_container TERM INT HUP
rc=0
wait "$child" || rc=$?
exit "$rc"
