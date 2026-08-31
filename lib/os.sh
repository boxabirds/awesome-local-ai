#!/usr/bin/env bash
# lib/os.sh -- operating-system qualification.
#
# A combination declares the OS it was built and measured on (TARGET_OS, and
# optionally TARGET_OS_VERSION). We refuse to run outside it rather than
# half-installing: the package manager, the accelerator toolchain and the
# service manager all differ, and a partial install is worse than none.

OS_PRETTY=""

qualify_os() {
  info "Qualifying operating system (combination targets: ${TARGET_OS})..."
  local kernel; kernel="$(uname -s)"

  case "$TARGET_OS" in
    ubuntu|debian) _qualify_linux "$kernel" ;;
    macos)         _qualify_macos "$kernel" ;;
    *) err "Unknown TARGET_OS '${TARGET_OS}' in combination config." ;;
  esac
}

_qualify_linux() {
  local kernel="$1"
  [[ "$kernel" == "Linux" ]] || err \
    "This combination targets ${TARGET_OS} but the kernel is ${kernel}.
       Pick an install-*.sh whose path contains your OS, or see
       docs/adding-a-combination.md to add one."

  if [[ ! -f /etc/os-release ]]; then
    warn "Cannot detect distribution (no /etc/os-release); assuming ${TARGET_OS}-like."
    OS_PRETTY="unknown Linux"
    return
  fi

  # shellcheck disable=SC1091
  . /etc/os-release
  OS_PRETTY="${PRETTY_NAME:-${ID:-unknown}}"

  if [[ "${ID:-}" == "$TARGET_OS" ]]; then
    if [[ -n "${TARGET_OS_VERSION:-}" && "${VERSION_ID:-}" != "$TARGET_OS_VERSION" ]]; then
      warn "${OS_PRETTY} detected; this combination was measured on ${TARGET_OS} ${TARGET_OS_VERSION}. Continuing."
    else
      ok "OS: ${OS_PRETTY} (validated)."
    fi
  elif [[ "${ID_LIKE:-}" == *"$TARGET_OS"* || "${ID_LIKE:-}" == *debian* ]]; then
    warn "${OS_PRETTY} is ${TARGET_OS}-like but not ${TARGET_OS}; apt paths should work but are untested."
  elif [[ "${ALLOW_UNSUPPORTED_OS:-0}" == "1" ]]; then
    warn "${OS_PRETTY} is unsupported; ALLOW_UNSUPPORTED_OS=1 set, continuing at your own risk."
    warn "You will need to install these yourself: ${SYSTEM_PACKAGES[*]:-build tools}"
  else
    err "Unsupported OS: ${OS_PRETTY}. This combination targets ${TARGET_OS}${TARGET_OS_VERSION:+ ${TARGET_OS_VERSION}}.
       The package, toolchain and service steps assume its layout.
       To attempt anyway: ALLOW_UNSUPPORTED_OS=1 \$0"
  fi
}

_qualify_macos() {
  local kernel="$1"
  [[ "$kernel" == "Darwin" ]] || err \
    "This combination targets macOS but the kernel is ${kernel}."
  OS_PRETTY="macOS $(sw_vers -productVersion 2>/dev/null || echo '?')"
  ok "OS: ${OS_PRETTY}"
}
