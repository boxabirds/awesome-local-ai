# Vidi run — qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi

Model `strata-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |
| 7 | 7/8 | 0 | 0 | 40/44 |
| 8 | 7/7 | 0 | 0 | 47/51 |
| 9 | 5/6 | 0 | 0 | 52/57 |
| 10 | 5/8 | 0 | 0 | 57/65 |

**New work** 53/61, **regressions** 0, **repairs** 0, **cumulative** 57/65.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 49.4 | None | None | None | — | — | red | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 96.1 | None | None | None | — | — | red | 19/20 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 232.7 | None | None | None | — | — | red | 24/27 |  | 0 / 0 | 6 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red) | 240.0 | None | None | None | — | — | red | 28/31 |  | 0 / 0 | 6 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE, on partial 4 | 173.0 | None | None | None | — | — | red | 33/36 |  | 0 / 0 | 6 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 4 | 148.6 | None | None | None | — | — | red | 40/44 |  | 3 / 0 (ended in error) | 5 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 4 | 124.8 | None | None | None | — | — | red | 47/51 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 4 | 157.4 | None | None | None | — | — | red | 52/57 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | PARTIAL (red), on partial 4 | 240.0 | None | None | None | — | — | red | 57/65 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |

**Totals:** 9 stories, 1462 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/9, final acceptance 57/65, stalled 0, partial 2, 34398 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 6, 7, 9] (implementation: [4, 7]), held-out 4/4 (floor 0.25).
- Story 5, built on partial 4: held-out tests on the partial base 9/9; partial story's tests fixed 0, regressed 0; 1 stub-like lines added to src/.
- Story 7, built on partial 4: held-out tests on the partial base 16/17; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 4: held-out tests on the partial base 23/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 4: held-out tests on the partial base 28/30; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 10 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [12, 13, 15] (implementation: [12, 13]), held-out 5/8 (floor 0.625).
- Story 10, built on partial 4: held-out tests on the partial base 33/38; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6690 / 35 | `BoardViewport.tsx` (256), `useCamera.ts` (251), `camera.ts` (184), `styles.css` (146), `NOTES.md` (123), `TESTING.md` (98), +19 more |
| 2 | 2 by the agent | 4470 / 74 | `StickyNote.tsx` (393), `board-model.ts` (253), `styles.css` (190), `StickyText.ts` (170), `App.tsx` (140), `NOTES.md` (100), +14 more |
| 3 | 12 by the agent | 4419 / 546 | `board-room.ts` (217), `connectBoard.ts` (178), `config.ts` (102), `App.tsx` (88), `useBoardDoc.ts` (83), `protocol.ts` (71), +20 more |
| 4 | 6 by the agent, + harness snapshot | 4251 / 157 | `board-store.ts` (623), `board-room.ts` (330), `room-state.ts` (203), `test-hooks.ts` (184), `connectBoard.ts` (50), `App.tsx` (35), +15 more |
| 5 | 2 by the agent | 3820 / 349 | `App.tsx` (253), `BoardApp.tsx` (219), `SharePanel.tsx` (154), `styles.css` (152), `index.ts` (121), `useSharePanel.ts` (112), +22 more |
| 7 | 7 by the agent, + harness snapshot | 5950 / 510 | `board-model.ts` (368), `useTransformGesture.ts` (351), `geometry.ts` (342), `useObjectDrag.ts` (264), `StickyNote.tsx` (259), `BoardApp.tsx` (235), +10 more |
| 8 | 1 by the agent | 2458 / 24 | `NOTES.md` (165), `undo.ts` (151), `useUndo.ts` (98), `UndoButtons.tsx` (90), `useBoardKeys.ts` (41), `StickyTextEditor.tsx` (38), +11 more |
| 9 | 5 by the agent | 4509 / 339 | `text.ts` (297), `textLayout.ts` (255), `TextEditor.tsx` (230), `TextObject.tsx` (188), `text-edit.ts` (154), `styles.css` (152), +18 more |
| 10 | 6 by the agent | 6374 / 1155 | `connector.ts` (919), `connector-geometry.ts` (533), `shape.ts` (352), `ConnectorObject.tsx` (314), `ConnectorTool.tsx` (312), `ShapeObject.tsx` (277), +14 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
