#!/usr/bin/env bash
# lib/strata.sh -- Strata backend adapter (Linux, one NVIDIA card).
#
# Strata runs Qwen3.8-Flash-Next on one consumer GPU: the busiest experts in VRAM, all of them in RAM, the n-gram table
# read off the SSD. MIT-licensed, version 0.1.x:
#   https://github.com/Niko1221/Strata
#
# Backend contract (docs/adding-a-combination.md):
#   ensure_backend          the pinned checkout, and a Python for its setup
#   backend_fetch_model     the two GGUF files, fetched over many connections and hash-verified; then Strata's own
#                           setup (builds its engine, packs the experts, fetches the MTP draft layer)
#   backend_manifest_extra  the manifest fields the launcher reads
#   backend_profile_table   render profiles.tsv
#   backend_smoke_context   wait for the server, report its context
#   backend_smoke_assert    prove prompt reuse and tool calls
#   strata_sha              version string for the summary
#
# Why the download is here and not Strata's own: its downloader uses one connection per file and ran at 0.2-0.5 MB/s
# on a link that gives 8-20 MB/s over 16 connections (2 Oct 2026). Setup accepts files already in place, so it only
# does the work the files do not.
#
# Everything model-specific is DATA in the combination's config.sh.

declare -F hf_pinned_state >/dev/null || . "$(dirname "${BASH_SOURCE[0]}")/hf.sh"

BACKEND_NEEDS_HF=0
BACKEND_REQUIRED_VARS="MODEL_REPO MODEL_REVISION MODEL_FILES MODEL_SIZES MODEL_SHA256 STRATA_VERSION STRATA_COMMIT STRATA_REPO_URL STRATA_FAMILY STRATA_QUANT STRATA_CONTEXT MIN_DEVICE_MEM_MIB"

# profiles.tsv columns for this backend:
#   ctx           the context the server is started with
#   min_vram_mib  MEASURED floor: the least free VRAM the profile has been seen to start and serve at. This is what
#                 the launcher gates on. Strata sizes its hot-expert cache to what is free (--expert-cache auto), so
#                 the peak below is what it chose when that much was free, never a precondition.
#   need_vram_mib / need_ram_mib   MEASURED peak, recorded for the reader; only the RAM figure gates
#   basis         MEASURED-<date> or ESTIMATED
PROFILE_SCHEMA="name|ctx|min_vram_mib|need_vram_mib|need_ram_mib|basis|summary"

STRATA_INSTALL_REL="${STRATA_INSTALL_REL:-.local/share/awesome-local-ai/strata}"
STRATA_SEG_BYTES="${STRATA_SEG_BYTES:-1073741824}"
STRATA_CONNECTIONS="${STRATA_CONNECTIONS:-16}"
STRATA_DL_PASSES="${STRATA_DL_PASSES:-5}"
STRATA_PYTHON="${STRATA_PYTHON:-3.12}"
STRATA_LOAD_TIMEOUT="${STRATA_LOAD_TIMEOUT:-600}"
STRATA_DIR=""
STRATA_DATA_DIR=""

# The default sampling, as the owner's checkpoint card gives it, for a config that sets none.
STRATA_DEFAULT_SAMPLING="--temperature 1.0 --top-p 0.95 --top-k 20"

backend_manifest_extra() {
  local v
  echo
  echo "# strata backend (lib/strata.sh)"
  for v in STRATA_VERSION STRATA_COMMIT STRATA_CONTEXT STRATA_VRAM_RESERVE_MIB STRATA_MIN_RAM_MIB STRATA_FAMILY STRATA_QUANT OUTPUT_LIMIT; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
  # The checkout, relative to HOME so no username is baked in.
  local rel=""
  case "${STRATA_DIR:-}" in "${HOME}/"*) rel="${STRATA_DIR#"${HOME}/"}" ;; esac
  printf 'STRATA_DIR_REL=%q\n' "$rel"
}

# ---- install --------------------------------------------------------------

ensure_backend() {
  info "Ensuring Strata ${STRATA_VERSION} (commit ${STRATA_COMMIT:0:12})..."
  [[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || err \
    "This Strata combination runs on Linux x86_64 with an NVIDIA card; this is $(uname -s) $(uname -m)."
  need_cmd git || err "git is needed to fetch Strata."
  _strata_checkout_pinned
  _strata_ensure_python
  ok "Strata ${STRATA_VERSION} at ${STRATA_DIR}"
}

# The exact commit, in a folder of its own under HOME. A tag can be moved; a commit can't.
_strata_checkout_pinned() {
  STRATA_DIR="${HOME}/${STRATA_INSTALL_REL}/Strata"
  STRATA_DATA_DIR="${HOME}/${STRATA_INSTALL_REL}/Strata-data"
  if [[ -d "${STRATA_DIR}/.git" ]]; then
    git -C "$STRATA_DIR" fetch -q --tags origin || warn "Could not fetch Strata's repository; using what is here."
  else
    mkdir -p "$(dirname "$STRATA_DIR")"
    git clone "$STRATA_REPO_URL" "$STRATA_DIR" || err "Cloning ${STRATA_REPO_URL} failed. Re-run to retry."
  fi
  local before; before="$(git -C "$STRATA_DIR" rev-parse HEAD 2>/dev/null || true)"
  git -C "$STRATA_DIR" checkout --detach "$STRATA_COMMIT" || err "Strata commit ${STRATA_COMMIT} is not in ${STRATA_REPO_URL}."
  local have; have="$(git -C "$STRATA_DIR" rev-parse HEAD 2>/dev/null || true)"
  [[ "$have" == "$STRATA_COMMIT" ]] || err \
    "Strata commit mismatch: checked out '${have:-unknown}', pinned ${STRATA_COMMIT}.
       Delete ${STRATA_DIR} and re-run."
  # cmake caches the source configuration in its build trees, and one configured for another commit can generate a
  # tree without the engine's own target: on 5 Oct 2026 moving 0.1.36 to 0.1.39 gave "ninja: error: unknown target
  # 'strata'" from a build/ left by the earlier commit. Discard them so Strata's setup configures afresh. Named in
  # full, never a glob.
  if [[ -n "$before" && "$before" != "$STRATA_COMMIT" ]]; then
    info "Strata moved from ${before:0:12} to ${STRATA_COMMIT:0:12}: discarding its build trees."
    rm -rf "${STRATA_DIR:?}/build" "${STRATA_DIR:?}/build-hip" "${STRATA_DIR:?}/build-vision"
  fi
}

# Strata's setup needs a Python 3.10+ that can make a venv with pip; Ubuntu's own lacks ensurepip until python3-venv is
# installed (sudo). A uv-managed CPython has both and touches nothing system-wide.
_strata_ensure_python() {
  need_cmd uv || ensure_uv
  uv python install "$STRATA_PYTHON" >/dev/null 2>&1 || true
  STRATA_PYTHON_BIN="$(uv python find "$STRATA_PYTHON" 2>/dev/null || true)"
  [[ -n "$STRATA_PYTHON_BIN" ]] || err "uv could not provide a Python ${STRATA_PYTHON} for Strata's setup."
}

strata_sha() { printf 'strata %s @ %s' "${STRATA_VERSION:-?}" "${STRATA_COMMIT:0:12}"; }

backend_install_summary() {
  printf '  %-11s %s @ %s, %s\n' "Weights" "$MODEL_REPO" "${MODEL_REVISION:0:8}" "${STRATA_QUANT:-?}"
  printf '  %-11s %s\n' "Context" "${STRATA_CONTEXT:-?} tokens; KV cache int8; MTP drafts on"
  printf '  %-11s %s\n' "Memory" "about 24 GiB VRAM and 43 GiB RAM resident (measured)"
}

# ---- weights --------------------------------------------------------------

_strata_sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
_strata_size_of() { wc -c < "$1" 2>/dev/null | tr -d ' ' || echo 0; }

# strata_download BASE_URL DEST_DIR FILE SIZE SHA256
# FILE, fetched as fixed-size segments over STRATA_CONNECTIONS connections (Hugging Face limits each connection, not
# the link), joined, and refused unless it has the published hash. A file already there with that hash is left alone.
# Resumable: segments already complete are kept between runs. Nothing is deleted by pattern; each segment by its name.
strata_download() {
  local base="$1" dest="$2" file="$3" size="$4" want="$5"
  local segs="${dest}/segs" out="${dest}/${file}" n i pass seg
  mkdir -p "$dest" "$segs"
  if [[ -f "$out" && "$(_strata_size_of "$out")" == "$size" && "$(_strata_sha_of "$out")" == "$want" ]]; then
    ok "${file}: already present and verified."
    return 0
  fi
  n=$(( (size + STRATA_SEG_BYTES - 1) / STRATA_SEG_BYTES ))
  info "Downloading ${file}: ${n} segments over ${STRATA_CONNECTIONS} connections..."
  for (( pass = 1; pass <= STRATA_DL_PASSES; pass++ )); do
    if seq 0 $(( n - 1 )) | URL="${base}/${file}" SEGS="$segs" FILE="$file" SIZE="$size" SEG="$STRATA_SEG_BYTES" \
         xargs -P "$STRATA_CONNECTIONS" -n 1 sh -c '
           i=$1; start=$((i * SEG)); end=$((start + SEG - 1)); [ "$end" -ge "$SIZE" ] && end=$((SIZE - 1))
           want=$((end - start + 1)); seg="$SEGS/$FILE.$(printf %04d "$i")"
           have=$(wc -c < "$seg" 2>/dev/null | tr -d " "); [ "${have:-0}" -eq "$want" ] && exit 0
           curl -s -L --retry 5 --retry-delay 3 -r "$start-$end" -o "$seg" "$URL"
           have=$(wc -c < "$seg" 2>/dev/null | tr -d " "); [ "${have:-0}" -eq "$want" ]' sh; then
      break
    fi
    warn "${file}: pass ${pass} left incomplete segments; retrying."
  done
  : > "${out}.joining"
  for (( i = 0; i < n; i++ )); do
    seg="${segs}/${file}.$(printf %04d "$i")"
    [[ -f "$seg" ]] || { rm -f "${out}.joining"; err "${file}: segment ${i} is missing after ${STRATA_DL_PASSES} passes. Re-run to resume."; }
    cat "$seg" >> "${out}.joining"
  done
  if [[ "$(_strata_size_of "${out}.joining")" != "$size" ]]; then
    rm -f "${out}.joining"; err "${file}: joined to the wrong size (expected ${size}). Re-run to resume."
  fi
  local have; have="$(_strata_sha_of "${out}.joining")"
  if [[ "$have" != "$want" ]]; then
    rm -f "${out}.joining"
    err "sha256 mismatch for ${file}:
         expected ${want}
         got      ${have}"
  fi
  mv "${out}.joining" "$out"
  for (( i = 0; i < n; i++ )); do rm -f "${segs}/${file}.$(printf %04d "$i")"; done
  rmdir "$segs" 2>/dev/null || true
  ok "${file}: downloaded and verified."
}

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME:-$MODEL_REPO} (${MODEL_REPO} @ ${MODEL_REVISION:0:8})..."
  [[ -n "$STRATA_DIR" ]] || _strata_checkout_pinned
  local models="${STRATA_DATA_DIR}/models/${STRATA_QUANT}"
  local base="https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${STRATA_QUANT}"
  _strata_require_disk "$models"
  local f want size
  while read -r want f; do
    [[ -n "$want" ]] || continue
    size="$(printf '%s\n' "$MODEL_SIZES" | awk -v f="$f" '$2 == f {print $1}')"
    [[ -n "$size" ]] || err "No size for ${f} in MODEL_SIZES."
    strata_download "$base" "$models" "$f" "$size" "$want"
  done <<< "$MODEL_SHA256"
  _strata_run_setup
  MODEL_ARTIFACT="${models}/$(printf '%s\n' "$MODEL_FILES" | awk 'NF {print $1; exit}')"
  MODEL_SUBDIR="${STRATA_INSTALL_REL}/Strata-data/models/${STRATA_QUANT}"
  MODEL_FILE="$(basename "$MODEL_ARTIFACT")"
  MODEL_CACHE_ENV_VAR=""
  MMPROJ=""; MTP_HEAD=""
}

_strata_require_disk() {
  local dir="$1" need_kb="${MODEL_DISK_KB:-0}" have_kb free_kb
  (( need_kb > 0 )) || return 0
  mkdir -p "$dir"
  have_kb="$(du -sk "${STRATA_DATA_DIR}" 2>/dev/null | awk '{print $1}')"; have_kb="${have_kb:-0}"
  free_kb="$(df -k "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"; free_kb="${free_kb:-0}"
  if (( free_kb + have_kb < need_kb )); then
    err "Not enough disk for ${MODEL_REPO}: needs ~$(( need_kb / 1048576 )) GiB in total,
       $(( have_kb / 1048576 )) GiB already there, $(( free_kb / 1048576 )) GiB free on that volume."
  fi
}

# Strata's own setup: builds the engine, packs the experts and fetches the MTP draft layer. It finds the files in the
# data folder and does not download them again. Run with its own Python and the newer cmake in its own virtualenv first
# on PATH (Ubuntu 22.04's cmake is 3.22).
_strata_run_setup() {
  info "Running Strata's setup (builds its engine; a few minutes)..."
  local py_dir; py_dir="$(dirname "$STRATA_PYTHON_BIN")"
  ( cd "$STRATA_DIR" && PATH="${STRATA_DIR}/.venv/bin:${py_dir}:${PATH}" \
      ./setup.sh --yes --family "$STRATA_FAMILY" --model "$STRATA_QUANT" --context "$STRATA_CONTEXT" \
                 --data-dir "$STRATA_DATA_DIR" --no-start ) \
    || err "Strata's setup failed. Re-run to retry; it keeps what it has built."
  [[ -x "${STRATA_DIR}/engine/strata" ]] || err "Strata's setup finished but ${STRATA_DIR}/engine/strata is not there."
}

# ---- the server's configuration -------------------------------------------

# strata_run_config SETUP_JSON OUT_JSON CONTEXT VRAM_RESERVE_MIB LOG MODEL_NAME
# The configuration the benchmark runs, derived from the one setup wrote and never written over it: the context, a VRAM
# reserve, the served name, a log the harness can read, and the checkpoint's sampling as the defaults for a request that
# leaves them out. Safe to run again: the reserve is never added twice.
strata_run_config() {
  local src="$1" dst="$2" ctx="$3" reserve="$4" log="$5" name="$6"
  python3 - "$src" "$dst" "$ctx" "$reserve" "$log" "$name" "${SAMPLING_THINKING:-$STRATA_DEFAULT_SAMPLING}" <<'PY'
import json, sys
src, dst, ctx, reserve, log, name, sampling = sys.argv[1:8]
cfg = json.load(open(src))
args = list(cfg["args"])
def drop(flag):
    while flag in args:
        i = args.index(flag)
        del args[i:i + 2]
drop("--max-context"); drop("--vram-reserve-mib")
args += ["--max-context", ctx, "--vram-reserve-mib", reserve]
cfg["args"] = args
cfg["model_name"] = name
cfg["log"] = log
words = sampling.split()
want = {"--temperature": ("temperature", float), "--top-p": ("top_p", float), "--top-k": ("top_k", int)}
cfg["sampling"] = {key: cast(words[words.index(flag) + 1]) for flag, (key, cast) in want.items() if flag in words}
json.dump(cfg, open(dst, "w"), indent=1)
PY
}

backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-8s %7s ctx  vram %s-%-6s ram %-6s %-19s %s\n", $1, $2, $3, $4, $5, $6, $7
  }' "$1"
}

# /v1/models answers once the model is loaded.
backend_smoke_context() {
  local port="$1" i
  for (( i = 0; i < STRATA_LOAD_TIMEOUT; i += 2 )); do
    if curl -sf --max-time 5 "http://127.0.0.1:${port}/v1/models" >/dev/null 2>&1; then
      curl -sf --max-time 5 "http://127.0.0.1:${port}/v1/models" \
        | python3 -c 'import sys,json; print((json.load(sys.stdin)["data"][0].get("meta") or {}).get("n_ctx","?"))' 2>/dev/null || printf '?'
      return 0
    fi
    sleep 2
  done
  printf '?'
}

backend_smoke_assert() {
  local port="$2" base="http://127.0.0.1:${2}" body cached tool
  body='{"messages":[{"role":"system","content":"You are a terse assistant. This system prompt is long enough that a repeated request has a prefix worth caching: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega."},{"role":"user","content":"Say yes."}],"max_tokens":8,"reasoning_effort":"none","temperature":0}'
  curl -sf --max-time 300 "${base}/v1/chat/completions" -H 'Content-Type: application/json' -d "$body" >/dev/null 2>&1 || true
  cached="$(curl -sf --max-time 300 "${base}/v1/chat/completions" -H 'Content-Type: application/json' -d "$body" 2>/dev/null \
    | python3 -c 'import sys,json;u=json.load(sys.stdin).get("usage") or {};print((u.get("prompt_tokens_details") or {}).get("cached_tokens",0))' 2>/dev/null || echo 0)"
  if [[ "${cached:-0}" =~ ^[0-9]+$ ]] && (( cached > 0 )); then
    ok "Prefix cache: a repeated prompt reused ${cached} cached tokens."
    SMOKE_ACC="prefix cache reused ${cached} tokens"
  else
    warn "Prefix cache: a repeated prompt reported no cached tokens (cached_tokens=${cached:-?})."
  fi
  tool="$(curl -sf --max-time 300 "${base}/v1/chat/completions" -H 'Content-Type: application/json' -d '{
    "messages":[{"role":"user","content":"What is the weather in Paris? Use the tool."}],
    "tools":[{"type":"function","function":{"name":"get_weather","description":"Current weather for a city",
      "parameters":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}}],
    "max_tokens":256,"reasoning_effort":"none","temperature":0}' 2>/dev/null \
    | python3 -c '
import sys, json
c = (json.load(sys.stdin).get("choices") or [{}])[0]
t = ((c.get("message") or {}).get("tool_calls") or [])
print(t[0]["function"]["name"] if t else "none")' 2>/dev/null || echo none)"
  if [[ "$tool" == "get_weather" ]]; then
    ok "Tool calling: the model returned a structured get_weather call."
    SMOKE_ACC="${SMOKE_ACC:+${SMOKE_ACC}; }tool calls OK"
  else
    warn "Tool calling: no structured tool call came back (got: ${tool})."
  fi
}
