# Qwen3.6-35B-A3B EXL3 · Ubuntu · 24GB NVIDIA (RTX 3090) · SGLang + OpenCode

**Combination:** `qwen/3.6/35b-a3b/ubuntu/24GB/sglang-opencode`
**Install:** `./install-qwen-3.6-35b-a3b-ubuntu-24GB-sglang-opencode.sh` (from the repo root)

> **Not measured by this repo.** Every number on this page was measured by the
> recipe's author on a **bare RTX 3090 24 GB** and published in
> [0xSero/local-ai-registry PR #83](https://github.com/0xSero/local-ai-registry/pull/83).
> The registry itself lists this recipe as **`candidate`**, not `validated`.
> Nobody has run this combination through this installer, and this repo owns
> no RTX 3090. If you have one, see [first run](#first-run-for-a-3090-owner).

Qwen3.6-35B-A3B — a mixture-of-experts model, 256 routed experts, ~3B active
per token — quantised to 3.00 bpw EXL3 with a 5-bit head by yeasah, served by
stock SGLang v0.5.20 through the `sglang-exl3` plugin from one digest-pinned
container image, with NEXTN (MTP) speculative decoding, fp8 KV cache and the
full 262,144-token window on a single 24 GB card.

```bash
./install-qwen-3.6-35b-a3b-ubuntu-24GB-sglang-opencode.sh   # image ~15.4 GB + weights 15.92 GB
qwen36-35b-a3b-exl3-sglang-opencode                         # server on demand + OpenCode
```

`./install.sh` never picks this automatically. Name it to install it.

---

## Read before installing

| | |
|---|---|
| **Numbers** | Recipe author's, bare RTX 3090, 2026-09-23. Not reproduced here. |
| **Registry status** | `candidate`, `recommended: false`. PR [#92](https://github.com/0xSero/local-ai-registry/pull/92) made the registry's trust rule forbid `--disable-prefill-cuda-graph`, which this argv uses, *"so the 35B-A3B recipe returns to candidate"*. The argv itself is unchanged since #83. |
| **GPU architecture** | Kernels built **only for sm_86**. RTX 4090 (sm_89) / 5090 (sm_120) **UNVERIFIED** — see [below](#gpu-architecture). Warned, not refused. |
| **Quality vs speed** | 3.00 bits per weight (head 5 bits). This repo has no other build of this model to compare with; the recipe notes the AWQ-INT4 build (25 GB) does not fit a 24 GB card. Speed at 3 bpw is not a like-for-like claim on quality against any 4-bit build, and no quality measurement exists. |
| **Bare card** | The 262k window needs the whole card; a GPU that also drives a desktop (~5 GB used) cannot hold it. `PROFILE=desktop` is **extrapolated** and, by its own arithmetic, marginal. |
| **Image boot** | PR #83 at merge: *"the published v0.5.1 image has not yet been booted with these exact argv. v0.4.0 was, and passed."* The registry records a later boot of the published image for the 27B recipe only — none for this one. |
| **OS** | The author's box is named "omarchy" (an Arch Linux-based setup). The serving path is a container; Ubuntu itself has not run it. |

## Requirements

Identical to the [27B SGLang combination](../../../../../3.8/27b/ubuntu/24GB/sglang-opencode/README.md#requirements):
NVIDIA GPU >= 23,000 MiB (sm_86 tested), a driver that supports CUDA >= 13.0,
Docker, and the NVIDIA Container Toolkit (proven by running `nvidia-smi -L`
inside the image). Disk: ~15.4 GB compressed image (shared with the 27B) +
15.92 GB weights.

## What it installs

| | |
|---|---|
| Image | `ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8` (v0.5.1-ampere), by digest |
| Weights | `yeasah/Qwen3.6-35B-A3B-exl3` at revision `73da68ef827084d72c59936b4c2088c6580f4e2b`, into `~/.cache/awesome-local-ai/sglang-models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5`. The recipe JSON carries no hashes for this checkpoint, so the shards are verified against Hugging Face's published LFS sha256 at that revision (read 2026-09-24). |
| Commands | `qwen36-35b-a3b-exl3-sglang-server`, `qwen36-35b-a3b-exl3-sglang-opencode`, `qwen36-35b-a3b-exl3-sglang-pi` |
| API | `http://127.0.0.1:30000/v1`, model id `Qwen3.6-35B-A3B-EXL3-3.00bpw-H5` (the recipe's served name) |

The 27B and this share port 30000 by default; run one at a time or set `PORT`.

## Exact launch

Default `full` profile (`GPU_DEVICE=0`, `PORT=30000`):

```
docker run --rm --name qwen36-35b-a3b-exl3-sglang-30000 --gpus device=0 --shm-size 16g --network bridge \
  -p 127.0.0.1:30000:30000 \
  -v $HOME/.cache/awesome-local-ai/sglang-models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5:/models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5:ro \
  -e CUDA_DEVICE_ORDER=PCI_BUS_ID -e HF_HUB_OFFLINE=1 -e SGLANG_EXL3_KERNEL=auto \
  -e SGLANG_EXL3_MODEL_PATH=/models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5 \
  ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8 \
  python3 -m sglang.launch_server \
    --model-path /models/Qwen3.6-35B-A3B-EXL3-3.00bpw-H5 --quantization exl3 --trust-remote-code \
    --kv-cache-dtype fp8_e4m3 --mamba-ssm-dtype bfloat16 --max-running-requests 2 --max-mamba-cache-size 10 \
    --cuda-graph-max-bs-decode 2 --chunked-prefill-size 2048 --max-prefill-tokens 4096 \
    --reasoning-parser qwen3 --tool-call-parser qwen3_coder \
    --speculative-algorithm NEXTN --speculative-num-steps 3 --speculative-eagle-topk 1 \
    --speculative-num-draft-tokens 4 --speculative-token-map /opt/sglang-exl3/tokenmaps/qwen36_hot32k_v2.pt \
    --disable-shared-experts-fusion \
    --host 0.0.0.0 --port 30000 --served-model-name Qwen3.6-35B-A3B-EXL3-3.00bpw-H5 \
    --context-length 262144 --mem-fraction-static 0.85 --disable-prefill-cuda-graph
```

That is the recipe's `launch` block verbatim, with its flags regrouped: the
profile owns the last line. Nothing is added unless `THINKING=0`
(`--default-chat-template-kwargs '{"enable_thinking": false}'`).

## Profiles

| Profile | ctx | mem-fraction | prefill graphs | Basis |
|---|---|---|---|---|
| `full` (default) | 262,144 | 0.85 | off | **Recipe author**, bare 3090 — all the numbers below |
| `desktop` | 32,768 | 0.92 | off | **EXTRAPOLATED**, never run, may OOM. Arithmetic in [`profiles.tsv`](profiles.tsv) |

## Recipe numbers (author-measured on a bare RTX 3090; not measured by this repo)

Profile `full`, fp8 KV, MTP on (NEXTN 3 steps / 4 draft tokens), from
`speed-sweep/qwen36-35b-a3b-exl3-3bpw-rtx3090-sglang-tp1-sweep.json`.
Per-stream decode tok/s; C2 also shows the two-stream aggregate.

| Workload | C1 think off | C1 think on | C2 think off (per stream / aggregate) |
|---|---|---|---|
| Prose, short prompt | 251.9 | 329.4 | 202.8 / 388.5 |
| Code, short prompt | 352.1 | 367.2 | 276.9 / 531.5 |
| Prose, 32k prompt | 214.3 | 287.9 | 113.1 / — |
| Code, 32k prompt | 294.8 | 302.0 | 86.9 / — |
| Cold prefill, 32k prompt | 4,517–4,569 tok/s (TTFT 7.3 s) | | |

- Coherence ladder OK at 1k, 4k, 8k, 16k, 32k, 131k and 257,971 prompt tokens (TTFT 172 s at the top).
- 10-minute soak, two streams at 32k: 63 requests, 0 failed, drift −1.1%.
- Peak device memory 21.90 GiB; KV pool 406,145 tokens.

## GPU architecture

Quoted from the sources:

- PR #83: *"EXL3 on RTX 3090 (sm_86)"*; *"Marlin-template EXL3 kernels for sm_86 at K=3/4/5 (ported from the Hopper work), plus a grouped EXL3 kernel for the 35B's 256 routed experts"*; *"exllamav3 1.5.1 AOT for sm_86"*; tag *"v0.5.1-ampere"*.
- Recipe JSON: `hardware_id: "rtx-3090-24gb"`; no other architecture stated either way.
- Image config (read from the registry, not pulled): `TORCH_CUDA_ARCH_LIST=8.6`.
- Plugin: *"Ampere sm_86 first"*; quantization config minimum capability 80.

Inference, **not test**: sm_86 kernels may load on sm_89 (RTX 4090) under
NVIDIA's same-major-version compatibility rule; kernels built for 8.6 without
PTX are not expected to load on sm_120 (RTX 5090). Please report either way.

## First run (for a 3090 owner)

The installer's smoke test (scratch port 18080, up to 900 s to become healthy) proves:

1. the container starts and `/health` answers;
2. `/v1/models` reports the served context (`max_model_len`);
3. a chat completion returns content (thinking off for that one request);
4. **speculative decoding is live** — a native `/generate` request must report
   `meta_info.spec_verify_ct > 0` and `spec_accept_length > 1` (field names
   read from SGLang's source at the image's commit; not yet seen on hardware here).

It does not prove the 262k window, the speeds, or quality. Please send back:

```bash
./install-qwen-3.6-35b-a3b-ubuntu-24GB-sglang-opencode.sh 2>&1 | tee first-run.txt
nvidia-smi --query-gpu=name,compute_cap,driver_version,memory.total,memory.used --format=csv
nvidia-smi | head -4
docker --version; nvidia-ctk --version
grep -E 'max_total_num_tokens|KV Cache|accept len|Capture cuda graph|ERROR' \
  ~/.local/share/qwen36-35b-a3b-exl3-sglang/smoke.log | head -40
```

plus the smoke summary (accept length, served context), whether the card drives
a display, and if possible one prose and one code request's tok/s with thinking off.

## Credits and licences

- Recipe, image, plugin and numbers: **0xSero** —
  [local-ai-registry](https://github.com/0xSero/local-ai-registry) (MIT);
  [local-ai-images](https://github.com/0xSero/local-ai-images) (public, no licence file as of 2026-09-24).
  The `sglang-exl3` plugin ships in the image with a NOTICE but no licence file
  or field; its GitHub repo was not publicly reachable — licence **unstated**.
- EXL3 and ExLlamaV3: **turboderp** ([exllamav3](https://github.com/turboderp-org/exllamav3), MIT). The plugin
  bundles ExLlamaV3 code (MIT) and vLLM's Marlin kernels (Apache-2.0).
- The 3.00 bpw-H5 quant: **yeasah**, [`yeasah/Qwen3.6-35B-A3B-exl3`](https://huggingface.co/yeasah/Qwen3.6-35B-A3B-exl3) (card licence: apache-2.0).
- The model: **Qwen team**, Qwen3.6-35B-A3B.
- Engine: [SGLang](https://github.com/sgl-project/sglang) (Apache-2.0), base image `lmsysorg/sglang:v0.5.20`.
