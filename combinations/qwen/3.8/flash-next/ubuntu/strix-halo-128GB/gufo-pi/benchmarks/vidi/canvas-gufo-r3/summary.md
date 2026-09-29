# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 5/7 | 0 | 0 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |
| 5 | 5/5 | 0 | 0 | 34/36 |
| 7 | 8/8 | 1 | 0 | 41/44 |
| 8 | 7/7 | 0 | 0 | 48/51 |
| 9 | 1/6 | 0 | 0 | 49/57 |
| 10 | 7/8 | 0 | 3 | 59/65 |
| 11 | 5/5 | 0 | 0 | 64/70 |

**New work** 58/66, **regressions** 1, **repairs** 3, **cumulative** 64/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 20.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 45.5 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 116.7 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 48.7 | None | None | None | — | — | red | 29/31 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 18.0 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 111.4 | None | None | None | — | — | red | 41/44 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 45.6 | None | None | None | — | — | red | 48/51 |  | 0 / 1 | 1 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE | 46.8 | None | None | None | — | — | red | 49/57 |  | 0 / 4 | 1 | — | throttled 0%, server peak 0 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 72.1 | None | None | None | — | — | green | 59/65 |  | 0 / 3 | 2 | — | throttled 0%, server peak 0 GB |
| 11 | Sketch freehand with a pen | DONE | 29.0 | None | None | None | — | — | red | 64/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |

**Totals:** 10 stories, 554 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/10, final acceptance 64/70, stalled 0, partial 0, 22007 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7211 / 0 | `BoardViewport.tsx` (211), `camera.ts` (116), `useCamera.ts` (107), `ZoomControls.tsx` (101), `App.tsx` (82), `package.json` (33), +14 more |
| 2 | 3 by the agent | 2887 / 52 | `StickyNote.tsx` (392), `board-model.ts` (178), `StickyTextEditor.tsx` (133), `App.tsx` (107), `StickyText.ts` (101), `useBoardDoc.ts` (100), +8 more |
| 3 | 1 by the agent | 3274 / 23 | `board-room.ts` (151), `connectBoard.ts` (122), `protocol.ts` (114), `NOTES.md` (84), `ConnectionStatus.tsx` (66), `App.tsx` (59), +14 more |
| 4 | 1 by the agent | 2343 / 100 | `board-room.ts` (324), `board-store.ts` (188), `room-state.ts` (94), `App.tsx` (61), `test-hooks.ts` (51), `connectBoard.ts` (43), +10 more |
| 5 | 1 by the agent | 2086 / 307 | `App.tsx` (229), `SharePanel.tsx` (179), `Board.tsx` (170), `board-room.ts` (140), `BoardPage.tsx` (101), `board-store.ts` (93), +16 more |
| 7 | 1 by the agent | 2790 / 423 | `useTransformGesture.ts` (333), `StickyNote.tsx` (186), `geometry.ts` (171), `SelectionOverlay.tsx` (165), `useSelection.ts` (162), `board-model.ts` (162), +9 more |
| 8 | 1 by the agent | 1651 / 54 | `undo.ts` (95), `UndoButtons.tsx` (87), `NOTES.md` (82), `Board.tsx` (54), `StickyTextEditor.tsx` (49), `useUndo.ts` (40), +4 more |
| 9 | 1 by the agent | 2279 / 160 | `TextObject.tsx` (207), `text.ts` (186), `TextEditor.tsx` (182), `Board.tsx` (145), `textLayout.ts` (101), `TextToolbar.tsx` (94), +16 more |
| 10 | harness snapshot (agent left work uncommitted) | 3443 / 23 | `connector.ts` (268), `ShapeObject.tsx` (248), `ConnectorObject.tsx` (225), `ConnectorTool.tsx` (215), `shape.ts` (203), `ShapeTool.tsx` (147), +11 more |
| 11 | 1 by the agent | 1955 / 137 | `PenTool.tsx` (287), `NOTES.md` (207), `stroke.ts` (190), `simplify.ts` (117), `PenToolbar.tsx` (112), `StrokeObject.tsx` (103), +8 more |

### Earlier stories broken or fixed

- **Story 7 broke 1, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (333), `StickyNote.tsx` (186), `geometry.ts` (171), `SelectionOverlay.tsx` (165), `useSelection.ts` (162), `board-model.ts` (162), +9 more.
  - story 1: 10/10 → 9/10; broke 1.
- **Story 10 broke 0, fixed 3** earlier held-out tests (harness: snapshot after story 10 (uncommitted agent work)). Source files it changed most: `connector.ts` (268), `ShapeObject.tsx` (248), `ConnectorObject.tsx` (225), `ConnectorTool.tsx` (215), `shape.ts` (203), `ShapeTool.tsx` (147), +11 more.
  - story 9: 1/6 → 4/6; fixed 3

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
