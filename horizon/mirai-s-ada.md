# Mirai S 27B on a 12 GB card (mirai-s-ada)

**Status:** candidate (8 Oct 2026). Added at the owner's request, with the instruction to test it on the RTX 4090 with the card
artificially held to a 12 GB class. Not downloaded, not built, not run; read from the repository's README and the Hugging Face
metadata of the two model pages it builds on.
**Kind:** a different 2-bit quantisation family of Qwen3.8-27B (Mirai Labs' "trellis" codec), a custom llama.cpp fork to run it,
and a serving layer for small cards. A new combination if it runs.
**Where it could run:** the RTX 4090 machine (Ubuntu), against the base 27B, Swift 1.5 and the [Underdog Saluki](underdog-saluki.md)
candidate on the same card; and, through Mirai Labs' own `uzu` runtime, an Apple-silicon Mac (see the end).

## What it is

[mirai-s-ada](https://github.com/professorpalmer/mirai-s-ada) (Cary Palmer, MIT; created 6 Oct 2026, 57 stars) serves
[Qwen3.8-27B-S-experimental](https://huggingface.co/trymirai/Qwen3.8-27B-S-experimental) (Mirai Labs, Apache 2.0, "Mirai S":
2.4 bits per weight, 8.45 GB as safetensors) on one **RTX 4070 with 12 GB**. Three parts, by three people:

| Part | By | Notes |
|---|---|---|
| The model and its codec | Mirai Labs | Its card says "work in progress and the numbers here are not final", "treat anything measured with it as provisional" |
| A GGUF of it (`alesha-pro/Qwen3.8-27B-S-mirai-GGUF`, 11.17 GB) and a port of the codec to llama.cpp (new ggml types 90 to 93, CPU and CUDA kernels) | alesha-pro | The trellis codes are copied bit for bit; also publishes an "abliterated" refusal control vector, not needed here |
| The serve | Cary Palmer | A PrismML llama.cpp fork as the engine, a **tiered KV cache** (the full 262,144-token window at q8_0: about 58k positions in VRAM, the rest in pinned RAM), MTP drafting at every depth, "lookup drafting" in front of it, "harness-proofing" for clients that send `effort: "high"` or tiny output caps, and an **optional server-side layer** (exact API cards, an API check, a sandboxed Python tool) |

Several of its speed techniques were read from [HyperQwen](hyperqwen.md) and tested; it adopted some and rejected others (its own `docs/HYPERQWEN.md`). A Linux launcher (`start-server.sh`, by alesha-pro) was checked on Ubuntu 22.04 with an RTX 3090. The repository has no release
notes beyond three days of work, so it is very young and moving fast.

## What the README claims, and whose figures they are

All the author's, on one RTX 4070 12 GB, one slot, from 5 to 8 Oct 2026; none is ours.

| Claim | Figure |
|---|---|
| Context at q8_0 KV on 12 GB | 262,144 (against 64k for the reference fork) |
| Decode at 0 / 16k / 60k / 120k / 180k | 76.6 / 72.6 / 61.7 / 19.5 / 11.4 tok/s (it falls steeply once the cache spills past VRAM) |
| Prefill, 130k-token prompt | 639 tok/s |
| Rewriting a 150-line file at 130k | 84.9 tok/s with lookup drafting (20.1 without); new text unchanged |
| HumanEval 164, greedy | 158 |
| A "long exact-work suite" of 37 tasks, raw / through the layer | 18 / 28 |
| MTP draft acceptance on the 3090 (alesha-pro) | 71% without thinking, 65% with |

The suite and HumanEval figures are the author's own harness; HumanEval is greedy; the layer figures include a server-side tool
that the model would not have through a plain server.

## The test the owner asked for, and its limits

Run it on the 4090 with the card held to about 12 GB, to see whether the recipe works on a 12 GB class card without owning one.
The owner wrote "3070"; the README's card is a **4070**, and a retail 3070 has 8 GB, so this note takes the target to be a **12 GB
card of the 4070 class** unless told otherwise.

- **How to hold the card to 12 GB.** The 4090 has 24 GB and CUDA has no per-process cap, so the usual way is a **ballast**: a
  small CUDA process that allocates and holds about 12 GiB before the server starts, so the engine finds 12 GB free. The Linux
  script does not read free VRAM; the cache line is set by hand (`MIRAI_KV_VRAM_CELLS`, 44,000 on the 12 GB recipe). The ballast
  is then a check that the engine really stays inside 12 GB, as well as the limit.
- **What this tests:** whether it fits and works, that the tiered cache behaves past the VRAM line, correctness (greedy identity,
  tool calls), and acceptance under our sampler.
- **What it cannot test:** speed. The 4090 has about twice the memory bandwidth of a 4070 and a different PCIe link, so a 4090 held
  to 12 GB is faster everywhere and its spill-over behaviour past the VRAM line differs. No figure from it would predict a 12 GB card.

## Checks before a run

1. Build the engine on the 4090 box (the README says about 4 minutes on 32 threads); pin the repository and the engine submodule
   by commit and the GGUF by revision and sha256.
2. Serve at the README's recipe with the ballast in place, read the VRAM at load and over a long prompt, and confirm it stays
   within 12 GB.
3. Run the **raw** server only, not the layer: the layer adds tools the model would not otherwise have, so a score through it is a
   result about the layer. Record which one ran.
4. The capability probe (`tools/engine-probe/basic-capability.py`), including a tool call with raw newlines.
5. MTP acceptance and decode speed under our sampler (`tools/engine-probe/mtp-acceptance.py`): the README's are greedy or at
   temperature 0.
6. The long-context check past the VRAM line (`tools/engine-probe/long-context.py`), where the decode falls from 62 to 11 tok/s on
   the author's card.
7. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

- Another 2-bit 27B on the same card as Underdog Saluki, but a different codec, a different engine fork and a different draft head:
  a difference between them is all of those at once.
- A tiered cache keeps most of a long context in system RAM, so a story's speed depends on how much of it is past the VRAM line;
  the machine's RAM and PCIe become part of the result.
- The model's own card calls it provisional; the engine is a fork of a fork; the serve is days old.

## Also on Apple silicon

The model's card documents `uzu`, Mirai Labs' own prebuilt runtime, on macOS 26.4 or later with 24 GB or more ("fastest on M5"; 52
tok/s decoding code on an M5 Pro, by the card). That would put the same model on the M5 Max through a different engine. Not checked.

**Licence:** MIT for the serve; Apache 2.0 for the model and the GGUF (facts, not gates).
**Last checked:** 8 Oct 2026, from the README and the Hugging Face metadata, not from running it.
**Recheck when:** the owner confirms the 12 GB target, or the model card drops "experimental".
