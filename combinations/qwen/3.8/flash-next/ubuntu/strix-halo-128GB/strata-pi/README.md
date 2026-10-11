# Qwen3.8-Flash-Next on an AMD Strix Halo, served by Strata, driven by pi

**Status:** installable; the engine was measured on this machine with another quantization (UD-Q4_K_XL), not yet with this
one, and not yet benchmarked.
**Machine:** the Strix Halo box (Ryzen AI Max+ 395, Radeon 8060S / gfx1151, 128 GB shared by the CPU and the GPU), Ubuntu 26.04.
**Install:** `./install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-strata-pi.sh`
**Server:** `qwen38-flash-next-strix-strata-server` (loopback, port 8013). **Client:** pi.

## What this is for

The Strix Halo combinations so far are gufo-pi (UD-Q4_K_XL) and llamacpp-pi (UD-IQ4_XS). This one runs the llamacpp-pi quant on
Strata, an engine built for this one model family, so it asks whether Strata on this chip scores as well as the others, and
whether its speed is worth it.

## What this combination runs

| | |
|---|---|
| Strata | v0.1.42, pinned by commit `61b3fb5d` |
| Weights | `unsloth/Qwen3.8-Flash-Next-GGUF` at `38bb39ee`, UD-IQ4_XS (93.7 GB in three files, sha256-checked): the same revision and quant as llamacpp-pi |
| Context | 131,072 tokens (the benchmark's minimum), KV cache int8 |
| Drafting | MTP, from the original Qwen checkpoint (about 5 GB, fetched by Strata's setup) |
| Sampling | temperature 1.0, top-p 0.95, top-k 20; reasoning effort low (pi sends none): as the other Flash-Next combinations |
| Engine switches | nine, from Strata's Strix Halo page (`STRATA_ENV` in config.sh) |

## The engine switches change answers

Strata's defaults on this chip read prompts about 60% slower than gufo (below). The page for this chip lists a "fast
configuration" of nine environment switches that round differently from the default path (a different summation order, half-precision
intermediates), so they change answers slightly. The maintainers gate them with KL against the default on their own machine;
we have not. A score from this combination is the score of the engine with those switches, not of Strata's default path.

## What was measured

On 11 Oct 2026, nothing else running, UD-Q4_K_XL (the quant gufo-pi runs, not this one), using gufo's own throughput test
(`benchmarks/gufo-eval/throughput.py`, the byte-identical prompts of the 27 Sep test A), greedy, 400 tokens, median of 3, no errors:

| Prompt | gufo | Strata, setup defaults | Strata, the nine switches | Switches vs gufo |
|---|---|---|---|---|
| 2k | 744 | 327 | 664 | -10.9% |
| 32k | 1,266 | 509 | 1,119 | -11.6% |
| 64k | 1,242 | 505 | 1,161 | -6.5% |
| 120k | 1,228 | 491 | 1,165 | -5.1% |

Prompt-read tokens/s. Decode with the switches: 48 / 59 / 47 / 38 tokens/s against gufo's 47 / 57 / 53 / 39. Peak GPU memory
(VRAM + GTT) 40,255 MiB. Not measured: prompt-cache reuse over turns on this chip, tool calls, quality.

## How the install differs from the NVIDIA one

- The weights are fetched by the installer (16 connections, hash-checked), then Strata's setup is run with `--backend hip` on
  those files (`--gguf-dir`), so it does not fetch them again. It compiles its engine for gfx1151 and installs its own ROCm
  into its folder (about 10 GB, no sudo).
- The launcher derives its configuration from the file setup wrote (`strata-unsloth-ud-iq4_xs.json`) and adds the context and the
  engine switches. There is no VRAM reserve: the GPU's memory is the RAM.
- The host needs kernel 6.18.4 or newer and a GTT limit of 120 GiB (`ttm.pages_limit`), as for gufo-pi.
