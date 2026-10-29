#!/usr/bin/env bash
# Qwen3.8-Flash-Next  |  DGX OS (Ubuntu 24.04)  |  DGX Spark 128GB  |  llama.cpp (CUDA) + pi
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/flash-next/ubuntu/dgx-spark/llamacpp-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
