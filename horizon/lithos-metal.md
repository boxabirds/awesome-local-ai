# Lithos Metal: Metal megakernels and DSpark speculative decoding for Apple silicon

**Status:** candidate (16 Oct 2026). Added at the owner's request. Not run, not installed, read from the project's README and
repository metadata only. Its 36 open issues have not been read.
**Kind:** a new engine on the Mac, serving Qwen3.8-27B and Qwen3.6-35B-A3B. It does not list Flash-Next, the model of our
other Mac stacks, so a comparison would be on Qwen3.8-27B only.
**Where it could run:** the M5 Max (128 GB). Compare with the Mac 27B stack we already have,
[MTPLX](mtplx.md) with OpenCode on 64 GB (`qwen/3.8/27b/macos/64GB/mtplx-opencode`), and in principle with llama.cpp on
Qwen3.8-27B.

## What it is

[lithos-metal](https://github.com/lithos-ai/lithos-metal) (organisation lithos-ai, site lithosai.com) describes itself as
"a fully open-source inference engine that generates Metal megakernels for Apple silicon", for "low-latency LLM inference ...
with local serving for coding agents". Apache 2.0 licence. Mostly Python (2.6 MB) and Metal (0.3 MB), with Objective-C,
Objective-C++ and C++ for the native runtime.

- **How it is fast, by its README:** layer-wise "mixer megakernels" (the recurrent GDN or full-attention part of a layer
  becomes one kernel; the feed-forward part stays separate), generation state kept on the GPU, and **DSpark speculative
  decoding**: a small draft head proposes a block (seven tokens by default) that the target model verifies together.
  The draft head is the project's own, published on Hugging Face as `LithosAI/Qwen3.8-27B-DSpark-NVFP4` and
  `LithosAI/Qwen3.6-35B-A3B-DSpark-NVFP4`. `--no-draft` turns speculation off.
- **Models it selects automatically:** Qwen3.8-27B-NVFP4 (NVIDIA), Qwen3.8-27B-4bit (mlx-community, affine 4-bit), and
  Qwen3.6-35B-A3B-NVFP4, which the README calls experimental.
- **Hardware:** needs macOS 26 or later and an Apple silicon chip with a "registered backend". The README says the two big
  models "have been exercised" on a 40-core **M5 Max with 48 GB**. Measured recipes exist for the M5 Max (40 GPU cores), M5 Pro
  (20), M3 Ultra and M4 Pro (20); other chips run an unmeasured fallback with no fusion. An M5 Max with 32 GPU cores is listed as
  an unmeasured fallback, so **which M5 Max we have (cores) decides which path we would get**; not checked.
- **Serving:** `brew install lithos-ai/tap/lithos-metal`, then `lithos-metal serve --model nvidia/Qwen3.8-27B-NVFP4`.
  OpenAI Chat Completions, Responses, Anthropic Messages and Ollama's chat endpoint, with tool calls and streaming. **One
  generation at a time.** Default context 32K (`--max-context` changes it). Launchers exist for OpenCode, Claude Code, Codex and
  Hermes; any other OpenAI-compatible client is run through `lithos-metal env` or `lithos-metal run -- CLIENT`. **pi, the client
  of our Mac stacks, is not in the list.**
- **Age and activity (read 16 Oct 2026 with the GitHub API):** created 5 Oct 2026; release v0.1.2 on 5 Oct; last push 12 Oct;
  229 stars, 24 forks, 36 open issues. A young project.

## What the README says that bears on us

| | |
|---|---|
| Speed claim | about 168 tokens/s at 128-token context and 127 at 32K, Qwen3.8-27B-NVFP4 on a 40-core M5 Max with 48 GB |
| What that figure is | a "target-compute projection" that assumes six accepted tokens per eight-row pass and **excludes drafting, acceptance and rewind**; the README itself says it is not an end-to-end rate or a direct speed-up comparison |
| Comparison it ships | a research note comparing MLX, Ollama and vLLM-Metal on the same Mac (linked from the README; not read) |
| Context | 32K default; our agent needs 131,072 |
| Concurrency | one generation at a time |

None of this is our measurement.

## Checks before a run

In this order. None has been done.

1. **Does it install and serve on the M5 Max at 131,072 tokens?** `--max-context 131072`; start it, send one long prompt, read
   memory and swap. The README's own test machine has 48 GB, ours 128 GB; the context cost is not stated. Also record the GPU
   core count and which backend path it picks.
2. **A tool call with arguments that carry raw newlines, and a large one**, with `tools/engine-probe/basic-capability.py`.
   A failure is the engine and not the model.
3. **Prompt reuse at depth.** A second request on a 100k-token conversation must report a cached prefix. The serving design
   document is said to cover prefix caching; unread.
4. **pi against its API**, over Chat Completions or Anthropic Messages, since pi has no launcher.
5. **Speculation on and off** (`--no-draft`), to see how much of any speed is the engine and how much is the project's own draft
   head. The head is trained by the project for these two models only.
6. **A version pin** (release or commit), and a read of the open issues first.
7. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

- **Different weights.** The default is NVIDIA's NVFP4 build of Qwen3.8-27B, or an MLX affine 4-bit one, not the GGUF or MTPLX
  builds of the stacks it is compared with.
- **Speculative decoding by default**, with a head made by the engine's authors. Not comparable with an engine that does none
  unless the draft is switched off or the other side also speculates (MTPLX does).
- **A young engine.** Created eleven days before this note; expect fast change and unfound faults. Results are for one version.
- **One model size.** No Flash-Next, so no comparison on our main Mac model.
- **The 35B model is marked experimental** by the project.

## Why it is worth the check

It is an engine built specifically for the M5 generation and for agents, with a speculative-decoding head from the same
authors, and it serves the Anthropic Messages API directly. If its speed holds end to end on agent work at 131k context, it
would be the strongest 27B option on a Mac; the README's figures are not that evidence, so the checks above decide.

**Last checked:** 16 Oct 2026, from the README and the GitHub repository metadata, not from running it.
**Recheck when:** check 1 is answered, a release after v0.1.2 appears, or the project lists Flash-Next or pi.
