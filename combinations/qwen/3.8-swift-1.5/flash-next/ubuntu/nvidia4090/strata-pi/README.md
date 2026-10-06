# Swift 1.5 Qwen3.8-Flash-Next on one RTX 4090, served by Strata, driven by pi

**Status:** installable and checked against stubs; never run, nothing measured here yet.
**Machine:** the RTX 4090 machine (Core i9-13900F, 62 GB RAM, 24 GB VRAM), Ubuntu 22.04.
**Install:** `./install-qwen-3.8-swift-1.5-flash-next-ubuntu-nvidia4090-strata-pi.sh`
**Server:** `strata-swift15-flash-next-server` (loopback, port 8014). **Client:** pi.

## Why this combination exists

It is the same stack as `qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi` with one thing changed: the fine-tune.
Same engine and version, same card, same GSQ-RCO quantisation at the same size, same context, same reasoning
effort, same client, same stories. That makes the pair an answer to one question and no other: **does thinking
less cost quality?**

Swift 1.5 is UkisAI's post-train of Qwen3.8-Flash-Next, aimed at shorter reasoning traces. Its authors report 63%
fewer thinking tokens and answers 1.8 times sooner. Those are their figures on their benchmarks; this combination
exists so that the claim can be read on held-out tests instead, against the original on the same machine.

## What this combination runs

| | |
|---|---|
| Strata | v0.1.40, pinned by commit `1735d647` |
| Weights | `ukisai/Swift-1.5-Qwen3.8-Flash-Next-GSQ-RCO-GGUF` at `b22d729e`, IQ3_XXS (76.0 GB in two files, sha256-checked) |
| Why IQ3_XXS | the size the original runs, so the pair differs only in the fine-tune. Swift has no IQ3_S at all, and its Q2_0 is not packable (Strata's issue 171), so IQ3_XXS is also the largest it offers |
| Context | 131,072 tokens (the benchmark's minimum), KV cache int8 |
| Drafting | MTP, fetched by Strata's setup |
| Sampling | temperature 1.0, top-p 0.95, top-k 20; reasoning effort low (pi sends none) |
| VRAM reserve | 969 MiB, as for the original |
| Licence | Swift Open License 1.0 (fine-tune) + Qwen Community License 1.0 (base model) |

## What was measured

Nothing. No run of this combination has happened. `profiles.tsv` carries the original's memory figures with the
basis `ESTIMATED` and says so in the file; they are to be replaced with this combination's own after its first run.
The only figure that has been measured on this card for this engine and size is the VRAM floor the launcher gates
on, 16,000 MiB, and that was measured with the original's weights.

## Reading a result from it

Against the original, on the same card and in the same week, the comparison is on:

- **tests passed of 75** — the score of record. If Swift costs quality, it shows here and nowhere else.
- **thinking tokens per story** — the claim being tested. The records keep thinking apart from output.

Tokens per second is not the comparison. Both run the same engine at the same quantisation, so per-token speed
should be much the same; the whole proposition is about emitting fewer tokens, not faster ones.

## Licence

The fine-tune is under the Swift Open License 1.0 and the base model under the Qwen Community License 1.0. The
Swift licence permits commercial use below a gross-revenue threshold of one million US dollars and does not
condition non-commercial or research use on it. Read from the repository's `LICENSE` on 5 Oct 2026; the terms are
the licence's, not this file's.
