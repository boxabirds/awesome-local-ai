#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/macos/128GB/llamacpp-pi/config.sh
#
# Qwen3.8-Flash-Next (Unsloth UD-IQ4_XS GGUF + the shared-Q8_0 MTP head) on a 128 GB Apple silicon
# Mac, served by llama.cpp's Metal backend, with pi as the client. It is the tritus stack
# (ubuntu/strix-halo-128GB/llamacpp-pi) moved to a Mac: same llama.cpp branch and commit, same
# weights, same MTP settings, same sampling and context. Only the GPU backend differs (Metal, not
# Vulkan). It exists to separate the engine from the hardware when comparing against MTPLX on the
# same Mac (qwen/3.8/flash-next/macos/128GB/mtplx-pi).
#
# This file is DATA. All the logic lives in lib/ (lib/accel/metal.sh, lib/llamacpp.sh).

INSTALL_ID="qwen38-flash-next-metal"
DISPLAY_NAME="Qwen3.8-Flash-Next (Mac, llama.cpp Metal)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next GGUF (Unsloth)"
ROOT_ENV_VAR="QWEN38_FLASH_NEXT_ROOT"

# Unmeasured: ranks below any measured combination for the same machine. It
# offers there. Remove once the profiles below hold measured numbers.
AUTO_SELECT=0

# The machines this combination's numbers were measured on, as
# machine's DMI product name against these and says plainly when it is a
# different box with the same chip. Empty until the first measured run; the
# target machine is minisforum-ms-s1-max.
TESTED_ON=""

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh

BACKEND="llamacpp"                        # -> lib/llamacpp.sh
# pi by default: its system prompt is a fraction of OpenCode's, and at a few
# hundred tok/s prefill every prompt token is felt on the first turn. Needs
# sudo npm install -g @earendil-works/pi-coding-agent). CLIENT=opencode or
# --client opencode for the other.
CLIENT="${CLIENT:-pi}"

SYSTEM_PACKAGES=()

MIN_DEVICE_MEM_MIB=105472
MIN_OS_RESERVE_MIB=6144                   # warn if the GPU may take more than RAM minus this

# The MTP draft head is most of this model's speed on this chip: 17 tok/s
# without it, 32-61 with it (drluoto, same chip, a fork). Upstream llama.cpp
# cannot load a qwen4exp MTP head yet; PR #28243 does, and its branch is
# Unsloth's, who publish the weights below. It floats on that branch until
# the PR merges; then point this back at upstream master. lib/verify.sh's
# rollback returns to the last verified commit of this branch.
LLAMA_REPO_URL="https://github.com/danielhanchen/llama.cpp.git"
LLAMA_BRANCH="qwen4exp/mtp"

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

# -lm dio: load with direct I/O. Page-cache mapping of a 94 GB file on unified
# memory double-counts memory, and drluoto measured mmap 9-12% slower decode
# on this chip than dio. (llama.cpp removed --no-mmap for --load-mode, #28334;
# its default "auto" already avoids mmap on integrated GPUs.)
# --ctx-checkpoints: the Gated DeltaNet layers cannot roll back, so without
# saved checkpoints a returning agent turn re-reads its whole prompt.
LLAMA_EXTRA_ARGS="-lm dio --ctx-checkpoints 8"

# MTP: draft 4 tokens a step and keep every one the head proposes (p-min 0).
# 4, not drluoto's 3: at depth 3 a pi coding session on tritus accepted 0.86-0.89
# of drafts, 3.6 tokens a step of a possible 4, so most steps used every draft.
# Chosen to watch in the canvas run, not yet measured against 3 (Unsloth's
# default for their heads is 2). MTP is a win for one request at a time and was
# measured a net loss (0.81-0.87x) at 8 concurrent, so the agents profile needs
# its own check. No n-gram fallback: on this chip each n-gram verification costs
# 230-480 ms and it lost on everything but prose (drluoto).
SPEC_DRAFT_N_MAX=4
SPEC_DRAFT_P_MIN=0.0

# A 94 GB load takes minutes, not seconds. ESTIMATES until measured: give the
# first load and the smoke test room, and do not throw the weights away after
# a five-minute coffee break.
SMOKE_TIMEOUT=900
SERVER_START_TIMEOUT_DEFAULT=900
IDLE_TIMEOUT_DEFAULT=1800

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="flash-next-metal"
CONTEXT_LIMIT=131072                      # must match the default profile's ctx
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------

low_memory_advice() {
  warn ""
  warn " The weights alone are ~87 GiB. Metal's working set on a 128 GB M5 Max is ~107.5 GiB, so the"
  warn " 131,072-token coding profile fits with little room to spare. Close other large apps."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO YET on a Mac. The same stack on Strix Halo (Vulkan, tritus) measured
52.3 / 42.9 / 30.9 tok/s decode at 2k / 32k / 120k context with MTP depth 4; see
../../ubuntu/strix-halo-128GB/llamacpp-pi/README.md.
TXT
}
