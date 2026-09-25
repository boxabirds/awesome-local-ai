# Ternary Bonsai 2 27B — Ubuntu, 24GB NVIDIA, llama.cpp + OpenCode

A 27B-class coding model in **6.7 GB of weights**, leaving two thirds of a
24GB card unused.

```bash
./install.sh bonsai        # or: ./install-bonsai-2-27b-ubuntu-nvidia4090-llamacpp-opencode.sh
./start.sh
```

Measured on an RTX 4090 24GB / Ubuntu 22.04.5 / driver 580.159.03 / CUDA 12.3,
against PrismML fork build `5d80cff` (`prism-b10687`). Method and raw logs:
[benchmarks/](benchmarks/).

---

## What this is

[Bonsai 2 27B](https://huggingface.co/prism-ml/Ternary-Bonsai-2-27B-gguf) is
Qwen3.8-27B with its weights re-quantised to **ternary** values `{-1, 0, +1}`
with one FP16 scale per group of 128, in a Hadamard-rotated basis — about
**1.72 bits per weight**. The architecture is unchanged, so everything the
[Qwen combination](../../../../../../qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md)
established about this model's hybrid attention still holds. What changes is
size, speed, and the runtime it needs.

Publisher's benchmark claim, which this repo has **not** independently
verified: 84.78 average across 14 thinking-mode benchmarks, against 85.18 for
the UD-Q4_K_XL build this repo's Qwen combination installs, and 72.59 for a
conventional IQ2_XXS build at a larger footprint. That average conceals the
one result that matters most here — see [The agentic coding gap](#the-agentic-coding-gap).
What *was* verified here is everything below.

## Why you might want it

Against the Qwen3.8-27B UD-Q4_K_XL combination on the same card, same flags,
speculative decoding off on both sides:

| | Bonsai 2 (PQ2_0) | Qwen3.8-27B UD-Q4_K_XL |
|---|---|---|
| weights | **6.71 GiB** | 16.68 GiB |
| VRAM, 128k context | **10,663 MiB** | 22,398 MiB |
| free VRAM at 128k | **13,384 MiB** | 1,649 MiB |
| max context that fits | **262,144** | 163,840 |
| prefill | **3,016 tok/s** | 2,309 tok/s |
| decode @ depth 0 | **92.2 tok/s** | 46.1 tok/s |
| decode @ 32k | **76.0 tok/s** | 41.6 tok/s |
| decode @ 128k | **49.9 tok/s** | 32.4 tok/s |
| speculative decoding | none available | MTP, ~2x |

The Qwen combination reaches its ~92 tok/s headline *because* its MTP head
roughly doubles that 46.1. Bonsai 2 matches it with no drafter at all, and
beats it on prefill — which is what a coding agent spends most of its time
doing.

## Why you might not

- **It needs a fork.** Stock llama.cpp cannot read these files, so this
  combination tracks [PrismML-Eng/llama.cpp](https://github.com/PrismML-Eng/llama.cpp)
  `prism` instead of upstream master. That fork's ggml base was 0.21.0 when
  this was written, against mainline's 0.24.0. You are trading currency for
  the format.
- **No speculative decoding exists for it.** See below.
- **The quality claim is the publisher's.** This repo measured speed, memory
  and behaviour, not benchmark scores.
- **Agentic coding takes about a 25% hit.** The publisher's own report puts
  Bonsai 2 at roughly three quarters of full-precision Qwen3.8-27B on
  Terminal-Bench 2.1 and SWE-bench Verified. This is the cost that the
  headline average hides: [The agentic coding gap](#the-agentic-coding-gap).
- **Reasoning is expensive by default.** The model defaults to `xhigh`; this
  combination ships `medium`.

## The agentic coding gap

The publisher's own whitepaper is where this combination's cost shows up.
It is worth quoting at length, because the fourteen-benchmark average above
does not show it at all:

> Long-context and coding performance. This release also delivers on the
> roadmap set out in our initial Bonsai 27B release [2], where we identified
> long-horizon, tool-driven software engineering as the next major capability
> to improve. With Ternary Bonsai 2 27B, that progress now shows up directly
> in agentic performance. Evaluated for the first time on Terminal-Bench 2.1
> and SWE-bench Verified, the Ternary Bonsai 2 27B reaches 52.8 and 60.8,
> respectively, compared with 69.7 and 80.6 for Qwen 3.8-27B, retaining
> roughly three quarters of the full-precision performance on both benchmarks.

— [Ternary Bonsai 2 27B whitepaper](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/bonsai-2-27b-whitepaper.pdf),
*Long-context and coding performance*.

| | Bonsai 2 27B | Qwen3.8-27B | retained |
|---|---|---|---|
| Terminal-Bench 2.1 | 52.8 | 69.7 | 76% |
| SWE-bench Verified | 60.8 | 80.6 | 75% |
| 14-benchmark thinking average | 84.78 | 85.18 | 99.5% |

Read the last row against the first two. An average over fourteen benchmarks
says the ternary weights cost essentially nothing. The two benchmarks that
measure long-horizon, tool-driven software engineering say they cost a
quarter. This repo exists for coding agents, so the second reading is the one
that applies here — and it is the publisher's own number, offered as progress
rather than buried.

Two things that stop this being a verdict:

- **The baseline is full-precision Qwen3.8-27B**, not the UD-Q4_K_XL build the
  [Qwen combination](../../../../../../qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md)
  actually installs on this card. That build is itself quantised, so the gap
  against what you would really be running is smaller than these figures by an
  amount nobody here has measured.
- **Neither side was verified here.** Like every score on this page, these are
  the publisher's numbers, on the publisher's harness. This repo measured
  speed, memory and behaviour.

What it does not change: every speed and footprint figure above was measured
here and still stands. What it changes is the framing. This is not "the same
model at a third of the size" — it is a trade with a price that is now visible
on the axis this repo cares about: 2.1x the decode rate and 13 GB of headroom,
against roughly three quarters of the agentic coding ability.

## Speculative decoding: a measured negative result

Bonsai 2 ships no drafter. Because the architecture is unchanged, the
Qwen3.8-27B MTP head this repo already downloads can be pointed at it, and it
genuinely works — **0.62 draft acceptance**, measured. It also made generation
**slower**: 95.8 → 92.6 tok/s.

That is the interesting part. Speculative decoding is a bet that drafting is
cheap relative to the target. At 1.72 bits/weight the target is so cheap that a
1.6 GiB drafter no longer pays for itself. The same trick is worth ~2x on the
Qwen combination, whose target is 2.5x larger.

Two third-party drafters for Bonsai 2 appeared within a day of the model
(`ProCreations/Ternary-Bonsai-2-27B-MTP`, `...-DFlash2`). Both require a
further patch on top of this fork and ship prebuilt binaries for sm120;
neither was tested here.

## Multiple sessions on one card

The obvious thing to do with 13 GB of spare VRAM. Measured, two independent
servers at `PROFILE=coding` (128k context each):

| | VRAM | decode |
|---|---|---|
| one server | 10,663 MiB | 87.6 tok/s |
| two servers | 20,860 MiB (3,187 free) | **41.4 tok/s each** |

Both serve correctly. But aggregate throughput is flat — you are dividing one
GPU, not multiplying it. Memory has stopped being the constraint and compute
has become one. For concurrency rather than isolation, one server with `NP=2`
loads the weights once instead of twice.

## Profiles

See [profiles.tsv](profiles.tsv) and `bonsai2-27b-server --help`. Six profiles,
from `dual` (32k, 8,454 MiB, sized so two fit on one card) to `vision-max`
(262k with images, 14,459 MiB).

## Packings

Two packings of the same ternary weights ship in one repo:

| | bits/weight | size | prefill | decode @ d0 |
|---|---|---|---|---|
| `PQ2_0` (default) | 2.13 | 6.71 GiB | 3,016 tok/s | 92.2 tok/s |
| `PTQ1_0` | 1.75 | 5.54 GiB | 1,597 tok/s | 98.5 tok/s |

PTQ1_0 decodes ~6% faster on this Ada-generation card — as the model card
predicts — and prefills at half the rate. PQ2_0 is the default because coding
agents read more than they write. `PACKING=PTQ1_0 ./install-...sh` to switch.

## Known-unknowns

Things this combination does *not* claim, listed so nobody mistakes silence
for evidence:

- `bf16` KV is absent from `SAFE_KV_TYPES` because it was not measured, not
  because it is known bad.
- Retrieval quality at 262k was not measured. The context *fits*; whether the
  model uses it well is a separate question, and
  [`benchmarks/perf/run-niah.sh`](../../../../../../../benchmarks/perf/run-niah.sh) is the
  instrument.
- No smaller card was tested. The footprints say a 12GB card should hold the
  `coding` profile; nobody has run it.
