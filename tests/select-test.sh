#!/usr/bin/env bash
# Selection: does this repo pick the right combination for a given machine?
#
# Pure logic -- the host is faked, so this runs anywhere and is the test that
# catches a combination added with a malformed path or an unreachable tier.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
LOG_FILE="$(mktemp)"; export LOG_FILE
. "$DIR/lib.sh"
. "$REPO_ROOT/lib/common.sh"
. "$REPO_ROOT/lib/select.sh"

echo "memory segment parsing"
assert_eq "24GB  -> 24576 MiB"  24576  "$(_memory_segment_mib 24GB)"
assert_eq "64GB  -> 65536 MiB"  65536  "$(_memory_segment_mib 64GB)"
assert_eq "128GB -> 131072 MiB" 131072 "$(_memory_segment_mib 128GB)"
assert_eq "512MB -> 512 MiB"    512    "$(_memory_segment_mib 512MB)"
assert_eq "unparseable -> 0"    0      "$(_memory_segment_mib bogus)"
assert_eq "empty -> 0"          0      "$(_memory_segment_mib '')"

pick() { # os arch accel mem_mib family
  HOST_OS="$1"; HOST_ARCH="$2"; HOST_ACCEL="$3"; HOST_MEM_MIB="$4"
  HOST_OS_PRETTY="test"; HOST_MEM_DESC="test"
  best_for_host "$5"
}

echo
echo "selection by machine class"
assert_eq "128GB Apple silicon takes Flash-Next" \
  "qwen/3.8/flash-next/macos/128GB/mtplx-opencode" "$(pick macos arm64 metal 131072 qwen)"
assert_eq "64GB Apple silicon takes the 27B" \
  "qwen/3.8/27b/macos/64GB/mtplx-opencode"         "$(pick macos arm64 metal 65536 qwen)"
assert_eq "96GB cannot reach the 128GB tier" \
  "qwen/3.8/27b/macos/64GB/mtplx-opencode"         "$(pick macos arm64 metal 98304 qwen)"
assert_eq "36GB Mac matches nothing"       "" "$(pick macos arm64 metal 36864 qwen)"
assert_eq "16GB Mac matches nothing"       "" "$(pick macos arm64 metal 16384 qwen)"
assert_eq "Intel Mac matches nothing"      "" "$(pick macos x86_64 none 0 qwen)"

echo
echo "nameplate memory is never exact"
assert_eq "RTX 4090 reporting 24564 still qualifies for the 24GB tier" \
  "qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode" "$(pick ubuntu x86_64 cuda 24564 qwen)"
assert_eq "a 12GB card does not" "" "$(pick ubuntu x86_64 cuda 12282 qwen)"

echo
echo "OS families"
assert_eq "Pop!_OS is offered the Ubuntu combination" \
  "qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode" "$(pick pop x86_64 cuda 24564 qwen)"
assert_eq "Fedora is not (refuse rather than half-install)" \
  "" "$(pick fedora x86_64 cuda 24564 qwen)"
assert_eq "a Mac is never offered an Ubuntu combination" \
  "" "$(pick macos arm64 metal 131072 nosuchfamily)"

echo
echo "every combination is reachable and installable"
while IFS= read -r combo; do
  [[ -n "$combo" ]] || continue
  script="$(installer_script_for "$combo")"
  assert_ok "root installer exists: $script" test -x "$REPO_ROOT/$script"
  for f in config.sh profiles.tsv help.txt; do
    assert_ok "$combo has $f" test -f "$REPO_ROOT/combinations/$combo/$f"
  done
  tier="$(_memory_segment_mib "$(printf '%s' "$combo" | cut -d/ -f5)")"
  if [[ "$tier" == "0" ]]; then
    _fail "$combo has a parseable memory segment" "non-zero MiB" "0"
  else
    _pass "$combo has a parseable memory segment ($tier MiB)"
  fi
done < <(list_combinations)

rm -f "$LOG_FILE"
finish
