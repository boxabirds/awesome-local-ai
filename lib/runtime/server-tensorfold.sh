#!/usr/bin/env bash
# local-ai-tensorfold-server -- generic TensorFold launcher for awesome-local-ai.
#
# STAGED: this file belongs at lib/runtime/server-tensorfold.sh (lib/launcher.sh installs lib/runtime/server-<backend>.sh
# as the combination's server command). It waits here, tested by tests/tensorfold-test.sh, until the owner approves
# moving it.
#
# Everything that varies is read at run time from the install manifest the installer wrote:
#   $ROOT/install.env    key=value manifest (TENSORFOLD_* fields from lib/tensorfold.sh)
#   $ROOT/profiles.tsv   name|ctx|drafts|max_tokens|need_mib|basis|summary
#   $ROOT/help.txt       combination-specific prose for --help
# No machine-specific paths: the install root, the binary and the model store resolve from $HOME at run time.
#
# The command line is the one lib/tensorfold.sh tensorfold_serve_argv builds (this file is installed standalone and
# cannot source lib/; tests/tensorfold-test.sh checks the two agree). It `exec`s tensorfold, so a SIGTERM from the
# harness reaches TensorFold, which turns SIGTERM into its own clean shutdown (cli.py).

set -euo pipefail

if [[ -z "${HOME:-}" || -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-tensorfold-server: run the per-combination command (e.g. tensorfold-qwen38-flash-next-server)." >&2
  exit 1
fi
ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-tensorfold-server: no install manifest at $ROOT/install.env; re-run the install script." >&2
  exit 1; }
# shellcheck disable=SC1091
. "$ROOT/install.env"
if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then ROOT="${!ROOT_ENV_VAR}"; fi

profile_row() {
  local want="$1" name rest
  while IFS='|' read -r name rest; do
    [[ -z "${name// }" || "$name" == \#* ]] && continue
    [[ "$name" == "$want" ]] && { printf '%s|%s' "$name" "$rest"; return 0; }
  done < "$ROOT/profiles.tsv"
  return 1
}

show_help() {
  cat <<HDR
${DISPLAY_NAME} server launcher (${BACKEND} + ${ACCEL})

USAGE
  ${SERVER_CMD} [--help] [extra tensorfold serve args...]
  PROFILE=<name> ${SERVER_CMD}

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-8s %7s ctx  drafts %-3s  max %-6s  %-9s %s\n", $1, $2, ($3=="1"?"on":"off"), $4, $6, $7
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}
case "${1:-}" in -h|--help|help) show_help; exit 0 ;; esac

BIN="${TENSORFOLD_BIN:-}"
[[ -z "$BIN" && -n "${TENSORFOLD_BIN_REL:-}" ]] && BIN="$HOME/$TENSORFOLD_BIN_REL"
[[ -n "$BIN" && -x "$BIN" ]] || {
  echo "${SERVER_CMD}: no tensorfold binary${BIN:+ at $BIN}; re-run the install script or set TENSORFOLD_BIN." >&2
  exit 1; }

MODEL="${MODEL:-$HOME/$MODEL_SUBDIR/$MODEL_FILE}"
[[ -f "$MODEL/config.json" && -f "$MODEL/model.safetensors.index.json" ]] || {
  echo "${SERVER_CMD}: no checkpoint at $MODEL; set MODEL=<dir> or re-run the install script." >&2
  exit 1; }

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "${SERVER_CMD}: unknown PROFILE '$PROFILE'; '${SERVER_CMD} --help' lists them." >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_DRAFTS D_MAXTOK _ _ _ <<< "$row"

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
MODEL_ALIAS="${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"

# TensorFold has no API key; a non-loopback bind would hand the model to the network.
case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *) echo "${SERVER_CMD}: HOST=${HOST} is not loopback, and TensorFold has no API key. Refusing." >&2; exit 1 ;;
esac

# A 128 GB Mac kernel-panicked on 24 Sep 2026 with two large processes resident; this checkpoint keeps ~75.6 GiB of
# weights. Another model server is a refusal, not a warning. The process list is captured before it is filtered, so
# the filter's own text is not in it.
if [[ "${ALLOW_COEXIST:-0}" != "1" ]]; then
  snapshot="$(ps -axo pid=,command= 2>/dev/null || true)"
  others="$(printf '%s\n' "$snapshot" | awk -v self="$$" '$1 == self { next }
    /mtplx\.server|mtplx +serve|mlx-serve .*--serve|mlx-serve +serve|llama-server|mlx_lm\.server|tensorfold +serve|MLX-Serve\.app|ollama +serve|LM Studio/ {
      sub(/^ +/, ""); print }')"
  if [[ -n "$others" ]]; then
    echo "${SERVER_CMD}: another model server is running:" >&2
    printf '%s\n' "$others" | cut -c1-160 | sed 's/^/           /' >&2
    echo "         Stop it first, or set ALLOW_COEXIST=1 if you are sure it is small." >&2
    exit 1
  fi
fi

ARGS=(serve "$MODEL" --host 127.0.0.1 --port "$PORT" --name "$MODEL_ALIAS"
      --reasoning-effort "${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-low}}"
      --max-tokens "$D_MAXTOK"
      --parallel "${TENSORFOLD_PARALLEL:-1}"
      --snapshot-dir none
      --no-update-check)
# shellcheck disable=SC2206
ARGS+=(${SAMPLING_THINKING})
[[ "$CTX" == fit ]] || ARGS+=(--context "$CTX")
[[ "$D_DRAFTS" == 1 ]] || ARGS+=(--no-drafts)

export TENSORFOLD_MEMORY_LIMIT_GB="${TENSORFOLD_MEMORY_LIMIT_GB}" TENSORFOLD_NO_LIVE=1 TENSORFOLD_NO_UPDATE_CHECK=1
echo "${SERVER_CMD}: PROFILE=${PROFILE} ctx=${CTX} drafts=${D_DRAFTS} id=${MODEL_ALIAS} -> http://127.0.0.1:${PORT}/v1" >&2
exec "$BIN" "${ARGS[@]}" "$@"
