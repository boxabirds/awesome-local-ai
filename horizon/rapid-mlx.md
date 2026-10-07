# Rapid-MLX

**Status:** gated (7 Oct 2026), on one check: **whether Flash-Next fits on a 128 GB Mac at our context.** Its own
documentation says it may not. Added at the owner's request; not run, not installed, read from the project's README and
repository metadata only.
**Kind:** a new engine, a third MLX server beside mlx-serve and MTPLX. A new combination if it runs.
**Where it could run:** the M5 Max (128 GB), against `qwen/3.8/flash-next/macos/128GB/mlxserve-pi` ([mlx-serve](mlx-serve-26.10.1.md))
and the MTPLX series ([MTPLX](mtplx.md)). It is Apple-Silicon only. The dense Qwen3.8-27B is the other candidate,
which it supports at about 27 GB.

## What it is

[Rapid-MLX](https://github.com/raullenchai/Rapid-MLX) is an open-source inference server for Apple Silicon built on MLX,
OpenAI- and Anthropic-compatible, whose stated focus is **reliable tool calling for coding agents**: the failure we
have had to chase on gufo, and on others. Python, installed with `brew install rapid-mlx` or from PyPI. Created 25 Feb
2026; very active (v0.15.7 on 7 Oct 2026, the fifth release in eight days, since v0.15.3 on 30 Sep; about 3,900 stars). Its README states
Apache 2.0, while GitHub's licence field reads "NOASSERTION": a fact to record, not a gate.

What the README claims that bears on us:

- **Flash-Next is supported**, as `qwen3.8-flash-next-4bit`, and so is Qwen3.8-27B (`qwen3.8-27b-4bit`, with an MTP path).
- A **radix prefix cache** with state snapshots for hybrid models, saved to disk on shutdown and restored at start, and
  a quantised live KV cache.
- **Speculative decoding** (the model's own MTP head, plus prompt lookup), on by default for some models.
- **27 tool-call parser modules**, with an auto-detect fallback. Its troubleshooting section lists "tool calls arriving as
  plain text" as a known problem that "auto-recovery handles most" of, with an explicit `--tool-call-parser` for the rest.
  That is the failure we have chased on gufo, so the project knows the shape of it; whether its recovery is enough for a
  four-hour story is what check 2 is for.

## Two things in its own documentation that decide how to read it

**1. The memory figures do not fit our machine.** Its published measurement of Flash-Next 4-bit is **102.8 GB active
and 148.1 GB peak** (at a 32k prompt), on a 192 GB Mac. Its own words: the weights are 99 GB, **192 GB is the practical
recommended tier, and 128 GB "is tight and was not physically tested"**. Our M5 Max has 128 GB and our agent runs a
131k-token context, longer than the one they measured. For comparison, mlx-serve's mixed 4/8-bit pack runs at about
87 GB resident on the same machine. A 148 GB peak cannot run there, so this is the first check and may be the last.

**2. Its headline speed claims are measured with greedy decoding.** The README's "up to 4× faster than mlx-lm, 1.5× on a
typical task" is stated "greedy decoding, both servers at their defaults" on a 9B model, and says the gain is
speculative decoding. On 7 Oct 2026 we found the same effect cost us a comparison: gufo's maintainers told us greedy
sampling gives higher speculative acceptance than the model labs' suggested sampling, because the output is more
predictable (the pull request is https://github.com/gufo-org/gufo/pull/282, and our write-up of the measurement is
https://github.com/boxabirds/awesome-local-ai/blob/main/docs/reports/strategic-insights/2026-10-07-gufo-0.5.0-decodes-slower.md).
Our agent samples at temperature 1.0, so **no decode figure in their README is a prediction of ours**, and neither is
the 1.5× to 4× range. Their own long-prompt agent turn was "close to a tie (1.05×)". The README also says its default
autoregressive path for Flash-Next was "effectively flat" between two builds and that the MTP and prompt-lookup modes
are "workload-dependent".

## Checks before a run

In this order, because each makes the next worth doing. None has been done.

1. **Does it load and serve Flash-Next on 128 GB at our context?** The gate. A ten-minute check, not a story: start it
   at 131,072 tokens, send one long prompt, and read the resident size and swap while it works. The harness's machine guard
   stops a story at +4 GB of swap or under 8% free memory, so a configuration that needs 148 GB would stop every story it
   starts. If it needs more than the machine has, mark this blocked with the figures and stop.
2. **A tool call with arguments that carry raw newlines, and a large one.** The capability probe
   (`tools/engine-probe/basic-capability.py`) does this: its plumbing half decides, so a failure here would be measured
   instead of the model. This is what the project says it is good at, so it is worth a careful look.
3. **Prompt reuse at depth.** A second request on a conversation of 100k tokens or more must report a cached prefix.
   The radix cache is claimed; our agent depends on it, and long sessions are where a cache has failed us before.
4. **The sampler it actually applies.** Set our model-card sampling explicitly, confirm the effective settings are what was
   asked, and measure speculative acceptance under it rather than reading theirs. Check whether its speculative modes are
   on by default for this model and whether sampling turns them off.
5. **A version pin.** v0.15.7 today and moving several times a week: pin the exact release and record the commit, since a
   pip or Homebrew install reports a version and not the source.
6. Then the ten-minute smoke rule, a queued series, and watch story 1.

## Confounds

- **A third quantisation of the same model.** It ships its own weights (a model mirror and its own aliases), so this is not
  mlx-serve's mixed 4/8-bit pack or MTPLX's optimised pack. A difference in score could be the quantisation, the engine, or
  both; the same problem the llama.cpp 3-bit arm had in reverse.
- **Different speculative decoding defaults** from mlx-serve and MTPLX, and possibly from sampling: see above.
- **Memory pressure.** If it fits at all it will be close to the limit, and swap changes agent time and can stop stories.
- **A fast-moving project.** Results are for one release; the next may behave differently.

## Why it is worth the check

Tool-call reliability is where our stacks keep losing whole stories, and an engine that has made it its stated purpose
is worth one ten-minute test. If the dense Qwen3.8-27B path, which fits easily and has a verified MTP path, holds up
against what we run on the RTX 4090, that would be a result about the engine on a model we already have a baseline for.

**Last checked:** 7 Oct 2026, from the README and repository metadata (releases, licence field, activity), not from running it.
**Recheck when:** check 1 is answered, or a release states Flash-Next fits in 128 GB.
