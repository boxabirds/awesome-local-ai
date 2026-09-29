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
- **Where it could run** (tritus, gruntus Ubuntu or Windows, quintus) and what it would be compared with.
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
| [NInfer (Swift 1.5)](ninfer.md) | queued | gruntus (Windows) | Windows-only 4090 engine for Swift 1.5; waiting for the Windows setup |
| [TensorFold](tensorfold.md) | blocked | quintus | MLX/CUDA exact speculative decoding; blocked on cache retention past ~100k |
| [MTPLX](mtplx.md) | blocked | quintus | memory admission deadlocks long agent sessions (507); recheck on 2.14 |
| [Strata](strata.md) | gated | gruntus | Flash-Next (125B MoE) on one 4090 by offloading experts to RAM |
| [Prompt lookup (n-gram speculation)](ngram-speculation.md) | parked | gruntus (Ubuntu) | engine setting; test on the dense 27B; eliminated for sparse MoE |
| [llama.cpp Vulkan on tritus](llamacpp-vulkan-tritus.md) | parked | tritus | dropped from v2: prompt reading 4-7x slower than gufo |
| [llama.cpp Metal on quintus](llamacpp-metal-quintus.md) | parked | quintus | paused after canvas-metal-01 story 1 |
| [Fable 5.1 reference](fable-5.1-reference.md) | parked | this Mac | a second frontier reference next to Opus 5.5; after the Opus v2 runs |
| [DeepSeek V4.1](deepseek-v4.1.md) | eliminated | none | about 750B parameters in total; V4.1-Flash size not checked |
| Swift 1.5 Qwen3.8-27B (llama.cpp) | adopted | gruntus | [combination](../combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-opencode/README.md) |
