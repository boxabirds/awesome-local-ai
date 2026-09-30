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
| 5 | 5/5 | 0 | 1 | 35/36 |
| 7 | 8/8 | 0 | 0 | 43/44 |
| 8 | 7/7 | 0 | 0 | 50/51 |

**New work** 41/47, **regressions** 0, **repairs** 5, **cumulative** 50/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 11.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 35.7 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 19 GB |
| 3 | See other people's edits appear live on the same board | DONE | 33.0 | None | None | None | — | — | red | 21/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 22 GB |
| 4 | Return to a board and find everything as it was left | DONE | 197.6 | None | None | None | — | — | red | 29/31 |  | 0 / 0 | 7 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 87.1 | None | None | None | — | — | red | 35/36 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 62.9 | None | None | None | — | — | red | 43/44 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 23.8 | None | None | None | — | — | red | 50/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |

**Totals:** 7 stories, 451 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/7, final acceptance 50/51, stalled 0, partial 0, 14735 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6427 / 0 | `BoardViewport.tsx` (264), `ZoomControls.tsx` (110), `camera.ts` (93), `useCamera.ts` (92), `App.tsx` (86), `playwright.config.ts` (34), +11 more |
| 2 | 1 by the agent | 2474 / 20 | `StickyNote.tsx` (312), `board-model.ts` (162), `StickyTextEditor.tsx` (152), `App.tsx` (108), `StickyText.ts` (104), `NOTES.md` (103), +7 more |
| 3 | 1 by the agent | 4046 / 188 | `board-room.ts` (206), `NOTES.md` (185), `connectBoard.ts` (85), `protocol.ts` (67), `ConnectionStatus.tsx` (61), `useBoardDoc.ts` (41), +9 more |
| 4 | 2 by the agent | 3237 / 293 | `board-room.ts` (599), `board-store.ts` (299), `test-hooks.ts` (81), `NOTES.md` (78), `index.ts` (74), `room-state.ts` (74), +9 more |
| 5 | 1 by the agent | 2056 / 375 | `App.tsx` (215), `SharePanel.tsx` (206), `Board.tsx` (191), `board-room.ts` (151), `BoardPage.tsx` (92), `index.ts` (87), +15 more |
| 7 | 1 by the agent | 2996 / 343 | `useTransformGesture.ts` (291), `StickyNote.tsx` (245), `board-model.ts` (212), `geometry.ts` (170), `Board.tsx` (160), `useSelection.ts` (149), +8 more |
| 8 | 1 by the agent | 1708 / 11 | `UndoButtons.tsx` (92), `undo.ts` (91), `NOTES.md` (76), `Toolbar.tsx` (61), `Board.tsx` (36), `StickyTextEditor.tsx` (34), +5 more |

### Earlier stories broken or fixed

- **Story 4 broke 0, fixed 4** earlier held-out tests (story 4: Return to a board and find everything as it was left; story 4 (wip): settings, protocol close codes, test-first unit suites). Source files it changed most: `board-room.ts` (599), `board-store.ts` (299), `test-hooks.ts` (81), `NOTES.md` (78), `index.ts` (74), `room-state.ts` (74), +9 more.
  - story 3: 1/7 → 5/7; fixed 4
- **Story 5 broke 0, fixed 1** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `App.tsx` (215), `SharePanel.tsx` (206), `Board.tsx` (191), `board-room.ts` (151), `BoardPage.tsx` (92), `index.ts` (87), +15 more.
  - story 3: 5/7 → 6/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
