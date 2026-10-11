#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/ubuntu/strix-halo-128GB/strata-pi/config.sh
#
# Qwen3.8-Flash-Next on an AMD Strix Halo (Ryzen AI Max+ 395, 128 GB, one pool of memory shared by the CPU and the GPU),
# served by Strata (github.com/Niko1221/Strata), driven by pi. The 4-bit Unsloth pack, UD-IQ4_XS: the quant the
# llamacpp-pi combination runs on this machine, and the size Strata's Strix Halo page recommends.
#
# This file is DATA. The logic lives in lib/strata.sh and lib/runtime/server-strata.sh.
#
# Why this combination: on 11 Oct 2026, with the same UD-Q4_K_XL weights and gufo's own throughput test (benchmarks/gufo-eval,
# byte-identical prompts, median of 3), Strata with the engine switches below read a prompt at 664 / 1,119 / 1,161 / 1,165 tok/s
# at 2k / 32k / 64k / 120k tokens against gufo's 744 / 1,266 / 1,242 / 1,228: 5 to 12% slower. With setup's defaults it was about
# 60% slower (327 to 509). That was UD-Q4_K_XL; this combination's UD-IQ4_XS has not been measured here.
# Sources (read 2026-10-11): https://github.com/Niko1221/Strata at v0.1.42 (docs/STRIX_HALO.md, setup.py);
#   https://huggingface.co/unsloth/Qwen3.8-Flash-Next-GGUF at 38bb39ee (file sizes and hashes).

# ---- identity -------------------------------------------------------------
INSTALL_ID="qwen38-flash-next-strix-strata"
DISPLAY_NAME="Qwen3.8-Flash-Next (Strix Halo, Strata)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next GGUF (Unsloth UD-IQ4_XS, Strata)"
ROOT_ENV_VAR="QWEN38_FLASH_NEXT_STRIX_STRATA_ROOT"

# A young, single-model engine: listed, never picked silently by ./install.sh.
AUTO_SELECT=0

# The machine this was measured on (lib/accel/strix-halo.sh matches the DMI product).
TESTED_ON="minisforum-ms-s1-max"

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="26.04"                 # kernel 7.0: gfx1151 fixes
ACCEL="strix-halo"                        # -> lib/accel/strix-halo.sh
GPU_API="none"                            # Strata's setup installs its own ROCm into its own folder; nothing on the host
BACKEND="strata"                          # -> lib/strata.sh
CLIENT="${CLIENT:-pi}"                    # the benchmark's client: pi
# Strata's setup compiles its engine for gfx1151 (10 to 20 minutes, once); cmake and ninja come from its own virtualenv.
SYSTEM_PACKAGES=(build-essential git curl)

# The GPU's memory is the GTT pool of the same RAM. Measured on UD-Q4_K_XL (11 Oct 2026): 39.5 to 40.3 GB of VRAM + GTT in use.
MIN_DEVICE_MEM_MIB=36000
STRIX_HALO_GTT_TARGET_GIB=120             # what the refusal tells you to set
MIN_OS_RESERVE_MIB=6144
MIN_KERNEL_VERSION="6.18.4"
# UD-IQ4_XS keeps about 60 GB of experts in RAM, and a story also runs the agent, browsers and test servers.
STRATA_MIN_RAM_MIB=90000

# ---- backend --------------------------------------------------------------
# v0.1.42, pinned by the commit its tag points at (a tag can be moved; a commit can't). Read from upstream on 11 Oct 2026
# (`git ls-remote` finds refs/tags/v0.1.42 at this commit). The Strix Halo page (docs/STRIX_HALO.md) calls the Strix Halo
# build experimental and measured on the maintainers' one machine.
STRATA_VERSION="0.1.42"
STRATA_COMMIT="61b3fb5dd3f1e8ec09cf7e4e05208bc6d3c46406"
STRATA_REPO_URL="https://github.com/Niko1221/Strata.git"
STRATA_FAMILY="unsloth"
STRATA_QUANT="UD-IQ4_XS"
STRATA_CONTEXT=131072
# Setup builds for the HIP backend and uses the GGUF files this installer already fetched and hash-checked. The Unsloth
# family's configuration file is named for the family as well as the quant.
STRATA_SETUP_BACKEND="hip"
STRATA_GGUF_IN_PLACE=1
STRATA_SETUP_CONFIG="strata-unsloth-ud-iq4_xs.json"
# The maintainers' fast configuration for this chip (docs/STRIX_HALO.md, section 5), as measured above. These round
# differently from the default path (a different summation order, half-precision intermediates), so they change answers
# slightly: the maintainers gate them with KL against the default on their own machine; we have not. A score from this
# combination is the score of the engine with these switches, not of the default path. No VRAM reserve is set: there is no
# separate VRAM to reserve.
STRATA_ENV="STRATA_PF_FUSED=1 STRATA_PF_GEMM=1 STRATA_HC_UPMIX=1 STRATA_PA_FAST=1 STRATA_HIP_WMMA=1 STRATA_SELECT_WMMA=1 STRATA_HC_Q8=1 STRATA_PF_SWITCH_MIN_T=4096 STRATA_PREFILL_STREAM_MIN=128"

# ---- weights --------------------------------------------------------------
# The same pinned revision as llamacpp-pi and gufo-pi. The three files, with the size and Hugging Face LFS sha256 of each.
MODEL_REPO="unsloth/Qwen3.8-Flash-Next-GGUF"
MODEL_REVISION="38bb39ee97821de2c9009abb7e93950eec396e66"
MODEL_APPROX_SIZE="93.7 GB (three GGUF files) + about 5 GB of MTP draft layer fetched by Strata's setup"
MODEL_DISK_KB=105000000
MODEL_REPO_SUBDIR="${STRATA_QUANT}"
MODEL_FILES="
Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf
Qwen3.8-Flash-Next-UD-IQ4_XS-00002-of-00003.gguf
Qwen3.8-Flash-Next-UD-IQ4_XS-00003-of-00003.gguf
"
MODEL_SIZES="
10946624  Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf
49835229856  Qwen3.8-Flash-Next-UD-IQ4_XS-00002-of-00003.gguf
43836407744  Qwen3.8-Flash-Next-UD-IQ4_XS-00003-of-00003.gguf
"
MODEL_SHA256="
5ce89370720f8bf90890f439361282104c1aa1482d4013bb9a50923e758e71a4  Qwen3.8-Flash-Next-UD-IQ4_XS-00001-of-00003.gguf
577a38a2392b40ca2193cea502e1d92f60b8cd370675d308e0ec21885d9daaa7  Qwen3.8-Flash-Next-UD-IQ4_XS-00002-of-00003.gguf
d4634e6d84f0ebb0940be15c90d3790bf6464e3dea3a1cddc567dc0e83ad8833  Qwen3.8-Flash-Next-UD-IQ4_XS-00003-of-00003.gguf
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="qwen3.8-flash-next-strata"   # the id at /v1/models
DEFAULT_PROFILE="agent"
DEFAULT_PORT=8013

# The same sampler as llamacpp-pi and gufo-pi (the model card's), so the combinations differ in the engine, not the sampling.
SAMPLING_THINKING="--temperature 1.0 --top-p 0.95 --top-k 20"

# pi sends no effort, and Qwen3.8's template default is xhigh; the owner set low for Flash-Next. Strata applies it to
# requests that name none.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="off low medium high"

SMOKE_TIMEOUT=900
SERVER_START_TIMEOUT_DEFAULT=900
IDLE_TIMEOUT_DEFAULT=1800

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="flash-next-strix-strata"
# Equal to the server's context. pi reserves OUTPUT_LIMIT reply tokens per request and compacts at
# CONTEXT_LIMIT - 16384, as for the other Flash-Next combinations.
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This model keeps about 60 GB of experts in RAM and uses about 40 GB of the GPU's share of it;"
  warn " ${mem} MiB is not enough. Close other programs, or see the GTT limit advice above."
}

combination_performance() {
  cat <<'TXT'
Measured on the Strix Halo box (11 Oct 2026, nothing else running), UD-Q4_K_XL (not this quant) with the engine switches:
  prompt read    664 / 1,119 / 1,161 / 1,165 tokens/s at 2k / 32k / 64k / 120k (gufo: 744 / 1,266 / 1,242 / 1,228)
  generation     48 / 59 / 47 / 38 tokens/s, greedy, 400 tokens (gufo: 47 / 57 / 53 / 39)
Not yet measured on UD-IQ4_XS, and not yet benchmarked.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Refused: another server     stop llama-server, gufo and any other model server first (ALLOW_COEXIST=1 overrides)
Refused: RAM                the message says how much is available and how much it needs
Slow prompts                the engine switches (STRATA_ENV in config.sh) must be in strata-run.json's "env"
TXT
}
