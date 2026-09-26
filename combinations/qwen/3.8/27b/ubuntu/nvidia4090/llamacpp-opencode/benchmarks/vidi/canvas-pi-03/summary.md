# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-opencode

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.86.0, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 19.9 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 57.5 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 168.5 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE | 252.4 | None | None | None | — | — | green | 29/31 |  | 0 / 1 | 11 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE | 91.4 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 4 | — | throttled 0%, server peak 18 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 134.5 | None | None | None | — | — | green | 24/44 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 48.9 | None | None | None | — | — | green | 25/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE | 68.7 | None | None | None | — | — | green | 27/57 |  | 0 / 0 | 4 | — | throttled 0%, server peak 18 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 86.6 | None | None | None | — | — | green | 30/65 |  | 0 / 0 | 5 | — | throttled 0%, server peak 18 GB |
| 11 | Sketch freehand with a pen | DONE | 62.6 | None | None | None | — | — | green | 40/70 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 12 | Drop images onto the board | DONE | 60.0 | None | None | None | — | — | green | 46/75 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |

**Totals:** 11 stories, 1051 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 11/11, final acceptance 46/75, stalled 0, partial 0, 27109 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 7649 / 0 | `BoardViewport.tsx` (218), `useCamera.ts` (110), `camera.ts` (101), `NOTES.md` (97), `ZoomControls.tsx` (88), `App.tsx` (42), +15 more |
| 2 | 1 by the agent | 2620 / 9 | `StickyNote.tsx` (346), `StickyTextEditor.tsx` (188), `board-model.ts` (183), `NOTES.md` (105), `NoteToolbar.tsx` (98), `StickyText.ts` (93), +8 more |
| 3 | 1 by the agent | 2605 / 46 | `board-room.ts` (203), `connectBoard.ts` (107), `ConnectionStatus.tsx` (80), `protocol.ts` (63), `index.ts` (43), `useBoardDoc.ts` (37), +10 more |
| 4 | harness snapshot (agent left work uncommitted) | 3328 / 140 | `board-room.ts` (352), `board-store.ts` (298), `smoke-story4.mjs` (256), `test-hooks.ts` (252), `room-state.ts` (105), `room-sim.mjs` (104), +18 more |
| 5 | 1 by the agent | 2330 / 298 | `SharePanel.tsx` (209), `App.tsx` (184), `Board.tsx` (155), `create-board.ts` (121), `board-store.ts` (113), `index.ts` (97), +13 more |
| 7 | 1 by the agent | 3694 / 351 | `useTransformGesture.ts` (377), `board-model.ts` (287), `Board.tsx` (215), `useSelection.ts` (204), `StickyNote.tsx` (202), `geometry.ts` (147), +11 more |
| 8 | 1 by the agent | 1699 / 9 | `undo.ts` (128), `NOTES.md` (106), `UndoButtons.tsx` (92), `Board.tsx` (45), `useUndo.ts` (41), `testHooks.ts` (36), +6 more |
| 9 | 1 by the agent | 2810 / 271 | `TextEditor.tsx` (291), `StickyTextEditor.tsx` (244), `TextObject.tsx` (180), `text.ts` (168), `textLayout.ts` (145), `useTransformGesture.ts` (123), +16 more |
| 10 | 1 by the agent | 3924 / 90 | `connector.ts` (261), `ShapeObject.tsx` (238), `ConnectorTool.tsx` (236), `ConnectorObject.tsx` (231), `shape.ts` (211), `board-model.ts` (179), +17 more |
| 11 | 1 by the agent | 2091 / 21 | `PenTool.tsx` (293), `stroke.ts` (216), `StrokeObject.tsx` (142), `PenToolbar.tsx` (124), `simplify.ts` (97), `Board.tsx` (54), +8 more |
| 12 | 1 by the agent | 2882 / 6 | `useImageInsert.ts` (340), `image.ts` (308), `ImageObject.tsx` (212), `assets.ts` (153), `uploadImage.ts` (102), `Board.tsx` (87), +14 more |

### Earlier stories broken or fixed

- **Story 7 broke 12, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (377), `board-model.ts` (287), `Board.tsx` (215), `useSelection.ts` (204), `StickyNote.tsx` (202), `geometry.ts` (147), +11 more.
  - story 1: 10/10 → 8/10; broke 2: “wheel scroll pans in scroll direction @ref prd:pan.scroll”; “reset view returns to 100% with origin centred @ref prd:view.reset”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'anchor' }) / Expected: 1 / Received: 0`
  - story 2: 10/10 → 5/10; broke 5: “toolbar button creates note in view centre @ref prd:sticky.create_button”; “escape and outside click keep typed text; Enter re-edits at end @ref prd:sticky.edit_end”; “dragging a note moves it, not the board @ref prd:sticky.move prd:sticky.no_pan”; “dragged note is drawn above the note it overlaps @ref prd:sticky.move” …. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'alpha' }) / Expected: 1 / Received: 0`
  - story 3: 5/7 → 3/7; broke 2: “late joiner sees current notes @ref prd:live.join_state”; “server restart shows Reconnecting… then Connected, notes kept @ref prd:live.status”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'n0' }) / Expected: 1 / Received: 0`
  - story 4: 4/4 → 2/4; broke 2: “board is intact after everyone leaves @ref prd:persist.reopen”; “survives restart with nobody connected @ref prd:persist.restart”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'p1' }) / Expected: 1 / Received: 0`
  - story 5: 5/5 → 4/5; broke 1: “opening a shared link gives full editing @ref prd:share.open_link”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'joined' }) / Expected: 1 / Received: 0`
- **Story 8 broke 4, fixed 2** earlier held-out tests (story 8: Undo and redo my own changes without undoing anyone else's). Source files it changed most: `undo.ts` (128), `NOTES.md` (106), `UndoButtons.tsx` (92), `Board.tsx` (45), `useUndo.ts` (41), `testHooks.ts` (36), +6 more.
  - story 1: 8/10 → 7/10; broke 1: “zoom keeps the point under the pointer fixed @ref prd:zoom.pointer”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'anchor' }) / Expected: 1 / Received: 0`
  - story 2: 5/10 → 4/10; broke 2: “golden path: create, type, select, recolour, delete @ref prd:golden-path”; “clicking empty board clears selection @ref prd:sticky.select”; fixed 1. Most common error: `Error: expect(locator).toContainText(expected) failed / Locator: locator('[role="group"][aria-label="Sticky note"]').first() / Expected substring: "Faster onboarding" / Received string:    ""`
  - story 3: 3/7 → 4/7; fixed 1
  - story 7: 2/8 → 1/8; broke 1: “dragging an unselected note moves only it @ref prd:sel.drag_unselected”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'u1' }) / Expected: 1 / Received: 0`
- **Story 9 broke 5, fixed 5** earlier held-out tests (story 9: Write free text anywhere on the board). Source files it changed most: `TextEditor.tsx` (291), `StickyTextEditor.tsx` (244), `TextObject.tsx` (180), `text.ts` (168), `textLayout.ts` (145), `useTransformGesture.ts` (123), +16 more.
  - story 1: 7/10 → 7/10; broke 1: “drag pans content exactly with the pointer @ref prd:pan.drag”; fixed 1. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'anchor' }) / Expected: 1 / Received: 0`
  - story 2: 4/10 → 6/10; fixed 2
  - story 3: 4/7 → 2/7; broke 2: “selection stays personal @ref prd:live.local_selection”; “server restart shows Reconnecting… then Connected, notes kept @ref prd:live.status”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'mine' }) / Expected: 1 / Received: 0`
  - story 5: 4/5 → 5/5; fixed 1
  - story 7: 1/8 → 0/8; broke 1: “corner resize keeps sticky square; minimum size enforced @ref prd:sel.resize prd:sel.aspect prd:sel.size_limits”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'grow' }) / Expected: 1 / Received: 0`
  - story 8: 3/7 → 3/7; broke 1: “a whole drag is one step @ref prd:undo.steps”; fixed 1. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'dragme' }) / Expected: 1 / Received: 0`
- **Story 10 broke 7, fixed 5** earlier held-out tests (story 10: Draw shapes and connect them with arrows that follow when moved). Source files it changed most: `connector.ts` (261), `ShapeObject.tsx` (238), `ConnectorTool.tsx` (236), `ConnectorObject.tsx` (231), `shape.ts` (211), `board-model.ts` (179), +17 more.
  - story 1: 7/10 → 6/10; broke 1: “wheel scroll pans in scroll direction @ref prd:pan.scroll”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'anchor' }) / Expected: 1 / Received: 0`
  - story 2: 6/10 → 3/10; broke 3: “golden path: create, type, select, recolour, delete @ref prd:golden-path”; “escape and outside click keep typed text; Enter re-edits at end @ref prd:sticky.edit_end”; “clicking empty board clears selection @ref prd:sticky.select”. Most common error: `TimeoutError: locator.click: Timeout 5000ms exceeded.`
  - story 3: 2/7 → 3/7; fixed 1
  - story 4: 2/4 → 3/4; fixed 1
  - story 5: 5/5 → 4/5; broke 1: “opening a shared link gives full editing @ref prd:share.open_link”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'joined' }) / Expected: 1 / Received: 0`
  - story 8: 3/7 → 3/7; broke 2: “undo does not reverse other people's changes @ref prd:undo.own_only”; “history does not survive reload @ref prd:undo.no_reload”; fixed 2. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'rajB' }) / Expected: 1 / Received: 0`
  - story 9: 2/6 → 3/6; fixed 1
- **Story 11 broke 1, fixed 8** earlier held-out tests (story 11: Sketch freehand with a pen). Source files it changed most: `PenTool.tsx` (293), `stroke.ts` (216), `StrokeObject.tsx` (142), `PenToolbar.tsx` (124), `simplify.ts` (97), `Board.tsx` (54), +8 more.
  - story 1: 6/10 → 9/10; fixed 3
  - story 2: 3/10 → 4/10; fixed 1
  - story 3: 3/7 → 4/7; fixed 1
  - story 7: 0/8 → 1/8; fixed 1
  - story 8: 3/7 → 3/7; broke 1: “a whole drag is one step @ref prd:undo.steps”; fixed 1. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'dragme' }) / Expected: 1 / Received: 0`
  - story 10: 5/8 → 6/8; fixed 1
- **Story 12 broke 3, fixed 4** earlier held-out tests (story 12: Drop images onto the board). Source files it changed most: `useImageInsert.ts` (340), `image.ts` (308), `ImageObject.tsx` (212), `assets.ts` (153), `uploadImage.ts` (102), `Board.tsx` (87), +14 more.
  - story 2: 4/10 → 4/10; broke 1: “dragging a note moves it, not the board @ref prd:sticky.move prd:sticky.no_pan”; fixed 1. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'mover' }) / Expected: 1 / Received: 0`
  - story 3: 4/7 → 3/7; broke 1: “server restart shows Reconnecting… then Connected, notes kept @ref prd:live.status”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'after' }) / Expected: 1 / Received: 0`
  - story 5: 4/5 → 5/5; fixed 1
  - story 7: 1/8 → 2/8; fixed 1
  - story 8: 3/7 → 2/7; broke 1: “new change clears redo @ref prd:undo.redo_cleared”. Most common error: `Error: expect(locator).toHaveCount(expected) failed / Locator:  locator('[role="group"][aria-label="Sticky note"]').filter({ hasText: 'first' }) / Expected: 1 / Received: 0`
  - story 11: 3/5 → 4/5; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
