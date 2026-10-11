# What is shared between sessions and what grows with each one

For the two models we run: **Qwen3.8 27B** (dense, a hybrid of Gated DeltaNet and full-attention layers) and **Qwen3.8 Flash-Next** (a mixture of experts, also a hybrid). Numbers are labelled: *measured* (ours), *repo* (stated in a combination's README or notes), *estimate*, *derived* (arithmetic here).

## Architectures

| | 27B (`qwen35`) | Flash-Next |
|---|---|---|
| Layers | 65 blocks, `full_attention_interval` 4, so 16 attention layers and 49 Gated DeltaNet (`docs/discovery.md`, from the GGUF metadata) | 48 layers, 3 Gated DeltaNet per full-attention layer, so 12 attention layers and 36 Gated DeltaNet (mlx-serve README) |
| KV heads x dim | 4 x 256 | 2 x 256 |
| Experts | none | 512, 10 active |
| Extras | MTP head | MTP head, a sparse-attention indexer past 2,048 tokens |

## Per-token full-attention KV

| | f16 | q8_0 | q4_0 |
|---|---|---|---|
| 27B | 64 KiB/token | 34 KiB | 18 KiB |
| Flash-Next | 24 KiB/token (12 layers x 2 heads x 256 x 2 bytes x K and V) | 13 KiB | 7 KiB |

For Flash-Next the f16 figure is *measured*: gufo's GPU memory grew by exactly 1,536 MiB between `--context 131072` (87,849 MiB at a 120k prompt) and `--context 196608` (89,385 MiB), which is 24 KiB for each of the 65,536 extra tokens. gufo has no KV-type switch, so only f16 applies there; mlx-serve has `--kv-quant off|4|8`. The q8_0 and q4_0 columns are *derived* from the f16 figure using the 27B's ratios (0.53 and 0.28).

At a context of 128k / 192k / 256k a session's KV is: 27B f16 8.0 / 12.0 / 16.0 GiB, q4_0 2.25 / 3.4 / 4.5 GiB; Flash-Next 3.0 / 4.5 / 6.0 GiB. Flash-Next adds about 2 KiB/token for the MTP head and 0.75 KiB/token for the indexer (*estimate*, mlx-serve README).

## Components

| Component | Shared by all sessions, or per session? | Notes |
|---|---|---|
| Model weights, MTP head weights | **shared**, one copy | Flash-Next: 70,958 MiB (mlx mixed 4/8-bit), 89,342 MiB (IQ4_XS), about 111 GB (gufo UD-Q4_K_XL). 27B: fits a 24 GB card with 128k at q4_0 |
| Compute buffers, graphs | llama.cpp: **shared** (one context; sized by `-ub`). gufo: **per session** ("independent graph, activation, and logit state") | the 27B's out-of-memory failures were on compute buffers (`docs/discovery.md`); the size of gufo's per-session activations is not documented |
| Full-attention KV | **per session**, preallocated to the full `--context` in gufo; llama.cpp's `-c` is one pool that slots draw from | the table above |
| MTP-head KV, sparse indexer | **per session** | Flash-Next only |
| Gated DeltaNet recurrent state | **per session**, fixed size, independent of context | Flash-Next: 108 MiB (*estimate*, 36 layers, f32). 27B: not recorded here |
| Prefix and snapshot cache | a **shared budget**, but each distinct conversation pins a full snapshot | gufo, *measured*: 28.4 KB/token, 3.61 GB at 127,272 tokens (30.2 KB/token at 43k); budget auto-chosen at 17.3 GB. Snapshots are whole copies even for an identical prefix (gufo's docs: a restore "costs a copy") |
| Speculative buffers | per session, small | Strata: "50 MiB of private state each" for slot drafters |

## What it adds up to

**Tritus (Strix Halo, 122 GiB unified, gufo, `--context 196608`).** *Measured now:* GPU memory in use 89,385 MiB of 122,880; the host reports about 17 GB available; gufo's resident memory plateaus around 15 to 17 GB (mostly the snapshot cache); swap holds about 2 GB with no swap traffic. *Derived:* each extra session costs about 4.5 GiB of KV at 192k or 3.0 GiB at 128k, plus activation state and 108 MiB of recurrent state. Because "used" memory includes the GPU's share of the same pool, two or three sessions is the practical ceiling, and the snapshot budget holds only about four 127k snapshots (about three at 192k, two at 256k: 5.6 and 7.4 GB each at 28.4 KB/token).

**RTX 4090 (24 GB), 27B at q4_0.** *Repo:* the 128k profile measured 21,905 MiB; the `vision-max` profile measured 23,040 MiB with 513 MiB spare, so about 23,553 MiB is usable (*derived*). That leaves about 1.6 GiB, roughly 90k tokens of q4_0 KV. A second full 128k session does not fit; two slots sharing one 128k pool do.

**A 128 GB Spark (*assumed* about 115 GiB usable; not measured).** Capacity is (usable memory - weights - engine fixed costs - snapshot budget) divided by the per-session cost. With 70.9 GiB of weights that leaves about 44 GiB, or roughly nine sessions at 192k before the snapshot budget and activations; with 89 GiB of weights, about 26 GiB, or roughly five. These are upper bounds.

## An older estimate

`docs/research/20260918-bonsai2-concurrent-sessions.md` models five 128k sessions in 22.4 GB for a different model on a 4090 (llama.cpp slots, q4_0 KV at 23.0 KiB/token) and names two assumptions that were never measured.
