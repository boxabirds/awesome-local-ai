#!/usr/bin/env bash
# Nothing personal or machine-specific gets published.
#
# This repo is for anyone. Two things have already slipped through once:
# absolute /Users/<name>/ paths inside migrated tool output, and per-request
# telemetry from real coding sessions. Neither is obvious by eye in a JSON blob
# of a few hundred fields, so check it mechanically.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"
cd "$REPO_ROOT"

echo "no home paths in tracked files"
# The runtime's whole no-absolute-paths invariant exists so a pasted file never
# leaks a username; committed evidence has to hold to the same rule.
# `you`, `user`, `<name>` and `$USER` are the documented placeholders docs use (tests also use `tester`, `u`,
# `x`, `someoneelse`: whole names only, so a real name that merely starts with u or x still fails)
# when showing a path the reader must substitute; everything else is a real
# account name. A match must start a path (not `next/prev/home/end` in prose),
# and a hidden folder such as /home/.cache is not an account.
leaks() {
  git ls-files -z \
    | xargs -0 grep -hoE '(^|[^A-Za-z0-9_.-])/(Users|home)/[A-Za-z0-9._${}<>-]+' 2>/dev/null \
    | sed -E 's|^[^/]||' \
    | grep -vE '/(Users|home)/((you|user|username|name|me|tester|someoneelse|u|x)$|\.|\$|<|\{)' \
    | sort -u
}
if out="$(leaks)" && [[ -n "$out" ]]; then
  _fail "no /Users/<name> or /home/<name> in tracked files" "none" "$(printf '%s' "$out" | tr '\n' ' ')"
else
  _pass "no /Users/<name> or /home/<name> in tracked files"
fi

echo
echo "no per-request telemetry committed"
# Request logs carry hundreds of fields from real sessions. Summaries are fine;
# the raw rows are not ours to publish.
rows() { git ls-files -- '*requests*.jsonl' '*request-log*' 2>/dev/null; }
if out="$(rows)" && [[ -n "$out" ]]; then
  _fail "no request-level logs tracked" "none" "$(printf '%s' "$out" | tr '\n' ' ')"
else
  _pass "no request-level logs tracked"
fi

echo
echo "committed evidence stays small"
# A results file large enough to matter is usually raw capture that should have
# been summarised. 512 KB is well above any legitimate summary here. Some kinds are
# large on purpose, and each has its own ceiling instead:
#   workspace.bundle                 the agent's git history, which re-scoring and judging rebuild from
#   <run>/workspace/**               the agent's own work, mirrored (agents write large test images)
#   agent-events.compact.jsonl.gz    the lossless conversation log (drive.EVENT_LOG_MAX_BYTES)
#   metrics.json                     per-story records with conversation profiles
KB=1024; MB=$((1024 * 1024))
limit_for() {
  case "$1" in
    */workspace.bundle) echo $((20 * MB)) ;;
    */workspace/*) echo $((20 * MB)) ;;
    */agent-events.compact.jsonl.gz) echo $((50 * MB)) ;;
    */metrics.json) echo $((2 * MB)) ;;
    *) echo $((512 * KB)) ;;
  esac
}
big=""
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  sz=$(wc -c < "$f" | tr -d ' ')
  lim=$(limit_for "$f")
  (( sz > lim )) && big="${big} ${f}($((sz/KB))K > $((lim/KB))K)"
done < <(git ls-files -- 'combinations/**/benchmarks/*' 'benchmarks/*')
if [[ -n "$big" ]]; then
  _fail "no committed benchmark file over its size limit" "none" "$big"
else
  _pass "no committed benchmark file over its size limit"
fi

echo
echo "no stray credentials"
if git ls-files -z | xargs -0 grep -lE '(sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,})' 2>/dev/null | grep -q .; then
  _fail "no credential-shaped strings" "none" "found"
else
  _pass "no credential-shaped strings"
fi

finish
