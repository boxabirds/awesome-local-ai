# Qwen3.8-Flash-Next · Ubuntu 26.04 · Strix Halo 128GB · gufo + pi

The same model as [`llamacpp-pi`](../llamacpp-pi/README.md), served by
[gufo](https://github.com/gufo-org/gufo) instead of llama.cpp. gufo is a
single-model inference engine for this chip (ROCm, its own kernels), shipped as a
container image and run here with Podman.

> **Why gufo reads prompts 4–7× faster than llama.cpp here, in plain English:**
> [why-gufo-reads-prompts-fast.md](why-gufo-reads-prompts-fast.md). Known bug affecting long agent
> runs: [gufo-org/gufo#304](https://github.com/gufo-org/gufo/issues/304) (a tool call is sometimes
> returned as text; the harness continues the session when it happens).

## Why this combination exists

On this machine, llama.cpp reads prompts at 170–350 tok/s, falling as the
context grows. A per-operation profile puts 58–77% of its prefill time in the
weight matrix multiplications and a growing share in attention (1.5% at 2k, 23%
at 64k); Gated DeltaNet is under 2%. See the [prefill guide](why-gufo-reads-prompts-fast.md).
Every compaction or cache miss then costs 6–8 minutes, and agent runs hit
the 4-hour story cap. gufo reads the same prompts about 4–7× faster.

Measured on tritus (Minisforum MS-S1 MAX, 128 GB), 27 Sep 2026,
[`benchmarks/gufo-eval/test-a.sh`](../../../../../../../benchmarks/gufo-eval/test-a.sh):
the same UD-Q4_K_XL weights and MTP head for both engines, byte-identical
prompts, one request at a time, greedy, thinking off, 400 tokens, median of 3.

| Prompt | gufo prefill | llama.cpp prefill | gufo decode | llama.cpp decode |
|---|---|---|---|---|
| 2k | 744 tok/s | 351 | 47.3 tok/s | 50.4 |
| 32k | 1,266 | 302 | 57.0 | 46.8 |
| 64k | 1,242 | 237 | 52.9 | 36.4 |
| 120k | 1,228 | 172 | 38.8 | 23.0 |

Greedy with thinking off is the kindest case for MTP drafting; agent runs sample
at temperature 1.0 with thinking on, so expect lower decode figures in them.
**Speed is not quality:** whether gufo writes code as well as llama.cpp does is
what the benchmark runs of this combination measure.

## Before you run it: one model server at a time

The launcher refuses to start while a llama-server, mlx-serve or gufo is
running: two ~90 GB models do not fit in 128 GB, and on 27 Sep 2026 two
llama-servers side by side ran tritus out of memory. `ALLOW_COEXIST=1` overrides.

## The engine and the weights

| | |
|---|---|
| Image | `ghcr.io/gufo-org/toolboxes/gufo-runtime`, pinned by digest (`config.sh`) |
| Engine | gufo `b722a61`: contains [#284](https://github.com/gufo-org/gufo/pull/284) (Qwen tool arguments keep their whitespace), which the [eval plan](../../../../../../../docs/20260926-gufo-vs-llamacpp-eval-plan.md) requires. The installer refuses an image whose binary reports anything else |
| Weights | `unsloth/Qwen3.8-Flash-Next-GGUF` @ `38bb39ee`, **UD-Q4_K_XL** (111 GB; the only quant gufo supports) + `MTP/mtp-…-shared-Q8_0.gguf` |
| Where | `~/gufo/models/qwen3.8-flash-next`, mounted read-only. Files already there at their published sizes are used as they are |

The llamacpp-pi runs use UD-IQ4_XS (94 GB), so comparing the two combinations
compares engine *and* quant, not the engine alone.

## Sampling, thinking, effort

Server-side defaults, identical to llamacpp-pi: temperature 1.0, top-p 0.95,
top-k 20, min-p 0, thinking on, reasoning effort `low`. A request that sets its
own still wins. `THINKING=0` switches to the instruct sampler. MTP drafts up to
7 tokens a step (gufo's default; llama.cpp's runs use 4): `DRAFT_TOKENS=4` for
an A/B.

## Requirements

- Ubuntu 26.04 (kernel 7.0), amdgpu loaded, `/dev/kfd` readable by you
  (`render` and `video` groups)
- Podman (tested: 5.7.0)
- A GTT limit of at least 90 GiB (see llamacpp-pi's README for `amd-ttm`)

## Install

```bash
./install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-gufo-pi.sh
```

Pulls the image by digest (if absent), checks the engine version, adopts or
downloads the weights, installs `qwen38-flash-next-strix-gufo-server` and the
session commands, and smoke-tests the model.

## Profiles

| Profile | Context | Sessions | Draft | Prefill chunk¹ | GPU memory | Basis |
|---|---|---|---|---|---|---|
| `coding` | 131,072 | 1 | 7 | 512 | 87,849 MiB | measured, test A |

¹ gufo's : how many prompt tokens it reads between generation rounds *while another request is generating*. With one session it has no effect: a prompt is read in one go, through the model's own fixed 2,048-token prefill chunks ( in gufo's Flash-Next engine, chosen by a 512–4,096 sweep).

## Runs

| Run | Build order | Notes |
|---|---|---|
| `canvas-gufo-01` | **user journey**: story 5 first, then 1, 2, 3, 4, 7, … | [interventions](benchmarks/vidi/canvas-gufo-01/interventions.md): its per-story scores are not directly comparable with number-order runs; its end-of-run total over the same scope is |

## Usage

```bash
qwen38-flash-next-strix-gufo-server           # serve on :8080
qwen38-flash-next-strix-gufo-pi               # pi against it, started on demand
dbench submit tritus --install-id qwen38-flash-next-strix-gufo --pack benchmarks/vidi --client pi --record …
```
