# HyperQwen: Qwen3.8-27B on one 24 GB card with vLLM

**Status:** candidate (8 Oct 2026). Added at the owner's request. Not installed, not run; read from the README, `docs/quality.md`,
`docs/clients.md` and the repository metadata.
**Kind:** a **new engine for us (vLLM)** on a model we already run (Qwen3.8-27B), with the project's own 4-bit requantisation. A new
combination if it runs.
**Where it could run:** the RTX 4090 machine (Ubuntu), against the base 27B (llama.cpp, one run, 68/75), Swift 1.5 and the
[Underdog Saluki](underdog-saluki.md) candidate on the same card. It is also the origin of several of the techniques in
[mirai-s-ada](mirai-s-ada.md).

## What it is

[syv-ai/HyperQwen](https://github.com/syv-ai/HyperQwen) (Apache 2.0, created 15 Aug 2026, about 1,900 stars, pushed 8 Oct 2026) is
"a patch series against a pinned vLLM plus a model-preparation pipeline": vLLM 0.30.0 with its own patches, a Docker image
(`ghcr.io/syv-ai/hyperqwen`, 9.5 GB) that **requantises Qwen3.8-27B on first start (about 20 GB of output)**, int8 tensor-core GEMMs,
a calibrated 40,000-token draft vocabulary, MTP speculation (7 drafts proposed per pass), a DFlash2 drafter that drafts out of the
prompt, and a "KVarN" 4-bit and 2-bit KV cache for long windows. It ships as ready-made modes, chosen by a few lines of `.env`:

| Mode | Setting | What the README says it gives (RTX 3090 at 250 W) |
|---|---|---|
| A batch | `--profile batch` | about 1,035 tok/s aggregate at 64 concurrent |
| B single, default | `--profile single` | 127 tok/s single stream, 64k context |
| C reproduction | `DFLASH_TOKENS=15` | 381 tok/s while the answer quotes the prompt, 4 slots, 56k |
| **D long context** | `SPEC=mtp CTX=long` | **150k context, about 95 to 100 tok/s** |
| **E huge context** | `CTX=huge` | **240k context, 67 tok/s mixed, 164 while quoting** |

For an agent on one 24 GB card, **D and E are the modes that matter**: they are the ones that answer the question about a bigger window
on a card Swift tops out on near 200k.

**Its relation to mirai-s-ada.** The owner's reading is that Mirai is a mix of HyperQwen. Mirai's own document
(`docs/HYPERQWEN.md`, 8 Oct 2026) says something narrower: it **read HyperQwen's list of speed techniques and tested each**, adopting
a few (drafting from text already in the context, an SSE keep-alive, int8 activations for prefill, a smaller draft head) and
rejecting others (the calibrated draft vocabulary, the 4/2-bit KV cache) on its own measurements. So ideas, ported to a llama.cpp
fork, not shared code.

## What the project claims, and whose figures they are

Every figure is the project's, on **one RTX 3090 at 250 W, shared with training jobs** (its own words). None is ours, none is for a 4090.

- **Speed:** the table above. The 381 and 164 tok/s figures need the output to repeat the prompt (code edits, rewrites); normal
  generation is the 127, 95 to 100 and 67 figures.
- **Quality of the 4-bit stack** (`docs/quality.md`, thinking on, the model's default sampling): IFBench strict, prompt-level
  **78.3** against 79.5 for Qwen's unquantised model, "about one point"; perplexity up 0.9 to 3.7% depending on how many layers use int8
  activations (the default is +2.2%, mostly on code); GSM8K 95.0 to 95.5% on 200 questions, greedy. Nothing on coding or tool calling.
- **Clients:** `docs/clients.md` documents pointing OpenCode at it. Nothing says what a coding agent's multi-turn behaviour is.

## Why it is worth a look

- **Speed.** 127 tok/s single stream on a 3090, against about 62 for the base 27B and about 81 for Swift on our llama.cpp 4090 runs.
  A newer, faster card should not be slower. If it holds under our sampler and an agent's turns, it halves a story's decode time.
- **Context.** 150k to 240k on 24 GB at the speeds above, if the KV cache's quality at 4 bits holds at those lengths (not measured by us).
- **A different quantisation of the base weights** at about 4 bits, close in size to what we run, so a score difference is mostly the
  engine and the stack, not the bit width.

## Why to be careful

1. **The checks that matter for an agent are not in the README.** vLLM on a hybrid (linear-attention) model such as Qwen3.8 does not
   necessarily reuse a cached prompt prefix across turns; if it re-reads the whole history each turn, a long agent session costs far more
   than the speeds above suggest. The README does not say. This is the first thing to measure.
2. **Tool-call parsing is vLLM's** (a parser for the Qwen format), not llama.cpp's. The failure we keep meeting, a tool call whose
   arguments carry raw newlines, has to be tested here too.
3. **The requantisation is the project's own**, done at first start from the base weights, so the exact weights depend on its pipeline
   at the pinned commit. Pin the image by digest and record how the weights were produced.
4. **The speed figures are single stream, greedy-friendly speculation.** Our sampler is temperature 1.0. DFlash2 and MTP acceptance both
   fall with sampling (the effect that cost the gufo comparison), and the 381 and 164 figures need repeated text.
5. **A heavily patched vLLM at one pinned version** (0.30.0); the README says it has open speculation faults on another card family
   and that "every row for any other card came from someone else". 4090 (sm89) is not among the tested rows it lists.
6. **Containers and WSL2.** The project's own docs assume Docker, with a WSL2 4090 page; our nodes run Linux with Podman or plain
   processes, so how it is run (and sandboxed) is a decision.

## Checks before a run

In this order; none has been done.

1. Pull the image by digest, record it, and start mode **D** on the 4090 with the sampler set explicitly. Read the VRAM and the log.
2. **Does the second request of a long conversation reuse the first's prompt?** Send a 60k-token prompt, then the same prompt plus a
   short addition, and compare the time to first token and the cached-token count. This decides whether vLLM is usable for an agent.
3. The capability probe (`tools/engine-probe/basic-capability.py`), including a tool call with arguments that carry raw newlines.
4. **Speed under our sampler on an agent-shaped prompt** (not a repeated one): decode tok/s and speculative acceptance at temperature 1.0
   (`tools/engine-probe/mtp-acceptance.py` reads llama.cpp's log; vLLM's metrics endpoint would need its own reader).
5. The long-context check (`tools/engine-probe/long-context.py`) at 120k and past it, in mode E, with quality read as well as memory.
6. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

- A different engine, a different 4-bit stack and different speculation from the llama.cpp 27B arms: a difference in score or speed is
  all three together.
- KV at 4 or 2 bits for the long modes: a second variable on long stories, which are where quality is lost first.
- Up to 8 request slots, one user: our harness runs one agent, so the batch figures do not apply.

**Licence:** Apache 2.0 (a fact, not a gate).
**Last checked:** 8 Oct 2026, from the README and two documents, not from running it.
**Recheck when:** check 2 (prefix reuse across turns) is answered, or a 4090 row appears in its field tests.
