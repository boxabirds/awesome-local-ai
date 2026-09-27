# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/llamacpp-pi

Model `qwen3.8-flash-next`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 77.8 | None | None | None | — | — | red | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 36 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 97.8 | None | None | None | — | — | red | 17/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 36 GB |
| 3 | See other people's edits appear live on the same board | DONE | 212.2 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 36 GB |
| 4 | Return to a board and find everything as it was left | DONE | 158.4 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 3 | — | throttled 0%, server peak 38 GB |
| 5 | Share a board with others using a link | DONE | 79.6 | None | None | None | — | — | red | 33/36 |  | 0 / 0 (ended in error) | 1 | — | throttled 0%, server peak 38 GB MEMORY-ABORT |
| 7 | Select, move, resize and delete several objects at once | DONE | 182.0 | None | None | None | — | — | red | 41/44 |  | 0 / 0 | 4 | — | throttled 0%, server peak 37 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 74.6 | None | None | None | — | — | red | 48/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 37 GB |
| 9 | Write free text anywhere on the board | DONE | 119.8 | None | None | None | — | — | red | 52/57 |  | 0 / 0 | 2 | — | throttled 0%, server peak 38 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | PARTIAL (red) | 239.0 | None | None | None | — | — | red | 58/65 |  | 0 / 5 | 5 | — | throttled 0%, server peak 38 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 10 | 68.6 | None | None | None | — | — | red | 62/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 38 GB |
| 12 | Drop images onto the board | DONE, on partial 10 | 216.8 | None | None | None | — | — | red | 67/75 |  | 0 / 0 | 5 | — | throttled 0%, server peak 38 GB |

**Totals:** 11 stories, 1527 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/11, final acceptance 67/75, stalled 0, partial 1, 60677 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 10 PARTIAL**, ended by the operator (harness (cap)): story cap: 5 nudges without committing (cap 5). Verdict **red**: gate red, tasks not verified [7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [8, 10, 11, 12, 13]), held-out 6/8 (floor 0.625).
- Story 11, built on partial 10: held-out tests on the partial base 10/13; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 12, built on partial 10: held-out tests on the partial base 15/18; partial story's tests fixed 0, regressed 0; 6 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 6427 / 112 | `BoardViewport.tsx` (308), `useCamera.ts` (250), `camera.ts` (199), `NOTES.md` (175), `styles.css` (148), `playwright.config.ts` (134), +15 more |
| 2 | 1 by the agent | 2587 / 9 | `StickyNote.tsx` (258), `board-model.ts` (164), `styles.css` (158), `App.tsx` (147), `StickyText.ts` (103), `StickyTextEditor.tsx` (97), +8 more |
| 3 | 1 by the agent | 4577 / 316 | `board-room.ts` (162), `NOTES.md` (137), `connectBoard.ts` (126), `protocol.ts` (76), `testHooks.ts` (65), `StickyText.ts` (55), +17 more |
| 4 | 4 by the agent, + harness snapshot | 2817 / 77 | `board-store.ts` (354), `board-room.ts` (317), `room-state.ts` (101), `connectBoard.ts` (38), `App.tsx` (37), `protocol.ts` (23), +5 more |
| 5 | harness snapshot (agent left work uncommitted) | 1986 / 283 | `App.tsx` (246), `BoardApp.tsx` (194), `styles.css` (179), `SharePanel.tsx` (136), `index.ts` (94), `BoardPage.tsx` (79), +12 more |
| 7 | 1 by the agent | 2969 / 331 | `useTransformGesture.ts` (306), `board-model.ts` (252), `StickyNote.tsx` (229), `BoardApp.tsx` (192), `geometry.ts` (189), `useSelection.ts` (164), +9 more |
| 8 | 1 by the agent | 1495 / 18 | `NOTES.md` (115), `undo.ts` (100), `useUndo.ts` (50), `BoardApp.tsx` (40), `UndoButtons.tsx` (35), `StickyTextEditor.tsx` (34), +4 more |
| 9 | 7 by the agent | 2790 / 260 | `text.ts` (246), `TextEditor.tsx` (205), `StickyTextEditor.tsx` (153), `textLayout.ts` (128), `TextObject.tsx` (125), `BoardApp.tsx` (77), +17 more |
| 10 | harness snapshot (agent left work uncommitted) | 4355 / 82 | `connector.ts` (315), `ConnectorTool.tsx` (236), `shape.ts` (233), `ConnectorObject.tsx` (225), `ShapeObject.tsx` (156), `ShapeTool.tsx` (156), +14 more |
| 11 | 1 by the agent | 1893 / 3 | `PenTool.tsx` (230), `stroke.ts` (184), `simplify.ts` (121), `PenToolbar.tsx` (75), `StrokeObject.tsx` (71), `registry.tsx` (33), +6 more |
| 12 | 1 by the agent | 4485 / 11 | `useImageInsert.ts` (438), `ImageObject.tsx` (283), `image.ts` (280), `assets.ts` (158), `styles.css` (144), `uploadImage.ts` (104), +15 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 1** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `board-room.ts` (162), `NOTES.md` (137), `connectBoard.ts` (126), `protocol.ts` (76), `testHooks.ts` (65), `StickyText.ts` (55), +17 more.
  - story 2: 7/10 → 8/10; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**2 restart (no intervention logged); 88 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 2 | 25 Sep 21:41 | 72 min | restart (no intervention logged) | — |
| 4 | 26 Sep 04:17 | 15 min | restart (no intervention logged) | — |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 2 | 98 min | 72 min | 98 min |
| 4 | 155 min | 15 min | 158 min |
