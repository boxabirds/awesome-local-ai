# Benchmarks

| Folder | What it measures |
|---|---|
| [`perf/`](perf/) | Speed and fit: decode and prefill throughput by context, context probes, needle-in-a-haystack, reasoning effort, A/B comparisons, thermal state. The harnesses behind the numbers in each combination's README. |
| [`vidi/`](vidi/) | The Vidi build benchmark: a whole coding setup (model, server, client) builds a real app story by story and is scored by a held-out test suite. Quality first; timings are indicative. |
| [`inference-server-concurrency/`](inference-server-concurrency/) | How many agents one model server carries at once (fresh or forked from a parent's context): the proposed tool, what each engine's docs claim, the per-session memory model, and the first observations. Design and background only so far. |
| [`reference/`](reference/) | Reference stacks for Vidi that aren't local combinations, e.g. Claude Code + Opus 5.5. Each stack has a folder with its `stack.env` and one folder per run (`run-1/`, `run-2/`, …). |

Results live with what was measured: a local combination's under
`combinations/<combination>/benchmarks/`, a reference stack's under `reference/`.
