#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-opencode/config.sh
#
# Qwen3.8-Flash-Next (125B total, ~6B active, qwen4exp architecture) on a
# 128GB AMD Strix Halo machine under Ubuntu 26.04, served by llama.cpp with
# the qwen4exp MTP draft head (PR #28243) on Vulkan (RADV) or ROCm, driven by
# OpenCode.
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
ACCEL="strix-halo"                        # -> lib/accel/strix-halo.sh (GPU_API=vulkan or rocm)
BACKEND="llamacpp"                        # -> lib/llamacpp.sh
# pi by default: its system prompt is a fraction of OpenCode's, and at a few
# hundred tok/s prefill every prompt token is felt on the first turn. Needs
# pi on PATH (Ubuntu 26.04: sudo apt install nodejs npm, then
# sudo npm install -g @earendil-works/pi-coding-agent). CLIENT=opencode or
# --client opencode for the other; the path's stack segment predates this.
CLIENT="${CLIENT:-pi}"

# Vulkan build: loader headers, the GLSL->SPIR-V compiler and SPIR-V headers
# for llama.cpp's shaders; RADV and vulkaninfo to run and inspect it. pipx is
# for AMD's amd-ttm tool if the GTT limit needs raising. Package names are
# Ubuntu's; not yet confirmed as a set on 26.04.
SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils
                 libvulkan-dev glslc spirv-headers mesa-vulkan-drivers vulkan-tools pipx)

# What the GPU must be able to address (GTT). ESTIMATE: the default profile's
# need_mib plus room for the compute graph to grow. A stock kernel offers
# about half of RAM (~62 GB here); amd-ttm --set 120 gives 122,880 MiB.
MIN_DEVICE_MEM_MIB=105472
STRIX_HALO_GTT_TARGET_GIB=120             # what the refusal tells you to set
MIN_OS_RESERVE_MIB=6144                   # warn if the GPU may take more than RAM minus this
MIN_KERNEL_VERSION="6.18.4"

# The MTP draft head is most of this model's speed on this chip: 17 tok/s
# without it, 32-61 with it (drluoto, same chip, a fork). Upstream llama.cpp
# cannot load a qwen4exp MTP head yet; PR #28243 does, and its branch is
# Unsloth's, who publish the weights below. It floats on that branch until
# the PR merges; then point this back at upstream master. lib/verify.sh's
# rollback returns to the last verified commit of this branch.
LLAMA_REPO_URL="https://github.com/danielhanchen/llama.cpp.git"
LLAMA_BRANCH="qwen4exp/mtp"

# qwen4exp itself landed in #27742 (2026-08-27), but ROCm on gfx1151 gave
# wrong logits for prompts longer than the ubatch until #28604 (2026-09-08).
MIN_LLAMA_COMMIT_DATE="2026-09-08"

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
# The MTP draft head, as a separate file (Unsloth's MTP/README.md is the
# source for what follows). "shared" heads borrow the target's embedding and
# output projection, saving ~1.3 GB, and draft identically to the
# self-contained ones; PR #28243 loads them. shared-Q8_0 is Unsloth's pick
# and the fastest of their set; shared-Q4_K_M is 1.91 GB at ~2 points less
# acceptance. At startup a shared head logs one "borrow_shared_tensor" error
# from the memory fit, then works; that line is expected.
MTP_QUANT="${MTP_QUANT:-shared-Q8_0}"
case "$MTP_QUANT" in
  shared-Q8_0)   _M="2.79 GB" ;;
  shared-Q4_K_M) _M="1.91 GB" ;;
  *) err "MTP_QUANT=${MTP_QUANT} is not one this combination lists (shared-Q8_0, shared-Q4_K_M)." ;;
esac
MODEL_ASSETS="${MODEL_ASSETS}${_R}|MTP/mtp-Qwen3.8-Flash-Next-${MTP_QUANT}.gguf|mtp|${_M}
"
# Vision projector. Optional: a failed download disables the vision profile.
MODEL_ASSETS="${MODEL_ASSETS}${_R}|mmproj-F16.gguf|mmproj|904.0 MB
"
unset _R _F _M

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

# -b 2048 with -ub 512 (the profile column). UNVERIFIED: a larger -ub has been
# reported to win llama-bench's prefill chart and halve real decode, but
# drluoto's measured stack runs -ub 2048. benchmarks/ settles it.
LLAMA_BATCH=2048

# --no-mmap: page-cache mapping of a 94 GB file on unified memory is slow to
# load and double-counts memory. --ctx-checkpoints: the Gated DeltaNet layers
# cannot roll back, so without saved checkpoints a returning agent turn
# re-reads its whole prompt.
LLAMA_EXTRA_ARGS="--no-mmap --ctx-checkpoints 8"

# MTP: draft 3 tokens a step and keep every one the head proposes (p-min 0),
# the setting drluoto measured on this chip with his own head. Unsloth's
# default for their heads is 2; A/B both. MTP is a win for one request at a
# time and was measured a net loss (0.81-0.87x) at 8 concurrent, so the
# agents profile needs its own check. No n-gram fallback: on this chip each
# n-gram verification costs 230-480 ms and it lost on everything but prose
# (drluoto).
SPEC_DRAFT_N_MAX=3
SPEC_DRAFT_P_MIN=0.0

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
  Decode, Vulkan fork with MTP draft    ~32 prose .. ~56 file rewrite at 8k,
                                        ~38..49 at 32k                 (drluoto)
  This install uses PR #28243's MTP, not drluoto's fork: unmeasured.
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
DeviceLostError mid-run   set amdgpu.lockup_timeout; qualification prints the line
No draft acceptance line  the MTP head did not load; check the server log for -md
TXT
}
