#!/usr/bin/env bash
# Underdog Saluki 27B (2-bit, MTP)  |  Ubuntu  |  RTX 4090 (24GB)  |  llama.cpp + pi
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
