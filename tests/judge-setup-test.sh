#!/usr/bin/env bash
# judge-setup.sh: prepares a blinded grading package from the private pack repo. Runs the real script against a temporary
# private repo with a local bare "origin" (no network); packdir.py finds that repo through $SPEC_BENCH_PACK_DIR.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRIPT="$REPO_ROOT/benchmarks/spec-bench/harness/judge-setup.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

# A private repo with gradings/<name>/{GRADING.md,build-A,build-B} on origin/main.
make_private() {  # make_private <dir> [with-grading-md]
  local d="$1" md="${2:-yes}"
  git init -q --bare -b main "$d/origin.git"
  git init -q -b main "$d/private"
  mkdir -p "$d/private/packs/vidi" "$d/private/gradings/pkg/build-A" "$d/private/gradings/pkg/build-B"
  [[ "$md" == yes ]] && echo "grade it" > "$d/private/gradings/pkg/GRADING.md"
  echo a > "$d/private/gradings/pkg/build-A/index.html"; echo b > "$d/private/gradings/pkg/build-B/index.html"
  touch "$d/private/packs/vidi/.keep"
  git -C "$d/private" add -A; git -C "$d/private" commit -q -m seed
  git -C "$d/private" remote add origin "$d/origin.git"; git -C "$d/private" push -q origin main
}

run() {  # run <private dir> args... : sets RC, OUT, ERR
  local d="$1"; shift
  SPEC_BENCH_PACK_DIR="$d/private/packs/vidi" run_capturing "$TMP/out" "$TMP/err" bash "$SCRIPT" "$@"; RC=$?
  OUT="$(cat "$TMP/out")"; ERR="$(cat "$TMP/err")"
}
contains() { [[ "$1" == *"$2"* ]]; }

echo "usage and options"
run "$TMP"
assert_eq "no arguments print the usage and exit 0" "0" "$RC"
assert_ok "the usage names the script" contains "$OUT" "judge-setup.sh <package-name>"
run "$TMP" --help
assert_eq "--help prints the usage and exit 0" "0" "$RC"
run "$TMP" -h
assert_eq "-h prints the usage and exit 0" "0" "$RC"
run "$TMP" pkg --bogus
assert_eq "an unknown option exits 2" "2" "$RC"
assert_ok "and says which" contains "$ERR" "unknown option --bogus"

echo "no private repo"
mkdir -p "$TMP/none"
SPEC_BENCH_PACK_DIR="$TMP/none/not-a-packs-folder/vidi" run_capturing "$TMP/out" "$TMP/err" bash "$SCRIPT" pkg; rc=$?
assert_eq "a pack that is not under a private packs/ folder exits 1" "1" "$rc"
assert_ok "and says there is no private pack repo" contains "$(cat "$TMP/err")" "no private pack repo next to this one"

echo "a package that is already there"
A="$TMP/a"; mkdir -p "$A"; make_private "$A"; mkdir -p "$A/private/judging/pkg"
run "$A" pkg
assert_eq "an existing package folder exits 1 (the judge's work may be in it)" "1" "$RC"
assert_ok "and says to move it aside" contains "$ERR" "already exists"

echo "a ref without the package"
B="$TMP/b"; mkdir -p "$B"; make_private "$B"
run "$B" nosuchpackage
assert_eq "no gradings/<name> at the ref exits 1" "1" "$RC"
assert_ok "and names the package and the ref" contains "$ERR" "no gradings/nosuchpackage at origin/main"

echo "a package without a brief"
C="$TMP/c"; mkdir -p "$C"; make_private "$C" no
run "$C" pkg
assert_eq "an extraction with no GRADING.md exits 1" "1" "$RC"
assert_ok "and says so" contains "$ERR" "extraction failed: no GRADING.md"

echo "a good package"
D="$TMP/d"; mkdir -p "$D"; make_private "$D"
run "$D" pkg
assert_eq "it exits 0" "0" "$RC"
assert_ok "the brief is extracted" test -s "$D/private/judging/pkg/GRADING.md"
assert_ok "both builds are extracted" test -f "$D/private/judging/pkg/build-B/index.html"
assert_ok "the kickoff message is written" test -s "$D/private/judging/pkg.kickoff.md"
assert_ok "the kickoff names the judge's port" grep -q 'ACCEPT_PORT=19787' "$D/private/judging/pkg.kickoff.md"
assert_ok "and the ports to avoid" grep -q '8787, 18787 and 18788' "$D/private/judging/pkg.kickoff.md"
assert_ok "the output says the package is ready" contains "$OUT" "package ready:"
assert_ok "and lists the builds" contains "$OUT" "build-A build-B"
assert_eq "the checkout is not moved (still on main)" "main" "$(git -C "$D/private" rev-parse --abbrev-ref HEAD)"
exclude="$(git -C "$D/private" rev-parse --path-format=absolute --git-path info/exclude)"
assert_eq "judging/ is excluded locally exactly once" "1" "$(grep -cx '/judging/' "$exclude")"
git -C "$D/private" show origin/main:gradings/pkg/GRADING.md >/dev/null
mkdir -p "$D/private/gradings/pkg2/build-A"; echo "g" > "$D/private/gradings/pkg2/GRADING.md"; echo x > "$D/private/gradings/pkg2/build-A/f"
git -C "$D/private" add -A; git -C "$D/private" commit -q -m two; git -C "$D/private" push -q origin main
run "$D" pkg2
assert_eq "a second package works" "0" "$RC"
assert_eq "and does not duplicate the exclude line" "1" "$(grep -cx '/judging/' "$exclude")"

echo "--ref"
E="$TMP/e"; mkdir -p "$E"; make_private "$E"
git -C "$E/private" checkout -q -b other
echo "other brief" > "$E/private/gradings/pkg/GRADING.md"; git -C "$E/private" commit -q -am other; git -C "$E/private" push -q origin other
git -C "$E/private" checkout -q main
run "$E" pkg --ref origin/other
assert_eq "--ref reads that ref" "0" "$RC"
assert_eq "and extracts its content, not main's" "other brief" "$(cat "$E/private/judging/pkg/GRADING.md")"

finish
