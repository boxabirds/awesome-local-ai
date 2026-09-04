#!/usr/bin/env bash
# local-ai-mtplx-server -- generic MTPLX launcher for awesome-local-ai.
#
# One launcher serves every MTPLX combination. Everything that varies -- the
# model pack, profiles, sampling presets, reasoning defaults -- is read at run
# time from the install manifest written by the installer:
#
#   $ROOT/install.env    key=value manifest
#   $ROOT/profiles.tsv   name|ctx|mtp_depth|effort|max_tokens|need_mib|summary
#   $ROOT/help.txt       combination-specific prose for --help
#
# It contains NO machine-specific paths: the root and the model cache are
# resolved from $HOME at run time, so this file is identical on every machine
# and for every user, and can be pasted into a bug report without leaking a
# username.
#
# Why this is a separate file from server-llamacpp.sh: that one builds a
# `llama-server` command line and nothing else. The flags here are not a
# translation of those flags -- several exist because of specific measured
# failures, documented inline.

set -euo pipefail

: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
if [[ -z "${HOME:-}" ]]; then
  echo "local-ai-mtplx-server: cannot determine HOME; set HOME or LOCAL_AI_ROOT." >&2
  exit 1
fi

if [[ -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-mtplx-server: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. mtplx-qwen38-27b-server) instead of this file." >&2
  exit 1
fi

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-mtplx-server: no install manifest at $ROOT/install.env" >&2
  echo "Re-run the install-*.sh script for this combination." >&2
  exit 1; }

# shellcheck disable=SC1091
. "$ROOT/install.env"

if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then
  ROOT="${!ROOT_ENV_VAR}"
fi

BIN_DIR="$HOME/.local/bin"
export PATH="$BIN_DIR:$PATH"

# MTPLX owns its model cache, so MODEL_SUBDIR points at the cache rather than
# inside the install root. Still relative to $HOME; still overridable.
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
${DISPLAY_NAME} server launcher (${BACKEND} + ${ACCEL})

USAGE
  ${SERVER_CMD} [--help] [extra mtplx serve args...]
  PROFILE=<name> ${SERVER_CMD}

  Unrecognised arguments are passed straight through to \`mtplx serve\`, and
  override anything the profile set.

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-11s %7s ctx  depth %-2s  effort %-7s  max %-6s  %s\n", $1, $2, $3, $4, $5, $7
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}

case "${1:-}" in
  -h|--help|help) show_help; exit 0 ;;
esac

command -v mtplx >/dev/null 2>&1 || {
  echo "${SERVER_CMD}: mtplx is not on PATH." >&2
  echo "Install it with: uv tool install mtplx" >&2
  exit 1; }

if [[ ! -d "$MODEL" ]]; then
  echo "${SERVER_CMD}: model pack not found at" >&2
  echo "  $MODEL" >&2
  echo "Set ${MODEL_CACHE_ENV_VAR:-MTPLX_CACHE_DIR} if your cache lives elsewhere, or MODEL for a" >&2
  echo "specific pack, or re-run the install script to (re)download." >&2
  echo "What is cached:  mtplx models" >&2
  exit 1
fi

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "unknown PROFILE '$PROFILE' ($(profile_names))" >&2
  echo "run '${SERVER_CMD} --help' for the profile table" >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_DEPTH D_EFFORT D_MAXTOK D_NEED _ <<< "$row"

# Validate before doing anything slow. An unsupported effort is fatal, not a
# warning: the chat template raises on a level it does not know, so every
# request would fail after a two-minute model load.
REASONING_EFFORT="${REASONING_EFFORT:-${D_EFFORT:-${REASONING_EFFORT_DEFAULT:-auto}}}"
if [[ "$REASONING_EFFORT" != "default" && -n "${REASONING_EFFORTS:-}" ]] \
   && [[ " $REASONING_EFFORTS " != *" $REASONING_EFFORT "* ]]; then
  echo "${SERVER_CMD}: REASONING_EFFORT='$REASONING_EFFORT' is not supported by this model." >&2
  echo "         Supported: ${REASONING_EFFORTS} (or 'default' for the server's own)." >&2
  exit 1
fi

# Whether the user sized this by hand. Must be read before the profile
# defaults are applied, and it turns the pre-flight off: need_mib describes the
# profile, not whatever they asked for.
USER_TUNED="${CTX:-}${DEPTH:-}${MAX_RESPONSE_TOKENS:-}"

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
DEPTH="${DEPTH:-$D_DEPTH}"
MAX_RESPONSE_TOKENS="${MAX_RESPONSE_TOKENS:-$D_MAXTOK}"
THINKING="${THINKING:-1}"

# ---- pre-flight -----------------------------------------------------------
# An already-serving port is both the commonest failure and the commonest
# reason free memory looks short -- the other server is holding the weights.
# Name that specifically rather than letting the memory check blame the user's
# browser for it.
if command -v curl >/dev/null 2>&1 \
   && curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  serving="$(curl -sf --max-time 2 "http://127.0.0.1:${PORT}/v1/models" 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("data") or [{}])[0].get("id",""))' 2>/dev/null || true)"
  echo "${SERVER_CMD}: something is already serving on :${PORT}${serving:+ (${serving})}." >&2
  if [[ "$serving" == "${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}" ]]; then
    echo "         That is this combination's model -- you can use it as it is." >&2
  else
    echo "         Stop it first:  mtplx stop --port ${PORT}" >&2
    echo "         Or serve elsewhere:  PORT=<other> ${SERVER_CMD}" >&2
  fi
  exit 1
fi

# Apple silicon reports free memory system-wide, not per-device. Loading a
# 77 GB pack when the machine has 20 GB free does not fail fast -- it swaps,
# and the machine becomes unusable for minutes. Check first, name the fix.
# Skipped when the user has hand-tuned the sizing, since D_NEED no longer
# describes what they asked for.
if [[ "$ACCEL" == "metal" ]] && [[ -z "$USER_TUNED" ]] && command -v vm_stat >/dev/null 2>&1; then
  free_mib="$(vm_stat 2>/dev/null | awk '
    /page size of/ { for (i=1;i<=NF;i++) if ($i+0 > 0 && $i ~ /^[0-9]+$/) ps=$i }
    /Pages free/     { gsub(/\./,"",$3); f=$3 }
    /Pages inactive/ { gsub(/\./,"",$3); v=$3 }
    END { if (ps=="") ps=16384; printf "%d", (f+v)*ps/1048576 }')"
  if [[ -n "$free_mib" ]] && (( free_mib < D_NEED )); then
    echo "WARNING: profile '$PROFILE' needs ~${D_NEED} MiB but only ${free_mib} MiB is free." >&2
    echo "         Close what you can, or pick a smaller profile:" >&2
    suggestion=""
    while IFS='|' read -r n c d e mt need rest; do
      [[ -z "${n// }" || "$n" == \#* ]] && continue
      (( free_mib >= need )) && { suggestion="$n"; break; }
    done < <(sort -t'|' -k6,6nr "$ROOT/profiles.tsv")
    if [[ -n "$suggestion" ]]; then
      echo "         Try: PROFILE=$suggestion" >&2
    else
      echo "         Not enough free memory for any profile; free some first." >&2
    fi
    echo "         Continuing anyway in 5s (Ctrl-C to abort)..." >&2
    sleep 5
  fi
fi

# ---- flags ----------------------------------------------------------------
ARGS=(
  serve
  --model "$MODEL"
  # Stable model id for API clients. Without this the served id follows the
  # pack directory name, so every client config breaks when the pack changes.
  --model-id "${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"
  --cache-dir "$MODEL_CACHE"
  --host "$HOST"
  --port "$PORT"
  --depth "$DEPTH"
  # The context ceiling is deliberately well below what the model advertises.
  # Measured: a session run out to 202k returned zero-token responses, and
  # decode had already fallen from ~35 tok/s at 27k to ~11-18 at 200k. This
  # value must also match `limit.context` for the model in the client config:
  # the server enforces the ceiling, but only the client-side limit makes the
  # client compact its history before it gets there.
  --context-window "$CTX"
  # Ceiling on a single answer. One measured turn produced 28,086 tokens over
  # 17 minutes before this was capped.
  --max-tokens "$MAX_RESPONSE_TOKENS"
  --yes
)

# --no-auth only relaxes localhost binds; a non-localhost bind still demands a
# key, so this cannot accidentally expose an unauthenticated server. Anything
# other than a loopback host keeps auth on.
case "$HOST" in
  127.0.0.1|localhost|::1) ARGS+=(--no-auth) ;;
esac

# Thinking mode and its sampler are a matched pair. The model cards specify
# different sampling for each, and running the thinking preset with thinking
# disabled is documented to cause repetition. So THINKING flips both together.
if [[ "$THINKING" == "0" ]]; then
  # shellcheck disable=SC2206
  ARGS+=(--reasoning off ${SAMPLING_INSTRUCT})
else
  # shellcheck disable=SC2206
  ARGS+=(--reasoning on ${SAMPLING_THINKING})

  # Reasoning effort is set SERVER-side on purpose. OpenCode silently drops
  # both `reasoning_effort` and `chat_template_kwargs` from an agent's options
  # block, so a per-request value never arrives and every request lands on the
  # server's default. The flag is the only lever that verifiably applies, and
  # /health reports what it resolved to. An unsupported level is fatal rather
  # than a warning: the template raises on it, so every request would fail.
  # Already validated above, before the slow checks.
  if [[ "$REASONING_EFFORT" != "default" ]]; then
    ARGS+=(--reasoning-effort "$REASONING_EFFORT")
  fi
fi

exec mtplx "${ARGS[@]}" "$@"
