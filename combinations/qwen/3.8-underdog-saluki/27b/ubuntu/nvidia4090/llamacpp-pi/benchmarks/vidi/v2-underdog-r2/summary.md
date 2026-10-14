# Vidi run — qwen/3.8-underdog-saluki/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-underdog-saluki-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 8/10 | 0 | 0 | 16/20 |
| 3 | 0/7 | 16 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 2/5 | 0 | 0 | 2/36 |
| 7 | 0/8 | 0 | 0 | 2/44 |
| 8 | 0/7 | 0 | 0 | 2/51 |
| 9 | 4/6 | 0 | 30 | 36/57 |
| 10 | 7/8 | 0 | 0 | 43/65 |
| 11 | 5/5 | 0 | 7 | 55/70 |

**New work** 31/66, **regressions** 16, **repairs** 37, **cumulative** 55/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 124.7 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 6 | — | throttled 0%, server peak 23 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 65.0 | None | None | None | — | — | green | 16/20 |  | 0 / 1 | 3 | — | throttled 0%, server peak 25 GB |
| 3 | See other people's edits appear live on the same board | DONE | 232.0 | None | None | None | — | — | red | 0/27 | yes | 0 / 0 | 15 | — | throttled 0%, server peak 25 GB |
| 4 | Return to a board and find everything as it was left | DONE | 201.6 | None | None | None | — | — | red | 0/31 | yes | 0 / 0 | 12 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 106.3 | None | None | None | — | — | red | 2/36 | yes | 0 / 0 | 6 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 150.8 | None | None | None | — | — | red | 2/44 | yes | 1 / 1 | 8 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 93.4 | None | None | None | — | — | red | 2/51 |  | 1 / 0 | 5 | — | throttled 0%, server peak 25 GB |
| 9 | Write free text anywhere on the board | PARTIAL (red) | 203.2 | None | None | None | — | — | red | 36/57 |  | 0 / 1 | 10 | — | throttled 0%, server peak 25 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | PARTIAL (red), on partial 9 | 112.9 | None | None | None | — | — | red | 43/65 |  | 0 / 1 | 8 | — | throttled 0%, server peak 25 GB |
| 11 | Sketch freehand with a pen | DONE, on partial 9, 10 | 179.3 | None | None | None | — | — | red | 55/70 | yes | 3 / 1 | 9 | — | throttled 0%, server peak 26 GB |

**Totals:** 10 stories, 1469 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/10, final acceptance 55/70, stalled 5, partial 2, 30384 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 9 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [6, 7, 8, 9, 10] (implementation: [6, 8]), held-out 4/6 (floor 0.333).
- **Story 10 PARTIAL**, ended by the operator (harness (stop message already sent)): story cap: the stop message was sent and the story was still not finished (one message per story). Verdict **red**: gate red, tasks not verified [7, 8, 9, 10, 11, 12, 13, 14, 15] (implementation: [8, 10, 11, 12, 13]), held-out 7/8 (floor 0.625).
- Story 10, built on partial 9: held-out tests on the partial base 11/14; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 11, built on partial 9, 10: held-out tests on the partial base 16/19; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 7399 / 82 | `BoardViewport.tsx` (254), `useCamera.ts` (192), `camera.ts` (163), `index.css` (147), `playwright.config.ts` (128), `ZoomControls.tsx` (96), +16 more |
| 2 | 1 by the agent | 2818 / 24 | `StickyNote.tsx` (256), `board-model.ts` (208), `index.css` (183), `StickyTextEditor.tsx` (134), `StickyText.ts` (92), `App.tsx` (89), +9 more |
| 3 | harness snapshot (agent left work uncommitted) | 11397 / 172 | `board-room.ts` (185), `App.tsx` (160), `BoardPage.tsx` (154), `connectBoard.ts` (105), `board-id.ts` (64), `useBoardDoc.ts` (63), +14 more |
| 4 | 1 by the agent, + harness snapshot | 1811 / 57 | `board-store.ts` (239), `board-store-core.ts` (54), `room-state.ts` (52), `config.ts` (9), `protocol.ts` (8), `cloudflare-test.d.ts` (7), +1 more |
| 5 | harness snapshot (agent left work uncommitted) | 1951 / 1380 | `board-room.ts` (292), `index.css` (169), `SharePanel.tsx` (157), `board-store.ts` (133), `index.ts` (78), `BoardPage.tsx` (75), +14 more |
| 7 | harness snapshot (agent left work uncommitted) | 4091 / 398 | `useTransformGesture.ts` (348), `board-model.ts` (305), `StickyNote.tsx` (249), `BoardCanvas.tsx` (210), `geometry.ts` (165), `useSelection.ts` (143), +12 more |
| 8 | 1 by the agent | 1716 / 21 | `undo.ts` (112), `useUndo.ts` (57), `index.css` (54), `UndoButtons.tsx` (42), `useBoardKeys.ts` (37), `BoardCanvas.tsx` (34), +6 more |
| 9 | 5 by the agent, + harness snapshot | 2867 / 170 | `TextObject.tsx` (193), `TextEditor.tsx` (179), `text.ts` (165), `textLayout.ts` (114), `BoardCanvas.tsx` (112), `useTextBoxSync.ts` (112), +19 more |
| 10 | harness snapshot (agent left work uncommitted) | 3362 / 33 | `ConnectorTool.tsx` (286), `ConnectorObject.tsx` (241), `connector.ts` (227), `ShapeTool.tsx` (207), `shape.ts` (170), `ShapeObject.tsx` (150), +13 more |
| 11 | harness snapshot (agent left work uncommitted) | 7593 / 59 | `PenTool.tsx` (275), `stroke.ts` (142), `simplify.ts` (139), `StrokeObject.tsx` (106), `PenToolbar.tsx` (86), `tc29-debug.mjs` (72), +111 more |

### Earlier stories broken or fixed

- **Story 3 broke 16, fixed 0** earlier held-out tests (harness: snapshot after story 3 (uncommitted agent work)). Source files it changed most: `board-room.ts` (185), `App.tsx` (160), `BoardPage.tsx` (154), `connectBoard.ts` (105), `board-id.ts` (64), `useBoardDoc.ts` (63), +14 more.
  - story 1: 8/10 → 0/10; broke 8.
  - story 2: 8/10 → 0/10; broke 8.
- **Story 9 broke 0, fixed 30** earlier held-out tests (harness: snapshot after story 9 (uncommitted agent work); story 9: task 5 — box-sync component tests (TC-12, TC-13); story 9: task 4 — text layout implementation and local-only box sync hook; story 9: task 3 — text layout unit tests first with a fake measurer (TC-07 to TC-11, TC-32); story 9: task 2 — text object model and shared text-edit helpers; story 9: task 1 — text model unit tests first (TC-01 to TC-06) with stubs). Source files it changed most: `TextObject.tsx` (193), `TextEditor.tsx` (179), `text.ts` (165), `textLayout.ts` (114), `BoardCanvas.tsx` (112), `useTextBoxSync.ts` (112), +19 more.
  - story 1: 0/10 → 8/10; fixed 8
  - story 2: 0/10 → 9/10; fixed 9
  - story 3: 0/7 → 1/7; fixed 1
  - story 4: 0/4 → 1/4; fixed 1
  - story 7: 0/8 → 6/8; fixed 6
  - story 8: 0/7 → 5/7; fixed 5
- **Story 11 broke 0, fixed 7** earlier held-out tests (harness: snapshot after story 11 (uncommitted agent work)). Source files it changed most: `PenTool.tsx` (275), `stroke.ts` (142), `simplify.ts` (139), `StrokeObject.tsx` (106), `PenToolbar.tsx` (86), `tc29-debug.mjs` (72), +111 more.
  - story 3: 1/7 → 4/7; fixed 3
  - story 4: 1/4 → 4/4; fixed 3
  - story 8: 5/7 → 6/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
