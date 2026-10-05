#!/usr/bin/env bash
# Swift 1.5 Qwen3.8-Flash-Next  |  Ubuntu  |  RTX 4090  |  Strata + pi
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and every line of logic lives in lib/.
# Never run: the fine-tune half of the Strata pair. Read the combination README first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8-swift-1.5/flash-next/ubuntu/nvidia4090/strata-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
