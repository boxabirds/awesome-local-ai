#!/usr/bin/env bash
# Run whatever combination this machine has installed.
#
# A pointer, like the install-*.sh scripts. The logic is in lib/run.sh.
#   ./run.sh --help    what it can do
#   ./run.sh --list    what is installed
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${REPO_ROOT}/lib/run.sh"
