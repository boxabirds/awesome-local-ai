# Vidi run — qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi

Model `strata-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |

**New work** 22/23, **regressions** 0, **repairs** 0, **cumulative** 26/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 50.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 87.1 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (green) | 240.0 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 0 GB |

**Totals:** 3 stories, 377 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/3, final acceptance 26/27, stalled 0, partial 1, 11059 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **green**: gate green, tasks not verified none (implementation: none), held-out 6/7 (floor 0.571).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6902 / 28 | `useCamera.ts` (302), `BoardViewport.tsx` (249), `camera.ts` (180), `styles.css` (179), `playwright.config.ts` (142), `NOTES.md` (92), +15 more |
| 2 | 2 by the agent | 4613 / 53 | `StickyNote.tsx` (412), `board-model.ts` (345), `styles.css` (232), `StickyTextEditor.tsx` (183), `StickyText.ts` (150), `App.tsx` (110), +10 more |
| 3 | 5 by the agent, + harness snapshot | 4616 / 202 | `StickyTextEditor.tsx` (351), `board-room.ts` (204), `connectBoard.ts` (155), `StickyText.ts` (144), `protocol.ts` (115), `PROGRESS.md` (62), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
