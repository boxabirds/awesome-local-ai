#!/usr/bin/env bash
# local-ai-gufo-fork-ninjapear-server -- launcher for NinjaPear's gufo fork, built from source.
#
# Why this is not lib/runtime/server-gufo.sh with a flag. That launcher runs a digest-pinned container and
# always passes two arguments this engine rejects or ignores:
#
#   --mtp-model         the fork's Qwen3.6 draft block lives in the SAME GGUF; its own docs say the flag "is
#                       rejected". Flash-Next needs a sidecar, so the shared launcher always passes one.
#   --reasoning-effort  this model's template has no reasoning-effort control at all.
#
# Three differences in one argv is a different launcher, and five recorded gufo runs depend on the shared one
# while this is being written. Everything else follows it closely on purpose.
#
# The engine is a source build, so it reports `gufo version development (unknown)` -- no release number and no
# hash. There is nothing to match a pin against, so the installer records the commit it built and stamps it
# beside the binary, and this refuses to start if the two disagree. Without that a run's record could not say
# which source produced it, and the fork is forty commits behind upstream.

set -euo pipefail

: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
if [[ -z "${HOME:-}" ]]; then
  echo "local-ai-gufo-fork-ninjapear-server: cannot determine HOME; set HOME or LOCAL_AI_ROOT." >&2
  exit 1
fi

if [[ -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-gufo-fork-ninjapear-server: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. qwen36-35b-a3b-strix-gufo-server) instead of this file." >&2
  exit 1
fi

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-gufo-fork-ninjapear-server: no install manifest at $ROOT/install.env" >&2
  echo "Re-run the install-*.sh script for this combination." >&2
  exit 1; }

# shellcheck disable=SC1091
. "$ROOT/install.env"

if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then
  ROOT="${!ROOT_ENV_VAR}"
fi

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
${DISPLAY_NAME} server launcher (${BACKEND}, built from source, ${ACCEL})

USAGE
  ${SERVER_CMD} [--help] [extra 'gufo serve llm' args...]
  PROFILE=<name> ${SERVER_CMD}

  Unrecognised arguments are appended to gufo's argv, after everything the profile set.

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

# ---- the engine, and that it is the one the manifest names ----------------
BIN="$ROOT/${GUFO_FORK_BIN_REL:-engine/gufo}"
[[ -x "$BIN" ]] || {
  echo "${SERVER_CMD}: no engine at $BIN" >&2
  echo "Re-run the combination's installer: this backend builds the engine from source." >&2
  exit 1; }

STAMP="$(dirname "$BIN")/COMMIT"
built="$(tr -d '[:space:]' < "$STAMP" 2>/dev/null || true)"
if [[ -z "$built" ]]; then
  echo "${SERVER_CMD}: the engine beside $STAMP does not say which commit it was built from." >&2
  echo "A source build reports no version, so without this a run could not record its engine. Re-install." >&2
  exit 1
fi
if [[ -n "${GUFO_FORK_COMMIT:-}" && "$built" != "$GUFO_FORK_COMMIT" ]]; then
  echo "${SERVER_CMD}: the engine was built from ${built}, but this combination pins ${GUFO_FORK_COMMIT}." >&2
  echo "Re-run the combination's installer to rebuild at the pinned commit." >&2
  exit 1
fi

[[ -f "$MODEL/$GUFO_MODEL_REL" ]] || {
  echo "${SERVER_CMD}: weights not found: $MODEL/$GUFO_MODEL_REL" >&2
  echo "Set ${MODEL_CACHE_ENV_VAR:-GUFO_MODEL_CACHE} if they live elsewhere, or MODEL for the directory," >&2
  echo "or re-run the install script to (re)download." >&2
  exit 1; }

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "unknown PROFILE '$PROFILE' ($(profile_names))" >&2
  echo "run '${SERVER_CMD} --help' for the profile table" >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_SESSIONS D_DRAFT D_PREFILL_CHUNK D_NEED D_BASIS _ <<< "$row"

# This model's template has NO reasoning-effort control (the fork's own model page). Refuse an effort rather
# than pass a flag the engine would reject after a long load, or silently ignore.
THINKING="${THINKING:-1}"
REASONING_EFFORT="${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}"
if [[ "$REASONING_EFFORT" != "default" ]]; then
  echo "${SERVER_CMD}: REASONING_EFFORT='$REASONING_EFFORT' -- this model's template has no reasoning-effort" >&2
  echo "         control, so there is nothing to set. Use REASONING_EFFORT=default." >&2
  exit 1
fi

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
SESSIONS="${SESSIONS:-$D_SESSIONS}"
DRAFT_TOKENS="${DRAFT_TOKENS:-$D_DRAFT}"
PREFILL_CHUNK="${PREFILL_CHUNK:-$D_PREFILL_CHUNK}"
MODEL_ALIAS="${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"

# ---- pre-flight: already running ------------------------------------------
if command -v curl >/dev/null 2>&1 \
   && curl -sf --max-time 2 "http://127.0.0.1:${PORT}/v1/models" >/dev/null 2>&1; then
  echo "${SERVER_CMD}: something is already serving on :${PORT}. Stop it first, or serve elsewhere:" >&2
  echo "         PORT=<other> ${SERVER_CMD}" >&2
  exit 1
fi

# ---- pre-flight: another model already resident --------------------------
# One model server at a time: each holds tens of gigabytes, and two on one machine means swap, which stops the
# story that is running (6 Oct 2026: an installer's smoke test beside a live run took swap 0.13 -> 35.47 GB).
# The pattern is the same in every launcher and knows every engine we run plus the common desktop ones: a
# launcher that only recognised its own kind let the others past. This engine's own process line is
# "gufo serve", which `gufo +serve` already matches, so it is caught by the other launchers unchanged. The
# process list is captured before it is filtered, so the filter's own text is not in it, and this shell is
# skipped by pid so it never matches itself.
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
# shellcheck disable=SC2206
BASE=( ${GUFO_FORK_BASE_ARGS:-} )

ARGS=(
  --host "$HOST" --port "$PORT"
  --sessions "$SESSIONS"
  llm
  --model "${MODEL}/${GUFO_MODEL_REL}"
  # NO --mtp-model: the draft block is in the same GGUF and the flag is rejected.
  --speculative mtp
  --draft-tokens "$DRAFT_TOKENS"
  --context "$CTX"
  --prefill-chunk "$PREFILL_CHUNK"
  --served-model-name "$MODEL_ALIAS"
  ${BASE[@]+"${BASE[@]}"}
)

# Thinking and its sampler are server-side defaults a request can still override. No effort flag exists here.
if [[ "$THINKING" == "0" ]]; then
  # shellcheck disable=SC2206
  ARGS+=(--think off ${GUFO_FORK_SAMPLING_INSTRUCT:-})
else
  # shellcheck disable=SC2206
  ARGS+=(--think on ${SAMPLING_THINKING:-})
fi

# Ubuntu's librocwmma-dev ships rocwmma.hpp without the internal/ directory it includes, which only breaks the
# BUILD; it is set here too so a rebuild from this root behaves the same as the installer's.
if [[ -n "${GUFO_FORK_CPATH_REL:-}" && -d "$ROOT/$GUFO_FORK_CPATH_REL" ]]; then
  export CPATH="$ROOT/$GUFO_FORK_CPATH_REL${CPATH:+:$CPATH}"
fi

echo "${SERVER_CMD}: PROFILE=${PROFILE} (${D_BASIS}) ctx=${CTX} sessions=${SESSIONS} draft=${DRAFT_TOKENS} gufo fork ${built} -> http://${HOST}:${PORT}/v1" >&2

# Run in the background and wait, so a SIGTERM reaches the engine rather than orphaning it holding the GPU.
"$BIN" serve "${ARGS[@]}" "$@" &
child=$!
stop_engine() {
  trap - TERM INT HUP
  echo "${SERVER_CMD}: stopping the engine..." >&2
  kill -TERM "$child" 2>/dev/null || true
  wait "$child" 2>/dev/null || true
  exit 0
}
trap stop_engine TERM INT HUP
rc=0
wait "$child" || rc=$?
exit "$rc"
