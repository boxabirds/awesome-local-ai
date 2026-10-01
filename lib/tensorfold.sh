#!/usr/bin/env bash
# lib/tensorfold.sh -- TensorFold backend adapter (Apple silicon, MLX).
#
# TensorFold is an OpenAI-compatible server built around exact speculative decoding:
#   https://github.com/ashhart/TensorFold   (Apache-2.0 from 0.6.0; MIT before)
#
# Backend contract (docs/adding-a-combination.md):
#   ensure_backend          install the pinned TensorFold commit into its own venv under $HOME
#   backend_fetch_model     the checkpoint, at a pinned Hugging Face revision, hash-verified
#   backend_profile_table   render profiles.tsv
#   backend_smoke_context   wait for the model to load, report its context
#   backend_smoke_assert    prove prefix-cache reuse and tool calls
#   tensorfold_sha          version string for the summary
# and, shared with tools/tensorfold-check/run-checks.sh so both start the same server:
#   tensorfold_serve_argv   the `tensorfold serve` arguments for a profile
#   tensorfold_serve_env    the environment the server runs with
#
# How it is installed: TensorFold publishes no release files, only git tags, and installs with pip from git
# (its README and release notes: `pip install -U git+https://github.com/ashhart/TensorFold.git@v0.6.0`). Here it goes
# into a uv-made venv of its own at ~/.local/share/awesome-local-ai/tensorfold/v<version>/venv, from the exact commit
# the release tag points at (a tag can be moved; a commit can't), and the installed package's own record of the
# commit it was built from (direct_url.json) must match before it is used. Its dependencies (mlx, mlx-lm,
# huggingface-hub, numpy) are resolved within the ranges its pyproject.toml pins; the resolved set is written beside
# the venv as requirements.lock.txt. Nothing is installed system-wide.
#
# Everything model-specific is DATA in the combination's config.sh.

declare -F hf_pinned_state >/dev/null || . "$(dirname "${BASH_SOURCE[0]}")/hf.sh"

BACKEND_NEEDS_BUILD_TOOLS=0
# The weights go to a store outside the install root, so this adapter ensures the hf CLI itself (as mlxserve does).
BACKEND_NEEDS_HF=0
BACKEND_REQUIRED_VARS="MODEL_REPO MODEL_REVISION TENSORFOLD_VERSION TENSORFOLD_COMMIT TENSORFOLD_PYTHON MIN_DEVICE_MEM_MIB"

# profiles.tsv columns for this backend:
#   ctx         fit = no --context: TensorFold fits the window to what still keeps a prompt for the next turn
#               (its startup line says how many tokens); a number = --context N
#   drafts      1 = MTP drafting (the checkpoint's own head), 0 = --no-drafts (the serial reference)
#   max_tokens  --max-tokens (the reply limit for a request that names none)
#   need_mib    ESTIMATED footprint, for information: TensorFold admits requests against its own memory budget
#   basis       MEASURED-<date> or ESTIMATED
PROFILE_SCHEMA="name|ctx|drafts|max_tokens|need_mib|basis|summary"
SAFE_KV_TYPES="${SAFE_KV_TYPES:-n/a}"

TENSORFOLD_REPO_URL="${TENSORFOLD_REPO_URL:-https://github.com/ashhart/TensorFold.git}"
TENSORFOLD_INSTALL_REL="${TENSORFOLD_INSTALL_REL:-.local/share/awesome-local-ai/tensorfold}"
# One store for checkpoints served from a plain directory (relative to $HOME).
TENSORFOLD_MODEL_CACHE_REL="${TENSORFOLD_MODEL_CACHE_REL:-.local/share/awesome-local-ai/models}"
# Files a checkpoint needs that its safetensors index does not list.
TENSORFOLD_REQUIRED_FILES="${TENSORFOLD_REQUIRED_FILES:-config.json generation_config.json chat_template.jinja tokenizer_config.json tokenizer.json}"
# A ~105 GiB checkpoint loads from SSD and TensorFold measures its prompt chunk and memory at startup.
TENSORFOLD_LOAD_TIMEOUT="${TENSORFOLD_LOAD_TIMEOUT:-1800}"
BACKEND_MTP_INTERNAL=1

if [[ -z "${SMOKE_REQUEST_EXTRA:-}" ]]; then
  SMOKE_REQUEST_EXTRA='"reasoning_effort":"none"'
fi

TENSORFOLD_BIN_OVERRIDE="${TENSORFOLD_BIN_OVERRIDE:-${TENSORFOLD_BIN:-}}"
TENSORFOLD_BIN=""; TENSORFOLD_BIN_REL=""; TENSORFOLD_BIN_ORIGIN=""
TENSORFOLD_WEIGHTS_VERIFIED=""

backend_manifest_extra() {
  local v
  echo
  echo "# tensorfold backend (lib/tensorfold.sh)"
  for v in TENSORFOLD_BIN_REL TENSORFOLD_VERSION TENSORFOLD_COMMIT TENSORFOLD_MEMORY_LIMIT_GB TENSORFOLD_PARALLEL \
           OUTPUT_LIMIT; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
}

# ---- install --------------------------------------------------------------

ensure_backend() {
  info "Ensuring TensorFold ${TENSORFOLD_VERSION} (commit ${TENSORFOLD_COMMIT:0:12})..."
  _tensorfold_require_platform
  if [[ -n "${TENSORFOLD_BIN_OVERRIDE:-}" ]]; then
    local v; v="$(_tensorfold_installed_version "$TENSORFOLD_BIN_OVERRIDE")"
    [[ "$v" == "$TENSORFOLD_VERSION" ]] || err \
      "TENSORFOLD_BIN=${TENSORFOLD_BIN_OVERRIDE} reports version '${v:-nothing}'; this combination pins ${TENSORFOLD_VERSION}."
    TENSORFOLD_BIN="$TENSORFOLD_BIN_OVERRIDE"; TENSORFOLD_BIN_ORIGIN="given by TENSORFOLD_BIN"
  else
    _tensorfold_install_pinned
  fi
  ok "TensorFold ${TENSORFOLD_VERSION} (${TENSORFOLD_BIN_ORIGIN}) at ${TENSORFOLD_BIN}"
  TENSORFOLD_BIN_REL=""
  case "$TENSORFOLD_BIN" in "${HOME}/"*) TENSORFOLD_BIN_REL="${TENSORFOLD_BIN#"${HOME}/"}" ;; esac
}

# TensorFold also runs on CUDA, but this adapter serves the MLX build on a Mac.
_tensorfold_require_platform() {
  [[ "$(uname -s)" == "Darwin" && "$(uname -m)" == "arm64" ]] || err \
    "This TensorFold combination runs on an Apple silicon Mac (MLX); this is $(uname -s) $(uname -m)."
}

# "tensorfold 0.6.0" -> 0.6.0; nothing when the file is absent or says something else.
_tensorfold_installed_version() {
  [[ -x "$1" ]] || return 0
  "$1" --version 2>/dev/null | awk '$1=="tensorfold" {print $2}' | head -1 || true
}

_tensorfold_pinned_dir() { printf '%s/%s/v%s' "$HOME" "$TENSORFOLD_INSTALL_REL" "$TENSORFOLD_VERSION"; }

# The commit the installed package was built from, from its PEP 610 direct_url.json.
_tensorfold_installed_commit() {
  "$1" -c 'import importlib.metadata as m, json
print(json.loads(m.distribution("tensorfold").read_text("direct_url.json"))["vcs_info"]["commit_id"])' 2>/dev/null || true
}

# Idempotent: a venv already marked as holding this exact commit is reused with no network access. Otherwise it is
# (re)built and checked, and only then marked.
_tensorfold_install_pinned() {
  local dir venv bin py have commit
  dir="$(_tensorfold_pinned_dir)"; venv="${dir}/venv"; bin="${venv}/bin/tensorfold"; py="${venv}/bin/python"
  if [[ -f "${dir}/.installed" && "$(cat "${dir}/.installed")" == "$TENSORFOLD_COMMIT" ]] \
     && [[ "$(_tensorfold_installed_version "$bin")" == "$TENSORFOLD_VERSION" ]]; then
    TENSORFOLD_BIN="$bin"; TENSORFOLD_BIN_ORIGIN="pinned, already installed"
    return 0
  fi
  need_cmd uv || ensure_uv
  rm -f "${dir}/.installed"
  mkdir -p "$dir"
  info "Installing TensorFold ${TENSORFOLD_VERSION} from ${TENSORFOLD_REPO_URL} at ${TENSORFOLD_COMMIT}..."
  uv venv --python "$TENSORFOLD_PYTHON" "$venv" || err "uv could not make a Python ${TENSORFOLD_PYTHON} venv at ${venv}."
  uv pip install --python "$py" "tensorfold @ git+${TENSORFOLD_REPO_URL}@${TENSORFOLD_COMMIT}" \
    || err "Installing TensorFold ${TENSORFOLD_COMMIT} failed. Re-run to retry."
  have="$(_tensorfold_installed_version "$bin")"
  [[ "$have" == "$TENSORFOLD_VERSION" ]] || err \
    "The installed TensorFold reports version 'tensorfold ${have:-nothing}', expected ${TENSORFOLD_VERSION}.
       Run it directly to see why:  ${bin} --version"
  commit="$(_tensorfold_installed_commit "$py")"
  [[ "$commit" == "$TENSORFOLD_COMMIT" ]] || err \
    "TensorFold commit mismatch: installed from '${commit:-unknown}', pinned ${TENSORFOLD_COMMIT}.
       Delete ${dir} and re-run."
  uv pip freeze --python "$py" > "${dir}/requirements.lock.txt" 2>/dev/null || true
  printf '%s\n' "$TENSORFOLD_COMMIT" > "${dir}/.installed"
  TENSORFOLD_BIN="$bin"; TENSORFOLD_BIN_ORIGIN="pinned commit, verified"
}

backend_install_summary() {
  printf '  %-11s %s @ %s\n' "Weights" "$MODEL_REPO" "${MODEL_REVISION:0:8}"
  printf '  %-11s %s\n' "Verified" "${TENSORFOLD_WEIGHTS_VERIFIED:-?}"
  printf '  %-11s %s\n' "MTP head" "inside the checkpoint; drafts per profile (--no-drafts to turn off)"
  printf '  %-11s %s\n' "Context" "fitted at startup to what keeps a prompt for the next turn (see the server log)"
  printf '  %-11s %s\n' "Store" "\$HOME/${MODEL_SUBDIR:-?}"
}

tensorfold_sha() { printf 'tensorfold %s @ %s (%s)' "${TENSORFOLD_VERSION:-?}" "${TENSORFOLD_COMMIT:0:12}" "${TENSORFOLD_BIN_ORIGIN:-?}"; }

# ---- weights --------------------------------------------------------------

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME:-$MODEL_REPO} (${MODEL_REPO} @ ${MODEL_REVISION:0:8})..."
  local store="${TENSORFOLD_MODEL_STORE:-${HOME}/${TENSORFOLD_MODEL_CACHE_REL}}"
  local dir="${store}/${MODEL_REPO}"
  mkdir -p "$dir"
  if [[ "$(hf_pinned_state "$dir")" == "valid" ]]; then
    ok "Already present and verified at this revision -- not re-downloading."
  else
    _tensorfold_require_disk "$dir"
    ensure_hf
    info "Downloading ${MODEL_REPO} at ${MODEL_REVISION} (${MODEL_APPROX_SIZE:-large}); re-run to resume if interrupted."
    hf download "$MODEL_REPO" --revision "$MODEL_REVISION" --local-dir "$dir" \
      || err "Download failed for ${MODEL_REPO}@${MODEL_REVISION}. Re-run to resume."
    local gap f
    if ! gap="$(hf_shards_present "$dir")"; then
      err "${MODEL_REPO} downloaded but is incomplete: ${gap}. Re-run to resume."
    fi
    for f in $TENSORFOLD_REQUIRED_FILES; do
      [[ -s "${dir}/${f}" ]] || err "${MODEL_REPO} is missing ${f} after download. Re-run to resume."
    done
    hf_verify_sha256 "$dir"
    hf_write_marker "$dir"
    ok "Downloaded and verified: ${MODEL_REPO}"
  fi
  TENSORFOLD_WEIGHTS_VERIFIED="$(hf_marker_summary "$dir")"
  MODEL_ARTIFACT="$dir"
  MODEL_FILE="${MODEL_REPO#*/}"
  case "$dir" in
    "${HOME}/"*) MODEL_SUBDIR="$(dirname "${dir#"${HOME}/"}")" ;;
    *) MODEL_SUBDIR="$(dirname "$dir")"
       warn "The model store is outside \$HOME; the launcher will need MODEL=${dir}." ;;
  esac
  MODEL_CACHE_ENV_VAR=""
  MMPROJ=""; MTP_HEAD=""
}

_tensorfold_require_disk() {
  local dir="$1" need_kb have_kb free_kb
  need_kb="${MODEL_DISK_KB:-0}"
  (( need_kb > 0 )) || return 0
  have_kb="$(du -sk "$dir" 2>/dev/null | awk '{print $1}')"; have_kb="${have_kb:-0}"
  free_kb="$(df -k "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"; free_kb="${free_kb:-0}"
  if (( free_kb + have_kb < need_kb )); then
    err "Not enough disk for ${MODEL_REPO}: needs ~$(( need_kb / 1048576 )) GiB in total,
       $(( have_kb / 1048576 )) GiB already there, $(( free_kb / 1048576 )) GiB free on that volume.
       Free space, or set TENSORFOLD_MODEL_STORE to a bigger volume and re-run."
  fi
}

# ---- serving --------------------------------------------------------------

# tensorfold_serve_argv MODEL_DIR PORT NAME CTX DRAFTS -- one argument per line, after the `tensorfold` binary.
#   CTX     fit (no --context) or a number; DRAFTS 1 (MTP drafts) or 0 (--no-drafts)
# lib/runtime/server-tensorfold.sh builds the same line from the install manifest (tests/tensorfold-test.sh checks
# that the two agree).
tensorfold_serve_argv() {
  local model="$1" port="$2" name="$3" ctx="$4" drafts="$5"
  local -a a=(serve "$model" --host 127.0.0.1 --port "$port" --name "$name"
              # pi sends no effort, and Qwen3.8's template default is xhigh; the owner set low for Flash-Next.
              --reasoning-effort "${REASONING_EFFORT_DEFAULT:-low}"
              --max-tokens "${OUTPUT_LIMIT:-32768}"
              # One request at a time, as mlx-serve runs (--max-concurrent 1); it also leaves the whole budget to
              # one conversation's window and kept prompt.
              --parallel "${TENSORFOLD_PARALLEL:-1}"
              # Kept prompts stay in memory only, as mlx-serve's do: nothing carries over between runs or restarts.
              --snapshot-dir none
              --no-update-check)
  # shellcheck disable=SC2206
  a+=(${SAMPLING_THINKING})
  [[ "$ctx" == fit ]] || a+=(--context "$ctx")
  [[ "$drafts" == 1 ]] || a+=(--no-drafts)
  printf '%s\n' "${a[@]}"
}

# KEY=VALUE lines for the server's environment.
tensorfold_serve_env() {
  # TensorFold's default MLX budget is 70% of RAM (89.6 GiB on 128 GB). mlx-serve here runs with a 16 GiB OS
  # reserve; the same reserve is RAM less 16 GiB. TensorFold caps it at the GPU's recommended working set.
  echo "TENSORFOLD_MEMORY_LIMIT_GB=${TENSORFOLD_MEMORY_LIMIT_GB}"
  echo "TENSORFOLD_NO_LIVE=1"
  echo "TENSORFOLD_NO_UPDATE_CHECK=1"
}

backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-8s %7s ctx  drafts %-3s  max %-6s  %-9s %s\n", $1, $2, ($3=="1"?"on":"off"), $4, $6, $7
  }' "$1"
}

# /v1/models answers once the server is serving (TensorFold binds after loading).
backend_smoke_context() {
  local port="$1" i
  for (( i = 0; i < TENSORFOLD_LOAD_TIMEOUT; i += 2 )); do
    if curl -sf --max-time 5 "http://127.0.0.1:${port}/v1/models" >/dev/null 2>&1; then
      printf 'fitted (see the server log)'; return 0
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
