#!/usr/bin/env bash
# lib/deps.sh -- system packages and build tools.
#
# Package installation needs root. If sudo is password-gated the installer never
# asks for the password itself. In a terminal it pauses: it prints the exact
# command to run in another terminal and carries on once the packages are there
# (Enter re-checks, 's' skips). Unattended (dbench, CI, a pipe) it does not wait:
# it records what was skipped, tells the user what to run, and falls back to
# userspace tools where it can. A combination supplies SYSTEM_PACKAGES.

PKG_MISSING=()

ensure_system_deps() {
  info "Checking system dependencies..."
  case "$TARGET_OS" in
    ubuntu|debian) _deps_apt ;;
    macos)         _deps_brew ;;
    *) err "No package strategy for TARGET_OS '${TARGET_OS}'." ;;
  esac
}

_apt_missing() {
  local p
  for p in "${SYSTEM_PACKAGES[@]}"; do
    dpkg -s "$p" >/dev/null 2>&1 || printf '%s\n' "$p"
  done
}

# Is a person at this install? INSTALL_INTERACTIVE=1|0 overrides (tests, and anyone who wants it).
_deps_interactive() {
  case "${INSTALL_INTERACTIVE:-}" in
    1) return 0 ;;
    0) return 1 ;;
  esac
  [[ -t 0 && -t 1 ]]
}

# Pause until the missing packages are installed from another terminal. Returns 1 if skipped.
_deps_wait_for_apt() {
  local missing=("$@") reply p still_missing
  say ""
  say "  These system packages need sudo: ${missing[*]}"
  say "  Run this in another terminal, then come back here:"
  say ""
  say "    sudo apt-get install -y --no-install-recommends ${missing[*]}"
  say ""
  while true; do
    printf '  Then press Enter to continue (s to skip, Ctrl-C to stop): '
    read -r reply || return 1
    [[ "$reply" == s || "$reply" == S ]] && return 1
    still_missing=()
    while IFS= read -r p; do [[ -n "$p" ]] && still_missing+=("$p"); done < <(_apt_missing)
    ((${#still_missing[@]} == 0)) && return 0
    say "  Still missing: ${still_missing[*]}"
  done
}

_deps_apt() {
  local missing=() p
  while IFS= read -r p; do [[ -n "$p" ]] && missing+=("$p"); done < <(_apt_missing)

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
  elif _deps_interactive && _deps_wait_for_apt "${missing[@]}"; then
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

# cmake/ninja can come from PyPI wheels, as uv tools, when the package manager
# did not provide them.
ensure_build_tools() {
  local t
  for t in cmake ninja; do
    if ! need_cmd "$t"; then
      info "${t} not found; installing as a uv tool (userspace)..."
      ensure_uv
      uv tool install "$t" >/dev/null 2>&1 || warn "uv tool install ${t} failed."
      hash -r
    fi
  done
  need_cmd cmake || err "cmake unavailable, and uv tool install cmake failed."
  ok "Build tools: cmake $(cmake --version | head -1 | awk '{print $3}'), ninja $(ninja --version 2>/dev/null || echo 'n/a')"
}
