#!/usr/bin/env bash
# combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-opencode/config.sh
#
# Swift 1.5 (UkisAI's second reasoning-efficient retrain of Qwen3.8-27B) on a
# 24GB NVIDIA GPU under Ubuntu, served by llama.cpp with speculative decoding,
# driven by OpenCode. A different model from Swift 1.0
# (combinations/qwen/3.8-swift/...), so a separate combination.
#
# Vendor claims (model card, not reproduced here): stronger than Swift 1.0
# "especially coding and agentic", 58.5% fewer thinking tokens than base
# Qwen3.8-27B; LiveCodeBench v6 76.76% -> 81.71%, Terminal-Bench 2.1
# 69.21% -> 72.13% against the base model.
#
# Read from the GGUF header (29 Sep 2026, repo revision a1614465):
#   * same architecture as Swift 1.0: qwen35, 65 blocks, 866 tensors,
#     nextn_predict_layers=1, MTP head in blk.64 (nextn.eh_proj, enorm, hnorm,
#     shared_head_norm) -- so the built-in draft-mtp path applies unchanged;
#   * but the MTP projection is Q4_0 here (Q8_0 in Swift 1.0) and the token
#     embedding Q4_K (Q6_K in 1.0): the file is 0.54 GiB smaller, and draft
#     acceptance may differ from 1.0's measured 0.62-0.86. Not measured yet.
#   * the file's own general.name is "Miroslav 1.0" (general.version 1.0), not
#     "Swift 1.5": the identity of this combination is the repo and revision
#     below, not that label.
#
# This file is DATA. All the logic lives in lib/.

# ---- identity -------------------------------------------------------------
INSTALL_ID="swift15-qwen38-27b"             # install dir, command prefix, service name
DISPLAY_NAME="Swift 1.5 Qwen3.8-27B"
MODEL_DISPLAY_NAME="Swift 1.5 Qwen3.8-27B GGUF"
ROOT_ENV_VAR="SWIFT15_QWEN38_ROOT"          # user-facing override for the install root

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="22.04"
ACCEL="cuda"                                # -> lib/accel/cuda.sh
BACKEND="llamacpp"                          # -> lib/llamacpp.sh
CLIENT="${CLIENT:-opencode}"                # default client (overridable: --client pi / CLIENT=pi)

SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils)

MIN_DEVICE_MEM_MIB=23000                    # 24GB cards report ~24047-24564 usable
MIN_DRIVER_VERSION=550                      # 580 validated (on Swift 1.0)
MIN_LLAMA_COMMIT_DATE="2026-08-13"          # must support qwen35 + built-in draft-mtp

# ---- weights --------------------------------------------------------------
# QUANT is overridable for smaller cards, e.g. QUANT=Q3_K_M ./install-...sh
QUANT="${QUANT:-Q4_K_M}"                    # Swift 1.5 Q4_K_M = 16.245 GiB
MODEL_SUBDIR="models"
# Set up on repo revision a1614465cfa35d04d3e8575d713fa779662b5eab (24 Sep 2026).
# lib/model.sh fetches MODEL_ASSETS from the repo's main branch (no revision
# pin for llama.cpp assets), so a later upload would be picked up on a fresh
# install; benchmark runs record the file actually served.

# repo | filename | role | approx size
# No `mtp` line: the MTP head is inside the model file (SPEC_BUILTIN=1 below),
# so the installer's "MTP head missing" line is expected and harmless.
MODEL_ASSETS="
ukisai/Swift-1.5-Qwen3.8-27B-GGUF|Swift-1.5-Qwen3.8-27B-${QUANT}.gguf|model|16.2 GiB
ukisai/Swift-1.5-Qwen3.8-27B-GGUF|mmproj-Swift-1.5-Qwen3.8-27B-F16.gguf|mmproj|0.86 GiB
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.8-swift-1.5-27b" # stable id advertised at /v1/models
DEFAULT_PROFILE="coding"

# Only these have a CUDA flash-attention kernel for the qwen35 hybrid; others
# silently fall back to CPU attention.
SAFE_KV_TYPES="f16 bf16 q8_0 q4_0"

# The model card's recommended sampling (thinking). The instruct preset is
# carried from Swift 1.0's card; 1.5's card lists only the thinking one.
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
SAMPLING_INSTRUCT="--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# Same default as Swift 1.0, so the two are compared at the same setting.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low medium high xhigh"

# Built-in MTP head (see header): --spec-type draft-mtp, no -md sidecar.
# Draft depth kept at Swift 1.0's value for a like-for-like start; the Q4_0
# head may accept shorter runs, so re-check "draft acceptance" in the log.
SPEC_BUILTIN=1
SPEC_DRAFT_N_MAX=4
IMAGE_MIN_TOKENS=1024                       # llama.cpp's recommendation for Qwen-VL grounding

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="swift15-qwen38-local"
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " The default quant (Q4_K_M) is 16.2 GiB of weights and will not leave"
  warn " room for a usable KV cache on this card."
  warn ""
  if (( mem >= 15000 )); then
    warn " For a 16GB card, try a smaller quant via the QUANT env var, e.g."
    warn "   QUANT=Q3_K_M ./install-qwen-3.8-swift-1.5-27b-ubuntu-nvidia4090-llamacpp-opencode.sh"
    warn "   then: CTX=32768 KV_TYPE=q4_0 VISION=0 swift15-qwen38-27b-server"
    warn " (not measured for Swift 1.5)"
  else
    warn " Below 16GB, a 27B model is not a good fit."
  fi
  warn ""
  warn " Vision (mmproj, +0.86 GiB) should stay OFF on any card under 24GB."
}

combination_performance() {
  cat <<'TXT'
Not measured yet on this hardware. Vendor claims (model card): stronger than
Swift 1.0 on coding and agentic tasks, 58.5% fewer thinking tokens than base.
MTP built-in (Q4_0 projection; Swift 1.0's was Q8_0) -- acceptance not measured.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
"MTP head missing" at install  expected -- the MTP head is in-file, not a file
Slow generation     check the log for "creating MTP draft context" + "draft acceptance"
Empty replies       raise max_tokens -- thinking mode consumes it
Slow prompt reading KV_TYPE must be q4_0/q8_0/f16 -- others run on CPU
TXT
}
