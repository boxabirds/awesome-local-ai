# Vidi run — qwen/3.8-swift-1.5/27b/ubuntu/nvidia4090/llamacpp-pi

Model `qwen3.8-swift-1.5-27b`, scope `canvas`, effort `low`, client pi 0.87.1, host 13th Gen Intel(R) Core(TM) i9-13900F 62GB, NVIDIA GeForce RTX 4090 24564 MiB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 5/6 | 0 | 0 | 5/6 |
| 2 | 0/10 | 5 | 0 | 0/20 |
| 3 | 0/7 | 0 | 0 | 0/27 |
| 4 | 0/4 | 0 | 0 | 0/31 |
| 5 | 2/5 | 0 | 1 | 3/36 |
| 7 | 0/8 | 0 | 10 | 13/44 |
| 8 | 7/7 | 0 | 24 | 44/51 |
| 9 | 5/6 | 0 | 0 | 49/57 |
| 10 | 2/8 | 0 | 0 | 51/65 |

**New work** 21/61, **regressions** 5, **repairs** 35, **cumulative** 51/65.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 8.1 | None | None | None | — | — | green | 5/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 17 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 20.0 | None | None | None | — | — | red | 0/20 |  | 0 / 0 | 1 | — | throttled 0%, server peak 17 GB |
| 3 | See other people's edits appear live on the same board | DONE | 56.2 | None | None | None | — | — | red | 0/27 |  | 0 / 0 | 2 | — | throttled 0%, server peak 22 GB |
| 4 | Return to a board and find everything as it was left | DONE | 70.1 | None | None | None | — | — | red | 0/31 |  | 0 / 0 | 4 | — | throttled 0%, server peak 25 GB |
| 5 | Share a board with others using a link | DONE | 22.1 | None | None | None | — | — | red | 3/36 |  | 0 / 0 | 1 | — | throttled 0%, server peak 25 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 48.7 | None | None | None | — | — | red | 13/44 |  | 0 / 0 | 2 | — | throttled 0%, server peak 25 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 132.3 | None | None | None | — | — | red | 44/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 25 GB |
| 9 | Write free text anywhere on the board | DONE | 87.5 | None | None | None | — | — | red | 49/57 |  | 0 / 0 | 3 | — | throttled 0%, server peak 26 GB |
| 10 | Draw shapes and connect them with arrows that follow when moved | DONE | 15.1 | None | None | None | — | — | red | 51/65 |  | 0 / 0 | 1 | — | throttled 0%, server peak 26 GB |

**Totals:** 9 stories, 460 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 1/9, final acceptance 51/65, stalled 0, partial 0, 17851 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 6 by the agent | 6565 / 127 | `BoardViewport.tsx` (334), `useCamera.ts` (200), `camera.ts` (134), `ZoomControls.tsx` (96), `App.tsx` (64), `package.json` (31), +15 more |
| 2 | 1 by the agent | 2244 / 10 | `StickyNote.tsx` (191), `board-model.ts` (170), `StickyTextEditor.tsx` (116), `App.tsx` (87), `StickyText.ts` (72), `NoteToolbar.tsx` (68), +6 more |
| 3 | 1 by the agent | 2722 / 7 | `board-room.ts` (142), `connectBoard.ts` (73), `ConnectionStatus.tsx` (53), `types.d.ts` (52), `protocol.ts` (42), `App.tsx` (39), +7 more |
| 4 | 1 by the agent | 1848 / 350 | `board-store.ts` (271), `board-room.ts` (226), `room-state.ts` (93), `types.d.ts` (69), `vitest.workspace.ts` (37), `connectBoard.ts` (20), +8 more |
| 5 | 1 by the agent | 1604 / 182 | `App.tsx` (187), `BoardUI.tsx` (161), `SharePanel.tsx` (157), `board-store.ts` (69), `BoardPage.tsx` (67), `index.ts` (65), +11 more |
| 7 | 1 by the agent, + harness snapshot | 3219 / 361 | `board-model.ts` (245), `useTransformGesture.ts` (227), `BoardUI.tsx` (176), `geometry.ts` (174), `StickyNote.tsx` (158), `useSelection.ts` (133), +11 more |
| 8 | 6 by the agent, + harness snapshot | 1703 / 44 | `undo.ts` (222), `UndoButtons.tsx` (54), `BoardUI.tsx` (47), `StickyTextEditor.tsx` (42), `NOTES.md` (39), `useBoardKeys.ts` (39), +16 more |
| 9 | 4 by the agent, + harness snapshot | 2767 / 294 | `TextEditor.tsx` (204), `text.ts` (184), `StickyTextEditor.tsx` (159), `TextObject.tsx` (140), `textLayout.ts` (138), `BoardUI.tsx` (114), +17 more |
| 10 | 1 by the agent, + harness snapshot | 2760 / 172 | `ConnectorTool.tsx` (297), `connector.ts` (180), `NOTES.md` (177), `ShapeTool.tsx` (172), `shape.ts` (171), `ConnectorObject.tsx` (170), +11 more |

### Earlier stories broken or fixed

- **Story 2 broke 5, fixed 0** earlier held-out tests (story 2: Capture ideas on sticky notes and rearrange them). Source files it changed most: `StickyNote.tsx` (191), `board-model.ts` (170), `StickyTextEditor.tsx` (116), `App.tsx` (87), `StickyText.ts` (72), `NoteToolbar.tsx` (68), +6 more.
  - story 1: 5/6 → 0/10; broke 5.
- **Story 5 broke 0, fixed 1** earlier held-out tests (story 5: Share a board with others using a link). Source files it changed most: `App.tsx` (187), `BoardUI.tsx` (161), `SharePanel.tsx` (157), `board-store.ts` (69), `BoardPage.tsx` (67), `index.ts` (65), +11 more.
  - story 4: 0/4 → 1/4; fixed 1
- **Story 7 broke 0, fixed 10** earlier held-out tests (harness: snapshot after story 7 (uncommitted agent work); story 7: Select, move, resize and delete several objects at once). Source files it changed most: `board-model.ts` (245), `useTransformGesture.ts` (227), `BoardUI.tsx` (176), `geometry.ts` (174), `StickyNote.tsx` (158), `useSelection.ts` (133), +11 more.
  - story 1: 0/10 → 6/10; fixed 6
  - story 2: 0/10 → 2/10; fixed 2
  - story 5: 2/5 → 4/5; fixed 2
- **Story 8 broke 0, fixed 24** earlier held-out tests (harness: snapshot after story 8 (uncommitted agent work); notes: story 8 implementation + e2e environment gotchas; story 8: E2E undo tests (TC-22..TC-24) + snapshot cache includes text/colour; story 8: undo/redo toolbar buttons, useUndo binding, keyboard shortcuts (TC-18..TC-21 green); story 8: wire undo boundaries into gestures, keys, and text editor; story 8: per-user undo controller with stale-step safety (TC-01..TC-13 green); story 8: test-first undo history and capture-timeout unit tests (TC-01..TC-13)). Source files it changed most: `undo.ts` (222), `UndoButtons.tsx` (54), `BoardUI.tsx` (47), `StickyTextEditor.tsx` (42), `NOTES.md` (39), `useBoardKeys.ts` (39), +16 more.
  - story 1: 6/10 → 10/10; fixed 4
  - story 2: 2/10 → 8/10; fixed 6
  - story 3: 0/7 → 5/7; fixed 5
  - story 4: 1/4 → 3/4; fixed 2
  - story 5: 4/5 → 5/5; fixed 1
  - story 7: 0/8 → 6/8; fixed 6

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
