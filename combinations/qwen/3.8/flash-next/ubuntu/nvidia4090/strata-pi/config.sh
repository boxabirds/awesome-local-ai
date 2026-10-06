#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/config.sh
#
# Qwen3.8-Flash-Next on one RTX 4090 (24 GB VRAM, 62 GB RAM), served by Strata (github.com/Niko1221/Strata: the busiest
# experts in VRAM, all of them in RAM, the n-gram table read off the SSD), driven by pi.
#
# This file is DATA. The logic lives in lib/strata.sh and lib/runtime/server-strata.sh.
#
# Measured on the RTX 4090 machine on 2 Oct 2026 (horizon/strata.md, "What we measured"): ready in about 25 s,
# 42.7 GiB RAM and 23.8 GiB VRAM resident, structured tool calls, prompt reuse to 128k tokens. Not yet benchmarked.
# Sources (read 2026-10-05): https://github.com/Niko1221/Strata at v0.1.39 (README, setup.py, serve/server.py);
#   https://huggingface.co/ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF at ed59f920 (file list, hashes).

# ---- identity -------------------------------------------------------------
INSTALL_ID="strata-qwen38-flash-next"
DISPLAY_NAME="Qwen3.8-Flash-Next (Strata)"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next GSQ-RCO IQ3_XXS (Strata)"
ROOT_ENV_VAR="STRATA_FLASH_NEXT_ROOT"

# Never the automatic pick: a vertical engine for one model on one kind of machine, measured once.
AUTO_SELECT=0

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="22.04"
ACCEL="cuda"                              # -> lib/accel/cuda.sh
BACKEND="strata"                          # -> lib/strata.sh
CLIENT="${CLIENT:-pi}"                    # the benchmark's client: pi
# Strata builds its engine with cmake and a C++ toolchain; its setup makes its own Python and a cmake newer than
# Ubuntu 22.04's 3.22 inside its own folder.
SYSTEM_PACKAGES=(build-essential git curl)

# The model's resident set is about 43 GiB of RAM and 24 GiB of VRAM (measured). A 24 GB card reports 24047-24564 MiB.
MIN_DEVICE_MEM_MIB=23000
STRATA_MIN_RAM_MIB=50000

# ---- backend --------------------------------------------------------------
# v0.1.40, pinned by the commit its tag points at (a tag can be moved; a commit can't). Moved up from 0.1.39 on
# 6 Oct 2026, after v2-strata0139-r2 finished, so nothing recorded straddles the change: that run is the record of
# 0.1.39 and anything after this is 0.1.40. Any verdict on this engine names the build it is about.
# Why move: 0.1.40 is a correctness release here, not a speed one. Decode against 0.1.39 on NVIDIA at IQ3_XXS is
# +2.9% code and +2.3% story by its authors' measurement, which is nothing; but it fixes non-finite values in the
# fused SwiGLU q8_1 quantizers, makes the residency-table upload wait for its own copy before the verifier reads it,
# runs the all-resident verify graph only while every expert is in VRAM, and fails a window on a stale plan instead
# of printing "!!!!". Our 0.1.39 server log shows none of those signatures (no "!!!!", no NaN, no stalls over 47,134
# lines), so they are not known to have touched our runs -- but they are correctness bugs in the build we were on.
# Not relevant to this combination: its multi-GPU fixes, including the 0.1.39 bug where adaptive swaps copied back
# from the wrong card's cache, which needs a layer split across cards. This machine has one.
# What the earlier releases brought, kept for the record: --vram-reserve-mib documented (0.1.37, the flag below), a
# silent-engine watchdog that ends a request after engine_silence_s (300 by default, longer while a long prompt is
# read; our own guard interrupts a silent tool call at 600), faster prompts and a tensor-core path for --kv q4_0
# (0.1.38), and decode about 6% faster with a fix for prompts under a RAM budget that 0.1.38 had made 15-40% slower
# (0.1.39).
# 0.1.38 also hardened the server: without an api_key it answers only requests addressed to a name it knows and
# refuses cross-site ones. The launcher binds 127.0.0.1 and pi sends no Origin, so this is checked, not assumed.
STRATA_VERSION="0.1.40"
STRATA_COMMIT="1735d6471df29b42c26170efaac1f1446a58640f"
STRATA_REPO_URL="https://github.com/Niko1221/Strata.git"
# The size and the context the benchmark runs: the owner chose IQ3_XXS (IQ3_S needs 62 GB of RAM with little else
# running, and a story also runs the agent, browsers and test servers on the same machine); 131072 is the benchmark's
# minimum context.
# The CUDA install path reads this (lib/accel/cuda.sh); the other 4090 combinations set the same.
MIN_DRIVER_VERSION=550                    # 580 validated
STRATA_FAMILY="qwen"
STRATA_QUANT="IQ3_XXS"
STRATA_CONTEXT=131072
# Strata's startup warns "243 MiB of VRAM free with everything loaded - LOW: requests may stall; add
# --vram-reserve-mib 969 to the config's args". Passed, so a long story does not stall for want of VRAM.
STRATA_VRAM_RESERVE_MIB=969

# ---- weights --------------------------------------------------------------
MODEL_REPO="ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF"
MODEL_REVISION="ed59f92082b1e93c0e96d60a8b11aab089b52f09"
MODEL_APPROX_SIZE="75.8 GB (two GGUF files) + about 5 GB of MTP draft layer fetched by Strata's setup"
MODEL_DISK_KB=92000000
# Where the files sit inside the repository: ISTA-DASLab gives each size its own folder. Empty would mean the root.
MODEL_REPO_SUBDIR="${STRATA_QUANT}"
# The two files at MODEL_REVISION, under IQ3_XXS/. The size and the Hugging Face LFS sha256 of each.
MODEL_FILES="
Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf
Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf
"
MODEL_SIZES="
47039860096  Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf
28800138432  Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf
"
MODEL_SHA256="
219ea929900dfa9ef091f3aa473fdba6874b65fcb36526d7d851ac9e95856d15  Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf
316b46f3a2dbd68c900f43136ab9449f9dcc3725dfd8c794847c204bc161e113  Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="strata-flash-next-iq3xxs"    # the id at /v1/models
DEFAULT_PROFILE="agent"
DEFAULT_PORT=8013                         # clear of llama.cpp's 8010-8012 and 8080 (Strata's own default)

# The checkpoint's sampling, passed explicitly so the command line says what runs. Strata reads these as the
# defaults for a request that leaves them out.
SAMPLING_THINKING="--temperature 1.0 --top-p 0.95 --top-k 20"

# pi sends no effort, and Qwen3.8's template default is xhigh; the owner set low for Flash-Next. Strata applies it
# to requests that name none (its shared settings: reasoning_effort).
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="off low medium high"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="strata"
# Equal to the server's context. pi reserves OUTPUT_LIMIT reply tokens per request and compacts at
# CONTEXT_LIMIT - 16384, as for the other Flash-Next combinations.
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This model keeps about 24 GiB in VRAM (the busiest experts and the KV cache) and about 43 GiB in RAM;"
  warn " ${mem} MiB of VRAM is not enough. A larger quantization (IQ3_S) needs even more RAM."
}

combination_performance() {
  cat <<'TXT'
Measured on the RTX 4090 machine (2 Oct 2026, nothing else running), IQ3_XXS at 131,072 context:
  prompt read    about 4,300 tokens/s cold; every later turn reuses all but the new tokens (about 1 s at 128k)
  generation     104 to 173 tokens/s on short replies, with 80 to 95% of drafts accepted
  memory         42.7 GiB RAM and 23.8 GiB VRAM resident
Not yet benchmarked: horizon/strata.md.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Refused: another server     stop llama-server and any other model server first (ALLOW_COEXIST=1 overrides)
Refused: VRAM or RAM        the message says how much is free and how much it needs
Requests stall             the VRAM reserve is STRATA_VRAM_RESERVE_MIB in config.sh; its startup line says how much is free
TXT
}
