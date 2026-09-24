#!/usr/bin/env bash
# Qwen3.8-27B EXL3 3.00bpw  |  Ubuntu  |  24GB NVIDIA (RTX 3090)  |  SGLang (Docker) + OpenCode
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. NOT measured by this repo -- see its README.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/27b/ubuntu/24GB/sglang-opencode"
. "${REPO_ROOT}/lib/bootstrap.sh"
