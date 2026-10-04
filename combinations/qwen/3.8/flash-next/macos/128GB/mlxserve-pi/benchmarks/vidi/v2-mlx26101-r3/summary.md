# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 1 | 31/31 |
| 5 | 5/5 | 0 | 0 | 36/36 |
| 7 | 8/8 | 1 | 0 | 43/44 |
| 8 | 7/7 | 0 | 1 | 51/51 |

**New work** 46/47, **regressions** 1, **repairs** 2, **cumulative** 51/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 43.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 93%, server peak 93 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 82.0 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 4 | — | throttled 97%, server peak 93 GB |
| 3 | See other people's edits appear live on the same board | DONE | 194.1 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 6 | — | throttled 54%, server peak 93 GB |
| 4 | Return to a board and find everything as it was left | DONE | 160.8 | None | None | None | — | — | green | 31/31 |  | 0 / 1 | 7 | — | throttled 91%, server peak 93 GB |
| 5 | Share a board with others using a link | DONE | 86.6 | None | None | None | — | — | green | 36/36 |  | 0 / 1 | 5 | — | throttled 96%, server peak 94 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 130.4 | None | None | None | — | — | green | 43/44 |  | 0 / 0 | 7 | — | throttled 96%, server peak 95 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 82.3 | None | None | None | — | — | green | 51/51 |  | 0 / 0 | 4 | — | throttled 88%, server peak 95 GB |

**Totals:** 7 stories, 780 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/7, final acceptance 51/51, stalled 0, partial 0, 30131 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 8166 / 114 | `BoardViewport.tsx` (302), `useCamera.ts` (249), `camera.ts` (188), `styles.css` (182), `NOTES.md` (129), `ZoomControls.tsx` (91), +17 more |
| 2 | 3 by the agent | 5013 / 91 | `StickyNote.tsx` (434), `board-model.ts` (370), `StickyText.ts` (211), `StickyTextEditor.tsx` (211), `styles.css` (185), `App.tsx` (135), +9 more |
| 3 | 5 by the agent | 5866 / 118 | `NOTES.md` (218), `board-room.ts` (209), `StickyText.ts` (127), `protocol.ts` (112), `StickyTextEditor.tsx` (110), `connectBoard.ts` (101), +19 more |
| 4 | 8 by the agent | 5939 / 189 | `board-store.ts` (500), `board-room.ts` (417), `test-hooks.ts` (197), `NOTES.md` (142), `room-state.ts` (96), `store-faults.ts` (54), +17 more |
| 5 | 1 by the agent | 3870 / 145 | `api.ts` (170), `SharePanel.tsx` (163), `styles.css` (160), `state.ts` (147), `BoardPage.tsx` (133), `NOTES.md` (124), +14 more |
| 7 | 1 by the agent | 7459 / 485 | `useTransformGesture.ts` (522), `StickyNote.tsx` (381), `board-model.ts` (366), `geometry.ts` (333), `useSelection.ts` (263), `App.tsx` (207), +11 more |
| 8 | 1 by the agent | 2425 / 9 | `undo.ts` (218), `useUndo.ts` (84), `UndoButtons.tsx` (56), `useBoardKeys.ts` (47), `StickyTextEditor.tsx` (45), `App.tsx` (33), +5 more |

### Earlier stories broken or fixed

- **Story 4 broke 0, fixed 1** earlier held-out tests (story 4: Return to a board and find everything as it was left; story 4 task 8: the load-failure badge, the edit lock and the close codes (TC-22, TC-23, TC-28); story 4 task 7: the client says so when the board could not be loaded; story 4 task 6: e2e persistence - the service restarted under the board (TC-19..TC-21); story 4 task 5: room persistence integration tests (TC-12..TC-18, TC-26); story 4 tasks 3+4: the store tested against real storage, and a BoardRoom that saves; story 4 task 2: BoardStore - the log, the snapshot and the quarantine; story 4 task 1: storage/room-state settings, close codes and failing unit tests (TC-01, TC-02, TC-27)). Source files it changed most: `board-store.ts` (500), `board-room.ts` (417), `test-hooks.ts` (197), `NOTES.md` (142), `room-state.ts` (96), `store-faults.ts` (54), +17 more.
  - story 3: 6/7 → 7/7; fixed 1
- **Story 7 broke 1, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (522), `StickyNote.tsx` (381), `board-model.ts` (366), `geometry.ts` (333), `useSelection.ts` (263), `App.tsx` (207), +11 more.
  - story 3: 7/7 → 6/7; broke 1.
- **Story 8 broke 0, fixed 1** earlier held-out tests (story 8: Undo and redo my own changes without undoing anyone else's). Source files it changed most: `undo.ts` (218), `useUndo.ts` (84), `UndoButtons.tsx` (56), `useBoardKeys.ts` (47), `StickyTextEditor.tsx` (45), `App.tsx` (33), +5 more.
  - story 3: 6/7 → 7/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
