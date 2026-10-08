# Underdog Saluki 27B (2-bit) with an MTP head

**Status:** candidate (8 Oct 2026). Added at the owner's request. Not downloaded, not run; read from the two model cards and
Hugging Face's own metadata.
**Kind:** a new quantisation of a model we already run (Qwen3.8-27B), small enough to change what a 24 GB card can hold. A new
combination if it runs.
**Where it could run:** the RTX 4090 machine on Ubuntu, against the base `qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi` (one run,
68/75) and Swift 1.5 (`v2-fresh`, median 66/75), on the llama.cpp builds that already do `--spec-type draft-mtp`.

## What it is

Two uploads, both of 8 Oct 2026, so both a day old:

- [Underdog Saluki 27B 1.0](https://huggingface.co/ConwayResearch/Underdog-Saluki-27B-1.0) (ConwayResearch, "Underdog"): Qwen3.8-27B
  as a 2-bit GGUF (`IQ2-mix`, 7.89 GB, imatrix), "tuned to keep tool calling intact", built on ISTA-DASLab's Qwen3.8-27B GSQ-RCO
  GGUF. Apache 2.0. 87 likes and 142 downloads when read. It has no MTP head.
- [Underdog-Saluki-27B-1.0-MTP-GGUF](https://huggingface.co/Kujira/Underdog-Saluki-27B-1.0-MTP-GGUF) (Kujira, the page we were
  given): the same file with Qwen3.8-27B's own MTP layer added, so llama.cpp can draft with it. **8.35 GB**, sha256 `98f6ebb5…e89e52`
  (the card's; not verified here). Its card says all 851 main tensors are byte-identical to Saluki's, 15 tensors (`blk.64.*`,
  Q8_0 and F32, about 0.45 GB) were added from the head that Unsloth quantised for the base model, and nothing was trained or
  re-quantised. `graft_mtp.py` in the repository rebuilds it. Apache 2.0, 6 likes and no downloads when read.

## What the cards claim, and whose figures they are

| Claim | Figure | Whose |
|---|---|---|
| Tool calling, 120 tasks from BFCL v4 ("Underdog Bench"), thinking off | 88 against 84 for the full model | Underdog |
| 100 parallel tool-call tasks | 42 against 35 | Underdog |
| SWE-bench Verified, 50 issues | 30 against 33 | Underdog |
| IFEval / IFBench / MBPP+ | 93.5 / 72.7 / 78.0 against 91.5 / 71.0 / 83.9 | Underdog, against *public* scores from a different harness |
| MuSR, AIME 2025, AIME 2026 | 67.5, 79.2, 80.0 against 79.6, 96.7, 94.6 | the same: it gives up a lot on reasoning and maths |
| Generation with MTP on, RTX 3080 12 GB, 32k context | 41.2 to **66.2 tok/s**, draft acceptance 62 to 96% | Kujira, six prompts, temperature 0 |
| VRAM at 32k context | 10.3 GB without MTP, 11.5 GB with | Kujira |

Every figure is the author's, on one test set or one machine. The card itself says 120 tasks "is a modest test". None is ours.

## Why it is worth a look

- **Size.** 8.35 GB leaves most of a 24 GB card for the KV cache. The 27B profile's carried-over bound for the KV cache is about
  0.027 MiB per token at q4_0 (a bound, not a measurement); on that figure a 24 GB card would not be limited by memory below the
  model's own maximum context, which is the limit Swift hit near 200k on the 4090. Unmeasured.
- **A speed claim on a card we can hold.** The 4090 runs Swift 1.5 at about 81 tok/s decode and this would be a smaller model on the
  same engine.
- **Tool calling is what it was tuned for**, and tool-call failures are where our stacks lose whole stories.

## Why to be careful

1. **Two bits is untested here.** The owner's hypothesis was that 4-bit is a floor below which a model is not good enough; the only
   lower-bit test so far does not support it. The 3-bit llama.cpp arm of Flash-Next (`v2-iq3xxs-r1`, one run, on the M5 Max) scored
   **68/75** (score of record), against 69, 70, 72 and 72 for ddalcu's 4/8-bit mlx-serve runs and a median of 66 for Swift 1.5. One run, a
   different engine and a different quantisation family, so it neither confirms nor refutes the hypothesis for 2 bits. What the
   card's own table does show is where the loss is: reasoning and maths (AIME 2025 79 against 97, MuSR 68 against 80), not tool calling.
2. **The speed figure is greedy.** Kujira measured at temperature 0. The same effect cost us a comparison on gufo: speculative
   acceptance falls when the sampler is the model card's (ours is temperature 1.0, top-p 0.95, top-k 20), so **no figure on the card
   predicts ours**, and the card says the output is not bit-identical at temperature 0 either.
3. **A head and a trunk that did not train together.** The MTP head is the base model's, and the trunk was re-quantised and tuned.
   Acceptance may be lower than with a matched head. The card reports 62 to 96%, again at temperature 0.
4. **Very new.** Both uploads are a day old and unreviewed. Pin the file by revision and checksum before anything runs.
5. **A different lineage from Swift 1.5.** A difference in score from Swift or the base 27B is the quantisation and the tuning together,
   not one of them.

## Checks before a run

In this order; none has been done.

1. Download the file and **verify its sha256** against the card; record the revision.
2. Serve it on the 4090 at 131,072 tokens with our own sampler set explicitly, and read the resident memory.
3. **MTP under our sampler:** measure draft acceptance and decode speed at temperature 1.0 on a long prompt. This is the figure
   that decides whether MTP is worth it for us.
4. The capability probe (`tools/engine-probe/basic-capability.py`): a tool call with arguments that carry raw newlines, and a large one.
5. Prompt reuse at depth, and the long-context check (`tools/engine-probe/long-context.py`), beyond 131k if the claim above is to be tested.
6. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

- A third 27B on the same card: base Qwen3.8-27B (Q4_K_M), Swift 1.5 (Q4_K_M) and this (2-bit). The comparison is quantisation and
  tuning together.
- The llama.cpp build moves; the series is for one build, recorded in each run.
- If the context is raised past 131k for this arm only, that is a second variable and needs its own series.

**Licence:** Apache 2.0 for both files (a fact, not a gate).
**Last checked:** 8 Oct 2026, from both model cards and the Hugging Face API, not from running it.
**Recheck when:** the checks above are done, or either upload changes.
