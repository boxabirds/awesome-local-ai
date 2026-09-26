#!/usr/bin/env bash
# setup-node.sh -- prepare this machine to run a benchmark pack (vidi by default), and prove the
# sandbox holds.
#
#   benchmarks/spec-bench/harness/setup-node.sh [--pack benchmarks/vidi] [--stack benchmarks/reference/vidi/opus-5.5]
#       [--pack-ref vidi-v1]
#
# Checks the tools the harness needs and says how to install anything missing (it installs nothing
# system-wide). Then, all user-level and idempotent:
#   1. clones the private pack repo next to this one, pinned to --pack-ref (default: the pack's
#      bench.json "pack_ref"; vidi's is vidi-v1);
#   2. installs the held-out suite's dependencies and Playwright's Chromium, if the pack has a suite;
#   3. with --stack, registers that stack (install-stack.sh) and checks its client and token;
#   4. runs the sandbox preflight (for a Claude stack: Claude Code must authenticate in the sandbox
#      and fail to see the held-out suite).
# Exits non-zero if anything is missing, printing every problem, not just the first.
set -uo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HARNESS/../../.." && pwd)"
PRIVATE_REPO_NAME="awesome-local-ai-bench-private"
PRIVATE_REPO_URL="git@github.com:boxabirds/$PRIVATE_REPO_NAME.git"
PACK="benchmarks/vidi"
PACK_REF=""
MIN_NODE_MAJOR=20
STACK=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pack) PACK="${2%/}"; shift 2 ;;
    --stack) STACK="${2%/}"; shift 2 ;;
    --pack-ref) PACK_REF="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
[[ -n "$PACK_REF" ]] || PACK_REF="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1])).get("pack_ref", ""))' \
  "$REPO_ROOT/$PACK/bench.json" 2>/dev/null)"

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
# Tools the pack's builds need beyond node (bench.json "tools", e.g. bun for a bun workspace).
for tool in $(python3 -c 'import json, sys; print(" ".join(json.load(open(sys.argv[1])).get("tools", [])))' \
                "$REPO_ROOT/$PACK/bench.json" 2>/dev/null); do
  need "$tool" "the $PACK pack's builds need it; see its README"
done

echo "repos"
if git -C "$REPO_ROOT" ls-remote --exit-code origin HEAD >/dev/null 2>&1; then ok "public repo reachable (records are pushed here)"
else bad "push access to the public repo's origin (records are committed and pushed per story)"; fi
if [[ -n "$(git -C "$REPO_ROOT" config user.email)" && -n "$(git -C "$REPO_ROOT" config user.name)" ]]; then
  ok "git identity $(git -C "$REPO_ROOT" config user.name) <$(git -C "$REPO_ROOT" config user.email)> (records are committed as it)"
else bad "a git identity: git config --global user.name '…' && git config --global user.email '…' (every story is a commit)"; fi
PACK_ROOT="$(dirname "$REPO_ROOT")/$PRIVATE_REPO_NAME"
if [[ -z "$PACK_REF" ]]; then
  ok "$PACK has no pack_ref in bench.json: it runs from this repo, no private pack needed"
elif [[ ! -d "$PACK_ROOT/.git" ]]; then
  if git clone -q "$PRIVATE_REPO_URL" "$PACK_ROOT" 2>/dev/null; then ok "cloned the private pack to $PACK_ROOT"
  else bad "the private pack repo ($PRIVATE_REPO_URL): ask the owner for access"; fi
fi
if [[ -n "$PACK_REF" && -d "$PACK_ROOT/.git" ]]; then
  git -C "$PACK_ROOT" fetch -q --tags origin 2>/dev/null
  if git -C "$PACK_ROOT" checkout -q "$PACK_REF" 2>/dev/null; then ok "pack at $(git -C "$PACK_ROOT" describe --tags --always)"
  else bad "pack ref $PACK_REF (git -C $PACK_ROOT tag -l)"; fi
fi

. "$HARNESS/playwright-platform.sh"   # Ubuntu newer than Playwright knows: use its 24.04 Chromium
[[ -n "${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE:-}" ]] && echo "  note  using Playwright's ${PLAYWRIGHT_HOST_PLATFORM_OVERRIDE} Chromium on this Ubuntu"

# Shared libraries a downloaded Chromium cannot find (Linux), as a hint for the apt line.
missing_browser_libs() {
  local b
  for b in "$HOME"/.cache/ms-playwright/chromium*/chrome*-linux64/chrome*; do
    [[ -x "$b" && ! -d "$b" ]] || continue
    ldd "$b" 2>/dev/null | awk '/not found/ {print $1}'
  done | sort -u | tr '\n' ' '
}

ACC="$(python3 "$HARNESS/packdir.py" --pack "$PACK" acceptance)"
if [[ ${#problems[@]} -eq 0 && ! -d "$ACC/tests" ]]; then
  echo "held-out suite"
  ok "none for $PACK (acceptance is reported n/a)"
elif [[ ${#problems[@]} -eq 0 ]]; then
  echo "held-out suite dependencies"
  if (cd "$ACC" && npm ci --no-audit --no-fund --silent && npx playwright install chromium >/dev/null); then ok "installed in $ACC"
  else bad "npm ci / playwright install in $ACC"; fi
  if out="$("$HARNESS/check-browser.sh" "$ACC")"; then ok "$out"
  else
    bad "$out"
    libs="$([[ "$(uname)" == Linux ]] && missing_browser_libs)"
    [[ -n "$libs" ]] && bad "Chromium needs these libraries: $libs-- install the packages that provide them (Ubuntu 26.04: sudo apt install libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxdamage1 libasound2t64 libcups2t64)"
  fi
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
