#!/usr/bin/env bash
# The Strix Halo path, exercised without a Strix Halo.
#
# Fakes the sysfs a Ryzen AI Max machine exposes and a llama-server that
# echoes its argv, then runs the real accelerator adapter, combination config,
# manifest helper and runtime launcher against them. What cannot be checked
# here -- that RADV loads the model, and every number in profiles.tsv -- is
# the combination's own benchmarks/measure.sh.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DIR/.." && pwd)"
. "$DIR/lib.sh"

COMBO="qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# ---- a fake 128GB Strix Halo ----------------------------------------------
fake_gpu() { # gtt_total_mib vram_total_mib
  local g="$SCRATCH/pci/0000:c5:00.0"
  rm -rf "$SCRATCH/pci"; mkdir -p "$g/drm/renderD128" "$SCRATCH/ttm"
  printf '0x1002\n' > "$g/vendor"; printf '0x1586\n' > "$g/device"
  printf '%s\n' $(( $1 * 1048576 )) > "$g/mem_info_gtt_total"
  printf '%s\n' $(( 2048 * 1048576 )) > "$g/mem_info_gtt_used"
  printf '%s\n' $(( $2 * 1048576 )) > "$g/mem_info_vram_total"
  printf '%s\n' $(( 100 * 1048576 )) > "$g/mem_info_vram_used"
  printf 'auto\n' > "$g/power_dpm_force_performance_level"
  printf '%s\n' $(( $1 * 256 )) > "$SCRATCH/ttm/pages_limit"
  # 128 GB less a 512 MiB carve-out, as MemTotal reports it. Less is available
  # than GTT headroom, so the MemAvailable bound is what the test sees.
  printf 'MemTotal:       %s kB\nMemAvailable:   %s kB\nSwapTotal:      %s kB\n' \
    $(( (FAKE_RAM_MIB - 512) * 1024 )) $(( FAKE_AVAIL_MIB * 1024 )) $(( FAKE_SWAP_MIB * 1024 )) > "$SCRATCH/meminfo"
}
printf 'BOOT_IMAGE=/vmlinuz root=/dev/mapper/ubuntu--vg-ubuntu--lv ro\n' > "$SCRATCH/cmdline"
FAKE_RAM_MIB=131072
FAKE_AVAIL_MIB=100000
FAKE_SWAP_MIB=0

# Run adapter functions in a clean shell with the combination's config.
adapter() {
  SCRATCH="$SCRATCH" SYSFS_PCI="$SCRATCH/pci" SYSFS_TTM="$SCRATCH/ttm" SYSFS_DMI="$SCRATCH/dmi" PROC_MEMINFO="$SCRATCH/meminfo" PROC_CMDLINE="$SCRATCH/cmdline" bash -c '
    set -uo pipefail
    REPO_ROOT="'"$REPO_ROOT"'"; LOG_FILE=/dev/null
    . "$REPO_ROOT/lib/common.sh"
    . "$REPO_ROOT/combinations/'"$COMBO"'/config.sh"
    . "$REPO_ROOT/lib/accel/strix-halo.sh"
    '"$1"
}

echo "accelerator contract"
for sym in qualify_accel accel_cmake_args accel_build_key accel_probe_binary accel_report_mem; do
  assert_ok "strix-halo defines $sym" grep -q "^${sym}()" "$REPO_ROOT/lib/accel/strix-halo.sh"
done
assert_eq "the combination builds both backends" "both" "$(adapter 'echo "$GPU_API"')"
args="$(adapter 'accel_cmake_args')"
assert_ok "...Vulkan"                          grep -qx -- -DGGML_VULKAN=ON <<< "$args"
assert_ok "...and HIP for gfx1151"             grep -qx -- -DGGML_HIP=ON <<< "$args"
assert_ok "...targeting gfx1151"               grep -qx -- -DGPU_TARGETS=gfx1151 <<< "$args"
assert_eq "...and the runtime can pick either" "vulkan rocm" "$(adapter 'echo "$ACCEL_GPU_BACKENDS"')"
assert_eq "GPU_API=vulkan builds Vulkan only"  "-DGGML_VULKAN=ON" "$(GPU_API=vulkan adapter 'accel_cmake_args')"
assert_eq "...with one backend to run"         "vulkan" "$(GPU_API=vulkan adapter 'echo "$ACCEL_GPU_BACKENDS"')"
assert_ok "GPU_API=rocm builds HIP only"       grep -qx -- -DGGML_HIP=ON <<< "$(GPU_API=rocm adapter 'accel_cmake_args')"
assert_fails "...without Vulkan"               grep -q VULKAN <<< "$(GPU_API=rocm adapter 'accel_cmake_args')"
assert_eq "the build key says which API"       "strix-halo=both;gfx1151"   "$(adapter 'accel_build_key')"
assert_eq "...so switching API rebuilds"       "strix-halo=rocm;gfx1151"   "$(GPU_API=rocm adapter 'accel_build_key')"
assert_fails "an unknown GPU_API is refused"   adapter 'GPU_API=metal; qualify_accel'
fake_bin() { printf '#!/bin/bash\necho "%s"\n' "$1" > "$SCRATCH/lsd"; chmod +x "$SCRATCH/lsd"; }
fake_bin "Available devices: Vulkan0: AMD Radeon 8060S (RADV GFX1151)  ROCm0: AMD Radeon 8060S"
assert_ok "a two-backend binary passes the probe" adapter 'accel_probe_binary "$SCRATCH/lsd"'
fake_bin "Available devices: Vulkan0: AMD Radeon 8060S (RADV GFX1151)"
assert_fails "...one missing ROCm fails it, so it rebuilds" adapter 'accel_probe_binary "$SCRATCH/lsd"'
assert_ok "...though a Vulkan-only build accepts it" adapter 'GPU_API=vulkan; accel_probe_binary "$SCRATCH/lsd"'


echo
echo "the GTT budget is read, not assumed"
fake_gpu 64256 512
assert_eq "a stock kernel's GTT is the budget" "64256" "$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; echo "$ACCEL_MEM_MIB"')"
assert_eq "the carve-out is read too"          "512"   "$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; echo "$ACCEL_VRAM_MIB"')"
out="$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; _sh_qualify_budget' 2>&1)"; rc=$?
assert_eq "a stock GTT limit is refused"       "1" "$rc"
assert_ok "...with amd-ttm's exact command"    grep -q 'amd-ttm --set 120' <<< "$out"
assert_ok "...and the kernel-parameter value"  grep -q 'ttm.pages_limit=31457280' <<< "$out"
assert_ok "...and the page-pool warning"       grep -q 'page_pool_size' <<< "$out"
assert_ok "...and the combination's own advice" grep -q 'UD-Q3_K_XL is still' <<< "$out"

fake_gpu 122880 512
out="$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; _sh_qualify_budget' 2>&1)"; rc=$?
assert_eq "amd-ttm --set 120 qualifies"        "0" "$rc"
# tritus's real MemTotal: 125131 MiB (the fake adds the 512 MiB carve-out back)
FAKE_RAM_MIB=$(( 125131 + 512 )); fake_gpu 122880 512
out="$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; _sh_qualify_budget' 2>&1)"
assert_ok "...but with no swap, 120 GiB of 128 leaves Linux too little: warned" \
  grep -q 'WARN.*leaving under 6144 MiB for Linux' <<< "$out"
FAKE_SWAP_MIB=8192; fake_gpu 122880 512
out="$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; _sh_qualify_budget' 2>&1)"
assert_fails "the designed setup (120 GiB + Ubuntu's 8 GiB swap) is not warned about" \
  grep -q 'WARN' <<< "$out"
assert_ok "...it says swap is the cushion"      grep -q '8192 MiB of swap' <<< "$out"
FAKE_SWAP_MIB=0; FAKE_RAM_MIB=131072; fake_gpu 122880 512

fake_gpu 122880 98304
out="$(adapter '_sh_gtt_budget "$(_sh_gpu_dir)"; _sh_qualify_carveout' 2>&1)"
assert_ok "a 96GB BIOS carve-out is flagged"   grep -q 'UMA Frame Buffer Size = 512M' <<< "$out"

fake_gpu 122880 512
assert_eq "free memory is GTT headroom, bounded by MemAvailable" "ok" \
  "$(adapter 'read -r used free < <(accel_report_mem); avail='"$FAKE_AVAIL_MIB"'; want=$(( 122880 - 2048 )); (( avail < want )) && want=$avail; [[ "$used" == 2148 && "$free" == "$want" ]] && echo ok || echo "used=$used free=$free want=$want"')"

echo
echo "the 2-second GPU watchdog is reported"
out="$(adapter '_sh_qualify_lockup_timeout' 2>&1)"
assert_ok "a stock kernel command line is warned about" grep -q 'amdgpu.lockup_timeout is not set' <<< "$out"
assert_ok "...with the parameter to add"   grep -q 'amdgpu.lockup_timeout=10000,60000,10000,10000' <<< "$out"
printf 'ro quiet amdgpu.lockup_timeout=10000,60000,10000,10000\n' > "$SCRATCH/cmdline"
out="$(adapter '_sh_qualify_lockup_timeout' 2>&1)"
assert_ok "a set parameter passes"         grep -q 'lockup_timeout is set' <<< "$out"
printf 'BOOT_IMAGE=/vmlinuz ro\n' > "$SCRATCH/cmdline"

echo
echo "the machine is named against TESTED_ON"
mkdir -p "$SCRATCH/dmi"
printf 'Micro Computer (HK) Tech Limited\n' > "$SCRATCH/dmi/sys_vendor"
printf 'MS-S1 MAX\n' > "$SCRATCH/dmi/product_name"
out="$(adapter 'TESTED_ON="minisforum-ms-s1-max"; _sh_report_machine' 2>&1)"
assert_ok "the MS-S1 MAX matches minisforum-ms-s1-max" grep -q 'one this combination was measured on' <<< "$out"
printf 'Framework Desktop\n' > "$SCRATCH/dmi/product_name"
out="$(adapter 'TESTED_ON="minisforum-ms-s1-max"; _sh_report_machine' 2>&1)"
assert_ok "another box with the same chip is told so" grep -q 'Same chip, different box' <<< "$out"
out="$(adapter 'TESTED_ON=""; _sh_report_machine' 2>&1)"
assert_eq "nothing is claimed while TESTED_ON is empty" "" "$out"

echo
echo "the combination's config"
cfg() { bash -c 'LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; '"${2:-}"' . "'"$REPO_ROOT"'/combinations/'"$COMBO"'/config.sh"; '"$1"; }
assert_eq "three IQ4_XS shards, an MTP head and a projector" "model shard shard mtp mmproj" \
  "$(cfg 'printf "%s\n" "$MODEL_ASSETS" | awk -F"|" "NF==4 {printf \"%s%s\", s, \$3; s=\" \"}"')"
assert_eq "shards keep the repo's subdirectory" "UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf" \
  "$(cfg 'printf "%s\n" "$MODEL_ASSETS" | awk -F"|" "\$3==\"model\" {print \$2}"')"
assert_eq "the MTP head is Unsloth's shared-Q8_0, from MTP/" "MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf" \
  "$(cfg 'printf "%s\n" "$MODEL_ASSETS" | awk -F"|" "\$3==\"mtp\" {print \$2}"')"
assert_eq "MTP_QUANT=shared-Q4_K_M swaps it" "MTP/mtp-Qwen3.8-Flash-Next-shared-Q4_K_M.gguf" \
  "$(cfg 'printf "%s\n" "$MODEL_ASSETS" | awk -F"|" "\$3==\"mtp\" {print \$2}"' 'MTP_QUANT=shared-Q4_K_M;')"
assert_fails "an unlisted MTP_QUANT is refused" cfg 'true' 'MTP_QUANT=BF16;'
assert_eq "llama.cpp is the MTP PR's branch" "https://github.com/danielhanchen/llama.cpp.git qwen4exp/mtp" \
  "$(cfg 'echo "$LLAMA_REPO_URL $LLAMA_BRANCH"')"
assert_eq "...no older than the ROCm gfx1151 logits fix" "2026-09-08" "$(cfg 'echo "$MIN_LLAMA_COMMIT_DATE"')"
assert_eq "draft depth 3, p-min 0"          "3 0.0" "$(cfg 'echo "$SPEC_DRAFT_N_MAX $SPEC_DRAFT_P_MIN"')"
assert_eq "no n-gram speculation by default" "" "$(cfg 'echo "$SPEC_NGRAM_ARGS"')"
assert_eq "QUANT=UD-Q4_K_XL has four shards" "4" \
  "$(cfg 'printf "%s\n" "$MODEL_ASSETS" | grep -c "UD-Q4_K_XL-0000"' 'QUANT=UD-Q4_K_XL;')"
assert_fails "an unlisted QUANT is refused" cfg 'true' 'QUANT=UD-Q2_K_XL;'
assert_eq "f16 is the only safe KV type" "f16" "$(cfg 'echo "$SAFE_KV_TYPES"')"
assert_eq "it asks for the Strix Halo adapter" "strix-halo" "$(cfg 'echo "$ACCEL"')"
assert_ok "a two-backend build pulls Ubuntu's ROCm (gfx1151 rocBLAS)" \
  grep -qw librocblas-dev <<< "$(cfg 'echo "${SYSTEM_PACKAGES[*]}"')"
assert_fails "...a Vulkan-only build does not" \
  grep -qw librocblas-dev <<< "$(cfg 'echo "${SYSTEM_PACKAGES[*]}"' 'GPU_API=vulkan;')"
assert_eq "Vulkan is the backend it runs unless told" "vulkan" "$(cfg 'echo "$GPU_BACKEND_DEFAULT"')"
assert_ok "the manifest carries the backends the build has" grep -q '^GPU_BACKENDS=' "$REPO_ROOT/lib/launcher.sh"
assert_ok "it is marked unmeasured"  grep -qE '^AUTO_SELECT=0' "$REPO_ROOT/combinations/$COMBO/config.sh"
assert_eq "CONTEXT_LIMIT matches the default profile" \
  "$(cfg 'echo "$CONTEXT_LIMIT"')" \
  "$(awk -F'|' -v p="$(cfg 'echo "$DEFAULT_PROFILE"')" '$1==p {print $2}' "$REPO_ROOT/combinations/$COMBO/profiles.tsv")"
while IFS='|' read -r repo file role size; do
  [[ -n "${repo// }" ]] || continue
  bytes="$(case "$file" in
    *00001-of-00003*) echo 10946624 ;; *00002-of-00003*) echo 49835229856 ;;
    *00003-of-00003*) echo 43836407744 ;; mmproj-F16.gguf) echo 904004000 ;;
    *shared-Q8_0.gguf) echo 2786568256 ;; esac)"
  truncate -s "$bytes" "$SCRATCH/asset"
  assert_ok "declared size '$size' accepts the Hub's $bytes bytes ($role)" bash -c '
    LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/lib/model.sh"
    _asset_is_complete "'"$SCRATCH/asset"'" "'"$size"'"'
done < <(cfg 'printf "%s\n" "$MODEL_ASSETS"')

echo
echo "the manifest keeps shard subdirectories"
rel() { bash -c 'LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/lib/launcher.sh"; MODEL_DIR=/h/m; _model_rel "$1"' _ "$1"; }
assert_eq "a file in a subdirectory keeps it" "UD-IQ4_XS/a-00001-of-00003.gguf" "$(rel /h/m/UD-IQ4_XS/a-00001-of-00003.gguf)"
assert_eq "a flat file is unchanged"          "mmproj-F16.gguf"                 "$(rel /h/m/mmproj-F16.gguf)"
assert_eq "outside MODEL_DIR stays a basename" "pack"                           "$(rel /elsewhere/cache/pack)"

echo
echo "the runtime launcher, against a llama-server that echoes its argv"
FH="$SCRATCH/home"; R="$FH/.local/share/qwen38-flash-next-strix"
mkdir -p "$R/models/Qwen3.8-Flash-Next-GGUF/UD-IQ4_XS" "$R/models/Qwen3.8-Flash-Next-GGUF/MTP" "$R/llama.cpp/build/bin" "$FH/.local/bin"
: > "$R/models/Qwen3.8-Flash-Next-GGUF/UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"
: > "$R/models/Qwen3.8-Flash-Next-GGUF/MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
cp "$REPO_ROOT/combinations/$COMBO/profiles.tsv" "$REPO_ROOT/combinations/$COMBO/help.txt" "$R/"
fake_server() { # help text to advertise
  cat > "$R/llama.cpp/build/bin/llama-server" <<EOF
#!/usr/bin/env bash
[[ "\${1:-}" == "--help" ]] && { echo "$1"; exit 0; }
printf '%s\n' "\$@"
EOF
  chmod +x "$R/llama.cpp/build/bin/llama-server"
}
bash -c 'LOG_FILE=/dev/null; . "'"$REPO_ROOT"'/lib/common.sh"; . "'"$REPO_ROOT"'/combinations/'"$COMBO"'/config.sh"
cat <<EOF
INSTALL_ID="$INSTALL_ID"; DISPLAY_NAME="$DISPLAY_NAME"; BACKEND="$BACKEND"; ACCEL="$ACCEL"; ROOT_ENV_VAR="$ROOT_ENV_VAR"
MODEL_SUBDIR="$MODEL_SUBDIR"; MODEL_FILE="UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf"; MMPROJ_FILE=""; MTP_FILE="MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"
MODEL_ALIAS_DEFAULT="$MODEL_ALIAS_DEFAULT"; DEFAULT_PROFILE="$DEFAULT_PROFILE"; SAFE_KV_TYPES="$SAFE_KV_TYPES"
REASONING_EFFORT_DEFAULT="$REASONING_EFFORT_DEFAULT"; REASONING_EFFORTS="$REASONING_EFFORTS"
SAMPLING_THINKING="$SAMPLING_THINKING"; SAMPLING_INSTRUCT="$SAMPLING_INSTRUCT"; SPEC_DRAFT_N_MAX="$SPEC_DRAFT_N_MAX"; SPEC_DRAFT_P_MIN="$SPEC_DRAFT_P_MIN"; SPEC_BUILTIN=""
LLAMA_BATCH="$LLAMA_BATCH"; LLAMA_EXTRA_ARGS="$LLAMA_EXTRA_ARGS"; SPEC_NGRAM_ARGS="$SPEC_NGRAM_ARGS"
GPU_BACKENDS="vulkan rocm"; GPU_BACKEND_DEFAULT="$GPU_BACKEND_DEFAULT"
SERVER_CMD="${INSTALL_ID}-server"
EOF' > "$R/install.env"

launch() { HOME="$FH" LOCAL_AI_INSTALL_REL=".local/share/qwen38-flash-next-strix" PORT=1 "$@" \
             bash "$REPO_ROOT/lib/runtime/server-llamacpp.sh" 2>&1; }
fake_server "usage ... --spec-ngram-mod-n-max N ... --spec-draft-device <dev> ..."
argv="$(launch env)"
has() { grep -qxF -- "$1" <<< "$argv"; }
assert_ok "loads the first shard from its subdirectory" \
  grep -q 'UD-IQ4_XS/Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf$' <<< "$argv"
assert_eq "loads with direct I/O"            "dio" "$(grep -A1 -x -- -lm <<< "$argv" | tail -1)"
assert_fails "not --no-mmap, which llama.cpp removed (#28334)" has --no-mmap
assert_ok "passes --ctx-checkpoints"         has --ctx-checkpoints
assert_ok "uses the combination's -b 2048"   grep -qx -- 2048 <<< "$(grep -A1 -x -- -b <<< "$argv")"
assert_ok "KV is f16"                        grep -qx -- f16 <<< "$(grep -A1 -x -- --cache-type-k <<< "$argv")"
after() { grep -A1 -x -- "$1" <<< "$argv" | tail -1; }
assert_ok "passes the MTP head with -md"     grep -q 'MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf$' <<< "$(after -md)"
assert_eq "as a draft-mtp speculator"        "draft-mtp" "$(after --spec-type)"
assert_eq "drafting 3 tokens a step"         "3"   "$(after --spec-draft-n-max)"
assert_eq "keeping every drafted token"      "0.0" "$(after --spec-draft-p-min)"
assert_fails "no n-gram speculation alongside MTP" has ngram-mod
argv="$(launch env SPEC_DRAFT_N_MAX=2 SPEC_DRAFT_P_MIN=0.5)"
assert_eq "a run-time draft depth wins over the manifest's" "2"   "$(after --spec-draft-n-max)"
assert_eq "...and so does a run-time p-min"                 "0.5" "$(after --spec-draft-p-min)"
argv="$(launch env SPEC_MTP=0)"
assert_fails "SPEC_MTP=0 runs without the draft head, for an A/B" has draft-mtp
assert_fails "...and passes no -md"                        has -md
assert_eq "with MTP off, the model is still pinned" "Vulkan0" "$(after --device)"
assert_fails "...and no draft device is passed"      has --spec-draft-device
argv="$(launch env)"
assert_eq "a two-backend build runs on one device: Vulkan by default" "Vulkan0" "$(after --device)"
assert_eq "...and so does the MTP draft head"  "Vulkan0" "$(after --spec-draft-device)"
assert_ok "...and says which"                  grep -q 'GPU backend: vulkan (Vulkan0)' <<< "$argv"
argv="$(launch env GPU_BACKEND=rocm)"
assert_eq "GPU_BACKEND=rocm switches the model to ROCm" "ROCm0" "$(after --device)"
assert_eq "...and the draft head with it"      "ROCm0" "$(after --spec-draft-device)"
argv="$(launch env GPU_BACKEND=cuda)"; rc=$?
assert_ok "a backend the build lacks is refused, naming what it has" grep -q "GPU_BACKEND=cuda.*vulkan rocm" <<< "$argv"
assert_fails "...and nothing is started"       grep -qx -- --device <<< "$argv"
argv="$(launch env PROFILE=agents)"
assert_ok "the agents profile runs three slots" grep -qx -- 3 <<< "$(grep -A1 -x -- -np <<< "$argv")"

echo
echo "the launcher's n-gram fallback, for a combination without an MTP head"
cp "$R/install.env" "$R/install.env.mtp"
sed -i.bak -e 's|MTP_FILE="[^"]*"|MTP_FILE=""|' \
  -e 's|SPEC_NGRAM_ARGS="[^"]*"|SPEC_NGRAM_ARGS="--spec-type ngram-mod --spec-ngram-mod-n-max 64"|' "$R/install.env"
sed -i.bak -e 's|GPU_BACKENDS="[^"]*"|GPU_BACKENDS="vulkan"|' "$R/install.env"
argv="$(launch env)"
assert_fails "a one-backend build passes no --device" has --device
assert_ok "turns on n-gram speculation when the build knows it" has ngram-mod
assert_ok "...and says so"                   grep -q 'speculation: n-gram' <<< "$argv"
assert_fails "p-min is only passed with an MTP draft" has --spec-draft-p-min
argv="$(launch env SPEC_NGRAM=0)"
assert_fails "SPEC_NGRAM=0 turns it off"     has ngram-mod
fake_server "usage ... (an older build)"
argv="$(launch env)"
assert_fails "an older build starts without the unknown flag" has ngram-mod
assert_ok "...and says why"                  grep -q 'does not know --spec-ngram-mod-n-max' <<< "$argv"
mv "$R/install.env.mtp" "$R/install.env"

finish
