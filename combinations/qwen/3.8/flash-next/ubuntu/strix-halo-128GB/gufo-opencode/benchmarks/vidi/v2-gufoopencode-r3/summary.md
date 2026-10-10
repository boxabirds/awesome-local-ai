# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-opencode

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client opencode 1.18.30, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |
| 7 | 7/8 | 0 | 1 | 41/44 |
| 8 | 7/7 | 0 | 0 | 48/51 |
| 9 | 6/6 | 0 | 0 | 54/57 |
| 10 | 8/8 | 0 | 0 | 62/65 |
| 11 | 5/5 | 0 | 0 | 67/70 |
| 12 | 5/5 | 0 | 0 | 72/75 |

**New work** 67/71, **regressions** 0, **repairs** 1, **cumulative** 72/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 51.4 | None | None | None | — | — | green | 6/6 |  | 1 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 50.4 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 91.8 | None | None | None | — | — | red | 24/27 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE | 164.9 | None | None | None | — | — | green | 28/31 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 5 | Share a board with others using a link | DONE | 56.4 | None | None | None | — | — | red | 33/36 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 85.6 | None | None | None | — | — | green | 41/44 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 65.1 | None | None | None | — | — | red | 48/51 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 9 | Write free text anywhere on the board | DONE | 72.2 | None | None | None | — | — | red | 54/57 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 69.2 | None | None | None | — | — | green | 62/65 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 11 | Sketch freehand with a pen | DONE | 101.3 | None | None | None | — | — | red | 67/70 |  | 1 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 12 | Drop images onto the board | DONE | 65.3 | None | None | None | — | — | red | 72/75 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |

**Totals:** 11 stories, 874 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/11, final acceptance 72/75, stalled 0, partial 0, 122154 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 5563 / 57 | `useCamera.ts` (167), `BoardViewport.tsx` (149), `camera.ts` (135), `index.css` (108), `playwright.config.ts` (94), `App.tsx` (69), +14 more |
| 2 | 8 by the agent | 2333 / 90 | `StickyNote.tsx` (234), `board-model.ts` (220), `index.css` (172), `StickyText.ts` (115), `App.tsx` (112), `StickyTextEditor.tsx` (101), +11 more |
| 3 | 6 by the agent | 3646 / 61 | `board-room.ts` (148), `connectBoard.ts` (118), `NOTES.md` (65), `protocol.ts` (61), `board-id.ts` (37), `index.ts` (35), +12 more |
| 4 | 1 by the agent | 2751 / 125 | `board-store.ts` (392), `board-room.ts` (316), `room-state.ts` (97), `NOTES.md` (75), `test-hooks.ts` (44), `connectBoard.ts` (35), +14 more |
| 5 | 1 by the agent | 1862 / 289 | `BoardPage.tsx` (280), `App.tsx` (217), `index.css` (148), `SharePanel.tsx` (130), `board-store.ts` (103), `board-room.ts` (59), +13 more |
| 7 | 1 by the agent | 2833 / 357 | `board-model.ts` (287), `useTransformGesture.ts` (266), `StickyNote.tsx` (189), `useSelection.ts` (183), `BoardPage.tsx` (148), `geometry.ts` (145), +12 more |
| 8 | 1 by the agent | 1444 / 25 | `undo.ts` (95), `StickyTextEditor.tsx` (53), `NOTES.md` (52), `UndoButtons.tsx` (49), `useUndo.ts` (42), `BoardPage.tsx` (39), +9 more |
| 9 | 1 by the agent | 2181 / 232 | `text.ts` (198), `TextEditor.tsx` (181), `StickyTextEditor.tsx` (164), `BoardPage.tsx` (112), `TextObject.tsx` (107), `textLayout.ts` (100), +17 more |
| 10 | 1 by the agent | 3316 / 18 | `connector.ts` (320), `ConnectorObject.tsx` (238), `shape.ts` (194), `ConnectorTool.tsx` (183), `index.css` (152), `ShapeObject.tsx` (143), +14 more |
| 11 | 1 by the agent | 1710 / 9 | `PenTool.tsx` (256), `stroke.ts` (191), `simplify.ts` (85), `index.css` (82), `StrokeObject.tsx` (73), `PenToolbar.tsx` (70), +9 more |
| 12 | 1 by the agent | 2577 / 13 | `useImageInsert.ts` (283), `image.ts` (267), `ImageObject.tsx` (252), `index.css` (116), `NOTES.md` (79), `assets.ts` (72), +14 more |

### Earlier stories broken or fixed

- **Story 7 broke 0, fixed 1** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `board-model.ts` (287), `useTransformGesture.ts` (266), `StickyNote.tsx` (189), `useSelection.ts` (183), `BoardPage.tsx` (148), `geometry.ts` (145), +12 more.
  - story 2: 9/10 → 10/10; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
