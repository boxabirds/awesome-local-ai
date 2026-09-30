# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 0/7 | 20 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |

**New work** 16/27, **regressions** 20, **repairs** 0, **cumulative** 0/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 24.0 | None | None | None | — | — | red | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 47.6 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 23 GB |
| 3 | See other people's edits appear live on the same board | DONE | 20.4 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 23 GB |
| 4 | Return to a board and find everything as it was left | DONE | 32.7 | None | None | None | — | — | red | 0/31 |  | 0 / 1 | 1 | — | throttled 0%, server peak 25 GB |

**Totals:** 4 stories, 125 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/4, final acceptance 0/31, stalled 0, partial 0, 6832 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7555 / 0 | `BoardViewport.tsx` (172), `camera.ts` (111), `ZoomControls.tsx` (100), `useCamera.ts` (92), `App.tsx` (67), `NOTES.md` (42), +13 more |
| 2 | 6 by the agent | 2682 / 96 | `StickyNote.tsx` (270), `board-model.ts` (226), `StickyTextEditor.tsx` (151), `App.tsx` (146), `StickyText.ts` (137), `NoteToolbar.tsx` (81), +6 more |
| 3 | 1 by the agent | 3582 / 85 | `board-room.ts` (121), `connectBoard.ts` (77), `protocol.ts` (54), `index.ts` (42), `ConnectionStatus.tsx` (36), `board-id.ts` (33), +9 more |
| 4 | 1 by the agent | 2079 / 1171 | `board-room.ts` (212), `board-store.ts` (143), `room-state.ts` (77), `test-hooks.ts` (39), `NOTES.md` (37), `connectBoard.ts` (37), +11 more |

### Earlier stories broken or fixed

- **Story 3 broke 20, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (121), `connectBoard.ts` (77), `protocol.ts` (54), `index.ts` (42), `ConnectionStatus.tsx` (36), `board-id.ts` (33), +9 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 10/10 → 0/10; broke 10.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
