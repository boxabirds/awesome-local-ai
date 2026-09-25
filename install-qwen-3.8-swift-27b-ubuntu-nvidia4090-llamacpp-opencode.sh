#!/usr/bin/env bash
# Swift Qwen3.8-27B  |  Ubuntu  |  RTX 4090 (24GB)  |  llama.cpp + OpenCode
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode"
. "${REPO_ROOT}/lib/bootstrap.sh"
