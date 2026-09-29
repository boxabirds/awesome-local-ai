# Swift 1.5 Qwen3.8-27B · Ubuntu · 24GB NVIDIA · llama.cpp + OpenCode

**Combination:** `qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi`
**Install:** `./install-qwen-3.8-swift-1.5-27b-ubuntu-nvidia4090-llamacpp-pi.sh` (from the repo root)

Swift 1.5 is UkisAI's second retrain of Qwen3.8-27B to think less. It is a different model from
[Swift 1.0](../../../../../3.8-swift/27b/ubuntu/nvidia4090/llamacpp-pi/README.md), so it is a
separate combination with the same serving setup (llama.cpp, built-in MTP speculative decoding,
128k context, reasoning effort `low`), so the two can be compared directly.

```bash
./install-qwen-3.8-swift-1.5-27b-ubuntu-nvidia4090-llamacpp-pi.sh   # build + ~16.2 GiB download
swift15-qwen38-27b-opencode                                             # server on demand + OpenCode
```

## What is known

| | Swift 1.5 | Swift 1.0 | Source |
|---|---|---|---|
| Repository | `ukisai/Swift-1.5-Qwen3.8-27B-GGUF` | `ukisai/Swift-Qwen3.8-27B-GGUF` | |
| Q4_K_M size | 16.245 GiB | 16.787 GiB | Hugging Face file sizes |
| Architecture | qwen35, 65 blocks, 866 tensors | same | GGUF header |
| MTP head | built in (blk.64 `nextn.*`), projection **Q4_0** | built in, projection Q8_0 | GGUF header |
| Token embedding | Q4_K | Q6_K | GGUF header |
| Sampling (thinking) | temp 1.0, top-p 0.95, top-k 20, min-p 0 | same | model cards |

Vendor claims for Swift 1.5 (not reproduced here): stronger than Swift 1.0 "especially coding and
agentic", 58.5% fewer thinking tokens than base Qwen3.8-27B; LiveCodeBench v6 76.76% → 81.71% and
Terminal-Bench 2.1 69.21% → 72.13% against the base model.

**Not measured yet:** VRAM footprint (the profiles carry Swift 1.0's conservative bounds; the smaller
file means more real headroom), MTP draft acceptance (the Q4_0 head may accept shorter runs than 1.0's
0.62–0.86), speed and quality. Benchmarks will land under `benchmarks/`.

**The file's own name:** the GGUF metadata says `general.name = "Miroslav 1.0"`. It comes from the
official Swift 1.5 repository (revision `a1614465`, 24 Sep 2026); the repository, not that label, is
what identifies this combination.

Profiles, overrides and troubleshooting: `swift15-qwen38-27b-server --help`.
