#!/usr/bin/env bash
# Names the recordings of the gallery for vidi-mosaic.sh --captions.
#
# The gallery names each recording folder by a hash of a secret, the run's slug and the story, so a judge cannot tell
# which build it is. This undoes that for a marketing video: it hashes every run in the repository the same way, keeps
# the runs whose recording is on disk, and writes one line per recording: the recording's folder name, a tab, and a
# caption of two lines (machine, then engine and version), with the line break written as \n.
#
# Reference runs (Claude, run through its own client) are left out unless --include-reference: the wall is of local
# builds.
#
# The output names the builds behind the blind recordings. Keep it out of the repository (output/ is ignored).
set -euo pipefail

PROG="$(basename "$0")"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
RECORDINGS="${VIDI_RECORDINGS:-}"
SECRET_FILE=""
STORY=3
OUT=""
INCLUDE_REFERENCE=0

# FNV-1a, 64 bits, as the gallery's `blind_name` computes it (tools/vidi-gallery/src/builds.rs).
FNV_OFFSET=-3750763034362895579   # 0xcbf29ce484222325 as a signed 64-bit number
FNV_PRIME=1099511628211           # 0x100000001b3
# A version is shown only when the record holds a plain x.y.z, with at most the engine's own prefix before it.
VERSION_PATTERN='^(gufo version |mlx-serve |v)?([0-9]+\.[0-9]+\.[0-9]+)([^0-9.]|$)'

usage() {
  cat <<EOF
Usage: $PROG --recordings DIR [options]

  --recordings DIR   the gallery's recordings folder (or set VIDI_RECORDINGS)
  --secret FILE      the gallery's secret                  (default: recording-secret next to the recordings folder)
  --repo DIR         the repository holding the run records (default: this one)
  --story N          story the recordings are of           (default $STORY)
  --include-reference  also name the reference (Claude) runs, which are left out by default
  --out FILE         write here instead of to standard output
  -h, --help         this text
EOF
}
die() { printf '%s: %s\n' "$PROG" "$*" >&2; exit 2; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --include-reference) INCLUDE_REFERENCE=1; shift; continue ;;
    --recordings|--secret|--repo|--story|--out)
      [ $# -ge 2 ] || die "$1 needs a value"
      case "$1" in
        --recordings) RECORDINGS="$2" ;; --secret) SECRET_FILE="$2" ;; --repo) REPO="$2" ;;
        --story) STORY="$2" ;;           --out) OUT="$2" ;;
      esac
      shift 2 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[ -n "$RECORDINGS" ] || die "no recordings folder: use --recordings DIR or set VIDI_RECORDINGS"
[ -d "$RECORDINGS" ] || die "not a folder: $RECORDINGS"
[ -n "$SECRET_FILE" ] || SECRET_FILE="$(dirname "$RECORDINGS")/recording-secret"
[ -s "$SECRET_FILE" ] || die "no secret at $SECRET_FILE (use --secret FILE)"
[ -d "$REPO" ] || die "not a folder: $REPO"
case "$STORY" in ''|*[!0-9]*) die "--story must be a whole number" ;; esac
command -v jq >/dev/null || die "jq is needed"
SECRET="$(tr -d '\n' < "$SECRET_FILE")"

fnv_name() { # text -> r<16 hex digits>
  local h=$FNV_OFFSET b
  for b in $(printf '%s' "$1" | od -An -v -tu1); do h=$(( (h ^ b) * FNV_PRIME )); done
  printf 'r%016x' "$h"
}
slug_of() { printf '%s' "$1/$2" | sed 's/[^A-Za-z0-9.-]/_/g'; }

machine_name() { # host string from run.json
  case "$1" in
    *"RYZEN AI MAX+ 395"*) printf 'Minisforum Strix Halo' ;;
    *"RTX 4090"*) printf 'NVIDIA RTX 4090' ;;
    *"Apple M5 Max"*) printf 'Apple M5 Max' ;;
    *) printf '%s' "$1" ;;
  esac
}
engine_name() { # run.json backend
  case "$1" in
    gufo) printf 'Gufo' ;;                         gufo-fork-ninjapear) printf 'Gufo (NinjaPear fork)' ;;
    mlxserve) printf 'mlx-serve' ;;                llamacpp) printf 'llama.cpp' ;;
    strata) printf 'Strata' ;;                     *) printf '%s' "$1" ;;
  esac
}
claude_name() { # reference stack folder, e.g. opus-5.5 -> Claude Opus 5.5
  local family="${1%%-*}" version="${1#*-}"
  printf 'Claude %s %s' "$(printf '%s' "$family" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')" "$version"
}

caption_for() { # run folder, setup -> caption on stdout, or nothing when the record does not say
  local dir="$1" setup="$2" host backend ev ver
  case "$setup" in
    reference/*) printf 'Anthropic API\\n%s' "$(claude_name "${setup#reference/}")"; return ;;
  esac
  [ -s "$dir/run.json" ] || return 0
  host="$(jq -r '.host // ""' "$dir/run.json")"
  backend="$(jq -r '.backend // ""' "$dir/run.json")"
  [ -n "$host" ] && [ -n "$backend" ] || return 0
  ev="$(jq -r '.identity.engine_version // .backend_version // ""' "$dir/run.json")"
  ver=""
  if [[ "$ev" =~ $VERSION_PATTERN ]]; then ver="${BASH_REMATCH[2]}"; fi
  printf '%s\\n%s%s' "$(machine_name "$host")" "$(engine_name "$backend")" "${ver:+ $ver}"
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/vidi-captions.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
RUNS="$TMP/runs.tsv"; : > "$RUNS"
# combinations/<...>/benchmarks/vidi/<run>/ (any depth) and benchmarks/reference/vidi/<stack>/<run>/
if [ -d "$REPO/combinations" ]; then
  find "$REPO/combinations" -type d -path '*/benchmarks/vidi' | while read -r v; do
    setup="${v#"$REPO"/combinations/}"; setup="${setup%/benchmarks/vidi}"
    for r in "$v"/*/; do [ -d "$r" ] && printf '%s\t%s\t%s\n' "$setup" "$(basename "$r")" "${r%/}"; done
  done >> "$RUNS"
fi
if [ "$INCLUDE_REFERENCE" = 1 ] && [ -d "$REPO/benchmarks/reference/vidi" ]; then
  for s in "$REPO"/benchmarks/reference/vidi/*/; do
    for r in "$s"*/; do [ -d "$r" ] && printf 'reference/%s\t%s\t%s\n' "$(basename "$s")" "$(basename "$r")" "${r%/}"; done
  done >> "$RUNS"
fi

FOUND=0; NAMED=0
for rec in "$RECORDINGS"/r*/; do [ -d "$rec" ] && FOUND=$((FOUND + 1)); done
RESULT="$TMP/result.tsv"; : > "$RESULT"
while IFS=$'\t' read -r setup run dir; do
  name="$(fnv_name "$(printf '%s\n%s\n%s' "$SECRET" "$(slug_of "$setup" "$run")" "$STORY")")"
  [ -d "$RECORDINGS/$name" ] || continue
  caption="$(caption_for "$dir" "$setup")"
  [ -n "$caption" ] || continue
  printf '%s\t%s\n' "$name" "$caption" >> "$RESULT"
  NAMED=$((NAMED + 1))
done < "$RUNS"

printf '%s: %s of %s recordings named\n' "$PROG" "$NAMED" "$FOUND" >&2
if [ -n "$OUT" ]; then mkdir -p "$(dirname "$OUT")"; sort "$RESULT" > "$OUT"; else sort "$RESULT"; fi
