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

**New work** 60/61, **regressions** 0, **repairs** 0, **cumulative** 64/65.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 14.0 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 5.9 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 20.0 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 16.5 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 5 | Share a board with others using a link | DONE | 8.6 | None | None | None | — | — | red | 35/36 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 14.8 | None | None | None | — | — | green | 43/44 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 18.0 | None | None | None | — | — | red | 50/51 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 9 | Write free text anywhere on the board | DONE | 16.6 | None | None | None | — | — | green | 56/57 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 17.7 | None | None | None | — | — | red | 64/65 |  | 0 / 0 | 0 | — | DEGRADED (power) throttled 0% |

**Totals:** 9 stories, 132 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/9, final acceptance 64/65, stalled 0, partial 0, 12181 lines in src+tests.

> Stories 1, 2, 3, 4, 5, 7, 8, 9, 10 ran partly on battery or in Low Power Mode. Their timings are not comparable; re-run them.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6010 / 0 | `BoardViewport.tsx` (172), `useCamera.ts` (98), `camera.ts` (66), `styles.css` (35), `package.json` (33), `playwright.config.ts` (28), +13 more |
| 2 | 1 by the agent | 1588 / 11 | `StickyNote.tsx` (160), `board-model.ts` (141), `StickyText.ts` (90), `StickyTextEditor.tsx` (76), `App.tsx` (73), `BoardViewport.tsx` (61), +8 more |
| 3 | 1 by the agent | 2889 / 222 | `board-room.ts` (107), `connectBoard.ts` (74), `useBoardDoc.ts` (37), `protocol.ts` (36), `App.tsx` (25), `index.ts` (22), +14 more |
| 4 | 1 by the agent | 1479 / 90 | `board-room.ts` (187), `board-store.ts` (145), `StickyText.ts` (82), `room-state.ts` (41), `test-hooks.ts` (36), `NOTES.md` (16), +10 more |
| 5 | 1 by the agent | 1033 / 126 | `App.tsx` (116), `SharePanel.tsx` (91), `BoardApp.tsx` (90), `HomePage.tsx` (53), `BoardPage.tsx` (45), `index.ts` (40), +12 more |
| 7 | 1 by the agent | 2072 / 199 | `useTransformGesture.ts` (218), `board-model.ts` (134), `StickyNote.tsx` (121), `BoardApp.tsx` (116), `geometry.ts` (109), `useSelection.ts` (104), +10 more |
| 8 | 1 by the agent | 798 / 8 | `undo.ts` (78), `useUndo.ts` (38), `UndoButtons.tsx` (32), `BoardApp.tsx` (23), `useBoardKeys.ts` (21), `StickyTextEditor.tsx` (18), +3 more |
| 9 | 1 by the agent | 1635 / 206 | `TextEditor.tsx` (138), `text.ts` (112), `StickyTextEditor.tsx` (103), `StickyText.ts` (86), `TextObject.tsx` (86), `textLayout.ts` (86), +19 more |
| 10 | 1 by the agent | 2149 / 39 | `ConnectorObject.tsx` (147), `board-model.ts` (140), `ConnectorTool.tsx` (124), `connector.ts` (116), `ShapeObject.tsx` (108), `ShapeTool.tsx` (95), +18 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
