#!/usr/bin/env bash
# DEPRECATED NAME -- kept so existing links and notes keep working.
# The machine segment now names the GPU the numbers were measured on, so this
# combination moved to install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh. Remove this alias once nothing points here.
set -euo pipefail
echo "note: install-bonsai-2-27b-ubuntu-24GB-llamacpp-opencode.sh was renamed to install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh" >&2
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh" "$@"
