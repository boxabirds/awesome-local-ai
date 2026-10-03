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
| 7 | 6/8 | 0 | 0 | 38/44 |
| 8 | 6/7 | 0 | 0 | 44/51 |
| 9 | 6/6 | 0 | 0 | 50/57 |
| 10 | 3/8 | 0 | 0 | 53/65 |
| 11 | 1/5 | 0 | 0 | 54/70 |
| 12 | 3/5 | 0 | 0 | 57/75 |

**New work** 53/71, **regressions** 0, **repairs** 0, **cumulative** 57/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.0 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 14.5 | None | None | None | — | — | green | 18/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 20 GB |
| 3 | See other people's edits appear live on the same board | DONE | 106.1 | None | None | None | — | — | red | 23/27 |  | 0 / 0 | 3 | — | throttled 0%, server peak 23 GB |
| 4 | Return to a board and find everything as it was left | DONE | 26.8 | None | None | None | — | — | red | 27/31 |  | 0 / 0 | 1 | — | throttled 0%, server peak 23 GB |
| 5 | Share a board with others using a link | DONE | 16.2 | None | None | None | — | — | red | 32/36 |  | 0 / 0 | 0 | — | throttled 0%, server peak 23 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 49.3 | None | None | None | — | — | red | 38/44 |  | 0 / 1 | 3 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 18.0 | None | None | None | — | — | red | 44/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 9 | Write free text anywhere on the board | DONE | 66.6 | None | None | None | — | — | red | 50/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 68.9 | None | None | None | — | — | red | 53/65 |  | 1 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 11 | Sketch freehand with a pen | DONE | 27.4 | None | None | None | — | — | red | 54/70 |  | 0 / 0 | 2 | — | throttled 0%, server peak 26 GB |
| 12 | Drop images onto the board | DONE | 31.4 | None | None | None | — | — | red | 57/75 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |

**Totals:** 11 stories, 459 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/11, final acceptance 57/75, stalled 0, partial 0, 23862 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 6668 / 47 | `useCamera.ts` (229), `BoardViewport.tsx` (163), `camera.ts` (159), `styles.css` (142), `NOTES.md` (69), `App.tsx` (46), +14 more |
| 2 | 1 by the agent | 2749 / 19 | `StickyNote.tsx` (300), `board-model.ts` (196), `StickyTextEditor.tsx` (133), `StickyText.ts` (105), `NoteToolbar.tsx` (96), `App.tsx` (87), +8 more |
| 3 | 1 by the agent | 3911 / 35 | `board-room.ts` (146), `connectBoard.ts` (130), `NOTES.md` (79), `protocol.ts` (57), `testHooks.ts` (53), `index.ts` (44), +14 more |
| 4 | 1 by the agent | 2332 / 102 | `board-store.ts` (337), `board-room.ts` (270), `room-state.ts` (89), `PROGRESS.md` (85), `NOTES.md` (60), `connectBoard.ts` (53), +6 more |
| 5 | 1 by the agent | 1902 / 190 | `SharePanel.tsx` (158), `App.tsx` (153), `BoardContent.tsx` (125), `styles.css` (124), `index.ts` (105), `board-room.ts` (96), +12 more |
| 7 | 1 by the agent | 3124 / 663 | `useTransformGesture.ts` (293), `StickyNote.tsx` (228), `board-model.ts` (205), `geometry.ts` (186), `useSelection.ts` (153), `BoardContent.tsx` (116), +10 more |
| 8 | 1 by the agent | 1559 / 22 | `undo.ts` (90), `UndoButtons.tsx` (61), `NOTES.md` (60), `BoardContent.tsx` (45), `useUndo.ts` (41), `StickyTextEditor.tsx` (34), +6 more |
| 9 | 10 by the agent | 2464 / 365 | `TextEditor.tsx` (248), `text.ts` (225), `StickyTextEditor.tsx` (191), `textLayout.ts` (144), `TextObject.tsx` (126), `useTextBoxSync.ts` (107), +16 more |
| 10 | 1 by the agent | 3026 / 34 | `connector.ts` (257), `ConnectorTool.tsx` (243), `ConnectorObject.tsx` (223), `ShapeObject.tsx` (218), `shape.ts` (163), `ShapeTool.tsx` (143), +13 more |
| 11 | 1 by the agent | 1783 / 22 | `PenTool.tsx` (243), `stroke.ts` (133), `simplify.ts` (121), `PenToolbar.tsx` (109), `StrokeObject.tsx` (94), `NOTES.md` (52), +10 more |
| 12 | 1 by the agent | 2690 / 19 | `useImageInsert.ts` (376), `ImageObject.tsx` (252), `image.ts` (226), `assets.ts` (108), `BoardContent.tsx` (101), `uploadImage.ts` (61), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
