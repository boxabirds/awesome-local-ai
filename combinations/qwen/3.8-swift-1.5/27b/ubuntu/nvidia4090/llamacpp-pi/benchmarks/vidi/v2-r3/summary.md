# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 7 | 8/8 | 0 | 0 | 42/44 |
| 8 | 7/7 | 0 | 0 | 49/51 |
| 9 | 6/6 | 1 | 0 | 54/57 |
| 10 | 3/8 | 1 | 0 | 56/65 |
| 11 | 5/5 | 0 | 1 | 62/70 |
| 12 | 1/5 | 1 | 0 | 62/75 |

**New work** 30/39, **regressions** 3, **repairs** 1, **cumulative** 62/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 24.0 | None | None | None | — | — | red | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 47.6 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 23 GB |
| 3 | See other people's edits appear live on the same board | DONE | 20.4 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 23 GB |
| 4 | Return to a board and find everything as it was left | DONE | 32.7 | None | None | None | — | — | red | 0/31 |  | 0 / 1 | 1 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 127.9 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 6 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 163.3 | None | None | None | — | — | green | 42/44 |  | 0 / 0 | 6 | — | throttled 0%, server peak 26 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 46.7 | None | None | None | — | — | green | 49/51 |  | 0 / 0 | 2 | — | throttled 0%, server peak 26 GB |
| 9 | Write free text anywhere on the board | DONE | 60.7 | None | None | None | — | — | green | 54/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 22.0 | None | None | None | — | — | red | 56/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |
| 11 | Sketch freehand with a pen | DONE | 54.7 | None | None | None | — | — | red | 62/70 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 12 | Drop images onto the board | DONE | 23.3 | None | None | None | — | — | red | 62/75 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |

**Totals:** 11 stories, 623 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/11, final acceptance 62/75, stalled 0, partial 0, 23367 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7555 / 0 | `BoardViewport.tsx` (172), `camera.ts` (111), `ZoomControls.tsx` (100), `useCamera.ts` (92), `App.tsx` (67), `NOTES.md` (42), +13 more |
| 2 | 6 by the agent | 2682 / 96 | `StickyNote.tsx` (270), `board-model.ts` (226), `StickyTextEditor.tsx` (151), `App.tsx` (146), `StickyText.ts` (137), `NoteToolbar.tsx` (81), +6 more |
| 3 | 1 by the agent | 3582 / 85 | `board-room.ts` (121), `connectBoard.ts` (77), `protocol.ts` (54), `index.ts` (42), `ConnectionStatus.tsx` (36), `board-id.ts` (33), +9 more |
| 4 | 1 by the agent | 2079 / 1171 | `board-room.ts` (212), `board-store.ts` (143), `room-state.ts` (77), `test-hooks.ts` (39), `NOTES.md` (37), `connectBoard.ts` (37), +11 more |
| 5 | 1 by the agent | 2258 / 433 | `board-store.ts` (318), `BoardPage.tsx` (306), `App.tsx` (243), `board-room.ts` (237), `SharePanel.tsx` (173), `test-hooks.ts` (77), +15 more |
| 7 | 1 by the agent | 3553 / 425 | `useTransformGesture.ts` (309), `StickyNote.tsx` (255), `BoardPage.tsx` (233), `board-model.ts` (198), `useSelection.ts` (153), `geometry.ts` (140), +8 more |
| 8 | 1 by the agent | 1722 / 25 | `undo.ts` (115), `UndoButtons.tsx` (67), `StickyTextEditor.tsx` (61), `BoardPage.tsx` (49), `useBoardKeys.ts` (42), `useUndo.ts` (39), +7 more |
| 9 | 3 by the agent | 3120 / 454 | `useBoardKeys.ts` (277), `TextEditor.tsx` (228), `textLayout.ts` (222), `StickyTextEditor.tsx` (207), `text.ts` (163), `TextObject.tsx` (139), +16 more |
| 10 | 1 by the agent | 3093 / 23 | `ConnectorTool.tsx` (246), `connector.ts` (215), `shape.ts` (211), `ShapeObject.tsx` (168), `ShapeTool.tsx` (168), `ConnectorObject.tsx` (123), +13 more |
| 11 | 1 by the agent | 2082 / 9 | `PenTool.tsx` (318), `stroke.ts` (180), `StrokeObject.tsx` (134), `PenToolbar.tsx` (127), `simplify.ts` (97), `registry.tsx` (58), +6 more |
| 12 | 1 by the agent | 2279 / 8 | `useImageInsert.ts` (321), `ImageObject.tsx` (272), `image.ts` (235), `assets.ts` (113), `Toast.tsx` (79), `BoardPage.tsx` (57), +11 more |

### Earlier stories broken or fixed

- **Story 9 broke 1, fixed 0** earlier held-out tests (story 9: e2e tests (TC-26..31), auto-width cap fix, 300-char fixture; story 9: component tests for tool mode (TC-14..18) and text objects (TC-19..25); story 9: text object model, layout, box sync, Text tool, TextObject components). Source files it changed most: `useBoardKeys.ts` (277), `TextEditor.tsx` (228), `textLayout.ts` (222), `StickyTextEditor.tsx` (207), `text.ts` (163), `TextObject.tsx` (139), +16 more.
  - story 1: 10/10 → 9/10; broke 1.
- **Story 10 broke 1, fixed 0** earlier held-out tests (story 10: Draw shapes and connect them with arrows that follow when moved). Source files it changed most: `ConnectorTool.tsx` (246), `connector.ts` (215), `shape.ts` (211), `ShapeObject.tsx` (168), `ShapeTool.tsx` (168), `ConnectorObject.tsx` (123), +13 more.
  - story 9: 6/6 → 5/6; broke 1.
- **Story 11 broke 0, fixed 1** earlier held-out tests (story 11: Sketch freehand with a pen). Source files it changed most: `PenTool.tsx` (318), `stroke.ts` (180), `StrokeObject.tsx` (134), `PenToolbar.tsx` (127), `simplify.ts` (97), `registry.tsx` (58), +6 more.
  - story 1: 9/10 → 10/10; fixed 1
- **Story 12 broke 1, fixed 0** earlier held-out tests (story 12: Drop images onto the board). Source files it changed most: `useImageInsert.ts` (321), `ImageObject.tsx` (272), `image.ts` (235), `assets.ts` (113), `Toast.tsx` (79), `BoardPage.tsx` (57), +11 more.
  - story 1: 10/10 → 9/10; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
