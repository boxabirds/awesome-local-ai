# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 1/7 | 0 | 0 | 21/27 |
| 4 | 4/4 | 0 | 4 | 29/31 |

**New work** 21/27, **regressions** 0, **repairs** 4, **cumulative** 29/31.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 11.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 35.7 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 19 GB |
| 3 | See other people's edits appear live on the same board | DONE | 33.0 | None | None | None | — | — | red | 21/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 22 GB |
| 4 | Return to a board and find everything as it was left | DONE | 197.6 | None | None | None | — | — | red | 29/31 |  | 0 / 0 | 7 | — | throttled 0%, server peak 25 GB |

**Totals:** 4 stories, 277 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/4, final acceptance 29/31, stalled 0, partial 0, 8798 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6427 / 0 | `BoardViewport.tsx` (264), `ZoomControls.tsx` (110), `camera.ts` (93), `useCamera.ts` (92), `App.tsx` (86), `playwright.config.ts` (34), +11 more |
| 2 | 1 by the agent | 2474 / 20 | `StickyNote.tsx` (312), `board-model.ts` (162), `StickyTextEditor.tsx` (152), `App.tsx` (108), `StickyText.ts` (104), `NOTES.md` (103), +7 more |
| 3 | 1 by the agent | 4046 / 188 | `board-room.ts` (206), `NOTES.md` (185), `connectBoard.ts` (85), `protocol.ts` (67), `ConnectionStatus.tsx` (61), `useBoardDoc.ts` (41), +9 more |
| 4 | 2 by the agent | 3237 / 293 | `board-room.ts` (599), `board-store.ts` (299), `test-hooks.ts` (81), `NOTES.md` (78), `index.ts` (74), `room-state.ts` (74), +9 more |

### Earlier stories broken or fixed

- **Story 4 broke 0, fixed 4** earlier held-out tests (story 4: Return to a board and find everything as it was left; story 4 (wip): settings, protocol close codes, test-first unit suites). Source files it changed most: `board-room.ts` (599), `board-store.ts` (299), `test-hooks.ts` (81), `NOTES.md` (78), `index.ts` (74), `room-state.ts` (74), +9 more.
  - story 3: 1/7 → 5/7; fixed 4

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
