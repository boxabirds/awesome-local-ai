# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

**Partial rerun (diagnostic).** Story 9 only, built on `combinations/qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi/benchmarks/vidi/v2-r3` at commit `bf8d4e2` (its code when the story before ended). It measures that story on its own, with no earlier mistakes carried in; not comparable with full runs.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 9 | 3/6 | 0 | 0 | 52/57 |

**New work** 3/6, **regressions** 0, **repairs** 0, **cumulative** 52/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | Write free text anywhere on the board | DONE | 21.7 | None | None | None | — | — | red | 52/57 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |

**Totals:** 1 stories, 22 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/1, final acceptance 52/57, stalled 0, partial 0, 15762 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 9 | 1 by the agent | 2476 / 105 | `TextEditor.tsx` (195), `text.ts` (157), `textLayout.ts` (154), `TextObject.tsx` (137), `TextToolbar.tsx` (77), `Toolbar.tsx` (71), +15 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
