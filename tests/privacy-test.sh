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
# `you`, `user`, `<name>` and `$USER` are the documented placeholders docs use
# when showing a path the reader must substitute; everything else is a real
# account name.
leaks() {
  git ls-files -z \
    | xargs -0 grep -hoE '/(Users|home)/[A-Za-z0-9._${}<>-]+' 2>/dev/null \
    | grep -vE '/(Users|home)/(you|user|username|name|me|\$|<|\{)' \
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
# been summarised. 512 KB is well above any legitimate summary here.
big=""
while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  sz=$(wc -c < "$f" | tr -d ' ')
  (( sz > 524288 )) && big="${big} ${f}($((sz/1024))K)"
done < <(git ls-files -- 'combinations/**/benchmarks/*' 'benchmarks/*')
if [[ -n "$big" ]]; then
  _fail "no committed benchmark file over 512K" "none" "$big"
else
  _pass "no committed benchmark file over 512K"
fi

echo
echo "no stray credentials"
if git ls-files -z | xargs -0 grep -lE '(sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,})' 2>/dev/null | grep -q .; then
  _fail "no credential-shaped strings" "none" "found"
else
  _pass "no credential-shaped strings"
fi

finish
