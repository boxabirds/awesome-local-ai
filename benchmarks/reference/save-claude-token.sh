#!/usr/bin/env bash
# save-claude-token.sh -- create a Claude Code subscription token and store it for the harness.
#
#   benchmarks/reference/save-claude-token.sh            # runs `claude setup-token`, then asks you to paste it
#   benchmarks/reference/save-claude-token.sh --paste    # just paste an existing token
#
# The token goes to ~/.dbench/claude-oauth-token (or $CLAUDE_BENCH_TOKEN_FILE), mode 600. The agent
# sandbox hides ~/.dbench, and the harness passes the token to Claude Code only as an environment variable.
set -euo pipefail
TOKEN_FILE="${CLAUDE_BENCH_TOKEN_FILE:-$HOME/.dbench/claude-oauth-token}"
if [[ "${1:-}" != --paste ]]; then
  command -v claude >/dev/null || { echo "claude is not on PATH" >&2; exit 1; }
  echo "Opening the browser to approve a long-lived token for your Claude subscription..."
  claude setup-token
fi
printf "Paste the token and press Enter: "
IFS= read -r -s token; echo
token="$(printf '%s' "$token" | tr -d '[:space:]')"
[[ -n "$token" ]] || { echo "no token entered" >&2; exit 1; }
mkdir -p "$(dirname "$TOKEN_FILE")"
umask 077
printf '%s\n' "$token" > "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"
echo "saved to $TOKEN_FILE (600)"
