# Project Maya: GLM-5.3-Flash (321B MoE) on one or two NVIDIA cards, built on Strata

**Status:** candidate (8 Oct 2026). Added at the owner's request. Not run, not installed, read from the project's README and
repository metadata only.
**Kind:** a new engine on a **new model family**, so a new combination if it runs, and not comparable with the Qwen
stacks except by outcome.
**Follows on from:** [Strata](strata.md), whose engine it started from.
**Where it could run:** the RTX 4090 machine on Ubuntu (24 GB card, 62 GB of RAM, NVMe), the same box as our Strata arm.

## What it is

[Project Maya](https://github.com/mw00/project-maya) is an inference engine, server and dashboard for **GLM-5.3-Flash**
(zai-org; the README says MIT licence): a mixture-of-experts model with 321 B parameters, about 18 B active per token,
and a context of up to 1 M tokens. Like Strata it keeps the most-used experts on the card(s), the next ones in RAM and the
rest on the NVMe SSD, and moves them as the conversation needs them. C++, with a Python installer (`./setup.sh`). It
serves an OpenAI-compatible API (`/v1`) and Anthropic's (`/v1/messages`), with thinking levels off, low, medium or high
and a 32K cap on a reasoning block.

**Its relation to Strata.** The README says it "grew out of" [Strata](https://github.com/Niko1221/Strata) (MIT): the
engine started from Strata's and was rewritten for GLM-5.3-Flash (expert tiers across VRAM, RAM and SSD, a two-GPU split,
MTP decoding), and the server and dashboard started from Strata's. GitHub does not mark it as a fork (no parent is
recorded), and the repository was created on 6 Oct 2026, so it is a young project: all its commits that I could read are
from 7 Oct. About 47 stars. The licence is MIT, with Strata's and ggml's notices kept.

**Its own quant, Maya-S.** 96.5 GB, made from Z.ai's FP8 release, published on Hugging Face as
`peasantsmith/GLM-5.3-Flash-Maya-GGUF`, keeping the model's MTP block. The README claims it keeps 97.9% of the FP8
model's accuracy on five zero-shot tasks (400 questions each) and picks the same next token as FP8 83% of the time. Those
are the project's figures on multiple-choice tasks, not on coding or agent work.

## What the README says that bears on us

| | |
|---|---|
| Measured speed | up to 40 tokens/s decode and 560 prefill, on **two Tesla V100 32 GB** with 30 GB RAM and one NVMe. "Single-GPU numbers are being measured." |
| Minimum | NVIDIA compute 7.0 or newer; **32 GB RAM** works; about **100 GB free on a fast NVMe**; Linux x86-64 with AVX2; CUDA 12.x |
| Context | 8k, 32k (default), 64k or 131k selectable |
| Concurrency | one request at a time |
| Warm-up | the first answers are the slowest while the expert caches fill |

Our 4090 box has one 24 GB card, which is not what they measured, and a 96.5 GB model against 62 GB of RAM means a good part
of the experts are read from the SSD while it answers. That is the same shape as our Strata arm, so there is a baseline for
how much that costs, but no figure for this model.

## Checks before a run

In this order. None has been done.

1. **Does it install and serve on the 4090 box at 131,072 tokens?** The context our agent needs; their menu tops out at
   131k, so the fit is tight. A ten-minute check: start it, send one long prompt, read GPU memory, RAM and swap. The
   harness's machine guard stops a story at +4 GB of swap or under 8% free memory.
2. **A tool call with arguments that carry raw newlines, and a large one**, with `tools/engine-probe/basic-capability.py`.
   The plumbing half decides, so a failure is the engine and not the model.
3. **Prompt reuse at depth.** A second request on a 100k-token conversation must report a cached prefix. Their README
   does not mention prefix caching; the project may not have it, which would end the idea for an agent that re-sends a long
   history every turn.
4. **The speed on one card.** Whatever prefill and decode it gives at depth, against Strata's on the same box, because a
   story's wall-clock time is bounded.
5. **Whether pi's tool-call format survives GLM's template** over the compatible API, and what sampling the server applies
   (set our own explicitly and confirm).
6. **A version pin**: a commit, since the project is days old and moving.
7. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

- **A different model, not a different engine.** A score difference to the Qwen stacks is mostly GLM-5.3-Flash against
  Qwen3.8, and cannot be attributed to the engine.
- **A project-specific quant.** Maya-S is the project's own 96.5 GB quant of FP8, with its quality figures measured on
  multiple-choice tasks only.
- **A very young engine.** Created two days ago; expect fast change and unfound faults. Results are for one commit.
- **RAM-bound.** At 62 GB the SSD carries a large share of expert reads, so speed depends on the disk and on how warm the
  cache is when a story begins.
- **Same box as Strata.** It cannot run at the same time as the Strata arm, so it competes for the machine.

## Why it is worth the check

It would show whether the Strata approach carries over to a larger, newer MoE on the same 24 GB card: a 321B-parameter
model on hardware that costs a fraction of our other stacks. If it holds on agent work, it extends the "floor for a useful
local agent" question in [Strata on a small card](strata-small-card.md) to a model with about two and a half times the parameters (321B against Flash-Next's 125B).

**Last checked:** 8 Oct 2026, from the README and repository metadata, not from running it.
**Recheck when:** check 1 is answered, or the project states a single-card figure or adds prefix caching.
