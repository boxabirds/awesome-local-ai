# Vidi run — qwen/3.6/35b-a3b/ubuntu/strix-halo-128GB/gufo-fork-ninjapear-pi

Model `qwen3.6-35b-a3b`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 0/10 | 0 | 0 | 6/20 |
| 3 | 0/7 | 6 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 1/5 | 0 | 0 | 1/36 |
| 7 | 0/8 | 0 | 0 | 1/44 |
| 8 | 0/7 | 0 | 0 | 1/51 |
| 9 | 0/6 | 0 | 0 | 1/57 |
| 10 | 0/8 | 0 | 0 | 1/65 |
| 11 | 0/5 | 0 | 0 | 1/70 |
| 12 | 0/5 | 0 | 0 | 1/75 |

**New work** 7/71, **regressions** 6, **repairs** 0, **cumulative** 1/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 29.2 | None | None | None | — | — | red | 6/6 |  | 0 / 1 | 1 | — | throttled 0%, server peak 34 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 52.8 | None | None | None | — | — | red | 6/20 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 88.3 | None | None | None | — | — | red | 0/27 |  | 0 / 1 | 1 | — | throttled 0%, server peak 35 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 125.2 | None | None | None | — | — | red | 0/31 |  | 0 / 1 | 2 | — | throttled 0%, server peak 36 GB |
| 5 | Share a board with others using a link | DONE, on partial 3 | 45.6 | None | None | None | — | — | red | 1/36 |  | 0 / 1 | 1 | — | throttled 0%, server peak 36 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3 | 38.3 | None | None | None | — | — | red | 1/44 |  | 0 / 1 | 1 | — | throttled 0%, server peak 36 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | PARTIAL (red), on partial 3 | 70.9 | None | None | None | — | — | red | 1/51 |  | 0 / 1 | 1 | — | throttled 0%, server peak 37 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 3, 8 | 48.0 | None | None | None | — | — | red | 1/57 |  | 0 / 1 | 1 | — | throttled 0%, server peak 37 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | PARTIAL (red), on partial 3, 8 | 81.9 | None | None | None | — | — | red | 1/65 |  | 0 / 1 | 1 | — | throttled 0%, server peak 37 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 3, 8, 10 | 47.9 | None | None | None | — | — | red | 1/70 |  | 0 / 1 | 1 | — | throttled 0%, server peak 38 GB |
| 12 | Drop images onto the board | DONE, on partial 3, 8, 10 | 49.7 | None | None | None | — | — | red | 1/75 |  | 0 / 0 | 1 | — | throttled 0%, server peak 38 GB |

**Totals:** 11 stories, 678 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 0/11, final acceptance 1/75, stalled 0, partial 3, 20059 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 3, 4]), held-out 0/7 (floor 0.571).
- Story 4, built on partial 3: held-out tests on the partial base 0/11; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 5, built on partial 3: held-out tests on the partial base 1/16; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 7, built on partial 3: held-out tests on the partial base 1/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 8 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11] (implementation: [2, 8, 10]), held-out 0/7 (floor 0.0).
- Story 8, built on partial 3: held-out tests on the partial base 1/31; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 3, 8: held-out tests on the partial base 1/37; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 10 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [11, 12, 13, 14, 15] (implementation: [11, 12, 13]), held-out 0/8 (floor 0.625).
- Story 10, built on partial 3, 8: held-out tests on the partial base 1/45; partial story's tests fixed 0, regressed 0; 1 stub-like lines added to src/.
- Story 11, built on partial 3, 8, 10: held-out tests on the partial base 1/50; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 12, built on partial 3, 8, 10: held-out tests on the partial base 1/55; partial story's tests fixed 0, regressed 0; 3 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 8471 / 7 | `BoardViewport.tsx` (160), `camera.ts` (112), `ZoomControls.tsx` (103), `useCamera.ts` (88), `App.tsx` (58), `NOTES.md` (37), +13 more |
| 2 | 1 by the agent | 2382 / 31 | `StickyNote.tsx` (313), `board-model.ts` (216), `App.tsx` (152), `StickyTextEditor.tsx` (102), `StickyText.ts` (92), `NoteToolbar.tsx` (83), +8 more |
| 3 | harness snapshot (agent left work uncommitted) | 3184 / 161 | `board-room.ts` (133), `connectBoard.ts` (103), `ConnectionStatus.tsx` (62), `protocol.ts` (59), `index.ts` (47), `board-id.ts` (44), +10 more |
| 4 | 1 by the agent | 1539 / 135 | `board-room.ts` (384), `board-store.ts` (287), `PROGRESS.md` (64), `NOTES.md` (49), `vitest.integration-workers.config.ts` (42), `connectBoard.ts` (34), +7 more |
| 5 | 1 by the agent | 1829 / 247 | `BoardPage.tsx` (286), `App.tsx` (223), `SharePanel.tsx` (188), `board-store.ts` (108), `index.ts` (93), `HomePage.tsx` (76), +10 more |
| 7 | 1 by the agent | 2688 / 281 | `useTransformGesture.ts` (252), `BoardPage.tsx` (174), `board-model.ts` (173), `geometry.ts` (171), `StickyNote.tsx` (164), `useSelection.ts` (159), +10 more |
| 8 | harness snapshot (agent left work uncommitted) | 1190 / 90 | `StickyNote.tsx` (112), `undo.ts` (111), `BoardPage.tsx` (85), `UndoButtons.tsx` (69), `useUndo.ts` (48), `useBoardKeys.ts` (36), +8 more |
| 9 | 1 by the agent | 1762 / 228 | `text.ts` (250), `BoardPage.tsx` (211), `textLayout.ts` (152), `TextEditor.tsx` (147), `TextObject.tsx` (139), `NOTES.md` (111), +14 more |
| 10 | 1 by the agent, + harness snapshot | 2797 / 242 | `SelectionBar.tsx` (245), `connector.ts` (239), `shape.ts` (229), `board-model.ts` (204), `Toolbar.tsx` (129), `useActiveTool.ts` (114), +18 more |
| 11 | 1 by the agent | 1759 / 23 | `PenTool.tsx` (168), `stroke.ts` (148), `simplify.ts` (113), `PenToolbar.tsx` (96), `StrokeObject.tsx` (55), `BoardPage.tsx` (41), +12 more |
| 12 | 1 by the agent | 2948 / 9 | `generate-fixtures.mjs` (405), `useImageInsert.ts` (404), `BoardPage.tsx` (353), `ImageObject.tsx` (286), `image.ts` (264), `assets.ts` (106), +12 more |

### Earlier stories broken or fixed

- **Story 3 broke 6, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (133), `connectBoard.ts` (103), `ConnectionStatus.tsx` (62), `protocol.ts` (59), `index.ts` (47), `board-id.ts` (44), +10 more.
  - story 1: 6/10 → 0/10; broke 6.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
