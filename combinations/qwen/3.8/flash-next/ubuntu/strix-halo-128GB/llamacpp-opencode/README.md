# Qwen3.8-Flash-Next · Ubuntu 26.04 · Strix Halo 128GB · llama.cpp (Vulkan) + OpenCode

Qwen3.8-Flash-Next (125B total, about 6B active per token) from Unsloth's
dynamic GGUF quants, served by upstream llama.cpp on Vulkan (RADV) on an AMD
Ryzen AI Max+ 395 with 128 GB of unified memory, driven by OpenCode or pi.

> **NOT MEASURED BY THIS REPO YET.** This combination was written for a
> Minisforum MS-S1 MAX before it had been run through the installer. Every
> memory figure in [`profiles.tsv`](profiles.tsv) is an **ESTIMATE** with its
> arithmetic shown; every speed below is a community figure from a different
> Strix Halo box, quoted with its source. It is marked `AUTO_SELECT=0`, so it
> ranks below any measured combination for the same machine; today it is the
> only Strix Halo one, so `./install.sh` offers it on a 128GB Strix Halo.
> [`benchmarks/README.md`](benchmarks/README.md) is the
> measurement plan that turns it into a measured combination.

## Before you install

Three things the installer checks and will refuse over, because they cannot
be fixed from inside it:

1. **Ubuntu 26.04** (kernel 7.0). Kernels before 6.18.4 have a gfx1151
   stability bug; 26.04 also has the RTL8127 10GbE driver in-tree.
2. **The GPU memory limit.** The GPU reaches system RAM through GTT, capped by
   the kernel's TTM page limit, which defaults to about half of RAM
   (~62 GB here). The model is 94 GB. Raise it once, then reboot:

   ```bash
   pipx install amd-debug-tools && amd-ttm --set 120 && sudo reboot
   ```

   or put `ttm.pages_limit=31457280` on the kernel command line. Leave
   `ttm.page_pool_size` alone; a large pool has been reported to deadlock
   gfx1151.
3. **Render node access.** `sudo usermod -aG render,video $USER`, then log out
   and back in.

And one it only warns about: set the BIOS **UMA Frame Buffer Size to 512M**
(Advanced → AMD CBS → NBIO Common Options → GFX Configuration). A large
"dedicated VRAM" carve-out is taken from Linux for good and makes the GPU no
faster on a unified-memory chip.

## Install

```bash
./install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-llamacpp-opencode.sh
```

It builds llama.cpp master with `-DGGML_VULKAN=ON`, downloads ~94.6 GB (the
three `UD-IQ4_XS` shards and the vision projector), writes the runtime, loads
the model once and checks it generates. The first load reads all 94 GB with
`--no-mmap`; expect minutes.

| Override | Effect |
|---|---|
| `QUANT=UD-Q4_K_XL` | the 111 GB quant: best quality, tight on memory (see `help.txt`) |
| `GPU_API=rocm` | build HIP instead of Vulkan, for an A/B; needs a host ROCm; experimental |
| `SKIP_SMOKE_TEST=1` | everything but the model load |
| `SKIP_BACKEND_UPDATE=1` | keep the llama.cpp checkout you have |

## What it serves

| Profile | Context | Slots | Vision | Memory (ESTIMATE) |
|---|---|---|---|---|
| `coding` (default) | 128k | 1 | off | ~97,500 MiB |
| `vision` | 128k | 1 | on | ~98,400 MiB |
| `agents` | 3 × 128k | 3 | off | ~107,500 MiB |
| `max` | 256k | 1 | off | ~101,000 MiB |

`qwen38-flash-next-strix-server --help` prints the table and the reasoning
behind each flag. The choices that differ from the NVIDIA combinations:

- **KV cache is f16 only.** bf16 crashes on gfx1151, and quantised KV has been
  reported to break tool calling on this model. With two KV heads the cache is
  small anyway.
- **No MTP head.** Upstream llama.cpp cannot load a qwen4exp MTP head yet
  (PRs #27836, #28243), and fails at startup if given one, so the installer
  does not download it. The launcher turns on **n-gram speculation** instead,
  after checking the build knows the flags.
- **`--no-mmap --ctx-checkpoints 8`**, `-b 2048 -ub 512`. Checkpoints let a
  returning agent turn resume, since the Gated DeltaNet layers cannot roll
  back; a larger `-ub` has been reported to win `llama-bench` and halve real
  decode.
- **A 30-minute idle timer**, not 5, and a 15-minute load allowance, because
  reloading 94 GB is the expensive part.

## Expected performance

**Not measured here.** Published figures from other 128 GB Strix Halo
machines, for orientation only:

| Stack | Decode | Prefill | Source |
|---|---|---|---|
| llama.cpp, UD-IQ4_XS, no speculation | ~17 tok/s at 8k, ~15 at 24k | ~340 tok/s empty, ~200 at 24k | drluoto, llama.cpp discussion #27950 |
| drluoto's Vulkan fork, MTP draft | ~30 (prose) to ~58 (file rewrite) | ~510 at 8k | drluoto/flash-next-strix-halo |
| Mainline Vulkan vs ROCm, UD-Q4_K_XL, partial offload | 11.50 vs 1.79 tok/s | | Soothill, 27 Aug 2026 |

The MS-S1 MAX runs a higher power limit (up to 160 W in its Performance mode)
than most Strix Halo boxes, so its numbers may differ. Record the BIOS power
mode with every measurement.

## Machines

The machine segment `strix-halo-128GB` covers every 128 GB Strix Halo
(Minisforum, Framework, GMKtec, Beelink and others share the chip). Which
exact box a number came from is `TESTED_ON` in [`config.sh`](config.sh), empty
until the first measured run. On any other box the installer says the
numbers were not measured there.

## Licence

Qwen3.8-Flash-Next is released under **qwen-community-1.0**, not Apache 2.0.
Read it before commercial use. llama.cpp is MIT; this repo is Apache 2.0 and
contains no weights.
