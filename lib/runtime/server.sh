#!/usr/bin/env bash
# local-ai-server -- generic llama.cpp launcher for awesome-local-ai.
#
# ONE launcher serves every combination. Everything that varies -- model file
# names, profiles, safe KV types, sampling presets -- is read at run time from
# the install manifest written by the installer:
#
#   $ROOT/install.env    key=value manifest
#   $ROOT/profiles.tsv   name|ctx|kv|vision|np|ub|need_mib|summary
#   $ROOT/help.txt       combination-specific prose for --help
#
# It contains NO machine-specific paths: the root is resolved from $HOME at
# run time, so this file is identical on every machine and for every user, and
# can be pasted into a bug report without leaking a username.

set -euo pipefail

# Some minimal service environments start without HOME; fall back to passwd.
: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
if [[ -z "${HOME:-}" ]]; then
  echo "local-ai-server: cannot determine HOME; set HOME or LOCAL_AI_ROOT." >&2
  exit 1
fi

# The per-combination shim exports LOCAL_AI_INSTALL_REL before exec'ing us.
if [[ -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-server: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. qwen38-27b-server) instead of this file." >&2
  exit 1
fi

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-server: no install manifest at $ROOT/install.env" >&2
  echo "Re-run the install-*.sh script for this combination." >&2
  exit 1; }

# shellcheck disable=SC1091
. "$ROOT/install.env"

# Back-compat: each combination may declare its own root override variable
# (e.g. QWEN38_ROOT) so existing docs and scripts keep working.
if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then
  ROOT="${!ROOT_ENV_VAR}"
fi

MODEL_DIR="$ROOT/$MODEL_SUBDIR"
BIN_DIR="$HOME/.local/bin"
export PATH="$BIN_DIR:$PATH"

MODEL="${MODEL:-$MODEL_DIR/$MODEL_FILE}"
MMPROJ="${MMPROJ:-}"
[[ -z "$MMPROJ" && -n "${MMPROJ_FILE:-}" ]] && MMPROJ="$MODEL_DIR/$MMPROJ_FILE"
MTP="${MTP:-}"
[[ -z "$MTP" && -n "${MTP_FILE:-}" ]] && MTP="$MODEL_DIR/$MTP_FILE"

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
${DISPLAY_NAME} server launcher (${BACKEND} + ${ACCEL})

USAGE
  ${SERVER_CMD} [--help] [extra llama-server args...]
  PROFILE=<name> ${SERVER_CMD}

  Unrecognised arguments are passed straight through to llama-server, and
  override anything the profile set.

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    vis = ($4 == "1") ? "on " : "off";
    printf "  %-11s %6s ctx  %-5s KV  vision %s   %s\n", $1, $2, $3, vis, $8
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}

case "${1:-}" in
  -h|--help|help) show_help; exit 0 ;;
esac

if [[ ! -f "$MODEL" ]]; then
  echo "${SERVER_CMD}: model not found at" >&2
  echo "  $MODEL" >&2
  echo "Set ${ROOT_ENV_VAR:-LOCAL_AI_ROOT} if your install lives elsewhere, or MODEL for a" >&2
  echo "specific file, or re-run the install script to (re)download." >&2
  exit 1
fi

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "unknown PROFILE '$PROFILE' ($(profile_names))" >&2
  echo "run '${SERVER_CMD} --help' for the profile table" >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_KV D_VISION D_NP D_UB D_NEED _ <<< "$row"

# ---- pre-flight -----------------------------------------------------------
# A device OOM two minutes into loading a 17 GB model is a miserable way to
# find out another process is holding memory. Check first, name the fix.
# Skipped when the user has hand-tuned the sizing, since D_NEED no longer
# describes what they asked for.
if [[ "$ACCEL" == "cuda" ]] && command -v nvidia-smi >/dev/null 2>&1 \
   && [[ -z "${CTX:-}${KV_TYPE:-}${VISION:-}" ]]; then
  free_mib=$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits | head -1)
  if [[ -n "$free_mib" ]] && (( free_mib < D_NEED )); then
    echo "WARNING: profile '$PROFILE' needs ~${D_NEED} MiB but only ${free_mib} MiB is free." >&2
    echo "         Something else is using the GPU:" >&2
    nvidia-smi --query-compute-apps=pid,used_memory,process_name \
               --format=csv,noheader 2>/dev/null | sed 's/^/           /' >&2
    # Name the largest profile that would still fit.
    suggestion=""
    while IFS='|' read -r n c k v np ub need rest; do
      [[ -z "${n// }" || "$n" == \#* ]] && continue
      (( free_mib >= need )) && { suggestion="$n"; break; }
    done < <(sort -t'|' -k7,7nr "$ROOT/profiles.tsv")
    if [[ -n "$suggestion" ]]; then
      echo "         Try: PROFILE=$suggestion" >&2
    else
      echo "         Not enough memory for any profile; free the device first." >&2
    fi
    echo "         Continuing anyway in 5s (Ctrl-C to abort)..." >&2
    sleep 5
  fi
fi

PORT="${PORT:-8080}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
KV_TYPE="${KV_TYPE:-$D_KV}"
VISION="${VISION:-$D_VISION}"
NP="${NP:-$D_NP}"
UB="${UB:-$D_UB}"
THINKING="${THINKING:-1}"
THINKING_BUDGET="${THINKING_BUDGET:-}"

# Only some KV types have a flash-attention kernel for a given model/backend.
# Everything else silently falls back to CPU attention: measured 48 tok/s
# prefill vs 2300, with the GPU at 1% and 8 CPU cores pegged. llama.cpp prints
# no warning, so warn here. SAFE_KV_TYPES is per-combination.
if [[ " $SAFE_KV_TYPES " != *" $KV_TYPE "* ]]; then
  echo "WARNING: KV_TYPE='$KV_TYPE' has no ${ACCEL} flash-attention kernel for this model." >&2
  echo "         Attention will fall back to CPU -- expect ~50x slower prompt" >&2
  echo "         processing. Safe types: ${SAFE_KV_TYPES}." >&2
  echo "         Continuing anyway in 5s (Ctrl-C to abort)." >&2
  sleep 5
fi

ARGS=(
  -m "$MODEL"
  # Stable model id for API clients. Without this llama-server advertises the
  # full .gguf path, so every client config breaks when you change quant.
  -a "${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"
  -ngl 99
  -c "$CTX"
  -fa on
  --jinja
  --cache-type-k "$KV_TYPE"
  --cache-type-v "$KV_TYPE"
  -np "$NP"
  -ub "$UB"
  -b 1024
  --host "$HOST"
  --port "$PORT"
)

# Thinking mode and its sampler are a matched pair. Model cards specify
# DIFFERENT sampling for each, and running the thinking preset with thinking
# disabled is documented to cause repetition -- which is what presence_penalty
# exists to suppress. So THINKING flips both together, never one alone.
if [[ "$THINKING" == "0" ]]; then
  # shellcheck disable=SC2206
  ARGS+=(--reasoning off ${SAMPLING_INSTRUCT})
else
  # shellcheck disable=SC2206
  ARGS+=(${SAMPLING_THINKING})

  # Reasoning effort. Chat templates that support it typically default to
  # their most expensive level when the field is unset, which is a lot of
  # tokens for routine work -- so the combination picks the default and the
  # user can raise it per run. An unsupported level is fatal rather than a
  # warning: the template raises on it, so every request would fail.
  REASONING_EFFORT="${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}"
  if [[ "$REASONING_EFFORT" != "default" ]]; then
    if [[ -n "${REASONING_EFFORTS:-}" && " $REASONING_EFFORTS " != *" $REASONING_EFFORT "* ]]; then
      echo "${SERVER_CMD}: REASONING_EFFORT='$REASONING_EFFORT' is not supported by this model." >&2
      echo "         Supported: ${REASONING_EFFORTS} (or 'default' for the template's own)." >&2
      exit 1
    fi
    ARGS+=(--reasoning-effort "$REASONING_EFFORT")
  fi

  # Cap thinking without disabling it: bounds the max_tokens trap.
  [[ -n "$THINKING_BUDGET" ]] && ARGS+=(--reasoning-budget "$THINKING_BUDGET")
fi

# Speculative decoding via the multi-token-prediction head. llama.cpp only
# auto-discovers MTP sidecars on the -hf path, so point at it explicitly.
if [[ -n "$MTP" && -f "$MTP" ]]; then
  ARGS+=(
    -md "$MTP"
    --spec-type draft-mtp
    --spec-draft-n-max "${SPEC_DRAFT_N_MAX:-2}"
    --spec-draft-ngl 99
    # The draft model has its own KV cache; keep it on a supported type too.
    --spec-draft-type-k "$KV_TYPE"
    --spec-draft-type-v "$KV_TYPE"
  )
fi

# Vision weights cost context. Off outside the vision profiles.
if [[ "$VISION" == "1" && -n "$MMPROJ" && -f "$MMPROJ" ]]; then
  ARGS+=(--mmproj "$MMPROJ" --image-min-tokens "${IMAGE_MIN_TOKENS:-1024}")
fi

exec llama-server "${ARGS[@]}" "$@"
