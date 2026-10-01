#!/usr/bin/env bash
# Qwen3.8-Flash-Next  |  macOS  |  128GB Apple silicon  |  TensorFold + pi
#
# STAGED: this pointer belongs at the repository root, beside the other install-*.sh scripts. It waits in
# tools/tensorfold-check/staged/ until the owner approves moving it.
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and every line of logic lives in lib/.
# UNMEASURED, and blocked until tools/tensorfold-check/run-checks.sh passes -- read the combination README first.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.8/flash-next/macos/128GB/tensorfold-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
