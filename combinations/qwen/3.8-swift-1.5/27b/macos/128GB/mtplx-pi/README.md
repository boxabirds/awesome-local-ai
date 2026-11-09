# Swift 1.5 Qwen3.8-27B · macOS · 128GB Apple silicon · MTPLX + pi

**Combination:** `qwen/3.8-swift-1.5/27b/macos/128GB/mtplx-pi`
**Install:** `./install-qwen-3.8-swift-1.5-27b-macos-128GB-mtplx-pi.sh` (from the repo root)

Swift 1.5 is UkisAI's second retrain of Qwen3.8-27B to think less. This is the same model as the
[llama.cpp Swift 1.5 combination](../../../ubuntu/nvidia4090/llamacpp-pi/README.md), served on a Mac
by MTPLX with its native MTP speculative decoding.

```bash
./install-qwen-3.8-swift-1.5-27b-macos-128GB-mtplx-pi.sh   # 55.6 GB download, then a local Forge build
mtplx-swift15-27b-pi                                        # server on demand + pi
```

## The model is built here

No MTPLX pack of Swift 1.5 is published. The installer downloads UkisAI's safetensors
(`ukisai/Swift-1.5-Qwen3.8-27b`, BF16, with 15 MTP tensors) and converts them with
`mtplx forge build`, using the recipe the stock
[Qwen3.8-27B Optimized-Quality pack](../../../../../3.8/27b/macos/64GB/mtplx-opencode/README.md)
records in its `mtplx_runtime.json`: 8-bit affine body, group size 64, MTP head kept in bf16. So this
stack and the stock 27B MTPLX stack differ in the fine-tune, not the quantisation. The result is named
`Swift-1.5-Qwen3.8-27B-MTPLX-Q8` in MTPLX's model folder; a later install finds it and does nothing.

Requires MTPLX 2.12.3 or later (the fix for MTPLX issue 605, HTTP 500 on valid requests); the
installer upgrades an older one.

**Measured at install** (M5 Max, 9 Nov 2026): 29,257 MiB resident at 128k context; Forge's
verification gave 49.0 tok/s at MTP depth 3 against 17.1 without (short generations, not an agent
session). **Not measured yet:** speed and quality in a working session. Benchmarks will land under
`benchmarks/`.

Profiles, overrides and troubleshooting: `mtplx-swift15-27b-server --help`.
