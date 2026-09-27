# Vidi run — reference/opus-5.5

Model `claude-opus-5-5`, scope `canvas`, effort `low`, client claude 2.1.282 (Claude Code), host Apple M2 16GB.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 7.9 | None | None | None | — | — | red | None/None |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 16.9 | None | None | None | — | — | red | None/None |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 21.3 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 0 | — | throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 32.3 | None | None | None | — | — | green | 28/31 |  | 0 / 2 | 0 | — | throttled 0% |
| 5 | Share a board with others using a link | DONE | 12.0 | None | None | None | — | — | green | 33/36 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 29.4 | None | None | None | — | — | green | 41/44 |  | 0 / 0 | 0 | — | throttled 0% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 9.5 | None | None | None | — | — | green | 48/51 |  | 0 / 0 | 0 | — | throttled 0% |
| 9 | Write free text anywhere on the board | DONE | 14.7 | None | None | None | — | — | green | 53/57 |  | 0 / 0 | 0 | — | throttled 0% |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 28.5 | None | None | None | — | — | green | 61/65 |  | 0 / 0 | 0 | — | throttled 0% |
| 11 | Sketch freehand with a pen | DONE | 10.5 | None | None | None | — | — | green | 66/70 |  | 0 / 0 | 0 | — | throttled 0% |
| 12 | Drop images onto the board | DONE | 17.8 | None | None | None | — | — | green | 71/75 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 11 stories, 201 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 9/11, final acceptance 71/75, stalled 0, partial 0, 43992 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | — | 0 / 0 | — |
| 3 | 1 by the agent | 3109 / 79 | `board-room.ts` (130), `connectBoard.ts` (94), `protocol.ts` (52), `NOTES.md` (51), `useBoardDoc.ts` (39), `App.tsx` (34), +14 more |
| 4 | 1 by the agent | 2283 / 129 | `board-room.ts` (222), `board-store.ts` (193), `room-state.ts` (68), `test-hooks.ts` (65), `NOTES.md` (57), `playwright.config.ts` (28), +13 more |
| 5 | 1 by the agent | 1807 / 74 | `SharePanel.tsx` (140), `styles.css` (139), `create-board.ts` (100), `BoardPage.tsx` (72), `NOTES.md` (52), `board-store.ts` (52), +16 more |
| 7 | 1 by the agent | 2916 / 340 | `useTransformGesture.ts` (271), `board-model.ts` (224), `StickyNote.tsx` (206), `geometry.ts` (148), `useSelection.ts` (142), `App.tsx` (137), +10 more |
| 8 | 1 by the agent | 1485 / 13 | `undo.ts` (134), `useUndo.ts` (72), `App.tsx` (50), `NOTES.md` (44), `UndoButtons.tsx` (36), `useBoardKeys.ts` (29), +4 more |
| 9 | 1 by the agent | 2453 / 243 | `TextEditor.tsx` (179), `TextObject.tsx` (169), `StickyTextEditor.tsx` (150), `text.ts` (149), `textLayout.ts` (143), `styles.css` (90), +18 more |
| 10 | 1 by the agent | 3557 / 82 | `ConnectorObject.tsx` (318), `connector.ts` (236), `ShapeObject.tsx` (229), `ConnectorTool.tsx` (184), `styles.css` (182), `shape.ts` (173), +19 more |
| 11 | 1 by the agent | 1814 / 5 | `PenTool.tsx` (237), `stroke.ts` (129), `styles.css` (118), `StrokeObject.tsx` (117), `PenToolbar.tsx` (94), `simplify.ts` (92), +8 more |
| 12 | 1 by the agent | 2759 / 27 | `useImageInsert.ts` (301), `ImageObject.tsx` (223), `image.ts` (208), `styles.css` (128), `NOTES.md` (84), `App.tsx` (81), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
