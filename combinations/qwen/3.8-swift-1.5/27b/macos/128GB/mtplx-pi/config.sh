#!/usr/bin/env bash
# combinations/qwen/3.8-swift-1.5/27b/macos/128GB/mtplx-pi/config.sh
#
# Swift 1.5 (UkisAI's second reasoning-efficient retrain of Qwen3.8-27B) on a
# 128 GB Apple silicon Mac, served by MTPLX with native MTP speculative
# decoding, driven by pi. The macOS counterpart of
# combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi.
#
# No MTPLX pack of Swift 1.5 is published, so the installer builds one with
# MTPLX Forge from UkisAI's safetensors repository (BF16 body, 15 MTP tensors:
# `mtplx forge probe` reports "BF16/native MTP source detected; Forge will
# convert the body and preserve MTP"). The recipe is the one the stock
# Qwen3.8-27B Optimized-Quality pack records in its mtplx_runtime.json
# (forge_recipe): 8-bit affine body, group size 64, MTP head kept in bf16. So
# this stack differs from the stock 27B MTPLX pack in the fine-tune, not in
# the quantisation.
#
# This file is DATA. All the logic lives in lib/. Nothing here is measured on
# this model yet in an agent session; profiles.tsv has the smoke test's
# footprint and Forge's verification figures.

# ---- identity -------------------------------------------------------------
INSTALL_ID="mtplx-swift15-27b"
DISPLAY_NAME="Swift 1.5 Qwen3.8-27B"
MODEL_DISPLAY_NAME="Swift 1.5 Qwen3.8-27B (MTPLX Forge, 8-bit body)"
ROOT_ENV_VAR="MTPLX_SWIFT15_27B_ROOT"

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="mtplx"                           # -> lib/mtplx.sh
CLIENT="${CLIENT:-pi}"                    # default client: pi, which the benchmarks use (OpenCode is installed too: --client opencode)

SYSTEM_PACKAGES=()

# The stock 27B pack's floor. This model measured 29,257 MiB resident at 131072 ctx (smoke test, 9 Nov 2026).
MIN_DEVICE_MEM_MIB=38000
# 2.12.3 (6 Nov 2026) fixes MTPLX issue 605, HTTP 500 on valid requests, which quarantined MTPLX from 16 Oct to 9 Nov.
MIN_MTPLX_VERSION="2.12.3"

# ---- weights --------------------------------------------------------------
# Built locally by MTPLX Forge (lib/mtplx.sh, _mtplx_forge_model): MODEL_REPO
# is the name Forge gives the result, which `mtplx models --json` lists.
FORGE_SOURCE_REPO="ukisai/Swift-1.5-Qwen3.8-27b"
FORGE_RECIPE='{"body_bits":8,"body_group_size":64,"body_mode":"affine","mtp_policy":"keep_bf16"}'
MODEL_REPO="Swift-1.5-Qwen3.8-27B-MTPLX-Q8"
MODEL_APPROX_SIZE="a 55.6 GB source download, then a 30.4 GB build"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="mtplx-swift15-27b-q8"
DEFAULT_PROFILE="coding"
DEFAULT_PORT=8010

# The model card's recommended sampling (thinking), the same as the llama.cpp
# Swift 1.5 combination. The instruct preset is carried from Swift 1.0's card.
SAMPLING_THINKING="--default-temperature 1.0 --default-top-p 0.95 --default-top-k 20"
SAMPLING_INSTRUCT="--default-temperature 0.7 --default-top-p 0.80 --default-top-k 20 --default-presence-penalty 1.5"

# Applied SERVER-side; the same default as every Swift and MTPLX stack here.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default auto low medium high xhigh"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="mtplx"
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This model is built with the stock Qwen3.8-27B pack's recipe, which"
  warn " wires 27.9 GB of weights (MEASURED for the stock pack, not this one)."
  warn " ${mem} MiB of GPU-addressable memory does not leave room for a"
  warn " usable context on top."
}

combination_performance() {
  cat <<'TXT'
Not measured yet on this model. The stock Qwen3.8-27B MTPLX pack, built with
the same recipe, measured 26.2 tok/s decode in an agent session on an Apple
M5 Max (mtplx 2.10.1); Swift 1.5's MTP head is its own, so draft acceptance
may differ. Vendor claims (model card): 58.5% fewer thinking tokens than base.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Install takes long    the first run downloads 55.6 GB and builds the model
Dropped download      re-run the installer; finished shards are kept
Empty replies         raise max_tokens -- thinking mode consumes it
Effort seems ignored  it is set server-side
TXT
}
