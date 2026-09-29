# NInfer (Swift 1.5 on the RTX 4090, Windows)

**Status:** queued (29 Sep 2026): waiting for the one-time Windows setup at the machine.
**Machine:** gruntus on Windows 11, harness in WSL2. Compared with Swift 1.5 on llama.cpp (Ubuntu, same GPU):
only the engine differs.

## What it is

A Windows-only inference engine for the RTX 4090 (sm_89), Apache-2.0, native Windows 11 (MSVC + CUDA, "no WSL,
no Docker"). OpenAI Chat Completions, Responses and Anthropic Messages endpoints; tool calls are rendered into
the prompt and parsed back. The model is one 19 GiB `.ninfer` file of Swift 1.5 Qwen3.8-27B with Q4/Q5
projections, Q8 vocabulary, an MTP head and a DFlash2 draft model; the card tests 100,000-token context and
claims 129.8 tok/s.

## Checks before a run

1. Windows setup: [tools/windows-bench-host/setup.ps1](../tools/windows-bench-host/setup.ps1) (Tailscale, SSH,
   WSL2), then NInfer and the model over SSH, served by a Scheduled Task.
2. Tool calls over the API with pi's real requests: it parses tool calls from text, the class of mechanism
   behind gufo issue 304.
3. Cross-turn caching past 100k tokens (see [TensorFold](tensorfold.md)).
4. One-story smoke test with the harness in WSL2.

## Confounds

Its quantisation differs from the llama.cpp Q4_K_M; its tested context is 100,000 tokens against our 131,072.
Record the file used.

**Last checked:** 29 Sep 2026. **Recheck when:** the Windows setup is done.

Sources: [model card](https://huggingface.co/jgamboa/Swift-1.5-Qwen3.8-27B-NInfer-4090) ·
[engine](https://github.com/JGamboa/ninfer-4090-windows)
