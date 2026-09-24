#!/usr/bin/env bash
# local-ai-mlxserve-server -- generic mlx-serve launcher for awesome-local-ai.
#
# One launcher serves every mlx-serve combination. Everything that varies is
# read at run time from the install manifest written by the installer:
#
#   $ROOT/install.env    key=value manifest (MLXSERVE_* fields from lib/mlxserve.sh)
#   $ROOT/profiles.tsv   name|ctx|mtp|kv_quant|max_tokens|need_mib|basis|summary
#   $ROOT/help.txt       combination-specific prose for --help
#
# No machine-specific paths: the install root, the binary (when it lives under
# $HOME) and the model store resolve from $HOME at run time.
#
# The launcher `exec`s mlx-serve, so a SIGTERM from the session manager or
# launchd reaches mlx-serve itself, which handles SIGINT/SIGTERM through its
# own shutdown path (src/server.zig installs both with sigaction).
#
# Two things mlx-serve does not offer that other backends here do, and how
# this launcher deals with them (both read from mlx-serve's source):
#
#   * No server-side thinking default. A request that names neither
#     `enable_thinking` nor `reasoning_effort` gets the architecture default,
#     which for this model type is thinking OFF (model.zig
#     defaultEnableThinking) -- unless the checkpoint's generation_config.json
#     declares default_chat_template_kwargs.enable_thinking. OpenCode sends
#     neither field. So the launcher serves the pack through a directory of
#     symlinks whose generation_config.json carries that one key, set from
#     THINKING. The directory's name is the model id mlx-serve advertises
#     (main.zig: the id is the model directory's basename), which also gives
#     clients a stable id.
#   * No server-side reasoning effort. On the Qwen3.8 template a thinking
#     request that names no effort renders as "low" with a 2048-token thinking
#     budget (server.zig implicitEffortBudget, chat.zig qwen38EffortFor;
#     mlx-serve 26.9.5 changelog). REASONING_EFFORT therefore only accepts
#     what the server will actually do; REASONING_BUDGET maps to
#     --reasoning-budget, which does apply server-side.

set -euo pipefail

: "${HOME:=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)}"
if [[ -z "${HOME:-}" ]]; then
  echo "local-ai-mlxserve-server: cannot determine HOME; set HOME or LOCAL_AI_ROOT." >&2
  exit 1
fi

if [[ -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-mlxserve-server: LOCAL_AI_INSTALL_REL is not set." >&2
  echo "Run the per-combination command (e.g. mlxserve-qwen38-flash-next-server) instead of this file." >&2
  exit 1
fi

ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-mlxserve-server: no install manifest at $ROOT/install.env" >&2
  echo "Re-run the install-*.sh script for this combination." >&2
  exit 1; }

# shellcheck disable=SC1091
. "$ROOT/install.env"

if [[ -n "${ROOT_ENV_VAR:-}" && -n "${!ROOT_ENV_VAR:-}" ]]; then
  ROOT="${!ROOT_ENV_VAR}"
fi

export PATH="$HOME/.local/bin:$PATH"

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
  ${SERVER_CMD} [--help] [extra mlx-serve args...]
  PROFILE=<name> ${SERVER_CMD}

  Unrecognised arguments are appended to the mlx-serve command line, after
  everything the profile set.

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-8s %7s ctx  mtp %-3s  kv %-3s  max %-6s  %-9s %s\n", $1, $2, ($3=="1"?"on":"off"), $4, $5, $7, $8
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}

case "${1:-}" in
  -h|--help|help) show_help; exit 0 ;;
esac

# ---- binary ---------------------------------------------------------------
BIN="${MLXSERVE_BIN:-}"
if [[ -z "$BIN" && -n "${MLXSERVE_BIN_REL:-}" ]]; then BIN="$HOME/$MLXSERVE_BIN_REL"; fi
if [[ -z "$BIN" && -n "${MLXSERVE_BIN_SYS:-}" ]]; then BIN="$MLXSERVE_BIN_SYS"; fi
if [[ -z "$BIN" ]]; then BIN="$(command -v mlx-serve 2>/dev/null || true)"; fi
[[ -n "$BIN" && -x "$BIN" ]] || {
  echo "${SERVER_CMD}: no mlx-serve binary found${BIN:+ at $BIN}." >&2
  echo "Re-run this combination's install script, or set MLXSERVE_BIN=<path>." >&2
  exit 1; }

# ---- weights --------------------------------------------------------------
MODEL="${MODEL:-$HOME/$MODEL_SUBDIR/$MODEL_FILE}"
if [[ ! -f "$MODEL/config.json" || ! -f "$MODEL/model.safetensors.index.json" ]]; then
  echo "${SERVER_CMD}: model pack not found at" >&2
  echo "  $MODEL" >&2
  echo "Set MODEL=<pack directory>, or re-run the install script to (re)download." >&2
  exit 1
fi

# ---- profile --------------------------------------------------------------
PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "unknown PROFILE '$PROFILE' ($(profile_names))" >&2
  echo "run '${SERVER_CMD} --help' for the profile table" >&2
  exit 1; }
IFS='|' read -r _ D_CTX D_MTP D_KV D_MAXTOK D_NEED D_BASIS _ <<< "$row"

THINKING="${THINKING:-1}"
REASONING_EFFORT="${REASONING_EFFORT:-${REASONING_EFFORT_DEFAULT:-default}}"
if [[ "$THINKING" != "0" && "$REASONING_EFFORT" != "default" ]] \
   && [[ " ${REASONING_EFFORTS:-default} " != *" $REASONING_EFFORT "* ]]; then
  echo "${SERVER_CMD}: REASONING_EFFORT='$REASONING_EFFORT' cannot be applied by mlx-serve." >&2
  echo "         mlx-serve has no server-side effort setting: a request that names no effort" >&2
  echo "         is served at 'low' (2048-token thinking budget). Accepted here: ${REASONING_EFFORTS:-default}." >&2
  echo "         A client that sends reasoning_effort per request still gets what it asks for;" >&2
  echo "         REASONING_BUDGET=<tokens> changes the budget server-side." >&2
  exit 1
fi
if [[ -n "${REASONING_BUDGET:-}" && ! "${REASONING_BUDGET}" =~ ^-?[0-9]+$ ]]; then
  echo "${SERVER_CMD}: REASONING_BUDGET must be an integer (tokens; -1 = unlimited)." >&2
  exit 1
fi

# Whether the user sized this by hand. Read before the profile defaults apply:
# it turns the memory pre-flight into a warning, since need_mib describes the
# profile, not whatever they asked for.
USER_TUNED="${CTX:-}${KV_QUANT:-}"

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
MTP="${MTP:-$D_MTP}"
KV_QUANT="${KV_QUANT:-$D_KV}"
MAX_RESPONSE_TOKENS="${MAX_RESPONSE_TOKENS:-$D_MAXTOK}"
MODEL_ALIAS="${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"
OS_RESERVE_GIB="${OS_RESERVE_GIB:-${MLXSERVE_OS_RESERVE_GIB:-16}}"
HEADROOM_MIB="${MLXSERVE_PREFLIGHT_HEADROOM_MIB:-8192}"

# ---- pre-flight: exposure -------------------------------------------------
# mlx-serve's own default bind is 0.0.0.0 (docs/cli.md) and it only demands a
# key from non-localhost clients when --api-key is set. A LAN bind without a
# key would hand the model to anyone on the network.
case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *)
    if [[ -z "${MLXSERVE_API_KEY:-}" ]]; then
      echo "${SERVER_CMD}: HOST=${HOST} is not loopback and MLXSERVE_API_KEY is not set." >&2
      echo "         Set MLXSERVE_API_KEY=<key> to serve beyond this machine." >&2
      exit 1
    fi ;;
esac

# ---- pre-flight: already serving -------------------------------------------
if command -v curl >/dev/null 2>&1 \
   && curl -sf --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  serving="$(curl -sf --max-time 2 "http://127.0.0.1:${PORT}/v1/models" 2>/dev/null \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("data") or [{}])[0].get("id",""))' 2>/dev/null || true)"
  echo "${SERVER_CMD}: something is already serving on :${PORT}${serving:+ (${serving})}." >&2
  if [[ "$serving" == "$MODEL_ALIAS" ]]; then
    echo "         That is this combination's model -- you can use it as it is." >&2
  else
    echo "         Stop it first, or serve elsewhere:  PORT=<other> ${SERVER_CMD}" >&2
  fi
  exit 1
fi

# ---- pre-flight: another large model resident -------------------------------
# A 128 GB Mac kernel-panicked on 24 Sep 2026 with MTPLX's Flash-Next at a
# 97 GiB peak plus a leaking 10 GB process beside it. This pack is ~70 GiB of
# weights: it cannot share the machine with another server of its class, and
# "free memory" read a moment before that server grows is not a safe guide.
# So a resident model server is a refusal, not a warning.
# The process list is captured BEFORE it is filtered: in a pipeline the awk
# below would be running while ps looks, and its own program text contains
# every pattern it searches for. MTPLX's server shows up as
# `python -m mtplx.server.openai` (observed), its CLI as `mtplx serve`.
_other_model_servers() {
  local snapshot
  snapshot="$(ps -axo pid=,command= 2>/dev/null)" || return 0
  printf '%s\n' "$snapshot" | awk -v self="$$" '
    $1 == self { next }
    /mtplx\.server|mtplx +serve|mlx-serve .*--serve|mlx-serve +serve|llama-server|mlx_lm\.server|MLX Core\.app|MLX-Serve\.app|ollama +serve|LM Studio/ {
      sub(/^ +/, ""); print }'
}
if [[ "${ALLOW_COEXIST:-0}" != "1" ]]; then
  others="$(_other_model_servers || true)"
  if [[ -n "$others" ]]; then
    echo "${SERVER_CMD}: another model server is running:" >&2
    printf '%s\n' "$others" | cut -c1-160 | sed 's/^/           /' >&2
    echo "         This pack wires ~70 GiB; two such servers on one Mac is how the 24 Sep" >&2
    echo "         kernel panic happened. Stop it first (e.g. mtplx stop), or set" >&2
    echo "         ALLOW_COEXIST=1 if you are sure the other one is small." >&2
    exit 1
  fi
fi

# ---- pre-flight: free memory ----------------------------------------------
# `memory_pressure` reports the OS's own view as a percentage; the page
# arithmetic is a fallback. Same method as lib/accel/metal.sh (this runtime
# file is installed standalone, so it cannot source lib/).
_macos_available_mib() {
  local total_mib pct
  total_mib=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1048576 ))
  (( total_mib > 0 )) || return 1

  pct="$(memory_pressure 2>/dev/null \
        | sed -nE 's/.*free percentage: *([0-9]+)%.*/\1/p' | head -1)"
  if [[ -n "$pct" ]] && (( pct > 0 )); then
    printf '%s' $(( total_mib * pct / 100 ))
    return 0
  fi

  vm_stat 2>/dev/null | awk '
    /page size of/    { for (i=1;i<=NF;i++) if ($i+0 > 0 && $i ~ /^[0-9]+$/) ps=$i }
    /Pages free/      { gsub(/\./,"",$3); f=$3 }
    /Pages inactive/  { gsub(/\./,"",$3); v=$3 }
    /Pages purgeable/ { gsub(/\./,"",$3); p=$3 }
    /Pages speculative/ { gsub(/\./,"",$3); s=$3 }
    END { if (ps=="") ps=16384; printf "%d", (f+v+p+s)*ps/1048576 }'
}

# need_mib is an ESTIMATE (see profiles.tsv) that leaves out the prefill
# working set, which nobody has measured for this pack; HEADROOM_MIB is room
# for it. Short -> refuse, unless FORCE_LOW_MEM=1 or the user sized it by hand.
if [[ "$ACCEL" == "metal" ]]; then
  free_mib="$(_macos_available_mib || true)"
  want_mib=$(( D_NEED + HEADROOM_MIB ))
  if [[ -n "$free_mib" ]] && (( free_mib < want_mib )); then
    echo "${SERVER_CMD}: profile '$PROFILE' needs ~${D_NEED} MiB (${D_BASIS}) + ${HEADROOM_MIB} MiB headroom;" >&2
    echo "         only ${free_mib} MiB is available. Close large apps first." >&2
    echo "         Do NOT raise iogpu.wired_limit_mb to make this fit." >&2
    if [[ "${FORCE_LOW_MEM:-0}" == "1" || -n "$USER_TUNED" ]]; then
      echo "         Continuing (FORCE_LOW_MEM=1 or hand-sized CTX/KV_QUANT) in 5s; Ctrl-C to abort..." >&2
      sleep 5
    else
      echo "         Refusing. FORCE_LOW_MEM=1 overrides." >&2
      exit 1
    fi
  fi
fi

# ---- the served directory --------------------------------------------------
# Symlinks to every file of the pack except generation_config.json, which is a
# copy carrying the thinking default. Rebuilt on every launch: it is only
# links, and THINKING may differ from the last run. The pack itself is never
# modified, so its verification marker stays valid.
SERVED_DIR="$ROOT/served/$MODEL_ALIAS"
rm -rf "$SERVED_DIR"
mkdir -p "$SERVED_DIR"
for f in "$MODEL"/*; do
  name="${f##*/}"
  [[ "$name" == "generation_config.json" ]] && continue
  ln -s "$f" "$SERVED_DIR/$name"
done
enable_thinking=true; [[ "$THINKING" == "0" ]] && enable_thinking=false
python3 - "$MODEL/generation_config.json" "$SERVED_DIR/generation_config.json" "$enable_thinking" <<'PY' || {
import json, sys
src, dst, on = sys.argv[1], sys.argv[2], sys.argv[3] == "true"
try:
    doc = json.load(open(src))
except Exception:
    doc = {}
kw = doc.get("default_chat_template_kwargs")
if not isinstance(kw, dict):
    kw = {}
kw["enable_thinking"] = on
doc["default_chat_template_kwargs"] = kw
json.dump(doc, open(dst, "w"), indent=2)
PY
  echo "${SERVER_CMD}: could not write ${SERVED_DIR}/generation_config.json (python3 missing?)." >&2
  exit 1; }

# ---- argv -----------------------------------------------------------------
ARGS=(
  --model "$SERVED_DIR"
  --serve
  --host "$HOST"
  --port "$PORT"
  # Must match limit.context in the client config: only the client-side limit
  # makes OpenCode/pi compact before the server's ceiling.
  --ctx-size "$CTX"
  --max-tokens "$MAX_RESPONSE_TOKENS"
  --kv-quant "$KV_QUANT"
  # One request and one model at a time: concurrent streams each bring their
  # own KV and prefill working set, and this machine has no room for a second.
  --max-concurrent 1
  --max-resident-models 1
  # Free RAM mlx-serve leaves out of every memory plan (default: an eighth of
  # RAM, capped at 8 GB). Raised on purpose after the 24 Sep kernel panic.
  --os-reserve-gib "$OS_RESERVE_GIB"
)
if [[ "$MTP" == "1" ]]; then ARGS+=(--mtp); else ARGS+=(--no-mtp); fi
# Neither client config in this repo sends images; the tower is ~0.84 GiB.
if [[ "${VISION:-0}" != "1" ]]; then ARGS+=(--no-vision); fi
if [[ -n "${REASONING_BUDGET:-}" ]]; then ARGS+=(--reasoning-budget "$REASONING_BUDGET"); fi
if [[ -n "${MLXSERVE_API_KEY:-}" ]]; then ARGS+=(--api-key "$MLXSERVE_API_KEY"); fi
# Sampling defaults for requests that name none, a matched pair with THINKING.
if [[ "$THINKING" == "0" ]]; then
  # shellcheck disable=SC2206
  ARGS+=(${SAMPLING_INSTRUCT})
else
  # shellcheck disable=SC2206
  ARGS+=(${SAMPLING_THINKING})
fi

echo "${SERVER_CMD}: PROFILE=${PROFILE} (${D_BASIS}) ctx=${CTX} mtp=${MTP} kv=${KV_QUANT} thinking=${enable_thinking} id=${MODEL_ALIAS} -> http://${HOST}:${PORT}/v1" >&2
echo "${SERVER_CMD}: the model loads after the port opens; /v1/models shows \"state\":\"ready\" when it is done." >&2

exec "$BIN" "${ARGS[@]}" "$@"
