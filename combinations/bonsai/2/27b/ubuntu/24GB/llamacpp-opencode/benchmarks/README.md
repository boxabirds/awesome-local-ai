# Benchmarks — Ternary Bonsai 2 27B, Ubuntu, 24GB NVIDIA

Every number in this combination's `config.sh`, `profiles.tsv`, `help.txt` and
`README.md` comes from a run recorded here.

## Hardware and build

```
GPU        NVIDIA GeForce RTX 4090, 24564 MiB total, 24047 MiB usable
Desktop    463 MiB held by Xorg + gnome-shell throughout
OS         Ubuntu 22.04.5 LTS, kernel 6.8.0-138
Driver     580.159.03 (CUDA 13.0 capable)
Toolkit    CUDA 12.3.107
Backend    PrismML-Eng/llama.cpp @ 5d80cff (release prism-b10687), -DGGML_CUDA=ON
           -DCMAKE_CUDA_ARCHITECTURES=89, ggml 0.21.0
Comparison ggml-org/llama.cpp @ 972d231, ggml 0.24.0 (what this repo installs
           for the Qwen combination)
Weights    Ternary-Bonsai-2-27B-PQ2_0.gguf   7,206,168,928 bytes
           Ternary-Bonsai-2-27B-PTQ1_0.gguf  5,946,648,928 bytes
           Ternary-Bonsai-2-27B-mmproj-Q8_0.gguf  629,246,976 bytes
```

`need_mib` in `profiles.tsv` is **measured total minus 463**, the desktop's
share. The launcher pre-flights against that server-only figure.

## The harnesses

`probe.sh` here is the profile prober: it is
[`benchmarks/refit.sh`](../../../../../../../../benchmarks/refit.sh) with the
MTP/draft flags removed and the binary path pointed at the fork. It starts a
server, waits for `/health`, reads `nvidia-smi`, sends a ~6,000-token prompt and
reads the server's own prompt-eval rate, then kills it.

Depth curves are plain `llama-bench -d`, which is not in `refit.sh`'s
repertoire — see [what should change](#what-should-change-upstream-in-this-repo).

```bash
# profile fits and prefill
./probe.sh

# decode vs context depth
llama-bench -m <model> -n 128 -p 0 -d 0,8192,32768,131072 -fa 1 -ngl 99 -r 2
```

## Results

### Decode vs context depth — `logs/depth-*.log`

f16 KV unless stated. This is the table that matters: depth-0 numbers flatter
every model.

| depth | Bonsai PQ2_0 | Bonsai PTQ1_0 | Bonsai PTQ1_0 (q4_0 KV) | Qwen3.8 UD-Q4_K_XL (q4_0 KV) |
|---|---|---|---|---|
| 0 | 92.24 ± 0.51 | 98.47 ± 1.12 | 95.91 ± 0.98 | 46.05 ± 0.15 |
| 8,192 | 87.59 ± 0.30 | 92.83 ± 1.02 | — | 44.86 ± 0.22 |
| 32,768 | 75.97 ± 0.36 | 80.03 ± 0.62 | 78.46 ± 0.73 | 41.63 ± 0.11 |
| 131,072 | 49.91 ± 0.06 | 51.70 ± 0.06 | 50.85 ± 0.11 | 32.38 ± 0.04 |

Both Bonsai packings lose ~46% from depth 0 to 128k; Qwen loses ~30%. The
ternary weights are cheap enough to stream that attention dominates sooner, so
the *relative* decay is steeper while the absolute rate stays higher at every
depth. q4_0 KV costs Bonsai about 2% of decode.

### Prompt processing — `logs/depth-bonsai-f16kv.log`

| | pp512 | pp2048 |
|---|---|---|
| PQ2_0 | 3,239 ± 137 | 3,319 ± 18 |
| PTQ1_0 | 1,645 ± 85 | 1,690 ± 0.4 |

PQ2_0 prefills at roughly double PTQ1_0, which is why it is the default. The
publisher's own RTX 4090 row reports 3,124 / 1,645 pp512 — this reproduces it.

### Profile fits — `logs/pq2-*.log`, `logs/ptq1-*.log`

Measured total VRAM with the server up, and the server's own prompt-eval rate.

| packing | ctx | KV | vision | VRAM | free | prefill |
|---|---|---|---|---|---|---|
| PQ2_0 | 32,768 | q4_0 | off | 8,454 | 15,593 | 3,015 |
| PQ2_0 | 131,072 | q4_0 | off | 10,663 | 13,384 | 3,016 |
| PQ2_0 | 131,072 | q8_0 | off | 12,711 | 11,336 | 3,022 |
| PQ2_0 | 131,072 | q4_0 | **on** | 11,515 | 12,532 | 3,019 |
| PQ2_0 | 262,144 | q4_0 | off | 13,607 | 10,440 | 3,013 |
| PQ2_0 | 262,144 | q4_0 | **on** | 14,459 | 9,588 | 3,031 |
| PQ2_0 | 262,144 | f16 | off | **FAILED** | — | — |
| PTQ1_0 | 32,768 | f16 | off | 8,699 | 15,348 | 1,603 |
| PTQ1_0 | 131,072 | f16 | off | 14,939 | 9,108 | 1,603 |
| PTQ1_0 | 131,072 | q4_0 | off | 9,519 | 14,528 | 1,597 |
| PTQ1_0 | 262,144 | f16 | off | 23,259 | 788 | 1,604 |
| PTQ1_0 | 262,144 | q4_0 | off | 12,463 | 11,584 | 1,597 |

The one failure, `logs/pq2-262k-f16.log`:

```
ggml_backend_cuda_buffer_type_alloc_buffer: allocating 390.02 MiB on device 0:
    cudaMalloc failed: out of memory
graph_reserve: failed to allocate compute buffers
```

PTQ1_0 *does* hold 262k at f16, with 788 MiB to spare. So the ceiling is the
KV type plus the extra 1.17 GiB of PQ2_0 weights, not the context length.

### KV cache types — `logs/kv-*.log`

PQ2_0 at 32,768, by prefill rate:

| KV type | prefill | VRAM |
|---|---|---|
| f16 | 3,041 | 9,842 |
| q8_0 | 3,015 | 8,966 |
| q4_0 | 3,015 | 8,454 |
| **q5_1** | **28.4** | 8,530 |

A 106x collapse on q5_1, with no warning from llama.cpp — the same silent
CPU-attention fallback the Qwen combination documents, and worse here. `f16`,
`q8_0` and `q4_0` were the only types measured to keep a GPU kernel, so they
are the only three in `SAFE_KV_TYPES`. `bf16` was not tested.

### Stock llama.cpp refuses these files

Against `ggml-org/llama.cpp @ 972d231`, the build this repo installs for Qwen:

```
gguf_init_from_reader: tensor 'output.weight' has invalid ggml type 143.
                       should be in [0, 43)
llama_model_load: error loading model
```

Both shipped packings fail this way, which is the safe failure. The publisher
warns that the separately-published `Q2_0` band does **not** — mainline loads
it silently and emits gibberish. This combination never fetches that band.

### Speculative decoding with a borrowed MTP head

Bonsai 2 ships no drafter. The architecture is unchanged from Qwen3.8-27B, so
`ggml-org`'s `mtp-Qwen3.8-27B-Q4_0.gguf` — already on disk for the Qwen
combination — was pointed at it with `--spec-type draft-mtp --spec-draft-n-max 2`.
Identical prompt, `temperature 0`, PTQ1_0, 16,384 context:

| | tok/s | draft_n | accepted | acceptance |
|---|---|---|---|---|
| no drafter | 95.78 | — | — | — |
| Qwen MTP head | 92.61 | 534 | 332 | 0.622 |

It drafts, and at a respectable rate. It is still a net loss, because the
ternary target is too cheap for a 1.6 GiB drafter to amortise. Recorded because
a negative result with a number is more useful than an absent one.

### Behaviour

One server load, `--jinja`, PTQ1_0, 32,768 context.

*Tool calling* — works; returns a well-formed `tool_calls` entry with correct
arguments.

*The `max_tokens` trap*, worse here than on the Qwen sibling because the
default reasoning effort is higher:

| max_tokens | finish_reason | reasoning chars | content chars |
|---|---|---|---|
| 200 | `length` | 731 | **9** |
| 600 | `stop` | 331 | 354 |
| 4,096 | `stop` | 375 | 302 |

*Reasoning effort* — `low`, `medium` and `xhigh` were all accepted without
error, contradicting nothing but establishing nothing either: at n=1 and
temperature 1.0 the token counts were within noise of each other and `low`
produced *fewer* reasoning characters than `medium`, which is the opposite of
what the model card implies. **Not settled.** The right instrument is
[`benchmarks/effort.sh`](../../../../../../../../benchmarks/effort.sh), 5 prompts,
greedy, one model load; it has not been run against this combination.

### Two servers on one card

`PROFILE=coding` (131,072 ctx, q4_0 KV), PQ2_0, two independent processes:

| | VRAM | decode |
|---|---|---|
| server A alone | 10,663 | 87.64 tok/s |
| A + B both up | 20,860 (3,187 free) | — |
| A and B generating concurrently | 20,860 | 41.43 / 41.37 tok/s |

Both served correctly. Aggregate throughput is flat, so this buys isolation and
context, not speed. A single server with `NP=2` shares one copy of the weights
and was **not** measured — see below.

## What was NOT measured

Listed so the gaps are visible rather than implied:

- Benchmark quality scores. Every accuracy figure quoted in this combination is
  the publisher's.
- `bf16` KV.
- Retrieval quality at 262k (`run-niah.sh` exists and was not run).
- `effort.sh` against this model.
- One server with `NP=2` versus two servers.
- Any card other than a 24GB RTX 4090.
- `PACKING=PTQ1_0` end-to-end through the installer; the depth and fit numbers
  above come from direct `llama-bench`/`llama-server` runs.

## Shared-code problems this combination exposed

Adding a **second** llama.cpp combination surfaced a collision that was latent
while there was only one.

**Fixed here:**

1. `~/.local/bin/llama-server` is a single symlink shared by every llama.cpp
   combination, and `_llamacpp_link` repoints it on every install — so the most
   recently installed combination won. `lib/runtime/server-llamacpp.sh` then did
   `exec llama-server`, resolving from `PATH`. Installing Bonsai 2 therefore
   pointed the **Qwen** combination at the PrismML fork's binary, silently. The
   runtime now resolves `$ROOT/llama.cpp/build/bin/llama-server` from its own
   install root and only falls back to `PATH` with a warning. `_llamacpp_link`
   additionally installs per-install names (`llama-server-<install-id>`).
2. `llama-bench` was not linked at all, though `llama-cli` and `llama-server`
   were; every depth measurement here needed the full build path. It is now
   linked with the others.

**Still open:**

3. `benchmarks/refit.sh` hardcodes `-md "$MTP" --spec-type draft-mtp`, so a
   combination with no drafter cannot use it unmodified — which is why
   `probe.sh` exists here. The draft flags should come from the manifest.
4. `benchmarks/lib.sh` reaches into `$ROOT/llama.cpp/build/bin/llama-server`
   directly rather than going through the installed shims. Correct for both
   current combinations, but it is the same assumption that caused (1).
