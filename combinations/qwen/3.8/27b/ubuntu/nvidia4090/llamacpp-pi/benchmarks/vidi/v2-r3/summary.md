# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

Setup fallbacks are held-out tests whose setup reached its state by the documented flow after an undocumented alternate flow failed (rule 8); the failure is counted once, as a finding.

| Story | New work | Regressions | Repairs | Cumulative | Setup fallbacks |
|---|---|---|---|---|---|
| 1 | 0/6 | 0 | 0 | 0/6 | 0 |
| 2 | 0/10 | 0 | 0 | 0/20 | 0 |
| 3 | 5/7 | 0 | 20 | 25/27 | 0 |
| 4 | 4/4 | 0 | 0 | 29/31 | 0 |
| 5 | 4/5 | 0 | 0 | 33/36 | 0 |
| 7 | 6/8 | 4 | 0 | 35/44 | 4 |
| 8 | 5/7 | 0 | 0 | 40/51 | 7 |
| 9 | 4/6 | 7 | 1 | 38/57 | 3 |
| 10 | 6/8 | 2 | 3 | 45/65 | 4 |
| 11 | 5/5 | 6 | 3 | 47/70 | 2 |

**New work** 39/66, **regressions** 19, **repairs** 27, **cumulative** 47/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | PARTIAL (red) | 16.5 | None | None | None | — | — | red | 0/6 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | PARTIAL (red), on partial 1 | 18.3 | None | None | None | — | — | red | 0/20 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE, on partial 1, 2 | 123.6 | None | None | None | — | — | green | 25/27 |  | 0 / 1 | 4 | — | throttled 0%, server peak 18 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 1, 2 | 126.9 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 18 GB |
| 5 | Share a board with others using a link | DONE, on partial 1, 2 | 56.4 | None | None | None | — | — | green | 33/36 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 1, 2 | 157.4 | None | None | None | — | — | red | 35/44 |  | 0 / 1 | 6 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 1, 2 | 85.2 | None | None | None | — | — | green | 40/51 |  | 0 / 0 | 4 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 1, 2 | 65.8 | None | None | None | — | — | red | 38/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE, on partial 1, 2 | 72.6 | None | None | None | — | — | green | 45/65 |  | 0 / 0 | 3 | — | throttled 0%, server peak 18 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 1, 2 | 40.0 | None | None | None | — | — | red | 47/70 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |

**Totals:** 10 stories, 763 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 5/10, final acceptance 47/70, stalled 0, partial 2, 19271 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 1 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 3, 4, 5]), held-out 0/6 (floor 0.0).
- **Story 2 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8] (implementation: [2, 4, 5, 6]), held-out 0/10 (floor 0.0).
- Story 2, built on partial 1: held-out tests on the partial base 0/20; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 3, built on partial 1, 2: held-out tests on the partial base 25/27; partial story's tests fixed 20, regressed 0; 0 stub-like lines added to src/.
- Story 4, built on partial 1, 2: held-out tests on the partial base 29/31; partial story's tests fixed 20, regressed 0; 2 stub-like lines added to src/.
- Story 5, built on partial 1, 2: held-out tests on the partial base 33/36; partial story's tests fixed 20, regressed 0; 2 stub-like lines added to src/.
- Story 7, built on partial 1, 2: held-out tests on the partial base 35/44; partial story's tests fixed 18, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 1, 2: held-out tests on the partial base 40/51; partial story's tests fixed 18, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 1, 2: held-out tests on the partial base 38/57; partial story's tests fixed 16, regressed 0; 0 stub-like lines added to src/.
- Story 10, built on partial 1, 2: held-out tests on the partial base 45/65; partial story's tests fixed 15, regressed 0; 0 stub-like lines added to src/.
- Story 11, built on partial 1, 2: held-out tests on the partial base 47/70; partial story's tests fixed 15, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | — | 0 / 0 | — |
| 3 | 1 by the agent | 7859 / 9 | `StickyNote.tsx` (209), `App.tsx` (185), `BoardViewport.tsx` (159), `board-room.ts` (157), `board-model.ts` (147), `connectBoard.ts` (127), +30 more |
| 4 | 1 by the agent | 2870 / 80 | `board-room.ts` (364), `test-hooks.ts` (270), `board-store.ts` (250), `check-production-hooks.mjs` (125), `room-state.ts` (80), `NOTES.md` (48), +15 more |
| 5 | 1 by the agent | 1981 / 292 | `App.tsx` (209), `SharePanel.tsx` (207), `Board.tsx` (189), `test-hooks.ts` (109), `NOTES.md` (97), `BoardPage.tsx` (79), +13 more |
| 7 | 1 by the agent | 3164 / 229 | `useTransformGesture.ts` (236), `board-model.ts` (227), `geometry.ts` (192), `useSelection.ts` (163), `Board.tsx` (152), `SelectionOverlay.tsx` (126), +11 more |
| 8 | 1 by the agent | 1758 / 22 | `undo.ts` (215), `NOTES.md` (86), `UndoButtons.tsx` (65), `useUndo.ts` (52), `Board.tsx` (33), `StickyTextEditor.tsx` (32), +8 more |
| 9 | 6 by the agent | 2306 / 205 | `text.ts` (186), `TextEditor.tsx` (148), `textLayout.ts` (135), `TextObject.tsx` (128), `StickyTextEditor.tsx` (126), `Board.tsx` (84), +15 more |
| 10 | 1 by the agent | 3352 / 98 | `ConnectorObject.tsx` (274), `ConnectorTool.tsx` (230), `connector.ts` (177), `ShapeObject.tsx` (172), `shape.ts` (149), `useActiveTool.ts` (135), +16 more |
| 11 | 1 by the agent | 1658 / 16 | `PenTool.tsx` (228), `stroke.ts` (145), `PenToolbar.tsx` (107), `StrokeObject.tsx` (96), `simplify.ts` (95), `config.ts` (54), +9 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 20** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `StickyNote.tsx` (209), `App.tsx` (185), `BoardViewport.tsx` (159), `board-room.ts` (157), `board-model.ts` (147), `connectBoard.ts` (127), +30 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 10/10; fixed 10
- **Story 7 broke 4, fixed 0** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (236), `board-model.ts` (227), `geometry.ts` (192), `useSelection.ts` (163), `Board.tsx` (152), `SelectionOverlay.tsx` (126), +11 more.
  - story 1: 10/10 → 9/10; broke 1.
  - story 2: 10/10 → 9/10; broke 1.
  - story 3: 5/7 → 4/7; broke 1.
  - story 4: 4/4 → 3/4; broke 1.
- **Story 9 broke 7, fixed 1** earlier held-out tests (story 9: Write free text anywhere on the board; story 9 (tasks 6-7): tool mode with Select/Text, V/T/N/Escape shortcuts, tool tests; story 9 (tasks 4-5): text layout, local-only box sync, and box sync tests; story 9 (task 3): text layout unit tests with a fake measurer; story 9 (task 2): text object model and shared text-edit helpers; story 9 (task 1): text model unit tests first (TC-01 to TC-06)). Source files it changed most: `text.ts` (186), `TextEditor.tsx` (148), `textLayout.ts` (135), `TextObject.tsx` (128), `StickyTextEditor.tsx` (126), `Board.tsx` (84), +15 more.
  - story 2: 9/10 → 7/10; broke 2.
  - story 4: 3/4 → 2/4; broke 1.
  - story 7: 6/8 → 6/8; broke 1; fixed 1.
  - story 8: 5/7 → 2/7; broke 3.
- **Story 10 broke 2, fixed 3** earlier held-out tests (story 10: Draw shapes and connect them with arrows that follow when moved). Source files it changed most: `ConnectorObject.tsx` (274), `ConnectorTool.tsx` (230), `connector.ts` (177), `ShapeObject.tsx` (172), `shape.ts` (149), `useActiveTool.ts` (135), +16 more.
  - story 2: 7/10 → 6/10; broke 1.
  - story 4: 2/4 → 3/4; fixed 1
  - story 7: 6/8 → 5/8; broke 1.
  - story 8: 2/7 → 4/7; fixed 2
- **Story 11 broke 6, fixed 3** earlier held-out tests (story 11: Sketch freehand with a pen). Source files it changed most: `PenTool.tsx` (228), `stroke.ts` (145), `PenToolbar.tsx` (107), `StrokeObject.tsx` (96), `simplify.ts` (95), `config.ts` (54), +9 more.
  - story 2: 6/10 → 6/10; broke 1; fixed 1.
  - story 4: 3/4 → 2/4; broke 1.
  - story 7: 5/8 → 6/8; broke 1; fixed 2.
  - story 9: 4/6 → 2/6; broke 2.
  - story 10: 6/8 → 5/8; broke 1.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
