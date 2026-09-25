#!/usr/bin/env bash
# combinations/mimo/2.6/9b/macos/16GB/mtplx-opencode/config.sh
#
# Xiaomi MiMo-V2.6-Distill-Qwen-9B on a 16 GB Apple silicon Mac, served by
# MTPLX (>= 2.12.0) with MTP speculative decoding, driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/.
#
# PROVENANCE -- READ THIS BEFORE TRUSTING A NUMBER HERE.
# NOTHING IN THIS COMBINATION HAS BEEN MEASURED BY THIS REPO. NO 16 GB MACHINE
# WAS USED. Every figure below is quoted from one of two places:
#   - the MTPLX 2.12.0 release notes (2026-09-24), and
#   - the pack's own files on Hugging Face (mtplx_runtime.json, README.md,
#     chat_template.jinja), read as metadata; no weights were downloaded.
# The one memory measurement that exists (8.70 GiB peak at a 15K-token
# context) was taken by the MTPLX author on an M5 Max, not on a 16 GB Mac.
# Nobody has published a tok/s figure for this pack; this repo quotes none.
#
# M1 / M2: MTPLX 2.12.0 does NOT offer this pack on M1 or M2. Its catalog
# lists it for the modern tier (M3/M4/M5) only, because M1/M2 GPUs have no
# native BF16 and this pack keeps its vision tower and draft head in BF16;
# there is no FP16 sibling. "Not offered" means not listed or recommended --
# nothing seen blocks pulling it by repo id and serving it, which is what
# this installer does. On M1/M2 expect those BF16 tensors to run slower than
# on M3+; by how much has not been measured by anyone. See README.md.

# ---- identity -------------------------------------------------------------
INSTALL_ID="mtplx-mimo-v26-qwen-9b"
DISPLAY_NAME="MiMo-V2.6-Qwen-9B"
MODEL_DISPLAY_NAME="MiMo-V2.6-Qwen-9B (MTPLX Optimized-Speed)"
ROOT_ENV_VAR="MTPLX_MIMO_V26_9B_ROOT"

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="mtplx"                           # -> lib/mtplx.sh
CLIENT="${CLIENT:-opencode}"              # default client (overridable: --client pi / CLIENT=pi); all clients are installed and selectable at run time

SYSTEM_PACKAGES=()

# FROM THE RELEASE NOTES, not measured here: peak 8.70 GiB (8,909 MiB) at a
# 15K-token context, on an M5 Max. The floor is that peak and nothing more: it
# refuses a machine whose Metal working set cannot hold the pack at all. It
# does NOT promise the 20,480-token window fits -- that is MTPLX's own plan
# for 16 GB, and MTPLX's memory planner, not this number, sizes the KV cache.
# EXTRAPOLATED: no 16 GB machine's recommendedMaxWorkingSetSize was read.
MIN_DEVICE_MEM_MIB=8909
# The pack's mtplx_runtime.json declares mtplx_version 2.12.0, and the release
# notes say the pack requires it. Older MTPLX does not know the pack.
MIN_MTPLX_VERSION="2.12.0"

# ---- weights --------------------------------------------------------------
MODEL_REPO="Youssofal/MiMo-V2.6-Qwen-9B-MTPLX-Optimized-Speed"
MODEL_APPROX_SIZE="8.7 GB (6-bit trunk + BF16 vision tower + BF16 Qwen3.5-9B draft head)"

# ---- serving --------------------------------------------------------------
# The pack's own served_model_id (mtplx_runtime.json).
MODEL_ALIAS_DEFAULT="mtplx-mimo-v26-qwen-9b-optimized-speed"
DEFAULT_PROFILE="coding"
DEFAULT_PORT=8010

# Xiaomi's sampler, as shipped in the pack's mtplx_runtime.json and
# generation_config.json. Xiaomi publishes one sampler only, so the instruct
# preset (THINKING=0) uses the same values rather than an invented one.
SAMPLING_THINKING="--default-temperature 0.6 --default-top-p 0.95 --default-top-k 20"
SAMPLING_INSTRUCT="--default-temperature 0.6 --default-top-p 0.95 --default-top-k 20"

# The pack's chat_template.jinja has NO reasoning-effort variable: it reads
# only `enable_thinking`. An effort level would be silently ignored, so none is
# sent ("default" = the launcher passes no --reasoning-effort flag), and any
# other value is rejected up front by the launcher's validation.
REASONING_EFFORT_DEFAULT="default"
REASONING_EFFORTS="default"

# ---- client ---------------------------------------------------------------
# A provider name of its own, not the "mtplx" the Qwen3.8 combinations use.
# Both client adapters skip a provider that already exists in the user's
# config, so sharing the name would leave this model out of an OpenCode/Pi
# config that already has another MTPLX combination in it.
DEFAULT_PROVIDER="mtplx-mimo"

# MTPLX's own memory plan for this pack on a 16 GB Mac (release notes):
# 20,480 tokens. 18 GB Macs get 45,056 and 24 GB get 192,512 -- this
# combination is sized for 16 GB only. Must match the profile ctx below.
CONTEXT_LIMIT=20480

# OUTPUT_LIMIT: 8192 of the 20,480 tokens, leaving 12,288 for the system
# prompt, tool definitions and conversation history. The trade-off, argued not
# measured: thinking is on and its tokens count against this cap, so much below
# 8k risks empty replies (the budget spent inside <think>); much above it and
# an agent client's system prompt plus tool schemas leaves almost no room for
# history before every turn compacts. The pack's own card recommends 18 GB+
# for agent clients such as OpenCode -- this is the smallest window in the repo.
OUTPUT_LIMIT=8192

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This pack peaks at 8.70 GiB (8,909 MiB) at a 15K-token context --"
  warn " FROM THE MTPLX RELEASE NOTES, measured on an M5 Max, NOT by this repo."
  warn " ${mem} MiB of GPU-addressable memory cannot hold it."
  warn ""
  warn " This repo has no smaller pack. MTPLX's own catalog routes sub-16 GB"
  warn " Macs to its 4B packs; this repo has no combination for them. Raising"
  warn " iogpu.wired_limit_mb on a Mac this small starves macOS."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED. No throughput figure exists for this pack from anyone:
not from this repo, and not in the MTPLX 2.12.0 release notes.

What IS published (MTPLX release notes, M5 Max, not a 16 GB Mac):
  Peak memory                    8.70 GiB at a 15K-token context
  Draft acceptance, position 1   78.5 %   (long game prompt, thinking on)
  Draft acceptance, position 2   56.5 %
  Default MTP depth              2

The draft head is borrowed from Qwen3.5-9B, not trained for MiMo; those
acceptance rates are what it achieves on MiMo's outputs.

On M1/M2 the BF16 vision tower and draft head run without native BF16
support; expect slower than M3+ by an amount nobody has measured.
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Compacts every turn    20,480-token window; in Pi set a per-model
                       compaction override (see help / README)
Empty replies          thinking consumed max_tokens; raise
                       MAX_RESPONSE_TOKENS (costs history room)
"not supported"        REASONING_EFFORT has no effect on this template;
                       use THINKING=0 to turn thinking off instead
"too old"              the pack declares mtplx 2.12.0; `uv tool upgrade mtplx`
Machine swaps          16 GB is tight; close browsers and Docker first
TXT
}
