#!/usr/bin/env bash
# Qwen3.8-Flash-Next  |  macOS  |  128GB Apple silicon  |  mlx-serve + OpenCode
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another. UNMEASURED by this repo -- read the combination README first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/flash-next/macos/128GB/mlxserve-opencode"
. "${REPO_ROOT}/lib/bootstrap.sh"
