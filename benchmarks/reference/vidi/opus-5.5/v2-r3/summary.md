# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope `canvas`, effort `client default`, client claude 2.1.284 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |
| 7 | 8/8 | 0 | 2 | 43/44 |
| 8 | 7/7 | 0 | 0 | 50/51 |
| 9 | 6/6 | 0 | 0 | 56/57 |
| 10 | 8/8 | 0 | 0 | 64/65 |
| 11 | 5/5 | 0 | 1 | 70/70 |

**New work** 63/66, **regressions** 0, **repairs** 3, **cumulative** 70/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 6.8 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 10.0 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 18.1 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 0 | — | throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 18.5 | None | None | None | — | — | green | 28/31 |  | 0 / 1 | 0 | — | throttled 0% |
| 5 | Share a board with others using a link | DONE | 9.8 | None | None | None | — | — | green | 33/36 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 14.8 | None | None | None | — | — | green | 43/44 |  | 0 / 0 | 0 | — | throttled 0% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 8.1 | None | None | None | — | — | green | 50/51 |  | 0 / 0 | 0 | — | throttled 0% |
| 9 | Write free text anywhere on the board | DONE | 17.2 | None | None | None | — | — | green | 56/57 |  | 0 / 0 | 0 | — | throttled 0% |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 16.7 | None | None | None | — | — | green | 64/65 |  | 0 / 0 | 0 | — | throttled 0% |
| 11 | Sketch freehand with a pen | DONE | 13.7 | None | None | None | — | — | green | 70/70 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 10 stories, 134 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 10/10, final acceptance 70/70, stalled 0, partial 0, 23790 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5825 / 0 | `BoardViewport.tsx` (214), `useCamera.ts` (137), `styles.css` (130), `camera.ts` (90), `playwright.config.ts` (44), `App.tsx` (43), +13 more |
| 2 | 1 by the agent | 2517 / 12 | `StickyNote.tsx` (221), `styles.css` (186), `board-model.ts` (182), `App.tsx` (134), `StickyText.ts` (127), `StickyTextEditor.tsx` (102), +9 more |
| 3 | 1 by the agent | 5280 / 38 | `board-room.ts` (123), `connectBoard.ts` (87), `protocol.ts` (86), `StickyText.ts` (71), `NOTES.md` (56), `StickyTextEditor.tsx` (53), +13 more |
| 4 | 1 by the agent | 2229 / 74 | `board-store.ts` (259), `board-room.ts` (212), `NOTES.md` (62), `room-state.ts` (56), `test-hooks.ts` (54), `playwright.config.ts` (28), +12 more |
| 5 | 1 by the agent | 1791 / 273 | `App.tsx` (225), `Board.tsx` (199), `SharePanel.tsx` (150), `styles.css` (150), `BoardPage.tsx` (61), `index.ts` (60), +15 more |
| 7 | 1 by the agent | 2933 / 317 | `useTransformGesture.ts` (272), `board-model.ts` (240), `StickyNote.tsx` (182), `geometry.ts` (181), `Board.tsx` (176), `styles.css` (120), +10 more |
| 8 | 1 by the agent | 1507 / 53 | `undo.ts` (174), `Board.tsx` (134), `UndoButtons.tsx` (52), `useBoardKeys.ts` (46), `NOTES.md` (44), `useUndo.ts` (37), +4 more |
| 9 | 1 by the agent | 2550 / 269 | `TextEditor.tsx` (201), `TextObject.tsx` (199), `StickyTextEditor.tsx` (189), `text.ts` (172), `textLayout.ts` (147), `styles.css` (75), +18 more |
| 10 | 1 by the agent | 3284 / 52 | `ConnectorObject.tsx` (262), `connector.ts` (240), `ShapeObject.tsx` (221), `styles.css` (205), `shape.ts` (186), `ConnectorTool.tsx` (173), +17 more |
| 11 | 1 by the agent | 1798 / 11 | `PenTool.tsx` (206), `stroke.ts` (149), `simplify.ts` (106), `styles.css` (99), `StrokeObject.tsx` (95), `PenToolbar.tsx` (62), +9 more |

### Earlier stories broken or fixed

- **Story 7 broke 0, fixed 2** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (272), `board-model.ts` (240), `StickyNote.tsx` (182), `geometry.ts` (181), `Board.tsx` (176), `styles.css` (120), +10 more.
  - story 2: 9/10 → 10/10; fixed 1
  - story 3: 5/7 → 6/7; fixed 1
- **Story 11 broke 0, fixed 1** earlier held-out tests (story 11: Sketch freehand with a pen). Source files it changed most: `PenTool.tsx` (206), `stroke.ts` (149), `simplify.ts` (106), `styles.css` (99), `StrokeObject.tsx` (95), `PenToolbar.tsx` (62), +9 more.
  - story 3: 6/7 → 7/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
