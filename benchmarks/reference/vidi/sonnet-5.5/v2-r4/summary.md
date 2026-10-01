# Vidi run — reference/sonnet-5.5

Model `claude-sonnet-5-5`, scope `canvas`, effort `client default`, client claude 2.1.285 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 1 | 31/31 |
| 5 | 5/5 | 0 | 0 | 36/36 |
| 7 | 8/8 | 0 | 0 | 44/44 |
| 8 | 7/7 | 0 | 0 | 51/51 |
| 9 | 6/6 | 0 | 0 | 57/57 |
| 10 | 8/8 | 0 | 0 | 65/65 |
| 11 | 5/5 | 0 | 0 | 70/70 |
| 12 | 5/5 | 0 | 0 | 75/75 |

**New work** 70/71, **regressions** 0, **repairs** 1, **cumulative** 75/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 6.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 5.1 | None | None | None | — | — | red | 20/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 15.7 | None | None | None | — | — | red | 26/27 |  | 0 / 0 | 0 | — | throttled 42% |
| 4 | Return to a board and find everything as it was left | DONE | 38.7 | None | None | None | — | — | green | 31/31 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 5 | Share a board with others using a link | DONE | 6.1 | None | None | None | — | — | red | 36/36 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 20.2 | None | None | None | — | — | green | 44/44 |  | 0 / 0 | 0 | — | throttled 100% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 7.6 | None | None | None | — | — | green | 51/51 |  | 0 / 0 | 0 | — | throttled 100% |
| 9 | Write free text anywhere on the board | DONE | 12.6 | None | None | None | — | — | red | 57/57 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 11.7 | None | None | None | — | — | red | 65/65 |  | 0 / 0 | 0 | — | throttled 0% |
| 11 | Sketch freehand with a pen | DONE | 5.6 | None | None | None | — | — | red | 70/70 |  | 0 / 0 | 0 | — | throttled 0% |
| 12 | Drop images onto the board | DONE | 14.2 | None | None | None | — | — | red | 75/75 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 11 stories, 144 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/11, final acceptance 75/75, stalled 0, partial 0, 51541 lines in src+tests.

> Stories 4, 9 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5063 / 0 | `BoardViewport.tsx` (192), `useCamera.ts` (114), `camera.ts` (65), `ZoomControls.tsx` (51), `package.json` (35), `NavigationHint.tsx` (23), +12 more |
| 2 | 1 by the agent | 1580 / 10 | `StickyNote.tsx` (240), `board-model.ts` (128), `StickyTextEditor.tsx` (112), `App.tsx` (79), `StickyText.ts` (67), `NoteToolbar.tsx` (60), +7 more |
| 3 | 1 by the agent | 2521 / 88 | `board-room.ts` (105), `connectBoard.ts` (98), `protocol.ts` (36), `ConnectionStatus.tsx` (34), `index.ts` (29), `StickyTextEditor.tsx` (27), +13 more |
| 4 | 1 by the agent | 1528 / 60 | `board-room.ts` (192), `board-store.ts` (156), `room-state.ts` (41), `connectBoard.ts` (22), `App.tsx` (20), `test-hooks.ts` (17), +10 more |
| 5 | 1 by the agent | 1123 / 33 | `SharePanel.tsx` (132), `BoardPage.tsx` (58), `useCreateBoard.ts` (55), `index.ts` (46), `router.ts` (37), `board-store.ts` (31), +13 more |
| 7 | 1 by the agent | 2176 / 268 | `useTransformGesture.ts` (220), `board-model.ts` (165), `StickyNote.tsx` (152), `App.tsx` (140), `geometry.ts` (102), `useSelection.ts` (96), +9 more |
| 8 | 1 by the agent | 831 / 9 | `undo.ts` (86), `App.tsx` (33), `useUndo.ts` (24), `StickyTextEditor.tsx` (23), `useBoardKeys.ts` (22), `UndoButtons.tsx` (19), +4 more |
| 9 | 1 by the agent | 1693 / 206 | `TextEditor.tsx` (173), `StickyTextEditor.tsx` (150), `text.ts` (113), `textLayout.ts` (100), `TextObject.tsx` (90), `TextToolbar.tsx` (62), +16 more |
| 10 | 1 by the agent | 2040 / 31 | `ConnectorObject.tsx` (157), `ConnectorTool.tsx` (149), `connector.ts` (123), `ShapeObject.tsx` (121), `shape.ts` (112), `ShapeTool.tsx` (94), +16 more |
| 11 | 1 by the agent | 962 / 6 | `PenTool.tsx` (139), `stroke.ts` (91), `PenToolbar.tsx` (79), `simplify.ts` (71), `StrokeObject.tsx` (57), `board-model.ts` (21), +9 more |
| 12 | 1 by the agent | 1709 / 5 | `useImageInsert.ts` (231), `ImageObject.tsx` (179), `image.ts` (123), `Toast.tsx` (52), `assets.ts` (42), `uploadImage.ts` (32), +14 more |

### Earlier stories broken or fixed

- **Story 4 broke 0, fixed 1** earlier held-out tests (story 4: Return to a board and find everything as it was left). Source files it changed most: `board-room.ts` (192), `board-store.ts` (156), `room-state.ts` (41), `connectBoard.ts` (22), `App.tsx` (20), `test-hooks.ts` (17), +10 more.
  - story 3: 6/7 → 7/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
