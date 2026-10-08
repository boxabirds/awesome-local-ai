#!/usr/bin/env bash
# combinations/qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi/config.sh
#
# Underdog Saluki 27B 1.0 (a 2-bit, tool-calling-tuned build of Qwen3.8-27B by Underdog / ConwayResearch) with the base model's
# MTP head grafted on by Kujira, on a 24GB NVIDIA GPU under Ubuntu, served by llama.cpp with speculative decoding, driven by pi.
# The serving setup is the Swift 1.5 combination's (llama.cpp, built-in draft-mtp, 128k context, reasoning effort low, the model
# card's sampler), so the two can be compared directly; only the weights differ.
#
# Read from the model cards and the Hub API (8 Oct 2026), not yet from the file itself:
#   * Kujira/Underdog-Saluki-27B-1.0-MTP-GGUF, one file, 8.35 GB (7.78 GiB), Apache 2.0. Its 851 main tensors are byte-identical to
#     ConwayResearch's Underdog-Saluki-27B-1.0-IQ2-mix.gguf; 15 tensors (blk.64.*, the MTP layer, Q8_0 and F32) were added from the
#     head Unsloth quantised for Qwen3.8-27B, and qwen35.block_count 64 -> 65, qwen35.nextn_predict_layers = 1: the same layout as
#     Swift's in-file head, so the built-in draft-mtp path applies unchanged.
#   * The pin below is the repository commit at the time it was added and the sha256 the card prints. The install refuses a file
#     that does not match: both uploads were a day old.
#   * The author measured 41 -> 66 tok/s with MTP on an RTX 3080 12GB at temperature 0, 32k context. Our sampler is temperature 1.0,
#     so that figure does not predict ours. Not measured here.
#
# This file is DATA. All the logic lives in lib/.


# ---- identity -------------------------------------------------------------
INSTALL_ID="underdog-qwen38-27b"             # install dir, command prefix, service name
DISPLAY_NAME="Underdog Saluki 27B (2-bit, MTP)"
MODEL_DISPLAY_NAME="Underdog Saluki 27B 1.0 IQ2-mix + MTP GGUF"
ROOT_ENV_VAR="UNDERDOG_QWEN38_ROOT"          # user-facing override for the install root

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="22.04"
ACCEL="cuda"                                # -> lib/accel/cuda.sh
BACKEND="llamacpp"                          # -> lib/llamacpp.sh
CLIENT="${CLIENT:-pi}"                  # default client: pi, which the benchmarks use (OpenCode is installed too: --client opencode)

SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils)

MIN_DEVICE_MEM_MIB=23000                    # 24GB cards report ~24047-24564 usable
MIN_DRIVER_VERSION=550                      # 580 validated (on Swift 1.0)
MIN_LLAMA_COMMIT_DATE="2026-08-13"          # must support qwen35 + built-in draft-mtp

# ---- weights --------------------------------------------------------------
# QUANT is overridable for smaller cards, e.g. QUANT=Q3_K_M ./install-...sh
MODEL_SUBDIR="models"
MODEL_ASSETS="
Kujira/Underdog-Saluki-27B-1.0-MTP-GGUF|Underdog-Saluki-27B-1.0-IQ2-mix-MTP.gguf|model|7.8 GiB
"
# Pinned (lib/model.sh): the Hub commit of the repository on 8 Oct 2026, and the sha256 its card prints for the one file.
MODEL_REVISION="5d92db9b7aa466a7c8f55e26dac2e366c36e8e5b"
MODEL_SHA256="98f6ebb527917a2541df8e667d51c3ec8a8bb135b44c606d40cc6ed924e89e52  Underdog-Saluki-27B-1.0-IQ2-mix-MTP.gguf"
MODEL_ALIAS_DEFAULT="qwen3.8-underdog-saluki-27b" # stable id advertised at /v1/models
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
# Thinking, written down on the command line (3 Oct 2026, the owner's decision after the thinking-spread work found
# this stack's record saying "mode unknown, no budget"). Both are what the engine did already, so the runs stay
# comparable: Qwen's template defaults to thinking on, and thinking was bounded only by the output limit, which is what
# a budget equal to it says. A real cap is a separate experiment, with its own series.
PIN_THINKING_MODE=1
REASONING_BUDGET_DEFAULT=32768             # = OUTPUT_LIMIT

# Built-in MTP head (see header): --spec-type draft-mtp, no -md sidecar.
# Draft depth kept at Swift 1.0's value for a like-for-like start; the Q4_0
# head may accept shorter runs, so re-check "draft acceptance" in the log.
SPEC_BUILTIN=1
SPEC_DRAFT_N_MAX=4
IMAGE_MIN_TOKENS=1024                       # llama.cpp's recommendation for Qwen-VL grounding

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="underdog-qwen38-local"
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  warn " The 2-bit file is 7.8 GiB; a card under 12GB should keep the context at 32768:"
  warn "   CTX=32768 KV_TYPE=q8_0 underdog-qwen38-27b-server   (the author's setting; not measured here)"
}
combination_performance() {
  cat <<'TXT'
Not measured yet on this hardware. The author's figures (model card, RTX 3080 12GB, temperature 0): 41 -> 66 tok/s with MTP,
draft acceptance 62-96%, 11.5 GB VRAM at 32k context. Our sampler is temperature 1.0, so none of that predicts ours.
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
