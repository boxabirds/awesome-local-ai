# Horizon: combinations we could explore

Engines, models and settings that might become benchmark combinations, and the ones ruled out, with why. One
note per candidate. The point is that nothing we looked at is forgotten, and nothing is tried twice for a reason
we already know.

## Statuses

| Status | Meaning |
|---|---|
| **candidate** | worth trying; no known blocker, not yet scheduled |
| **gated** | worth trying once named checks pass (listed in the note) |
| **blocked** | a known defect stops it; the note says what would unblock it |
| **queued** | agreed and waiting for a machine or setup step |
| **adopted** | now a combination under `combinations/` (the note links it) |
| **parked** | not now, by decision; the note says what would bring it back |
| **eliminated** | ruled out; the note says why and what would change that |

## Each note has

- **What it is**, in two or three lines, with links to its sources.
- **Where it could run** (the Strix Halo box, the RTX 4090 machine on Ubuntu or Windows, the M5 Max) and what it would be compared with.
- **Status**, the date it was set, and the reason.
- **Checks before a run**: the concrete tests that gate it (e.g. tool calls over the API; a multi-turn
  conversation past 120k tokens that keeps its cache between turns).
- **Confounds**: what else would differ from the stacks it is compared with (quantisation, engine build,
  context limit), so a result is read correctly.
- **Last checked** and **recheck when**: the date the facts were read, and what would change the status
  (a release, an issue closing, a machine freeing up).

Facts come from the project's own pages or our own measurements, with links; anything not yet checked says so.

## Review

At each review, re-read every note that is not adopted or eliminated: follow its "recheck when", update
"last checked", and change the status if the facts changed. Eliminated notes are re-read only when their
"recheck when" happens.

## Index

| Note | Status | Machine | One line |
|---|---|---|---|
| [NInfer (Swift 1.5)](ninfer.md) | queued | RTX 4090 (Windows) | Windows-only 4090 engine for Swift 1.5; waiting for the Windows setup |
| [TensorFold](tensorfold.md) | parked | M5 Max | MLX/CUDA exact speculative decoding; a 47k-token window on 128 GB against the 128k minimum |
| [MTPLX](mtplx.md) | queued | M5 Max | 2.12.1 closed our issue 567 (compaction 507s); 2.12.2 installed; five runs queued behind mlx-serve |
| [BeeLlama.cpp](beellama.md) | candidate | RTX 4090 (Ubuntu) | llama.cpp fork: KV cache in fewer bits for the same context; MTP/DFlash speculation |
| [TurboQuant](turboquant.md) | candidate | RTX 4090 (Ubuntu) | llama.cpp fork: turbo KV cache (no re-quant) and Config I TQ4_1S weights (re-quant; merge with Unsloth Dynamic 3.0 to test) |
| [Strata](strata.md) | gated | RTX 4090 | Flash-Next (125B MoE) on one 4090 by offloading experts to RAM; engine checks passed at 131k context, harness backend next |
| [Surface Laptop Ultra (RTX Spark)](surface-laptop-ultra.md) | open question | none we own | which combination per memory tier on a 300 GB/s Blackwell Arm laptop; 128 GB is Flash-Next 4-bit, and the 64 GB tier asks the question our Strata arm is already answering |
| [Strata on a small card](strata-small-card.md) | open question | none we own | does the floor for a useful coding agent drop to a 12 GB card with 64 GB RAM? The quality half is answered by the 4090 Strata runs, which use the same IQ3_XXS pack |
| [Flash-Next Coder](flash-next-coder.md) | candidate | RTX 4090 | ISTA-DASLab's Flash-Next with half the experts removed, for code; about 30 GB in memory; runs on Strata |
| [gufo fork: Qwen3.6-35B-A3B Q6dense](gufo-qwen3.6-35b-a3b.md) | candidate | Strix Halo | a new combination: 3B-active MoE, mixed Q6/Q4, gufo 0.5.0 base plus one author's kernels; no image exists, so built from source -- which works, with two host-side fixes |
| [gufo 0.5](gufo-0.5.md) | running | Strix Halo | pinned to 0.5.0; smoke passed; five recorded runs under way |
| [mlx-serve 26.10.1](mlx-serve-26.10.1.md) | running | M5 Max | one release ahead of the old pin; long sessions stay cached, a looping fix; five recorded runs under way |
| [Prompt lookup (n-gram speculation)](ngram-speculation.md) | parked | RTX 4090 (Ubuntu) | engine setting; test on the dense 27B; eliminated for sparse MoE |
| [llama.cpp Vulkan on Strix Halo](llamacpp-vulkan-strix-halo.md) | parked | Strix Halo | dropped from v2: prompt reading 4-7x slower than gufo |
| [llama.cpp Metal on the M5 Max](llamacpp-metal-m5-max.md) | parked | M5 Max | paused after canvas-metal-01 story 1 |
| [Fable 5.1 reference](fable-5.1-reference.md) | parked | this Mac | a second frontier reference next to Opus 5.5; after the Opus v2 runs |
| [DwarfStar (ds4)](dwarfstar.md) | gated | M5 Max | native engine incl. Qwen3.8 Flash Next on Metal (Q4 69.7 GiB resident); not for the 4090 by its docs, and its Qwen page says ROCm is unsupported; publishes no Mac figure |
| [sf-q3-8flash](sf-q3-8flash.md) | gated | M5 Max | ds4 cut to Qwen Flash-Next on Metal alone, developed on an M5 Max; +6 to 11% over ds4 by its own A/B harness with token-identity checks; nothing published past 65k context |
| [K2 Horizon (MBZUAI IFM)](k2-horizon.md) | gated | any machine (new model family) | six open models, 0.9B to 375B; vLLM and SGLang support real, Ollama not, llama.cpp pull request approved but unmerged; gate: the merge |
| [LightRSI / TokenPilot](lightrsi.md) | parked | pi and OpenCode (a client extension) | context manager for long sessions; fixes dollar and cache-miss costs we do not have; assessed on paper, never run |
| [ThinkingCap-Qwen3.8-27B](thinkingcap.md) | gated | RTX 4090 (Ubuntu) | dense-27B fine-tune that thinks less: 37% fewer reasoning tokens for 85.8% vs 86.6% accuracy, by its own card; gated on licence, an MTP-capable llama.cpp build, and the base 27B having no v2 series to compare with |
| [Caveman](caveman.md) | on the horizon | pi (a prompt) | terse-output prompt skill; reported for replies, not thinking; first find out whether it reaches Qwen's thinking; read only from write-ups |
| [Kolibri-1](kolibri-1.md) | on the horizon | none yet (card names vLLM with a vendor plugin) | Aleph Alpha 78B MoE, 3.46B active, 262k context, built-in reasoning-effort modes; needs an engine we run to load it; read from a card summary only |
| [Local System One models](local-system-one-models.md) | on the horizon | none yet (a different kind of benchmark) | typed-decision models popularised by TypeSafe's Jev; many local competitors; JevBench (Benchmark Heaven) measures them; the work is installers, under a hierarchy to decide; from search results only |
| [pi 1.0](pi-1.0.md) | candidate | every machine | client update, 0.87.1 to 1.0.0; no landmine release; fixes a llama.cpp tool-call bug |
| [pi 0.99](pi-0.99.md) | parked | every machine | superseded by pi 1.0; kept as why v2 pinned 0.87.1 |
| [DeepSeek V4.1](deepseek-v4.1.md) | eliminated | none | about 750B parameters in total; V4.1-Flash size not checked |
| Swift 1.5 Qwen3.8-27B (llama.cpp) | adopted | RTX 4090 | [combination](../combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/README.md) |
