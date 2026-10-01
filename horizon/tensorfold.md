# TensorFold

**Status:** unblocked upstream, not yet by us (1 Oct 2026): the long-context defect has a named fix in 0.3.6.3, confirmed by its reporter. Our own long-context check (below) still has to pass before any run.
**Machine:** the M5 Max (128 GB, MLX). Compared with mlx-serve on the same model.

## What it is

An OpenAI-compatible server (Apache-2.0 from 0.6.0, MIT before) for Apple Silicon (MLX) and NVIDIA (CUDA), no AMD, built around exact
speculative decoding: a drafted token is kept only if it equals what the same engine would produce serially.
Draft sources: MTP heads, the DFlash2 draft model, and copies of the context. Version 0.6.0 on 30 Sep 2026, very active.
Supports Qwen3.8 Flash-Next (`Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP`) on MLX with its MTP head, and on MLX
tool calls, streaming and `reasoning_effort`.

## The long-context defect, and its fix

TensorFold issue 71: on 0.3.5.1 with Qwen3.8-27B and DFlash2 on a 64 GB M5 Pro, prompts past about 100-125k tokens
were served but their cache checkpoint was not kept, so every later turn re-read the whole context (7-11 minutes
per turn). Our agent sessions run to about 131k tokens, so the owner ruled it a blocker (29 Sep 2026).

Fixed in **0.3.6.3** (29 Sep 2026). The maintainer named two faults: the DFlash2 head kept every prompt chunk's
hidden states alive until the first draft (114 KB a token, now 64 KB), and a resumed turn held the prefix it
resumed from until its prefill ended, so making room for its own checkpoint evicted every conversation. The
reporter re-ran the same fixture on the same Mac with stock settings and confirmed it fixed. The server now says
at startup how many tokens a request can use and still keep its prompt for the next turn (139,264 on that 64 GB
Mac with the 27B).

Still open on the issue: on a 96 GB M3 Ultra a conversation grown to about 191k tokens lost part of its cache when
checkpoints were rotated to disk (480-503 s to first token). That is past our 131k, on a different model and
machine; our check below covers our own case.

## What has changed since 29 Sep (0.3.6.3 to 0.6.0, six releases in three days)

- **0.4.0:** Flash-Next's mixed and 2-8-bit checkpoints load on Macs, each module in its own format. The mixed
  4/8-bit weights mlx-serve runs may therefore load in TensorFold, which would remove the weights confound below
  (untested by us).
- **0.5.0:** the CUDA server takes `reasoning_effort`, `min_p` and typed tool arguments, as the Mac server does:
  the two CUDA caveats below no longer hold, by its release notes.
- **0.6.0:** CUDA runs on RTX 40 cards, so the RTX 4090 machine becomes a second candidate; tool-call arguments
  stream as written; a prompt past the context window gets `context_length_exceeded`; the licence is now
  Apache-2.0 (was MIT).
- **Activity (1 Oct 2026):** 770 stars, 99 forks, 38 open issues; the repository was created on 19 June 2026.

## Checks before a run

1. On the M5 Max, with the exact config we'd benchmark (TensorFold version, model, draft method, context
   limit; 0.3.6.3 or later): a multi-turn conversation grown past 120k tokens where every turn reuses the cache (only new
   tokens prefilled; check the server's cached-token count and prefill time).
2. Tool calls over `/v1/chat/completions` with pi's real requests.
3. Then a one-story smoke test.

## Confounds

Vontra's 4-bit weights vs mlx-serve's Dalcu mixed 4/8-bit: use the same weights for both engines if
TensorFold reads them (0.4.0 says it loads mixed checkpoints: check), otherwise note it. On CUDA, 0.5.0 says
`reasoning_effort` and typed tool arguments now work; before that they didn't.

**Last checked:** 1 Oct 2026 (releases to 0.6.0, issue 71 and its comments). **Next:** our long-context check on the M5 Max when it is free between mlx-serve runs (needs the owner's go-ahead).

Sources: [TensorFold](https://github.com/ashhart/TensorFold) ·
[API fields](https://github.com/ashhart/TensorFold/blob/main/docs/api.md) ·
[issue 71](https://github.com/ashhart/TensorFold/issues/71)
