#!/usr/bin/env bash
# Qwen3.8-Flash-Next  |  Ubuntu  |  Strix Halo 128GB  |  Strata + pi
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and every line of logic lives in lib/.
# The engine was measured on this machine with UD-Q4_K_XL (README); not yet benchmarked -- read the combination README first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/flash-next/ubuntu/strix-halo-128GB/strata-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
