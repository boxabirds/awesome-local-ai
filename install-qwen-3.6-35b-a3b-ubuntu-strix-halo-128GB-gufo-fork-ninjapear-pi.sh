#!/usr/bin/env bash
# Qwen3.6-35B-A3B (Q6dense)  |  Ubuntu 26.04  |  Strix Halo 128GB  |  NinjaPear's gufo fork, from source + pi
#
# A pointer, nothing more. The config lives in combinations/<this path>/ and
# every line of logic lives in lib/. See docs/adding-a-combination.md to add
# another.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMBINATION="qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi"
. "${REPO_ROOT}/lib/bootstrap.sh"
