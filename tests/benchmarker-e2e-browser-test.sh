#!/usr/bin/env bash
# tools/benchmarker's end-to-end script installs the browser its own Playwright needs before it runs a test.
# On 8 Nov 2026 the release check failed 603 of 614 tests at launch: the shared browser cache had lost build 1243,
# which Playwright 1.63.0 needs, and nothing put it back. `playwright install --only-shell chromium` does nothing
# when the build is there and downloads it once when it is not.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
PKG="${BENCHMARKER_PACKAGE_JSON:-$REPO_ROOT/tools/benchmarker/package.json}"   # the override lets a broken copy prove the test can fail

script="$(jq -r '.scripts["test:e2e"]' "$PKG")"
steps="$(printf '%s' "$script" | sed 's/ *&& */\n/g')"
install_at="$(printf '%s\n' "$steps" | grep -n '^playwright install --only-shell chromium$' | cut -d: -f1 | head -1)"
test_at="$(printf '%s\n' "$steps" | grep -n '^playwright test' | cut -d: -f1 | head -1)"
assert_ok "the script installs its Playwright's headless browser" test -n "$install_at"
assert_ok "the script runs the tests" test -n "$test_at"
assert_ok "the install comes before the tests" test "${install_at:-99}" -lt "${test_at:-0}"
finish
