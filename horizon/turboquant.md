# TurboQuant (TheTom's llama.cpp fork, with Jas Strong's work)

**Status:** candidate (30 Sep 2026): no known blocker; not scheduled. Needs a re-quantised model for its weight
types (below).
**Machine:** gruntus (Ubuntu, CUDA) first: Swift 1.5 / Qwen3.8 27B, compared with Swift 1.5 on llama.cpp on the
same GPU. Possibly Flash-Next on gruntus too (expert streaming, below), which would compete with
[Strata](strata.md).

## What it is

A llama.cpp fork ([TheTom/llama-cpp-turboquant](https://github.com/TheTom/llama-cpp-turboquant), MIT, about
2,400 stars, branch `feature/turboquant-kv-cache`, release `tqp-v0.4.0` on 28 Sep 2026, active). "TurboQuant"
is two separate things, both built on a Walsh-Hadamard rotation (WHT) of the vectors before quantising:

- **KV-cache types, runtime only:** `turbo2` (2 bits/value, 6.4x smaller than f16), `turbo3` (3.25 bits, 4.9x)
  and `turbo4` (4.25 bits, 3.8x), set per K and V (`--cache-type-k q8_0 --cache-type-v turbo3`). They work on any
  existing GGUF and need flash attention. Environment switches: `TURBO_LAYER_ADAPTIVE` (e.g. first and last
  layers in q8_0), `TURBO_AUTO_ASYMMETRIC`, `TURBO_SPARSE_V`.
- **Weight types, which need a re-quant:** `TQ3_1S` (listed as 4.00 bpw) and `TQ4_1S` (5.00 bpw), WHT-rotated
  Lloyd-Max quantisation in blocks of 32, made with `llama-quantize model-f16.gguf model-tq4.gguf TQ4_1S`. This is
  the "alters the model's memory structure" part: a model file in these types only runs on this fork.

Also in `tqp-v0.4.0`: KV streaming from host memory (`--kv-stream-arena-mib`), so the whole KV cache need not sit in
VRAM; MoE expert paging (experts in pinned host memory, hot ones cached in VRAM) for CUDA, Metal and Vulkan;
DFlash2 speculative decoding; MTP. The release notes name "the exact Qwen3.8 27B q8_0/Turbo4 streaming
configuration" as validated on an RTX 5090.

**Jas Strong** (`jasstrong`) has 24 pull requests there, including
[#362](https://github.com/TheTom/llama-cpp-turboquant/pull/362) "Four fixes Qwen3.8-Flash-Next needs to work"
(pinning its 27 GB n-gram table in host memory; a quantiser floor, because five structural tensor classes
quantised to 3 to 4 bits give "a model that loads, runs at full speed, and ignores the prompt completely"),
[#364](https://github.com/TheTom/llama-cpp-turboquant/pull/364) streaming TurboQuant MoE experts from pinned host
memory, and CUDA performance and AMD fixes.

## The quant to use

Owner's earlier research: a 4-bit quant made with **Unsloth's imatrix** looked best; the details were not
settled. What the code says (30 Sep): the quantiser does not *require* an imatrix for `TQ3_1S`/`TQ4_1S` (only
the IQ1/IQ2/IQ3_XXS types and Q2_K_S do). **Not checked:** whether `TQ4_1S` *uses* an imatrix when one is given
(`--imatrix`), and so whether Unsloth's imatrix applies to TQ4_1S or only to standard types such as Q4_K_M paired
with turbo KV. Settle this first, from the quantiser source or by measuring KL divergence against BF16.

Two ways to run it, to be decided:
1. Standard 4-bit weights (Q4_K_M from Unsloth, imatrix already applied) with `turbo3`/`turbo4` KV: no re-quant,
   isolates the KV cache.
2. `TQ4_1S` weights from BF16, with or without Unsloth's imatrix, plus turbo KV: the full fork, but a
   re-quant, and a different weight file from every other stack (a confound to record).

## Checks before a run

1. The imatrix question above, and the quantiser floor from #362 (don't take structural tensors below 8 bits).
2. Swift 1.5's MTP head under this fork (#362 says the MTP-only path had a bug, fixed there).
3. Tool calls over the API with pi's real requests (the class of problem behind gufo issue 304).
4. Cross-turn caching past 100k tokens with a turbo KV cache (see [TensorFold](tensorfold.md)).
5. One-story smoke test.

## Confounds

Weight format (option 2), KV cache type, and the fork's own kernels all differ from upstream llama.cpp; record
the model file's hash and the server command line (the run identity does). Overlaps with
[BeeLlama.cpp](beellama.md) (also KV-cache compression and DFlash); compare the two on the same model before
adopting either.

**Last checked:** 30 Sep 2026 (release notes, `docs/KV-cache-quantization.md`, quantiser source, PRs #362 and
#364; nothing run). **Recheck when:** gruntus has a free Linux window, or the imatrix question is settled.

Sources: [repository](https://github.com/TheTom/llama-cpp-turboquant) ·
[tqp-v0.4.0 release](https://github.com/TheTom/llama-cpp-turboquant/releases/tag/tqp-v0.4.0) ·
[KV cache quantisation doc](https://github.com/TheTom/llama-cpp-turboquant/blob/feature/turboquant-kv-cache/docs/KV-cache-quantization.md)
