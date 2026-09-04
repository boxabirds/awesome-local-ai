#!/usr/bin/env bash
# run.sh -- alias for ./start.sh, kept so existing docs and muscle memory work.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${REPO_ROOT}/start.sh" "$@"
