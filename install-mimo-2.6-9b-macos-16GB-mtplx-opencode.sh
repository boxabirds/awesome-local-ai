#!/usr/bin/env bash
# MiMo-V2.6-Qwen-9B  |  macOS  |  16GB Apple silicon  |  MTPLX + OpenCode
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="mimo/2.6/9b/macos/16GB/mtplx-opencode"
. "${REPO_ROOT}/lib/bootstrap.sh"
