#!/usr/bin/env bash
# scripts/vidi-mosaic-captions.sh: a recording's blind name is turned back into the run that made it, and the run's
# record into a caption (machine, then engine and version). The repository, secret and recordings are synthetic. The
# blind names were computed with a separate Rust copy of the gallery's `blind_name` (FNV-1a over "secret\nslug\nstory"),
# so the shell version is checked against an implementation that is not itself.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRIPT="${VIDI_CAPTIONS_SCRIPT:-$REPO_ROOT/scripts/vidi-mosaic-captions.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
REPO="$WORK/repo"; REC="$WORK/state/recordings"; SECRET_FILE="$WORK/state/recording-secret"
STORY=11

# Blind names for secret "test-secret", story 11 (from the Rust copy).
NAME_A=r3d25dc8787a2a014    # m/o/strix-halo-128GB/gufo-pi, run-a
NAME_B=r920ac6a03b61f96b    # ... run-b
NAME_C=r5a0868982011830a    # ... run-c (no run.json)
NAME_D=rffe3794bc9c6fffa    # m/o/macos-128GB/mlxserve-pi, run-d
NAME_E=ra6de1a68836a996d    # m/o/nvidia4090/llamacpp-pi, run-e
NAME_REF=r52ed810012200030  # reference/opus-5.5, run-1 (no run.json)
NAME_STRANGER=rdeadbeef00000000   # a recording that belongs to no run

mkdir -p "$REC"
printf 'test-secret\n' > "$SECRET_FILE"
for n in $NAME_A $NAME_B $NAME_C $NAME_D $NAME_E $NAME_REF $NAME_STRANGER; do mkdir -p "$REC/$n/artifacts"; done

# run_json DIR HOST BACKEND ENGINE_VERSION: a run record with only the fields a caption reads.
run_json() {
  mkdir -p "$1"
  jq -n --arg host "$2" --arg backend "$3" --arg ev "$4" \
    '{host: $host, backend: $backend, model_id: "some-model", identity: {engine_version: $ev}}' > "$1/run.json"
}
COMBO="$REPO/combinations/m/o"
run_json "$COMBO/strix-halo-128GB/gufo-pi/benchmarks/vidi/run-a" "AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB" gufo "gufo version 0.5.0 (23cacbb)"
run_json "$COMBO/strix-halo-128GB/gufo-pi/benchmarks/vidi/run-b" "AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB" gufo "pasta 0.0~git20260120.386b5f5-1"
mkdir -p "$COMBO/strix-halo-128GB/gufo-pi/benchmarks/vidi/run-c"
run_json "$COMBO/macos-128GB/mlxserve-pi/benchmarks/vidi/run-d" "Apple M5 Max 128GB" mlxserve "mlx-serve 26.10.1"
run_json "$COMBO/nvidia4090/llamacpp-pi/benchmarks/vidi/run-e" "13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB" llamacpp "version: 0.5.0-dev (build 1, commit 6a2743f)"
mkdir -p "$REPO/benchmarks/reference/vidi/opus-5.5/run-1"

gen() { "$SCRIPT" --repo "$REPO" --recordings "$REC" --secret "$SECRET_FILE" --story "$STORY" "$@"; }
caption_of() { awk -F'\t' -v n="$1" '$1 == n { print $2 }' <<<"$OUT"; }

echo "captions"
OUT="$(gen 2>"$WORK/err")"
assert_ok "it runs" test $? -eq 0
assert_eq "a gufo run on the Strix Halo box: machine, then engine and its recorded version" \
  'Minisforum Strix Halo\nGufo 0.5.0' "$(caption_of $NAME_A)"
assert_eq "a version string that is not a plain x.y.z is not printed" 'Minisforum Strix Halo\nGufo' "$(caption_of $NAME_B)"
assert_eq "an mlx-serve run on the Mac" 'Apple M5 Max\nmlx-serve 26.10.1' "$(caption_of $NAME_D)"
assert_eq "a llama.cpp run on the 4090 with an unrecognised version string" 'NVIDIA RTX 4090\nllama.cpp' "$(caption_of $NAME_E)"
assert_eq "a reference (Claude) run is left out by default: the wall is of local builds" "" "$(caption_of $NAME_REF)"
assert_eq "a run with no run.json is left out, not guessed" "" "$(caption_of $NAME_C)"
assert_eq "a recording that belongs to no run is left out" "" "$(caption_of $NAME_STRANGER)"
assert_eq "four recordings are named" "4" "$(wc -l <<<"$OUT" | tr -d ' ')"
assert_ok "it says how many were named and how many were not" grep -q "4 of 7 recordings named" "$WORK/err"

echo "with --include-reference"
OUT_REF="$(gen --include-reference 2>/dev/null)"
assert_eq "a reference run with no record is named from its folder alone" 'Anthropic API\nClaude Opus 5.5' "$(awk -F'\t' -v n=$NAME_REF '$1 == n { print $2 }' <<<"$OUT_REF")"
assert_eq "and only that one is added" "5" "$(wc -l <<<"$OUT_REF" | tr -d ' ')"

echo "other story"
OUT3="$(gen --story 3 2>/dev/null)"
assert_eq "no recording belongs to the same runs for another story (the story is in the hash)" "" "$OUT3"

echo "refusals"
assert_fails "no secret file" "$SCRIPT" --repo "$REPO" --recordings "$REC" --secret "$WORK/nope" --story $STORY
assert_fails "no recordings folder" env -u VIDI_RECORDINGS "$SCRIPT" --repo "$REPO" --secret "$SECRET_FILE" --story $STORY
assert_fails "an unknown option" "$SCRIPT" --repo "$REPO" --recordings "$REC" --secret "$SECRET_FILE" --bogus

finish
