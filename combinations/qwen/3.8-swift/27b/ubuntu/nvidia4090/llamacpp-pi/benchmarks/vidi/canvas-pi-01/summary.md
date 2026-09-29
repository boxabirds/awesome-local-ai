# Vidi run — qwen/3.8-swift/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-swift-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 38.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 20 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 40.1 | None | None | None | — | — | green | 18/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 23 GB |
| 3 | See other people's edits appear live on the same board | DONE | 113.2 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 4 | Return to a board and find everything as it was left | DONE | 71.5 | None | None | None | — | — | red | 30/31 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 5 | Share a board with others using a link | DONE | 76.8 | None | None | None | — | — | green | 35/36 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 70.6 | None | None | None | — | — | green | 41/44 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 53.7 | None | None | None | — | — | green | 48/51 |  | 0 / 0 | 2 | — | throttled 0%, server peak 26 GB |
| 9 | Write free text anywhere on the board | DONE | 60.1 | None | None | None | — | — | green | 53/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 99.5 | None | None | None | — | — | red | 60/65 |  | 0 / 0 | 4 | — | throttled 0%, server peak 26 GB |
| 11 | Sketch freehand with a pen | DONE | 32.8 | None | None | None | — | — | red | 65/70 |  | 0 / 0 | 2 | — | throttled 0%, server peak 26 GB |
| 12 | Drop images onto the board | DONE | 53.5 | None | None | None | — | — | red | 68/75 |  | 0 / 0 | 2 | — | throttled 0%, server peak 26 GB |

**Totals:** 11 stories, 711 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/11, final acceptance 68/75, stalled 0, partial 0, 25820 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6601 / 42 | `BoardViewport.tsx` (194), `useCamera.ts` (175), `camera.ts` (162), `styles.css` (106), `NOTES.md` (72), `App.tsx` (53), +14 more |
| 2 | 1 by the agent | 2576 / 14 | `StickyNote.tsx` (238), `styles.css` (170), `board-model.ts` (167), `StickyTextEditor.tsx` (139), `App.tsx` (130), `StickyText.ts` (82), +9 more |
| 3 | 1 by the agent | 3926 / 28 | `board-room.ts` (162), `connectBoard.ts` (144), `NOTES.md` (80), `protocol.ts` (61), `App.tsx` (58), `index.ts` (42), +15 more |
| 4 | 7 by the agent | 2008 / 158 | `board-store.ts` (365), `board-room.ts` (349), `room-state.ts` (86), `App.tsx` (24), `connectBoard.ts` (24), `index.ts` (17), +9 more |
| 5 | 1 by the agent | 2289 / 365 | `BoardPage.tsx` (250), `App.tsx` (225), `styles.css` (127), `SharePanel.tsx` (124), `index.ts` (92), `create-board.ts` (91), +12 more |
| 7 | 1 by the agent | 3341 / 422 | `board-model.ts` (316), `useTransformGesture.ts` (315), `StickyNote.tsx` (238), `BoardPage.tsx` (213), `geometry.ts` (165), `useSelection.ts` (136), +11 more |
| 8 | 1 by the agent | 1711 / 16 | `undo.ts` (92), `NOTES.md` (74), `UndoButtons.tsx` (50), `useUndo.ts` (45), `StickyTextEditor.tsx` (38), `BoardPage.tsx` (36), +8 more |
| 9 | 9 by the agent | 2440 / 319 | `text.ts` (253), `TextEditor.tsx` (220), `StickyTextEditor.tsx` (195), `textLayout.ts` (162), `TextObject.tsx` (133), `text-edit.ts` (79), +15 more |
| 10 | 9 by the agent | 3872 / 220 | `ConnectorObject.tsx` (260), `ConnectorTool.tsx` (238), `Toolbar.tsx` (231), `shape.ts` (222), `connector.ts` (205), `connector-geometry.ts` (178), +13 more |
| 11 | 7 by the agent | 1888 / 22 | `PenTool.tsx` (246), `stroke.ts` (150), `simplify.ts` (122), `styles.css` (120), `StrokeObject.tsx` (94), `PenToolbar.tsx` (83), +10 more |
| 12 | 1 by the agent | 3122 / 8 | `useImageInsert.ts` (271), `image.ts` (231), `ImageObject.tsx` (185), `assets.ts` (103), `NOTES.md` (77), `measureImage.ts` (73), +14 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 2** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (162), `connectBoard.ts` (144), `NOTES.md` (80), `protocol.ts` (61), `App.tsx` (58), `index.ts` (42), +15 more.
  - story 2: 8/10 → 10/10; fixed 2
- **Story 10 broke 1, fixed 0** earlier held-out tests (story 10: Draw shapes and connect them with arrows that follow when moved; story 10: component tests for shape/connector tools, objects and active tool (task 14); story 10: connector tool with hover dots, connector object with arrowhead and re-attach handles (task 13); story 10: shape tool, shape object with centred label, shape toolbar (task 12); story 10 task 11: useActiveTool hook and toolbar buttons with shortcuts 1-6; story 10 task 10: implement connector model, geometry, and detach-on-delete; story 10 task 9: connector model and geometry unit tests first (TC-07..TC-14, TC-29); story 10 task 8: implement shape model (create by drag/click/Shift, style validation, label Y.Text); story 10 task 7: shape model unit tests first (TC-01..TC-06) + SHAPE_* settings and stubs). Source files it changed most: `ConnectorObject.tsx` (260), `ConnectorTool.tsx` (238), `Toolbar.tsx` (231), `shape.ts` (222), `connector.ts` (205), `connector-geometry.ts` (178), +13 more.
  - story 2: 10/10 → 9/10; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
