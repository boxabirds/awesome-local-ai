#!/usr/bin/env bash
# combinations/qwen/3.8/27b/macos/64GB/mtplx-opencode/config.sh
#
# Qwen3.8-27B on a 64 GB Apple silicon Mac, served by MTPLX with native MTP
# speculative decoding, driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/.
#
# PROVENANCE -- READ THIS BEFORE TRUSTING A NUMBER HERE.
# Every measurement behind this combination was taken on a 128 GB Apple M5 Max
# (macOS 26.4, MLX 0.32.1, mtplx 2.10.1). NO 64 GB MACHINE WAS USED. The pack
# wires 27.9 GB, which fits a 64 GB Mac's Metal budget with room to spare, so
# the throughput figures should carry across -- but "should" is not "measured",
# and every line below that depends on the 64 GB claim says so explicitly.
# See ../../../../../../docs/discovery-macos-mtplx.md.

# ---- identity -------------------------------------------------------------
INSTALL_ID="mtplx-qwen38-27b"
DISPLAY_NAME="Qwen3.8-27B"
MODEL_DISPLAY_NAME="Qwen3.8-27B (MTPLX Optimized-Quality)"
ROOT_ENV_VAR="MTPLX_QWEN38_27B_ROOT"

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="mtplx"                           # -> lib/mtplx.sh
CLIENT="opencode"                         # -> lib/clients/opencode.sh

SYSTEM_PACKAGES=()

# MEASURED: 27.9 GB of weights wired. A 64 GB Mac's Metal working set is
# roughly 54 GB, so the floor below leaves headroom for the KV cache and the
# OS. EXTRAPOLATED: the specific value 38000 was not validated on 64 GB
# hardware; it is set to refuse machines where the pack plainly will not fit.
MIN_DEVICE_MEM_MIB=38000
MIN_MTPLX_VERSION="2.10.0"

# ---- weights --------------------------------------------------------------
MODEL_REPO="Youssofal/Qwen3.8-27B-MTPLX-Optimized-Quality"
MODEL_APPROX_SIZE="30 GB"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="mtplx-qwen38-27b-optimized-quality"
DEFAULT_PROFILE="coding"
DEFAULT_PORT=8010

# The sampler is the model's own, from its mtplx_runtime.json. Temperature 0.6
# here against 1.0 for the Flash-Next pack -- different architectures want
# different sampling, which is why these are per-combination and not shared.
SAMPLING_THINKING="--default-temperature 0.6 --default-top-p 0.95 --default-top-k 20"
SAMPLING_INSTRUCT="--default-temperature 0.7 --default-top-p 0.80 --default-top-k 20 --default-presence-penalty 1.5"

# Applied SERVER-side: OpenCode drops client-side reasoning_effort entirely.
REASONING_EFFORT_DEFAULT="low"
REASONING_EFFORTS="default auto low medium high xhigh"

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="mtplx"
CONTEXT_LIMIT=131072
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This pack wires 27.9 GB of weights (MEASURED on a 128 GB M5 Max)."
  warn " ${mem} MiB of GPU-addressable memory does not leave room for a"
  warn " usable context on top."
  warn ""
  warn " On Apple silicon the GPU's share of unified memory can be raised:"
  warn "   sudo sysctl iogpu.wired_limit_mb=<mib>"
  warn " but on a 32 GB machine a 27B pack is the wrong size regardless."
  warn ""
  warn " ESTIMATED (extrapolated from 128 GB measurements, NOT verified):"
  warn "   48 GB Mac   ~40 GB usable  ->  fits at 128k ctx"
  warn "   36 GB Mac   ~30 GB usable  ->  tight; expect to cut CTX to ~32k"
  warn "   32 GB Mac   ~24 GB usable  ->  does not fit"
}

combination_performance() {
  cat <<'TXT'
MEASURED on Apple M5 Max / 128 GB / macOS 26.4, 2026-09-01.
NOT measured on a 64 GB machine -- see the provenance note in config.sh.

31 scored requests from a clean OpenCode session:

Decode (median)                26.2 tok/s
Effective (median)             21.8 tok/s   completion / (ttft + decode)
TTFT (median)                   2.78 s
Draft acceptance                ~78 %

Synthetic bench (mtplx tune, depth sweep on the same machine):
  best depth D3                 53.59 tok/s   3.145x over autoregressive
  autoregressive baseline       17.04 tok/s

The gap between 53.6 and 26.2 is real and worth understanding: the first is
a short greedy generation with a warm prefix, the second is a working agent
session at ~53k median context. Quote the second when comparing to anything
you would actually do.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Empty replies         raise max_tokens -- thinking mode consumes it
Zero-token responses  context ran past ~200k; restart the session
Slow decode           expected above ~100k ctx; decode falls off with context
Effort seems ignored  it is set server-side; OpenCode drops the client value
TXT
}
