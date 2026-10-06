#!/usr/bin/env bash
# Committed SQL over the warehouse must not treat `stories.run` as unique.
#
# A run NAME is reused by every combination that runs that series: on 6 October 2026 `v2-r4` named three
# different runs, on three machines, in three stacks. A window or aggregate partitioned by `run` alone therefore
# mixes them. The strategic-insights note on truncated stories computed each story's gain as
#   passed - lag(passed) over (partition by run order by story)
# and so subtracted gufo's story 4 on the Strix Halo box from llama.cpp's story 5 on the 4090, inventing a
# regression of -24 held-out tests that was then written up as "the largest single regression in the record".
# The same mistake was in the FM-5 detector. Nothing in the suite could see either.
#
# The key is (stack, run). Where a query really does want one stack's runs, say so on the line with a
# `-- run-unique:` marker giving the reason; the marker is the point, because it makes the author look.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
trap 'rm -f "$LOG_FILE"' EXIT

# A line is an offence when it partitions or groups by `run` (optionally table-qualified) and neither mentions
# `stack` nor carries the marker. `run` has to be the whole column name and be followed by something that ends a
# SQL column list, or the pattern reads English prose about "a group by run id" as a query.
OFFENCE='(partition|group)[[:space:]]+by[[:space:]]+([a-z_]+\.)?run[[:space:]]*($|[,);]|order[[:space:]]|having[[:space:]]|window[[:space:]])'

offends() { # <line> -> 0 when the line is an offence
  local line="$1"
  grep -Eqi "$OFFENCE" <<< "$line" || return 1
  grep -qi 'stack' <<< "$line" && return 1
  grep -q -- '-- run-unique:' <<< "$line" && return 1
  return 0
}

echo "the detector itself works"
assert_ok    "it flags a bare partition by run"      offends "passed - lag(passed,1,0) over (partition by run order by story)"
assert_ok    "it flags a qualified one"              offends "select run from x group by s.run"
assert_ok    "it flags an uppercase one"             offends "PARTITION BY run ORDER BY story"
assert_fails "it allows (stack, run)"                offends "over (partition by stack, run order by cast(story as integer))"
assert_fails "it allows a declared exception"        offends "group by run  -- run-unique: one stack, filtered above"
assert_fails "it ignores prose about a run"          offends "each run is partitioned by the story it ended on"
# runGroups.ts says "every other group by run id in natural order". That is English, and the first version of
# this detector flagged it.
assert_fails "it ignores prose naming another column" offends "every other group by run id in natural order"

echo
echo "and no committed file treats a run name as unique"
hits=0
while IFS= read -r f; do
  case "$f" in *node_modules/*) continue;; esac
  [[ -f "$REPO_ROOT/$f" ]] || continue
  while IFS=: read -r lineno line; do
    [[ -n "${lineno:-}" ]] || continue
    if offends "$line"; then
      hits=$((hits+1))
      printf '         %s:%s\n' "$f" "$lineno" >&2
    fi
  done < <(grep -Ein "$OFFENCE" "$REPO_ROOT/$f" 2>/dev/null || true)
done < <(git -C "$REPO_ROOT" ls-files -- '*.md' '*.sql' '*.rs' '*.ts' '*.js' '*.sh' '*.py')
assert_eq "no query partitions or groups by run alone" "0" "$hits"

finish
