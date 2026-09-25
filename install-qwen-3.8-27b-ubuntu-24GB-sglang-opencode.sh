#!/usr/bin/env bash
# DEPRECATED NAME -- kept so existing links and notes keep working.
# The machine segment now names the GPU the numbers were measured on, so this
# combination moved to install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh. Remove this alias once nothing points here.
set -euo pipefail
echo "note: install-qwen-3.8-27b-ubuntu-24GB-sglang-opencode.sh was renamed to install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh" >&2
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh" "$@"
