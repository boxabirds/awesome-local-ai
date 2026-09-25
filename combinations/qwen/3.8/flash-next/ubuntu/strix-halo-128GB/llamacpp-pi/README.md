# Qwen3.8-Flash-Next · Ubuntu 26.04 · Strix Halo 128GB · llama.cpp (Vulkan or ROCm) + MTP + pi

Qwen3.8-Flash-Next (125B total, about 6B active per token) from Unsloth's
dynamic GGUF quants, with its MTP draft head, served by llama.cpp on Vulkan
(RADV) or ROCm on an AMD Ryzen AI Max+ 395 with 128 GB of unified memory,
driven by pi by default (a much smaller system prompt than OpenCode, which
matters at this prefill speed) or OpenCode.

> **PARTLY MEASURED.** Installed and verified on a Minisforum MS-S1 MAX
> (tritus), with decode speeds at shallow context measured there (see
> Expected performance). Every memory figure in [`profiles.tsv`](profiles.tsv)
> is still an **ESTIMATE** with its arithmetic shown, and nothing past a few
> thousand tokens of context has been measured yet. It is marked `AUTO_SELECT=0`, so it
> ranks below any measured combination for the same machine; today it is the
> only Strix Halo one, so `./install.sh` offers it on a 128GB Strix Halo.
> [`benchmarks/README.md`](benchmarks/README.md) is the
> measurement plan that turns it into a measured combination.

## Before you install

Four things the installer checks and will refuse over, because they cannot
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
4. **pi**, the default client. Ubuntu 26.04's Node (22.22) is new enough:

   ```bash
   sudo apt install -y nodejs npm && sudo npm install -g @earendil-works/pi-coding-agent
   ```

   Or install with `CLIENT=opencode` to use OpenCode instead.

And one it only warns about: set the BIOS **UMA Frame Buffer Size** to the
smallest it offers: 512M where available, **1G** on the MS-S1 MAX, whose menu
runs 1G–96G (Advanced → AMD CBS → NBIO Common Options → GFX Configuration). A large
"dedicated VRAM" carve-out is taken from Linux for good and makes the GPU no
faster on a unified-memory chip.

## Install

```bash
./install-qwen-3.8-flash-next-ubuntu-strix-halo-128GB-llamacpp-pi.sh
```

It builds llama.cpp from the MTP pull request's branch (below) for Vulkan,
downloads ~97.4 GB (the three `UD-IQ4_XS` shards, the MTP head and the vision
projector), writes the runtime, loads
the model once and checks it generates. The first load reads all 94 GB with
direct I/O (`-lm dio`); expect minutes.

| Override | Effect |
|---|---|
| `QUANT=UD-Q4_K_XL` | the 111 GB quant: best quality, tight on memory (see `help.txt`) |
| `GPU_API=vulkan` or `rocm` | build one backend instead of both (default `both`: Vulkan and HIP in one binary, ROCm from Ubuntu's packages). At run time `GPU_BACKEND=rocm` switches a two-backend build to ROCm; Vulkan is the default |
| `MTP_QUANT=shared-Q4_K_M` | the 1.91 GB draft head instead of the 2.79 GB `shared-Q8_0` |
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
- **The MTP draft head, from a pull request.** It is most of this model's
  speed on this chip: ~17 tok/s without it, 32–61 with it in drluoto's fork.
  Stock llama.cpp cannot load a qwen4exp head, so this combination builds
  [#28243](https://github.com/ggml-org/llama.cpp/pull/28243)'s branch
  (`danielhanchen/llama.cpp`, `qwen4exp/mtp`) until it merges, with Unsloth's
  `shared-Q8_0` head, 3 draft tokens a step and `p-min 0`. A shared head logs
  one `borrow_shared_tensor` error at startup and then works. MTP helps one
  request at a time; Unsloth measured it a net loss at 8 concurrent, so
  check it on the `agents` profile. `SPEC_MTP=0` runs without it.
- **No n-gram speculation.** On this chip each n-gram verification costs
  230–480 ms, and drluoto found it lost on everything but prose.
- **Vulkan or ROCm.** ROCm on gfx1151 returned wrong logits for long prompts
  until llama.cpp #28604 (8 Sep 2026); the build is newer than that. Open
  ROCm risks for this model are a load hang
  ([#29149](https://github.com/ggml-org/llama.cpp/issues/29149)) and state
  leaking between requests on a reused slot
  ([#29092](https://github.com/ggml-org/llama.cpp/issues/29092)). Vulkan's is
  the 2 s GPU watchdog on Linux 7.x; qualification warns until
  `amdgpu.lockup_timeout` is set.
- **`-lm dio --ctx-checkpoints 8`**, `-b 2048 -ub 512`. Direct I/O rather than
  mmap: drluoto measured mmap 9–12% slower decode on this chip. Checkpoints let a
  returning agent turn resume, since the Gated DeltaNet layers cannot roll
  back. `-ub 512` is unverified: a larger value has been reported to halve
  real decode, but drluoto runs `-ub 2048`. The benchmarks settle it.
- **A 30-minute idle timer**, not 5, and a 15-minute load allowance, because
  reloading 94 GB is the expensive part.

## Expected performance

**First measurements on a Minisforum MS-S1 MAX** (BIOS Performance mode, UMA
1G, `-lm dio`, MTP depth 3, pi). Shallow context only: the 32k–128k numbers,
the memory per profile and the long-prompt prefill are still to come
([measurement plan](benchmarks/README.md)).

| Workload | Vulkan decode | ROCm decode | MTP drafts accepted |
|---|---|---|---|
| New code | 47.5 tok/s | 42.3 | 77–80% |
| File rewrite | 55.8 | 50.0 | 100% |
| Prose | 36–41 | 34–35 | 52–63% |
| A pi coding session, ~7k context | 50–52 | – | 86–89% |

Vulkan is the default because it decodes 10–17% faster here, with identical
output at temperature 0. Source: [`benchmarks/backend-ab/`](benchmarks/backend-ab/)
and the server log of the pi session.

Published figures from other 128 GB Strix Halo machines, for orientation:

| Stack | Decode | Prefill | Source |
|---|---|---|---|
| llama.cpp, UD-IQ4_XS, no speculation | ~17 tok/s at 8k, ~15 at 24k | ~340 tok/s empty, ~200 at 24k | drluoto, llama.cpp discussion #27950 |
| drluoto's Vulkan fork, his Q5_K MTP head | 32 (prose), 43 (new code), 56 (file rewrite) at 8k; 38 and 49 at 32k | ~510 at 8k, ~390 at 32k | drluoto/flash-next-strix-halo, 20 Sep 2026 |
| Mainline Vulkan vs ROCm, UD-Q4_K_XL, partial offload | 11.50 vs 1.79 tok/s | | Soothill, 27 Aug 2026 |

The MS-S1 MAX runs a higher power limit (up to 160 W in its Performance mode)
than most Strix Halo boxes, so its numbers may differ. Record the BIOS power
mode with every measurement.

### BIOS and GPU clock

- **Power mode: Performance** (the MS-S1 MAX offers Performance, Balance and
  Quiet). Linux cannot read it, so benchmarks take it as `POWER_MODE=`.
- **UMA Frame Buffer Size: the smallest offered** (see Before you install).
- **GPU clock: leave it on `auto` for daily use.** Pinning it to `high` bought
  **1–2%** decode on the MS-S1 MAX in Performance mode (code 47.0 → 47.5,
  rewrite 55.1 → 55.8, prose 35.3 → 36.0 tok/s, identical output), not the ~20%
  reported on another box: decode here is mostly memory-bound, which the clock
  does not change. Pin it while benchmarking, so runs are comparable; it resets
  at reboot:

  ```bash
  echo high | sudo tee /sys/bus/pci/devices/0000:bd:00.0/power_dpm_force_performance_level
  ```

  (The PCI address is the GPU's on the MS-S1 MAX; `grep -l 0x1586
  /sys/bus/pci/devices/*/device` finds it on another box.)

## Why not the Windows these boxes ship with?

Short answer: as of September 2026 there is no equivalent path on Windows.
It fails on memory before speed comes into it, and the three things this
combination's performance rests on (the IQ4_XS quant, the MTP draft head and
context checkpoints) are the three things Windows breaks. Keep Windows if you
want it, and dual-boot Ubuntu from a second drive or partition (300 GB or more:
each quant is 94–111 GB).

- **The model does not fit.** On Windows the GPU gets only the fixed slice the
  BIOS reserves for it (a llama.cpp Vulkan maintainer confirms this in
  [#26089](https://github.com/ggml-org/llama.cpp/issues/26089)), and AMD caps
  that slice at 96 GB on 128 GB machines. On Linux the GPU reaches about 120 GB
  through GTT. UD-IQ4_XS (93.7 GB) + MTP head (2.7 GB) + a 128k KV cache
  (3.2 GB) + compute buffers is about 100 GB. UD-Q3_K_XL (90 GB) is marginal;
  UD-IQ3_XXS (82 GB) fits, but it is a lower-quality model, so no longer
  equivalent. *Untested:* about 29 GB of each file is the n-gram embedding
  table, which may not need to be in GPU memory; if it can stay in system
  memory, the fit changes.
- **Vulkan on Windows is a different driver.** It is AMD's own driver, not
  Mesa's RADV. Every Strix Halo figure on this page is from RADV on Linux; we
  found no Windows measurements of this model.
- **Context checkpoints crash Windows Vulkan**
  ([#27560](https://github.com/ggml-org/llama.cpp/issues/27560)). The
  workaround, `--ctx-checkpoints 0`, means the Gated DeltaNet layers cannot
  resume, so every agent turn re-reads its whole prompt: minutes per turn at
  128k.
- **ROCm on Windows is a preview** (AMD's TheRock builds). Open issues include
  a gfx1151 crash on the unfused Gated DeltaNet path
  ([#27557](https://github.com/ggml-org/llama.cpp/issues/27557)) and a release
  missing `hipblas.dll`
  ([#26996](https://github.com/ggml-org/llama.cpp/issues/26996)).
- **Windows has its own 2-second GPU watchdog** (TDR), the same problem as
  `amdgpu.lockup_timeout` on Linux, fixed through the registry instead of the
  kernel command line.
- **None of this repo's tooling runs there.** The installer, session manager
  and benchmarks are bash for Linux and macOS. WSL2 is not a way round it:
  Vulkan inside WSL2 goes through a Direct3D translation layer, so its numbers
  would say nothing about the hardware.

**Revisit this** when Windows lets the GPU address more than the BIOS slice,
when AMD's Windows ROCm leaves preview, or when the Windows Vulkan checkpoint
crash is fixed. Any one of those reopens the question, and Windows' local-AI
stack is expected to change through 2027.

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
