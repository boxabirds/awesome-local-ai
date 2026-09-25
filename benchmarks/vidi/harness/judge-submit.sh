#!/usr/bin/env bash
# judge-submit.sh <package-name> <judge-label> [--transcript FILE] -- hand a judge's results back.
#
#   benchmarks/vidi/harness/judge-submit.sh vidi-v1 gpt-5.6 --transcript ~/Downloads/judge-session.jsonl
#
# Copies the judge's output files from <private repo>/judging/<name>/ (and its session transcript, so
# it can be checked for reads outside the package) to gradings/<name>/results/<judge-label>/ in the
# private repo, then commits and pushes that from a temporary checkout: the repo's own checkout,
# which benchmark runs read their held-out suite from, is never moved. Un-blind on the machine that
# holds the key with judge_collect.py.
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ $# -ge 2 && "$1" != -h && "$1" != --help ]] || { sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0; }
NAME="$1"; JUDGE="$2"; shift 2
TRANSCRIPT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --transcript) TRANSCRIPT="$2"; shift 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done
OUTPUTS=(build-A.jsonl build-B.jsonl test-faults.jsonl summary.md)

PRIVATE="$(cd "$HARNESS" && python3 -c 'import packdir; from pathlib import Path; r = packdir.private_root(packdir.resolve(Path("..").resolve())); print(r or "")')"
[[ -n "$PRIVATE" ]] || { echo "no private pack repo next to this one" >&2; exit 1; }
SRC="$PRIVATE/judging/$NAME"
missing=(); for f in "${OUTPUTS[@]}"; do [[ -s "$SRC/$f" ]] || missing+=("$f"); done
[[ ${#missing[@]} -eq 0 ]] || { echo "the judge hasn't written: ${missing[*]} (in $SRC)" >&2; exit 1; }
[[ -z "$TRANSCRIPT" || -s "$TRANSCRIPT" ]] || { echo "no transcript at $TRANSCRIPT" >&2; exit 1; }
[[ -n "$TRANSCRIPT" ]] || echo "note: no --transcript, so nobody can check the judge stayed inside the package" >&2

TMP="$(mktemp -d)"
trap 'git -C "$PRIVATE" worktree remove --force "$TMP/wt" 2>/dev/null || true; rm -rf "$TMP"' EXIT
git -C "$PRIVATE" fetch -q origin
git -C "$PRIVATE" worktree add -q --detach "$TMP/wt" origin/main
DEST="$TMP/wt/gradings/$NAME/results/$JUDGE"
[[ -e "$DEST" ]] && { echo "gradings/$NAME/results/$JUDGE already exists on origin/main; pick another label" >&2; exit 1; }
mkdir -p "$DEST"
for f in "${OUTPUTS[@]}"; do cp "$SRC/$f" "$DEST/$f"; done
if [[ -n "$TRANSCRIPT" ]]; then
  base="${TRANSCRIPT##*/}"; ext=""; [[ "$base" == *.* ]] && ext=".${base##*.}"
  cp "$TRANSCRIPT" "$DEST/transcript$ext"
fi
git -C "$TMP/wt" add "gradings/$NAME/results/$JUDGE"
git -C "$TMP/wt" commit -q -m "gradings/$NAME: results from $JUDGE"
git -C "$TMP/wt" push -q origin HEAD:main
echo "pushed gradings/$NAME/results/$JUDGE ($(ls "$DEST" | tr '\n' ' '))"
