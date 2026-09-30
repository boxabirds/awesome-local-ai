# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 0/7 | 19 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 0/5 | 0 | 0 | 0/36 |
| 7 | 0/8 | 0 | 0 | 0/44 |
| 8 | 0/7 | 0 | 0 | 0/51 |
| 9 | 6/6 | 0 | 47 | 53/57 |
| 10 | 3/8 | 0 | 0 | 56/65 |
| 11 | 5/5 | 0 | 0 | 61/70 |

**New work** 29/66, **regressions** 19, **repairs** 47, **cumulative** 61/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 12.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 12.7 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 20 GB |
| 3 | See other people's edits appear live on the same board | DONE | 33.0 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 2 | — | throttled 0%, server peak 24 GB |
| 4 | Return to a board and find everything as it was left | DONE | 30.4 | None | None | None | — | — | red | 0/31 |  | 0 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 97.7 | None | None | None | — | — | red | 0/36 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 63.0 | None | None | None | — | — | red | 0/44 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 17.1 | None | None | None | — | — | red | 0/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |
| 9 | Write free text anywhere on the board | DONE | 80.8 | None | None | None | — | — | red | 53/57 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 23.7 | None | None | None | — | — | red | 56/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |
| 11 | Sketch freehand with a pen | DONE | 35.1 | None | None | None | — | — | red | 61/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |

**Totals:** 10 stories, 406 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/10, final acceptance 61/70, stalled 0, partial 0, 20659 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6648 / 0 | `BoardViewport.tsx` (238), `useCamera.ts` (122), `camera.ts` (111), `ZoomControls.tsx` (97), `App.tsx` (56), `playwright.config.ts` (35), +13 more |
| 2 | 1 by the agent | 2067 / 7 | `StickyNote.tsx` (241), `board-model.ts` (139), `StickyTextEditor.tsx` (126), `App.tsx` (124), `StickyText.ts` (76), `NoteToolbar.tsx` (69), +7 more |
| 3 | 1 by the agent | 3080 / 6 | `room-core.ts` (108), `ConnectionStatus.tsx` (83), `connectBoard.ts` (74), `types.d.ts` (69), `index.ts` (43), `protocol.ts` (42), +8 more |
| 4 | 1 by the agent | 2341 / 27 | `board-room.ts` (365), `board-store.ts` (231), `index.ts` (109), `room-state.ts` (56), `connectBoard.ts` (55), `App.tsx` (30), +7 more |
| 5 | 1 by the agent | 2282 / 434 | `App.tsx` (218), `Board.tsx` (198), `SharePanel.tsx` (193), `board-room.ts` (166), `BoardPage.tsx` (107), `NOTES.md` (93), +16 more |
| 7 | 1 by the agent | 3674 / 474 | `useTransformGesture.ts` (338), `board-model.ts` (232), `Board.tsx` (214), `geometry.ts` (197), `StickyNote.tsx` (163), `useSelection.ts` (147), +12 more |
| 8 | 1 by the agent | 1547 / 10 | `undo.ts` (93), `UndoButtons.tsx` (61), `Board.tsx` (60), `StickyTextEditor.tsx` (35), `useUndo.ts` (32), `useBoardKeys.ts` (30), +5 more |
| 9 | 1 by the agent | 2395 / 221 | `TextEditor.tsx` (188), `text.ts` (172), `StickyTextEditor.tsx` (164), `TextObject.tsx` (129), `textLayout.ts` (125), `Board.tsx` (100), +16 more |
| 10 | 1 by the agent | 2883 / 222 | `NOTES.md` (251), `ConnectorTool.tsx` (251), `connector.ts` (239), `ShapeObject.tsx` (183), `shape.ts` (166), `ShapeTool.tsx` (152), +11 more |
| 11 | 1 by the agent | 1759 / 12 | `PenTool.tsx` (272), `stroke.ts` (145), `simplify.ts` (121), `PenToolbar.tsx` (111), `StrokeObject.tsx` (89), `registry.tsx` (34), +8 more |

### Earlier stories broken or fixed

- **Story 3 broke 19, fixed 0** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `room-core.ts` (108), `ConnectionStatus.tsx` (83), `connectBoard.ts` (74), `types.d.ts` (69), `index.ts` (43), `protocol.ts` (42), +8 more.
  - story 1: 10/10 → 0/10; broke 10.
  - story 2: 9/10 → 0/10; broke 9.
- **Story 9 broke 0, fixed 47** earlier held-out tests (story 9: Write free text anywhere on the board). Source files it changed most: `TextEditor.tsx` (188), `text.ts` (172), `StickyTextEditor.tsx` (164), `TextObject.tsx` (129), `textLayout.ts` (125), `Board.tsx` (100), +16 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 10/10; fixed 10
  - story 3: 0/7 → 5/7; fixed 5
  - story 4: 0/4 → 4/4; fixed 4
  - story 5: 0/5 → 5/5; fixed 5
  - story 7: 0/8 → 7/8; fixed 7
  - story 8: 0/7 → 6/7; fixed 6

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
