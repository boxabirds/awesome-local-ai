#!/usr/bin/env bash
# lib/llamacpp.sh -- clone, update and build llama.cpp.
#
# Backend-agnostic: the accelerator module supplies the cmake flags, the build
# cache key and the "can this binary see the device?" probe. Adding a new
# backend means adding lib/accel/<name>.sh, not touching this file.

ensure_llama_cpp() {
  info "Ensuring up-to-date llama.cpp (${ACCEL} backend)..."

  local need_rebuild=0
  local stamp="${LLAMA_DIR}/.build-stamp"
  local curl_state="off"
  _have_curl_dev && curl_state="on"
  local build_key="$(accel_build_key);curl=${curl_state}"

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
    cmake "${cmake_args[@]}"
    cmake --build "${LLAMA_DIR}/build" --config Release -j"$(_nproc)"
    echo "${head_sha} ${build_key}" > "$stamp"
    ok "llama.cpp built."
  else
    ok "llama.cpp binary is current and ${ACCEL}-capable."
  fi

  ln -sfn "${LLAMA_DIR}/build/bin/llama-server" "${BIN_DIR}/llama-server"
  [[ -x "${LLAMA_DIR}/build/bin/llama-cli" ]] && \
    ln -sfn "${LLAMA_DIR}/build/bin/llama-cli" "${BIN_DIR}/llama-cli"
  ok "llama-server -> ${BIN_DIR}/llama-server"
}

llamacpp_sha() { git -C "$LLAMA_DIR" rev-parse --short HEAD 2>/dev/null || echo "?"; }

_have_curl_dev() {
  case "$TARGET_OS" in
    ubuntu|debian) dpkg -s libcurl4-openssl-dev >/dev/null 2>&1 ;;
    *) need_cmd curl-config ;;
  esac
}

_nproc() { nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4; }
