# Prompt lookup (n-gram speculative decoding)

**Status:** parked (29 Sep 2026) for the RTX 4090 machine's Ubuntu side; eliminated for the Flash-Next stacks.
**Kind:** an engine setting, not a new stack. It changes speed only, never output.

## What it is

The server guesses the next tokens by finding the last few tokens earlier in the context and copying what
followed; the model checks the guesses in one step. llama.cpp's `llama-server` offers it as `--spec-type`
`ngram-simple`, `ngram-map-k`, `ngram-map-k4v`, `ngram-mod` or `ngram-cache` (on our Strix Halo, RTX 4090 and
M5 Max builds); mlx-serve has it on by default (`--pld`) but prefers the model's MTP head. Every stack we run
already uses MTP, so the question is MTP against MTP plus n-gram.

## Why eliminated for Flash-Next

Flash-Next is a sparse mixture-of-experts model (512 experts, 10 used per token, read from its GGUF on
the Strix Halo box). Checking several guessed tokens loads nearly as many experts as generating them, so long n-gram
guesses save little or cost time: a published test of Qwen3.6-35B-A3B on an RTX 3090 was 15% slower with
`ngram-cache` at 100% acceptance.

## The parked test (RTX 4090, dense 27B)

Replay one finished story's model requests (`gufo-eval` can capture pi's real requests) through llama-server
with `draft-mtp` and with MTP plus an n-gram type; compare accepted tokens and output tok/s. First check that
combining spec types works on the command line (llama.cpp issue 24507: the router config keeps only the last).

**Last checked:** 29 Sep 2026. **Recheck when:** the RTX 4090 machine is on Ubuntu and idle.

Sources: [llama.cpp speculative decoding](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md) ·
[issue 24507](https://github.com/ggml-org/llama.cpp/issues/24507) ·
[Qwen3.6-35B-A3B test](https://hackmd.io/ODXuOQNzSiyUITz7g9mtBw)
