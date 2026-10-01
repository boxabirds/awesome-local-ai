#!/usr/bin/env bash
# Relative links in Markdown must resolve inside the repo.
#
# The combination tree is seven directories deep, so a hand-counted `../`
# chain is wrong more often than it is right, and a link that escapes the
# repo root looks fine on GitHub until someone clicks it.
# A run's workspace/ is the agent's own work, mirrored without its spec/: its links aren't ours to hold.
#
# A file git ignores is not published: a link to one works on the machine that has the file and is
# dead for everyone else (and in CI), so it fails here too. A Markdown file that is itself ignored
# is nobody else's to read, and is not checked.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

# Git is asked once for the Markdown files and once for the link targets: one call per path takes
# minutes over thousands of files. Outside a git checkout (an unpacked archive) nothing is ignored.
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
ignored_of() { git check-ignore --stdin 2>/dev/null || true; }   # paths on stdin -> those git ignores
listed_in() { grep -qxF -- "$1" "$2"; }                          # path, list file

find . -name '*.md' -not -path './.git/*' -not -path './demos/*' -not -path '*/node_modules/*' \
  -not -path '*/benchmarks/*/workspace/*' | LC_ALL=C sort > "$SCRATCH/md"
ignored_of < "$SCRATCH/md" > "$SCRATCH/md-ignored"
LC_ALL=C comm -23 "$SCRATCH/md" "$SCRATCH/md-ignored" > "$SCRATCH/md-checked"   # both in the sort's byte order

# Every relative link, as "file<TAB>target<TAB>resolved path" (resolved is empty when its folder is missing).
while IFS= read -r md; do
  # Markdown targets that are relative paths: no scheme, no anchor-only.
  while IFS= read -r target; do
    [[ -n "$target" ]] || continue
    case "$target" in
      http://*|https://*|mailto:*|\#*) continue ;;
      # A run started on harness release 1 (2026-10-01.1) wrote its summary.md's policy link into the release
      # export it ran from (…/releases/harness-v…/), outside the repo. The writer is fixed from the next release; a
      # job keeps the release it started on, so those runs keep writing it until they end. Not a link anyone wrote.
      */releases/harness-v*) case "$md" in */benchmarks/*/summary.md) continue ;; esac ;;
    esac
    clean="${target%%#*}"
    [[ -n "$clean" ]] || continue
    resolved="$(cd "$(dirname "$md")" 2>/dev/null && cd "$(dirname "$clean")" 2>/dev/null && pwd)/$(basename "$clean")"
    printf '%s\t%s\t%s\n' "$md" "$target" "$resolved"
  done < <(grep -oE '\]\([^)]+\)' "$md" | sed -e 's/^](//' -e 's/)$//')
done < "$SCRATCH/md-checked" > "$SCRATCH/links"
cut -f3 "$SCRATCH/links" | sort -u | ignored_of > "$SCRATCH/target-ignored"

while IFS=$'\t' read -r md target resolved; do
  if [[ -z "$resolved" || "$resolved" == "/"* && "$resolved" != "$REPO_ROOT"* ]]; then
    _fail "$md -> $target" "a path inside the repo" "${resolved:-unresolvable}"
  elif [[ ! -e "$resolved" ]]; then
    _fail "$md -> $target" "an existing file" "missing: ${resolved:-unresolvable}"
  elif listed_in "$resolved" "$SCRATCH/target-ignored"; then
    _fail "$md -> $target" "a file published in the repo" "git-ignored, so not published: $resolved"
  else
    _pass "$md -> $target"
  fi
done < "$SCRATCH/links"

finish
