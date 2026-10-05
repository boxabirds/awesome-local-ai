# ThinkingCap-Qwen3.8-27B

**Status:** gated (5 Oct 2026) — three checks below, and it has nothing to be read against yet.
**Kind:** a fine-tune of a model we already run, not a new engine or setting.
**Where it could run:** the RTX 4090 machine on Ubuntu, llama.cpp + pi, against
`qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi`.

## What it is

BottleCap AI's post-train of Qwen3.8-27B, changing how much the model thinks rather than what it knows. Its card
reports a **37% average cut in reasoning tokens** (11% to 66% depending on the benchmark) for **85.8% average
accuracy against the base model's 86.6%**, over 11 benchmarks across knowledge, maths, code, long context and
agentic tasks. It is the dense 27B only: there is no Flash-Next version, so it has no bearing on the 128 GB
stacks. An earlier ThinkingCap exists for Qwen3.6-27B.

Two figures from its own card are worth keeping apart, because they point opposite ways:

- long-context retrieval: 39% fewer reasoning tokens with accuracy **up** 2.3pp;
- AIME 2026: accuracy **down**, 98.13% to 94.27%.

So the claim is not "free"; it is "cheaper thinking, with the loss falling on hard maths". Our stories are
coding work with held-out tests, which is neither of those, and nobody has measured it there.

## Why it is interesting here

It goes at the owner's own hypothesis directly: that tokens per second is worth nothing if the tokens are
wasted. Every other candidate on this horizon makes the same tokens arrive faster. This one proposes to emit
fewer of them. If it holds on our suite, it moves the figure we rank on (tests passed) at lower cost; if it does
not, that is a result worth having, because the vendor's benchmarks are not ours.

The card's numbers are BottleCap's own, on their benchmarks. Nothing here is our measurement.

## Checks before a run

1. **Licence.** The weights are under *PolyForm Small Business 1.0.0 + BottleCap personal-use grant* (the
   upstream Qwen material stays Apache-2.0), with commercial use by arrangement with BottleCap. This repository
   is public and the owner's work is a business, so whether benchmarking it and publishing the result is
   permitted has to be settled before a run, not after. **Not yet checked — the owner's call.**
2. **The engine loads it.** The GGUF card says it "Requires a llama.cpp build with MTP support for this
   architecture (v0.4.1 or newer)", which is not llama.cpp's own version scheme; what build that means, and
   whether ours is it, is unchecked. A file that will not load is a ten-minute check, not a story.
3. **A baseline to compare with.** The dense 27B on that machine has **no v2 series at all** — the six attempts
   were every one cancelled. ThinkingCap's whole claim is relative to the base model, so without the base
   model's own five runs on our suite there is nothing to read a result against. This is the real gate: the
   base series has to come first.

## Confounds

- **Different quantiser.** Our dense 27B runs unsloth `UD-Q4_K_XL` (16.7 GiB). ThinkingCap publishes its own
  GGUFs: IQ4_XS 15.5 GB, Q4_K_M 17.4 GB, Q6_K 23.9 GB, Q8_0 29.0 GB, f16 54.7 GB. Q4_K_M is the nearest in size,
  but it is a different quantiser, so a difference in result is the fine-tune *and* the quantisation unless that
  is held still.
- **Reasoning effort.** Its chat template defaults to `xhigh`; our combination passes `low`. Comparing a
  thinking-cut model at one effort against the base at another measures the effort, not the fine-tune.
- **Token counts are the point, so they must be counted the same way.** The claim is about reasoning tokens, and
  our records separate thinking from output; the comparison is on that field, not on total output.

## What would settle it

The base dense 27B v2 series, then the same series with ThinkingCap at the same effort and the nearest quant,
read on tests passed of 75 and on thinking tokens per story — not on tokens per second.

**Last checked:** 5 Oct 2026 (both model cards read).
**Recheck when:** the dense 27B has a v2 series on the 4090, or the licence question is answered.

Sources: [ThinkingCap-Qwen3.8-27B](https://huggingface.co/bottlecapai/ThinkingCap-Qwen3.8-27B) ·
[ThinkingCap-Qwen3.8-27B-GGUF](https://huggingface.co/bottlecapai/ThinkingCap-Qwen3.8-27B-GGUF)
