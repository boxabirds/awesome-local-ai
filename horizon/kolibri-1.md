# Kolibri-1 (Aleph Alpha, a sparse reasoning model)

**Status:** on the horizon (3 Oct 2026), the day it was released. Not run, not downloaded. Assessed from a summary of its
Hugging Face model card only; I have not read the card in full and none of its numbers is ours.
**Kind:** a model, with its own serving requirement. It would be a new model on an engine we already run, if one of them can
load it; a new combination, never a change to a baseline.
**Sources:** `huggingface.co/Aleph-Alpha/Kolibri-1` (model card, summarised 3 Oct 2026).

## What it is, as the card is summarised

- **Maker and licence:** Aleph Alpha; Apache 2.0.
- **Architecture:** a mixture-of-experts transformer, 78B parameters in total and 3.46B active per token; 50 layers with
  sliding-window and full attention in a 4:1 ratio; a 128k-token vocabulary with a custom tokenizer built for German
  morphology.
- **Context:** 262,144 tokens natively, and 1,048,576 by position extrapolation. Our floor is 128k, so the native window is
  enough.
- **For:** a German and English assistant for multi-step reasoning, retrieval, agentic tool calling and coding, with long
  documents; built for work with a person in the loop, not autonomous operation.
- **Reasoning:** explicit reasoning modes at low, medium and high effort. Tool calling with function schemas.
- **Serving:** its card asks for the `aleph-alpha-inference` package with a vLLM plugin, behind an OpenAI-compatible API;
  FP8 weights (`float8_e4m3fn`). Recommended sampling: temperature 1.0, top-p 0.97, top-k 128.
- **Claimed results** (not ours): GPQA 84.3% (English), AIME 96.9%, HumanEval+ 92.7%, and strong agentic results against
  models with a similar active size.

## Why it might matter here

- **Sparse and small active size**, like Flash-Next: decode speed that follows the 3.46B active parameters, and a total size
  that still needs the memory of a 78B model. As weights, FP8 is about one byte a parameter, so roughly 78 GB before the
  cache (a calculation from the parameter count, not a measurement).
- **A reasoning-effort setting the model itself defines.** That is a thinking lever of exactly the kind the thinking-spread
  work needs (docs/research/20261003-thinking-spread.md): a model whose effort modes are part of its design is a cleaner
  place to test "shorter paths that are as effective" than a cap bolted on the engine.
- **A German-and-English parity claim** does not matter to the benchmark's stories; it neither helps nor hurts.

## Hardware and software it asks for (from the model card and write-ups, found by search 3 Oct 2026)

- **Software:** Aleph Alpha's `aleph-alpha-inference` package, which carries a Kolibri plugin for vLLM; served behind an
  OpenAI-compatible API. It does not run on stock vLLM, and no source I found mentions llama.cpp, a GGUF or an MLX build.
- **Hardware, FP8 (about 78 GB of weights):** two 80 GB A100s, two H100s, one H200, or one B200 or B300 as the stated minimums.
- **Hardware, BF16 (about 156 GB):** four 80 GB A100s or H100s, two H200s, or one B200 or B300.
- A forum thread about running it on NVIDIA's 128 GB DGX Spark class machine exists; I have not read it.

## Quantisations that exist (Hugging Face index, 3 Oct 2026, evening)

- **Official:** `Aleph-Alpha/Kolibri-1` (FP8, 128 by 128 blocks, with the embeddings, output head, norms and router in bf16)
  and `Aleph-Alpha/Kolibri-1-BF16`.
- **Community, hours old:** `here-be-dragons-ai/Kolibri-1-MLX-3bit` and `-3bit-mlxlm` (MLX, 3-bit; by arithmetic about 29 GB of
  weights, not checked), and `audreyt/Kolibri-1-NVFP4-W4A16` (NVFP4 weights, for vLLM).
- **No Unsloth repo, and no GGUF of any kind**, by the index's search and its base-model listing. A GGUF needs llama.cpp
  to support the architecture first (sliding-window and full attention in 4:1, the custom tokenizer), and nothing I found says it
  does. Whether the MLX build loads in mlx-lm, and whether mlx-serve could run it, is not known.

## What gates it

- **An engine we run has to load it.** The card names only vLLM through a vendor plugin. llama.cpp, mlx-serve, gufo and
  MTPLX support is not mentioned; whether any exists, or a GGUF or MLX conversion, is the first thing to find out. Without it
  the only route is vLLM, which is not an engine we have a combination for.
- **Memory.** About 78 GB of FP8 weights is more than the M5 Max's 89.6 GiB budget leaves once the cache is counted, unless
  a 4-bit conversion exists; it would fit the Strix Halo's 128 GB only on an engine that can run it; and it does not fit the
  4090's 24 GB plus 62 GB of RAM at any speed worth benchmarking. The published minimums are datacentre GPUs, none of
  which we have.
- **The sampling it recommends** differs from ours (top-p 0.97, top-k 128 against 0.95 and 20). A run would have to use the
  card's, as every combination here uses its model card's.

## What would bring it up the list

An engine we run reporting support for the architecture, or a quantisation that fits. Then: the installer's own smoke test
(not a story), a tool-call check with pi's requests and a prompt-reuse check, as for every new stack; then a 5-run series. The
effort modes would be recorded in the run's settings like any other (the thinking mode and budget are pinned explicitly).
