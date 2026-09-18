#!/usr/bin/env bash
# combinations/bonsai/2/27b/ubuntu/24GB/llamacpp-opencode/config.sh
#
# Ternary Bonsai 2 27B on a 24GB NVIDIA GPU under Ubuntu, served by the PrismML
# llama.cpp fork, driven by OpenCode.
#
# Bonsai 2 is Qwen3.8-27B re-quantised to ternary weights ({-1,0,+1}, group 128,
# ~1.72 bits/weight) in a Hadamard-rotated basis. The architecture is unchanged,
# so everything the qwen/3.8/27b combination learned about hybrid attention
# still applies -- what changes is that the weights are a third of the size and
# that STOCK LLAMA.CPP CANNOT READ THEM.
#
# This file is DATA. All the logic lives in lib/. Every number here was measured
# on real hardware (RTX 4090 24GB, Ubuntu 22.04.5, driver 580.159.03, CUDA
# 12.3, fork build 5d80cff) -- see ./benchmarks/README.md for the method and the
# configurations that failed.

# ---- identity -------------------------------------------------------------
INSTALL_ID="bonsai2-27b"
DISPLAY_NAME="Ternary Bonsai 2 27B"
MODEL_DISPLAY_NAME="Ternary Bonsai 2 27B GGUF"
ROOT_ENV_VAR="BONSAI2_ROOT"

# ---- platform -------------------------------------------------------------
TARGET_OS="ubuntu"
TARGET_OS_VERSION="22.04"
ACCEL="cuda"
BACKEND="llamacpp"
CLIENT="opencode"

SYSTEM_PACKAGES=(build-essential git curl wget cmake ninja-build libcurl4-openssl-dev pciutils)

MIN_DEVICE_MEM_MIB=23000                  # this combination's tier; see low_memory_advice
MIN_DRIVER_VERSION=550                    # 580.159.03 validated
MIN_LLAMA_COMMIT_DATE="2026-09-17"        # fork build verified here: prism-b10687 / 5d80cff

# ---- backend source -------------------------------------------------------
# THE POINT OF THIS COMBINATION. Bonsai 2's ternary types (PQ2_0 = ggml type
# 142, PTQ1_0 = 143) sit past upstream's GGML_TYPE_COUNT and the format needs a
# Hadamard activation transform that is not upstream yet. Stock llama.cpp
# refuses the file outright -- verified here:
#
#   gguf_init_from_reader: tensor 'output.weight' has invalid ggml type 143.
#                          should be in [0, 43)
#
# That is the SAFE failure. The Q2_0 band published in the -dev repo is the
# unsafe one: mainline loads it without complaint and emits gibberish, which is
# why this combination does not offer it.
#
# The cost of the fork is that this combination no longer floats on upstream
# master. lib/verify.sh's rollback still applies, but it returns to the last
# verified commit of THIS fork.
LLAMA_REPO_URL="https://github.com/PrismML-Eng/llama.cpp.git"
LLAMA_BRANCH="prism"

# ---- weights --------------------------------------------------------------
# Two packings of the same ternary weights. PQ2_0 stores each trit in a 2-bit
# slot; PTQ1_0 packs trits densely and is 1.17 GiB smaller.
#
# PQ2_0 is the default here and the choice is prefill, not size. Measured on
# this card, PQ2_0 prefills at 3016 tok/s against PTQ1_0's 1597 -- 1.9x -- while
# giving up 6% of decode (92.2 vs 98.5 tok/s at depth 0). A coding agent
# re-reads far more than it writes, so prefill is the number that decides.
# PACKING=PTQ1_0 is the right override on a smaller card or for chat.
PACKING="${PACKING:-PQ2_0}"
MODEL_SUBDIR="models/Ternary-Bonsai-2-27B-GGUF"

# The declared size gates lib/model.sh's "is this file complete?" check at 90%,
# so it has to track the packing or a good PTQ1_0 download looks truncated.
case "$PACKING" in
  PQ2_0)  _MODEL_APPROX="6.71 GiB" ;;
  PTQ1_0) _MODEL_APPROX="5.54 GiB" ;;
  *)      _MODEL_APPROX="" ;;          # unknown packing: skip the size check
esac

# repo | filename | role | approx size
#
# No `mtp` record: Bonsai 2 ships no drafter of any kind. See help.txt for what
# was measured when one was borrowed from elsewhere.
MODEL_ASSETS="
prism-ml/Ternary-Bonsai-2-27B-gguf|Ternary-Bonsai-2-27B-${PACKING}.gguf|model|${_MODEL_APPROX}
prism-ml/Ternary-Bonsai-2-27B-gguf|Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf|mmproj|0.59 GiB
"

# ---- serving --------------------------------------------------------------
MODEL_ALIAS_DEFAULT="bonsai2-27b"
DEFAULT_PROFILE="coding"

# Measured on this card at 32k, PQ2_0, by prefill rate:
#   f16 3041 | q8_0 3015 | q4_0 3015  -- GPU attention
#   q5_1  28                          -- silent CPU fallback, 106x slower
# Only the first three are listed because only the first three were measured to
# have a kernel. bf16 is absent for the same reason: untested here.
SAFE_KV_TYPES="f16 q8_0 q4_0"

# Straight from the Bonsai 2 model card, which carries the base model's own
# generation_config values in GGUF metadata (general.sampling.*).
SAMPLING_THINKING="--temp 1.0 --top-p 0.95 --top-k 20 --min-p 0.0"
SAMPLING_INSTRUCT="--temp 0.7 --top-p 0.80 --top-k 20 --min-p 0.0 --presence-penalty 1.5"

# Bonsai 2 defaults to xhigh. Its card states low is NOT supported and behaves
# close to xhigh, and benchmarks/effort.sh confirms it on this hardware --
# 5 prompts, greedy, one load:
#
#   effort    reasoning chars   completion tokens
#   low                 14532                5774
#   medium               6364                3258
#   xhigh               14637                4546
#
# low is 1.01x xhigh's reasoning: the level is accepted and then ignored.
# MEDIUM IS BOTH THE FLOOR AND THE CHEAPEST -- less than half either of the
# others, which is unusual enough to be worth stating plainly. So medium is the
# default, and low is deliberately NOT in REASONING_EFFORTS: the launcher then
# refuses it with a message, which is better than accepting it and silently
# charging xhigh. This is where this combination differs from its Qwen sibling,
# whose template does honour low (4026 chars against xhigh's 14004).
REASONING_EFFORT_DEFAULT="medium"
REASONING_EFFORTS="default medium high xhigh"

IMAGE_MIN_TOKENS=1024                     # llama.cpp's recommendation for Qwen-VL grounding

# ---- client ---------------------------------------------------------------
DEFAULT_PROVIDER="bonsai2-local"
CONTEXT_LIMIT=131072                      # the coding profile; `max` serves 262144
OUTPUT_LIMIT=32768

# ---- hooks ----------------------------------------------------------------
low_memory_advice() {
  local mem="$1"
  warn " This combination was measured on a 24GB card. The model itself is far"
  warn " smaller than that, so a smaller card is likely fine -- but nobody has"
  warn " run it on one, so these are MEASURED FOOTPRINTS, not measured runs:"
  warn ""
  warn "   profile    ctx      KV     needs"
  warn "   dual       32768    q4_0    7991 MiB"
  warn "   coding    131072    q4_0   10200 MiB"
  warn "   max       262144    q4_0   13144 MiB"
  warn ""
  if (( mem >= 8500 )); then
    warn " Your card reports ${mem} MiB, which the numbers above say should hold"
    warn " at least the 'dual' profile, and probably 'coding'. To try it:"
    warn ""
    warn "   ALLOW_LOW_VRAM=1 PACKING=PTQ1_0 \$0"
    warn "   then: PROFILE=dual bonsai2-27b-server"
    warn ""
    warn " PACKING=PTQ1_0 saves a further 1.17 GiB of weights at the cost of"
    warn " about half the prefill rate."
  else
    warn " Below ~8.5 GB even the smallest profile measured here does not fit."
  fi
  warn ""
  warn " If it works, please contribute the numbers as a 16GB/12GB combination."
  warn " See docs/adding-a-combination.md."
}

combination_performance() {
  cat <<'TXT'
Generation, depth 0          ~92 tok/s
Generation, 32k of context   ~76 tok/s
Generation, 128k of context  ~50 tok/s
Prefill (pp2048)           ~3319 tok/s
Speculative decoding           none shipped for this model
TXT
}

combination_troubleshooting() {
  cat <<'TXT'
Empty replies       raise max_tokens -- thinking is on and defaults to xhigh
Slow prompt reading KV_TYPE must be f16/q8_0/q4_0 -- others run on CPU
'invalid ggml type' you are running stock llama.cpp, not the PrismML fork
CUDA out of memory  free the GPU, or use PROFILE=dual
TXT
}
