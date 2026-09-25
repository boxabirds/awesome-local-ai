#!/usr/bin/env bash
# setup-node.sh -- prepare this machine to run Vidi benchmarks, and prove the sandbox holds.
#
#   benchmarks/vidi/harness/setup-node.sh [--stack benchmarks/reference/vidi/opus-5.5] [--pack-ref vidi-v1]
#
# Checks the tools the harness needs and says how to install anything missing (it installs nothing
# system-wide). Then, all user-level and idempotent:
#   1. clones the private pack repo next to this one, pinned to --pack-ref (default vidi-v1);
#   2. installs the held-out suite's dependencies and Playwright's Chromium;
#   3. with --stack, registers that stack (install-stack.sh) and checks its client and token;
#   4. runs the sandbox preflight (for a Claude stack: Claude Code must authenticate in the sandbox
#      and fail to see the held-out suite).
# Exits non-zero if anything is missing, printing every problem, not just the first.
set -uo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HARNESS/../../.." && pwd)"
PRIVATE_REPO_NAME="awesome-local-ai-bench-private"
PRIVATE_REPO_URL="git@github.com:boxabirds/$PRIVATE_REPO_NAME.git"
PACK_REF="vidi-v1"
MIN_NODE_MAJOR=20
STACK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --stack) STACK="${2%/}"; shift 2 ;;
    --pack-ref) PACK_REF="$2"; shift 2 ;;
    -h|--help) sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

problems=()
ok() { echo "  ok    $*"; }
bad() { echo "  MISSING $*"; problems+=("$*"); }
need() {  # need <command> <how to install>
  if command -v "$1" >/dev/null; then ok "$1 ($(command -v "$1"))"; else bad "$1 -- install: $2"; fi
}

echo "tools"
need git "xcode-select --install   (or: brew install git)"
need uv "brew install uv   (or: curl -LsSf https://astral.sh/uv/install.sh | sh)"
need rsync "brew install rsync"
if command -v node >/dev/null; then
  major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
  if (( major >= MIN_NODE_MAJOR )); then ok "node $(node --version)"; else bad "node >= $MIN_NODE_MAJOR (have $(node --version)) -- brew install node"; fi
else
  bad "node >= $MIN_NODE_MAJOR -- brew install node"
fi
if [[ "$(uname)" == Darwin ]]; then need sandbox-exec "part of macOS"; else need bwrap "sudo apt install bubblewrap"; fi

echo "repos"
if git -C "$REPO_ROOT" ls-remote --exit-code origin HEAD >/dev/null 2>&1; then ok "public repo reachable (records are pushed here)"
else bad "push access to the public repo's origin (records are committed and pushed per story)"; fi
PACK_ROOT="$(dirname "$REPO_ROOT")/$PRIVATE_REPO_NAME"
if [[ ! -d "$PACK_ROOT/.git" ]]; then
  if git clone -q "$PRIVATE_REPO_URL" "$PACK_ROOT" 2>/dev/null; then ok "cloned the private pack to $PACK_ROOT"
  else bad "the private pack repo ($PRIVATE_REPO_URL): ask the owner for access"; fi
fi
if [[ -d "$PACK_ROOT/.git" ]]; then
  git -C "$PACK_ROOT" fetch -q --tags origin 2>/dev/null
  if git -C "$PACK_ROOT" checkout -q "$PACK_REF" 2>/dev/null; then ok "pack at $(git -C "$PACK_ROOT" describe --tags --always)"
  else bad "pack ref $PACK_REF (git -C $PACK_ROOT tag -l)"; fi
fi

if [[ ${#problems[@]} -eq 0 ]]; then
  echo "held-out suite dependencies"
  ACC="$(python3 "$HARNESS/packdir.py" acceptance)"
  if (cd "$ACC" && npm ci --no-audit --no-fund --silent && npx playwright install chromium >/dev/null); then ok "installed in $ACC"
  else bad "npm ci / playwright install in $ACC"; fi
  if out="$("$HARNESS/check-browser.sh" "$ACC")"; then ok "$out"; else bad "$out"; fi
fi

if [[ -n "$STACK" ]]; then
  echo "stack $STACK"
  "$REPO_ROOT/benchmarks/reference/install-stack.sh" "$STACK" | sed 's/^/  /'
  CLIENT="$(sed -n 's/^CLIENT="\(.*\)".*/\1/p' "$REPO_ROOT/$STACK/stack.env")"
  need "$CLIENT" "see the stack's README"
  if [[ "$CLIENT" == claude ]]; then
    TOKEN_FILE="${CLAUDE_BENCH_TOKEN_FILE:-$HOME/.dbench/claude-oauth-token}"
    if [[ -s "$TOKEN_FILE" ]]; then
      perm="$(stat -f %Lp "$TOKEN_FILE" 2>/dev/null || stat -c %a "$TOKEN_FILE")"
      [[ "$perm" == 600 ]] && ok "token $TOKEN_FILE (600)" || bad "token $TOKEN_FILE should be chmod 600 (is $perm)"
    else
      bad "Claude token: run 'claude setup-token', save it to $TOKEN_FILE, chmod 600"
    fi
    [[ -z "${ANTHROPIC_API_KEY:-}" ]] || echo "  note  ANTHROPIC_API_KEY is set in your shell; the harness removes it from the agent, so runs still bill the subscription"
  fi
fi

if [[ ${#problems[@]} -gt 0 ]]; then
  echo; echo "not ready: ${#problems[@]} problem(s) above"; exit 1
fi
echo "sandbox preflight"
(cd "$HARNESS" && uv run --quiet preflight.py --client "${CLIENT:-pi}") || { echo "preflight failed"; exit 1; }
echo; echo "ready"
