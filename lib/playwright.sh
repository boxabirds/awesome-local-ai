#!/usr/bin/env bash
# lib/playwright.sh -- browsers for web testing, in one place for every combination.
#
# Coding agents that write web apps test them in a real browser with Playwright. Playwright
# keeps its browsers in one per-user cache (~/Library/Caches/ms-playwright on macOS,
# ~/.cache/ms-playwright on Linux), shared by every project, so that is where they go here too,
# whichever combination is being installed. On by default; WEB_TESTING=0 (or
# ./install.sh --no-web-testing) skips it.
#
#   1. Browsers already in that cache: nothing to do.
#   2. Browsers somewhere else Playwright might have put them (PLAYWRIGHT_BROWSERS_PATH, the
#      other OS's default location): the cache is linked there instead of downloading again.
#   3. Neither: Chromium is installed with the current Playwright.
# Then Chromium is launched once, headless, to prove it works; a failure is reported loudly.
# The benchmark harness's private agent cache (~/.cache/vidi-agent-ms-playwright) is never
# borrowed: the harness keeps it apart on purpose.

WEB_TESTING_STATUS=""
PLAYWRIGHT_BROWSER="chromium"
PLAYWRIGHT_HARNESS_CACHE_NAME="vidi-agent-ms-playwright"
PLAYWRIGHT_CHECK_TIMEOUT_MS=60000

_playwright_os() { printf '%s' "${PLAYWRIGHT_OS:-$(uname)}"; }

# Playwright ships Chromium per Ubuntu release and refuses releases it hasn't listed yet; on a newer
# Ubuntu use the newest one it knows (the benchmark harness does the same).
PLAYWRIGHT_UBUNTU_FALLBACK="24.04"
_playwright_platform_override() {
  local id ver arch
  [[ -n "${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-}" || "$(_playwright_os)" != Linux || ! -r /etc/os-release ]] && return 0
  id="$(. /etc/os-release && printf '%s' "$ID")"; ver="$(. /etc/os-release && printf '%s' "$VERSION_ID")"
  [[ "$id" == ubuntu ]] || return 0
  [[ "$(printf '%s\n' "$ver" "$PLAYWRIGHT_UBUNTU_FALLBACK" | sort -V | tail -1)" == "$PLAYWRIGHT_UBUNTU_FALLBACK" ]] && return 0
  arch="$([[ "$(uname -m)" == aarch64 ]] && echo arm64 || echo x64)"
  export PLAYWRIGHT_HOST_PLATFORM_OVERRIDE="ubuntu${PLAYWRIGHT_UBUNTU_FALLBACK}-${arch}"
}

# Where Playwright looks for browsers by default on this OS.
playwright_home_cache() {
  if [[ "$(_playwright_os)" == Darwin ]]; then
    printf '%s/Library/Caches/ms-playwright' "$HOME"
  else
    printf '%s/ms-playwright' "${XDG_CACHE_HOME:-$HOME/.cache}"
  fi
}

_playwright_has_browser() { compgen -G "$1/${PLAYWRIGHT_BROWSER}-*" >/dev/null 2>&1; }

# Other places browsers may already be, in order of preference. Prints the first that has one.
playwright_find_existing() {
  local home c
  home="$(playwright_home_cache)"
  for c in "${PLAYWRIGHT_BROWSERS_PATH:-}" "$HOME/.cache/ms-playwright" "$HOME/Library/Caches/ms-playwright"; do
    [[ -n "$c" && "$c" != 0 && "$c" != "$home" ]] || continue
    [[ "$(basename "$c")" == "$PLAYWRIGHT_HARNESS_CACHE_NAME" ]] && continue
    if _playwright_has_browser "$c"; then printf '%s' "$c"; return 0; fi
  done
  return 1
}

# npx from the active node, else nvm's default node (installs made before this shell loaded nvm).
_playwright_find_npx() {
  local c
  c="$(command -v npx 2>/dev/null)" && { printf '%s' "$c"; return 0; }
  for c in "$HOME"/.nvm/versions/node/*/bin/npx; do
    [[ -x "$c" ]] && { printf '%s' "$c"; return 0; }
  done
  return 1
}

# Runs the current Playwright CLI (no project needed). Replaced in tests.
_playwright_npx() {
  local npx
  npx="$(_playwright_find_npx)" || return 127
  env -u PLAYWRIGHT_BROWSERS_PATH "$npx" -y playwright@latest "$@"
}

# Launch the installed Chromium headless, from a scratch project with the same Playwright.
# Replaced in tests.
_playwright_launch_check() {
  local npx npm node tmp rc
  npx="$(_playwright_find_npx)" || return 127
  npm="$(dirname "$npx")/npm"; node="$(dirname "$npx")/node"
  tmp="$(mktemp -d)"
  (
    cd "$tmp" \
      && "$npm" init -y >/dev/null 2>&1 \
      && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$npm" install --silent --no-audit --no-fund playwright@latest >/dev/null 2>&1 \
      && env -u PLAYWRIGHT_BROWSERS_PATH "$node" -e "
           require('playwright').chromium.launch({timeout: ${PLAYWRIGHT_CHECK_TIMEOUT_MS}})
             .then(b => { console.log(b.version()); return b.close(); })
             .catch(e => { console.error(String(e.message).split('\n')[0]); process.exit(1); });"
  )
  rc=$?
  rm -rf "$tmp"
  return $rc
}

# The home cache can become a link: it doesn't exist, is already a link, or is an empty directory.
_playwright_free_to_link() {
  [[ ! -e "$1" || -L "$1" ]] && return 0
  [[ -d "$1" ]] && rmdir "$1" 2>/dev/null
}

ensure_web_testing() {
  local home existing
  if [[ "${WEB_TESTING:-1}" == 0 ]]; then
    WEB_TESTING_STATUS="off"
    info "Web testing: skipped (WEB_TESTING=0). Playwright browsers were not installed."
    return 0
  fi
  home="$(playwright_home_cache)"
  _playwright_platform_override
  info "Web testing: making sure Playwright's ${PLAYWRIGHT_BROWSER} is in ${home}..."

  if _playwright_has_browser "$home"; then
    WEB_TESTING_STATUS="present"
  elif existing="$(playwright_find_existing)" && _playwright_free_to_link "$home"; then
    mkdir -p "$(dirname "$home")"
    ln -sfn "$existing" "$home"
    WEB_TESTING_STATUS="linked"
    ok "Web testing: found browsers in ${existing}; linked ${home} to them."
  else
    if ! _playwright_npx install "$PLAYWRIGHT_BROWSER"; then
      WEB_TESTING_STATUS="failed"
      warn "Web testing: could not install Playwright's ${PLAYWRIGHT_BROWSER} (needs Node.js with npx)."
      warn "  Install it yourself: npx playwright install ${PLAYWRIGHT_BROWSER}"
      return 0
    fi
    WEB_TESTING_STATUS="installed"
  fi

  # Browsers that were already there may be older than the current Playwright wants: add its build.
  if [[ "$WEB_TESTING_STATUS" != installed ]] && ! _playwright_launch_check; then
    info "Web testing: the browsers there don't suit the current Playwright; adding its ${PLAYWRIGHT_BROWSER}..."
    _playwright_npx install "$PLAYWRIGHT_BROWSER" && WEB_TESTING_STATUS="updated"
  fi

  if _playwright_launch_check; then
    ok "Web testing: ${PLAYWRIGHT_BROWSER} launches (browsers in ${home})."
  else
    WEB_TESTING_STATUS="failed"
    warn "Web testing: ${PLAYWRIGHT_BROWSER} is in ${home} but would not launch."
    if [[ "$(_playwright_os)" == Linux ]]; then
      warn "  It usually needs system libraries: sudo npx playwright install-deps ${PLAYWRIGHT_BROWSER}"
    fi
  fi
  return 0
}
