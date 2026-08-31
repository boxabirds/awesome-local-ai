#!/usr/bin/env bash
# combinations/qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/config.sh
#
# Qwen3.8-27B on a 24GB NVIDIA GPU under Ubuntu, served by llama.cpp with
# speculative decoding, driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/. Every number here was
# measured on real hardware (RTX 4090 24GB, Ubuntu 22.04.5, driver 580.159.03,
# CUDA 12.3) -- see ../../../../../../../docs/discovery.md for the methodology
# and the configurations that failed.

# ---- identity -------------------------------------------------------------
INSTALL_ID="qwen38-27b"                   # install dir, command prefix, service name
DISPLAY_NAME="Qwen3.8-27B"
MODEL_DISPLAY_NAME="Qwen3.8-27B GGUF"
ROOT_ENV_VAR="QWEN38_ROOT"                # user-facing override for the install root

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="22.04"
ACCEL="cuda"                              # -> lib/accel/cuda.sh
BACKEND="llamacpp"                        # -> lib/llamacpp.sh
CLIENT="opencode"                         # -> lib/clients/opencode.sh

SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils)

MIN_DEVICE_MEM_MIB=23000                  # 24GB cards report ~24047-24564 usable
MIN_DRIVER_VERSION=550                    # 580 validated
MIN_LLAMA_COMMIT_DATE="2026-08-13"        # must support qwen3_5 hybrid + draft-mtp

# ---- weights --------------------------------------------------------------
# QUANT is overridable for smaller cards, e.g. QUANT=UD-Q3_K_XL ./install-...sh
QUANT="${QUANT:-UD-Q4_K_XL}"              # UD-Q4_K_XL = 16.7 GiB
MODEL_SUBDIR="models/Qwen3.8-27B-GGUF"

# repo | filename | role | approx size
#
# The MTP head comes from a different repo on purpose: unsloth/Qwen3.8-27B-GGUF
# ships none for Qwen3.8 (verified against its HF manifest -- model, projector
# and template layers only). ggml-org builds its head from the same
# Qwen/Qwen3.8-27B base, so mixing the two is deliberate and verified.
MODEL_ASSETS="
unsloth/Qwen3.8-27B-GGUF|Qwen3.8-27B-${QUANT}.gguf|model|16.7 GiB
unsloth/Qwen3.8-27B-GGUF|mmproj-F16.gguf|mmproj|0.87 GiB
ggml-org/Qwen3.8-27B-GGUF|mtp-Qwen3.8-27B-Q4_0.gguf|mtp|1.6 GiB
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.8-27b"         # stable id advertised at /v1/models
DEFAULT_PROFILE="coding"

# Only these have a CUDA flash-attention kernel for this model. q4_1, q5_0,
# q5_1 and iq4_nl silently fall back to CPU attention -- measured 48 tok/s
# prefill against 2300. See docs/discovery.md section 2b.
SAFE_KV_TYPES="f16 bf16 q8_0 q4_0"

# Thinking mode and its sampler are a matched pair; the Qwen3.8 card specifies
# different sampling for each and warns that the thinking preset causes
# repetition on the non-thinking path.
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
SAMPLING_INSTRUCT="--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# Reasoning effort. The Qwen3.8 chat template defaults to xhigh whenever the
# field is unset -- verified in the template itself:
#   {%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}
# xhigh instructs the model to validate assumptions and weigh alternatives,
# which is the right call for hard problems and a poor one for the routine
# edits that make up most agent traffic. Default to low and let callers raise
# it. The template accepts xhigh, medium and low, aliases high -> xhigh, and
# RAISES on anything else -- so the launcher rejects unsupported values rather
# than letting every request fail.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low medium high xhigh"

SPEC_DRAFT_N_MAX=2
IMAGE_MIN_TOKENS=1024                     # llama.cpp's recommendation for Qwen-VL grounding

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="qwen38-local"
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
# Called by lib/accel/cuda.sh when the device is below MIN_DEVICE_MEM_MIB.
# Fail with actionable numbers rather than letting the user discover it via a
# CUDA OOM 20 GB into a download.
low_memory_advice() {
  local mem="$1"
  warn " The default quant (UD-Q4_K_XL) is 17,092 MiB of weights and will"
  warn " not leave room for a usable KV cache on this card."
  warn ""
  if (( mem >= 15000 )); then
    warn " For a 16GB card, try a smaller quant via the QUANT env var."
    warn " ESTIMATED (extrapolated from 24GB measurements, NOT verified):"
    warn ""
    warn "   QUANT=UD-Q3_K_XL   12,817 MiB  + MTP  ->  ~32k ctx"
    warn "   QUANT=UD-Q3_K_XL   12,817 MiB  no MTP ->  ~96k ctx"
    warn "   QUANT=UD-IQ3_XXS   11,358 MiB  + MTP  ->  ~64k ctx"
    warn "   QUANT=UD-Q2_K_XL    9,948 MiB  + MTP  -> ~128k ctx"
    warn ""
    warn " Recommended starting point for 16GB:"
    warn "   QUANT=UD-Q3_K_XL ALLOW_LOW_VRAM=1 \$0"
    warn "   then: CTX=32768 KV_TYPE=q4_0 VISION=0 qwen38-27b-server"
    warn ""
    warn " Dropping MTP frees 1,602 MiB, worth ~64k tokens at q4_0 -- on a"
    warn " 16GB card that trade usually favours context over speculative"
    warn " decoding."
  else
    warn " Below 16GB, a 27B model is not a good fit. Consider a smaller"
    warn " Qwen3.8 variant or a 4-8B class model instead."
  fi
  warn ""
  warn " Vision (mmproj, +891 MiB) should stay OFF on any card under 24GB."
  warn " See docs/discovery.md for the full measurement methodology."
}

combination_performance() {
  cat <<'TXT'
Generation (MTP on)          ~92 tok/s
Generation (MTP off)         ~44 tok/s
Prefill (pp2048, -ub 256)  ~2700 tok/s
Prefill (pp2048, -ub 512)  ~2915 tok/s
Model load (warm cache)        ~4 s
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Empty replies       raise max_tokens -- thinking mode consumes it
Slow generation     check the log for 'draft acceptance'
Slow prompt reading KV_TYPE must be q4_0/q8_0/f16 -- others run on CPU
CUDA out of memory  free the GPU, or use PROFILE=balanced
TXT
}
