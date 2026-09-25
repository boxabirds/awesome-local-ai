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

echo
echo "machine segments name the accelerator they were measured on"
assert_eq "legacy memory-only segment matches any accelerator" "any|24576"         "$(_machine_segment 24GB)"
assert_eq "a platform sold in several sizes carries its memory" "strix-halo|131072" "$(_machine_segment strix-halo-128GB)"
assert_eq "...and its smaller sibling"                          "strix-halo|65536"  "$(_machine_segment strix-halo-64GB)"
assert_eq "a single-size device implies its memory"             "cuda|24576"        "$(_machine_segment nvidia4090)"
assert_eq "a 5090 is 32GB"                                      "cuda|32768"        "$(_machine_segment nvidia5090)"
assert_eq "an Apple chip tier maps to the metal family"         "metal|131072"      "$(_machine_segment m5max-128GB)"
assert_eq "an unknown device never qualifies"                   "unknown|0"         "$(_machine_segment nvidia9999)"
assert_eq "_memory_segment_mib reads whole machine segments"    131072              "$(_memory_segment_mib strix-halo-128GB)"
assert_eq "...including single-size devices"                    24576               "$(_memory_segment_mib nvidia4090)"

echo
echo "Strix Halo hosts are detected from sysfs"
FAKE_PCI="$(mktemp -d)"
mkdir -p "$FAKE_PCI/0000:c5:00.0" "$FAKE_PCI/0000:c6:00.0"
printf '0x1002\n' > "$FAKE_PCI/0000:c5:00.0/vendor"; printf '0x1586\n' > "$FAKE_PCI/0000:c5:00.0/device"
printf '536870912\n' > "$FAKE_PCI/0000:c5:00.0/mem_info_vram_total"
printf '0x10ec\n' > "$FAKE_PCI/0000:c6:00.0/vendor"; printf '0x8127\n' > "$FAKE_PCI/0000:c6:00.0/device"
assert_ok    "an AMD 1002:1586 device is a Strix Halo GPU" env SYSFS_PCI="$FAKE_PCI" bash -c \
  '. "'"$REPO_ROOT"'/lib/select.sh"; _has_strix_halo_gpu'
assert_eq    "the BIOS carve-out is read from amdgpu sysfs" "536870912" \
  "$(SYSFS_PCI="$FAKE_PCI" _strix_halo_sysfs mem_info_vram_total)"
rm -f "$FAKE_PCI/0000:c5:00.0/device"; printf '0x150e\n' > "$FAKE_PCI/0000:c5:00.0/device"
assert_fails "another AMD GPU is not" env SYSFS_PCI="$FAKE_PCI" bash -c \
  '. "'"$REPO_ROOT"'/lib/select.sh"; _has_strix_halo_gpu'
rm -rf "$FAKE_PCI"

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
assert_eq "36GB Mac: no qwen combination fits below the 64GB tier" \
  ""                                                "$(pick macos arm64 metal 36864 qwen)"
assert_eq "16GB Apple silicon: no qwen combination fits" \
  ""                                                "$(pick macos arm64 metal 16384 qwen)"
assert_eq "16GB Apple silicon takes MiMo when asked for the mimo family" \
  "mimo/2.6/9b/macos/16GB/mtplx-opencode"           "$(pick macos arm64 metal 16384 mimo)"
assert_eq "128GB Apple silicon never gets MiMo as best fit across all families" \
  "qwen/3.8/flash-next/macos/128GB/mtplx-opencode"  "$(pick macos arm64 metal 131072 '')"
assert_eq "an 8GB Mac matches nothing"     "" "$(pick macos arm64 metal 8192 '')"
assert_eq "Intel Mac matches nothing"      "" "$(pick macos x86_64 none 0 qwen)"

echo
echo "nameplate memory is never exact"
assert_eq "RTX 4090 reporting 24564 still qualifies for the 24GB tier" \
  "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode" "$(pick ubuntu x86_64 cuda 24564 qwen)"
assert_eq "a 12GB card does not" "" "$(pick ubuntu x86_64 cuda 12282 qwen)"

echo
echo "unmeasured combinations (AUTO_SELECT=0) are never the silent pick"
assert_eq "a 24GB NVIDIA card still defaults to the measured llama.cpp 27B, not SGLang" \
  "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode" "$(pick ubuntu x86_64 cuda 24576 qwen)"
assert_eq "across all families too" \
  "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode" "$(pick ubuntu x86_64 cuda 24576 '')"
HOST_OS=ubuntu; HOST_ARCH=x86_64; HOST_ACCEL=cuda; HOST_MEM_MIB=24576
compat="$(candidates_for_host qwen | cut -d'|' -f2)"
assert_ok "the SGLang 27B is still listed as compatible" \
  grep -qxF "qwen/3.8/27b/ubuntu/nvidia3090/sglang-opencode" <<< "$compat"
assert_ok "the SGLang 35B-A3B is still listed as compatible" \
  grep -qxF "qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode" <<< "$compat"
assert_eq "an opted-out combination ranks last in its tier" \
  "qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode" \
  "$(candidates_for_host qwen | head -1 | cut -d'|' -f2)"

echo
echo "OS families"
assert_eq "Pop!_OS is offered the Ubuntu combination" \
  "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode" "$(pick pop x86_64 cuda 24564 qwen)"
assert_eq "Fedora is not (refuse rather than half-install)" \
  "" "$(pick fedora x86_64 cuda 24564 qwen)"
assert_eq "a Mac is never offered an Ubuntu combination" \
  "" "$(pick macos arm64 metal 131072 nosuchfamily)"

echo
echo "Strix Halo: unified memory on Linux, its own accelerator family"
STRIX="qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi"
assert_eq "a 128GB Strix Halo (RAM + 512M carve-out) takes Flash-Next" \
  "$STRIX" "$(pick ubuntu x86_64 strix-halo 128512 qwen)"
assert_eq "...across all families too" \
  "$STRIX" "$(pick ubuntu x86_64 strix-halo 128512 '')"
assert_eq "a 64GB Strix Halo cannot reach the 128GB tier" \
  "" "$(pick ubuntu x86_64 strix-halo 65024 qwen)"
assert_eq "a 24GB CUDA card is never offered the Strix Halo row" \
  "qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode" "$(pick ubuntu x86_64 cuda 24564 qwen)"
HOST_OS=ubuntu; HOST_ARCH=x86_64; HOST_ACCEL=cuda; HOST_MEM_MIB=131072
assert_fails "even a (hypothetical) 128GB CUDA device is not" \
  grep -qxF "$STRIX" <<< "$(candidates_for_host qwen | cut -d'|' -f2)"
HOST_ACCEL=strix-halo; HOST_MEM_MIB=128512
assert_fails "a Strix Halo is not offered the 24GB NVIDIA rows" \
  grep -q nvidia <<< "$(candidates_for_host qwen | cut -d'|' -f2)"
assert_eq "an unmeasured row is still what a Strix Halo is offered, as the only one" \
  "$STRIX" "$(best_for_host qwen)"
# tritus: a 128GB Strix Halo reports 126155 MiB, inside selection's 5% slack
HOST_OS=ubuntu; HOST_ACCEL=strix-halo; HOST_MEM_MIB=126155
assert_eq "a real 128GB Strix Halo (126155 MiB) is offered the 128GB row" "$STRIX" "$(best_for_host qwen)"
why="$(explain_no_match pi 2>&1)"
assert_fails "...so a miss on another selector does not blame its memory" \
  grep -q "strix-halo-128GB/llamacpp-pi.*needs 131072 MiB" <<< "$why"
assert_ok "...it says the row fits, and the selector is what excluded it" \
  grep -q "strix-halo-128GB/llamacpp-pi.*fits this machine; family is qwen, not 'pi'" <<< "$why"
HOST_ACCEL=strix-halo; HOST_MEM_MIB=65024
why="$(explain_no_match 2>&1)"
assert_ok "a 64GB Strix Halo is told the 128GB row needs more memory" \
  grep -q "strix-halo-128GB/llamacpp-pi.*needs 131072 MiB; this machine has 65024 MiB" <<< "$why"
HOST_ACCEL=cuda; HOST_MEM_MIB=24564
why="$(explain_no_match nosuchfamily 2>&1)"
assert_ok "explaining a miss to a CUDA host names the accelerator" \
  grep -q "Accelerator: cuda" <<< "$why"
why="$(explain_no_match 2>&1)"
assert_ok "a CUDA host is told the Strix Halo row needs a strix-halo accelerator" \
  grep -q "strix-halo-128GB/llamacpp-pi.*needs a strix-halo accelerator; this machine has cuda" <<< "$why"

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
