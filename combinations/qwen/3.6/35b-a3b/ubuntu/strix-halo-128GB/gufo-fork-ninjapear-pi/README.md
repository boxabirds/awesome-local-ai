# Qwen3.6-35B-A3B (Q6dense) · Strix Halo 128GB · NinjaPear's gufo fork · pi

A 3B-active mixture of experts on the Strix Halo box, served by a one-author fork of gufo built from source.

| | |
|---|---|
| Model | Qwen3.6-35B-A3B — 40 layers (30 Gated DeltaNet, 10 full attention), 256 experts with 8 routed plus one shared, **~3B active**, native one-layer MTP block |
| Quant | **Q6dense**: Q6_K dense trunk, routed experts as in Unsloth UD-Q4_K_XL, embeddings and the MTP block's dense weights Q8_0. 22,388,168,960 bytes |
| Engine | [NinjaPear/gufo-Qwen3.6-35B-A3B-Q6dense](https://github.com/NinjaPear/gufo-Qwen3.6-35B-A3B-Q6dense) at `d7e938e`, **built from source** |
| Context | 131,072 served; the model's native context is 262,144 |
| Client | pi |

## Why it is here

Not to beat Qwen3.8-Flash-Next. Two generations and 125B against 35B — it will not. The question is **where it
fails and whether anything can be done about it**, with
[the failure-mode classes](../../../../../../../benchmarks/docs/failure-modes.md) as the instrument. This is
their first use on a weaker *model* rather than a weaker quant.

The fork's author states the trade in the repository's own description: *"a fork of gufo to support Qwen 3.6 35B
A3B for workloads that prioritizes speed over intelligence."*

## What was measured before any run

At load on 7 October 2026, from the engine's own lines: 15.8 s to load, `context_tokens=131072`,
`gpu_device_used_mib=35285` of 122,880, 103.5 tok/s decode, 49 of 68 drafted tokens accepted, 9 ms to first
token.

The capability probe (`tools/engine-probe/basic-capability.py`) passed **seven of seven**: generation, a
structured tool call, **a tool call whose arguments keep raw newlines**, a 120k-token prompt admitted, code that
runs and prints the right answer, **a mandated literal kept unchanged**, and context across turns. The newline
tool call matters particularly — that defect has ended stories on this engine family before, and the fork is
forty commits behind upstream including six further fixes for it.

## Three things that differ from the gufo Flash-Next combination

Not variations on a theme — this is why the backend is separate:

1. **`--mtp-model` is rejected.** The draft block is inside the same GGUF; there is no sidecar. The shared gufo
   launcher always passes one.
2. **No reasoning-effort control.** The template has none, so `REASONING_EFFORT` must stay `default`; the
   launcher refuses anything else rather than pass a flag that does nothing.
3. **No image.** The fork publishes none, so the engine is compiled here, against Ubuntu's ROCm 7.1 and gcc
   15.2 rather than the container's own ROCm.

## Reading a result from this combination

**Four things differ at once** from the gufo Flash-Next runs on the same machine: the model generation, the
active parameters, the quantisation scheme, and the engine build. The engine *version* is the same — the fork's
merge base with upstream is `2026-10-02T11:08:42Z`, gufo 0.5.0 to the minute, which this repository already pins
— but it lacks the forty commits since.

So a result here describes **this stack**. It says little on its own about Qwen 3.6, about sparse mixtures of
experts in general, or about the fork's engine work. Reading it as any of those would be the mistake.

## Thinking

The template defaults to thinking **on** and has no effort control. A small token budget is then spent entirely
on reasoning and returns empty content with `finish_reason: length` — which reads as a broken engine and is not
one. Either set `THINKING=0` or allow enough tokens to think *and* answer. `lib/smoke.sh` warns about this and
the capability probe now names the case explicitly.

## Engine pinning

A source build reports `gufo version development (unknown)` — no release number, no hash — so there is nothing
for a version check to match. The installer records the commit it built and stamps it beside the binary, and the
launcher refuses to start a binary built from anything else. Two host-side fixes are carried by the installer
rather than left as lore: a complete `rocm-7.1.0` rocWMMA header tree on `CPATH`, because Ubuntu's
`librocwmma-dev` omits the `internal/` headers its own `rocwmma.hpp` includes; and `--gcc-install-dir`, because
clang takes the newest gcc for libstdc++ while the link line takes g++'s. See
[the horizon note](../../../../../../../horizon/gufo-qwen3.6-35b-a3b.md) for how both were found.
