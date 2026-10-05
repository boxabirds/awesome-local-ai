#!/usr/bin/env bash
# combinations/qwen/3.8-swift-1.5/flash-next/ubuntu/nvidia4090/strata-pi/config.sh
#
# Swift 1.5 Qwen3.8-Flash-Next on one RTX 4090 (24 GB VRAM, 62 GB RAM), served by Strata
# (github.com/Niko1221/Strata: the busiest experts in VRAM, all of them in RAM, the n-gram table read off the SSD),
# driven by pi.
#
# This file is DATA. The logic lives in lib/strata.sh and lib/runtime/server-strata.sh.
#
# The point of this combination: it differs from qwen/3.8/flash-next/.../strata-pi in the fine-tune and nothing else
# -- same engine and version, same card, same GSQ-RCO quantisation at IQ3_XXS, same context, same effort, same
# client. Swift 1.5 is post-trained to think less (its authors: -63% thinking tokens, answers 1.8x sooner), so the
# pair measures that claim on held-out tests rather than on its authors' benchmarks. Not yet benchmarked, and no
# memory figure here is ours yet: profiles.tsv says ESTIMATED until the first run measures it.
# Sources (read 2026-10-05): https://github.com/Niko1221/Strata at v0.1.39 (setup.py FAMILIES/MODELS: the swift
#   family, and IQ3_XXS available to it); https://huggingface.co/ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF
#   at b22d729e (file list, sizes, hashes, model card, LICENSE).

# ---- identity -------------------------------------------------------------
INSTALL_ID="strata-swift15-flash-next"
DISPLAY_NAME="Swift 1.5 Qwen3.8-Flash-Next (Strata)"
MODEL_DISPLAY_NAME="Swift 1.5 Qwen3.8-Flash-Next GSQ-RCO IQ3_XXS (Strata)"
ROOT_ENV_VAR="STRATA_SWIFT15_FLASH_NEXT_ROOT"

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
# v0.1.39, pinned by the commit its tag points at (a tag can be moved; a commit can't). Moved up from 0.1.36 on
# 5 Oct 2026, before the first run, so nothing recorded straddles the change. What the three releases since 0.1.36
# bring here: --vram-reserve-mib documented (0.1.37, the flag below), a silent-engine watchdog that ends a request
# after engine_silence_s (300 by default, longer while a long prompt is read; our own guard interrupts a silent tool
# call at 600), faster prompts and a tensor-core path for --kv q4_0 (0.1.38), and decode about 6% faster with a fix
# for prompts under a RAM budget that 0.1.38 had made 15-40% slower (0.1.39).
# 0.1.38 also hardened the server: without an api_key it answers only requests addressed to a name it knows and
# refuses cross-site ones. The launcher binds 127.0.0.1 and pi sends no Origin, so this is checked, not assumed.
STRATA_VERSION="0.1.39"
STRATA_COMMIT="6f32ec070f23ced9f50e704d854d775da52591ab"
STRATA_REPO_URL="https://github.com/Niko1221/Strata.git"
# The size and the context the benchmark runs: the owner chose IQ3_XXS (IQ3_S needs 62 GB of RAM with little else
# running, and a story also runs the agent, browsers and test servers on the same machine); 131072 is the benchmark's
# minimum context.
# The CUDA install path reads this (lib/accel/cuda.sh); the other 4090 combinations set the same.
MIN_DRIVER_VERSION=550                    # 580 validated
# Strata's own swift family (setup.py FAMILIES): UkisAI's fine-tune, same architecture and the same GSQ-RCO sizes.
# Q2_0 and IQ3_S are the original's only -- Swift has no IQ3_S, and its Q2_0 splits one layer's experts across the
# two shards, which Strata's pack tool cannot prepare (its issue 171). IQ3_XXS, which we run, is available to both.
STRATA_FAMILY="swift"
STRATA_QUANT="IQ3_XXS"
STRATA_CONTEXT=131072
# Strata's startup warns "243 MiB of VRAM free with everything loaded - LOW: requests may stall; add
# --vram-reserve-mib 969 to the config's args". Passed, so a long story does not stall for want of VRAM.
STRATA_VRAM_RESERVE_MIB=969

# ---- weights --------------------------------------------------------------
MODEL_REPO="ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF"
MODEL_REVISION="b22d729eae29b5796f76fb70f91aef549b9fc52c"
MODEL_APPROX_SIZE="76.0 GB (two GGUF files) + about 5 GB of MTP draft layer fetched by Strata's setup"
MODEL_DISK_KB=92000000
# Where the files sit inside the repository: UkisAI keeps Swift's at the root, with no per-size folder.
MODEL_REPO_SUBDIR=""
# The two files at MODEL_REVISION, at the repository root (the swift family has no per-size folder, unlike the
# original's IQ3_XXS/). The size and the Hugging Face LFS sha256 of each. The shards are split more evenly than the
# original's, which is a property of this repository, not a mistake.
MODEL_FILES="
Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf
Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf
"
MODEL_SIZES="
39785790560  Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf
36180282560  Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf
"
MODEL_SHA256="
3bddaa667c750f63baca766df9433e1afd35a139f401c5ca5e7ff560ceff3d23  Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00001-of-00002.gguf
b0b15f782af71eb471909d2f3313b2927c324962f86c084325c247cd411a0160  Swift-Qwen3.8-Flash-Next-GSQ-RCO-IQ3_XXS-00002-of-00002.gguf
"
# Swift Open License 1.0 for the fine-tune, Qwen Community License 1.0 for the base model. Commercial use is
# licensed below a gross-revenue threshold of one million US dollars; non-commercial and research use is not
# conditioned on it. Read 2026-10-05 from the repository's LICENSE.
MODEL_LICENSE="Swift Open License 1.0 (fine-tune) + Qwen Community License 1.0 (base model)"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="strata-swift15-flash-next-iq3xxs"    # the id at /v1/models
DEFAULT_PROFILE="agent"
DEFAULT_PORT=8014                         # clear of llama.cpp's 8010-8012, 8013 (the original on Strata), 8080

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
