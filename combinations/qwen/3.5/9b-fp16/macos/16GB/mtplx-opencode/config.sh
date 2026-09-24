#!/usr/bin/env bash
# combinations/qwen/3.5/9b-fp16/macos/16GB/mtplx-opencode/config.sh
#
# Qwen3.5-9B, MTPLX's "Optimized Speed FP16" build, on a 16 GB Apple silicon
# Mac, served by MTPLX with MTP speculative decoding, driven by OpenCode.
#
# This file is DATA. All the logic lives in lib/.
#
# WHY "9b-fp16" AS THE SIZE SEGMENT: docs/adding-a-combination.md allows a
# variant name where a bare size is not enough (flash-next is the precedent).
# MTPLX ships two 9B packs of this model -- a BF16-float build for M3+ and this
# FP16-float build for M1/M2 -- and they are different combinations with
# different audiences, so the precision is part of the name.
#
# PROVENANCE -- READ THIS BEFORE TRUSTING A NUMBER HERE.
# NOTHING IN THIS COMBINATION HAS BEEN MEASURED BY THIS REPO. NO 16 GB MACHINE
# WAS USED. Figures are quoted from:
#   - MTPLX 2.12.0's model catalog (mtplx/model_catalog.py), and
#   - the pack's own mtplx_runtime.json and README.md on Hugging Face, read as
#     metadata; no weights were downloaded.
#
# WHO IT IS FOR: this is MTPLX's own pick for M1 and M2 Macs (the catalog's
# LEGACY tier). It is the same quantised pack as Qwen 3.5 9B Optimized Speed
# with every BF16 float tensor cast to FP16, because M1/M2 GPUs have no native
# BF16 -- in the catalog's words, so they "run the identical model at full
# speed". On M3+ MTPLX offers the BF16 build (or MiMo V2.6) instead.

# ---- identity -------------------------------------------------------------
INSTALL_ID="mtplx-qwen35-9b-fp16"
DISPLAY_NAME="Qwen3.5-9B-FP16"
MODEL_DISPLAY_NAME="Qwen3.5-9B (MTPLX Optimized-Speed FP16)"
ROOT_ENV_VAR="MTPLX_QWEN35_9B_FP16_ROOT"

# ---- platform -------------------------------------------------------------
TARGET_OS="macos"
ACCEL="metal"                             # -> lib/accel/metal.sh
BACKEND="mtplx"                           # -> lib/mtplx.sh
CLIENT="${CLIENT:-opencode}"              # default client (overridable: --client pi / CLIENT=pi); all clients are installed and selectable at run time

SYSTEM_PACKAGES=()

# The pack's size on the Hub, 7,783,301,181 bytes (7,423 MiB), from the MTPLX
# catalog. The floor refuses a machine whose Metal working set cannot hold the
# weights at all; it says nothing about context. The catalog's peak for this
# pack is 10.5 GiB, which is what profiles.tsv pre-flights against.
# EXTRAPOLATED: no 16 GB machine's recommendedMaxWorkingSetSize was read.
MIN_DEVICE_MEM_MIB=7423

# The pack itself declares mtplx_version 0.3.8 and MTPLX 2.11.3 already lists
# it, so it is not new. 2.12.0 is required anyway: its memory planner carries
# a tight-machine rule for 16 GB-class Macs that 2.11.3's memory_plan.py does
# not, and 2.12.0 is the version whose catalog was read for this combination.
# Lower floors were not tested.
MIN_MTPLX_VERSION="2.12.0"

# ---- weights --------------------------------------------------------------
MODEL_REPO="Youssofal/Qwen3.5-9B-MTPLX-Optimized-Speed-FP16"
MODEL_APPROX_SIZE="7.8 GB (6-bit trunk, FP16 floats, FP16 draft head; no vision tower)"

# ---- serving --------------------------------------------------------------
# The pack's own served_model_id (mtplx_runtime.json), also its catalog alias.
MODEL_ALIAS_DEFAULT="mtplx-qwen35-9b-optimized-speed-fp16"
DEFAULT_PROFILE="coding"
DEFAULT_PORT=8010

# The sampler shipped in the pack's mtplx_runtime.json. It publishes one; the
# instruct preset (THINKING=0) uses the same values rather than an invented one.
SAMPLING_THINKING="--default-temperature 0.6 --default-top-p 0.95 --default-top-k 20"
SAMPLING_INSTRUCT="--default-temperature 0.6 --default-top-p 0.95 --default-top-k 20"

# The pack's chat_template.jinja reads `enable_thinking` and has no
# reasoning-effort variable, so no effort flag is sent and any other value is
# rejected up front by the launcher.
REASONING_EFFORT_DEFAULT="default"
REASONING_EFFORTS="default"

# ---- client ---------------------------------------------------------------
# A provider name of its own: both client adapters leave an existing provider
# untouched, so sharing "mtplx" with another MTPLX combination would keep this
# model out of the user's OpenCode/Pi config.
DEFAULT_PROVIDER="mtplx-qwen35-9b"

# EXTRAPOLATED: no source states the window MTPLX plans for THIS pack on 16 GB.
# The MTPLX 2.12.0 release notes give 20,480 on 16 GB for the BF16 sibling
# (Qwen 3.5 9B Optimized Speed), whose geometry this pack shares -- but the
# catalog puts this pack's peak at 10.5 GiB against 10.0 for that sibling, so
# the real plan could be smaller. The launcher passes --context-window
# explicitly, and MTPLX 2.12.0 admits an explicit window past its plan with a
# warning rather than refusing, so check the server's "Memory plan" startup
# line on first run. Must match the profile ctx below.
CONTEXT_LIMIT=20480

# 8192 of the 20,480, leaving 12,288 for system prompt, tool schemas and
# history. A choice, not a measurement: thinking tokens count against this cap,
# so much lower risks empty replies; much higher starves an agent's history.
OUTPUT_LIMIT=8192

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This pack is 7,423 MiB of weights, and MTPLX's catalog puts its peak"
  warn " at 10.5 GiB. ${mem} MiB of GPU-addressable memory cannot hold it."
  warn " (Neither figure was measured by this repo.)"
  warn ""
  warn " There is no smaller FP16 build: MTPLX has no FP16 4B, so on an M1/M2"
  warn " this is the smallest pack it offers. Raising iogpu.wired_limit_mb on a"
  warn " Mac this small starves macOS."
}

combination_performance() {
  cat <<'TXT'
NOT MEASURED -- by this repo, on any machine.

The pack's card carries a tok/s table, but it is the SOURCE (BF16) artifact's
regression baseline on unstated hardware, not this FP16 build and not a
16 GB Mac, so this repo does not quote it as a figure for this combination.

What the catalog states:
  Hub size                       7,783,301,181 bytes
  Peak memory (catalog)          10.5 GiB
  Recommended MTP depth          2 (the pack's mtplx_runtime.json)
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Compacts every turn    ~20k-token window; in Pi set a per-model
                       compaction override (see help / README)
Empty replies          thinking consumed max_tokens; raise
                       MAX_RESPONSE_TOKENS (costs history room)
Startup warns the      the explicit 20,480 window exceeds MTPLX's plan
  window overcommits   for this machine; lower CTX to what it reports
"not supported"        REASONING_EFFORT has no effect on this template;
                       use THINKING=0 to turn thinking off instead
Machine swaps          16 GB is tight; close browsers and Docker first
TXT
}
