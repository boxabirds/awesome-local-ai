#!/usr/bin/env bash
# Builds tests/fixtures/lake/ from trimmed copies of real runs in the host's lake. Run it on the host that holds the lake:
#
#     tools/bench-lake/tests/fixtures/make-lake-fixture.sh --alias REAL=node-a --alias REAL=node-b \
#         --alias REAL=node-c --alias REAL=node-d [STATE_DIR] [REPO_DIR]
#
# The repository never names a machine, so the names are not in this script. Each --alias gives the machine's real name
# (take them from the local node list, ~/.config/dbench/nodes.toml) and the neutral alias the fixture uses for it: node-a
# (an RTX 4090 machine), node-b (an Apple M2), node-c (an Apple M5 Max), node-d (a Strix Halo). All four are required; the
# script stops with a message if one is missing. The lake is read under the real name; the fixture is written under the alias,
# in every path and, by plain text substitution, in every copied text file (collection.json and the like). Binary files (a
# workspace.bundle, a .gz log) are copied as they are.
#
# STATE_DIR is the lake's state folder (default ~/expts/awesome-local-ai-bench-private/state: collected/ and reference/).
# REPO_DIR is the repository whose REPO_REF is compared with the lake (default: the repository this script is in).
#
# Rules (tests/fixtures/README.md explains each run and the cell it fills):
#   * only files named in an allowlist below are copied; the held-out files of a run (accept.json, accept-report.json,
#     heldout-detail.json and the like) are not on any list;
#   * records are copied whole; raw logs are cut to their first RAW_LOG_LINES lines;
#   * a tracked file that differs from REPO_REF is dropped and written to DROPPED.tsv with the reason (TC-102);
#   * every copied file is scanned for the owner's paths, names and keys, and the script stops if one is found;
#   * after the substitution no real name may remain in any path or copied file (inside .gz files too), or the script stops.
# The folder is replaced each time. Nothing in the lake or the repository is changed.
set -euo pipefail

RAW_LOG_LINES=20
REPO_REF=origin/main
PRIVATE_PATTERNS='/Users/[a-z][a-z0-9_.-]*/|/home/[a-z][a-z0-9_.-]*/|sk-ant-|ghp_|github_pat_|BEGIN [A-Z ]*PRIVATE KEY|@gmail\.com|AKIA[0-9A-Z]{16}'
FIXTURE_BUDGET_BYTES=5242880
MIN_RECORDS="run.json run-status.json finalize.json collection.json"
STORY_FILES="accept-summary.json prompt.md base-commit gate.json"
LOG_RAW=agent-events.jsonl
LOG_COMPACT=agent-events.compact.jsonl.gz

REQUIRED_ALIASES="node-a node-b node-c node-d"

usage() { echo "usage: $0 --alias REAL=ALIAS (one for each of: $REQUIRED_ALIASES) [STATE_DIR] [REPO_DIR]" >&2; echo "take the real names from the local node list, ~/.config/dbench/nodes.toml" >&2; exit 2; }

MAP=""   # lines of REAL=ALIAS
while [ "${1:-}" = "--alias" ]; do
  [ $# -ge 2 ] && case $2 in ?*=?*) true ;; *) false ;; esac || usage
  MAP="$MAP$2"$'\n'; shift 2
done
for a in $REQUIRED_ALIASES; do
  printf '%s' "$MAP" | grep -q -F "=$a" || { echo "no --alias given for $a" >&2; usage; }
done

real_of() {   # real_of ALIAS: the real name of a node alias; "." (no node) is itself
  [ "$1" = . ] && { echo .; return; }
  printf '%s' "$MAP" | sed -n "s/^\(.*\)=$1\$/\1/p" | head -n 1
}

here=$(cd "$(dirname "$0")" && pwd)
state=${1:-$HOME/expts/awesome-local-ai-bench-private/state}
repo=${2:-$(git -C "$here" rev-parse --show-toplevel)}
out=$here/lake
dropped=$here/DROPPED.tsv
manifest=$here/MANIFEST.sha256

COMBO=combinations/qwen
RUN_A=$COMBO/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-fresh-r1          # raw and compact, complete
RUN_B=$COMBO/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/benchmarks/vidi/v2-q36fork-b-r2   # on three nodes
RUN_C=$COMBO/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/dryrun-v2r2-s2        # incomplete
RUN_D=$COMBO/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi/benchmarks/vidi/v2-r1                  # no workspace.bundle
REF_E=vidi/sonnet-5.5/v2-r1                                                              # reference, bundle, compact only
REF_F=todoodle/opus-5.5/run-1                                                            # reference, no note

[ -d "$state/collected" ] && [ -d "$state/reference" ] || { echo "not a lake state folder: $state" >&2; exit 2; }
git -C "$repo" rev-parse --verify --quiet "$REPO_REF" >/dev/null || { echo "$REPO_REF not found in $repo" >&2; exit 2; }

rm -rf "$out"; mkdir -p "$out/collected" "$out/reference"
: > "$dropped"

scan() {   # scan FILE: stop if it holds a private pattern (looks inside gzip and into a bundle's history)
  local f=$1 hits
  case $f in
    *.gz)     hits=$(gzip -dc "$f" | grep -a -c -E "$PRIVATE_PATTERNS" || true) ;;
    *.bundle) local t; t=$(mktemp -d); git clone -q --no-checkout "$f" "$t/c" 2>/dev/null
              hits=$(git -C "$t/c" log --all -p 2>/dev/null | grep -a -c -E "$PRIVATE_PATTERNS" || true); rm -rf "$t" ;;
    *)        hits=$(grep -a -c -E "$PRIVATE_PATTERNS" "$f" || true) ;;
  esac
  [ "${hits:-0}" -eq 0 ] || { echo "PRIVATE PATTERN in $f ($hits lines): fixture not built" >&2; exit 3; }
}

substitute() {   # substitute FILE: replace each real name by its alias in a text file (a .gz or a bundle is left as it is)
  case $1 in *.gz|*.bundle) return ;; esac
  local line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    LC_ALL=C sed -i '' "s/${line%%=*}/${line#*=}/g" "$1"
  done <<< "$MAP"
}

no_real_names_left() {   # stop if a real name remains in any path or copied file of the fixture
  local line real f
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    real=${line%%=*}
    [ -z "$(find "$out" -name "*$real*")" ] || { echo "a real name is left in a path: fixture not built" >&2; exit 3; }
    while IFS= read -r f; do
      case $f in
        *.gz)     ! gzip -dc "$f" | grep -a -q -F -- "$real" || { echo "a real name is left in $f: fixture not built" >&2; exit 3; } ;;
        *.bundle) ;;
        *)        ! grep -a -q -F -- "$real" "$f" || { echo "a real name is left in $f: fixture not built" >&2; exit 3; } ;;
      esac
    done < <(find "$out" -type f)
  done <<< "$MAP"
}

take() {   # take LAKE_ROOT SUBFOLDER RUN_ID REL [raw]: copy one file, or cut a raw log
  local root=$1 sub=$2 id=$3 rel=$4 mode=${5:-whole}
  local real; real=$(real_of "$sub")
  local src=$state/$root/$real/$id/$rel dest=$out/$root/$sub/$id/$rel repo_id=$id
  [ "$root" = reference ] && repo_id=benchmarks/reference/$id   # the repository tracks reference runs under benchmarks/
  [ -f "$src" ] || { echo "missing in the lake: $src" >&2; exit 2; }
  mkdir -p "$(dirname "$dest")"
  if [ "$mode" = raw ]; then head -n "$RAW_LOG_LINES" "$src" > "$dest"; else cp -p "$src" "$dest"; fi
  # a file the repository tracks must equal the lake's, or it is dropped (TC-102)
  if [ "$mode" != raw ] && git -C "$repo" cat-file -e "$REPO_REF:$repo_id/$rel" 2>/dev/null; then
    if ! git -C "$repo" cat-file blob "$REPO_REF:$repo_id/$rel" | cmp -s - "$src"; then
      printf '%s\t%s\tdiffers from %s\n' "$root/$sub/$id/$rel" "$id" "$REPO_REF" >> "$dropped"; rm -f "$dest"; return
    fi
  fi
  substitute "$dest"
  scan "$dest"
}

run_files() {   # run_files ROOT SUB ID "RECORDS" [story numbers] — records, then the story files of each story
  local root=$1 sub=$2 id=$3 records=$4; shift 4
  local r s f
  for r in $records; do take "$root" "$sub" "$id" "$r"; done
  for s in "$@"; do for f in $STORY_FILES; do take "$root" "$sub" "$id" "stories/$s/$f"; done; done
}

C=collected
# A: the owner copy with every record, story 01 whole, a raw log cut short, and the compact log.
run_files $C node-a $RUN_A "$MIN_RECORDS metrics.json progress.json" 01
take $C node-a $RUN_A stories/01/$LOG_RAW raw
take $C node-a $RUN_A stories/01/$LOG_COMPACT
# B: one id on three nodes (the real pattern), each with what it holds, small.
run_files $C node-a  $RUN_B "run.json collection.json run-status.json finalize.json metrics.json" 01
take $C node-a  $RUN_B stories/01/$LOG_COMPACT
take $C node-a  $RUN_B workspace.bundle
run_files $C node-c  $RUN_B "run.json collection.json run-status.json"
run_files $C node-d   $RUN_B "collection.json progress.json"
# C: an incomplete run (a dry run the repository does not track: only files that pass the privacy scan).
run_files $C node-a $RUN_C "run.json collection.json finalize.json progress.json"
# D: the real v2-r1 run that has no workspace.bundle.
run_files $C node-d $RUN_D "collection.json progress.json"
# E: a reference run with a bundle and a compact log only.
run_files reference . $REF_E "collection.json run.json run-status.json finalize.json metrics.json progress.json" 01
take reference . $REF_E workspace.bundle
take reference . $REF_E stories/01/$LOG_COMPACT
# F: a hand-built reference run, no collection note.
run_files reference . $REF_F "run.json run-status.json"
# G: the real empty node-level 'benchmarks' folder cannot be kept in git; the tests make it (README: Empty folders).

no_real_names_left

# the lake keeps reference runs at reference/<pack>/<stack>/<run>: the id above drops the leading 'reference/'
find "$out" -type f ! -name MANIFEST.sha256 | LC_ALL=C sort | sed "s|^$out/||" | while read -r f; do
  printf '%s  %s\n' "$(shasum -a 256 < "$out/$f" | cut -d' ' -f1)" "$f"; done > "$manifest"

bytes=$(find "$out" -type f -exec stat -f %z {} + 2>/dev/null | paste -sd+ - | bc)
echo "fixture: $(wc -l < "$manifest" | tr -d ' ') files, $bytes bytes (budget $FIXTURE_BUDGET_BYTES), dropped $(wc -l < "$dropped" | tr -d ' ')"
[ "$bytes" -le "$FIXTURE_BUDGET_BYTES" ] || { echo "over the size budget" >&2; exit 4; }
