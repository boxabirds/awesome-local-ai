#!/usr/bin/env bash
# local-ai-strata-server -- generic Strata launcher for awesome-local-ai.
#
# Everything that varies is read at run time from the install manifest the installer wrote:
#   $ROOT/install.env    key=value manifest (STRATA_* fields from lib/strata.sh)
#   $ROOT/profiles.tsv   name|ctx|need_vram_mib|need_ram_mib|basis|summary
#   $ROOT/help.txt       combination-specific prose for --help
# No machine-specific paths: the install root and Strata's checkout resolve from $HOME at run time.
#
# It derives the run configuration from the one Strata's setup wrote (the context, a VRAM reserve, the served name, the
# checkpoint's sampling) into $ROOT/strata-run.json and leaves setup's own file alone, then `exec`s Strata's server, so
# a SIGTERM from the harness reaches it.

set -euo pipefail

if [[ -z "${HOME:-}" || -z "${LOCAL_AI_INSTALL_REL:-}" ]]; then
  echo "local-ai-strata-server: run the per-combination command (e.g. strata-qwen38-flash-next-server)." >&2
  exit 1
fi
ROOT="${LOCAL_AI_ROOT:-$HOME/$LOCAL_AI_INSTALL_REL}"
[[ -f "$ROOT/install.env" ]] || {
  echo "local-ai-strata-server: no install manifest at $ROOT/install.env; re-run the install script." >&2
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
  ${SERVER_CMD} [--help]
  PROFILE=<name> ${SERVER_CMD}

PROFILES                                          (default: ${DEFAULT_PROFILE})
HDR
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-8s %7s ctx  vram %s-%-6s ram %-6s %-19s %s\n", $1, $2, $3, $4, $5, $6, $7
  }' "$ROOT/profiles.tsv"
  echo
  [[ -f "$ROOT/help.txt" ]] && cat "$ROOT/help.txt"
}
case "${1:-}" in -h|--help|help) show_help; exit 0 ;; esac

STRATA_DIR="$HOME/${STRATA_DIR_REL:-}"
PY="$STRATA_DIR/.venv/bin/python"
[[ -n "${STRATA_DIR_REL:-}" && -x "$PY" && -f "$STRATA_DIR/serve/server.py" ]] || {
  echo "${SERVER_CMD}: no Strata checkout at ${STRATA_DIR}; re-run the install script." >&2
  exit 1; }
# The file setup writes is named for the quant, and for the family too when it is not the default one (the Unsloth
# family's is strata-unsloth-ud-iq4_xs.json); a combination that needs another name says so.
SETUP_CONFIG="$STRATA_DIR/${STRATA_SETUP_CONFIG:-strata-$(printf '%s' "$STRATA_QUANT" | tr '[:upper:]' '[:lower:]').json}"
[[ -f "$SETUP_CONFIG" ]] || {
  echo "${SERVER_CMD}: Strata's setup has not written ${SETUP_CONFIG}; re-run the install script." >&2
  exit 1; }

PROFILE="${PROFILE:-$DEFAULT_PROFILE}"
row="$(profile_row "$PROFILE")" || {
  echo "${SERVER_CMD}: unknown PROFILE '$PROFILE'; '${SERVER_CMD} --help' lists them." >&2
  exit 1; }
IFS='|' read -r _ D_CTX MIN_VRAM NEED_VRAM NEED_RAM _ _ <<< "$row"

PORT="${PORT:-${DEFAULT_PORT:-8080}}"
HOST="${HOST:-127.0.0.1}"
CTX="${CTX:-$D_CTX}"
MODEL_ALIAS="${MODEL_ALIAS:-$MODEL_ALIAS_DEFAULT}"

# Strata has no API key unless one is configured; a non-loopback bind would hand the model to the network.
case "$HOST" in
  127.0.0.1|localhost|::1) ;;
  *) echo "${SERVER_CMD}: HOST=${HOST} is not loopback, and this server has no API key. Refusing." >&2; exit 1 ;;
esac

# One model server at a time: this one holds about 24 GiB of VRAM and 43 GiB of RAM. Another is a refusal, not a
# warning. The process list is captured before it is filtered, so the filter's own text is not in it.
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

# Pre-flight against the floor the profile was measured at, never its peak: Strata sizes its hot-expert cache to the
# VRAM that is free, so with less it runs with a smaller cache rather than failing. Gating on the peak refused a
# configuration that works (A-045, 5 Oct 2026).
if command -v nvidia-smi >/dev/null 2>&1; then
  free_vram="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' || true)"
  if [[ "${free_vram:-}" =~ ^[0-9]+$ ]] && (( free_vram < MIN_VRAM )); then
    echo "${SERVER_CMD}: ${free_vram} MiB of VRAM is free; profile '${PROFILE}' needs at least ${MIN_VRAM} MiB. Stop what is using the GPU." >&2
    exit 1
  fi
fi
avail_ram="$(free -m 2>/dev/null | awk '/^Mem:/ {print $NF}' || true)"
min_ram="${STRATA_MIN_RAM_MIB:-$NEED_RAM}"
if [[ "${avail_ram:-}" =~ ^[0-9]+$ ]] && (( avail_ram < min_ram )); then
  echo "${SERVER_CMD}: ${avail_ram} MiB of RAM is available; this model needs ${min_ram} MiB. Free some first." >&2
  exit 1
fi

RUN_CONFIG="$ROOT/strata-run.json"
python3 - "$SETUP_CONFIG" "$RUN_CONFIG" "$CTX" "${STRATA_VRAM_RESERVE_MIB:-0}" "$ROOT/strata-engine.log" "$MODEL_ALIAS" "${SAMPLING_THINKING:---temperature 1.0 --top-p 0.95 --top-k 20}" "${STRATA_ENV:-}" <<'PY'
import json, sys
src, dst, ctx, reserve, log, name, sampling, env = sys.argv[1:9]
cfg = json.load(open(src))
args = list(cfg["args"])
def drop(flag):
    while flag in args:
        i = args.index(flag)
        del args[i:i + 2]
drop("--max-context"); drop("--vram-reserve-mib")
args += ["--max-context", ctx]
if reserve not in ("", "0"):
    args += ["--vram-reserve-mib", reserve]
cfg["args"] = args
cfg["model_name"] = name
cfg["log"] = log
words = sampling.split()
want = {"--temperature": ("temperature", float), "--top-p": ("top_p", float), "--top-k": ("top_k", int)}
cfg["sampling"] = {key: cast(words[words.index(flag) + 1]) for flag, (key, cast) in want.items() if flag in words}
# The combination's engine switches, beside what setup put in the environment (the hipBLASLt table on a Strix Halo).
merged = dict(cfg.get("env") or {})
merged.update(pair.split("=", 1) for pair in env.split() if "=" in pair)
if merged:
    cfg["env"] = merged
json.dump(cfg, open(dst, "w"), indent=1)
PY
# pi sends no reasoning effort, and Qwen3.8's template default is xhigh; Strata applies this to requests that name none.
printf '{"reasoning_effort": "%s"}\n' "${REASONING_EFFORT_DEFAULT:-low}" > "$ROOT/strata-run.shared-settings.json"

# Strata's engine writes its one line per request (prompt tokens, reused and read, tokens generated, drafts accepted) to
# its own log file, not to the server's output. The harness reads draft figures from the server's output, so the engine
# log is followed into it; the follower ends with the server (the pid is the one `exec` keeps).
ENGINE_LOG="$ROOT/strata-engine.log"
: >> "$ENGINE_LOG"
tail -q -n 0 -F --pid=$$ "$ENGINE_LOG" &

echo "${SERVER_CMD}: PROFILE=${PROFILE} ctx=${CTX} id=${MODEL_ALIAS} -> http://127.0.0.1:${PORT}/v1" >&2
cd "$STRATA_DIR"
exec "$PY" "$STRATA_DIR/serve/server.py" --engine strata --config "$RUN_CONFIG" --host 127.0.0.1 --port "$PORT" "$@"
