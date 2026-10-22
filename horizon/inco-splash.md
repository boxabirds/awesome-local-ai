# Inco Splash

**Status:** candidate (22 Oct 2026). Added at the owner's request. Nothing downloaded, installed or run.
**Kind:** an inference engine (not a model) for Apple silicon, so a new engine arm for the same model, like [Lithos Metal](lithos-metal.md).
**Where it could run:** the M5 Max only. Apple-silicon Metal engine; macOS 26.4+. **Not** the Sparks (no CUDA), the Strix Halo box or the 4090 machine.

## What it is

Open-source (Apache-2.0, Python) server from Inco AI, launched 18 Sep 2026 and added by LM Studio as a backend. Read from the third-party tracking issue [evanwtf/local-llm #531](https://github.com/evanwtf/local-llm/issues/531) and search results, **not** from Inco's own repository.

- **Models: two.** `incoai/Qwen3.8-27B-Splash` (4-bit plus a DFlash 2 draft, 17.4 GB) and `incoai/Qwen3.6-35B-A3B-Splash` (4-bit plus draft, 20.9 GB). Per the issue only its own package format loads, with no converter; some later coverage says GGUF/MLX now load too (sources disagree, not checked). **No Flash-Next.**
- **API:** OpenAI Chat Completions and Responses, Anthropic Messages, tool calls; a `splash opencode` launcher; binds 127.0.0.1:8000; context to 256K.
- **Install:** Homebrew tap, a prebuilt 66 MB bottle.

## Whose figures

| Claim | Figure | Whose |
|---|---|---|
| Qwen3.8-27B decode, M5 Max | 144 tok/s | Inco's launch post; a best-case demo |
| Same, M5 Pro 48 GB, short prompts | 74 tok/s | Inco |
| vs mlx-serve (same issue) | Splash 65.8 decode vs mlx-serve MTP 73.5 / DFlash2 78.9; 32K decode 51.4 vs 47.1 / 45.6 | ddalcu, **author of mlx-serve**, build and machine unnamed |
| Users | 40-50 up to 120+ tok/s on M5 Max | unverified comments |

No independent benchmark found. The issue's author notes decode rate has not predicted agent wall time in their suite, which is why a speed figure alone does not rank an engine here: we rank on held-out quality.

## Checks before a run

1. **Provenance.** The issue records one unsigned commit by one author and a bottle with nothing tying it to the published source; its operator found no outbound host but huggingface.co. Build from source if possible and pin the commit.
2. **A like-for-like comparator exists.** Splash serves Qwen3.8-27B; we must hold an M5 Max 27B arm to compare it with. Flash-Next arms (mlx-serve) are not comparable.
3. **Tool calls over the API** (structured `tool_calls`, arguments parse, a newline in a string kept) and **cross-turn prompt reuse past 120k tokens**. Its cached first token (322 ms at 1.5K, per ddalcu) says nothing about 131k sessions.
4. **A client parser:** the `splash opencode` launcher implies OpenCode; the harness needs the right event shape for whichever client runs.

## Confounds

Model (27B dense, 4-bit Splash package vs our M5 Max Flash-Next stacks), quantisation (flat 4-bit; a commenter argues KV-cache quantisation and flat 4-bit are wrong for Qwen Flash-Next), draft model, and an engine at its first month.

**Last checked:** 22 Oct 2026, one issue page plus search results. **Recheck when:** Inco publishes Flash-Next support; an independent benchmark appears; we have a 27B M5 Max arm.
