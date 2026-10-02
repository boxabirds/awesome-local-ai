# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |
| 5 | 5/5 | 0 | 0 | 34/36 |
| 7 | 7/8 | 0 | 0 | 41/44 |
| 8 | 7/7 | 0 | 0 | 48/51 |
| 9 | 5/6 | 0 | 2 | 55/57 |

**New work** 49/53, **regressions** 0, **repairs** 2, **cumulative** 55/57.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 63.7 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 69%, server peak 90 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 62.8 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 80%, server peak 92 GB |
| 3 | See other people's edits appear live on the same board | DONE | 168.9 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 6 | — | throttled 85%, server peak 95 GB |
| 4 | Return to a board and find everything as it was left | DONE | 92.1 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 4 | — | throttled 98%, server peak 95 GB |
| 5 | Share a board with others using a link | DONE | 45.1 | None | None | None | — | — | green | 34/36 |  | 0 / 1 | 2 | — | throttled 84%, server peak 95 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 50.9 | None | None | None | — | — | green | 41/44 |  | 0 / 1 | 2 | — | throttled 88%, server peak 95 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 85.7 | None | None | None | — | — | red | 48/51 |  | 0 / 1 | 4 | — | throttled 96%, server peak 95 GB |
| 9 | Write free text anywhere on the board | DONE | 163.3 | None | None | None | — | — | red | 55/57 |  | 0 / 1 | 5 | — | throttled 61%, server peak 95 GB |

**Totals:** 8 stories, 732 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/8, final acceptance 55/57, stalled 0, partial 0, 24136 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6952 / 45 | `BoardViewport.tsx` (241), `camera.ts` (177), `useCamera.ts` (168), `styles.css` (158), `NOTES.md` (101), `App.tsx` (50), +13 more |
| 2 | 4 by the agent | 3527 / 76 | `StickyNote.tsx` (272), `board-model.ts` (265), `styles.css` (218), `StickyText.ts` (159), `StickyTextEditor.tsx` (151), `App.tsx` (129), +8 more |
| 3 | 6 by the agent | 7209 / 1738 | `board-room.ts` (212), `connectBoard.ts` (175), `NOTES.md` (142), `useBoardDoc.ts` (135), `protocol.ts` (97), `index.ts` (92), +17 more |
| 4 | 1 by the agent | 2940 / 133 | `board-room.ts` (359), `board-store.ts` (328), `room-state.ts` (87), `test-hooks.ts` (85), `App.tsx` (49), `connectBoard.ts` (37), +13 more |
| 5 | 3 by the agent | 2178 / 265 | `App.tsx` (232), `Board.tsx` (215), `styles.css` (193), `SharePanel.tsx` (128), `BoardPage.tsx` (105), `board-store.ts` (90), +12 more |
| 7 | 9 by the agent | 2958 / 230 | `useTransformGesture.ts` (308), `geometry.ts` (210), `board-model.ts` (182), `Board.tsx` (173), `useSelection.ts` (158), `StickyNote.tsx` (157), +8 more |
| 8 | 4 by the agent | 2712 / 122 | `undo.ts` (169), `useUndo.ts` (116), `NOTES.md` (96), `UndoButtons.tsx` (85), `useBoardKeys.ts` (41), `Board.tsx` (35), +7 more |
| 9 | 10 by the agent | 4611 / 211 | `TextEditor.tsx` (265), `TextObject.tsx` (240), `text.ts` (227), `textLayout.ts` (184), `Board.tsx` (179), `styles.css` (177), +14 more |

### Earlier stories broken or fixed

- **Story 9 broke 0, fixed 2** earlier held-out tests (story 9: e2e text workflows in a real browser (TC-26 to TC-31); story 9: component tests for one text object from its first letter to its last (TC-19 to TC-25); story 9: text objects on the board, with two side handles and no others; story 9: failing component tests for tool mode and placing text (TC-14 to TC-18); story 9: Select and Text tool modes with V, T, N and Escape shortcuts; story 9: failing component tests for box sync and the local-change rule (TC-12, TC-13); story 9: text layout and local-only box sync (TC-07 to TC-11, TC-32); story 9: failing text layout unit tests with a fake measurer (TC-07 to TC-11, TC-32); story 9: text object model and shared text-edit helpers (TC-01 to TC-06); story 9: failing text object model unit tests (TC-01 to TC-06)). Source files it changed most: `TextEditor.tsx` (265), `TextObject.tsx` (240), `text.ts` (227), `textLayout.ts` (184), `Board.tsx` (179), `styles.css` (177), +14 more.
  - story 3: 5/7 → 6/7; fixed 1
  - story 7: 7/8 → 8/8; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
