#!/usr/bin/env bash
# The failure block of the install summary: it must name what actually went
# wrong, not only generic causes. First seen on tritus, where the server
# refused a removed flag (`error: invalid argument: --no-mmap`) and the summary
# suggested a busy device, PROFILE=balanced (a profile that combination does
# not have) and incomplete weights.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT
STRIX="$REPO_ROOT/combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi"

failure() { # smoke.log contents -> the block, colours stripped
  printf '%s\n' "$1" > "$SCRATCH/smoke.log"
  bash -c 'LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/lib/summary.sh"
    _summary_what_went_wrong "'"$SCRATCH"'/smoke.log" "'"$STRIX"'/profiles.tsv"' 2>&1 \
    | sed 's/\x1b\[[0-9;]*m//g'
}

echo "the summary quotes the server's own error"
out="$(failure $'0.00.000.285 I srv  llama_server: initializing ...\nerror: invalid argument: --no-mmap')"
assert_ok "the error line is quoted"          grep -q 'The server said: error: invalid argument: --no-mmap' <<< "$out"
assert_ok "the log is still named"            grep -q "smoke.log" <<< "$out"
out="$(failure $'load_tensors: ...\nGGML_ASSERT(buf != NULL) failed\nAborted')"
assert_ok "an assert counts as the error"     grep -q 'The server said: GGML_ASSERT(buf != NULL) failed' <<< "$out"
out="$(failure $'load_tensors: loading\nsrv  llama_server: model loaded')"
assert_fails "nothing is quoted when no line looks like an error" grep -q 'The server said' <<< "$out"

echo
echo "the profile advice names this combination's profiles"
assert_fails "no PROFILE=balanced where there is none" grep -q 'balanced' <<< "$out"
assert_ok "...it lists the ones there are"    grep -q 'coding, vision, agents, max' <<< "$out"

finish
