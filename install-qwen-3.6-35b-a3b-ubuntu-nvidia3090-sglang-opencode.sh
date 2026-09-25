#!/usr/bin/env bash
# Qwen3.6-35B-A3B EXL3 3.00bpw-H5  |  Ubuntu  |  RTX 3090 (24GB)  |  SGLang (Docker) + OpenCode
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. NOT measured by this repo -- see its README.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode"
. "${REPO_ROOT}/lib/bootstrap.sh"
