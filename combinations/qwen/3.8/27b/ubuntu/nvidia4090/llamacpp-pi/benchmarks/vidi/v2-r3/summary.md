# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 0/6 | 0 | 0 | 0/6 |
| 2 | 0/10 | 0 | 0 | 0/20 |
| 3 | 5/7 | 0 | 20 | 25/27 |

**New work** 5/23, **regressions** 0, **repairs** 20, **cumulative** 25/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | PARTIAL (red) | 16.5 | None | None | None | — | — | red | 0/6 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (red), on partial 1 | 18.3 | None | None | None | — | — | red | 0/20 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE, on partial 1, 2 | 123.6 | None | None | None | — | — | green | 25/27 |  | 0 / 1 | 4 | — | throttled 0%, server peak 18 GB |

**Totals:** 3 stories, 158 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/3, final acceptance 25/27, stalled 0, partial 2, 3770 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 1 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 3, 4, 5]), held-out 0/6 (floor 0.0).
- **Story 2 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8] (implementation: [2, 4, 5, 6]), held-out 0/10 (floor 0.0).
- Story 2, built on partial 1: held-out tests on the partial base 0/20; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 3, built on partial 1, 2: held-out tests on the partial base 25/27; partial story's tests fixed 20, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | — | 0 / 0 | — |
| 3 | 1 by the agent | 7859 / 9 | `StickyNote.tsx` (209), `App.tsx` (185), `BoardViewport.tsx` (159), `board-room.ts` (157), `board-model.ts` (147), `connectBoard.ts` (127), +30 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 20** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `StickyNote.tsx` (209), `App.tsx` (185), `BoardViewport.tsx` (159), `board-room.ts` (157), `board-model.ts` (147), `connectBoard.ts` (127), +30 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 10/10; fixed 10

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
