# Qwen3.8-Flash-Next · Ubuntu 26.04 · Strix Halo 128GB · gufo + pi

The same model as [`llamacpp-pi`](../llamacpp-pi/README.md), served by
[gufo](https://github.com/gufo-org/gufo) instead of llama.cpp. gufo is a
single-model inference engine for this chip (ROCm, its own kernels), shipped as a
container image and run here with Podman.

## Why this combination exists

On this machine, llama.cpp reads prompts at 170–350 tok/s: its Gated DeltaNet
prefill runs token by token (the chunked kernel is not merged for Vulkan or
ROCm). Every compaction or cache miss then costs 6–8 minutes, and agent runs hit
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

| Profile | Context | Sessions | Draft | Prefill chunk | GPU memory | Basis |
|---|---|---|---|---|---|---|
| `coding` | 131,072 | 1 | 7 | 512 | 87,849 MiB | measured, test A |

## Usage

```bash
qwen38-flash-next-strix-gufo-server           # serve on :8080
qwen38-flash-next-strix-gufo-pi               # pi against it, started on demand
dbench submit tritus --install-id qwen38-flash-next-strix-gufo --pack benchmarks/vidi --client pi --record …
```
