#!/usr/bin/env bash
# Qwen3.8-27B  |  macOS  |  64GB Apple silicon  |  MTPLX + OpenCode
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/27b/macos/64GB/mtplx-opencode"
. "${REPO_ROOT}/lib/bootstrap.sh"
