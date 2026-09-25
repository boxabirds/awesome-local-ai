#!/usr/bin/env bash
# combinations/qwen/3.6/35b-a3b/ubuntu/nvidia3090/sglang-opencode/config.sh
#
# Qwen3.6-35B-A3B (MoE, 3B active), EXL3 3.00 bpw with a 5-bit head, on one
# 24GB RTX 3090, served by stock SGLang v0.5.20 with the sglang-exl3 plugin
# from a digest-pinned container image, driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/ (lib/sglang.sh,
# lib/runtime/server-sglang.sh).
#
# NOT MEASURED BY THIS REPO. Every value below is transcribed from the merged
# recipe in 0xSero/local-ai-registry (PR #83), measured by the recipe author on
# a bare RTX 3090 24 GB. The registry lists this recipe as status "candidate"
# (not "validated"). Nobody has run it through this installer. See README.md.
#
# Sources (read 2026-09-24):
#   registry/recipe/qwen36-35b-a3b-exl3-3bpw-rtx3090-sglang-tp1.json
#   registry/model-instance/yeasah-qwen3-6-35b-a3b-exl3--3-00bpw-h5.json
#   registry/speed-sweep/qwen36-35b-a3b-exl3-3bpw-rtx3090-sglang-tp1-sweep.json

# ---- identity -------------------------------------------------------------
INSTALL_ID="qwen36-35b-a3b-exl3-sglang"
DISPLAY_NAME="Qwen3.6-35B-A3B EXL3 (SGLang)"
MODEL_DISPLAY_NAME="Qwen3.6-35B-A3B EXL3 3.00bpw-H5"
ROOT_ENV_VAR="QWEN36_EXL3_ROOT"

# Never the automatic pick: unmeasured here. Installable by name.
AUTO_SELECT=0

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
ACCEL="cuda"                              # -> lib/accel/cuda.sh
BACKEND="sglang"                          # -> lib/sglang.sh
CLIENT="${CLIENT:-opencode}"

SYSTEM_PACKAGES=(curl python3 python3-pip pciutils)

MIN_DEVICE_MEM_MIB=23000
# CUDA 13.0 image (NVIDIA_REQUIRE_CUDA=cuda>=13.0): r580+ driver. The hard gate
# is SGLANG_MIN_HOST_CUDA, checked against nvidia-smi.
MIN_DRIVER_VERSION=580
SGLANG_MIN_HOST_CUDA="13.0"

# Kernels built with TORCH_CUDA_ARCH_LIST=8.6; run on an RTX 3090 only.
ACCEL_ARCHS_VERIFIED="86"

# ---- image ----------------------------------------------------------------
# The same image as the 27B recipe (it carries both token maps).
SGLANG_IMAGE="ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8"
SGLANG_IMAGE_APPROX_SIZE="~15.4 GB compressed"
SGLANG_ATTESTATION_OWNER="0xSero"
SGLANG_SHM_SIZE="16g"
SGLANG_CONTAINER_PORT=30000

# ---- weights --------------------------------------------------------------
MODEL_REPO="yeasah/Qwen3.6-35B-A3B-exl3"
MODEL_REVISION="73da68ef827084d72c59936b4c2088c6580f4e2b"
MODEL_WEIGHTS_DIR="Qwen3.6-35B-A3B-EXL3-3.00bpw-H5"
MODEL_APPROX_SIZE="15.92 GB"
SGLANG_CONTAINER_MODEL_DIR="/models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5"
# The recipe JSON lists no hashes for this checkpoint (the PR says both were
# verified against the published Hugging Face hashes). These ARE those
# published hashes: the LFS sha256 of each shard at this revision, read from
# the Hugging Face paths-info API on 2026-09-24.
MODEL_SHA256="
0063038c580a4804407742997e8aa42e89efb1c691c90249c27e0313a186f0b6  model-00001-of-00002.safetensors
16b1f86158ce817d1b7714bf02773dbc68b56c9de66ffd6ee210f475a928b1e6  model-00002-of-00002.safetensors
"

# ---- serving --------------------------------------------------------------
# The recipe's launch.environment, verbatim (no SGLANG_EXL3_EMBED_HOST here).
SGLANG_ENV="
CUDA_DEVICE_ORDER=PCI_BUS_ID
HF_HUB_OFFLINE=1
SGLANG_EXL3_KERNEL=auto
SGLANG_EXL3_MODEL_PATH=/models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5
"

# The recipe's launch.arguments, verbatim, minus the flags the launcher owns
# (--host/--port, --served-model-name, --context-length,
# --mem-fraction-static, --disable-prefill-cuda-graph -- see profiles.tsv).
SGLANG_BASE_ARGS="
python3 -m sglang.launch_server
--model-path /models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5
--quantization exl3
--trust-remote-code
--kv-cache-dtype fp8_e4m3
--mamba-ssm-dtype bfloat16
--max-running-requests 2
--max-mamba-cache-size 10
--cuda-graph-max-bs-decode 2
--chunked-prefill-size 2048
--max-prefill-tokens 4096
--reasoning-parser qwen3
--tool-call-parser qwen3_coder
--speculative-algorithm NEXTN
--speculative-num-steps 3
--speculative-eagle-topk 1
--speculative-num-draft-tokens 4
--speculative-token-map /opt/sglang-exl3/tokenmaps/qwen36_hot32k_v2.pt
--disable-shared-experts-fusion
"

MODEL_ALIAS_DEFAULT="Qwen3.6-35B-A3B-EXL3-3.00bpw-H5"   # the recipe's served id
DEFAULT_PROFILE="full"
DEFAULT_PORT=30000

# SGLang takes sampling defaults from generation_config.json (temperature 1.0,
# top_p 0.95, top_k 20 at this revision). Informational only.
SAMPLING_THINKING="generation_config.json"

# This revision's chat template has NO reasoning_effort -- only
# enable_thinking. So there is no effort to set; THINKING=0 is the only lever.
REASONING_EFFORT_DEFAULT="default"
REASONING_EFFORTS="default"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="qwen36-exl3-local"
CONTEXT_LIMIT=262144
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
arch_advice() {
  local cc="$1"
  warn " What is known (quoted, not tested here):"
  warn "   * image tag v0.5.1-ampere; image env TORCH_CUDA_ARCH_LIST=8.6"
  warn "   * recipe: 'exllamav3 1.5.1 AOT for sm_86', 'a grouped EXL3 kernel for"
  warn "     the 35B's 256 routed experts'; plugin: 'Ampere sm_86 first'"
  if (( cc >= 80 && cc < 90 )); then
    warn " sm_${cc} is the same major architecture as sm_86. CUDA can in principle"
    warn " load sm_86 kernels on it, but nobody has run this image on one. UNVERIFIED."
  else
    warn " sm_${cc} is a different major architecture. Kernels built only for 8.6"
    warn " (no PTX) are not expected to load on it; expect a failure at model load."
  fi
}

low_memory_advice() {
  warn " The recipe needs a whole 24 GB card (peak 21.90 GiB at the 262k window)."
  warn " The recipe notes the AWQ-INT4 build of this model (25 GB) does not fit 24 GB either."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO. Recipe author, bare RTX 3090, profile 'full', C1:
Decode, prose, thinking off      251.9 tok/s
Decode, code, thinking off       352.1 tok/s
Decode, prose, 32k prompt        214.3 tok/s
Cold prefill, 32k prompt          4.5k tok/s (TTFT 7.3 s)
Two streams, aggregate prose     388.5 tok/s
Coherence ladder               OK to a 257,971-token prompt (TTFT 172 s)
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Container cannot see GPU  NVIDIA Container Toolkit -- see README 'Requirements'
Fails at model load       non-sm_86 GPU? the kernels are built for 8.6 only
Long prompts rejected     something else is on the card; PROFILE=desktop
Slow generation           smoke.log: 'accept len' in decode lines (MTP)
TXT
}
