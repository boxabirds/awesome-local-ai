#!/usr/bin/env bash
# judge-submit.sh: hands a judge's results back to the private repo. Runs the real script against a temporary private repo
# with a local bare "origin" (no network); packdir.py finds that repo through $SPEC_BENCH_PACK_DIR.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRIPT="$REPO_ROOT/benchmarks/spec-bench/harness/judge-submit.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# A private repo on origin/main, and a judge's finished work in judging/pkg/ (not tracked: it is git-ignored locally).
make_private() {  # make_private <dir>
  local d="$1"
  git init -q --bare -b main "$d/origin.git"
  git init -q -b main "$d/private"
  mkdir -p "$d/private/packs/vidi" "$d/private/gradings/pkg"
  touch "$d/private/packs/vidi/.keep"; echo brief > "$d/private/gradings/pkg/GRADING.md"
  git -C "$d/private" add -A; git -C "$d/private" commit -q -m seed
  git -C "$d/private" remote add origin "$d/origin.git"; git -C "$d/private" push -q origin main
  mkdir -p "$d/private/judging/pkg"
  for f in build-A.jsonl build-B.jsonl test-faults.jsonl summary.md; do echo "$f content" > "$d/private/judging/pkg/$f"; done
}

run() {  # run <private dir> args... : sets RC, OUT, ERR
  local d="$1"; shift
  SPEC_BENCH_PACK_DIR="$d/private/packs/vidi" bash "$SCRIPT" "$@" >"$TMP/out" 2>"$TMP/err"; RC=$?
  OUT="$(cat "$TMP/out")"; ERR="$(cat "$TMP/err")"
}
contains() { [[ "$1" == *"$2"* ]]; }
on_origin() { git -C "$1/origin.git" ls-tree -r --name-only main; }

echo "usage and options"
run "$TMP"
assert_eq "no arguments print the usage and exit 0" "0" "$RC"
assert_ok "the usage names the script" contains "$OUT" "judge-submit.sh <package-name> <judge-label>"
run "$TMP" onlyone
assert_eq "one argument is still the usage" "0" "$RC"
run "$TMP" --help
assert_eq "--help prints the usage" "0" "$RC"
run "$TMP" pkg judge --bogus
assert_eq "an unknown option exits 2" "2" "$RC"
assert_ok "and says which" contains "$ERR" "unknown option --bogus"

echo "no private repo"
SPEC_BENCH_PACK_DIR="$TMP/none/not-a-packs-folder/vidi" bash "$SCRIPT" pkg judge >"$TMP/out" 2>"$TMP/err"; rc=$?
assert_eq "a pack that is not under a private packs/ folder exits 1" "1" "$rc"
assert_ok "and says there is no private pack repo" contains "$(cat "$TMP/err")" "no private pack repo next to this one"

echo "the judge has not finished"
A="$TMP/a"; mkdir -p "$A"; make_private "$A"; rm "$A/private/judging/pkg/summary.md"; : > "$A/private/judging/pkg/build-B.jsonl"
run "$A" pkg judge
assert_eq "a missing or empty output file exits 1" "1" "$RC"
assert_ok "and names both" contains "$ERR" "build-B.jsonl summary.md"
assert_eq "nothing was pushed" "gradings/pkg/GRADING.md
packs/vidi/.keep" "$(on_origin "$A")"

echo "transcript"
B="$TMP/b"; mkdir -p "$B"; make_private "$B"
run "$B" pkg judge --transcript "$TMP/no-such-transcript"
assert_eq "a transcript that does not exist exits 1" "1" "$RC"
assert_ok "and says where" contains "$ERR" "no transcript at $TMP/no-such-transcript"
: > "$TMP/empty-transcript"
run "$B" pkg judge --transcript "$TMP/empty-transcript"
assert_eq "an empty transcript exits 1" "1" "$RC"

echo "results without a transcript"
C="$TMP/c"; mkdir -p "$C"; make_private "$C"
run "$C" pkg judge
assert_eq "it still succeeds" "0" "$RC"
assert_ok "but notes that nobody can check the judge stayed inside the package" contains "$ERR" "no --transcript"
assert_ok "the four outputs are on origin/main" contains "$(on_origin "$C")" "gradings/pkg/results/judge/summary.md"
assert_ok "and no transcript" test -z "$(on_origin "$C" | grep transcript)"
assert_ok "the output says what was pushed" contains "$OUT" "pushed gradings/pkg/results/judge"
assert_eq "the commit says whose results" "gradings/pkg: results from judge" "$(git -C "$C/origin.git" log -1 --format=%s main)"
assert_eq "the checkout was not moved" "main" "$(git -C "$C/private" rev-parse --abbrev-ref HEAD)"
assert_eq "and its worktree list is clean again" "1" "$(git -C "$C/private" worktree list | wc -l | tr -d ' ')"

echo "results with a transcript"
D="$TMP/d"; mkdir -p "$D"; make_private "$D"
echo '{"x":1}' > "$TMP/session.jsonl"; echo plain > "$TMP/session"
run "$D" pkg gpt --transcript "$TMP/session.jsonl"
assert_eq "it succeeds" "0" "$RC"
assert_ok "the transcript keeps its extension" contains "$(on_origin "$D")" "gradings/pkg/results/gpt/transcript.jsonl"
run "$D" pkg other --transcript "$TMP/session"
assert_ok "a transcript with no extension is stored as plain 'transcript'" contains "$(on_origin "$D")" "gradings/pkg/results/other/transcript"
assert_ok "and an extensionless one has no stray dot" test -z "$(on_origin "$D" | grep 'results/other/transcript\.')"

echo "a label that is taken"
run "$D" pkg gpt --transcript "$TMP/session.jsonl"
assert_eq "an existing results/<label> on origin/main exits 1" "1" "$RC"
assert_ok "and asks for another label" contains "$ERR" "already exists on origin/main; pick another label"
assert_eq "origin/main did not gain a commit (the seed and two result commits)" "3" "$(git -C "$D/origin.git" rev-list --count main)"

finish
