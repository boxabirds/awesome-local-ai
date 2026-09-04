#!/usr/bin/env bash
# lib/llamacpp.sh -- clone, update and build llama.cpp.
#
# Backend-agnostic: the accelerator module supplies the cmake flags, the build
# cache key and the "can this binary see the device?" probe. Adding a new
# backend means adding lib/accel/<name>.sh, not touching this file.
#
# Backend contract (see docs/adding-a-combination.md):
#   ensure_backend          install/build the serving binary
#   backend_profile_table   render profiles.tsv for --help and the summary
#   <backend>_sha           version string for the summary
# plus the optional BACKEND_NEEDS_* switches read by lib/bootstrap.sh.

# llama.cpp is compiled here and its weights are single files from the Hub, so
# both generic steps apply. Named explicitly rather than left to the default,
# because they are a property of the backend, not of the installer.
BACKEND_NEEDS_BUILD_TOOLS=1
BACKEND_NEEDS_HF=1
BACKEND_REQUIRED_VARS="MODEL_SUBDIR MODEL_ASSETS SAFE_KV_TYPES"
PROFILE_SCHEMA="name|ctx|kv_type|vision|np|ub|need_mib|summary"

# The checkout is this backend's business; nothing outside it needs the path.
LLAMA_DIR="${LLAMA_DIR:-${INSTALL_ROOT}/llama.cpp}"

ensure_backend() { ensure_llama_cpp; }

# profiles.tsv for this backend is name|ctx|kv_type|vision|np|ub|need_mib|summary.
# Rendering lives with the backend because the columns do: another backend has
# no KV type and no vision flag to print.
backend_profile_table() {
  awk -F'|' '!/^[[:space:]]*(#|$)/ {
    vis = ($4 == "1") ? "on " : "off";
    printf "  %-11s %6s ctx  %-5s KV  vision %s   %s\n", $1, $2, $3, vis, $8
  }' "$1"
}

# llama-server advertises the context it actually served at /props, which is
# the number worth reporting -- it reflects what the profile achieved, not what
# was requested.
backend_smoke_context() {
  curl -s "http://127.0.0.1:${1}/props" \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["default_generation_settings"]["n_ctx"])' 2>/dev/null
}

# llama.cpp starts happily with speculative decoding silently disabled, so
# assert it actually drafted tokens rather than trusting that the head loaded.
backend_smoke_assert() {
  local smoke_log="$1"
  [[ -n "$MTP_HEAD" ]] || return 0
  local acc
  acc=$(grep -oE 'draft acceptance = [0-9.]+' "$smoke_log" | tail -1 | grep -oE '[0-9.]+$')
  if [[ -n "$acc" ]]; then
    SMOKE_ACC="draft acceptance ${acc}"
    ok "MTP speculative decoding active (draft acceptance ${acc})."
  else
    warn "MTP head was loaded but no draft acceptance was reported -- speculative decoding may be inactive."
  fi
}

ensure_llama_cpp() {
  info "Ensuring up-to-date llama.cpp (${ACCEL} backend)..."

  local need_rebuild=0
  local stamp="${LLAMA_DIR}/.build-stamp"
  local build_key; build_key="$(_llamacpp_build_key)"

  if [[ -d "$LLAMA_DIR/.git" ]]; then
    # SKIP_BACKEND_UPDATE=1 pins the checkout you already have. Re-running the
    # installer is how you regenerate the runtime after a config change, and
    # you rarely want that to also drag in a day of upstream churn and a
    # 10-minute rebuild.
    if [[ "${SKIP_BACKEND_UPDATE:-0}" == "1" ]]; then
      info "SKIP_BACKEND_UPDATE=1 -- keeping the existing llama.cpp checkout."
    else
      info "Existing llama.cpp source found. Updating..."
      git -C "$LLAMA_DIR" fetch --depth 1 origin master --prune
      git -C "$LLAMA_DIR" checkout -q master 2>/dev/null || true
      git -C "$LLAMA_DIR" reset --hard -q origin/master
    fi
  else
    info "Cloning llama.cpp..."
    git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
    need_rebuild=1
  fi

  local head_sha bin
  head_sha=$(git -C "$LLAMA_DIR" rev-parse HEAD)
  bin="${LLAMA_DIR}/build/bin/llama-server"

  if [[ ! -x "$bin" ]]; then
    need_rebuild=1
  else
    # Rebuild if the source moved, the build options changed, or the binary
    # predates the commit that added the features this combination needs.
    local prev_key="" prev_sha=""
    [[ -f "$stamp" ]] && { read -r prev_sha prev_key < "$stamp" || true; }
    if [[ "$prev_sha" != "$head_sha" || "$prev_key" != "$build_key" ]]; then
      info "Source or build options changed -> rebuilding."
      need_rebuild=1
    fi
    local bin_mtime cutoff
    bin_mtime=$(stat -c %Y "$bin" 2>/dev/null || stat -f %m "$bin" 2>/dev/null || echo 0)
    cutoff=$(date -d "$MIN_LLAMA_COMMIT_DATE" +%s 2>/dev/null || echo 0)
    if (( bin_mtime < cutoff )); then
      warn "llama-server predates ${MIN_LLAMA_COMMIT_DATE} -> rebuilding."
      need_rebuild=1
    fi
    if ! accel_probe_binary "$bin"; then
      warn "Binary reports no ${ACCEL} device -> rebuilding."
      need_rebuild=1
    fi
  fi

  if (( need_rebuild )); then
    _llamacpp_build || err "Could not build llama.cpp; see ${LOG_FILE}."
  else
    ok "llama.cpp binary is current and ${ACCEL}-capable."
  fi

  _llamacpp_link
}

# What the build depends on besides the source: rebuild when it changes.
_llamacpp_build_key() {
  local curl_state="off"
  _have_curl_dev && curl_state="on"
  printf '%s;curl=%s' "$(accel_build_key)" "$curl_state"
}

# Build whatever the checkout currently holds. Kept separate from
# ensure_llama_cpp because returning to a known-good commit needs exactly this
# and none of the update logic that got us there.
_llamacpp_build() {
  local head_sha build_key
  head_sha="$(git -C "$LLAMA_DIR" rev-parse HEAD)"
  build_key="$(_llamacpp_build_key)"

  info "Building llama.cpp with ${ACCEL} (several minutes)..."
  local cmake_args=(
    -B "${LLAMA_DIR}/build" -S "$LLAMA_DIR"
    -DCMAKE_BUILD_TYPE=Release
    -DLLAMA_BUILD_TESTS=OFF
    -DLLAMA_BUILD_EXAMPLES=OFF
    -DLLAMA_BUILD_TOOLS=ON        # llama-server lives under tools/
    -DLLAMA_BUILD_SERVER=ON
  )
  local flag
  while IFS= read -r flag; do cmake_args+=("$flag"); done < <(accel_cmake_args)

  # libcurl headers are root-only to install; drop CURL support if absent.
  # We download models with the hf CLI anyway, so only llama-server's own
  # -hf flag is lost.
  if ! _have_curl_dev; then
    warn "libcurl dev headers missing -> building with -DLLAMA_CURL=OFF."
    cmake_args+=(-DLLAMA_CURL=OFF)
  fi
  need_cmd ninja && cmake_args+=(-G Ninja)

  # Wipe only the CMake cache, not the whole tree: object files stay warm so
  # subsequent re-runs are incremental instead of a full rebuild.
  rm -f "${LLAMA_DIR}/build/CMakeCache.txt"

  # Check both steps explicitly. `set -e` cannot be relied on here: this runs
  # under lib/verify.sh, and a function called from an `if` or a `||` list has
  # errexit suppressed for its whole call tree. Without these checks a failed
  # build reports success, writes a stamp saying the new source is built, and
  # leaves the PREVIOUS binary in place -- so a rollback would announce that it
  # recovered while still running the build that failed.
  local bin="${LLAMA_DIR}/build/bin/llama-server"
  if ! cmake "${cmake_args[@]}"; then
    rm -f "${LLAMA_DIR}/.build-stamp"
    warn "cmake could not configure llama.cpp."
    return 1
  fi
  if ! cmake --build "${LLAMA_DIR}/build" --config Release -j"$(_nproc)"; then
    rm -f "${LLAMA_DIR}/.build-stamp"
    warn "llama.cpp failed to build."
    return 1
  fi
  if [[ ! -x "$bin" ]]; then
    rm -f "${LLAMA_DIR}/.build-stamp"
    warn "llama.cpp reported success but produced no llama-server binary."
    return 1
  fi
  if ! accel_probe_binary "$bin"; then
    rm -f "${LLAMA_DIR}/.build-stamp"
    warn "The llama-server just built reports no ${ACCEL} device."
    return 1
  fi

  # Stamped only once the build is known good, so a failure leaves the tree
  # looking un-built and the next run rebuilds instead of trusting it.
  echo "${head_sha} ${build_key}" > "${LLAMA_DIR}/.build-stamp"
  ok "llama.cpp built."
}

_llamacpp_link() {
  ln -sfn "${LLAMA_DIR}/build/bin/llama-server" "${BIN_DIR}/llama-server"
  [[ -x "${LLAMA_DIR}/build/bin/llama-cli" ]] && \
    ln -sfn "${LLAMA_DIR}/build/bin/llama-cli" "${BIN_DIR}/llama-cli"
  ok "llama-server -> ${BIN_DIR}/llama-server"
}

# ---- recovery -------------------------------------------------------------
# Optional backend hooks, used by lib/verify.sh. A backend that cannot return
# to an earlier version simply does not define them, and verification then
# fails without attempting recovery.

# The exact commit that is built right now.
backend_current_ref() { git -C "$LLAMA_DIR" rev-parse HEAD 2>/dev/null || printf ''; }

# Short, human-facing form of a ref.
backend_ref_label() {
  git -C "$LLAMA_DIR" rev-parse --short "${1:-HEAD}" 2>/dev/null || printf '%s' "${1:0:12}"
}

# Return the checkout to a specific commit and rebuild there. This is what
# makes floating on upstream safe: master moves every day, and when a newer
# llama.cpp fails verification the user still ends up with the last one that
# worked on this machine rather than a broken install.
backend_rollback_to() {
  local ref="$1"
  [[ -n "$ref" ]] || return 1

  # A shallow clone may no longer hold the object; ask origin for it directly.
  if ! git -C "$LLAMA_DIR" rev-parse --verify -q "${ref}^{commit}" >/dev/null 2>&1; then
    info "Fetching llama.cpp ${ref} from origin..."
    git -C "$LLAMA_DIR" fetch --depth 1 origin "$ref" >/dev/null 2>&1 || {
      warn "llama.cpp ${ref} is no longer available from origin; cannot roll back."
      return 1; }
  fi

  git -C "$LLAMA_DIR" checkout -q --detach "$ref" 2>/dev/null || {
    warn "Could not check out llama.cpp ${ref}."
    return 1; }

  # A rollback that cannot build is a failed rollback, and must say so rather
  # than leaving the previous binary in place under a new commit's name.
  _llamacpp_build || return 1
  _llamacpp_link
}

llamacpp_sha() { git -C "$LLAMA_DIR" rev-parse --short HEAD 2>/dev/null || echo "?"; }

_have_curl_dev() {
  case "$TARGET_OS" in
    ubuntu|debian) dpkg -s libcurl4-openssl-dev >/dev/null 2>&1 ;;
    *) need_cmd curl-config ;;
  esac
}

_nproc() { nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4; }
