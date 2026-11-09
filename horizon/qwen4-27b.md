# Qwen4 27B

**Status:** on the horizon (9 Nov 2026). Added at the owner's request ("Qwen4 27B is due very soon"). Announced, not
released: no weights, card, size, licence or architecture are published. Nothing below is measured; facts are from search
results of 9 Nov 2026, of mixed quality.
**Kind:** a new model generation. It succeeds the dense Qwen3.8-27B, which is our most-run model (base, Swift 1.0 and 1.5,
Underdog, MTPLX). It would be a new family of combinations under `combinations/qwen/4/27b/...`.
**Where it could run:** all three kinds of machine, each against the Qwen3.8-27B stack it already has:

| Machine | Stack on launch day | Compared with |
|---|---|---|
| RTX 4090 (gruntus, Ubuntu) | llama.cpp, GGUF ~Q4_K_M, built-in MTP if the model has a head | `qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi` v2-r1..r5 |
| M5 Max (quintus) | MTPLX: the stock pack if one is published, otherwise Forge from the safetensors (the installer can do this since 9 Nov) | Swift 1.5 MTPLX `v2-mtplx2123`, and a stock Qwen3.8-27B MTPLX series if one is run |
| DGX Spark (thing1/thing2) | llama.cpp CUDA on Arm | the Flash-Next Spark baseline (a different model; speed context only) |

## What is known

- Alibaba presented Qwen4 at its Apsara conference (22 Sep 2026, per coverage); its own release says the model is "in training".
  A 27B tier is reported from coverage of the keynote, not from Alibaba's own text.
- No Qwen4 weights were on Qwen's Hugging Face organisation as of 29 Oct (one source). A post claims an executive said "next
  week"; unconfirmed.
- Qwen3.8-27B was Apache 2.0. Qwen4's licence is not announced (a fact to record, not a gate: see the README).

Sources: [yottalabs](https://www.yottalabs.ai/post/qwen-4-27b-release-date-specs-hardware-what-is-known-2026),
[willitrunai](https://willitrunai.com/blog/qwen-4-27b-release-date-vram), [orcarouter](https://www.orcarouter.ai/blog/qwen-4-27b),
[llmlearner](https://llmlearner.com/models/qwen4-27b), [aitoolsreview](https://aitoolsreview.co.uk/insights/qwen-4),
[shattered.io](https://shattered.io/qwen4-launch-alibaba-open-source-promise-doubt-470-models-2026/).

## Checks before a run (launch day, in order)

1. **Architecture.** Read `config.json`. If it is not `qwen3_5`/qwen35 (what Qwen3.8-27B is), every engine needs support first:
   llama.cpp (a merged commit, then `MIN_LLAMA_COMMIT_DATE`), MLX/MTPLX (`mtplx forge probe` on the repo). Swift 1.5
   Flash-Next's source is already `qwen4_exp`, which MTPLX's Forge reads; whether Qwen4 27B uses that is unknown.
2. **MTP head.** Present and in which format: decides draft-mtp on llama.cpp and whether Forge preserves it.
3. **Chat template and tool calls.** pi's parser reads the tool-call format the template emits; a changed format needs a
   recorded-stream test before any series (the "every coding agent has its own parser" rule applies to the model's template too).
4. **Sampling.** The card's recommended settings, written into each `config.sh`.
5. **The installer's short check** on each machine, then queue the series and watch story 1 (no story-length smoke).

## Space it needs

- **Disk:** a dense 27B is about 55 GB in BF16 (the Forge source), about 30 GB as an 8-bit MTPLX build, about 17 GB as a
  Q4_K_M GGUF (all by analogy with Qwen3.8-27B; Qwen4's size is unknown). Free on 9 Nov: quintus 186 GB, gruntus 178 GB,
  each Spark 2.8 TB.
- **Machine time:** a queued series does not have to be idle-gated. Cancel and resubmit as `-againN` with the same run id
  resumes it later at its first unfinished story, losing only the story in flight, so launch day can take a machine at once.

**Last checked:** 9 Nov 2026, search results only. **Recheck when:** weights appear on Qwen's Hugging Face organisation.
