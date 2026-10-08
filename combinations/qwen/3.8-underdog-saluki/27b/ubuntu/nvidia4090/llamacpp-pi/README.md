# Underdog Saluki 27B (2-bit, MTP) · Ubuntu · 24GB NVIDIA · llama.cpp + pi

**Combination:** `qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi`
**Install:** `./install-qwen-3.8-underdog-saluki-27b-ubuntu-nvidia4090-llamacpp-pi.sh` (from the repo root)

Qwen3.8-27B as a 2-bit GGUF (Underdog Saluki 27B 1.0, ConwayResearch) with the base model's MTP head added by Kujira, served the
same way as the [Swift 1.5 combination](../../../../../3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/README.md) (llama.cpp,
built-in draft-mtp, 128k context, reasoning effort `low`, the model card's sampler), so the two compare on the same engine, card and
client; **only the weights differ**. See also the [horizon note](../../../../../../../horizon/underdog-saluki.md).

```bash
./install-qwen-3.8-underdog-saluki-27b-ubuntu-nvidia4090-llamacpp-pi.sh   # build + 7.8 GiB download, pinned and verified
underdog-qwen38-27b-server                                                   # the server on port 8080
```

## What is known

| | |
|---|---|
| Weights | `Kujira/Underdog-Saluki-27B-1.0-MTP-GGUF`, `Underdog-Saluki-27B-1.0-IQ2-mix-MTP.gguf`, 8.35 GB |
| Pinned to | repository commit `5d92db9b7aa4`, sha256 `98f6ebb5...e89e52` (the card's; the install refuses a mismatch) |
| Lineage | Qwen3.8-27B -> ISTA-DASLab GSQ-RCO GGUF -> Underdog Saluki 27B 1.0 (IQ2-mix, imatrix) -> Kujira's MTP graft |
| MTP head | Qwen3.8-27B's own, 15 tensors in `blk.64.*`, from Unsloth's quantisation, grafted verbatim; the trunk is not the one it was trained with |
| Licence | Apache 2.0 |

The author's figures (not ours): tool calling 88 against 84 for the full model on 120 BFCL v4 tasks; reasoning and maths clearly
lower (AIME 2025 79 against 97, MuSR 68 against 80); 41 -> 66 tok/s with MTP on an RTX 3080 12GB at temperature 0.

**Not measured yet:** VRAM at 131k context (the profiles carry the 16.2 GiB bounds of the baseline 27B, so real headroom is larger),
draft acceptance and speed under our temperature-1.0 sampler, and quality. The speed on the card is greedy and does not predict ours.

Profiles, overrides and troubleshooting: `underdog-qwen38-27b-server --help`.
