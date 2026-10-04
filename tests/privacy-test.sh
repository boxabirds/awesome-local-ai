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
# Nor is a regular expression for the word, with its flags: `/home/i` (in an agent's own tests).
# The detector, over NUL-separated paths on stdin. Separate from `git ls-files` so it can be tested, and it always
# returns 0: grep exits 1 when a file has no match and xargs exits 123 when a whole batch has none, so the exit
# status says nothing about whether anything leaked. Only the output does. Reading the status as "no leaks" is how
# this check passed on 4 Oct 2026 with nine tracked files holding a real home path (A-040): with `pipefail` set, one
# batch without a match made the whole pipeline non-zero and the `&&` below fell through to the pass.
scan_paths() {
  xargs -0 ${PRIVACY_BATCH:+-n "$PRIVACY_BATCH"} grep -hoE '(^|[^A-Za-z0-9_.-])/(Users|home)/[A-Za-z0-9._${}<>-]+' 2>/dev/null \
    | sed -E 's|^[^/]||' \
    | grep -vE '/(Users|home)/((you|user|username|name|me|tester|someoneelse|u|x|i|g|gi|ig)$|\.|\$|<|\{)' \
    | sort -u
  return 0
}
# The whole decision, so the self-check below exercises what the repo is judged by, not just the detector.
found_leak() {
  local found
  found="$(scan_paths)"
  [[ -n "$found" ]] && printf '%s' "$found"
}

# A leak in a file after one with no match: the case the old check read as a pass.
selfcheck_dir="$(mktemp -d)"
printf 'nothing personal here\n' > "$selfcheck_dir/clean.txt"
# The account name is joined to the path at run time, so this file never holds a string the check would flag.
selfcheck_home="/Users""/arealname"
printf 'built in %s/work\n' "$selfcheck_home" > "$selfcheck_dir/leaky.txt"
selfcheck="$(printf '%s\0' "$selfcheck_dir/clean.txt" "$selfcheck_dir/leaky.txt" | PRIVACY_BATCH=1 found_leak)"
rm -rf "$selfcheck_dir"
if [[ "$selfcheck" == "$selfcheck_home" ]]; then
  _pass "a leak is found when an earlier file has none"
else
  _fail "a leak is found when an earlier file has none" "$selfcheck_home" "${selfcheck:-nothing}"
fi

out="$(git ls-files -z | found_leak)"
if [[ -n "$out" ]]; then
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
# Each kind of committed benchmark file has a size limit. The table is publicise.size_limit, which the harness
# also uses before every commit, so the two can't disagree.
if ! listed="$(uv run --quiet --python '>=3.11' "$REPO_ROOT/benchmarks/spec-bench/harness/publicise.py" over-limit "$REPO_ROOT")"; then
  _fail "no committed benchmark file over its size limit" "a list" "publicise.py over-limit failed"
elif [[ -n "$listed" ]]; then
  _fail "no committed benchmark file over its size limit" "none" \
    "$(printf '%s\n' "$listed" | awk -F'\t' '{ printf " %s(%dK > %dK)", $1, $2 / 1024, $3 / 1024 }')"
else
  _pass "no committed benchmark file over its size limit"
fi

echo
echo "no local machine names in tracked files"
# A machine is named here by its hardware ("the Strix Halo box"); its own name is personal setup. The names live
# only in the local, git-ignored dbench node list (~/.config/dbench/nodes.toml), so they are read from there and
# never written into this repo (machine_names.py; the harness refuses them in its commits the same way). The
# agent's own work under a run's workspace/ is its own. Without a node list there is nothing to look for.
if ! command -v uv >/dev/null 2>&1; then
  echo "  skip  no uv to run the check"
else
  out="$(uv run --quiet --python '>=3.11' "$REPO_ROOT/benchmarks/spec-bench/harness/machine_names.py" tracked "$REPO_ROOT")"
  rc=$?
  if [[ "$out" == skip:* ]]; then
    echo "  $out"
  elif (( rc == 0 )); then
    _pass "no tracked file names a machine in the local node list"
  else
    _fail "no tracked file names a machine in the local node list" "none" "$(printf '%s' "$out" | tr '\n' ' ')"
  fi
fi

echo
echo "no stray credentials"
if git ls-files -z | xargs -0 grep -lE '(sk-[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY|ghp_[A-Za-z0-9]{20,})' 2>/dev/null | grep -q .; then
  _fail "no credential-shaped strings" "none" "found"
else
  _pass "no credential-shaped strings"
fi

finish
