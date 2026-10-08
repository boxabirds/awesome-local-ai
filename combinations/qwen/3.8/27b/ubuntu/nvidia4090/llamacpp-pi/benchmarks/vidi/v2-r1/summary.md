# Vidi run — qwen/3.8/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 0/6 | 0 | 0 | 0/6 |
| 2 | 0/10 | 0 | 0 | 0/20 |
| 3 | 5/7 | 0 | 20 | 25/27 |
| 4 | 4/4 | 0 | 0 | 29/31 |
| 5 | 5/5 | 0 | 0 | 34/36 |
| 7 | 8/8 | 0 | 0 | 42/44 |
| 8 | 7/7 | 0 | 0 | 49/51 |
| 9 | 6/6 | 2 | 0 | 53/57 |
| 10 | 5/8 | 0 | 0 | 58/65 |
| 11 | 5/5 | 0 | 0 | 63/70 |

**New work** 45/66, **regressions** 2, **repairs** 20, **cumulative** 63/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | PARTIAL (red) | 15.3 | None | None | None | — | — | red | 0/6 |  | 0 / 1 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE, on partial 1 | 90.5 | None | None | None | — | — | green | 0/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE, on partial 1 | 92.3 | None | None | None | — | — | green | 25/27 |  | 0 / 0 | 3 | — | throttled 0%, server peak 17 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 1 | 117.3 | None | None | None | — | — | green | 29/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 17 GB |
| 5 | Share a board with others using a link | DONE, on partial 1 | 38.5 | None | None | None | — | — | green | 34/36 |  | 0 / 0 | 2 | — | throttled 0%, server peak 17 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 1 | 127.8 | None | None | None | — | — | green | 42/44 |  | 0 / 1 | 6 | — | throttled 0%, server peak 18 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 1 | 147.5 | None | None | None | — | — | green | 49/51 |  | 0 / 0 | 7 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE, on partial 1 | 87.5 | None | None | None | — | — | green | 53/57 |  | 0 / 0 | 5 | — | throttled 0%, server peak 18 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE, on partial 1 | 95.5 | None | None | None | — | — | green | 58/65 |  | 0 / 0 | 5 | — | throttled 0%, server peak 18 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 1 | 33.2 | None | None | None | — | — | red | 63/70 |  | 0 / 0 | 2 | — | throttled 0%, server peak 18 GB |

**Totals:** 10 stories, 845 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 8/10, final acceptance 63/70, stalled 0, partial 1, 23404 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 1 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7] (implementation: [2, 3, 4, 5]), held-out 0/6 (floor 0.833).
- Story 2, built on partial 1: held-out tests on the partial base 0/20; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 3, built on partial 1: held-out tests on the partial base 25/27; partial story's tests fixed 10, regressed 0; 2 stub-like lines added to src/.
- Story 4, built on partial 1: held-out tests on the partial base 29/31; partial story's tests fixed 10, regressed 0; 2 stub-like lines added to src/.
- Story 5, built on partial 1: held-out tests on the partial base 34/36; partial story's tests fixed 10, regressed 0; 4 stub-like lines added to src/.
- Story 7, built on partial 1: held-out tests on the partial base 42/44; partial story's tests fixed 10, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 1: held-out tests on the partial base 49/51; partial story's tests fixed 10, regressed 0; 0 stub-like lines added to src/.
- Story 9, built on partial 1: held-out tests on the partial base 53/57; partial story's tests fixed 10, regressed 0; 1 stub-like lines added to src/.
- Story 10, built on partial 1: held-out tests on the partial base 58/65; partial story's tests fixed 10, regressed 0; 0 stub-like lines added to src/.
- Story 11, built on partial 1: held-out tests on the partial base 63/70; partial story's tests fixed 10, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | — | 0 / 0 | — |
| 2 | 1 by the agent | 6782 / 8 | `styles.css` (308), `StickyNote.tsx` (228), `BoardViewport.tsx` (224), `App.tsx` (216), `board-model.ts` (213), `StickyTextEditor.tsx` (155), +21 more |
| 3 | 1 by the agent | 7300 / 1892 | `vite-plugin-board-sync.ts` (182), `board-room.ts` (158), `connectBoard.ts` (100), `useBoardDoc.ts` (60), `protocol.ts` (54), `index.ts` (43), +13 more |
| 4 | 3 by the agent | 2750 / 176 | `board-room.ts` (363), `board-store.ts` (295), `test-hooks.ts` (100), `room-state.ts` (73), `connectBoard.ts` (66), `App.tsx` (34), +13 more |
| 5 | 1 by the agent | 2151 / 356 | `BoardPage.tsx` (333), `App.tsx` (278), `SharePanel.tsx` (157), `styles.css` (147), `board-store.ts` (119), `NOTES.md` (80), +20 more |
| 7 | 1 by the agent | 3521 / 365 | `useTransformGesture.ts` (311), `board-model.ts` (271), `StickyNote.tsx` (235), `useSelection.ts` (220), `geometry.ts` (195), `BoardPage.tsx` (191), +16 more |
| 8 | 1 by the agent | 2132 / 18 | `undo.ts` (386), `NOTES.md` (67), `UndoButtons.tsx` (65), `useUndo.ts` (59), `BoardPage.tsx` (50), `StickyTextEditor.tsx` (48), +12 more |
| 9 | 1 by the agent | 2978 / 200 | `TextEditor.tsx` (263), `text.ts` (167), `StickyTextEditor.tsx` (158), `TextObject.tsx` (129), `textLayout.ts` (121), `useTextBoxSync.ts` (95), +21 more |
| 10 | 1 by the agent | 4475 / 178 | `ConnectorObject.tsx` (343), `connector.ts` (280), `ConnectorTool.tsx` (278), `Toolbar.tsx` (226), `shape.ts` (186), `ShapeObject.tsx` (179), +18 more |
| 11 | 1 by the agent | 2107 / 10 | `PenTool.tsx` (273), `stroke.ts` (145), `simplify.ts` (123), `StrokeObject.tsx` (120), `styles.css` (94), `PenToolbar.tsx` (79), +12 more |

### Earlier stories broken or fixed

- **Story 3 broke 0, fixed 20** earlier held-out tests (story 3: See other people's edits appear live on the same board). Source files it changed most: `vite-plugin-board-sync.ts` (182), `board-room.ts` (158), `connectBoard.ts` (100), `useBoardDoc.ts` (60), `protocol.ts` (54), `index.ts` (43), +13 more.
  - story 1: 0/10 → 10/10; fixed 10
  - story 2: 0/10 → 10/10; fixed 10
- **Story 9 broke 2, fixed 0** earlier held-out tests (story 9: Write free text anywhere on the board). Source files it changed most: `TextEditor.tsx` (263), `text.ts` (167), `StickyTextEditor.tsx` (158), `TextObject.tsx` (129), `textLayout.ts` (121), `useTextBoxSync.ts` (95), +21 more.
  - story 2: 10/10 → 8/10; broke 2.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
