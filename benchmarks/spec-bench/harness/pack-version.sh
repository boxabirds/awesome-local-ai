#!/usr/bin/env bash
# pack-version.sh <pack-dir> <pack-name> -- the version a run records for its pack.
#
# One private checkout serves every pack but sits on one tag, so `git describe` of the checkout names
# whichever tag that is. A pack's version is instead its own latest tag (<pack-name>-v*) when the pack's
# files are exactly that tag's; otherwise the tag plus the commit, "-dirty" for uncommitted edits, or
# the bare commit when the pack has no tag yet. "unversioned" outside git.
set -uo pipefail
[[ $# -eq 2 ]] || { echo "usage: $0 <pack-dir> <pack-name>" >&2; exit 2; }
DIR="$1"; NAME="$2"
git -C "$DIR" rev-parse --git-dir >/dev/null 2>&1 || { echo unversioned; exit 0; }
TAG="$(git -C "$DIR" describe --tags --abbrev=0 --match "$NAME-v*" 2>/dev/null || true)"
DIRTY=""; [[ -n "$(git -C "$DIR" status --porcelain -- . 2>/dev/null)" ]] && DIRTY="-dirty"
if [[ -n "$TAG" && -z "$DIRTY" ]] && git -C "$DIR" diff --quiet "$TAG" -- . 2>/dev/null; then
  echo "$TAG"
else
  echo "${TAG:+$TAG+}$(git -C "$DIR" rev-parse --short HEAD)$DIRTY"
fi
