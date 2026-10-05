# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 5/7 | 0 | 0 | 24/27 |
| 4 | 4/4 | 0 | 0 | 28/31 |
| 5 | 5/5 | 0 | 0 | 33/36 |
| 7 | 8/8 | 0 | 1 | 42/44 |
| 8 | 7/7 | 0 | 0 | 49/51 |
| 9 | 6/6 | 2 | 1 | 54/57 |
| 10 | 8/8 | 0 | 0 | 62/65 |
| 11 | 5/5 | 0 | 0 | 67/70 |

**New work** 63/66, **regressions** 2, **repairs** 2, **cumulative** 67/70.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 8.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 27.0 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 48.1 | None | None | None | — | — | green | 24/27 |  | 0 / 0 | 1 | — | throttled 0%, server peak 23 GB |
| 4 | Return to a board and find everything as it was left | DONE | 105.2 | None | None | None | — | — | green | 28/31 |  | 1 / 0 | 4 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 70.8 | None | None | None | — | — | red | 33/36 |  | 1 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 33.3 | None | None | None | — | — | red | 42/44 |  | 0 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 19.6 | None | None | None | — | — | red | 49/51 |  | 0 / 0 | 1 | — | throttled 0%, server peak 18 GB |
| 9 | Write free text anywhere on the board | DONE | 62.1 | None | None | None | — | — | red | 54/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 17.2 | None | None | None | — | — | red | 62/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 11 | Sketch freehand with a pen | DONE | 25.0 | None | None | None | — | — | red | 67/70 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |

**Totals:** 10 stories, 417 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 4/10, final acceptance 67/70, stalled 0, partial 0, 19726 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6258 / 7 | `BoardViewport.tsx` (243), `useCamera.ts` (117), `camera.ts` (114), `ZoomControls.tsx` (98), `package.json` (31), `NavigationHint.tsx` (31), +14 more |
| 2 | 3 by the agent | 2444 / 61 | `StickyNote.tsx` (269), `board-model.ts` (221), `StickyTextEditor.tsx` (174), `StickyText.ts` (96), `App.tsx` (94), `NoteToolbar.tsx` (83), +9 more |
| 3 | 1 by the agent | 3302 / 228 | `board-room.ts` (157), `connectBoard.ts` (104), `cloudflare-workers.d.ts` (94), `protocol.ts` (60), `ConnectionStatus.tsx` (55), `App.tsx` (52), +11 more |
| 4 | 4 by the agent | 1890 / 114 | `board-room.ts` (315), `board-store.ts` (306), `room-state.ts` (73), `cloudflare-workers.d.ts` (42), `PROGRESS.md` (18), `App.tsx` (14), +4 more |
| 5 | 1 by the agent | 2149 / 278 | `BoardPage.tsx` (215), `SharePanel.tsx` (210), `App.tsx` (167), `board-room.ts` (140), `test-hooks.ts` (122), `board-store.ts` (96), +13 more |
| 7 | 1 by the agent | 2768 / 322 | `useTransformGesture.ts` (287), `board-model.ts` (263), `StickyNote.tsx` (203), `geometry.ts` (171), `BoardPage.tsx` (150), `useSelection.ts` (144), +10 more |
| 8 | 1 by the agent | 1466 / 79 | `NOTES.md` (105), `undo.ts` (96), `UndoButtons.tsx` (62), `PROGRESS.md` (61), `useUndo.ts` (41), `BoardPage.tsx` (35), +7 more |
| 9 | 8 by the agent | 2705 / 363 | `TextEditor.tsx` (300), `text.ts` (171), `StickyTextEditor.tsx` (162), `TextObject.tsx` (136), `useTextBoxSync.ts` (130), `textLayout.ts` (116), +17 more |
| 10 | 1 by the agent | 2988 / 79 | `ConnectorTool.tsx` (269), `ConnectorObject.tsx` (225), `ShapeObject.tsx` (217), `connector.ts` (176), `ShapeTool.tsx` (157), `shape.ts` (151), +13 more |
| 11 | 1 by the agent | 1594 / 18 | `PenTool.tsx` (222), `simplify.ts` (146), `stroke.ts` (139), `StrokeObject.tsx` (112), `PenToolbar.tsx` (99), `registry.tsx` (44), +12 more |

### Earlier stories broken or fixed

- **Story 7 broke 0, fixed 1** earlier held-out tests (story 7: Select, move, resize and delete several objects at once). Source files it changed most: `useTransformGesture.ts` (287), `board-model.ts` (263), `StickyNote.tsx` (203), `geometry.ts` (171), `BoardPage.tsx` (150), `useSelection.ts` (144), +10 more.
  - story 2: 9/10 → 10/10; fixed 1
- **Story 9 broke 2, fixed 1** earlier held-out tests (story 9: Write free text anywhere on the board; story 9: task 9 — text object component tests (TC-19 to TC-25) passing; story 9: task 7 — tool mode component tests (TC-14 to TC-18) passing; story 9: task 6+8 — tool mode, TextObject, TextEditor, TextToolbar, horizontal handles, gesture + page wiring; story 9: task 5 — box-sync component tests (TC-12, TC-13) passing; story 9: task 4 — text layout (canvas measurer + greedy wrap) and local-only box sync; story 9: tasks 2+3 — text model implementation; layout unit tests (test-first) + stubs; story 9: task 1 — text model unit tests (test-first) + TEXT_* settings + stubs). Source files it changed most: `TextEditor.tsx` (300), `text.ts` (171), `StickyTextEditor.tsx` (162), `TextObject.tsx` (136), `useTextBoxSync.ts` (130), `textLayout.ts` (116), +17 more.
  - story 2: 10/10 → 8/10; broke 2.
  - story 3: 5/7 → 6/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
