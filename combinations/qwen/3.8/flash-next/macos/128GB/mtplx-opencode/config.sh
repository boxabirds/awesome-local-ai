#!/usr/bin/env bash
# combinations/qwen/3.8/flash-next/macos/128GB/mtplx-opencode/config.sh
#
# Qwen3.8 Flash-Next on a 128 GB Apple silicon Mac, served by MTPLX with native
# MTP speculative decoding, driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/. Every number here was
# measured on real hardware (Apple M5 Max, 128 GB, macOS 26.4, MLX 0.32.1,
# mtplx 2.10.1) -- see ../../../../../../docs/discovery-macos-mtplx.md for the
# methodology, the falsified predictions and the configurations that failed.

# ---- identity -------------------------------------------------------------
INSTALL_ID="mtplx-qwen38-flash-next"
DISPLAY_NAME="Qwen3.8-Flash-Next"
MODEL_DISPLAY_NAME="Qwen3.8-Flash-Next (MTPLX Optimized-Speed)"
ROOT_ENV_VAR="MTPLX_FLASH_NEXT_ROOT"

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="mtplx"                           # -> lib/mtplx.sh
CLIENT="opencode"                         # -> lib/clients/opencode.sh

# MTPLX installs via `uv tool`, so there is nothing to compile and no system
# packages to fetch. uv itself is checked for by lib/mtplx.sh.
SYSTEM_PACKAGES=()

# MEASURED: 77.3 GB of weights wired at the default profile. Metal's
# recommendedMaxWorkingSetSize on a 128 GB M5 Max is 110,100 MiB, so this fits
# with room; on a 64 GB machine it does not, at any context.
MIN_DEVICE_MEM_MIB=92000
MIN_MTPLX_VERSION="2.10.0"

# ---- weights --------------------------------------------------------------
# MTPLX pulls whole model packs into its own cache rather than single files, so
# this is a repo id, not a MODEL_ASSETS table. lib/mtplx.sh resolves the cache
# directory, verifies the shard set and asserts the MTP contract.
MODEL_REPO="Youssofal/Qwen3.8-Flash-Next-MTPLX-Optimized-Speed"
MODEL_APPROX_SIZE="115 GB (77.3 GB weights + a 29.8 GB n-gram table)"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="mtplx-flash-next-optimized-speed"   # stable id at /v1/models
DEFAULT_PROFILE="coding"
DEFAULT_PORT=8010

# MTPLX resolves its own serving profile from the pack's mtplx_runtime.json
# (recommended_profile: turbo) when --profile is not passed. Every measurement
# below was taken that way, so the launcher does not pass --profile either.

# The sampler is the model's own, from its mtplx_runtime.json. Note this
# differs from the 27B pack (temperature 0.6 there, 1.0 here) -- they are
# different architectures, and sharing one launch path across both was a bug
# in the scratchpad these combinations replace.
SAMPLING_THINKING="--default-temperature 1.0 --default-top-p 0.95 --default-top-k 20"
SAMPLING_INSTRUCT="--default-temperature 0.7 --default-top-p 0.80 --default-top-k 20 --default-presence-penalty 1.5"

# Reasoning effort is applied SERVER-side. OpenCode silently drops
# `reasoning_effort` and `chat_template_kwargs` from an agent's options block,
# so a client-side value never arrives and every request lands on the server
# default. MTPLX accepts these five and nothing else.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default auto low medium high xhigh"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="mtplx"
# CONTEXT_LIMIT must match the ctx of the profiles below. The server enforces
# its ceiling, but only this client-side limit makes OpenCode compact its
# history before it reaches it.
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " Flash-Next wires 77.3 GB of weights (MEASURED). With a usable context"
  warn " on top it does not fit in ${mem} MiB of GPU-addressable memory."
  warn ""
  if (( mem >= 50000 )); then
    warn " On a 64 GB Mac, use the 27B pack instead:"
    warn "   ./install-qwen-3.8-27b-macos-64GB-mtplx-opencode.sh"
    warn " It wires 27.9 GB and was the other arm of the A/B this repo records."
  else
    warn " Below ~64 GB neither Qwen3.8 pack in this repo is a good fit."
  fi
  warn ""
  warn " Raising iogpu.wired_limit_mb will not help: 128 GB of unified memory"
  warn " is the constraint, not the GPU's share of it."
}

combination_performance() {
  cat <<'TXT'
MEASURED on Apple M5 Max / 128 GB / macOS 26.4, 2026-09-01.
65 scored requests from a real OpenCode session, not a synthetic loop.

Decode (median)                49.8 tok/s
Effective (median)             38.8 tok/s   completion / (ttft + decode)
TTFT (median)                   2.0 s
Session-bank restore (median)  98.8 %
Draft acceptance                ~60 %

Against the 27B pack, matched on thermal state and context band:
  20-45k ctx    2.16x
  45-75k ctx    1.65x
  75-130k ctx   1.98x

By thermal state (decode median):
  nominal   52.4 tok/s  (n=12)
  moderate  61.0 tok/s  (n=6)
  heavy     47.9 tok/s  (n=47)
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Empty replies         raise max_tokens -- thinking mode consumes it
Zero-token responses  context ran past ~200k; restart the session
Slow decode           check `mtplx trace` and the cache% column; a cold
                      session bank costs the warm-prefix restore
Machine swaps         something else is holding memory; 77.3 GB needs room
Effort seems ignored  it is set server-side; OpenCode drops the client value
TXT
}
