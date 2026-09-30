#!/usr/bin/env bash
# llama.cpp prefill, broken down by operation (GGML_VK_PERF_LOGGER), on the same UD-Q4_K_XL weights
# gufo uses, to find where llama.cpp's prefill time goes compared with gufo's.
#   llama-prefill-profile.sh [--dry-run]
set -uo pipefail
BIN=~/.local/share/qwen38-flash-next-strix/llama.cpp/build/bin/llama-bench
MODEL=~/gufo/models/qwen3.8-flash-next/UD-Q4_K_XL/Qwen3.8-Flash-Next-UD-Q4_K_XL-00001-of-00004.gguf
OUT=~/expts/awesome-local-ai/benchmarks/gufo-eval/results/$(date -u +%Y%m%d-%H%M%S)-llama-prefill-profile
SIZES="2048 32768 65536"
# 512 is what test A used; 2048 is gufo's chunk size and what llama.cpp PR #29353 benchmarked with
UBATCHES="512 2048"
CONTROL_SIZE=32768
[[ "${1:-}" == --dry-run ]] && { SIZES="512"; UBATCHES="512"; OUT="$OUT-dry-run"; }
mkdir -p "$OUT"
# nothing else may hold the GPU: one model at a time (two ran the Strix Halo box out of memory on 27 Sep)
pgrep -fl "[l]lama-server|[l]lama-bench|[g]ufo serve" && { echo "the GPU is busy; not starting"; exit 1; }
common=(-m "$MODEL" -ngl 99 -fa on -b 2048 -n 0 -r 1 -lm dio --device Vulkan0 -o jsonl)
for ub in $UBATCHES; do
  for p in $SIZES; do
    echo "== ub$ub pp$p with the per-operation timer"
    GGML_VK_PERF_LOGGER=1 GGML_VK_PERF_LOGGER_FREQUENCY=1 "$BIN" "${common[@]}" -ub "$ub" -p "$p" \
      > "$OUT/ub$ub-pp$p-profiled.jsonl" 2> "$OUT/ub$ub-pp$p-ops.log"
    echo "   exit $?"
  done
done
if [[ "${1:-}" != --dry-run ]]; then
  for ub in $UBATCHES; do
    echo "== ub$ub pp$CONTROL_SIZE without the timer (overhead check)"
    "$BIN" "${common[@]}" -ub "$ub" -p "$CONTROL_SIZE" > "$OUT/ub$ub-pp$CONTROL_SIZE-plain.jsonl" 2> "$OUT/ub$ub-pp$CONTROL_SIZE-plain.log"
    echo "   exit $?"
  done
fi
echo "results: $OUT"
