#!/usr/bin/env bash
# lib/mlxserve.sh -- mlx-serve backend adapter (Mac-only, native Zig + MLX).
#
# mlx-serve is David Dalcu's native inference server for Apple silicon:
#   https://github.com/ddalcu/mlx-serve   (MIT; bundles Apache-2.0 code, see its NOTICE)
#   https://mlxserve.com
# NOT the unrelated Python package called `mlx-serve` on PyPI.
#
# Backend contract (docs/adding-a-combination.md):
#   ensure_backend          find or install a pinned mlx-serve binary
#   backend_fetch_model     the model pack, at a pinned revision, hash-verified
#   backend_profile_table   render profiles.tsv
#   backend_smoke_context   wait for the model to finish loading, report its context
#   backend_smoke_assert    prove MTP state, prefix-cache reuse and tool calls
#   mlxserve_sha            version string for the summary
#
# How this differs from the other backends:
#
#   1. It ships as a signed, prebuilt binary (a GitHub release tarball), not a
#      PyPI package and not a container. Nothing is compiled. An mlx-serve that
#      is already installed (Homebrew, or on PATH) is used when it is new
#      enough; otherwise the pinned release is fetched, checked against its
#      published sha256, and unpacked under $HOME -- never system-wide.
#   2. The weights are fetched at a pinned Hugging Face commit into mlx-serve's
#      own model store (~/.mlx-serve/models/<org>/<repo>), so the MLX-Serve app
#      sees the same copy. Verification is the shared lib/hf.sh contract.
#
# Everything model-specific is DATA in the combination's config.sh.

# Pinned-revision weight helpers (hf_pinned_state & co). bootstrap.sh has
# already sourced this; loading it here too keeps the file usable on its own.
declare -F hf_pinned_state >/dev/null || . "$(dirname "${BASH_SOURCE[0]}")/hf.sh"

BACKEND_NEEDS_BUILD_TOOLS=0
# The hf CLI is needed only to fill mlx-serve's own store, which lives outside
# the install root, so this adapter ensures it itself (as lib/sglang.sh does).
BACKEND_NEEDS_HF=0
BACKEND_REQUIRED_VARS="MODEL_REPO MODEL_REVISION MODEL_WEIGHTS_DIR MLXSERVE_VERSION MLXSERVE_TARBALL_SHA256 MIN_DEVICE_MEM_MIB"

# profiles.tsv columns for this backend:
#   ctx         --ctx-size, and what the client's limit.context must match
#   mtp         1 = --mtp (force the pack's native MTP head on), 0 = --no-mtp
#   kv_quant    --kv-quant off|4|8
#   max_tokens  --max-tokens (the default for a request that names none)
#   need_mib    server footprint the launcher pre-flights against (see the file)
#   basis       where the row came from: MEASURED-<date> or ESTIMATED
PROFILE_SCHEMA="name|ctx|mtp|kv_quant|max_tokens|need_mib|basis|summary"

# The KV cache type is a profile column here, not a safety switch.
SAFE_KV_TYPES="${SAFE_KV_TYPES:-n/a}"

# mlx-serve's own model store (docs/cli.md: "Models land in a shared
# ~/.mlx-serve/models store the MLX Core app uses too"). Relative to $HOME.
MLXSERVE_MODEL_CACHE_REL="${MLXSERVE_MODEL_CACHE_REL:-.mlx-serve/models}"
# Where a pinned release is unpacked when no suitable mlx-serve is installed.
MLXSERVE_INSTALL_REL="${MLXSERVE_INSTALL_REL:-.local/share/awesome-local-ai/mlx-serve}"
MLXSERVE_TARBALL_NAME="mlx-serve-bin-macos-arm64.tar.gz"
# mlx-serve's README: "Needs macOS 26.2+ on Apple Silicon" (build.zig pins the
# same floor as os_version_min).
MLXSERVE_MIN_MACOS="${MLXSERVE_MIN_MACOS:-26.2}"

# A ~70 GiB pack loads from SSD before /v1/models reports it ready. /health
# answers 200 as soon as the socket is bound, so it is not a readiness signal
# (src/server.zig: GET /health always returns {"status":"ok"}).
MLXSERVE_LOAD_TIMEOUT="${MLXSERVE_LOAD_TIMEOUT:-900}"

# The native MTP head ships inside the pack's shards (language_model.mtp.*).
BACKEND_MTP_INTERNAL=1

# The generic smoke request asks for "OK"; Qwen3.8 thinking could spend the
# whole 256-token budget before any content appears. mlx-serve reads a
# top-level `enable_thinking` on chat/completions (docs/api.md).
if [[ -z "${SMOKE_REQUEST_EXTRA:-}" ]]; then
  SMOKE_REQUEST_EXTRA='"enable_thinking":false'
fi

# A user may point at a specific binary with MLXSERVE_BIN=...; keep that
# before the global is reset below.
MLXSERVE_BIN_OVERRIDE="${MLXSERVE_BIN_OVERRIDE:-${MLXSERVE_BIN:-}}"
MLXSERVE_BIN=""; MLXSERVE_BIN_VERSION=""; MLXSERVE_BIN_ORIGIN=""
MLXSERVE_WEIGHTS_VERIFIED=""

# Everything the launcher needs that the generic manifest does not carry.
backend_manifest_extra() {
  local v
  echo
  echo "# mlxserve backend (lib/mlxserve.sh)"
  for v in MLXSERVE_BIN_REL MLXSERVE_BIN_SYS MLXSERVE_VERSION MLXSERVE_OS_RESERVE_GIB \
           MLXSERVE_PREFLIGHT_HEADROOM_MIB; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
}

# ---- install --------------------------------------------------------------

ensure_backend() {
  MIN_MLXSERVE_VERSION="${MIN_MLXSERVE_VERSION:-$MLXSERVE_VERSION}"
  info "Ensuring mlx-serve >= ${MIN_MLXSERVE_VERSION}..."
  _mlxserve_require_macos
  _mlxserve_resolve_binary
  ok "mlx-serve ${MLXSERVE_BIN_VERSION} (${MLXSERVE_BIN_ORIGIN}) at ${MLXSERVE_BIN}"

  # The runtime resolves the binary from $HOME when it lives there; anything
  # else (Homebrew) is a system path and names no user.
  MLXSERVE_BIN_REL=""; MLXSERVE_BIN_SYS=""
  case "$MLXSERVE_BIN" in
    "${HOME}/"*) MLXSERVE_BIN_REL="${MLXSERVE_BIN#"${HOME}/"}" ;;
    *)           MLXSERVE_BIN_SYS="$MLXSERVE_BIN" ;;
  esac
}

_mlxserve_require_macos() {
  [[ "$(uname -s)" == "Darwin" ]] || err "mlx-serve runs on macOS only."
  local have; have="$(sw_vers -productVersion 2>/dev/null || echo 0)"
  version_ge "$have" "$MLXSERVE_MIN_MACOS" || err \
    "mlx-serve needs macOS ${MLXSERVE_MIN_MACOS}+ (its README and build floor); this Mac runs ${have}.
       Update macOS, then re-run this installer."
}

# First line of `mlx-serve --version` is "mlx-serve <version>" (src/version.zig).
# --version prints engine versions and exits without booting the server.
_mlxserve_version_of() {
  "$1" --version 2>/dev/null | head -1 | awk '$1=="mlx-serve" {print $2}' | sed 's/^v//'
}

# Preference: an explicit MLXSERVE_BIN, then whatever `mlx-serve` is on PATH,
# then this repo's pinned copy -- each only if it is new enough. An installed
# mlx-serve that is too old is left exactly as it is (it may be the user's
# Homebrew install or serve something else); the pinned release is used
# alongside it instead.
_mlxserve_resolve_binary() {
  local c v
  for c in "${MLXSERVE_BIN_OVERRIDE:-}" "$(command -v mlx-serve 2>/dev/null || true)"; do
    [[ -n "$c" && -x "$c" ]] || continue
    v="$(_mlxserve_version_of "$c")"
    if [[ -n "$v" ]] && version_ge "$v" "$MIN_MLXSERVE_VERSION"; then
      MLXSERVE_BIN="$c"; MLXSERVE_BIN_VERSION="$v"; MLXSERVE_BIN_ORIGIN="already installed"
      return 0
    fi
    warn "Found mlx-serve ${v:-of unknown version} at ${c}; this combination needs >= ${MIN_MLXSERVE_VERSION}."
    warn "  Leaving it untouched and using a pinned ${MLXSERVE_VERSION} under \$HOME instead."
  done
  _mlxserve_install_pinned
}

_mlxserve_pinned_dir() { printf '%s/%s/v%s' "$HOME" "$MLXSERVE_INSTALL_REL" "$MLXSERVE_VERSION"; }

_mlxserve_find_in() {
  find "$1" -maxdepth 3 -type f -name mlx-serve -perm -u+x 2>/dev/null | head -1
}

# Idempotent: an unpacked copy of this exact version is reused without any
# network access. Otherwise the tarball is fetched (resuming a partial file),
# checked against the sha256 GitHub publishes for the release asset, and only
# then unpacked.
_mlxserve_install_pinned() {
  local dir bin url part have
  dir="$(_mlxserve_pinned_dir)"
  bin="$(_mlxserve_find_in "$dir")"
  if [[ -n "$bin" ]] && [[ "$(_mlxserve_version_of "$bin")" == "$MLXSERVE_VERSION" ]]; then
    MLXSERVE_BIN="$bin"; MLXSERVE_BIN_VERSION="$MLXSERVE_VERSION"; MLXSERVE_BIN_ORIGIN="pinned, already unpacked"
    return 0
  fi

  need_cmd curl || err "curl is required to fetch mlx-serve."
  url="${MLXSERVE_TARBALL_URL:-https://github.com/ddalcu/mlx-serve/releases/download/v${MLXSERVE_VERSION}/${MLXSERVE_TARBALL_NAME}}"
  mkdir -p "$dir"
  part="${dir}/${MLXSERVE_TARBALL_NAME}"
  info "Fetching mlx-serve ${MLXSERVE_VERSION} (${MLXSERVE_TARBALL_NAME})..."
  curl -fL --retry 3 -C - -o "$part" "$url" \
    || { rm -f "$part"; err "Download failed: ${url}. Re-run to retry."; }

  have="$(shasum -a 256 "$part" | cut -d' ' -f1)"
  if [[ "$have" != "$MLXSERVE_TARBALL_SHA256" ]]; then
    rm -f "$part"
    err "sha256 mismatch for ${MLXSERVE_TARBALL_NAME} ${MLXSERVE_VERSION}:
         expected ${MLXSERVE_TARBALL_SHA256}
         got      ${have}
       The file was deleted; re-run to fetch it again."
  fi
  ok "sha256 OK: ${MLXSERVE_TARBALL_NAME}"

  tar -xzf "$part" -C "$dir" || err "Could not unpack ${part}."
  rm -f "$part"
  bin="$(_mlxserve_find_in "$dir")"
  [[ -n "$bin" ]] || err "No mlx-serve executable inside the ${MLXSERVE_VERSION} tarball (unpacked in ${dir})."
  have="$(_mlxserve_version_of "$bin")"
  [[ "$have" == "$MLXSERVE_VERSION" ]] || err \
    "The unpacked binary reports version '${have:-nothing}', expected ${MLXSERVE_VERSION}.
       Run it directly to see why:  ${bin} --version"
  MLXSERVE_BIN="$bin"; MLXSERVE_BIN_VERSION="$have"; MLXSERVE_BIN_ORIGIN="pinned release, sha256-verified"
}

backend_install_summary() {
  printf '  %-11s %s @ %s\n' "Weights" "$MODEL_REPO" "${MODEL_REVISION:0:8}"
  printf '  %-11s %s\n' "Verified" "${MLXSERVE_WEIGHTS_VERIFIED:-?}"
  printf '  %-11s %s\n' "MTP head" "inside the pack; per profile (--mtp / --no-mtp)"
  printf '  %-11s %s\n' "N-gram" "ngram_table.bin, mmapped by mlx-serve (not wired, per the pack's card)"
  printf '  %-11s %s\n' "Vision" "in the pack, served off by default (VISION=1 to enable)"
  printf '  %-11s %s\n' "Store" "\$HOME/${MODEL_SUBDIR:-?}"
}

mlxserve_sha() { printf '%s (%s)' "${MLXSERVE_BIN_VERSION:-?}" "${MLXSERVE_BIN_ORIGIN:-?}"; }

# ---- weights --------------------------------------------------------------

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME} (${MODEL_REPO} @ ${MODEL_REVISION:0:8})..."

  local store="${MLXSERVE_MODEL_STORE:-${HOME}/${MLXSERVE_MODEL_CACHE_REL}}"
  local dir="${store}/${MODEL_WEIGHTS_DIR}"
  mkdir -p "$dir"

  if [[ "$(hf_pinned_state "$dir")" == "valid" ]]; then
    ok "Already present and verified at this revision -- not re-downloading."
  else
    _mlxserve_require_disk "$dir"
    ensure_hf
    info "Downloading ${MODEL_REPO} at ${MODEL_REVISION} (${MODEL_APPROX_SIZE:-large})..."
    info "  This resumes if interrupted -- re-run the installer to continue."
    hf download "$MODEL_REPO" --revision "$MODEL_REVISION" --local-dir "$dir" \
      || err "Download failed for ${MODEL_REPO}@${MODEL_REVISION}. Re-run to resume."

    local gap f
    if ! gap="$(hf_shards_present "$dir")"; then
      err "${MODEL_REPO} downloaded but is incomplete: ${gap}. Re-run to resume."
    fi
    # Not in the safetensors index, so the shard check cannot see them; the
    # n-gram table in particular is 32 GB and the model is wrong without it.
    for f in ${MLXSERVE_REQUIRED_FILES:-config.json generation_config.json chat_template.jinja tokenizer_config.json tokenizer.json ngram_table.bin}; do
      [[ -s "${dir}/${f}" ]] || err "${MODEL_REPO} is missing ${f} after download. Re-run to resume."
    done
    hf_verify_sha256 "$dir"
    hf_write_marker "$dir"
    ok "Downloaded and verified: ${MODEL_WEIGHTS_DIR}"
  fi

  MLXSERVE_WEIGHTS_VERIFIED="$(hf_marker_summary "$dir")"
  MODEL_ARTIFACT="$dir"
  # The runtime resolves $HOME/<MODEL_SUBDIR>/<MODEL_FILE>; nothing absolute is
  # baked. A store outside $HOME needs MODEL=<pack dir> at run time.
  case "$dir" in
    "${HOME}/"*) MODEL_SUBDIR="$(dirname "${dir#"${HOME}/"}")" ;;
    *) MODEL_SUBDIR="$(dirname "$dir")"
       warn "The model store is outside \$HOME; the launcher will need MODEL=${dir}." ;;
  esac
  MODEL_CACHE_ENV_VAR=""
  MMPROJ=""; MTP_HEAD=""
}

# Refuse before a 100 GB download, not 60 GB into it. What is already in the
# directory counts toward the total, so a resume needs only the remainder.
_mlxserve_require_disk() {
  local dir="$1" need_kb have_kb free_kb
  need_kb="${MODEL_DISK_KB:-0}"
  (( need_kb > 0 )) || return 0
  have_kb="$(du -sk "$dir" 2>/dev/null | awk '{print $1}')"; have_kb="${have_kb:-0}"
  free_kb="$(df -k "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"; free_kb="${free_kb:-0}"
  if (( free_kb + have_kb < need_kb )); then
    err "Not enough disk for ${MODEL_REPO}: needs ~$(( need_kb / 1048576 )) GiB in total,
       $(( have_kb / 1048576 )) GiB already there, $(( free_kb / 1048576 )) GiB free on that volume.
       Free space, or set MLXSERVE_MODEL_STORE to a bigger volume and re-run."
  fi
}

# ---- serving --------------------------------------------------------------

backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-8s %7s ctx  mtp %-3s  kv %-3s  max %-6s  %-9s %s\n", $1, $2, ($3=="1"?"on":"off"), $4, $5, $7, $8
  }' "$1"
}

# /v1/models lists the model with "state":"ready" and its context_length once
# loading has finished (src/server.zig). Wait for that, then report it.
backend_smoke_context() {
  local port="$1" i out
  for (( i = 0; i < MLXSERVE_LOAD_TIMEOUT; i += 2 )); do
    out="$(curl -sf --max-time 5 "http://127.0.0.1:${port}/v1/models" 2>/dev/null | python3 -c '
import sys, json
for m in json.load(sys.stdin).get("data") or []:
    if m.get("state") == "ready" or m.get("loaded") is True:
        print(m.get("context_length") or (m.get("meta") or {}).get("context_length") or "?")
        break
' 2>/dev/null || true)"
    [[ -n "$out" ]] && { printf '%s' "$out"; return 0; }
    sleep 2
  done
  printf '?'
}

# Three things a coding agent depends on, each read from the server itself:
#
#   * MTP: GET /props reports settings.mtp.{loaded,default_on} (src/server.zig).
#     MoE targets default MTP off unless --mtp is passed, so a profile that
#     wants it and a server that silently did not load it must be caught.
#   * prefix cache: a repeated prompt should report
#     usage.prompt_tokens_details.cached_tokens > 0 (docs/api.md). Without it
#     every agent turn re-prefills the whole conversation.
#   * tool calls: OpenCode and pi drive the model through tools; a request with
#     one tool must come back as a structured tool_calls entry, not text.
backend_smoke_assert() {
  local port="$2" base="http://127.0.0.1:${2}" props mtp
  props="$(curl -sf --max-time 10 "${base}/props" 2>/dev/null || true)"
  mtp="$(printf '%s' "$props" | python3 -c '
import sys, json
s = (json.load(sys.stdin).get("settings") or {})
m = s.get("mtp") or {}
print("%s %s %s" % (m.get("loaded"), m.get("default_on"), s.get("version", "?")))
' 2>/dev/null || echo "? ? ?")"
  local loaded default_on ver
  read -r loaded default_on ver <<< "$mtp"
  case "$loaded:$default_on" in
    true:true)  SMOKE_ACC="native MTP head loaded and on by default"
                ok "MTP: head loaded, on for requests by default (mlx-serve ${ver})." ;;
    true:false) SMOKE_ACC="MTP head loaded, off by default"
                warn "MTP head loaded but OFF by default (profile without MTP, or --mtp not honoured)." ;;
    *)          warn "Could not confirm MTP from /props (loaded=${loaded}, default_on=${default_on})." ;;
  esac

  local body r1 cached
  body='{"messages":[{"role":"system","content":"You are a terse assistant. Answer with one word. This system prompt is deliberately a little long so that a repeated request has a prefix worth caching: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega."},{"role":"user","content":"Say yes."}],"max_tokens":8,"enable_thinking":false,"temperature":0}'
  r1="$(curl -sf --max-time 300 "${base}/v1/chat/completions" -H 'Content-Type: application/json' -d "$body" 2>/dev/null || true)"
  cached="$(curl -sf --max-time 300 "${base}/v1/chat/completions" -H 'Content-Type: application/json' -d "$body" 2>/dev/null \
    | python3 -c 'import sys,json;u=json.load(sys.stdin).get("usage") or {};print((u.get("prompt_tokens_details") or {}).get("cached_tokens",0))' 2>/dev/null || echo 0)"
  if [[ -n "$r1" ]] && [[ "${cached:-0}" =~ ^[0-9]+$ ]] && (( cached > 0 )); then
    ok "Prefix cache: a repeated prompt reused ${cached} cached tokens."
    SMOKE_ACC="${SMOKE_ACC:+${SMOKE_ACC}; }prefix cache reused ${cached} tokens"
  else
    warn "Prefix cache: a repeated prompt reported no cached tokens (cached_tokens=${cached:-?})."
    warn "  Agent turns may re-prefill the whole conversation; see ${INSTALL_ROOT:-the install}/smoke.log."
  fi

  local tool
  tool="$(curl -sf --max-time 300 "${base}/v1/chat/completions" -H 'Content-Type: application/json' -d '{
    "messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."}],
    "tools":[{"type":"function","function":{"name":"get_weather","description":"Current weather for a city",
      "parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],
    "max_tokens":256,"enable_thinking":false,"temperature":0}' 2>/dev/null \
    | python3 -c '
import sys, json
c = (json.load(sys.stdin).get("choices") or [{}])[0]
t = ((c.get("message") or {}).get("tool_calls") or [])
print(t[0]["function"]["name"] if t else "none")
' 2>/dev/null || echo none)"
  if [[ "$tool" == "get_weather" ]]; then
    ok "Tool calling: the model returned a structured get_weather call."
    SMOKE_ACC="${SMOKE_ACC:+${SMOKE_ACC}; }tool calls OK"
  else
    warn "Tool calling: no structured tool call came back (got: ${tool})."
    warn "  OpenCode and pi cannot work without tool calls. Check ${INSTALL_ROOT:-the install}/smoke.log."
  fi
}
