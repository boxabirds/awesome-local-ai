# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 8/10 | 0 | 0 | 18/20 |
| 3 | 4/7 | 0 | 0 | 22/27 |
| 4 | 4/4 | 0 | 0 | 26/31 |
| 5 | 5/5 | 0 | 0 | 31/36 |
| 7 | 6/8 | 0 | 0 | 37/44 |
| 8 | 7/7 | 0 | 0 | 44/51 |
| 9 | 6/6 | 0 | 1 | 51/57 |
| 10 | 8/8 | 0 | 0 | 59/65 |
| 11 | 4/5 | 0 | 0 | 63/70 |

**New work** 58/66, **regressions** 0, **repairs** 1, **cumulative** 63/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 37.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 41.7 | None | None | None | — | — | red | 18/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 113.9 | None | None | None | — | — | red | 22/27 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 31.2 | None | None | None | — | — | red | 26/31 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 54.2 | None | None | None | — | — | red | 31/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 37.4 | None | None | None | — | — | red | 37/44 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 38.2 | None | None | None | — | — | red | 44/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE | 54.8 | None | None | None | — | — | red | 51/57 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 38.9 | None | None | None | — | — | red | 59/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 11 | Sketch freehand with a pen | DONE | 49.4 | None | None | None | — | — | red | 63/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 10 stories, 497 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/10, final acceptance 63/70, stalled 0, partial 0, 23005 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 7101 / 28 | `useCamera.ts` (236), `BoardViewport.tsx` (228), `styles.css` (177), `camera.ts` (174), `NOTES.md` (96), `ZoomControls.tsx` (70), +14 more |
| 2 | 2 by the agent, + harness snapshot | 3106 / 47 | `StickyNote.tsx` (303), `board-model.ts` (250), `styles.css` (191), `App.tsx` (124), `StickyText.ts` (115), `StickyTextEditor.tsx` (104), +9 more |
| 3 | 1 by the agent | 3354 / 30 | `board-room.ts` (172), `connectBoard.ts` (100), `protocol.ts` (86), `StickyTextEditor.tsx` (53), `index.ts` (39), `board-id.ts` (32), +14 more |
| 4 | 1 by the agent | 2309 / 125 | `board-room.ts` (342), `board-store.ts` (169), `room-state.ts` (67), `persistence.ts` (44), `connectBoard.ts` (40), `test-hooks.ts` (38), +9 more |
| 5 | 1 by the agent | 1756 / 34 | `SharePanel.tsx` (154), `styles.css` (122), `board-room.ts` (104), `BoardPage.tsx` (90), `test-hooks.ts` (59), `index.ts` (57), +11 more |
| 7 | 1 by the agent | 3094 / 342 | `useTransformGesture.ts` (373), `geometry.ts` (224), `StickyNote.tsx` (190), `board-model.ts` (179), `App.tsx` (155), `useSelection.ts` (152), +9 more |
| 8 | 1 by the agent | 1555 / 64 | `undo.ts` (101), `NOTES.md` (89), `StickyTextEditor.tsx` (68), `App.tsx` (51), `UndoButtons.tsx` (47), `useBoardKeys.ts` (47), +4 more |
| 9 | 1 by the agent | 2280 / 106 | `TextObject.tsx` (192), `TextEditor.tsx` (190), `text.ts` (189), `textLayout.ts` (130), `App.tsx` (118), `TextToolbar.tsx` (88), +16 more |
| 10 | 1 by the agent | 3308 / 14 | `connector.ts` (293), `ConnectorTool.tsx` (270), `ShapeObject.tsx` (207), `ConnectorObject.tsx` (180), `shape.ts` (178), `App.tsx` (176), +12 more |
| 11 | 1 by the agent | 2051 / 10 | `PenTool.tsx` (266), `stroke.ts` (197), `simplify.ts` (140), `StrokeObject.tsx` (124), `PenToolbar.tsx` (82), `App.tsx` (53), +8 more |

### Earlier stories broken or fixed

- **Story 9 broke 0, fixed 1** earlier held-out tests (story 9: Write free text anywhere on the board). Source files it changed most: `TextObject.tsx` (192), `TextEditor.tsx` (190), `text.ts` (189), `textLayout.ts` (130), `App.tsx` (118), `TextToolbar.tsx` (88), +16 more.
  - story 7: 6/8 → 7/8; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
