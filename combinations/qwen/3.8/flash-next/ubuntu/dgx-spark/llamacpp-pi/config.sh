#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/ubuntu/dgx-spark/llamacpp-pi/config.sh
#
# Qwen3.8-Flash-Next (125B total, ~6B active, qwen4exp architecture) on an
# NVIDIA DGX Spark (GB10: Arm CPU, Blackwell GPU sm_121, 128 GB unified
# memory) under DGX OS (Ubuntu 24.04), served by llama.cpp on CUDA with the
# qwen4exp MTP draft head (PR #28243), driven by pi.
#
# This file is DATA. All the logic lives in lib/ (lib/accel/cuda.sh,
# lib/llamacpp.sh, lib/runtime/server-llamacpp.sh).
#
# THE BASELINE FOR THE SPARK. Everything that decides what the model does --
# llama.cpp branch, quant, MTP head, KV type, sampling, reasoning effort,
# batch, load mode, draft depth, profiles, client -- is the Strix Halo
# llama.cpp combination's (strix-halo-128GB/llamacpp-pi), so a score against
# that one or the M5 Max's llamacpp-pi differs by the machine alone.
# tests/dgx-spark-test.sh holds the two configs equal on those keys.
#
# NOT MEASURED BY THIS REPO YET. Machine facts are a DGX Spark's, read 29 Oct 2026
# (Ubuntu 24.04.5, kernel 7.0.0-1019-nvidia, driver 580.178.04, CUDA 13.0,
# MemTotal 124,608 MiB). Memory figures are the Strix Halo estimates.

# ---- identity -------------------------------------------------------------
INSTALL_ID="qwen38-flash-next-spark"
DISPLAY_NAME="Qwen3.8-Flash-Next (DGX Spark)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next GGUF (Unsloth)"
ROOT_ENV_VAR="QWEN38_FLASH_NEXT_ROOT"

# Unmeasured: ranks below any measured combination for the same machine.
AUTO_SELECT=0

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="24.04"                 # DGX OS 7 is Ubuntu 24.04
ACCEL="cuda"                              # -> lib/accel/cuda.sh
# GB10 reports compute capability 12.1. The kernels are built here for it
# (CMAKE_CUDA_ARCHITECTURES=121), which needs CUDA 12.9 or newer; DGX OS
# ships 13.0 at /usr/local/cuda.
ACCEL_ARCHS_VERIFIED="121"
BACKEND="llamacpp"                        # -> lib/llamacpp.sh
CLIENT="${CLIENT:-pi}"

SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils)

# Unified memory: nvidia-smi reports no device memory on a GB10, so
# lib/accel/cuda.sh takes MemTotal. Same need as the Strix Halo profiles:
# the default profile's need_mib plus room for the compute graph.
MIN_DEVICE_MEM_MIB=105472
MIN_DRIVER_VERSION=580                    # 580.178 on the Spark measured

# The Strix Halo combination's branch, kept for comparability. There the MTP
# draft head is most of the speed: 17 tok/s without it, 32-61 with it
# (drluoto, a fork). Whether the branch builds and runs on sm_121 is what the
# first install here finds out. Upstream llama.cpp
# cannot load a qwen4exp MTP head yet; PR #28243 does, and its branch is
# Unsloth's, who publish the weights below. It floats on that branch until
# the PR merges; then point this back at upstream master. lib/verify.sh's
# rollback returns to the last verified commit of this branch.
LLAMA_REPO_URL="https://github.com/danielhanchen/llama.cpp.git"
LLAMA_BRANCH="qwen4exp/mtp"

# qwen4exp landed in #27742 (2026-08-27); the floor is the Strix Halo
# combination's (#28604, a ROCm fix), so both build from the same range.
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

# f16 only, as on Strix Halo (where bf16 crashes). Quantised KV has been reported to
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
# memory double-counts memory (the GB10's memory is unified too), and drluoto
# measured mmap 9-12% slower decode than dio on Strix Halo. (llama.cpp removed --no-mmap for --load-mode, #28334;
# its default "auto" already avoids mmap on integrated GPUs.)
# --ctx-checkpoints: the Gated DeltaNet layers cannot roll back, so without
# saved checkpoints a returning agent turn re-reads its whole prompt.
LLAMA_EXTRA_ARGS="-lm dio --ctx-checkpoints 8"

# MTP: draft 4 tokens a step and keep every one the head proposes (p-min 0).
# 4, not drluoto's 3: at depth 3 a pi coding session on the Strix Halo box accepted 0.86-0.89
# of drafts, 3.6 tokens a step of a possible 4, so most steps used every draft.
# Chosen to watch in the canvas run, not yet measured against 3 (Unsloth's
# default for their heads is 2). MTP is a win for one request at a time and was
# measured a net loss (0.81-0.87x) at 8 concurrent, so the agents profile needs
# its own check. No n-gram fallback, as on Strix Halo, where each n-gram
# verification cost 230-480 ms and it lost on everything but prose (drluoto).
SPEC_DRAFT_N_MAX=4
SPEC_DRAFT_P_MIN=0.0

# A 94 GB load takes minutes, not seconds. ESTIMATES until measured: give the
# first load and the smoke test room, and do not throw the weights away after
# a five-minute coffee break.
SMOKE_TIMEOUT=900
SERVER_START_TIMEOUT_DEFAULT=900
IDLE_TIMEOUT_DEFAULT=1800

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="flash-next-spark"
CONTEXT_LIMIT=131072                      # must match the default profile's ctx
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
# Called by lib/accel/cuda.sh when MemTotal is below MIN_DEVICE_MEM_MIB. On a
# Spark that means something else is holding memory, or this is not a Spark.
low_memory_advice() {
  warn ""
  warn " A DGX Spark has 128 GB; MemTotal should be about 124,600 MiB. A smaller"
  warn " quant does not rescue less: UD-Q3_K_XL is still 90 GB."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO YET. No published Flash-Next figures on a Spark were
found (benchmarks/inference-server-concurrency/dgx-spark.md). The Spark's
273 GB/s is the Strix Halo box's memory class, where this stack measured:
  Decode with MTP, UD-IQ4_XS            see strix-halo-128GB/llamacpp-pi
  Prefill                               the Spark's CUDA compute is the open question
Measure here; the benchmark runs are the record.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Refused at qualification  MemTotal below the need: stop what else holds memory
nvcc not found            DGX OS has CUDA 13 at /usr/local/cuda; check the alternatives link
Build fails for sm_121    CUDA older than 12.9; use the DGX OS toolkit
Server will not start     'unknown model architecture qwen4exp' = llama.cpp too old; re-run
Tool calls go wrong       KV must be f16; do not quantise it on this model
No draft acceptance line  the MTP head did not load; check the server log for -md
Machine freezes           a Spark can hang when memory runs out; use a smaller profile
TXT
}
