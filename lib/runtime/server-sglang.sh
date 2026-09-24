#!/usr/bin/env bash
# local-ai-sglang-server -- generic SGLang-in-a-container launcher for
# awesome-local-ai.
#
# One launcher serves every SGLang combination. Everything that varies -- the
# image digest, the SGLang argv, the container environment, the profiles -- is
# read at run time from the install manifest written by the installer:
#
#   $ROOT/install.env    key=value manifest (SGLANG_* fields from lib/sglang.sh)
#   $ROOT/profiles.tsv   name|ctx|mem_frac|prefill_graph|need_mib|basis|summary
#   $ROOT/help.txt       combination-specific prose for --help
#
# No machine-specific paths: the install root and the weight cache resolve
# from $HOME at run time.
#
# The container is run in the background and this script waits on it, so a
# SIGTERM from the session manager or systemd becomes a `docker stop` -- not an
# orphaned container still holding 22 GB of VRAM after its launcher died.

set -euo pipefail

: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
if [[ -z "${HOME:-}" ]]; then
  echo "local-ai-sglang-server: cannot determine HOME; set HOME or LOCAL_AI_ROOT." >&2
  exit 1
fi

if [[ -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-sglang-server: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. qwen38-27b-exl3-sglang-server) instead of this file." >&2
  exit 1
fi

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-sglang-server: no install manifest at $ROOT/install.env" >&2
  echo "Re-run the install-*.sh script for this combination." >&2
  exit 1; }

# shellcheck disable=SC1091
. "$ROOT/install.env"

if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then
  ROOT="${!ROOT_ENV_VAR}"
fi

# The weight cache sits outside the install root (shared across SGLang
# combinations); relative to $HOME, overridable.
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
${DISPLAY_NAME} server launcher (${BACKEND} in Docker + ${ACCEL})

USAGE
  ${SERVER_CMD} [--help] [extra sglang.launch_server args...]
  PROFILE=<name> ${SERVER_CMD}

  Unrecognised arguments are appended to the SGLang argv inside the container,
  after everything the profile set (argparse: the last occurrence wins).

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-9s %7s ctx  mem %-4s  prefill-graphs %-3s  %-14s %s\n", $1, $2, $3, ($4=="1"?"on":"off"), $6, $7
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}

case "${1:-}" in
  -h|--help|help) show_help; exit 0 ;;
esac

command -v docker >/dev/null 2>&1 || {
  echo "${SERVER_CMD}: docker is not on PATH. Re-run the combination's installer." >&2
  exit 1; }

if [[ ! -f "$MODEL/model.safetensors.index.json" ]]; then
  echo "${SERVER_CMD}: weights not found at" >&2
  echo "  $MODEL" >&2
  echo "Set ${MODEL_CACHE_ENV_VAR:-SGLANG_MODEL_CACHE} if your cache lives elsewhere, or MODEL for a" >&2
  echo "specific directory, or re-run the install script to (re)download." >&2
  exit 1
fi

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "unknown PROFILE '$PROFILE' ($(profile_names))" >&2
  echo "run '${SERVER_CMD} --help' for the profile table" >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_MEMFRAC D_PREFILL_GRAPH D_NEED D_BASIS _ <<< "$row"

# Validated before anything slow: Qwen3.8's template RAISES on an effort it
# does not know, so a bad value would fail every request after a slow load.
THINKING="${THINKING:-1}"
REASONING_EFFORT="${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}"
if [[ "$THINKING" != "0" && "$REASONING_EFFORT" != "default" ]] \
   && [[ " ${REASONING_EFFORTS:-default} " != *" $REASONING_EFFORT "* ]]; then
  echo "${SERVER_CMD}: REASONING_EFFORT='$REASONING_EFFORT' is not supported by this model's template." >&2
  echo "         Supported: ${REASONING_EFFORTS:-default} ('default' = the template's own)." >&2
  exit 1
fi

USER_TUNED="${CTX:-}${MEM_FRACTION:-}"
PORT="${PORT:-${DEFAULT_PORT:-30000}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
MEM_FRACTION="${MEM_FRACTION:-$D_MEMFRAC}"
GPU_DEVICE="${GPU_DEVICE:-0}"
MODEL_ALIAS="${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"
CONTAINER_NAME="${INSTALL_ID}-${PORT}"

# ---- pre-flight: already running ------------------------------------------
if command -v curl >/dev/null 2>&1 \
   && curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  serving="$(curl -sf --max-time 2 "http://127.0.0.1:${PORT}/v1/models" 2>/dev/null \
    | python3 -c 'import sys,json;print((json.load(sys.stdin).get("data") or [{}])[0].get("id",""))' 2>/dev/null || true)"
  echo "${SERVER_CMD}: something is already serving on :${PORT}${serving:+ (${serving})}." >&2
  if [[ "$serving" == "$MODEL_ALIAS" ]]; then
    echo "         That is this combination's model -- you can use it as it is." >&2
  else
    echo "         Stop it first, or serve elsewhere:  PORT=<other> ${SERVER_CMD}" >&2
  fi
  exit 1
fi

# A container of this name left behind by a launcher that was SIGKILLed: if it
# is still running it holds the GPU, so say so; if it exited, clear it.
if state="$(docker inspect --format '{{.State.Status}}' "$CONTAINER_NAME" 2>/dev/null)"; then
  if [[ "$state" == "running" ]]; then
    echo "${SERVER_CMD}: container '${CONTAINER_NAME}' is already running (still loading, or orphaned)." >&2
    echo "         Stop it with:  docker stop ${CONTAINER_NAME}" >&2
    exit 1
  fi
  docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true
fi

# ---- pre-flight: GPU ------------------------------------------------------
if command -v nvidia-smi >/dev/null 2>&1; then
  cc="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader -i "$GPU_DEVICE" 2>/dev/null | head -1 | tr -d '. ')"
  if [[ -n "$cc" && -n "${ACCEL_ARCHS_VERIFIED:-}" && " ${ACCEL_ARCHS_VERIFIED} " != *" $cc "* ]]; then
    echo "WARNING: GPU ${GPU_DEVICE} is sm_${cc}; this image has only been run on sm_${ACCEL_ARCHS_VERIFIED// /, sm_}." >&2
    echo "         Untested architecture -- see the combination README before trusting results." >&2
  fi

  # SGLang sizes its KV pool from what is free when it starts, so a desktop or
  # another process on the card shrinks the pool below the profile's context
  # and long prompts then fail. Check first, name the fix.
  if [[ -z "$USER_TUNED" ]]; then
    free_mib="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits -i "$GPU_DEVICE" 2>/dev/null | head -1)"
    if [[ -n "$free_mib" ]] && (( free_mib < D_NEED )); then
      echo "WARNING: profile '$PROFILE' needs ~${D_NEED} MiB free on GPU ${GPU_DEVICE}; ${free_mib} MiB is free." >&2
      nvidia-smi --query-compute-apps=pid,used_memory,process_name \
                 --format=csv,noheader -i "$GPU_DEVICE" 2>/dev/null | sed 's/^/           /' >&2 || true
      suggestion=""
      while IFS='|' read -r n c m g need rest; do
        [[ -z "${n// }" || "$n" == \#* ]] && continue
        (( free_mib >= need )) && { suggestion="$n"; break; }
      done < <(sort -t'|' -k5,5nr "$ROOT/profiles.tsv")
      if [[ -n "$suggestion" ]]; then
        echo "         Try: PROFILE=$suggestion" >&2
      else
        echo "         Not enough memory for any profile; free the device first." >&2
      fi
      echo "         Continuing anyway in 5s (Ctrl-C to abort)..." >&2
      sleep 5
    fi
  fi
fi

# ---- argv -----------------------------------------------------------------
# The combination's base argv (the recipe's, minus the flags a profile or this
# launcher owns), one token per whitespace-separated word.
# shellcheck disable=SC2206
BASE=( $SGLANG_BASE_ARGS )

ARGS=(
  "${BASE[@]}"
  # Inside the container; the published port is mapped below.
  --host 0.0.0.0
  --port "$SGLANG_CONTAINER_PORT"
  # Stable id for API clients: the one the recipe served under unless the
  # user overrides it.
  --served-model-name "$MODEL_ALIAS"
  --context-length "$CTX"
  --mem-fraction-static "$MEM_FRACTION"
)
if [[ "$D_PREFILL_GRAPH" == "0" ]]; then ARGS+=(--disable-prefill-cuda-graph); fi

# Thinking and reasoning effort are chat-template kwargs. SGLang applies
# --default-chat-template-kwargs to every request that does not set them
# itself -- which is the lever that matters, because OpenCode drops a
# per-request reasoning_effort (see lib/runtime/server-mtplx.sh). Per-request
# chat_template_kwargs still win for clients that send them.
if [[ "$THINKING" == "0" ]]; then
  ARGS+=(--default-chat-template-kwargs '{"enable_thinking": false}')
elif [[ "$REASONING_EFFORT" != "default" ]]; then
  ARGS+=(--default-chat-template-kwargs "{\"reasoning_effort\": \"${REASONING_EFFORT}\"}")
fi

DOCKER=(
  run --rm --name "$CONTAINER_NAME"
  --gpus "device=${GPU_DEVICE}"
  --shm-size "${SGLANG_SHM_SIZE:-16g}"
  --network bridge
  -p "${HOST}:${PORT}:${SGLANG_CONTAINER_PORT}"
  -v "${MODEL}:${SGLANG_CONTAINER_MODEL_DIR}:ro"
)
while IFS= read -r kv; do
  [[ -n "${kv// }" ]] && DOCKER+=(-e "$kv")
done <<< "${SGLANG_ENV:-}"

echo "${SERVER_CMD}: PROFILE=${PROFILE} (${D_BASIS}) ctx=${CTX} mem=${MEM_FRACTION} gpu=${GPU_DEVICE} -> http://${HOST}:${PORT}/v1" >&2

stop_container() {
  trap - TERM INT HUP
  echo "${SERVER_CMD}: stopping container ${CONTAINER_NAME}..." >&2
  docker stop -t "${STOP_TIMEOUT:-20}" "$CONTAINER_NAME" >/dev/null 2>&1 || true
  wait "$child" 2>/dev/null || true
  exit 0
}

docker "${DOCKER[@]}" "$SGLANG_IMAGE" "${ARGS[@]}" "$@" &
child=$!
trap stop_container TERM INT HUP
rc=0
wait "$child" || rc=$?
exit "$rc"
