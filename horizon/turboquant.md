# TurboQuant (TheTom's llama.cpp fork, with Jas Strong's work)

**Status:** candidate (30 Sep 2026): no known blocker; not scheduled. Needs a re-quantised model for its weight
types (below).
**Machine:** the RTX 4090 machine (Ubuntu, CUDA) first: Swift 1.5 / Qwen3.8 27B, compared with Swift 1.5 on llama.cpp on the
same GPU. Possibly Flash-Next on the RTX 4090 machine too (expert streaming, below), which would compete with
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

## The quant to use: Unsloth Dynamic 3.0 with TQ4_1S

**Goal (owner, 30 Sep):** combine Unsloth Dynamic 3.0 quality with the TQ weight format. The author said
Unsloth's imatrix in the pipeline should do it. What that means, from the fork's source and the author's paper
([Config I](https://github.com/TheTom/turboquant_plus/blob/main/docs/papers/weight-compression-tq4.md)):

- TurboQuant's weight policy is **Config I**, a per-tensor recipe, not "everything TQ4_1S": TQ4_1S for attention
  and FFN gate/up, native **Q4_K for `ffn_down`**, and the **first 2 and last 2 layers at q8_0**. The paper
  reports +1.3 to 2.5% perplexity for Qwen3.5-27B (19.1 GB). Within a layer, all attention tensors must share
  one type (its in-place rotation kernel corrupts a mixed layer); FFN tensors may mix.
- **The TQ types ignore the imatrix.** `quantize_tq4_1s` and `quantize_tq3_1s` discard it
  (`GGML_UNUSED(imatrix)`, `ggml/src/ggml-turbo-quant.c:1022` and `:894`); the paper calls the method
  calibration-free. So Unsloth's imatrix only improves the tensors left in standard types (the Q4_K `ffn_down`,
  and anything else not in TQ4_1S). That is presumably what "in the pipeline" means. Worth confirming with the
  author.
- Unsloth Dynamic's own gain is mostly its per-tensor type choices (and its calibration data). Config I also
  chooses per tensor, so per tensor it is one or the other. A plausible merge: Config I's TQ4_1S where Config I
  puts it (attention, gate/up), and Unsloth's type choices plus Unsloth's imatrix for every other tensor. Not
  something either project documents. Not checked: what Dynamic 3.0 changes from earlier versions.
- Start from the **BF16 original**, not from Unsloth's already-quantised GGUF (re-quantising a quant compounds
  the error). Unsloth publishes the imatrix file beside its GGUFs. Keep #362's floor for structural tensors.
- On the RTX 4090 the author's table lists "27B+KV" as working, with decode at **63–67% of q8_0** with fused
  kernels, or 100% if TQ4_1S is converted to q8_0 at load time (which gives up the memory saving on the GPU).

Measure it rather than assume: KL divergence against BF16 for (a) Unsloth's own Q4 Dynamic GGUF, (b) Config I
without an imatrix, and (c) the merge, at the same file size. Then one-story smoke tests.

## Checks before a run

1. The quant: the KL comparison above, and the quantiser floor from #362 (don't take structural tensors below 8 bits).
2. Swift 1.5's MTP head under this fork (#362 says the MTP-only path had a bug, fixed there).
3. Tool calls over the API with pi's real requests (the class of problem behind gufo issue 304).
4. Cross-turn caching past 100k tokens with a turbo KV cache (see [TensorFold](tensorfold.md)).
5. One-story smoke test.

## Confounds

Weight format (option 2), KV cache type, and the fork's own kernels all differ from upstream llama.cpp; record
the model file's hash and the server command line (the run identity does). Overlaps with
[BeeLlama.cpp](beellama.md) (also KV-cache compression and DFlash); compare the two on the same model before
adopting either.

**Last checked:** 30 Sep 2026 (release notes, `docs/KV-cache-quantization.md`, quantiser source including
`ggml-turbo-quant.c`, PRs #362 and #364, the Config I paper and results table; nothing run). **Recheck when:** the RTX 4090 machine has a free Linux window, or the author confirms how Unsloth's imatrix fits the pipeline.

Sources: [repository](https://github.com/TheTom/llama-cpp-turboquant) ·
[Config I paper](https://github.com/TheTom/turboquant_plus/blob/main/docs/papers/weight-compression-tq4.md) ·
[weight compression results](https://github.com/TheTom/turboquant_plus/blob/main/docs/weight-compression-results.md) ·
[tqp-v0.4.0 release](https://github.com/TheTom/llama-cpp-turboquant/releases/tag/tqp-v0.4.0) ·
[KV cache quantisation doc](https://github.com/TheTom/llama-cpp-turboquant/blob/feature/turboquant-kv-cache/docs/KV-cache-quantization.md)
