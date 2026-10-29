# Qwen3.8-Flash-Next · DGX OS (Ubuntu 24.04) · DGX Spark · llama.cpp (CUDA) + MTP + pi

The baseline for the NVIDIA DGX Spark: Qwen3.8-Flash-Next (125B total, about
6B active per token) from Unsloth's `UD-IQ4_XS` GGUF with its MTP draft head,
served by llama.cpp on CUDA, driven by pi.

**It is the Strix Halo combination with the machine changed.** The llama.cpp
branch, quant, MTP head, KV type, sampling, reasoning effort, batch, load mode,
draft depth, profiles and client are those of
[`strix-halo-128GB/llamacpp-pi`](../../strix-halo-128GB/llamacpp-pi/README.md),
so a score set beside that one, or the M5 Max's
[`macos/128GB/llamacpp-pi`](../../../macos/128GB/llamacpp-pi/README.md), differs
by the hardware alone. `tests/dgx-spark-test.sh` holds the two configs equal on
those keys. An engine built for the Spark (vLLM with NVFP4, say) is a separate
combination, read against this one.

> **NOT MEASURED BY THIS REPO YET.** Every memory figure in
> [`profiles.tsv`](profiles.tsv) is the Strix Halo estimate, and it is marked
> `AUTO_SELECT=0`. The benchmark runs are the record.

## The machine

A DGX Spark is a GB10: an Arm (aarch64) CPU and a Blackwell GPU of compute
capability 12.1 (sm_121) sharing 128 GB of LPDDR5x. As read on one, 29 Oct 2026:
DGX OS on Ubuntu 24.04.5, kernel 7.0.0-1019-nvidia, driver 580.178.04, CUDA 13.0
at `/usr/local/cuda`, MemTotal 124,608 MiB.

`nvidia-smi` answers `[N/A]` for the GB10's memory. The installer qualifies
against MemTotal instead, and the launcher's pre-flight budgets from
MemAvailable (`lib/accel/cuda.sh`, `lib/select.sh`,
`lib/runtime/server-llamacpp.sh`).

## Install

```bash
./install-qwen-3.8-flash-next-ubuntu-dgx-spark-llamacpp-pi.sh
```

It builds llama.cpp from the MTP pull request's branch for sm_121, downloads
about 97.4 GB (the three `UD-IQ4_XS` shards, the MTP head and the vision
projector), writes the runtime, loads the model once and checks it generates.
pi must be on PATH. Making the machine a benchmark node is
[docs/dgx-spark-node-setup.md](../../../../../../../docs/dgx-spark-node-setup.md).

| Override | Effect |
|---|---|
| `QUANT=UD-Q4_K_XL` | the 111 GB quant: tight on memory, and no longer the Strix Halo baseline |
| `MTP_QUANT=shared-Q4_K_M` | the 1.91 GB draft head instead of the 2.79 GB `shared-Q8_0` |
| `SKIP_SMOKE_TEST=1` | everything but the model load |
| `SKIP_BACKEND_UPDATE=1` | keep the llama.cpp checkout you have |

## What it serves

The Strix Halo profiles, unchanged: `coding` (128k, one slot, the default),
`vision`, `agents` (3 x 128k) and `max` (256k). See `help.txt`.
