#!/usr/bin/env bash
# combinations/qwen/3.8-swift/27b/ubuntu/24GB/llamacpp-opencode/config.sh
#
# Swift-Qwen3.8-27B on a 24GB NVIDIA GPU under Ubuntu, served by llama.cpp
# with speculative decoding, driven by OpenCode.
#
# Swift is a retrained Qwen3.8-27B that thinks less: fewer reasoning tokens for
# the same task, so a session that spends its time deliberating spends less of
# it. Local A/B on this hardware (docs/20260921-swift-qwen38-27b-ab.md) measured
# 23-39% less deliberation and 1.37-1.51x faster end-to-end across the
# low/medium/xhigh sweep, at no measurable coding-quality cost on the bench
# prompts. It also bakes its MTP head (Q8_0) INTO the GGUF, so there is no
# separate sidecar file and the ~1.57 GiB the baseline carries is gone.
#
# This file is DATA. All the logic lives in lib/.

# ---- identity -------------------------------------------------------------
INSTALL_ID="swift-qwen38-27b"               # install dir, command prefix, service name
DISPLAY_NAME="Swift Qwen3.8-27B"
MODEL_DISPLAY_NAME="Swift Qwen3.8-27B GGUF"
ROOT_ENV_VAR="SWIFT_QWEN38_ROOT"            # user-facing override for the install root

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="22.04"
ACCEL="cuda"                                # -> lib/accel/cuda.sh
BACKEND="llamacpp"                          # -> lib/llamacpp.sh
CLIENT="${CLIENT:-opencode}"                # default client (overridable: --client pi / CLIENT=pi)

SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils)

MIN_DEVICE_MEM_MIB=23000                    # 24GB cards report ~24047-24564 usable
MIN_DRIVER_VERSION=550                      # 580 validated
MIN_LLAMA_COMMIT_DATE="2026-08-13"          # must support qwen35 + built-in draft-mtp

# ---- weights --------------------------------------------------------------
# QUANT is overridable for smaller cards, e.g. QUANT=Q3_K_M ./install-...sh
QUANT="${QUANT:-Q4_K_M}"                    # Swift Q4_K_M = 16.787 GiB
MODEL_SUBDIR="models"

# repo | filename | role | approx size
#
# There is deliberately NO `mtp` line. Swift bakes its multi-token-prediction
# head (Q8_0) into the model file, so speculative decoding engages via
# SPEC_BUILTIN=1 below with no sidecar to fetch. The "MTP head missing" line
# the installer prints is therefore EXPECTED and harmless for this combination
# (see README / help.txt) -- it is reporting the absence of a file that this
# model never had.
MODEL_ASSETS="
ukisai/Swift-Qwen3.8-27B-GGUF|Swift-Qwen3.8-27B-${QUANT}.gguf|model|16.8 GiB
ukisai/Swift-Qwen3.8-27B-GGUF|mmproj-Swift-Qwen3.8-27B-F16.gguf|mmproj|0.86 GiB
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.8-swift-27b"     # stable id advertised at /v1/models
DEFAULT_PROFILE="coding"

# Only these have a CUDA flash-attention kernel for this model (qwen35 hybrid).
# q4_1, q5_0, q5_1 and iq4_nl silently fall back to CPU attention. Same set as
# the baseline -- the arch is the Qwen3.8 hybrid either way.
SAFE_KV_TYPES="f16 bf16 q8_0 q4_0"

# Thinking mode and its sampler are a matched pair; the card specifies
# different sampling for each and warns the thinking preset causes repetition
# on the non-thinking path.
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
SAMPLING_INSTRUCT="--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# Reasoning effort. The chat template defaults to xhigh when the field is
# unset, which is a lot of tokens for routine work -- so ship 'low' and let
# callers raise it. (Swift's whole point is that each effort level costs it
# fewer tokens than the baseline; see the A/B report.)
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low medium high xhigh"

# Built-in MTP head: it is inside the GGUF, so there is no -md sidecar.
# SPEC_BUILTIN turns the launcher into the built-in path (just --spec-type
# draft-mtp + a draft depth, no -md / draft-n-gl / draft KV type). draft-n-max
# 3 matches Swift's 3-layer head and is what the A/B measured spec decoding
# live on.
SPEC_BUILTIN=1
SPEC_DRAFT_N_MAX=3
IMAGE_MIN_TOKENS=1024                       # llama.cpp's recommendation for Qwen-VL grounding

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="swift-qwen38-local"
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " The default quant (Q4_K_M) is 16.8 GiB of weights and will not leave"
  warn " room for a usable KV cache on this card."
  warn ""
  if (( mem >= 15000 )); then
    warn " For a 16GB card, try a smaller quant via the QUANT env var."
    warn " (Swift ships its MTP head in-file, so it has ~1.5 GiB more headroom"
    warn "  than the baseline combination at the same ctx -- figures below are"
    warn "  ESTIMATED, not verified.)"
    warn ""
    warn "   QUANT=Q3_K_M   ~13.6 GiB  ->  ~96k ctx   (estimated)"
    warn "   QUANT=Q2_K     ~11.5 GiB  ->  ~128k ctx  (estimated)"
    warn ""
    warn "   then: CTX=32768 KV_TYPE=q4_0 VISION=0 swift-qwen38-27b-server"
  else
    warn " Below 16GB, a 27B model is not a good fit. Consider a smaller"
    warn " Qwen3.8 variant or a 4-8B class model instead."
  fi
  warn ""
  warn " Vision (mmproj, +0.86 GiB) should stay OFF on any card under 24GB."
}

combination_performance() {
  cat <<'TXT'
End-to-end A/B vs the baseline combination (5 prompts, 3 efforts, RTX 4090):
  low       1.37x faster   -30.5% reasoning
  medium    1.38x faster   -23.3% reasoning
  xhigh     1.51x faster   -38.6% reasoning
MTP built-in (Q8_0, no sidecar)  draft acceptance 0.62-0.86, mean len 2.87-3.58
Full method, table and caveats: docs/20260921-swift-qwen38-27b-ab.md
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
"MTP head missing" at install  expected -- Swift's MTP is in-file, not a file
Slow generation     check the log for "creating MTP draft context" + "draft acceptance"
Empty replies       raise max_tokens -- thinking mode consumes it
Slow prompt reading KV_TYPE must be q4_0/q8_0/f16 -- others run on CPU
TXT
}
