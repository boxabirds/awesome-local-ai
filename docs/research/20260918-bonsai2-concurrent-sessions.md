# How many concurrent coding sessions can Bonsai 2 27B serve? (2026-09-18)

> **A 4090 fits five 128k sessions in 22.4 GB and is limited by compute, not
> memory. An M5 Max is limited by neither in the way you would expect — once a
> session is warm, a turn costs about 40 seconds and prefill has almost stopped
> mattering.** Two assumptions carry the whole estimate and neither is measured
> yet; they are named at the bottom.

This models steady-state coding sessions, not first turns: a session prefills
once at the start and afterwards only processes the delta — the user's message,
the model's last answer, the occasional file read. Context is sized at **128k
allocated, 64k used**, on the basis that 128k is the minimum viable window for
agentic work and half-full is the honest average.

## Inputs, and where each comes from

Provenance matters more than the numbers here, because half of them are
derived. Nothing below is a vendor claim.

| Input | Value | Provenance |
|---|---|---|
| 4090 decode, depth 0 / 32k / 128k | 92.2 / 76.0 / 49.9 tok/s | **measured**, `llama-bench`, PQ2_0 |
| 4090 prefill pp512 | 3,239 tok/s | **measured** |
| 4090 VRAM at 128k / 262k, q4_0 KV | 10,663 / 13,607 MiB | **measured** |
| M5 Max decode, depth 0 | 40.5 tok/s | **measured**, `apple-silicon-probe.sh` |
| M5 Max prefill pp512 | 244 tok/s | **measured** |
| M2 Air decode, sustained | 4.2 tok/s | **measured** |
| KV cost per token, q4_0 | 23.0 KiB | **derived** from the two 4090 VRAM points |
| Decode decay to 64k depth | ×0.73 | **derived** by interpolating the 4090 curve |
| M5 Max decode at 64k | ~29.5 tok/s | **extrapolated** — see caveat |

The M5 Max row is the weakest link: it applies the 4090's decay *shape* to a
different architecture. The probe measures depth decay only under `--only
depth`, which is opt-in because prefilling long contexts on Apple silicon costs
tens of minutes. Running it on the M5 Max would replace this with a measurement.

## The memory model

Two measured points give a linear model, and it holds:

```
total_MiB = 7,719 + ctx_tokens x 0.02246          (PQ2_0, q4_0 KV, incl. 463 MiB desktop)
```

| check | predicted | measured |
|---|---|---|
| 32,768 ctx | 8,455 | 8,454 |
| 262,144 ctx + vision | 14,457 | 14,459 |

Within 1 MiB on both. So capacity for one server with N slots of 128k each:

| sessions x 128k | RTX 4090 (24,047 MiB usable) |
|---|---|
| 1 | 10,663 ✓ |
| 2 | 13,607 ✓ |
| 3 | 16,551 ✓ |
| 4 | 19,495 ✓ |
| **5** | **22,438 ✓** |
| 6 | 25,382 ✗ |

**Five 128k sessions fit on a 24GB card.** On an M5 Max with 128 GB, roughly
thirty would fit; memory stops being a consideration entirely.

One slot shares the weights with every other, which is why this scales so much
better than running separate server processes — those pay for the 6.7 GB of
weights again each time, and two of them already need 20,860 MiB.

## Turn cost

A turn is taken as **1,500 tokens of incremental prefill + 1,000 tokens of
decode**, at 64k depth.

| | solo turn | prefill share |
|---|---|---|
| RTX 4090 | 15.4 s | 0.5 s (3%) |
| M5 Max | 40.0 s | 6.1 s (15%) |
| M2 Air | 6.3 min | 55.6 s (15%) |

**This is the finding that changes the earlier conclusions.** When every turn
was modelled as a cold 32k prefill, prefill dominated and the M5 Max looked
unusable at 2.4 minutes just to read the prompt. In steady state prefill is 3-15%
of the turn and decode is the whole story. The M5 Max goes from "not an agent"
to "a working assistant at 40 s a turn".

The M2 Air does not recover. At ~3 tok/s decode at depth, a thousand tokens is
five minutes no matter how warm the cache is.

## Concurrency

| | solo | 2 sessions | 4 sessions |
|---|---|---|---|
| **RTX 4090** | 15.4 s | 30.7 / **15.9** s | 61.5 / **16.9** s |
| **M5 Max** | 40.0 s | 80.0 / **46.1** s | 160 / **58.4** s |
| M2 Air | 6.3 min | 12.7 / 7.3 min | 25.3 / 9.1 min |

Left figure: throughput conserved, which is what separate processes give.
Right figure: decode batches across slots, so only prefill serialises.

**The gap between those two columns is the entire uncertainty** — 61.5 s against
16.9 s for four sessions on a 4090.

Best estimate pending measurement: **4090 comfortably four sessions and probably
five; M5 Max one to two; M2 Air none.**

## The two load-bearing assumptions

**1. That `-np N` batches decode.** Theory says it should: decode at batch 1 is
bandwidth-bound — the 4090 achieves 663 GB/s of its ~1,008 — so serving N slots
in one step reads the weights once and produces N tokens, and the 4090 has
compute to spare given it sustains 3,239 tok/s in prefill. The only concurrency
figure actually measured here used **two separate processes** (41.4 tok/s each
against 87.6 solo, aggregate flat), which is the architecture that cannot
amortise anything. It is the worst case, not the expected one.

**2. That prefix caching works at all.** The whole steady-state premise depends
on a warm session only reprocessing the delta.
[Bonsai-demo issue #147](https://github.com/PrismML-Eng/Bonsai-demo/issues/147)
reports an RTX 4090 sending an identical 14k prompt twice and getting
`cached_tokens: 0` both times with `cache_prompt: true` set, and `--cache-reuse`
reporting itself unsupported. That was the previous ternary model with the
multimodal projector loaded, and this combination's default profile has vision
off — so it may not apply. If it does, every number in the concurrency table
reverts to the cold-prefill case and the M5 Max verdict reverts with it.

## How to settle both

On the 24GB combination, roughly 25 minutes:

- one server at `-np 1`, `-np 2`, `-np 4`, same prompt, recording aggregate and
  per-session decode rates
- the same ~14k prompt sent twice to a warm slot, reading `cached_tokens` and
  the prompt-eval time from the second response

Until then this is an estimate with its arithmetic shown, not a measurement.
