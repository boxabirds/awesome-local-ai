# BeeLlama.cpp (llama.cpp fork: smaller KV cache, adaptive speculation)

**Status:** candidate (30 Sep 2026): no known blocker; not scheduled.
**Machine:** gruntus (Ubuntu, CUDA). Compared with Swift 1.5 on llama.cpp on the same GPU: only the engine
and its KV-cache settings differ.

## What it is

A llama.cpp fork (MIT, about 1,100 stars, created May 2026, release v0.4.7 on 25 Sep 2026, still active)
that keeps llama.cpp's server and tools and adds:

- **Smaller KV caches for the same context:** variance-normalised KV quantisation (KVarN, `kvarn2` to
  `kvarn8`, separate bit widths for K and V), low-bit KV types (q2 to q6), and a "precision tail" that keeps
  the most recent tokens in F16/BF16 and quantises older context.
- **Speculative decoding:** MTP, DFlash, EAGLE3 and DSpark drafts, with an adaptive draft length for DFlash and
  a separate micro-batch size for the draft (`-ubd`).
- **Reasoning-loop protection** (detects repeated output) and more KV/prompt reuse between requests.

So "low memory" is roughly right: it fits more context, or keeps more precision, in the same VRAM. It does not
offload weights the way [Strata](strata.md) does. Its own quality figures are for Qwen 3.6 27B Q5_K_S at 64K
context on an RTX 3090: median KL divergence 0.000879 for kvarn6/kvarn6 with the tail against 0.000897 for
q8_0/q8_0 with a 1024-token tail. Backends are llama.cpp's (CUDA, Vulkan, ROCm, Metal and others), with prebuilt
binaries.

## Why it might matter here

On the 4090 (24 GB) the 27B models share memory between weights and a 131,072-token KV cache. A smaller cache
could allow a better weight quantisation, or leave room for a draft model, at the same context. Swift 1.5 has
an MTP head, which the fork supports.

## Checks before a run

1. Qwen 3.8 support: the fork's figures are for Qwen 3.6. Not checked for 3.8 or for Swift 1.5's MTP head.
2. Tool calls over the API with pi's real requests (the class of problem behind gufo issue 304).
3. Cross-turn caching past 100k tokens with a quantised KV cache (see [TensorFold](tensorfold.md)).
4. KV-cache quality at our context: its KL figures are at 64K. Pick the cache type from a measurement, not the
   README.
5. One-story smoke test.

## Confounds

The KV cache type and tail length change output quality slightly and must be recorded with the run (the run
identity records the server command line). Its speculation settings differ from upstream llama.cpp's. The fork
lags upstream by an unknown amount.

**Last checked:** 30 Sep 2026 (project README and GitHub metadata; nothing run). **Recheck when:** a v2
Swift 1.5 result exists to compare with, or gruntus has a free window.

Sources: [repository](https://github.com/Anbeeld/beellama.cpp) ·
[releases](https://github.com/Anbeeld/beellama.cpp/releases)
