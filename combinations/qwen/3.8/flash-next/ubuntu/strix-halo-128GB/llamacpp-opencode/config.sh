#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-opencode/config.sh
#
# Qwen3.8-Flash-Next (125B total, ~6B active, qwen4exp architecture) on a
# 128GB AMD Strix Halo machine under Ubuntu 26.04, served by upstream
# llama.cpp on Vulkan (RADV), driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/ (lib/accel/strix-halo.sh,
# lib/llamacpp.sh, lib/runtime/server-llamacpp.sh).
#
# NOT MEASURED BY THIS REPO YET. Written for a Minisforum MS-S1 MAX
# (Ryzen AI Max+ 395, 128 GB LPDDR5x-8000) before it had been run through
# this installer. Every figure below is either read from a published source
# (named where it appears) or an ESTIMATE, and says which. See README.md for
# what to measure and where the results go.

# ---- identity -------------------------------------------------------------
INSTALL_ID="qwen38-flash-next-strix"
DISPLAY_NAME="Qwen3.8-Flash-Next (Strix Halo)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next GGUF (Unsloth)"
ROOT_ENV_VAR="QWEN38_FLASH_NEXT_ROOT"

# Unmeasured: ranks below any measured combination for the same machine. It
# is the only Strix Halo combination today, so it is still what ./install.sh
# offers there. Remove once the profiles below hold measured numbers.
AUTO_SELECT=0

# The machines this combination's numbers were measured on, as
# <vendor>-<product> slugs. lib/accel/strix-halo.sh matches the running
# machine's DMI product name against these and says plainly when it is a
# different box with the same chip. Empty until the first measured run; the
# target machine is minisforum-ms-s1-max.
TESTED_ON=""

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="26.04"                 # kernel 7.0: gfx1151 fixes and RTL8127 10GbE in-tree
ACCEL="strix-halo"                        # -> lib/accel/strix-halo.sh (GPU_API=vulkan by default)
BACKEND="llamacpp"                        # -> lib/llamacpp.sh
CLIENT="${CLIENT:-opencode}"

# Vulkan build: loader headers, the GLSL->SPIR-V compiler and SPIR-V headers
# for llama.cpp's shaders; RADV and vulkaninfo to run and inspect it. pipx is
# for AMD's amd-ttm tool if the GTT limit needs raising. Package names are
# Ubuntu's; not yet confirmed as a set on 26.04.
SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils
                 libvulkan-dev glslc spirv-headers mesa-vulkan-drivers vulkan-tools pipx)

# What the GPU must be able to address (GTT). ESTIMATE: the default profile's
# need_mib plus room for the compute graph to grow. A stock kernel offers
# about half of RAM (~62 GB here); amd-ttm --set 120 gives 122,880 MiB.
MIN_DEVICE_MEM_MIB=102400
STRIX_HALO_GTT_TARGET_GIB=120             # what the refusal tells you to set
MIN_OS_RESERVE_MIB=6144                   # warn if the GPU may take more than RAM minus this
MIN_KERNEL_VERSION="6.18.4"

# qwen4exp support landed upstream in PR #27742 (merged 2026-08-27). A binary
# older than that cannot load the model at all.
MIN_LLAMA_COMMIT_DATE="2026-08-27"

# ---- weights --------------------------------------------------------------
# Unsloth's dynamic quants. Sizes are the Hub's own byte counts, read
# 2026-09-25. top-1 agreement / mean KLD against BF16 are Unsloth's figures.
#
#   UD-IQ4_XS    93.68 GB   89.6%  0.084   default: leaves room for 128k+ context
#   UD-Q4_K_XL  111.33 GB   92.3%  0.047   best quality; tight, see low_memory_advice
#
# The shards live in a subdirectory of the repo, and llama.cpp opens the rest
# of a split GGUF from the first, so the first shard is the `model` asset and
# the others ride along under a free-form role.
QUANT="${QUANT:-UD-IQ4_XS}"
MODEL_SUBDIR="models/Qwen3.8-Flash-Next-GGUF"
_R="unsloth/Qwen3.8-Flash-Next-GGUF"
_F="${QUANT}/Qwen3.8-Flash-Next-${QUANT}"
case "$QUANT" in
  UD-IQ4_XS) MODEL_ASSETS="
${_R}|${_F}-00001-of-00003.gguf|model|10.9 MB
${_R}|${_F}-00002-of-00003.gguf|shard|49.84 GB
${_R}|${_F}-00003-of-00003.gguf|shard|43.84 GB
" ;;
  UD-Q4_K_XL) MODEL_ASSETS="
${_R}|${_F}-00001-of-00004.gguf|model|10.9 MB
${_R}|${_F}-00002-of-00004.gguf|shard|49.86 GB
${_R}|${_F}-00003-of-00004.gguf|shard|49.38 GB
${_R}|${_F}-00004-of-00004.gguf|shard|12.09 GB
" ;;
  *) err "QUANT=${QUANT} is not one this combination lists (UD-IQ4_XS, UD-Q4_K_XL)." ;;
esac
# Vision projector. Optional: a failed download disables the vision profile.
# NOTE: no `mtp` asset, deliberately. The repo ships MTP heads, but upstream
# llama.cpp cannot load a qwen4exp MTP head yet (PRs #27836 and #28243 are
# open drafts) and fails at startup if handed one. Add it back when they merge.
MODEL_ASSETS="${MODEL_ASSETS}${_R}|mmproj-F16.gguf|mmproj|904.0 MB
"
unset _R _F

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.8-flash-next"  # stable id advertised at /v1/models
DEFAULT_PROFILE="coding"

# f16 only. bf16 crashes on gfx1151, and quantised KV has been reported to
# break tool calling on this model -- and with two KV heads the cache is small
# enough that there is nothing worth saving by quantising it.
SAFE_KV_TYPES="f16"

# Qwen's thinking and instruct presets (the model card's), as matched pairs.
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
SAMPLING_INSTRUCT="--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# The template defaults to xhigh when unset; low is the repo's default for
# agent traffic, as on the macOS Flash-Next combinations, which run the same
# template.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low medium high xhigh"

IMAGE_MIN_TOKENS=1024

# -b 2048 with -ub 512 (the profile column). A larger -ub wins llama-bench's
# prefill chart but has been measured to halve real decode on this model.
LLAMA_BATCH=2048

# --no-mmap: page-cache mapping of a 94 GB file on unified memory is slow to
# load and double-counts memory. --ctx-checkpoints: the Gated DeltaNet layers
# cannot roll back, so without saved checkpoints a returning agent turn
# re-reads its whole prompt.
LLAMA_EXTRA_ARGS="--no-mmap --ctx-checkpoints 8"

# No MTP upstream, so draft from the context instead: free, and a large win on
# the file rewrites agents do. 64/24 is the setting reported not to regress
# prose. The launcher probes for the flags and starts without them if the
# build is too old. SPEC_NGRAM=0 turns it off for an A/B.
SPEC_NGRAM_ARGS="--spec-type ngram-mod --spec-ngram-mod-n-max 64 --spec-ngram-mod-n-match 24"

# A 94 GB load takes minutes, not seconds. ESTIMATES until measured: give the
# first load and the smoke test room, and do not throw the weights away after
# a five-minute coffee break.
SMOKE_TIMEOUT=900
SERVER_START_TIMEOUT_DEFAULT=900
IDLE_TIMEOUT_DEFAULT=1800

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="flash-next-strix"
CONTEXT_LIMIT=131072                      # must match the default profile's ctx
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
# Called by lib/accel/strix-halo.sh when the GPU may address less than
# MIN_DEVICE_MEM_MIB. On this machine that is a kernel setting, not a reason
# to pick a smaller quant -- the adapter has already printed the fix.
low_memory_advice() {
  local mem="$1"
  warn ""
  warn " A smaller quant does not rescue a stock GTT limit: UD-Q3_K_XL is still"
  warn " 90 GB. Raise the limit; that is what it is for."
  if [[ "$QUANT" == "UD-Q4_K_XL" ]]; then
    warn ""
    warn " QUANT=UD-Q4_K_XL is ~104 GiB of weights. Even at a 120 GiB limit that"
    warn " leaves little for context and the OS: use PROFILE=coding with VISION=0,"
    warn " one slot, and swap configured."
  fi
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO YET. Published community figures, other Strix Halo
boxes, not this installer:
  Decode, UD-IQ4_XS, no speculation     ~17 tok/s at 8k, ~15 at 24k   (drluoto)
  Decode, Vulkan fork with MTP draft    ~30 prose .. ~58 file rewrite  (drluoto)
  Prefill, UD-IQ4_XS                    ~340 tok/s empty, ~200 at 24k  (drluoto)
  Load, --no-mmap                       minutes; measure it here
Measure: benchmarks/README.md in this combination.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Refused at qualification  read the GTT fix it printed; reboot after amd-ttm
Very slow first load      expected: 94 GB from disk. Check it once, then idle stays long
Slow decode               pin the GPU clock: echo high | sudo tee .../power_dpm_force_performance_level
Tool calls go wrong       KV must be f16; do not quantise it on this model
Server will not start     'unknown model architecture qwen4exp' = llama.cpp too old; re-run
TXT
}
