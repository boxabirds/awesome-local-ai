# Qwen3.8-Flash-Next on one RTX 4090, served by Strata, driven by pi

**Status:** installable and checked against stubs; measured once, not yet benchmarked (`horizon/strata.md`).
**Machine:** the RTX 4090 machine (Core i9-13900F, 62 GB RAM, 24 GB VRAM), Ubuntu 22.04.
**Install:** `./install-qwen-3.8-flash-next-ubuntu-nvidia4090-strata-pi.sh`
**Server:** `strata-qwen38-flash-next-server` (loopback, port 8013). **Client:** pi.

## What Strata is

An MIT-licensed engine (github.com/Niko1221/Strata, v0.1.x) built for exactly one model family, Qwen3.8 Flash-Next
(125B mixture of experts), on one consumer NVIDIA card. The busiest experts sit in VRAM, all of them in RAM, and the
n-gram lookup table is read off the SSD. It is a vertical solution with a fixed model table, not a general server: it
loads nothing else. Its quantizations (GSQ-RCO, 2 to 3.5 bits) are far smaller than the 4-bit or mixed 4/8-bit
packs the other Flash-Next combinations run, so a score here measures the engine and the quantization together.

## What this combination runs

| | |
|---|---|
| Strata | v0.1.39, pinned by commit `6f32ec07` |
| Weights | `ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF` at `ed59f920`, IQ3_XXS (75.8 GB in two files, sha256-checked) |
| Why IQ3_XXS | the owner's choice: IQ3_S needs 62 GB of RAM with little else running, and a story also runs the agent, browsers and test servers on the same machine |
| Context | 131,072 tokens (the benchmark's minimum), KV cache int8 |
| Drafting | MTP, from the original Qwen checkpoint (about 5 GB, fetched by Strata's setup) |
| Sampling | temperature 1.0, top-p 0.95, top-k 20; reasoning effort low (pi sends none) |
| VRAM reserve | 969 MiB, as Strata's own startup warning asked |

## What was measured

On 2 Oct 2026, nothing else running: ready in about 25 s; 42.7 GiB RAM and 23.8 GiB VRAM resident; structured tool
calls with a newline inside a string argument kept; a 128k-token conversation read at about 4,400 tokens/s the first
time and then reused all but the new tokens (about 1 s a turn); 104 to 173 tokens/s on short replies. Details, and
what these tests do not show, are in `horizon/strata.md`.

## How the install differs

- The two GGUF files are fetched as 1 GiB segments over 16 connections and hash-checked, not by Strata's downloader
  (one connection per file: 0.2 to 0.5 MB/s against 8 to 20 MB/s). Strata's setup then accepts them as already there.
- Strata's setup needs a Python with venv and a cmake newer than Ubuntu 22.04's; both come from inside its own folder
  and a uv-managed Python, nothing system-wide.
- The launcher derives its run configuration from the one setup wrote and never changes setup's file.

## The disk

The model files and Strata's packs are about 85 GB under `~/.local/share/awesome-local-ai/strata/`. See
`docs/rtx4090-disk.md` for the machine's disk layout.
