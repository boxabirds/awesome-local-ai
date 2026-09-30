# TensorFold

**Status:** blocked (29 Sep 2026): a large-context defect is a blocker until our own test passes.
**Machine:** the M5 Max (128 GB, MLX). Compared with mlx-serve on the same model.

## What it is

An MIT-licensed OpenAI-compatible server for Apple Silicon (MLX) and NVIDIA (CUDA), no AMD, built around exact
speculative decoding: a drafted token is kept only if it equals what the same engine would produce serially.
Draft sources: MTP heads, the DFlash2 draft model, and copies of the context. Version 0.3.x, active.
Supports Qwen3.8 Flash-Next (`Vontra/Qwen3.8-Flash-Next-MLX-4bit-MTP`) on MLX with its MTP head, and on MLX
tool calls, streaming and `reasoning_effort`.

## Why it's blocked

TensorFold issue 71 (closed 28 Sep 2026, no named fix): on 0.3.5.1 with Qwen3.8-27B and DFlash2 on a 64 GB
M5 Pro, prompts past about 100-125k tokens are served but their cache checkpoint is not kept, so every later
turn re-reads the whole context (7-11 minutes per turn). Our agent sessions run to about 131k tokens. It may
not apply to the M5 Max (128 GB, Flash-Next, MTP without DFlash2), but that is untested.

## Checks before a run

1. On the M5 Max, with the exact config we'd benchmark (TensorFold version, model, draft method, context
   limit): a multi-turn conversation grown past 120k tokens where every turn reuses the cache (only new
   tokens prefilled; check the server's cached-token count and prefill time).
2. Tool calls over `/v1/chat/completions` with pi's real requests.
3. Then a one-story smoke test.

## Confounds

Vontra's 4-bit weights vs mlx-serve's Dalcu mixed 4/8-bit: use the same weights for both engines if
TensorFold reads them, otherwise note it. On CUDA (not planned) `reasoning_effort` is unsupported and
tool-call parameters come back as strings.

**Last checked:** 29 Sep 2026. **Recheck when:** a release names a fix for cache retention at long context.

Sources: [TensorFold](https://github.com/ashhart/TensorFold) ·
[API fields](https://github.com/ashhart/TensorFold/blob/main/docs/api.md) ·
[issue 71](https://github.com/ashhart/TensorFold/issues/71)
