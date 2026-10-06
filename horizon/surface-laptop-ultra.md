# Surface Laptop Ultra (NVIDIA RTX Spark): which combination per memory tier

**Status:** open question, we own none (6 Oct 2026). Not a combination and not schedulable: a combination is
something installable on a machine we have, with profiles measured on it. This note exists so that the day one
arrives the choice is already reasoned and only has to be checked.

**A caveat on every fact below.** These specifications come from press reporting around the announcement, some
of it published *before* the event. Treat the numbers as reported, not confirmed, and re-read this note against
Microsoft's and NVIDIA's own pages before acting on it.

## What it is

A Windows-on-Arm laptop built on NVIDIA's **RTX Spark** SoC: 18 or 20 Arm CPU cores with a **Blackwell** GPU
(5,120 or 6,144 CUDA cores), **unified LPDDR5X at up to 300 GB/s**, in configurations reported from **24 GB** up
to **128 GB**. The vendor claim is about 1 petaflop of AI compute and models "up to 120B parameters" locally.

- [Tom's Hardware](https://www.tomshardware.com/laptops/microsoft-surface-laptop-ultra-weilds-nvidias-rtx-spark-superchip-with-128gb-of-ram-20-arm-cpu-cores-and-a-blackwell-gpu-15-inch-mini-led-pixelsense-ultra-display-rounds-out-the-powerful-package)
- [VideoCardz: 18-core RTX Spark, 24 GB entry](https://videocardz.com/newz/surface-laptop-ultra-reportedly-starts-with-18-core-rtx-spark-and-24gb-unified-memory)
- [WindowsReport: up to 128 GB, 20-core](https://windowsreport.com/microsoft-surface-laptop-ultra-specs-detailed-up-to-128gb-ram-and-20-core-rtx-spark-soc/)

## Capacity and speed are different axes

The tiers share one memory system, so **a 64 GB variant runs a given model at the same speed as the 128 GB one**.
Capacity decides which quantisation fits; bandwidth decides how fast it decodes. A smaller tier is not slower —
it is pushed onto a smaller quant, and that is a quality problem.

Bandwidth is not the constraint here. Measured decode throughput from our own warehouse (`requests.decode_tok_s`,
averaged per machine; mlx-serve's maximum is a parser artefact and is not quoted):

| Our machine | avg decode tok/s | requests |
|---|---|---|
| llama.cpp, RTX 4090, dense 27B | 89.9 | 21,784 |
| mlx-serve, M5 Max 128 GB, Flash-Next | 70.8 | 28,742 |
| **gufo, Strix Halo 128 GB, Flash-Next** | **45.9** | 24,937 |
| Strata 3-bit, RTX 4090, Flash-Next | 30.6 | 2,300 |

The Strix Halo box is a unified-memory machine of roughly 256 GB/s and averages 45.9 tok/s, and it is the one
currently scoring 56 of 57 through nine stories. **300 GB/s is more than that**, so a Flash-Next-class model here
should decode at least as fast as a stack already judged usable.

## The tiers, against what we have measured

| Tier | What fits | What our own runs say |
|---|---|---|
| **128 GB** | **Qwen3.8-Flash-Next at 4-bit** | The strongest thing we run. Proven on two unrelated 128 GB machines: mlx-serve on the M5 Max finished at **72/75**, and gufo on the Strix Halo box is at 56/57 with three stories left. Measured peak GPU memory for the gufo profile is **87,849 MiB**, so it needs the 128 GB tier and nothing less |
| **64 GB** (if it exists) | Flash-Next does **not** fit at 4-bit. Either a dense 27B at 4-bit, or Flash-Next at 3-bit | **This is the interesting tier.** Our Strata arm runs Flash-Next at 3-bit and scored **0 of 29** on the stories that followed a completed story. The evidence so far says prefer a smaller model at a good quant over a large one at a bad quant |
| **24 GB** (reported entry) | A dense 27B at 4-bit, about 16 GiB | We have real runs of this shape on the RTX 4090. It is the honest floor, not a compromise |

**The 64 GB question is the one worth answering, and we are already answering it** on hardware we own: is a 27B
dense at 4-bit better than a 125B MoE at 3-bit in the same memory? If that holds, it is a recommendation for
every mid-memory machine, not just this one.

## NVFP4

Blackwell supports **NVFP4** natively, and a 4-bit float holds fidelity better than a 4-bit integer at the same
size. Neither of our 128 GB machines has it — the M5 Max is Metal/MLX and the Strix Halo box is RDNA — so this
would be the first stack here that could use it, and it is a reasonable hope that it narrows the gap between
4-bit and 8-bit at no extra memory.

**It is a hope, not a plan.** Every quantisation we run is GGUF or MLX. Whether an NVFP4 build of Flash-Next
exists at all, and whether anything that can serve it runs on this platform, is unchecked.

## Checks before any of this means anything

In this order, because each makes the next worth doing.

1. **The real SKU list.** The tiers in this note are reported, and one of them may not exist: the entry is
   reported at **24 GB, not 32**, and nothing found confirms a **64 GB** variant. The 64 GB tier carries the
   interesting question, so its existence decides whether that question is about this machine or only about
   machines in general.
2. **Does any engine we run work on Windows on Arm with a Blackwell GPU?** This is the gate, and it is about the
   engine, not the model. Unchecked: whether llama.cpp's CUDA backend builds for ARM64 Windows, whether
   TensorRT-LLM ships for it, what NVIDIA's own stack for RTX Spark is, and whether any of them serves an
   OpenAI-compatible API with **tool calls**, which the pack requires.
3. **Do NVFP4 weights exist for a model we benchmark?** If not, the tier recommendations stand but the NVFP4
   advantage is theoretical.
4. **Windows.** The RTX 4090 machine dual-boots and our Windows path is still unproven (see
   [NInfer](ninfer.md), queued on exactly that). A Windows-only machine inherits that whole problem.
5. Then, and only then, a capability probe (`tools/engine-probe/basic-capability.py`) before any series.

## Confounds

- **A different operating system and a different CPU architecture** from every machine we run. A result here
  would differ from our others on the OS, the architecture, the engine and possibly the quantisation format at
  once — so it would describe this stack, and say little about Blackwell, NVFP4 or Qwen in general.
- **Thermals in a laptop under 18 mm.** Our benchmarks run for hours; every other machine here is a desktop or a
  large portable. Sustained throughput is the figure that matters and a thin laptop is where it is least likely
  to match a burst.
- Reported figures throughout, as said above.

**Last checked:** 6 Oct 2026, from press reporting and our own warehouse. **Recheck when:** Microsoft and NVIDIA
publish their own specifications (the SKU list especially), or an engine we run announces Windows-on-Arm Blackwell
support.
