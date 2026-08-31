#!/usr/bin/env bash
# lib/deps.sh -- system packages and build tools.
#
# Package installation needs root. If sudo is password-gated we do NOT hang
# waiting on a prompt: we fall back to pip-provided cmake/ninja, record what
# was skipped, and tell the user exactly what to run if they want the full
# build. A combination supplies the package list in SYSTEM_PACKAGES.

PKG_MISSING=()

ensure_system_deps() {
  info "Checking system dependencies..."
  case "$TARGET_OS" in
    ubuntu|debian) _deps_apt ;;
    macos)         _deps_brew ;;
    *) err "No package strategy for TARGET_OS '${TARGET_OS}'." ;;
  esac
}

_deps_apt() {
  local missing=() p
  for p in "${SYSTEM_PACKAGES[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || missing+=("$p")
  done

  if ((${#missing[@]} == 0)); then
    ok "System packages already present."
    return
  fi

  if can_sudo; then
    info "Installing missing packages: ${missing[*]}"
    run_as_root apt-get update -qq
    # `sudo VAR=val cmd` does not work -- sudo treats VAR=val as the command name.
    run_as_root env DEBIAN_FRONTEND=noninteractive \
      apt-get install -y --no-install-recommends "${missing[@]}"
    ok "System packages installed."
  else
    PKG_MISSING=("${missing[@]}")
    warn "Missing apt packages and no passwordless sudo: ${missing[*]}"
    warn "To install them yourself:"
    warn "  sudo apt-get install -y --no-install-recommends ${missing[*]}"
    warn "Continuing with userspace fallbacks where possible."
  fi
}

_deps_brew() {
  need_cmd brew || err "Homebrew is required for this combination. See https://brew.sh"
  local missing=() p
  for p in "${SYSTEM_PACKAGES[@]}"; do
    brew list --formula "$p" >/dev/null 2>&1 || missing+=("$p")
  done
  if ((${#missing[@]} == 0)); then ok "System packages already present."; return; fi
  info "Installing missing packages: ${missing[*]}"
  brew install "${missing[@]}"
  ok "System packages installed."
}

# cmake/ninja can come from pip wheels when the package manager is unavailable.
ensure_build_tools() {
  local t
  for t in cmake ninja; do
    if ! need_cmd "$t"; then
      info "${t} not found; installing via pip (userspace)..."
      python3 -m pip install --user -q -U "$t" || warn "pip install ${t} failed."
      hash -r
    fi
  done
  need_cmd cmake || err "cmake unavailable and pip install failed."
  ok "Build tools: cmake $(cmake --version | head -1 | awk '{print $3}'), ninja $(ninja --version 2>/dev/null || echo 'n/a')"
}
