#!/usr/bin/env bash
# Relative links in Markdown must resolve inside the repo.
#
# The combination tree is seven directories deep, so a hand-counted `../`
# chain is wrong more often than it is right, and a link that escapes the
# repo root looks fine on GitHub until someone clicks it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

while IFS= read -r md; do
  # Markdown targets that are relative paths: no scheme, no anchor-only.
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    case "$target" in
      http://*|https://*|mailto:*|\#*) continue ;;
    esac
    clean="${target%%#*}"
    [[ -n "$clean" ]] || continue
    resolved="$(cd "$(dirname "$md")" 2>/dev/null && cd "$(dirname "$clean")" 2>/dev/null && pwd)/$(basename "$clean")"
    if [[ -z "$resolved" || "$resolved" == "/"* && "$resolved" != "$REPO_ROOT"* ]]; then
      _fail "$md -> $target" "a path inside the repo" "${resolved:-unresolvable}"
    elif [[ -e "$resolved" ]]; then
      _pass "$md -> $target"
    else
      _fail "$md -> $target" "an existing file" "missing: ${resolved:-unresolvable}"
    fi
  done < <(grep -oE '\]\([^)]+\)' "$md" | sed -e 's/^](//' -e 's/)$//')
done < <(find . -name '*.md' -not -path './.git/*' -not -path './demos/*' -not -path './node_modules/*' | sort)

finish
