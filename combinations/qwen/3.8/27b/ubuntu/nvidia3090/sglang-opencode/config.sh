#!/usr/bin/env bash
# combinations/qwen/3.8/27b/ubuntu/nvidia3090/sglang-opencode/config.sh
#
# Qwen3.8-27B, EXL3 3.00 bpw, on one 24GB RTX 3090, served by stock SGLang
# v0.5.20 with the sglang-exl3 plugin from a digest-pinned container image,
# driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/ (lib/sglang.sh,
# lib/runtime/server-sglang.sh).
#
# NOT MEASURED BY THIS REPO. Every value below is transcribed from the merged
# recipe in 0xSero/local-ai-registry (PR #83, and the follow-up #92), whose
# numbers were measured by the recipe author on a bare RTX 3090 24 GB. Nobody
# has run this combination through this installer yet. See README.md.
#
# Sources (read 2026-09-24):
#   registry/recipe/qwen38-27b-exl3-3bpw-rtx3090-sglang-tp1.json
#   registry/model-instance/turboderp-qwen3-8-27b-exl3--3-bpw.json
#   registry/speed-sweep/qwen38-27b-exl3-3bpw-rtx3090-sglang-tp1-sweep.json

# ---- identity -------------------------------------------------------------
INSTALL_ID="qwen38-27b-exl3-sglang"
DISPLAY_NAME="Qwen3.8-27B EXL3 (SGLang)"
MODEL_DISPLAY_NAME="Qwen3.8-27B EXL3 3.00bpw"
ROOT_ENV_VAR="QWEN38_EXL3_ROOT"

# Not offered by ./install.sh as the automatic best fit for a 24GB card: it is
# unmeasured here, and the measured llama.cpp combination should stay the
# default. It is still listed as compatible and installable by name.
AUTO_SELECT=0

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
ACCEL="cuda"                              # -> lib/accel/cuda.sh
BACKEND="sglang"                          # -> lib/sglang.sh
CLIENT="${CLIENT:-opencode}"

# Docker and the NVIDIA Container Toolkit are checked (not installed) by
# lib/sglang.sh; installing them needs decisions this script should not make.
SYSTEM_PACKAGES=(curl python3 python3-pip pciutils)

MIN_DEVICE_MEM_MIB=23000                  # 24GB cards report ~24000-24576 MiB
# The image is CUDA 13.0 (its NVIDIA_REQUIRE_CUDA is cuda>=13.0), which needs
# an r580-series driver or newer. The hard gate is SGLANG_MIN_HOST_CUDA below,
# checked against what nvidia-smi says the driver supports.
MIN_DRIVER_VERSION=580
SGLANG_MIN_HOST_CUDA="13.0"

# The image's kernels are compiled ahead of time with TORCH_CUDA_ARCH_LIST=8.6
# (read from the image config) and the recipe was run on an RTX 3090 only.
# Anything else warns loudly; see arch_advice below and README.md.
ACCEL_ARCHS_VERIFIED="86"

# ---- image ----------------------------------------------------------------
# v0.5.1-ampere, built and attested by 0xSero/local-ai-images release-image run
# 35845374392. SGLang v0.5.20 base, exllamav3 1.5.1 AOT for sm_86, the
# sglang-exl3 plugin and its kernels, and the two token maps.
SGLANG_IMAGE="ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8"
SGLANG_IMAGE_APPROX_SIZE="~15.4 GB compressed"
SGLANG_ATTESTATION_OWNER="0xSero"
SGLANG_SHM_SIZE="16g"
SGLANG_CONTAINER_PORT=30000

# ---- weights --------------------------------------------------------------
MODEL_REPO="turboderp/Qwen3.8-27B-exl3"
MODEL_REVISION="6fe61ad620abfe97c5b49f9722c2bceeea4ccc28"
MODEL_WEIGHTS_DIR="turboderp-Qwen3.8-27B-exl3-3.00bpw"
MODEL_APPROX_SIZE="13.84 GB"
SGLANG_CONTAINER_MODEL_DIR="/models/turboderp-Qwen3.8-27B-exl3-3.00bpw"
# From the recipe's metadata.weights_verification (these also match the
# Hugging Face LFS hashes at this revision).
MODEL_SHA256="
f9f4afe5fc1a2d67ca547c8dcde0f043eb226018257cdbde7c50a0956cddb822  model-00001-of-00002.safetensors
d13331e7a531dc2a6e94df6470d5bffa07b13e15912466242b7283469cd58179  model-00002-of-00002.safetensors
"

# ---- serving --------------------------------------------------------------
# The recipe's launch.environment, verbatim.
SGLANG_ENV="
CUDA_DEVICE_ORDER=PCI_BUS_ID
HF_HUB_OFFLINE=1
SGLANG_EXL3_EMBED_HOST=1
SGLANG_EXL3_KERNEL=auto
SGLANG_EXL3_MODEL_PATH=/models/turboderp-Qwen3.8-27B-exl3-3.00bpw
"

# The recipe's launch.arguments, verbatim, EXCEPT the flags the launcher owns:
#   --host/--port (0.0.0.0:30000 inside the container, as in the recipe)
#   --served-model-name (MODEL_ALIAS, default below = the recipe's)
#   --context-length, --mem-fraction-static, --disable-prefill-cuda-graph
#     (per profile, see profiles.tsv -- these are what #83 and #92 differ in)
SGLANG_BASE_ARGS="
python3 -m sglang.launch_server
--model-path /models/turboderp-Qwen3.8-27B-exl3-3.00bpw
--quantization exl3
--trust-remote-code
--kv-cache-dtype fp8_e4m3
--mamba-ssm-dtype bfloat16
--max-running-requests 1
--max-mamba-cache-size 5
--cuda-graph-max-bs-decode 1
--chunked-prefill-size 1024
--max-prefill-tokens 1024
--reasoning-parser qwen3
--tool-call-parser qwen3_coder
--speculative-algorithm NEXTN
--speculative-num-steps 3
--speculative-eagle-topk 1
--speculative-num-draft-tokens 4
--speculative-token-map /opt/sglang-exl3/tokenmaps/qwen38_hot32k_v2.pt
"

MODEL_ALIAS_DEFAULT="turboderp-Qwen3.8-27B-exl3-3.00bpw"   # the recipe's served id
DEFAULT_PROFILE="full"
DEFAULT_PORT=30000                        # the recipe's port; also clear of the llama.cpp combos' 8080

# SGLang takes sampling defaults from the checkpoint's generation_config.json
# (temperature 1.0, top_p 0.95, top_k 20 at this revision). The launcher passes
# no sampling flags; this value is informational only.
SAMPLING_THINKING="generation_config.json"

# Reasoning effort. This revision's chat_template.jinja:
#   {%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}
# and it RAISES on anything but xhigh, medium, low (no 'high' alias here).
# Default to low like the llama.cpp 27B combination, applied server-side via
# SGLang's --default-chat-template-kwargs because OpenCode drops a per-request
# effort. NOTE: the recipe's argv sets no effort, so its thinking-on numbers
# ran at the template default (xhigh). Effort changes how many tokens are
# generated, not the per-token rate -- measured for llama.cpp in this repo, not
# for this stack.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low medium xhigh"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="qwen38-exl3-local"
CONTEXT_LIMIT=262144                      # the default profile's window
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
arch_advice() {
  local cc="$1"
  warn " What is known (quoted, not tested here):"
  warn "   * image tag v0.5.1-ampere; image env TORCH_CUDA_ARCH_LIST=8.6"
  warn "   * recipe: 'exllamav3 1.5.1 AOT for sm_86'; plugin: 'Ampere sm_86 first'"
  warn "   * the plugin's quantization config declares a minimum capability of 80"
  if (( cc >= 80 && cc < 90 )); then
    warn " sm_${cc} is the same major architecture as sm_86. CUDA can in principle"
    warn " load sm_86 kernels on it, but nobody has run this image on one. UNVERIFIED."
  else
    warn " sm_${cc} is a different major architecture. Kernels built only for 8.6"
    warn " (no PTX) are not expected to load on it; expect a failure at model load."
  fi
}

low_memory_advice() {
  warn " The recipe needs the whole of a 24 GB card: the 262k window was measured"
  warn " with nothing else on it (peak 23.04 GiB). There is no smaller profile"
  warn " for a smaller card."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED BY THIS REPO. Recipe author, bare RTX 3090, profile 'full', C1:
Decode, prose, thinking off       98.8 tok/s
Decode, code, thinking off       143.3 tok/s
Decode, prose, thinking on       146.6 tok/s
Decode, prose, 32k prompt         89.6 tok/s
Cold prefill, 32k prompt           904 tok/s (TTFT 36.3 s)
Coherence ladder               OK to a 258,040-token prompt (TTFT 544 s)
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
