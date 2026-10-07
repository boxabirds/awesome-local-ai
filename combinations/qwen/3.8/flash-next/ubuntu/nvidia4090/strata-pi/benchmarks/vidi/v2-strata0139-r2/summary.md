# Vidi run — qwen/3.8/flash-next/ubuntu/nvidia4090/strata-pi

Model `strata-flash-next-iq3xxs`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

Setup fallbacks are held-out tests whose setup reached its state by the documented flow after an undocumented alternate flow failed (rule 8); the failure is counted once, as a finding.

| Story | New work | Regressions | Repairs | Cumulative | Setup fallbacks |
|---|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 | 0 |
| 2 | 0/10 | 0 | 0 | 6/20 | 0 |
| 3 | 0/7 | 0 | 0 | 6/27 | 0 |
| 4 | 1/4 | 0 | 0 | 7/31 | 0 |
| 5 | 2/5 | 0 | 0 | 9/36 | 0 |
| 7 | 0/8 | 0 | 0 | 9/44 | 0 |
| 8 | 1/7 | 0 | 0 | 10/51 | 0 |
| 9 | 5/6 | 0 | 0 | 15/57 | 1 |
| 10 | 6/8 | 0 | 0 | 21/65 | 1 |
| 11 | 4/5 | 0 | 0 | 25/70 | 1 |
| 12 | 0/5 | 0 | 0 | 25/75 | 1 |

**New work** 25/71, **regressions** 0, **repairs** 0, **cumulative** 25/75.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 27.1 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 116.5 | None | None | None | — | — | green | 6/20 |  | 0 / 0 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (red) | 240.0 | None | None | None | — | — | red | 6/27 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red), on partial 3 | 240.0 | None | None | None | — | — | red | 7/31 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE, on partial 3, 4 | 210.9 | None | None | None | — | — | green | 9/36 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | PARTIAL (red), on partial 3, 4 | 240.0 | None | None | None | — | — | red | 9/44 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | PARTIAL (amber), on partial 3, 4, 7 | 240.0 | None | None | None | — | — | green | 10/51 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 9 | Write free text anywhere on the board | PARTIAL (amber), on partial 3, 4, 7, 8 | 240.0 | None | None | None | — | — | green | 15/57 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | PARTIAL (amber), on partial 3, 4, 7, 8, 9 | 240.0 | None | None | None | — | — | green | 21/65 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 3, 4, 7, 8, 9, 10 | 208.0 | None | None | None | — | — | red | 25/70 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 12 | Drop images onto the board | PARTIAL (amber), on partial 3, 4, 7, 8, 9, 10 | 240.0 | None | None | None | — | — | green | 25/75 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |

**Totals:** 11 stories, 2243 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/11, final acceptance 25/75, stalled 0, partial 7, 324913 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 7, 8, 9] (implementation: [4]), held-out 0/7 (floor 0.571).
- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [4, 6, 7, 8, 9] (implementation: [4, 7]), held-out 1/4 (floor 1.0).
- Story 4, built on partial 3: held-out tests on the partial base 1/11; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 5, built on partial 3, 4: held-out tests on the partial base 3/16; partial story's tests fixed 0, regressed 0; 2 stub-like lines added to src/.
- **Story 7 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [2, 8, 10, 11, 12, 13]), held-out 0/8 (floor 0.0).
- Story 7, built on partial 3, 4: held-out tests on the partial base 3/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 8 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [2, 5, 6, 7, 8, 9, 10, 11] (implementation: [2, 8, 10]), held-out 1/7 (floor 0.0).
- Story 8, built on partial 3, 4, 7: held-out tests on the partial base 4/31; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 9 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [6, 7, 8, 9, 10] (implementation: [6, 8]), held-out 5/6 (floor 0.333).
- Story 9, built on partial 3, 4, 7, 8: held-out tests on the partial base 9/37; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 10 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [8, 10, 11, 12, 13]), held-out 6/8 (floor 0.625).
- Story 10, built on partial 3, 4, 7, 8, 9: held-out tests on the partial base 15/45; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 11, built on partial 3, 4, 7, 8, 9, 10: held-out tests on the partial base 19/50; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- **Story 12 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [3, 5, 6, 7]), held-out 0/5 (floor 0.6).
- Story 12, built on partial 3, 4, 7, 8, 9, 10: held-out tests on the partial base 19/55; partial story's tests fixed 0, regressed 0; 16 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6738 / 34 | `useCamera.ts` (262), `BoardViewport.tsx` (244), `styles.css` (165), `camera.ts` (159), `NOTES.md` (98), `playwright.config.ts` (84), +15 more |
| 2 | 8 by the agent | 3727 / 72 | `StickyNote.tsx` (366), `board-model.ts` (324), `styles.css` (193), `StickyText.ts` (164), `StickyTextEditor.tsx` (150), `App.tsx` (148), +9 more |
| 3 | 2 by the agent, + harness snapshot | 20972 / 268 | `worker-configuration.d.ts` (16187), `board-room.ts` (197), `connection-state.ts` (104), `protocol.ts` (104), `connectBoard.ts` (65), `StickyTextEditor.tsx` (52), +22 more |
| 4 | 3 by the agent, + harness snapshot | 3271 / 145 | `board-store.ts` (485), `board-room.ts` (421), `room-state.ts` (148), `NOTES.md` (91), `playwright.persistence.config.ts` (37), `config.ts` (21), +4 more |
| 5 | 1 by the agent | 3763 / 133 | `SharePanel.tsx` (181), `NOTES.md` (172), `styles.css` (168), `index.ts` (131), `board-room.ts` (118), `BoardPage.tsx` (113), +17 more |
| 7 | harness snapshot (agent left work uncommitted) | 5181 / 463 | `useTransformGesture.ts` (423), `board-model.ts` (364), `geometry.ts` (259), `StickyNote.tsx` (241), `App.tsx` (217), `useBoardKeys.ts` (189), +8 more |
| 8 | harness snapshot (agent left work uncommitted) | 2301 / 28 | `undo.ts` (166), `NOTES.md` (142), `useUndo.ts` (140), `UndoButtons.tsx` (50), `useBoardKeys.ts` (45), `StickyTextEditor.tsx` (35), +10 more |
| 9 | 1 by the agent, + harness snapshot | 3754 / 323 | `TextEditor.tsx` (280), `StickyTextEditor.tsx` (236), `textLayout.ts` (210), `text.ts` (194), `text-edit.ts` (161), `TextObject.tsx` (156), +17 more |
| 10 | harness snapshot (agent left work uncommitted) | 4922 / 50 | `connector.ts` (383), `ConnectorTool.tsx` (280), `shape.ts` (233), `styles.css` (215), `ShapeObject.tsx` (211), `connector-geometry.ts` (180), +15 more |
| 11 | 1 by the agent | 3369 / 46 | `PenTool.tsx` (314), `stroke.ts` (225), `simplify.ts` (173), `StrokeObject.tsx` (138), `NOTES.md` (120), `styles.css` (99), +12 more |
| 12 | harness snapshot (agent left work uncommitted) | 4718 / 15 | `useImageInsert.ts` (485), `ImageObject.tsx` (305), `image.ts` (277), `styles.css` (183), `assets.ts` (169), `Toast.tsx` (115), +17 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
