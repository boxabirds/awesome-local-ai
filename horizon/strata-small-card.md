# Strata on a small card: does the floor for a useful coding agent drop?

**Status:** open question, nothing scheduled (4 Oct 2026). We own no machine of this shape, so it cannot be run
here as it stands. **Most of it can be answered without one** — see "What our own runs will settle".
**Follows on from:** [Strata](strata.md), where the engine, the pack and the harness work are recorded.

## The claim being tested

The owner's guidance so far, given to other people: the floor for a useful local coding agent is **128 GB of shared
memory** (for Qwen3.8 Flash-Next) or **24 GB of dedicated VRAM** (for a 27B dense model). Strata's design puts that
in question, because it does not need the model to fit in VRAM: the busiest experts sit on the card, the rest live
in system RAM and cross PCIe on a miss.

If that holds for real agent work, the floor becomes roughly **a 12 GB card with 64 GB of system RAM and an NVMe
SSD** — hardware that costs a fraction of either configuration above.

## The configuration

| | |
|---|---|
| GPU | NVIDIA RTX 20/30/40/50 series, **12 GB VRAM or more** ("8 GB runs, slowly"). Several 30-series cards are 8 or 10 GB and fall under that line; check the card, not the family. AMD RX 7900 XT/XTX, RX 9070/9070 XT and others, also 12 GB and up |
| System RAM | **RAM decides the quantisation, not the card**: 32 GB the Coder only, 48 GB IQ2_XS or Q2_0, **64 GB IQ3_XXS or IQ3_S**, 96 GB+ IQ3_S or UD-IQ4_XS |
| Disk | 70-80 GB for the model and ~6 GB for the MTP layer; NVMe strongly recommended |
| Engine, model, client | as [our combination](../combinations/qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi/) pins them: Strata by commit, `ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF`, pi, 131,072 context, `--kv int8`, `--spec 4`, MTP draft layer |

## What the project publishes for it (not ours)

An RTX 5070 (12 GB) with 64 GB of RAM, from `docs/MODELS.md`:

| Size | short chat | **at 128K context** | prompt |
|---|---:|---:|---:|
| Q2_0 | 94 tok/s | 76 tok/s | 2,650 tok/s |
| IQ2_XS | 79 tok/s | 63 tok/s | 2,090 tok/s |
| **IQ3_XXS** | 62 tok/s | **49 tok/s** | 1,750 tok/s |
| IQ3_S | 53 tok/s | 46 tok/s | 1,620 tok/s |

The fall from a short chat to 128K is 20 to 30%, and the same pattern holds on their AMD machine. These are the
project's own measurements, not ours.

## What our own runs will settle, without this hardware

The five Strata runs already queued on the RTX 4090 use **the same model and the same IQ3_XXS pack** as this
configuration would. So they answer the half that matters most:

- **Quality is shared.** A held-out score from the 4090 series is a score for IQ3_XXS Flash-Next under pi. If it
  scores badly there, this configuration is dead whatever its speed, and the floor does not move.
- **Speed is not shared.** A 24 GB card caches far more experts than a 12 GB one, so our tok/s will not transfer.
  For that half, the project's table above is the only evidence, and the earlier analysis in [Strata](strata.md)
  shows those figures depend on how tightly the workload routes — which a coding agent carrying 128k of mixed
  context may not do.

So: **wait for the 4090 series before revising any public guidance.** If the quality holds, the remaining question
is narrow and can be put to someone who owns a 12 GB card.

## What would need a machine we don't have

Only the speed half, and only if quality passes: a 12 GB card with 64 GB of RAM, running one story at 131,072
context, with the expert cache hit rate and PCIe miss share captured from `/metrics` beside it.

**Last checked:** 4 Oct 2026 (Strata's README, `docs/INSTALL.md` and `docs/MODELS.md`; nothing run).
**Recheck when:** the first Strata story is scored on the RTX 4090.
