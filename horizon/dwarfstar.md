# DwarfStar (ds4): a native engine for a few large models, Qwen3.8 Flash Next among them

**Status:** candidate for the M5 Max, gated on the checks below (3 Oct 2026). Not run. By its own documentation it
does not fit the RTX 4090 machine, and Strix Halo is not documented for Qwen.
**Kind:** a new engine on the model we already benchmark: a direct rival to mlx-serve, MTPLX, TensorFold and gufo.
**Sources:** github.com/antirez/ds4 (MIT), read 3 Oct 2026: README, `docs/QWEN38_FLASH_NEXT.md`, `docs/MODELS.md`,
`docs/CLIENTS.md`, `docs/CUDA_MULTI_GPU.md`, `docs/STRIX_HALO.md`, `docs/PERFORMANCE.md`, and its open issues. Nothing
here was run.

## What it is

DwarfStar is Salvatore Sanfilippo's (antirez, the author of Redis) "small native inference engine" in C with Metal,
CUDA and ROCm backends, built for a short list of models rather than as a general GGUF runner. Created 6 May 2026,
about 23,000 stars. It runs only GGUF files the project itself produces. Its list: DeepSeek V4 Flash (and V4.1
Flash, and PRO), GLM 5.2 and 5.3 Flash, and **Qwen3.8 Flash Next on Metal and single-GPU CUDA**. The README says
openly that it is developed with strong assistance from AI coding agents, is beta quality, and changes very fast.
There are no releases and no tags: a pin has to be a commit. Its main branch's last commit was 20 Sep 2026, while
issues were still being filed on 26 Sep. 754 issues are open.

## What it offers for our model

- `ds4-server`, an OpenAI-compatible server (default port 8000) with documented client setups for pi and OpenCode.
  Aliases `qwen3.8-flash-next`, `-chat` and `-reasoner`; tool calls in Qwen's native format; MTP drafting from the
  weights in the file (`--mtp`); thinking on by default, `--nothink` to turn it off; native context 262,144 tokens.
- Two Qwen downloads, each one GGUF with the main model, the MTP head and the **original BF16 n-gram table**, which
  stays on disk and is read row by row from the SSD (as Strata does):

  | Target | File | Resident weights |
  |---|---:|---:|
  | `qwen38-q2` (IQ2_XXS gate/up, Q2_K down) | 137.10 GiB | 41.73 GiB |
  | `qwen38-q4k` (Q4_K gate/up, MXFP4 down) | 165.11 GiB | 69.74 GiB |

- Disk KV checkpoints that include the recurrent state, and `--batched-session N` batching on Metal (CUDA decodes
  sessions in order).
- Its only recorded Qwen speed is on a DGX Spark, without MTP: prefill 516 to 755 tokens/s, decode 22.6 tokens/s (Q2) and
  21.2 (Q4) at 8,192 tokens. Its docs give no Qwen figure for any Mac or for Strix Halo.

## Where it could run

| Machine | Verdict from its documentation |
|---|---|
| M5 Max, 128 GB (Metal, its primary target) | Fits: Q4 resident weights are 69.74 GiB (our mlx-serve pack: 75.6 GiB resident). Context and KV at 131,072 are not stated, so the memory at our minimum context is unknown |
| RTX 4090, 24 GB VRAM and 62 GB RAM | Does not fit by its docs: 41.73 GiB of resident weights (Q2) against 24 GiB of VRAM, and its CUDA placement refuses layouts that need CPU execution. Its Qwen CUDA support is described as single-GPU, with the DGX Spark as the example. Not tried |
| Strix Halo, 128 GB (ROCm) | The ROCm guide lists DeepSeek and GLM; Qwen is not mentioned there, and the Qwen page says Metal and CUDA only. Not documented |

So the one candidate is the M5 Max, compared with mlx-serve (same model, a 4/8-bit pack), MTPLX and TensorFold.

## What it would be compared with, and the confounds

- **Quantization differs.** Q4 is its own calibrated Q4_K and MXFP4 mix; Q2 is much smaller than anything we run (below
  Strata's IQ3_XXS). A score measures the engine and the quantization together, as for Strata.
- **The n-gram table is read from the SSD while generating** (95 GiB, BF16). The M5 Max's SSD speed then bears on
  speed; mlx-serve maps a 29.8 GiB table instead. Not measured on this Mac.
- **A 165 GiB download** for Q4 on a link that has run at 2 to 32 MB/s.
- Drafting is opportunistic: matching greedy drafts are accepted by default, even at nonzero temperature; exact sampling
  is a separate flag. That is a difference in how sampling and speculation interact, to be recorded.

## Checks before a run (each takes minutes, no story)

1. **Tool calls over the OpenAI API with pi's requests**, including a tool call with raw newlines inside an argument.
   Its own issue 999 says Qwen tool-call structure is decoded at the request's temperature with no protection, so a
   sampling accident can corrupt a tag: the failure class of our gufo issue 304. Issue 1076 says tool-enabled chat
   completions buffer their content until generation ends, which may matter to pi's streaming.
2. **Cache continuity** across a pi conversation past 120k tokens (the TensorFold check: tokens re-read per turn). Its
   issue 1133 (a system message sent with a tool result dropped by live continuation, forcing a full re-prefill) is for
   the Anthropic API; whether the OpenAI path has the same gap is not known.
3. **Memory at 131,072 context** on the M5 Max with Q4: the server must start, and not push the Mac toward the
   high-memory failures this machine has had. The limit that applies to TensorFold on this Mac (nothing above 89.6 GiB
   without the owner's say) is a precedent, not a rule for another engine, but the same caution applies.
4. **The n-gram reads** from this Mac's SSD: tokens per second at 8k and at 100k+ context.

## Not checked

Its quality on our stories; any Mac figure; the pi provider example for a Qwen id (the docs show a DeepSeek one); the
licence of the Qwen GGUFs it distributes (the code is MIT); whether `ds4-server` honours a reasoning effort of "low", as
pi's settings need.

## DeepSeek

The same engine changes one line of [DeepSeek V4.1](deepseek-v4.1.md). That note was eliminated for size and listed
"V4.1-Flash on a 128 GB machine" as the recheck. DwarfStar's README says V4.1 Flash text and vision run on Metal, with
Q2 using SSD streaming on one 128 GB Mac (the Engram tables stay on disk in every mode, so it wants a fast SSD). That is a
fact to weigh, unverified here, and not a decision to add a DeepSeek stack.

**Last checked:** 3 Oct 2026. **Recheck when:** the owner wants another Flash-Next engine on the M5 Max after the
mlx-serve and MTPLX series; or its tool-call and caching issues (999, 1076, 1133) close; or it tags a release.
