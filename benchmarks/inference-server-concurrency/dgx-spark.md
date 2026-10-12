# The DGX Spark, one or two (read 11 Oct 2026)

What a Spark would add to the question of how many agents a model server carries, from NVIDIA's pages and third-party measurements. **Advertised** and **measured** are kept apart. Nothing here was run on a Spark; we do not own one yet.

## Hardware

| | Spark | Strix Halo box (for comparison) |
|---|---|---|
| Memory | 128 GB LPDDR5x unified, 256-bit, 273 GB/s (*advertised*, `https://docs.nvidia.com/dgx/dgx-spark/hardware.html`) | 128 GB unified, about 256 GB/s (our figure) |
| Compute | "Up to 1,000 TOPS inference and up to 1 PFLOP at FP4 precision with sparsity" (*advertised*); no dense FP4, FP8 or BF16 figures found | not compared |
| Network | ConnectX-7 with two QSFP ports; "up to 200 Gbps" is a third party's figure (LMSYS), not NVIDIA's page | none |

The two have the same memory-bandwidth class, so single-stream decode should be in the same class (the Strix Halo box runs Flash-Next at about 38 tok/s). The Spark's difference is compute and the CUDA software stack. No source compares them directly.

## Two units

NVIDIA's blog: "We also connected two DGX Sparks together via their ConnectX-7 chips to run the Qwen3 235B model" (`https://developer.nvidia.com/blog/how-nvidia-dgx-sparks-performance-enables-intensive-ai-tasks`), at 23,477 prefill and 11.7 decode tok/s (NVFP4, TRT-LLM, *vendor-run*). LMSYS says two can handle models "up to 405 billion parameters in FP4". The parallelism type, link speed and total memory are not stated on NVIDIA's pages (256 GB is arithmetic). The measured 11.7 tok/s suggests linking is for **fitting bigger models, not speed**. For concurrency, two independent copies, one per unit, need no interconnect.

## Measured numbers (single Spark)

| Model | Engine | Single stream | Aggregate at 8 concurrent | Source |
|---|---|---|---|---|
| GPT-OSS-120B MXFP4 | llama.cpp | 55.4 decode, 1,725 prefill | | NVIDIA blog, batch 1, 2048 in / 128 out |
| GPT-OSS-20B MXFP4 | llama.cpp | 82.7 decode, 3,670 prefill | | NVIDIA blog |
| Llama 3.1 8B FP8 | SGLang | 20.5 decode at batch 1 | 368 at batch 32 (about 18x for 32x) | LMSYS, Oct 2025, third party |
| Llama 3.1 70B FP8 | SGLang | 2.7 decode | | LMSYS ("the Spark's unified LPDDR5x memory bandwidth is the main limiting factor") |
| qwen3-coder-next, 4-bit | vLLM | 74.8 | 289.0 (3.9x) | NVIDIA forum, 10 Aug 2026, **self-published** |
| Gemma-4-26B-A4B + MTP | vLLM | 54.9 | 303.6 (5.5x) | same post |
| GPT-OSS-120B | vLLM | 60.7 | 116 to 153 (1.9 to 2.5x) | same post |
| Qwen3-30B-A3B | vLLM | 77.1 | 313.4 (4.1x) | same post |
| Qwen3-Next-80B-A3B | vLLM | about 42 to 45 FP8; about 20, then 35 NVFP4 | | forum reports |

The forum author says concurrent figures moved +/-30% between runs; Ollama's 8-way aggregate equals its single stream because it does not batch. At 8 concurrent the 30B-class MoEs gave roughly 36 to 39 tok/s per agent. **Concurrency 2, 4 and 16 for an MoE on vLLM, and any Qwen3.8 number, were not found.** No long-context agent measurements on a Spark were found, and nothing on thermal throttling beyond LMSYS's statement of "sustained throughput across high-intensity tests without thermal throttling".

## Can the engines that suit it run our model?

- **Qwen's README for Flash-Next** has launch commands for vLLM, SGLang and TokenSpeed; "llama.cpp supports the Qwen3.8-Flash-Next (text & vision)" (`https://github.com/QwenLM/Qwen3.8-Flash-Next`).
- **vLLM recipe** (`https://recipes.vllm.ai/Qwen/Qwen3.8-Flash-Next`): needs "vLLM 0.29.0+" and the image `vllm/vllm-openai:qwen38-flash-next` ("PyPI installation is not supported"). It uses `--speculative-config '{"method":"mtp","num_speculative_tokens":3}'` and `--enable-prefix-caching` together. Validated hardware: 4x GB300, 8x H200, 4x H100 with offload, 4x MI355X. **The Spark is not mentioned.** One measurement: about 1,430 output tok/s at concurrency 64 on 4x H100. A single 262K-token request "was not tested".
- **Unsloth** (`https://unsloth.ai/docs/models/qwen3.8-next`) runs MTP on llama.cpp through a fork (branch `qwen4exp/mtp`), needs at least 75 GB, and says the model suits "NVIDIA DGX Spark systems", with no Spark numbers.
- **Predecessors:** the Qwen3.5 recipe says "Prefix caching for Mamba cache 'align' mode is currently experimental", "MTP-1 reduces per-token latency but degrades text throughput under high concurrency", and advises MTP on with prefix caching off for low-concurrency latency.
- **Plainly:** per its own docs vLLM has continuous batching, MTP and a prefix-caching flag in its Flash-Next recipe, and SGLang is advertised for Flash-Next too. **No source shows prefix-cache hits on Flash-Next's linear-attention layers, or MTP and prefix caching together with a batch above one, or any Flash-Next run on a Spark.** The two things a subagent workload wants (prefix caching for forks, MTP for speed) are, in vLLM's own docs, in tension.

## What it means in practice (derived)

- **Capacity** is the same 128 GB as the Strix Halo box, so the same arithmetic applies (see `memory-model.md`): roughly five to nine sessions at 192k, depending on the quant, before cache and activations, assuming about 115 GiB usable.
- **Throughput** may improve more with batching than on Strix Halo, if a batching engine can run Flash-Next on it. That is the first thing to measure.
- Two Sparks as two independent servers double the capacity; linked, they run bigger models, not faster ones.

## The claims we are least sure of

1. The 8-way aggregate figures come from one self-published forum post (table seen through a fetch summary, +/-30% run to run). The Qwen3-Next concurrency-4 figure and llama.cpp 8- and 16-way figures were only search snippets.
2. NVIDIA's dual-Spark details: link speed and the up-to-four-unit cluster limit came from a third party or a search summary.
3. "No source shows..." above rests on the Flash-Next recipe page (truncated when read); the SGLang cookbook, the TokenSpeed recipe and vLLM issues were not read.
