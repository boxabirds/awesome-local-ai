#!/usr/bin/env bash
# tests/make-corpus-test.sh -- the corpus script the collector's file-name check stands on
# (tools/dbench/tests/fixtures/make-corpus.sh). Real inputs in the shape the script reads, no mocks.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib.sh
source "$HERE/lib.sh"
SCRIPT="$HERE/../tools/dbench/tests/fixtures/make-corpus.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

TRACKED="$WORK/tracked.txt"
NODE="$WORK/node.names"
COMB="combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r1"
REF="benchmarks/reference/vidi/opus-5.5/run-1"

corpus() { bash "$SCRIPT" --commit abc123 --tracked "$TRACKED" --node-names "$NODE"; }
names()  { corpus | grep -v '^#'; }

# --- unit: normalisation, one name shape at a time -------------------------------------------------------------------
: > "$TRACKED"
printf '%s\n' \
  stories/07/prompt.md \
  stories/123/agent-events.compact.jsonl.gz \
  rescore/vidi-v2.0-pre2/rescore.json \
  rescore/vidi-v2.0-pre2/stories/12/accept-summary.json \
  rescore-spoiled/vidi-v2.0-pre2-20261009T125355/set-aside.json \
  rescore/vidi-v2.0-pre2/stories/03/artifacts/story-03-x/test-failed-1.png \
  stories/04/artifacts/a/b/c.md \
  stories/04/scoring-2/x/accept.json \
  stories/04/screenshots/shot-01.png \
  stories/04/pre-suite-fix/y.json \
  superseded/old-run/stories/01/accept.json \
  base/accept-summary.json \
  workspace/src/deep/file.ts \
  control/skip-story.json \
  .progress.json.1234.tmp \
  stories/01/artifacts/.y.tmp \
  .x.partial \
  > "$NODE"
GOT="$(names)"
want() { # description line
  if grep -qxF -- "$2" <<<"$GOT"; then _pass "$1"; else _fail "$1" "a line $2" "$(tr '\n' '|' <<<"$GOT")"; fi
}
unwanted() { # description line
  if grep -qxF -- "$2" <<<"$GOT"; then _fail "$1" "no line $2" "present"; else _pass "$1"; fi
}
want "a story number becomes NN" "stories/NN/prompt.md"
want "a three-digit story number becomes NN" "stories/NN/agent-events.compact.jsonl.gz"
want "a re-score folder name becomes V" "rescore/V/rescore.json"
want "a story number inside a re-score becomes NN" "rescore/V/stories/NN/accept-summary.json"
want "a spoiled re-score folder name becomes V" "rescore-spoiled/V/set-aside.json"
want "artifacts inside a re-score keep their depth and drop their content" "rescore/V/stories/NN/artifacts/NAME/NAME.png"
want "artifacts keep depth, the last segment keeps its extension" "stories/NN/artifacts/NAME/NAME/NAME.md"
want "scoring-2 becomes scoring-N" "stories/NN/scoring-N/NAME/NAME.json"
want "screenshots drop their content" "stories/NN/screenshots/NAME.png"
want "pre-suite-fix drops its content" "stories/NN/pre-suite-fix/NAME.json"
want "a superseded folder name becomes NAME and its content too" "superseded/NAME/NAME/NAME/NAME.json"
want "base content drops its names" "base/NAME.json"
want "the workspace is one line" "workspace/NAME"
want "control is one line" "control/NAME"
unwanted "an in-flight temporary is dropped" ".progress.json.1234.tmp"
unwanted "a temporary in a tree is dropped" "stories/NN/artifacts/NAME.tmp"
unwanted "a partial is dropped" ".x.partial"
assert_eq "no workspace file name survives" "0" "$(grep -c 'deep/file.ts' <<<"$GOT")"
assert_eq "the output is sorted and distinct" "$(sort -u <<<"$GOT")" "$GOT"

# --- integration: the header's counts and the tracked-file mapping ----------------------------------------------------
printf '%s\n' \
  "$COMB/run.json" "$COMB/stories/01/prompt.md" "$COMB/stories/02/prompt.md" \
  "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r2/run.json" \
  "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r2/workspace/a/b.ts" \
  "$REF/run.json" "$REF/prompts/story-01.md" "$REF/OMITTED.txt" \
  "benchmarks/reference/vidi/opus-5.5/stack.env" \
  "combinations/qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi/config.sh" \
  > "$TRACKED"
: > "$NODE"
HEADER="$(corpus | grep '^#')"
assert_eq "the header names the commit" "1" "$(grep -c '^# commit: abc123$' <<<"$HEADER")"
assert_eq "the header counts tracked run directories" "1" "$(grep -c '^# tracked run directories: 3 (combination 2, reference 1)$' <<<"$HEADER")"
assert_eq "the header counts run records" "1" "$(grep -c '^# tracked run records (run.json): 3 (combination 2, reference 1)$' <<<"$HEADER")"
assert_eq "the header counts the node listings" "1" "$(grep -c '^# node listings merged: 1$' <<<"$HEADER")"
GOT="$(names)"
want "a tracked combination file maps to its run-relative name" "stories/NN/prompt.md"
want "a tracked reference file maps to its run-relative name" "prompts/story-NN.md"
want "an odd reference file is kept for the owner to see" "OMITTED.txt"
want "a tracked workspace file is one line" "workspace/NAME"
unwanted "a stack definition is not a run file" "stack.env"
unwanted "a combination's config is not a run file" "config.sh"

# --- integration: the node side lists real files and prunes the workspace ---------------------------------------------
NODEREPO="$WORK/repo"
RUN="$NODEREPO/$COMB"
mkdir -p "$RUN/stories/01" "$RUN/workspace/node_modules/x" "$NODEREPO/benchmarks/reference/vidi/opus-5.5/run-9"
echo '{}' > "$RUN/run.json"
echo p > "$RUN/stories/01/prompt.md"
echo '{}' > "$RUN/workspace/node_modules/x/run.json"
echo x > "$RUN/workspace/a.ts"
echo '{}' > "$NODEREPO/benchmarks/reference/vidi/opus-5.5/run-9/run.json"
LISTED="$(bash "$SCRIPT" --list-node-runs "$NODEREPO" | sort)"
assert_eq "the node listing has the run's files, the workspace as one line, and a reference run" \
  "run.json
run.json
stories/01/prompt.md
workspace/x" "$LISTED"

assert_fails "an unknown argument is refused" bash "$SCRIPT" --nope
assert_fails "the tracked list is required" bash "$SCRIPT" --commit abc

finish
