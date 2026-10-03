# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 5/7 | 0 | 0 | 23/27 |
| 4 | 4/4 | 0 | 0 | 27/31 |
| 5 | 5/5 | 0 | 0 | 32/36 |
| 7 | 5/8 | 1 | 0 | 36/44 |
| 8 | 7/7 | 0 | 0 | 43/51 |
| 9 | 6/6 | 0 | 0 | 49/57 |
| 10 | 7/8 | 0 | 0 | 56/65 |
| 11 | 5/5 | 0 | 0 | 61/70 |

**New work** 58/66, **regressions** 1, **repairs** 0, **cumulative** 61/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 27.3 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 24.0 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 18 GB |
| 3 | See other people's edits appear live on the same board | DONE | 126.2 | None | None | None | — | — | green | 23/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 23 GB |
| 4 | Return to a board and find everything as it was left | DONE | 42.6 | None | None | None | — | — | red | 27/31 |  | 0 / 1 | 1 | — | throttled 0%, server peak 23 GB |
| 5 | Share a board with others using a link | DONE | 35.4 | None | None | None | — | — | red | 32/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 23 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 72.2 | None | None | None | — | — | green | 36/44 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 22.3 | None | None | None | — | — | red | 43/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 9 | Write free text anywhere on the board | DONE | 62.0 | None | None | None | — | — | red | 49/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 44.3 | None | None | None | — | — | red | 56/65 |  | 0 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 11 | Sketch freehand with a pen | DONE | 24.2 | None | None | None | — | — | red | 61/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |

**Totals:** 10 stories, 480 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/10, final acceptance 61/70, stalled 0, partial 0, 21216 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 5669 / 73 | `BoardViewport.tsx` (244), `camera.ts` (195), `useCamera.ts` (154), `ZoomControls.tsx` (101), `App.tsx` (50), `NOTES.md` (46), +13 more |
| 2 | 1 by the agent | 2232 / 22 | `StickyNote.tsx` (241), `board-model.ts` (213), `StickyTextEditor.tsx` (169), `StickyText.ts` (109), `App.tsx` (90), `NoteToolbar.tsx` (77), +8 more |
| 3 | 4 by the agent | 3637 / 330 | `board-room.ts` (173), `connectBoard.ts` (130), `protocol.ts` (85), `ConnectionStatus.tsx` (50), `index.ts` (44), `testHooks.ts` (42), +10 more |
| 4 | 1 by the agent | 2288 / 91 | `board-store.ts` (260), `board-room.ts` (243), `room-state.ts` (102), `connectBoard.ts` (45), `testHooks.ts` (40), `useBoardDoc.ts` (24), +5 more |
| 5 | 1 by the agent | 1911 / 229 | `BoardPage.tsx` (237), `SharePanel.tsx` (199), `App.tsx` (181), `board-store.ts` (95), `NOTES.md` (86), `state.ts` (79), +12 more |
| 7 | 3 by the agent | 3173 / 418 | `board-model.ts` (321), `useTransformGesture.ts` (290), `geometry.ts` (184), `BoardPage.tsx` (165), `StickyNote.tsx` (162), `useSelection.ts` (154), +13 more |
| 8 | 1 by the agent | 1385 / 26 | `undo.ts` (95), `UndoButtons.tsx` (61), `StickyTextEditor.tsx` (51), `BoardPage.tsx` (40), `useUndo.ts` (36), `useBoardKeys.ts` (32), +7 more |
| 9 | 7 by the agent | 2685 / 370 | `StickyTextEditor.tsx` (230), `TextEditor.tsx` (225), `text.ts` (217), `TextObject.tsx` (173), `textLayout.ts` (158), `BoardPage.tsx` (141), +16 more |
| 10 | 9 by the agent | 3602 / 120 | `ConnectorObject.tsx` (260), `connector.ts` (258), `ConnectorTool.tsx` (198), `ShapeObject.tsx` (176), `shape.ts` (174), `Toolbar.tsx` (164), +17 more |
| 11 | 1 by the agent | 1870 / 13 | `PenTool.tsx` (253), `stroke.ts` (172), `simplify.ts` (126), `PenToolbar.tsx` (118), `BoardPage.tsx` (62), `StrokeObject.tsx` (54), +10 more |

### Earlier stories broken or fixed

- **Story 7 broke 1, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once; story 7: object type registry with sticky spec and testbox fixture; story 7: pure geometry and generic group operations in board-model). Source files it changed most: `board-model.ts` (321), `useTransformGesture.ts` (290), `geometry.ts` (184), `BoardPage.tsx` (165), `StickyNote.tsx` (162), `useSelection.ts` (154), +13 more.
  - story 2: 8/10 → 7/10; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
