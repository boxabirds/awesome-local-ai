# combinations/qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi/config.sh
#
# Qwen3.6-35B-A3B at Q6dense on an AMD Strix Halo (Ryzen AI Max+ 395, 128 GB), served by NinjaPear's fork of
# gufo (github.com/NinjaPear/gufo-Qwen3.6-35B-A3B-Q6dense) built from source, driven by pi.
#
# WHY THIS EXISTS. Every local combination benchmarked so far carries far more weight per token. This one has
# about 3B active parameters, and the question is not whether it beats Qwen3.8-Flash-Next -- two generations
# and 125B against 35B, it will not -- but WHERE it fails and whether anything can be done about it. The
# failure-mode classes in benchmarks/docs/failure-modes.md are the instrument; this is their first use on a
# weaker MODEL rather than a weaker quant.
#
# The fork's author is explicit about the trade, in the repository's own description: "a fork of gufo to
# support Qwen 3.6 35B A3B for workloads that prioritizes speed over intelligence."
#
# NOT COMPARABLE FIELD BY FIELD with the gufo Flash-Next runs on this machine. Four things differ at once: the
# model generation, the active parameters, the quantisation scheme, and the engine build (that one runs a
# digest-pinned container with its own ROCm; this compiles against Ubuntu's ROCm 7.1 and gcc 15.2). The engine
# VERSION is the same -- the fork's merge base with upstream is 2026-10-02T11:08:42Z, gufo 0.5.0 to the minute,
# which this repository already pins -- but the fork is forty commits behind, six of them server tool-call
# fixes. See horizon/gufo-qwen3.6-35b-a3b.md.
#
# DATA ONLY. All logic lives in lib/ (lib/gufo-fork-ninjapear.sh, lib/runtime/server-gufo-fork-ninjapear.sh).

INSTALL_ID="qwen36-35b-a3b-strix-gufo"
DISPLAY_NAME="Qwen3.6-35B-A3B (Strix Halo, gufo fork)"
MODEL_DISPLAY_NAME="Qwen3.6-35B-A3B GGUF (Q6dense: Q6_K trunk, UD-Q4_K_XL experts)"
ROOT_ENV_VAR="QWEN36_35B_A3B_GUFO_ROOT"

# A one-author fork of a young engine: listed, never picked silently by ./install.sh.
AUTO_SELECT=0

TESTED_ON="minisforum-ms-s1-max"

TARGET_OS="ubuntu"
TARGET_OS_VERSION="26.04"

ACCEL="strix-halo"
GPU_API="none"                            # ROCm comes from Ubuntu's packages; the engine is built against them
BACKEND="gufo-fork-ninjapear"
CLIENT="${CLIENT:-pi}"

SYSTEM_PACKAGES=(curl git cmake ninja-build pciutils pipx)

# Measured at load on 7 Oct 2026: gpu_device_used_mib=35285 of 122880 at 131072 context, two sessions.
MIN_DEVICE_MEM_MIB=40960
STRIX_HALO_GTT_TARGET_GIB=120
MIN_OS_RESERVE_MIB=6144
MIN_KERNEL_VERSION="6.18.4"

# ---- engine ----------------------------------------------------------------
# Pinned by COMMIT, not by version: a source build reports "gufo version development (unknown)", so there is
# no version string to match. The installer stamps the commit beside the binary and the launcher refuses a
# binary built from anything else.
GUFO_FORK_REPO="NinjaPear/gufo-Qwen3.6-35B-A3B-Q6dense"
GUFO_FORK_COMMIT="d7e938e4bf00c64abef2b0794ccac1ae0e170593"   # 3 Oct 2026, the fork's HEAD
GUFO_FORK_BIN_REL="engine/gufo"
# Ubuntu 26.04's librocwmma-dev omits the internal/ headers rocwmma.hpp includes; a complete tree goes here.
GUFO_FORK_CPATH_REL="include"
GUFO_FORK_ROCWMMA_TAG="rocm-7.1.0"
# The fork's own build instruction is --parallel 4, not full width: a HIP build at 32 jobs can take this
# machine into swap, and swap stops whatever story is running.
GUFO_FORK_BUILD_JOBS=4
GUFO_FORK_BASE_ARGS=""

# ---- weights ---------------------------------------------------------------
# One GGUF, including the native MTP block. The byte count is the model card's and was verified on the
# machine: 22,388,168,960 bytes exactly.
MODEL_REPO="ligamentexceed/Qwen3.6-35B-A3B-Q6dense-GGUF"
MODEL_REVISION="cd429bbcdc0a2843bdc509c804088013ed7212a4"
MODEL_WEIGHTS_DIR="qwen3.6-35b-a3b"
MODEL_APPROX_SIZE="22.4 GB"
QUANT="Q6dense"
GUFO_FORK_MODEL_FILES="
Qwen3.6-35B-A3B-Q6dense.gguf|22388168960
"
GUFO_MODEL_REL="Qwen3.6-35B-A3B-Q6dense.gguf"
GUFO_FORK_MODEL_CACHE_REL=".local/share/${INSTALL_ID}/gufo/models"

# ---- serving defaults ------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.6-35b-a3b"     # stable id advertised at /v1/models
DEFAULT_PROFILE="coding"

# The model card's own sampling, which the engine also prints as its defaults at load:
#   thinking on  -> temperature 1.0, top-p 0.95, top-k 20, presence penalty 1.5
#   thinking off -> temperature 0.7, top-p 0.80, top-k 20, presence penalty 1.5
SAMPLING_THINKING="--temperature 1.0 --top-p 0.95 --top-k 20 --min-p 0.0 --presence-penalty 1.5"
GUFO_FORK_SAMPLING_INSTRUCT="--temperature 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# This template has NO reasoning-effort control (the fork's own model page), so there is nothing to set and
# "default" is the only value. The launcher refuses anything else rather than pass a flag that does nothing.
REASONING_EFFORT_DEFAULT="default"
REASONING_EFFORTS="default"

SMOKE_TIMEOUT=900
SERVER_START_TIMEOUT_DEFAULT=900
IDLE_TIMEOUT_DEFAULT=1800

# ---- client config ---------------------------------------------------------
DEFAULT_PROVIDER="qwen36-35b-a3b-strix-gufo"
CONTEXT_LIMIT=131072                      # must match the default profile's ctx
OUTPUT_LIMIT=32768
