#!/usr/bin/env bash
# ensure-browser.sh <acceptance-dir> [browsers-dir] -- make sure the Chromium for the held-out suite's Playwright
# version launches, installing it only when it does not. With a browsers-dir, the same for that directory (the
# agents' shared browsers). A job start on a machine that already has the browser installs nothing and contacts
# nobody; a new machine, or a new Playwright version in the suite's lock, installs once.
set -uo pipefail
[[ $# -eq 1 || $# -eq 2 ]] || { echo "usage: $0 <acceptance-dir> [browsers-dir]" >&2; exit 2; }
HERE="$(cd "$(dirname "$0")" && pwd)"
ACCEPTANCE="$1"
[[ $# -eq 2 ]] && export PLAYWRIGHT_BROWSERS_PATH="$2"
"$HERE/check-browser.sh" "$ACCEPTANCE" && exit 0
echo "installing Chromium${PLAYWRIGHT_BROWSERS_PATH:+ in $PLAYWRIGHT_BROWSERS_PATH}"
(cd "$ACCEPTANCE" && npx playwright install chromium >/dev/null) || { echo "playwright browser install failed" >&2; exit 1; }
"$HERE/check-browser.sh" "$ACCEPTANCE"
