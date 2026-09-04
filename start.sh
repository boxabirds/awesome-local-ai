#!/usr/bin/env bash
# start.sh -- start whatever combination this machine has installed.
#
# A pointer, like the install-*.sh scripts. The logic is in lib/run.sh, which
# discovers installs from the manifests the installer left behind rather than
# guessing, so it keeps working as combinations are added.
#
#   ./start.sh           the common case: server on demand, client, then stop
#   ./start.sh --list    what is installed
#   ./start.sh --help    everything it can do
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "${REPO_ROOT}/lib/run.sh"
