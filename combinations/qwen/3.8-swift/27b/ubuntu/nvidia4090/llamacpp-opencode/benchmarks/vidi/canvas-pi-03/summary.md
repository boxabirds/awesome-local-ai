# Vidi run — qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-swift-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 0/6 | 0 | 0 | 0/6 |
| 2 | 0/10 | 0 | 0 | 0/20 |
| 3 | 6/7 | 0 | 20 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 5/5 | 0 | 0 | 35/36 |
| 7 | 7/8 | 2 | 0 | 40/44 |
| 8 | 7/7 | 0 | 0 | 47/51 |
| 9 | 5/6 | 0 | 0 | 52/57 |
| 10 | 8/8 | 0 | 0 | 60/65 |
| 11 | 5/5 | 0 | 0 | 65/70 |
| 12 | 3/5 | 0 | 0 | 68/75 |

**New work** 50/71, **regressions** 2, **repairs** 20, **cumulative** 68/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 10.4 | None | None | None | — | — | green | 0/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 33.5 | None | None | None | — | — | red | 0/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 19 GB |
| 3 | See other people's edits appear live on the same board | DONE | 91.7 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 4 | Return to a board and find everything as it was left | DONE | 134.8 | None | None | None | — | — | red | 30/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 26 GB |
| 5 | Share a board with others using a link | DONE | 99.9 | None | None | None | — | — | red | 35/36 |  | 0 / 0 (ended in error) | 3 | — | throttled 0%, server peak 26 GB MEMORY-ABORT |
| 7 | Select, move, resize and delete several objects at once | DONE | 96.9 | None | None | None | — | — | green | 40/44 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 77.5 | None | None | None | — | — | red | 47/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 9 | Write free text anywhere on the board | DONE | 51.7 | None | None | None | — | — | red | 52/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 105.5 | None | None | None | — | — | red | 60/65 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 11 | Sketch freehand with a pen | DONE | 35.9 | None | None | None | — | — | red | 65/70 |  | 0 / 0 | 2 | — | throttled 0%, server peak 26 GB |
| 12 | Drop images onto the board | DONE | 81.0 | None | None | None | — | — | red | 68/75 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |

**Totals:** 11 stories, 819 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/11, final acceptance 68/75, stalled 0, partial 0, 25752 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7615 / 0 | `BoardViewport.tsx` (219), `useCamera.ts` (121), `camera.ts` (115), `ZoomControls.tsx` (97), `App.tsx` (43), `playwright.config.ts` (33), +13 more |
| 2 | 1 by the agent | 2335 / 7 | `StickyNote.tsx` (272), `board-model.ts` (189), `StickyTextEditor.tsx` (174), `App.tsx` (148), `NoteToolbar.tsx` (102), `StickyText.ts` (96), +6 more |
| 3 | 1 by the agent | 3768 / 42 | `board-room.ts` (165), `connectBoard.ts` (149), `protocol.ts` (81), `useBoardDoc.ts` (52), `ConnectionStatus.tsx` (50), `App.tsx` (48), +15 more |
| 4 | 1 by the agent | 2700 / 226 | `board-store.ts` (323), `board-room.ts` (294), `test-ops.ts` (228), `room-state.ts` (117), `App.tsx` (57), `connectBoard.ts` (55), +13 more |
| 5 | harness snapshot (agent left work uncommitted) | 2444 / 362 | `App.tsx` (276), `Board.tsx` (233), `SharePanel.tsx` (211), `create-board.ts` (108), `BoardPage.tsx` (89), `NotFoundPage.tsx` (72), +15 more |
| 7 | 1 by the agent | 3219 / 328 | `useTransformGesture.ts` (343), `board-model.ts` (284), `geometry.ts` (211), `StickyNote.tsx` (207), `Board.tsx` (199), `useSelection.ts` (160), +8 more |
| 8 | 1 by the agent | 1666 / 21 | `undo.ts` (280), `UndoButtons.tsx` (91), `Board.tsx` (71), `useUndo.ts` (39), `StickyTextEditor.tsx` (32), `useBoardKeys.ts` (30), +5 more |
| 9 | 1 by the agent | 2565 / 332 | `TextEditor.tsx` (260), `StickyTextEditor.tsx` (229), `text.ts` (179), `textLayout.ts` (142), `TextObject.tsx` (129), `Board.tsx` (126), +13 more |
| 10 | 1 by the agent | 3499 / 37 | `ConnectorTool.tsx` (251), `ConnectorObject.tsx` (223), `connector.ts` (215), `shape.ts` (192), `ShapeObject.tsx` (177), `ShapeTool.tsx` (149), +13 more |
| 11 | 1 by the agent | 1962 / 5 | `PenTool.tsx` (300), `stroke.ts` (172), `StrokeObject.tsx` (136), `PenToolbar.tsx` (112), `simplify.ts` (105), `registry.tsx` (69), +8 more |
| 12 | 1 by the agent | 3241 / 2 | `useImageInsert.ts` (304), `ImageObject.tsx` (201), `image.ts` (201), `assets.ts` (173), `Toast.tsx` (87), `uploadImage.ts` (74), +16 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 20** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (165), `connectBoard.ts` (149), `protocol.ts` (81), `useBoardDoc.ts` (52), `ConnectionStatus.tsx` (50), `App.tsx` (48), +15 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 10/10; fixed 10
- **Story 7 broke 2, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (343), `board-model.ts` (284), `geometry.ts` (211), `StickyNote.tsx` (207), `Board.tsx` (199), `useSelection.ts` (160), +8 more.
  - story 2: 10/10 → 9/10; broke 1.
  - story 3: 6/7 → 5/7; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
