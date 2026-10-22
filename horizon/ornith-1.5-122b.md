# Ornith 1.5 122B

**Status:** candidate (22 Oct 2026). Added at the owner's request. Nothing downloaded or run. Two days old when read.
**Kind:** a new model, the same size class as the Flash-Next (125B MoE) we already run, so a model swap on machines we have.
**Where it could run:** Sparks thing1/thing2 (see [the hardware note](dgx-spark-thing1-thing2.md)), the Strix Halo box and the M5 Max (128 GB each, on formats that fit); not the 4090 machine without an expert-offload engine like [Strata](strata.md), which does not list this model.

## What it is

Open-weight MoE from Ornith, MIT. Read from [explainx](https://www.explainx.ai/blog/ornith-1-5-122b-open-weights-mit-single-80gb-gpu-swe-bench-verified-84-5-claimed-vs-verified-2026) and search results; the model card itself was **not** read.

- About 122B total parameters (the Hub metadata says 125.09B and one quantiser's page says 125.09B `qwen3_5_moe` with a vision tower). **Active parameters not stated** in anything read. Text and images; 262,144 tokens native.
- Lineage: Ornith 1.0 was built on Qwen3.5 and Gemma4 (per a search summary); the 1.5 family launched 19 Aug 2026 in 397B, 35B and 9B sizes; the 122B appeared on the Hub 16 or 20 Oct (sources disagree).
- Formats listed: BF16 (about 250 GB), FP8, NVFP4, GGUF (the card calls it forthcoming while repos exist), MLX, plus community quants. Engines named: Transformers, vLLM 0.19.1+, SGLang 0.5.9+, Ollama, llama.cpp. Tool calling with the Qwen parsers (`qwen3_xml` in vLLM, `qwen3_coder` in SGLang); reasoning parser `qwen3`.
- "Runs on a single 80 GB GPU" is the card's claim, with no precision stated.

## Whose figures

All benchmark numbers are the vendor's, on custom harnesses and judges, and the Terminal-Bench run needed a modified chat template: SWE-bench Verified 84.5, SWE-bench Pro 76.9, TerminalBench 2.1 81.2. **No independent evaluation found.** Press framing as an "open top model competing with Qwen3.8-Flash-Next" (GIGAZINE) is a headline, not a measurement. None of this predicts a vidi score.

## Checks before a run

1. **Pick the format per machine** and read the real card: on Sparks the one recipe found is Mia's AI Lab's [EXL3 4-bit on TensorFold](https://github.com/MiaAI-Lab/Ornith-1.5-122B-TensorFold) (about 69 GiB resident; one tool call tested, needle test to 32k only, quality card KL 0.0135 and 96.7% top-1 against BF16; the lab's own figures; same lab and engine as the [two-Spark DeepSeek recipe](deepseek-v4.1-flash-1017-two-sparks-mia.md), whose open issues apply here too); on Strix Halo and the M5 Max a GGUF or MLX 4-bit that leaves headroom (about 77 GB download was reported for one build).
2. **Tool calls over the API**: structured `tool_calls`, JSON arguments, a newline in a string kept. Check the template the engine uses is the one the card's tool parsers expect.
3. **How thinking comes back** (`think_complete` for our analytics): the model reasons in a chain of thought before answering.
4. **Cross-turn caching past 120k tokens** and memory headroom while the run's browsers and test servers also run.
5. **Sampler:** read the card for the recommended sampling; not found in what was read.
6. Parser: a client already supported (pi, OpenCode); nothing new.

## Confounds

Versus Flash-Next arms: a different model with unknown active parameters, a different quantisation per machine, and an engine that differs per machine. To rank the model, hold the engine and quantisation fixed across the Spark arm and a second machine.

**Last checked:** 22 Oct 2026, from third-party pages and search results. **Recheck when:** the card's GGUF/MLX files are confirmed; an independent evaluation appears; thing1 is a node.
