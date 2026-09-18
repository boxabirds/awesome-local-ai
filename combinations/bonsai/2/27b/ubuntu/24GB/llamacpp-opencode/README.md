# Ternary Bonsai 2 27B — Ubuntu, 24GB NVIDIA, llama.cpp + OpenCode

A 27B-class coding model in **6.7 GB of weights**, leaving two thirds of a
24GB card unused.

```bash
./install.sh bonsai        # or: ./install-bonsai-2-27b-ubuntu-24GB-llamacpp-opencode.sh
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
[Qwen combination](../../../../../../qwen/3.8/27b/ubuntu/24GB/llamacpp-opencode/README.md)
established about this model's hybrid attention still holds. What changes is
size, speed, and the runtime it needs.

Publisher's benchmark claim, which this repo has **not** independently
verified: 84.78 average across 14 thinking-mode benchmarks, against 85.18 for
the UD-Q4_K_XL build this repo's Qwen combination installs, and 72.59 for a
conventional IQ2_XXS build at a larger footprint. What *was* verified here is
everything below.

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
- **Reasoning is expensive by default.** The model defaults to `xhigh`; this
  combination ships `medium`.

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
- Whether `low` reasoning effort really behaves like `xhigh` (the card says so)
  was not established — one prompt at temperature 1.0 suggested otherwise,
  which proves nothing. Run [`benchmarks/effort.sh`](../../../../../../../benchmarks/effort.sh).
- Retrieval quality at 262k was not measured. The context *fits*; whether the
  model uses it well is a separate question, and
  [`benchmarks/run-niah.sh`](../../../../../../../benchmarks/run-niah.sh) is the
  instrument.
- No smaller card was tested. The footprints say a 12GB card should hold the
  `coding` profile; nobody has run it.
