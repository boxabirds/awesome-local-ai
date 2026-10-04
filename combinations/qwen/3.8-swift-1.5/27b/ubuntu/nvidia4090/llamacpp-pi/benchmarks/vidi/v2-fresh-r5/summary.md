# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 6/7 | 0 | 0 | 23/27 |

**New work** 19/23, **regressions** 0, **repairs** 0, **cumulative** 23/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 32.9 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 20 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 25.5 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 237.0 | None | None | None | — | — | red | 23/27 |  | 3 / 0 | 4 | — | throttled 0%, server peak 25 GB |

**Totals:** 3 stories, 295 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/3, final acceptance 23/27, stalled 0, partial 1, 6224 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 7, 8, 9] (implementation: [4]), held-out 6/7 (floor 0.571).

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6702 / 7 | `BoardViewport.tsx` (254), `useCamera.ts` (164), `camera.ts` (112), `ZoomControls.tsx` (92), `NOTES.md` (79), `playwright.config.ts` (46), +16 more |
| 2 | 1 by the agent | 2256 / 15 | `StickyNote.tsx` (210), `board-model.ts` (201), `StickyTextEditor.tsx` (155), `App.tsx` (105), `StickyText.ts` (82), `NoteToolbar.tsx` (81), +8 more |
| 3 | 2 by the agent, + harness snapshot | 3868 / 109 | `board-room.ts` (251), `connectBoard.ts` (134), `protocol.ts` (115), `App.tsx` (52), `ConnectionStatus.tsx` (50), `index.ts` (46), +16 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
