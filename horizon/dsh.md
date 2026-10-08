# DSH (DeepSeek Harness) as a coding client

**Status:** open question (8 Oct 2026). Added at the owner's request, as another harness to try on a pinned engine. Not
installed, not run; what is known comes from our own captured traces, nothing from the project's pages.
**Needs before it is a candidate:** a client adapter in the harness, and an answer to whether it will talk to a model that is
not a DeepSeek one.

## What we have

This repository holds six captured runs of DSH 0.1.6-alpha.2 under
`docs/research/20260917-nadirclaw-harness/clients/dsh-0.1.6-alpha.2/` (runs A to F: both adapters, headless and Web presets,
chat-completions and Anthropic Messages). Their requests name a model called `deepseek-flash`. They show the request
shapes DSH sends; they were captured for the NadirClaw harness research, not for a benchmark.

## What is missing

- **No adapter.** `benchmarks/spec-bench/harness/clients.py` has `PiClient`, `OpenCodeClient` and `ClaudeClient`, and the
  job queue accepts only `pi`, `opencode` or `claude`. Running DSH needs a fourth: its isolated config, a headless command,
  how it reports tool calls and tokens, and how the harness stops it.
- **Whether it works with another model.** The traces use a DeepSeek model name; I have not checked that DSH can be pointed
  at an OpenAI-compatible server serving Qwen, or whether its tool format is DeepSeek-specific. That decides if the idea is
  workable at all.
- **A release to pin.** 0.1.6-alpha.2 is an alpha; the version run would have to be recorded and held fixed.

## If it goes ahead

Same discipline as [gufo with OpenCode](gufo-opencode.md): one variable at a time. The engine stays pinned by digest (gufo
0.5.0 on the Strix Halo box), the model, sampling and context stay as in `gufo-pi`, and only the client changes. Its checks are the same:
the capability probe through the client's own request path, a look at what it sends, then the ten-minute smoke rule.

**Last checked:** 8 Oct 2026, from our captured traces only.
**Recheck when:** the owner confirms DSH can drive a non-DeepSeek model, or the adapter is started.
