#!/usr/bin/env bash
# install-stack.sh <stack-dir> -- register a reference stack on this machine so run.sh and dbench can
# run it: writes ~/.local/share/<INSTALL_ID>/install.env from <stack-dir>/stack.env. Nothing is
# downloaded; the stack's client (e.g. `claude`) must already be on PATH.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ $# -eq 1 ]] || { echo "usage: $0 <stack-dir>   (e.g. benchmarks/reference/vidi/opus-5.5)" >&2; exit 2; }
STACK="${1%/}"; STACK_ENV="$REPO_ROOT/$STACK/stack.env"
[[ -f "$STACK_ENV" ]] || { echo "no $STACK_ENV" >&2; exit 1; }
# shellcheck disable=SC1090
source "$STACK_ENV"
command -v "$CLIENT" >/dev/null || echo "warning: '$CLIENT' is not on PATH; install it before running" >&2
DEST="$HOME/.local/share/$INSTALL_ID"
mkdir -p "$DEST"
cat > "$DEST/install.env" <<ENV
# Written by benchmarks/reference/install-stack.sh from $STACK/stack.env
INSTALL_ID="$INSTALL_ID"
COMBINATION="reference/${STACK##*/}"
BACKEND="$BACKEND"
MODEL_ID="$MODEL_ID"
CLIENT="$CLIENT"
RUN_BASE="$STACK"
CONFIG_FILE="$STACK/stack.env"
ENV
echo "installed $INSTALL_ID -> $DEST/install.env (runs go to $STACK/<run-id>)"
[[ "$CLIENT" != claude ]] || [[ -f "${CLAUDE_BENCH_TOKEN_FILE:-$HOME/.dbench/claude-oauth-token}" ]] \
  || echo "note: no Claude token yet: run 'claude setup-token' and save it to ~/.dbench/claude-oauth-token (chmod 600)"
