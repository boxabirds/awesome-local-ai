# combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-opencode/config.sh
#
# Qwen3.8-Flash-Next on an AMD Strix Halo (Ryzen AI Max+ 395, 128 GB), served by gufo from its runtime image,
# driven by OpenCode instead of pi.
#
# ONE VARIABLE: the client. Everything below is gufo-pi's, value for value: the same engine image (pinned at gufo 0.5.0
# by digest even if a later release is faster or fixes the speculation regression -- one variable at a time), the same
# weights, sampling, context and profile. tests/gufo-opencode-test.sh fails if any setting other than the identity,
# the install location and the client differs from gufo-pi's. Change a shared value in gufo-pi's config and the test
# tells you to change it here.
#
# It has its own install directory and its own INSTALL_ID: each installer writes its manifest (install.env, the command names, the
# client) into the directory, and the job queue maps an install id to exactly one combination. The 107 GB of weights are not in
# the install directory (they live under $HOME/gufo), so nothing is downloaded twice.
#
# OpenCode compacts earlier than pi at the same window: see README.md, "The system prompt and when it compacts".
#
# DATA ONLY. All logic lives in lib/ (lib/gufo.sh, lib/runtime/server-gufo.sh).

INSTALL_ID="qwen38-flash-next-strix-gufo-oc"
DISPLAY_NAME="Qwen3.8-Flash-Next (Strix Halo, gufo, OpenCode)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next GGUF (Unsloth UD-Q4_K_XL)"
ROOT_ENV_VAR="QWEN38_FLASH_NEXT_GUFO_ROOT"

# A young, single-model engine: listed, never picked silently by ./install.sh.
AUTO_SELECT=0

# The machine test A measured (lib/accel/strix-halo.sh matches the DMI product).
TESTED_ON="minisforum-ms-s1-max"

TARGET_OS="ubuntu"
TARGET_OS_VERSION="26.04"                 # kernel 7.0: gfx1151 fixes

ACCEL="strix-halo"                        # -> lib/accel/strix-halo.sh
GPU_API="none"                            # the image brings its own ROCm; nothing built on the host
BACKEND="gufo"                            # -> lib/gufo.sh
CLIENT="${CLIENT:-opencode}"

SYSTEM_PACKAGES=(curl podman pciutils pipx)

# Measured: test A's peak GPU memory (GTT) with this profile was 87,849 MiB.
MIN_DEVICE_MEM_MIB=92160
STRIX_HALO_GTT_TARGET_GIB=120             # what the refusal tells you to set
MIN_OS_RESERVE_MIB=6144
MIN_KERNEL_VERSION="6.18.4"

# ---- engine --------------------------------------------------------------
# Pinned by digest. Its binary reports "gufo version 0.5.0 (23cacbb)", read on
# the Strix Halo box on 2 Oct 2026; GUFO_VERSION is the release number (lib/gufo.sh
# reads it from that line). 0.5.0 keeps tool-call schemas and historical calls
# (the fix for a raw-newline tool call ending a story, our gufo issue 304), which
# the eval plan (docs/20260926-gufo-vs-llamacpp-eval-plan.md) needs because every
# agent step is a tool call. Runs recorded up to v2-r5 and replay-v2r3-* used the
# development build b722a61 (image sha256:51f3cae0...), the merge of gufo#284.
# Not comparable with 0.5.0 runs without noting the engine change: 0.5.0 also
# changes cache reuse.
GUFO_IMAGE="ghcr.io/gufo-org/toolboxes/gufo-runtime@sha256:371a731c5286d698c77daa2507300588e24dc063c7c665895331001410dc06b4"
GUFO_VERSION="0.5.0"
GUFO_CONTAINER_MODEL_DIR="/models"
GUFO_CONTAINER_PORT=8080
GUFO_BASE_ARGS=""

# ---- weights -------------------------------------------------------------
# UD-Q4_K_XL is the only quant gufo supports (the llamacpp-pi runs use
# UD-IQ4_XS). Sizes are the files' byte counts at this revision, from the Strix Halo box.
MODEL_REPO="unsloth/Qwen3.8-Flash-Next-GGUF"
MODEL_REVISION="38bb39ee97821de2c9009abb7e93950eec396e66"
MODEL_WEIGHTS_DIR="qwen3.8-flash-next"
MODEL_APPROX_SIZE="114 GB"
GUFO_MODEL_FILES="
UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf|10946624
UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00002-of-00004.gguf|49859583136
UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00003-of-00004.gguf|49376141504
UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00004-of-00004.gguf|12087983520
MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf|2786568256
"
GUFO_MODEL_REL="UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf"
GUFO_MTP_REL="MTP/mtp-Qwen3.8-Flash-Next-shared-Q8_0.gguf"

# ---- serving defaults ------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.8-flash-next-gufo"  # stable id advertised at /v1/models
DEFAULT_PROFILE="coding"

# The same sampler as llamacpp-pi (the model card's), in gufo's flag names, so
# the two combinations differ in the engine and the quant, not the sampling.
SAMPLING_THINKING="--temperature 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
GUFO_SAMPLING_INSTRUCT="--temperature 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# As llamacpp-pi: the template defaults to xhigh when unset and raises on a
# level it does not know; low is the repo's default for this model.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default low medium high xhigh"

SMOKE_TIMEOUT=900
SERVER_START_TIMEOUT_DEFAULT=900
IDLE_TIMEOUT_DEFAULT=1800

# ---- client config -----------------------------------------------------------
DEFAULT_PROVIDER="flash-next-strix-gufo"
CONTEXT_LIMIT=131072                      # must match the default profile's ctx
OUTPUT_LIMIT=32768
