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

## A reference build, and why it is shaped oddly

**The CPU computes a share of the experts**, it does not merely feed the card: `docs/INSTALL.md` says "the CPU's
share of the experts runs on its kernels". What that needs, in the project's own words: "x86-64 with AVX2 (any
Intel/AMD desktop CPU from the last ~8 years). **AVX-512 (Ryzen 7000/9000) is a bit faster.** Older CPUs without
AVX2 are experimental and slow."

So **AVX2 is the line, and AVX-512 is a bonus, not a requirement.** The one number the project publishes here is
for CPUs *below* AVX2: on a Ryzen 5 7600 with an RTX 5070 (expert cache held at 1,500 slots, greedy decode), forcing
the older paths took 26 tok/s down to 11-17 on AVX and 3.5-3.8 on SSE4.2. **That gap is AVX2 against AVX, not AVX2
against AVX-512**, and must not be read as the cost of choosing an Intel desktop CPU. The only AVX-512-specific
thing documented is the Q2_0 pack's fast CPU kernel, which also writes a one-time ~40 GB copy of its experts.

| | Pick | Why |
|---|---|---|
| CPU | Any desktop CPU of the last ~8 years with **AVX2**; the project's own machine is a **Ryzen 5 7600**, six cores | Core count is not the thing. AVX-512 (Ryzen 7000/9000) is "a bit faster" and unlocks the Q2_0 fast kernel; an Intel desktop part without it is supported and normal |
| RAM | **64 GB minimum, 96 to 128 GB comfortable**, the fastest DDR5 the board runs | The experts live here and the CPU computes on them, so bandwidth is on the critical path |
| GPU | The most VRAM affordable, on **x16 lanes**; 16 GB over 12 | VRAM is the expert cache, and every miss crosses PCIe |
| Disk | 1 TB **NVMe** | 70-92 GB of model plus ~6 GB of MTP layer, read per token, beside the agent's workspace |

The striking part is that the expensive component is **RAM, not the graphics card or the CPU**: six cores and
AVX2 are enough, and 64 GB "runs every size". For the same reason the
gaming hierarchy can invert between cards — what matters is how many experts fit, so a 16 GB card one tier down
should beat a 12 GB card one tier up.

**How much system RAM, precisely.** Our own measurement on the RTX 4090 is the only agent-shaped evidence: the
engine was resident at **42.7 to 43.5 GiB** at 131,072 context, on a 62 GB machine that also ran the agent, Node,
browsers and test servers. Our combination guards at a 50 GB minimum. So 64 GB carries IQ3_XXS with little slack,
and 96 GB or more buys both the better packs and page cache for the model file, which is where the misses are
served from.

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

Card and CPU model numbers above are from the project's documentation where it names them (the Ryzen 5 7600 and the
RTX 5070 are its own machines). The VRAM of any particular card, and its PCIe lane count, are not stated there and
should be checked before anything is bought on the strength of this note.

**Last checked:** 4 Oct 2026 (Strata's README, `docs/INSTALL.md` and `docs/MODELS.md`; nothing run).
**Recheck when:** the first Strata story is scored on the RTX 4090.
