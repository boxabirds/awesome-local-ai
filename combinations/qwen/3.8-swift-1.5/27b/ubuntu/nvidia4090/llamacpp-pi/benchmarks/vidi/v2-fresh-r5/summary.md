# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 6/7 | 0 | 0 | 23/27 |
| 4 | 4/4 | 0 | 0 | 27/31 |
| 5 | 5/5 | 0 | 0 | 32/36 |
| 7 | 6/8 | 0 | 1 | 39/44 |

**New work** 34/40, **regressions** 0, **repairs** 1, **cumulative** 39/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 32.9 | None | None | None | — | — | green | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 20 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 25.5 | None | None | None | — | — | green | 17/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 237.0 | None | None | None | — | — | red | 23/27 |  | 3 / 0 | 4 | — | throttled 0%, server peak 25 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 172.5 | None | None | None | — | — | red | 27/31 |  | 0 / 0 | 6 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE, on partial 3 | 113.6 | None | None | None | — | — | red | 32/36 |  | 2 / 1 | 2 | — | throttled 0%, server peak 26 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3 | 34.5 | None | None | None | — | — | red | 39/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |

**Totals:** 6 stories, 616 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/6, final acceptance 39/44, stalled 0, partial 1, 12704 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 7, 8, 9] (implementation: [4]), held-out 6/7 (floor 0.571).
- Story 4, built on partial 3: held-out tests on the partial base 10/11; partial story's tests fixed 0, regressed 0; 3 stub-like lines added to src/.
- Story 5, built on partial 3: held-out tests on the partial base 15/16; partial story's tests fixed 0, regressed 0; 4 stub-like lines added to src/.
- Story 7, built on partial 3: held-out tests on the partial base 21/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6702 / 7 | `BoardViewport.tsx` (254), `useCamera.ts` (164), `camera.ts` (112), `ZoomControls.tsx` (92), `NOTES.md` (79), `playwright.config.ts` (46), +16 more |
| 2 | 1 by the agent | 2256 / 15 | `StickyNote.tsx` (210), `board-model.ts` (201), `StickyTextEditor.tsx` (155), `App.tsx` (105), `StickyText.ts` (82), `NoteToolbar.tsx` (81), +8 more |
| 3 | 2 by the agent, + harness snapshot | 3868 / 109 | `board-room.ts` (251), `connectBoard.ts` (134), `protocol.ts` (115), `App.tsx` (52), `ConnectionStatus.tsx` (50), `index.ts` (46), +16 more |
| 4 | 1 by the agent | 2755 / 191 | `board-room.ts` (467), `board-store.ts` (283), `room-state.ts` (130), `index.ts` (59), `App.tsx` (41), `connectBoard.ts` (37), +14 more |
| 5 | 1 by the agent | 1850 / 211 | `SharePanel.tsx` (204), `App.tsx` (180), `Board.tsx` (143), `NOTES.md` (120), `BoardPage.tsx` (69), `NotFoundPage.tsx` (68), +14 more |
| 7 | 1 by the agent | 3019 / 414 | `useTransformGesture.ts` (335), `Board.tsx` (244), `board-model.ts` (191), `geometry.ts` (189), `StickyNote.tsx` (180), `useSelection.ts` (143), +9 more |

### Earlier stories broken or fixed

- **Story 7 broke 0, fixed 1** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (335), `Board.tsx` (244), `board-model.ts` (191), `geometry.ts` (189), `StickyNote.tsx` (180), `useSelection.ts` (143), +9 more.
  - story 2: 7/10 → 8/10; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
