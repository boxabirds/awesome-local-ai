#!/usr/bin/env bash
# check-browser.sh <acceptance-dir> -- launch the held-out suite's browser, exactly as its tests will.
# An install that "succeeds" can still leave no usable browser; only a launch proves it. Exit 0 if it
# launches, else print Playwright's reason and exit 1.
set -uo pipefail
[[ $# -eq 1 ]] || { echo "usage: $0 <acceptance-dir>" >&2; exit 2; }
cd "$1" || exit 1
node -e '
require("@playwright/test").chromium.launch()
  .then(b => { console.log("browser launches"); return b.close(); })
  .catch(e => { console.log("browser does not launch: " + e.message.split("\n")[0]); process.exit(1); })'
