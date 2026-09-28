#!/usr/bin/env bash
# lib/playwright.sh -- browsers for web testing, one place for every combination.
# No network: npx and the launch check are stubbed; the tests check where browsers are
# looked for, what is wired up, and when an install is (and is not) attempted.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SANDBOX="$(mktemp -d)"
trap 'rm -rf "$SANDBOX"' EXIT
LOG_FILE="$SANDBOX/install.log"
. "$REPO_ROOT/lib/common.sh"
. "$REPO_ROOT/lib/playwright.sh"

NPX_CALLS="$SANDBOX/npx-calls"
# Stubs: record installs instead of downloading; a launch check that passes when a
# chromium-* directory is reachable from the home cache.
_playwright_npx() { printf '%s\n' "$*" >> "$NPX_CALLS"; mkdir -p "$(playwright_home_cache)/chromium-9999"; }
_playwright_launch_check() { compgen -G "$(playwright_home_cache)/chromium-*" >/dev/null; }

fresh_home() { # name -> sets HOME to a new empty directory
  HOME="$SANDBOX/$1"; mkdir -p "$HOME"; rm -f "$NPX_CALLS"; : > "$NPX_CALLS"
  unset PLAYWRIGHT_BROWSERS_PATH XDG_CACHE_HOME
}

echo "where Playwright looks by default"
fresh_home paths
assert_eq "macOS home cache" "$HOME/Library/Caches/ms-playwright" "$(PLAYWRIGHT_OS=Darwin playwright_home_cache)"
assert_eq "Linux home cache" "$HOME/.cache/ms-playwright" "$(PLAYWRIGHT_OS=Linux playwright_home_cache)"
assert_eq "Linux honours XDG_CACHE_HOME" "$SANDBOX/xdg/ms-playwright" \
  "$(XDG_CACHE_HOME="$SANDBOX/xdg" PLAYWRIGHT_OS=Linux playwright_home_cache)"

echo "off when asked"
fresh_home off
WEB_TESTING=0 ensure_web_testing >/dev/null
assert_eq "WEB_TESTING=0 installs nothing" "" "$(cat "$NPX_CALLS")"
assert_fails "WEB_TESTING=0 creates no browser cache" test -e "$(playwright_home_cache)"

echo "already installed"
fresh_home present
mkdir -p "$(playwright_home_cache)/chromium-1200"
WEB_TESTING=1 ensure_web_testing >/dev/null
assert_eq "browsers in the home cache: no download" "" "$(cat "$NPX_CALLS")"
assert_eq "status" "present" "$WEB_TESTING_STATUS"

echo "found elsewhere: wired up, not downloaded again"
fresh_home elsewhere
mkdir -p "$SANDBOX/custom-browsers/chromium-1243"
PLAYWRIGHT_BROWSERS_PATH="$SANDBOX/custom-browsers" WEB_TESTING=1 ensure_web_testing >/dev/null
assert_eq "no download" "" "$(cat "$NPX_CALLS")"
assert_eq "home cache now leads to the existing browsers" "$SANDBOX/custom-browsers" \
  "$(readlink "$(playwright_home_cache)")"
assert_eq "status" "linked" "$WEB_TESTING_STATUS"

echo "found in the other OS's default location"
fresh_home otheros
mkdir -p "$HOME/.cache/ms-playwright/chromium-1243"
PLAYWRIGHT_OS=Darwin WEB_TESTING=1 ensure_web_testing >/dev/null
assert_eq "no download" "" "$(cat "$NPX_CALLS")"
assert_eq "macOS home cache linked to ~/.cache/ms-playwright" "$HOME/.cache/ms-playwright" \
  "$(readlink "$HOME/Library/Caches/ms-playwright")"

echo "the benchmark harness's private browsers are never borrowed"
fresh_home harness
mkdir -p "$HOME/.cache/vidi-agent-ms-playwright/chromium-1243"
PLAYWRIGHT_OS=Linux WEB_TESTING=1 ensure_web_testing >/dev/null
assert_eq "installed into the home cache instead" "install chromium" "$(cat "$NPX_CALLS")"
assert_fails "home cache is not a link to the harness cache" test -L "$(PLAYWRIGHT_OS=Linux playwright_home_cache)"

echo "nothing anywhere: installed"
fresh_home none
WEB_TESTING=1 ensure_web_testing >/dev/null
assert_eq "one install, of chromium" "install chromium" "$(cat "$NPX_CALLS")"
assert_eq "status" "installed" "$WEB_TESTING_STATUS"

echo "on by default"
fresh_home default
( unset WEB_TESTING; ensure_web_testing >/dev/null; [[ "$WEB_TESTING_STATUS" == installed ]] )
assert_ok "unset WEB_TESTING means install" test $? -eq 0
assert_eq "installed" "install chromium" "$(cat "$NPX_CALLS")"

echo "browsers present but older than the current Playwright wants: its build is added"
fresh_home outdated
mkdir -p "$(playwright_home_cache)/chromium-1200"
_playwright_launch_check() { compgen -G "$(playwright_home_cache)/chromium-9999" >/dev/null; }
WEB_TESTING=1 ensure_web_testing >/dev/null
assert_eq "one install" "install chromium" "$(cat "$NPX_CALLS")"
assert_eq "status" "updated" "$WEB_TESTING_STATUS"

echo "a failed launch is reported, not hidden"
fresh_home broken
_playwright_launch_check() { return 1; }
WEB_TESTING=1 ensure_web_testing >/dev/null 2>&1
assert_eq "status" "failed" "$WEB_TESTING_STATUS"

echo "install.sh"
out="$("$REPO_ROOT/install.sh" --help)"
assert_ok "--help documents --no-web-testing" grep -q -- "--no-web-testing" <<<"$out"
combo="$(cd "$REPO_ROOT/combinations" && ls -d */*/*/*/*/* | head -1)"
out="$(cd "$REPO_ROOT" && ./install.sh --dry-run "$combo" 2>&1)"
assert_ok "dry run says web testing is on by default" grep -q "Web testing  on" <<<"$out"
out="$(cd "$REPO_ROOT" && ./install.sh --dry-run --no-web-testing "$combo" 2>&1)"
assert_ok "--no-web-testing turns it off" grep -q "Web testing  off" <<<"$out"
out="$(cd "$REPO_ROOT" && WEB_TESTING=0 ./install.sh --dry-run "$combo" 2>&1)"
assert_ok "WEB_TESTING=0 turns it off" grep -q "Web testing  off" <<<"$out"
assert_ok "every combination installer runs the web-testing step" grep -q "ensure_web_testing" "$REPO_ROOT/lib/bootstrap.sh"

finish
