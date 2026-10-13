# Vidi run — qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-underdog-saluki-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 8/10 | 0 | 0 | 16/20 |
| 3 | 0/7 | 16 | 0 | 0/27 |

**New work** 13/23, **regressions** 16, **repairs** 0, **cumulative** 0/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 124.7 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 6 | — | throttled 0%, server peak 23 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 65.0 | None | None | None | — | — | green | 16/20 |  | 0 / 1 | 3 | — | throttled 0%, server peak 25 GB |
| 3 | See other people's edits appear live on the same board | DONE | 232.0 | None | None | None | — | — | red | 0/27 | yes | 0 / 0 | 15 | — | throttled 0%, server peak 25 GB |

**Totals:** 3 stories, 422 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/3, final acceptance 0/27, stalled 1, partial 0, 14610 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 7399 / 82 | `BoardViewport.tsx` (254), `useCamera.ts` (192), `camera.ts` (163), `index.css` (147), `playwright.config.ts` (128), `ZoomControls.tsx` (96), +16 more |
| 2 | 1 by the agent | 2818 / 24 | `StickyNote.tsx` (256), `board-model.ts` (208), `index.css` (183), `StickyTextEditor.tsx` (134), `StickyText.ts` (92), `App.tsx` (89), +9 more |
| 3 | harness snapshot (agent left work uncommitted) | 11397 / 172 | `board-room.ts` (185), `App.tsx` (160), `BoardPage.tsx` (154), `connectBoard.ts` (105), `board-id.ts` (64), `useBoardDoc.ts` (63), +14 more |

### Earlier stories broken or fixed

- **Story 3 broke 16, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (185), `App.tsx` (160), `BoardPage.tsx` (154), `connectBoard.ts` (105), `board-id.ts` (64), `useBoardDoc.ts` (63), +14 more.
  - story 1: 8/10 → 0/10; broke 8.
  - story 2: 8/10 → 0/10; broke 8.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
