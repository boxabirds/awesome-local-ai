#!/usr/bin/env bash
# File: combinations/qwen/3.8/flash-next/ubuntu/128GB/turboquant/config.sh

export ACCEL="strix-halo"
export BACKEND="llamacpp-turboquant"
export REPO_URL="https://github.com/TheTom/llama-cpp-turboquant.git"
export REPO_BRANCH="feature/turboquant-kv-cache"

# Upstream raw source weights
export BASE_MODEL_ID="Qwen/Qwen3.8-Flash-Next"
export MODEL_ID="unsloth/Qwen3.8-Flash-Next-GGUF"
export QUANT_TARGET="Q4_K_M_TQ"

export MAX_CONTEXT=131072
export DEFAULT_SLOTS=1
export MTP_DRAFT_LEN=3

# Kernel / Driver allocations for your 128GB UMA memory tracks
export TARGET_GTT_SIZE_MB=114688  # 112 GB out of 128GB allocated to GTT

# Custom User HF Destination Hub Configuration (populated dynamically by upload script)
export CUSTOM_HF_REPO=""
export CUSTOM_HF_FILE="Qwen3.8-Flash-Next-${QUANT_TARGET}.gguf"
