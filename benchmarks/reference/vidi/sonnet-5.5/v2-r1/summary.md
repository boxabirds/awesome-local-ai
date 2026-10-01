# Vidi run — reference/sonnet-5.5

Model `claude-sonnet-5-5`, scope `canvas`, effort `client default`, client claude 2.1.285 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 5/5 | 0 | 0 | 35/36 |
| 7 | 8/8 | 0 | 0 | 43/44 |
| 8 | 7/7 | 0 | 0 | 50/51 |
| 9 | 6/6 | 0 | 0 | 56/57 |
| 10 | 8/8 | 0 | 0 | 64/65 |
| 11 | 5/5 | 0 | 0 | 69/70 |

**New work** 65/66, **regressions** 0, **repairs** 0, **cumulative** 69/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 4.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 7.7 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 15.7 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 0 | — | throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 10.5 | None | None | None | — | — | red | 30/31 |  | 0 / 0 | 0 | — | throttled 0% |
| 5 | Share a board with others using a link | DONE | 23.9 | None | None | None | — | — | red | 35/36 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 20.6 | None | None | None | — | — | red | 43/44 |  | 0 / 0 | 0 | — | throttled 0% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 9.8 | None | None | None | — | — | red | 50/51 |  | 0 / 0 | 0 | — | throttled 0% |
| 9 | Write free text anywhere on the board | DONE | 11.9 | None | None | None | — | — | red | 56/57 |  | 0 / 1 | 0 | — | throttled 0% |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 12.6 | None | None | None | — | — | red | 64/65 |  | 0 / 0 | 0 | — | throttled 0% |
| 11 | Sketch freehand with a pen | DONE | 6.7 | None | None | None | — | — | red | 69/70 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 10 stories, 124 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/10, final acceptance 69/70, stalled 0, partial 0, 14668 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5163 / 0 | `BoardViewport.tsx` (206), `useCamera.ts` (117), `styles.css` (101), `camera.ts` (77), `package.json` (32), `ZoomControls.tsx` (25), +13 more |
| 2 | 1 by the agent | 1747 / 9 | `StickyNote.tsx` (164), `styles.css` (147), `board-model.ts` (127), `App.tsx` (108), `StickyTextEditor.tsx` (90), `StickyText.ts` (73), +8 more |
| 3 | 1 by the agent | 18927 / 77 | `worker-configuration.d.ts` (16187), `board-room.ts` (101), `connectBoard.ts` (74), `protocol.ts` (36), `styles.css` (27), `useBoardDoc.ts` (24), +16 more |
| 4 | 1 by the agent | 1536 / 49 | `board-room.ts` (189), `board-store.ts` (147), `room-state.ts` (49), `connectBoard.ts` (19), `App.tsx` (17), `test-hooks.ts` (17), +12 more |
| 5 | 1 by the agent | 1062 / 31 | `SharePanel.tsx` (99), `styles.css` (86), `BoardPage.tsx` (59), `NewBoardButton.tsx` (41), `state.ts` (37), `index.ts` (33), +13 more |
| 7 | 1 by the agent | 2176 / 287 | `useTransformGesture.ts` (215), `board-model.ts` (183), `App.tsx` (146), `StickyNote.tsx` (140), `geometry.ts` (125), `SelectionOverlay.tsx` (85), +11 more |
| 8 | 1 by the agent | 847 / 14 | `undo.ts` (78), `useUndo.ts` (38), `App.tsx` (29), `UndoButtons.tsx` (20), `StickyTextEditor.tsx` (20), `useBoardKeys.ts` (18), +3 more |
| 9 | 1 by the agent | 1661 / 196 | `TextEditor.tsx` (137), `StickyTextEditor.tsx` (125), `textLayout.ts` (106), `text.ts` (102), `TextObject.tsx` (83), `StickyText.ts` (65), +19 more |
| 10 | 1 by the agent | 2405 / 24 | `ConnectorObject.tsx` (186), `styles.css` (150), `ConnectorTool.tsx` (142), `connector.ts` (136), `ShapeObject.tsx` (120), `ShapeTool.tsx` (114), +18 more |
| 11 | 1 by the agent | 1224 / 7 | `PenTool.tsx` (175), `styles.css` (92), `stroke.ts` (83), `StrokeObject.tsx` (80), `simplify.ts` (62), `PenToolbar.tsx` (50), +10 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

**2 restart (no intervention logged); 164 min dead in total.**

| Story | When (UTC) | Down for | Kind | Logged cause |
|---|---|---|---|---|
| 9 | 01 Oct 02:55 | 2 min | restart (no intervention logged) | — |
| 9 | 01 Oct 02:59 | 162 min | restart (no intervention logged) | — |

| Story | Active | Dead | Recorded |
|---|---|---|---|
| 9 | 16 min | 164 min | 12 min |
