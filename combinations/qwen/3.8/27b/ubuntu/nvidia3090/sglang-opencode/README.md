# Qwen3.8-27B EXL3 · Ubuntu · 24GB NVIDIA (RTX 3090) · SGLang + OpenCode

**Combination:** `qwen/3.8/27b/ubuntu/nvidia3090/sglang-opencode`
**Install:** `./install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh` (from the repo root)

> **Not measured by this repo.** Every number on this page was measured by the
> recipe's author on a **bare RTX 3090 24 GB** and published in
> [0xSero/local-ai-registry PR #83](https://github.com/0xSero/local-ai-registry/pull/83)
> (with a follow-up in [#92](https://github.com/0xSero/local-ai-registry/pull/92)).
> Nobody has run this combination through this installer yet, and this repo
> owns no RTX 3090. If you have one, the [first run](#first-run-for-a-3090-owner)
> section says what to send back so it can be marked MEASURED.

Qwen3.8-27B quantised to 3.00 bpw EXL3 by turboderp, served by stock SGLang
v0.5.20 through the `sglang-exl3` quantization plugin, from one digest-pinned
container image, with NEXTN (MTP) speculative decoding, fp8 KV cache and the
model's full 262,144-token window on a single 24 GB card.

```bash
./install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh   # image ~15.4 GB + weights 13.84 GB
qwen38-27b-exl3-sglang-opencode                         # server on demand + OpenCode
```

`./install.sh` never picks this automatically — the measured llama.cpp 27B
combination stays the default for a 24 GB card. Name it to install it.

---

## Read before installing

| | |
|---|---|
| **Numbers** | Recipe author's, bare RTX 3090, 2026-09-23. Not reproduced here. |
| **GPU architecture** | Kernels built **only for sm_86** (Ampere GA102: RTX 3090 / 3090 Ti / A6000-class). RTX 4090 (sm_89) and 5090 (sm_120) are **UNVERIFIED** — see [below](#gpu-architecture). The installer and launcher detect `compute_cap` and warn on anything but 8.6; they do not refuse. |
| **Quality vs speed** | 3.00 bits per weight. The [llama.cpp 27B combination](../../nvidia4090/llamacpp-opencode/README.md) uses UD-Q4_K_XL (16.7 GiB, roughly 5.3 bits per weight by file size, against 13.84 GB here). This one is faster per the recipe, but on a *lower-bit* quantization: the speed comparison is **not like-for-like on quality**, and no quality comparison between the two has been made by anyone we know of. |
| **Bare card** | The 262k window needs the whole card. A GPU that also drives a desktop (~5 GB used) cannot hold it — the recipe's words — so use `PROFILE=desktop`, which is **extrapolated**. |
| **Image boot** | PR #83 stated, at merge: *"the published v0.5.1 image has not yet been booted with these exact argv. v0.4.0 was, and passed."* The registry's main branch has since recorded an `image_boot` for this recipe (2026-09-23T13:09Z, bare 3090: ready in 80 s, "216-token code answer at 127 tok/s", engine restarts 0). It does not say which of the two argv variants below that was. |
| **OS** | The author's test box is named "omarchy" in the recipe (Omarchy is an Arch Linux-based setup). Nothing in the serving path depends on the distro — it is a container — but Ubuntu itself has not run it. |

## Requirements

Checked by the installer, which refuses with the exact fix if one is missing:

| | Requirement | Source |
|---|---|---|
| GPU | NVIDIA, >= 23,000 MiB, sm_86 tested | recipe `hardware_id: rtx-3090-24gb` |
| Driver | supports CUDA >= 13.0 (r580+) — checked against `nvidia-smi`'s "CUDA Version" | image env `NVIDIA_REQUIRE_CUDA=cuda>=13.0` |
| Docker | Engine running, your user can reach the daemon | — |
| NVIDIA Container Toolkit | `nvidia` runtime registered, or CDI via `nvidia-ctk`; proven by running `nvidia-smi -L` inside the image | — |
| Disk | ~15.4 GB compressed image (larger unpacked) + 13.84 GB weights | registry manifest; model-instance JSON |
| Host RAM | the 2.4 GB bf16 token embedding is kept in pinned host memory (`SGLANG_EXL3_EMBED_HOST=1`) | recipe |

The installer does not install Docker or the toolkit; it prints the commands.

## What it installs

| | |
|---|---|
| Image | `ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8` (v0.5.1-ampere). Pulled by digest. Provenance: `gh attestation verify oci://ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8 -o 0xSero` |
| Weights | `turboderp/Qwen3.8-27B-exl3` at revision `6fe61ad620abfe97c5b49f9722c2bceeea4ccc28`, into `~/.cache/awesome-local-ai/sglang-models/turboderp-Qwen3.8-27B-exl3-3.00bpw`, then sha256-verified against the two shard hashes in the recipe. A marker keyed by the revision makes re-runs a no-op. |
| Commands | `qwen38-27b-exl3-sglang-server`, `qwen38-27b-exl3-sglang-opencode`, `qwen38-27b-exl3-sglang-pi` |
| API | `http://127.0.0.1:30000/v1`, model id `turboderp-Qwen3.8-27B-exl3-3.00bpw` (the recipe's served name) |

## Exact launch

The launcher runs, for the default `full` profile (`GPU_DEVICE=0`, `PORT=30000`):

```
docker run --rm --name qwen38-27b-exl3-sglang-30000 --gpus device=0 --shm-size 16g --network bridge \
  -p 127.0.0.1:30000:30000 \
  -v $HOME/.cache/awesome-local-ai/sglang-models/turboderp-Qwen3.8-27B-exl3-3.00bpw:/models/turboderp-Qwen3.8-27B-exl3-3.00bpw:ro \
  -e CUDA_DEVICE_ORDER=PCI_BUS_ID -e HF_HUB_OFFLINE=1 -e SGLANG_EXL3_EMBED_HOST=1 \
  -e SGLANG_EXL3_KERNEL=auto -e SGLANG_EXL3_MODEL_PATH=/models/turboderp-Qwen3.8-27B-exl3-3.00bpw \
  ghcr.io/0xsero/sglang-exl3@sha256:84f75f3424c99a3d63392a4e0348292bdeba9cf7efba2ff1aa9b85c8fc0131e8 \
  python3 -m sglang.launch_server \
    --model-path /models/turboderp-Qwen3.8-27B-exl3-3.00bpw --quantization exl3 --trust-remote-code \
    --kv-cache-dtype fp8_e4m3 --mamba-ssm-dtype bfloat16 --max-running-requests 1 --max-mamba-cache-size 5 \
    --cuda-graph-max-bs-decode 1 --chunked-prefill-size 1024 --max-prefill-tokens 1024 \
    --reasoning-parser qwen3 --tool-call-parser qwen3_coder \
    --speculative-algorithm NEXTN --speculative-num-steps 3 --speculative-eagle-topk 1 \
    --speculative-num-draft-tokens 4 --speculative-token-map /opt/sglang-exl3/tokenmaps/qwen38_hot32k_v2.pt \
    --host 0.0.0.0 --port 30000 --served-model-name turboderp-Qwen3.8-27B-exl3-3.00bpw \
    --context-length 262144 --mem-fraction-static 0.88 --disable-prefill-cuda-graph \
    --default-chat-template-kwargs '{"reasoning_effort": "low"}'
```

Everything up to `--served-model-name` is the recipe's `launch` block
verbatim. The last two lines are the profile and the one addition this repo
makes (reasoning effort, below). `PROFILE=graphs` changes the last-but-one line
to `--context-length 204800 --mem-fraction-static 0.80` with prefill graphs on,
which is the argv on the registry's main branch today.

## Profiles

| Profile | ctx | mem-fraction | prefill graphs | Basis |
|---|---|---|---|---|
| `full` (default) | 262,144 | 0.88 | off | **Recipe author**, PR #83 argv, bare 3090 — all the numbers below |
| `graphs` | 204,800 | 0.80 | on | **Recipe author**, PR #92: "every graph captures (1.37 GB) with a 212,823-token KV pool"; 93–137 tok/s on short answers; no sweep |
| `desktop` | 49,152 | 0.80 | on | **EXTRAPOLATED**, never run. Arithmetic in [`profiles.tsv`](profiles.tsv) |

## Recipe numbers (author-measured on a bare RTX 3090; not measured by this repo)

Profile `full`, per-stream decode, C1, fp8 KV, MTP on (NEXTN 3 steps / 4 draft
tokens), from `speed-sweep/qwen38-27b-exl3-3bpw-rtx3090-sglang-tp1-sweep.json`:

| Workload | Thinking off | Thinking on |
|---|---|---|
| Prose, short prompt | 98.8 tok/s | 146.6 tok/s |
| Code, short prompt | 143.3 tok/s | 113.9 tok/s |
| Prose, 32k prompt | 89.6 tok/s | 112.1 tok/s |
| Code, 32k prompt | 124.0 tok/s | 107.0 tok/s |
| Cold prefill, 32k prompt | 904 tok/s (TTFT 36.3 s) | |

- Coherence ladder OK at 1k, 4k, 8k, 16k, 32k, 131k and 258,040 prompt tokens (TTFT 544 s at the top).
- 10-minute soak at 32k: 14 requests, 0 failed, drift 6.5%.
- Peak device memory 23.04 GiB; KV pool 272,369 tokens.
- Reference from the same PR: Qwen3.8-27B AWQ-INT4 in SGLang on a bare 3090, no draft: 45.1 tok/s prose, 40k window.

The plugin's own README (inside the image) also reports a desktop-resident run
(~19 GiB usable, ExLlamaV3 kernels rather than the Marlin-template ones):
61.7 tok/s prose, 88.7 code. That is a different configuration from any
profile here and is quoted only as the one desktop data point that exists.

## GPU architecture

What the sources say, quoted:

- PR #83 title and body: *"EXL3 on RTX 3090 (sm_86)"*; *"Marlin-template EXL3 kernels for sm_86 at K=3/4/5"*; image contents *"exllamav3 1.5.1 AOT for sm_86"*; image tag *"v0.5.1-ampere"*.
- The recipe JSON: `hardware_id: "rtx-3090-24gb"`. It states no other architecture, supported or unsupported.
- The image config (read from the registry, not pulled): `TORCH_CUDA_ARCH_LIST=8.6`.
- The plugin (`sglang_exl3`, inside the image): *"Ampere sm_86 first"*; its quantization config declares `get_min_capability() -> 80`.

Nothing says it cannot run elsewhere, so the installer warns rather than
refuses. What we would expect, which is **inference, not test**: NVIDIA's
binary-compatibility rule lets sm_86 kernels load on sm_89 (same major
version), so an RTX 4090 *may* work, at unknown speed; kernels built for 8.6
without PTX are not expected to load on sm_120 (RTX 5090), so expect a failure
at model load there. Whoever runs either, please report it.

## Reasoning effort and thinking

SGLang v0.5.20 has `--default-chat-template-kwargs`, applied to every request
that does not set its own (read from SGLang's source at the commit the image
is labelled with, `94602c9c`). This repo uses it the way it uses MTPLX's
`--reasoning-effort`: server-side, because OpenCode drops a per-request effort.

- Default `low`, as in the llama.cpp 27B combination. The template at this
  revision defaults to `xhigh` and **raises** on anything but `xhigh`,
  `medium`, `low`; the launcher refuses an unknown `REASONING_EFFORT` before
  loading. `REASONING_EFFORT=default` passes nothing, which is what the recipe ran.
- `THINKING=0` sets `enable_thinking=false`.
- The recipe's thinking-on figures were measured at the template default
  (`xhigh`). Effort changes how many tokens are produced, not the rate — this
  repo measured that for llama.cpp, not for this stack.

## First run (for a 3090 owner)

What the installer's smoke test proves, on a scratch port (18080):

1. The container starts and `/health` answers (up to 900 s — first boot captures CUDA graphs).
2. `/v1/models` reports the served context (`max_model_len`).
3. A chat completion returns non-empty content (thinking off for this one request).
4. **Speculative decoding is live**: a native `/generate` request must report
   `meta_info.spec_verify_ct > 0` and `spec_accept_length > 1`. Without
   drafting there is exactly one token per forward pass and SGLang does not
   emit those fields. (Field names read from SGLang's `tokenizer_manager.py`
   at the image's commit; not yet seen on hardware by this repo.)

It does **not** prove the 262k window, the speeds, or quality.

Please send back (an issue or a PR editing this README):

```bash
./install-qwen-3.8-27b-ubuntu-nvidia3090-sglang-opencode.sh 2>&1 | tee first-run.txt
nvidia-smi --query-gpu=name,compute_cap,driver_version,memory.total,memory.used --format=csv
nvidia-smi | head -4                       # driver's CUDA version
docker --version; nvidia-ctk --version
grep -E 'max_total_num_tokens|KV Cache|accept len|Capture cuda graph|ERROR' \
  ~/.local/share/qwen38-27b-exl3-sglang/smoke.log | head -40
```

plus: the smoke summary lines (accept length, served context), whether the
card drives a display, and — if you have time — one prose and one code
request's tok/s at thinking off, and a long-prompt test with `PROFILE=full`.
If `PROFILE=desktop` is the one you ran, the `max_total_num_tokens` line is the
number that replaces the extrapolation.

## Credits and licences

- Recipe, image, plugin and numbers: **0xSero** —
  [local-ai-registry](https://github.com/0xSero/local-ai-registry) (MIT);
  [local-ai-images](https://github.com/0xSero/local-ai-images) (public, no licence file as of 2026-09-24).
  The `sglang-exl3` plugin ships inside the image with a NOTICE but no licence
  file or licence field, and its GitHub repo was not publicly reachable
  when this was written — treat its licence as **unstated**.
- EXL3 format and ExLlamaV3: **turboderp** ([exllamav3](https://github.com/turboderp-org/exllamav3), MIT). The
  plugin bundles ExLlamaV3 code (MIT) and vLLM's Marlin kernels (Apache-2.0).
- The 3.00 bpw quant: **turboderp**, [`turboderp/Qwen3.8-27B-exl3`](https://huggingface.co/turboderp/Qwen3.8-27B-exl3) (card licence: apache-2.0).
- The model: **Qwen team**, Qwen3.8-27B.
- Engine: [SGLang](https://github.com/sgl-project/sglang) (Apache-2.0), base image `lmsysorg/sglang:v0.5.20`.
