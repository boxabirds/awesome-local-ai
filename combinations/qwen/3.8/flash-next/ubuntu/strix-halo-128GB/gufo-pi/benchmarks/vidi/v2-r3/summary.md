# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 7 | 5/8 | 0 | 0 | 38/44 |
| 8 | 7/7 | 0 | 0 | 45/51 |
| 9 | 6/6 | 0 | 0 | 51/57 |
| 10 | 5/8 | 0 | 0 | 56/65 |
| 11 | 5/5 | 0 | 0 | 61/70 |
| 12 | 4/5 | 0 | 0 | 65/75 |

**New work** 32/39, **regressions** 0, **repairs** 0, **cumulative** 65/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 28.1 | None | None | None | — | — | green | 6/6 |  | 0 / 2 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 95.8 | None | None | None | — | — | green | 19/20 |  | 1 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 38.6 | None | None | None | — | — | red | 24/27 |  | 0 / 0 (ended in error) | 1 | — | throttled 0%, server peak 0 GB MEMORY-ABORT |
| 4 | Return to a board and find everything as it was left | DONE | 67.2 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 39.2 | None | None | None | — | — | green | 33/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 50.0 | None | None | None | — | — | green | 38/44 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 22.4 | None | None | None | — | — | green | 45/51 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE | 32.3 | None | None | None | — | — | green | 51/57 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 52.5 | None | None | None | — | — | green | 56/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 11 | Sketch freehand with a pen | DONE | 15.0 | None | None | None | — | — | green | 61/70 |  | 0 / 0 (ended in error) | 0 | — | throttled 0%, server peak 0 GB MEMORY-ABORT |
| 12 | Drop images onto the board | DONE | 35.4 | None | None | None | — | — | green | 65/75 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 11 stories, 477 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 9/11, final acceptance 65/75, stalled 0, partial 0, 24998 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7250 / 0 | `BoardViewport.tsx` (216), `useCamera.ts` (122), `camera.ts` (117), `App.tsx` (93), `ZoomControls.tsx` (73), `package.json` (33), +14 more |
| 2 | 4 by the agent | 3259 / 50 | `StickyNote.tsx` (318), `board-model.ts` (228), `StickyTextEditor.tsx` (177), `StickyText.ts` (136), `App.tsx` (112), `NoteToolbar.tsx` (90), +8 more |
| 3 | harness snapshot (agent left work uncommitted) | 3118 / 15 | `board-room.ts` (137), `protocol.ts` (99), `connectBoard.ts` (96), `ConnectionStatus.tsx` (48), `App.tsx` (38), `index.ts` (37), +10 more |
| 4 | 1 by the agent | 2603 / 68 | `board-room.ts` (327), `board-store.ts` (192), `test-hooks.ts` (92), `room-state.ts` (63), `connectBoard.ts` (62), `board-store-pure.ts` (52), +12 more |
| 5 | 1 by the agent | 1739 / 91 | `SharePanel.tsx` (179), `BoardPage.tsx` (100), `board-room.ts` (75), `index.ts` (53), `board-store.ts` (47), `NotFoundPage.tsx` (44), +13 more |
| 7 | 1 by the agent | 2901 / 242 | `useTransformGesture.ts` (298), `board-model.ts` (186), `geometry.ts` (177), `StickyNote.tsx` (150), `App.tsx` (146), `useSelection.ts` (139), +8 more |
| 8 | 1 by the agent | 1569 / 115 | `NOTES.md` (127), `undo.ts` (116), `UndoButtons.tsx` (87), `StickyTextEditor.tsx` (46), `useUndo.ts` (42), `App.tsx` (38), +4 more |
| 9 | 1 by the agent | 2553 / 127 | `TextEditor.tsx` (274), `TextObject.tsx` (202), `textLayout.ts` (143), `text.ts` (121), `TextToolbar.tsx` (94), `board-model.ts` (92), +13 more |
| 10 | 1 by the agent | 3740 / 50 | `connector.ts` (338), `ShapeObject.tsx` (289), `ConnectorTool.tsx` (284), `App.tsx` (276), `shape.ts` (205), `ShapeTool.tsx` (156), +14 more |
| 11 | harness snapshot (agent left work uncommitted) | 1571 / 19 | `PenTool.tsx` (211), `stroke.ts` (184), `simplify.ts` (116), `PenToolbar.tsx` (110), `App.tsx` (67), `StrokeObject.tsx` (65), +7 more |
| 12 | harness snapshot (agent left work uncommitted) | 2692 / 69 | `useImageInsert.ts` (309), `image.ts` (267), `ImageObject.tsx` (234), `NOTES.md` (127), `assets.ts` (112), `Toast.tsx` (86), +12 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
