#!/usr/bin/env bash
# Qwen3.8-Flash-Next  |  Ubuntu  |  RTX 4090  |  Strata + pi
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and every line of logic lives in lib/.
# Measured once (horizon/strata.md); not yet benchmarked -- read the combination README first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
