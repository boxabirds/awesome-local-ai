#!/usr/bin/env bash
# lib/gufo-fork-ninjapear.sh -- NinjaPear's fork of gufo, built from source.
#
# A separate backend from lib/gufo.sh, not a mode in it, for three reasons found on the machine:
#
#   1. There is no image. The fork publishes no release and no image workflow of its own, and its quickstart
#      points at upstream's gufo-runtime, which does not contain this model. It has to be compiled.
#   2. A source build reports `gufo version development (unknown)` -- no release number, no hash -- so there is
#      nothing for lib/gufo.sh's version pin to match. This records the COMMIT it built instead.
#   3. Its model rejects --mtp-model (the draft block is in the same GGUF) and has no reasoning-effort control.
#      lib/runtime/server-gufo.sh passes both.
#
# Hooks the installer calls: ensure_backend, backend_fetch_model, backend_manifest_extra,
# backend_install_summary, backend_profile_table, backend_smoke_context, backend_smoke_assert.

# The generic smoke request must name the model (gufo answers 400 missing_model without one) and turn thinking
# off: this model's template defaults to thinking ON, and a small budget is then spent entirely on reasoning,
# returning empty content with finish_reason "length". That reads as a broken engine and is not one -- it cost
# a false "do not queue" verdict on 7 Oct 2026 before the capability probe was taught the same lesson.
if [[ -z "${SMOKE_REQUEST_EXTRA:-}" ]]; then
  SMOKE_REQUEST_EXTRA='"model":"'"${MODEL_ALIAS_DEFAULT:-}"'","chat_template_kwargs":{"enable_thinking":false}'
fi

GUFO_FORK_BUILT_COMMIT=""

backend_manifest_extra() {
  local v
  echo
  echo "# gufo fork backend (lib/gufo-fork-ninjapear.sh)"
  for v in GUFO_FORK_REPO GUFO_FORK_COMMIT GUFO_FORK_BIN_REL GUFO_FORK_CPATH_REL \
           GUFO_MODEL_REL GUFO_FORK_BASE_ARGS GUFO_FORK_SAMPLING_INSTRUCT; do
    printf '%s=%q\n' "$v" "${!v:-}"
  done
}

# ---- install --------------------------------------------------------------

ensure_backend() {
  info "Ensuring the build toolchain, the rocWMMA headers and the engine..."
  _gfn_require_devices
  _gfn_require_toolchain
  _gfn_rocwmma_headers
  _gfn_build_engine
}

# The engine reaches the GPU through /dev/kfd and the render node. No access here means a failure minutes into
# a load rather than now.
_gfn_require_devices() {
  local d
  for d in /dev/kfd /dev/dri; do
    [[ -e "$d" ]] || err "${d} does not exist: the amdgpu driver is not loaded (or this is not an AMD GPU host)."
  done
  if [[ ! -r /dev/kfd || ! -w /dev/kfd ]]; then
    err "This user cannot open /dev/kfd, so the engine cannot reach the GPU.
       Add yourself to the render and video groups, then log out and back in:
         sudo usermod -aG render,video \$USER"
  fi
  ok "GPU device nodes accessible: /dev/kfd, /dev/dri"
}

# Every package the fork's CMakeLists actually looks for, by the names Ubuntu 26.04 ships. AMD's own names
# (hipblas-dev and so on) are NOT in Ubuntu's sources; everything here is, so no third-party repository is
# needed. Checked on the Strix Halo box, 6 Oct 2026: 107 packages, no removals, no upgrades, nothing touching
# amdgpu, dkms or the kernel.
GFN_PACKAGES=(pkg-config libicu-dev libcurl4-openssl-dev libssl-dev libpng-dev libjpeg-dev libwebp-dev ffmpeg
              libhipblas-dev libhipblaslt-dev librocblas-dev libhipcub-dev librocprim-dev librocwmma-dev)

_gfn_require_toolchain() {
  local c missing=()
  for c in git cmake ninja g++ hipcc; do need_cmd "$c" || missing+=("$c"); done
  (( ${#missing[@]} == 0 )) || err "Missing build tools: ${missing[*]}
       sudo apt install build-essential cmake ninja-build"
  local p absent=()
  for p in "${GFN_PACKAGES[@]}"; do
    dpkg-query -W -f='${Status}' "$p" 2>/dev/null | grep -q 'install ok installed' || absent+=("$p")
  done
  (( ${#absent[@]} == 0 )) || err "These development packages are missing, and the engine cannot build without them:
         ${absent[*]}
       Install them (additive: no removals, no upgrades, nothing touching the GPU driver), then re-run:
         sudo apt install --no-install-recommends ${absent[*]}"
  ok "Build toolchain and ${#GFN_PACKAGES[@]} development packages present"
}

# Ubuntu 26.04's librocwmma-dev ships rocwmma.hpp and omits the entire internal/ directory it includes on its
# first line, so the package cannot compile anything. rocWMMA is header-only and used by ONE model in this tree
# (DeepSeek V4 Flash, which CMakeLists adds unconditionally), so a complete tree on CPATH fixes it with no root
# and no patch to the fork. The version header is the one piece Ubuntu generates, so it comes from /usr/include.
_gfn_rocwmma_headers() {
  local inc="${INSTALL_ROOT}/${GUFO_FORK_CPATH_REL}"
  if [[ -f "$inc/rocwmma/internal/accessors.hpp" ]]; then
    ok "Complete rocWMMA headers already present"
    return 0
  fi
  local src="${INSTALL_ROOT}/src/rocWMMA"
  info "Fetching complete rocWMMA headers (${GUFO_FORK_ROCWMMA_TAG})..."
  if [[ -d "$src/.git" ]]; then
    git -C "$src" fetch -q --depth 1 origin "$GUFO_FORK_ROCWMMA_TAG" 2>/dev/null || true
    git -C "$src" checkout -q "$GUFO_FORK_ROCWMMA_TAG" 2>/dev/null || true
  else
    mkdir -p "$(dirname "$src")"
    git clone -q --depth 1 --branch "$GUFO_FORK_ROCWMMA_TAG" https://github.com/ROCm/rocWMMA.git "$src" \
      || err "Could not clone rocWMMA at ${GUFO_FORK_ROCWMMA_TAG}."
  fi
  mkdir -p "$inc/rocwmma"
  cp -r "$src/library/include/rocwmma/." "$inc/rocwmma/" \
    || err "rocWMMA's headers are not where expected in the clone."
  cp /usr/include/rocwmma/rocwmma-version.hpp "$inc/rocwmma/" 2>/dev/null \
    || err "No /usr/include/rocwmma/rocwmma-version.hpp: install librocwmma-dev."
  [[ -f "$inc/rocwmma/internal/accessors.hpp" ]] || err "The merged rocWMMA tree is still incomplete."
  ok "Complete rocWMMA headers at \$HOME/${inc#"${HOME}/"}"
}

# The build. Pinned to a commit, because the engine reports no version of its own, and stamped beside the
# binary so the launcher can refuse a binary built from anything else.
_gfn_build_engine() {
  local src="${INSTALL_ROOT}/src/gufo-fork" bin="${INSTALL_ROOT}/${GUFO_FORK_BIN_REL}"
  local stamp; stamp="$(dirname "$bin")/COMMIT"
  if [[ -x "$bin" && "$(tr -d '[:space:]' < "$stamp" 2>/dev/null || true)" == "$GUFO_FORK_COMMIT" ]]; then
    ok "Engine already built at ${GUFO_FORK_COMMIT:0:12}"
    GUFO_FORK_BUILT_COMMIT="$GUFO_FORK_COMMIT"
    return 0
  fi
  if [[ -d "$src/.git" ]]; then
    git -C "$src" fetch -q origin "$GUFO_FORK_COMMIT" 2>/dev/null || git -C "$src" fetch -q origin || true
  else
    mkdir -p "$(dirname "$src")"
    info "Cloning ${GUFO_FORK_REPO}..."
    git clone -q --filter=blob:none "https://github.com/${GUFO_FORK_REPO}.git" "$src" \
      || err "Could not clone ${GUFO_FORK_REPO}."
  fi
  git -C "$src" checkout -q "$GUFO_FORK_COMMIT" \
    || err "Commit ${GUFO_FORK_COMMIT} is not in ${GUFO_FORK_REPO}."

  # clang compiles the HIP objects and takes the NEWEST gcc it finds for libstdc++, while CMake's C++ compiler
  # and the link line are whatever g++ is. On a machine with both gcc 15 and 16 that mismatches, and the link
  # fails on an undefined std::__detail::__notify_impl. Pin clang to the same gcc, which is also the line the
  # fork says it qualifies.
  local gccdir="" d
  for d in /usr/lib/gcc/x86_64-linux-gnu/*/; do [[ -d "$d" ]] && gccdir="${d%/}"; done
  local gccver; gccver="$(g++ -dumpversion 2>/dev/null | cut -d. -f1)"
  [[ -n "$gccver" && -d "/usr/lib/gcc/x86_64-linux-gnu/${gccver}" ]] \
    && gccdir="/usr/lib/gcc/x86_64-linux-gnu/${gccver}"

  export CPATH="${INSTALL_ROOT}/${GUFO_FORK_CPATH_REL}${CPATH:+:$CPATH}"
  info "Configuring (gcc ${gccver:-?} for HIP as well, so the objects and the link agree)..."
  ( cd "$src" && cmake --preset release -DCMAKE_INSTALL_PREFIX="$HOME/.local" \
      ${gccdir:+-DCMAKE_HIP_FLAGS="--gcc-install-dir=${gccdir}"} ) \
    || err "cmake --preset release failed. Its output above says which dependency is missing."

  # --parallel is the fork's own recommendation, not full width: a HIP build at 32 jobs can take the machine
  # into swap, and on a benchmark node that stops whatever story is running.
  info "Building with --parallel ${GUFO_FORK_BUILD_JOBS} (this takes a while; the fork's own instruction is 4)..."
  ( cd "$src" && cmake --build --preset release --parallel "$GUFO_FORK_BUILD_JOBS" ) \
    || err "The build failed. Its output above says where."

  local built="$src/build/release/gufo"
  [[ -x "$built" ]] || err "The build reported success but there is no binary at ${built}."
  mkdir -p "$(dirname "$bin")"
  install -m 755 "$built" "$bin"
  printf '%s\n' "$GUFO_FORK_COMMIT" > "$stamp"
  GUFO_FORK_BUILT_COMMIT="$GUFO_FORK_COMMIT"
  ok "Engine built and stamped at ${GUFO_FORK_COMMIT:0:12}"
}

backend_install_summary() {
  printf '  %-11s %s @ %s\n' "Weights" "$MODEL_REPO" "${MODEL_REVISION:0:8}"
  printf '  %-11s %s\n' "Quant" "${QUANT:-?}"
  printf '  %-11s %s @ %s\n' "Engine" "$GUFO_FORK_REPO" "${GUFO_FORK_COMMIT:0:12}"
  printf '  %-11s %s\n' "Built" "from source (the fork publishes no image); reports no version of its own"
  printf '  %-11s %s\n' "Cache" "\$HOME/${MODEL_SUBDIR}"
}

backend_current_ref() { printf '%s' "${GUFO_FORK_COMMIT:0:12}"; }
backend_ref_label() { printf 'engine commit'; }

# ---- weights --------------------------------------------------------------
# One GGUF, checked by its published byte count: the model card states 22,388,168,960 bytes, so a short file is
# a resumable download and not a mystery.

_gfn_weights_state() { # dir -> valid | missing <problem>
  local dir="$1" path bytes have
  while IFS='|' read -r path bytes; do
    [[ -z "${path// }" || "$path" == \#* ]] && continue
    have="$(wc -c < "$dir/$path" 2>/dev/null | tr -d ' ')" || have=""
    if [[ "$have" != "$bytes" ]]; then
      printf 'missing %s (%s of %s bytes)\n' "$path" "${have:-no file,}" "$bytes"
      return 0
    fi
  done <<< "$GUFO_FORK_MODEL_FILES"
  echo valid
}

backend_fetch_model() {
  info "Ensuring ${MODEL_DISPLAY_NAME} (${MODEL_REPO} @ ${MODEL_REVISION:0:8})..."
  local cache="${GUFO_FORK_MODEL_CACHE:-${HOME}/${GUFO_FORK_MODEL_CACHE_REL}}"
  local dir="${cache}/${MODEL_WEIGHTS_DIR}" state
  mkdir -p "$dir"
  state="$(_gfn_weights_state "$dir")"
  if [[ "$state" == valid ]]; then
    ok "Weights present at their published size -- not re-downloading."
  else
    info "Weights incomplete: ${state#missing }"
    ensure_hf
    local includes=() path bytes
    while IFS='|' read -r path bytes; do
      [[ -z "${path// }" || "$path" == \#* ]] && continue
      includes+=(--include "$path")
    done <<< "$GUFO_FORK_MODEL_FILES"
    info "Downloading from ${MODEL_REPO} at ${MODEL_REVISION} (${MODEL_APPROX_SIZE:-large})..."
    info "  This resumes if interrupted -- re-run the installer to continue."
    hf download "$MODEL_REPO" --revision "$MODEL_REVISION" "${includes[@]}" --local-dir "$dir" \
      || err "Download failed for ${MODEL_REPO}@${MODEL_REVISION}. Re-run to resume."
    state="$(_gfn_weights_state "$dir")"
    [[ "$state" == valid ]] || err "Downloaded, but still incomplete: ${state#missing }. Re-run to resume."
    ok "Downloaded at the published size."
  fi
  MODEL_ARTIFACT="$dir"
  MODEL_SUBDIR="${cache#"${HOME}/"}"
  MODEL_CACHE_ENV_VAR="GUFO_FORK_MODEL_CACHE"
  MMPROJ=""; MTP_HEAD=""
}

# ---- serving --------------------------------------------------------------

backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    printf "  %-9s %7s ctx  sessions %-2s  draft %-2s  prefill-chunk %-5s  %-19s %s\n", $1, $2, $3, $4, $5, $7, $8
  }' "$1"
}

# The engine's own load line states it: "[loader] event=load_completed ... context_tokens=131072 ...".
# /v1/models does not, so the log is the source. '?' when neither says.
backend_smoke_context() {
  local port="$1" n
  n="$(curl -s --max-time 10 "http://127.0.0.1:${port}/v1/models" \
    | python3 -c 'import sys,json
m=(json.load(sys.stdin).get("data") or [{}])[0]
print(m.get("context_length") or m.get("max_model_len") or m.get("n_ctx") or "")' 2>/dev/null)"
  [[ -n "$n" ]] || n="$(sed -n 's/.*event=load_completed.* context_tokens=\([0-9][0-9]*\).*/\1/p' \
    "${INSTALL_ROOT}/smoke.log" 2>/dev/null | tail -1)"
  echo "${n:-?}"
}

_gfn_draft_counts() {
  python3 -c '
import sys, json
u = (json.load(sys.stdin).get("usage") or {})
if u.get("draft_tokens"):
    print(u.get("draft_tokens_accepted", 0), u["draft_tokens"])
' 2>/dev/null
}

# MTP drafting proven from the engine's own per-request accounting, and then the capability probe: starting is
# not evidence that the stack can do the work, and a series costs machine-days.
backend_smoke_assert() {
  local log="$1" port="$2" resp counts
  resp="$(curl -sf --max-time 180 "http://127.0.0.1:${port}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -d "{\"model\":\"${MODEL_ALIAS_DEFAULT}\",\"messages\":[{\"role\":\"user\",\"content\":\"Count from 1 to 40, separated by commas.\"}],\"max_tokens\":128,\"temperature\":0,\"chat_template_kwargs\":{\"enable_thinking\":false}}" \
    2>/dev/null)" || { warn "The MTP check request failed; unable to confirm speculative decoding."; return 0; }
  counts="$(_gfn_draft_counts <<< "$resp")"
  if [[ -n "$counts" ]]; then
    local a d; read -r a d <<< "$counts"
    SMOKE_ACC="MTP, ${a} of ${d} drafted tokens accepted"
    ok "MTP drafting live: ${a} of ${d} drafted tokens accepted."
  else
    warn "The engine reported no draft counters (usage.draft_tokens); speculative decoding is configured"
    warn "  (--speculative mtp) but not proven here. Check ${log}."
  fi

  local probe="${REPO_ROOT:-.}/tools/engine-probe/basic-capability.py"
  if [[ -f "$probe" ]]; then
    info "Capability probe (plumbing decides, basic capability reports)..."
    if python3 "$probe" --base-url "http://127.0.0.1:${port}/v1" --model "$MODEL_ALIAS_DEFAULT"; then
      ok "Capability probe: every check passed."
    else
      warn "The capability probe did not pass every check (above). Plumbing failures mean do not queue a series."
    fi
  fi
}
