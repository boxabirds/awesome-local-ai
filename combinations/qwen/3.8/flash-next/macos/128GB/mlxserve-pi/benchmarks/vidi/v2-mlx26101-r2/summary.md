# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 5/5 | 0 | 0 | 35/36 |
| 7 | 8/8 | 0 | 0 | 43/44 |
| 8 | 7/7 | 0 | 1 | 51/51 |

**New work** 46/47, **regressions** 0, **repairs** 1, **cumulative** 51/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 62.5 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 2 | — | throttled 82%, server peak 91 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 62.0 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 80%, server peak 93 GB |
| 3 | See other people's edits appear live on the same board | DONE | 151.5 | None | None | None | — | — | green | 26/27 |  | 0 / 1 | 6 | — | throttled 74%, server peak 95 GB |
| 4 | Return to a board and find everything as it was left | DONE | 221.1 | None | None | None | — | — | green | 30/31 |  | 0 / 1 | 10 | — | throttled 56%, server peak 93 GB |
| 5 | Share a board with others using a link | DONE | 81.4 | None | None | None | — | — | green | 35/36 |  | 0 / 1 | 4 | — | throttled 81%, server peak 93 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 102.9 | None | None | None | — | — | green | 43/44 |  | 0 / 0 | 5 | — | throttled 91%, server peak 93 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 70.3 | None | None | None | — | — | green | 51/51 |  | 0 / 1 | 4 | — | throttled 89%, server peak 94 GB |

**Totals:** 7 stories, 752 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 7/7, final acceptance 51/51, stalled 0, partial 0, 27366 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 3 by the agent | 7047 / 36 | `useCamera.ts` (325), `BoardViewport.tsx` (203), `styles.css` (182), `camera.ts` (160), `NOTES.md` (111), `ZoomControls.tsx` (67), +14 more |
| 2 | 5 by the agent | 4671 / 61 | `board-model.ts` (340), `StickyNote.tsx` (338), `styles.css` (219), `StickyText.ts` (162), `StickyTextEditor.tsx` (160), `App.tsx` (138), +10 more |
| 3 | 8 by the agent | 6450 / 922 | `connectBoard.ts` (227), `board-room.ts` (193), `NOTES.md` (143), `protocol.ts` (122), `PROGRESS.md` (88), `vitest.config.ts` (87), +14 more |
| 4 | 8 by the agent | 6121 / 329 | `board-room.ts` (497), `board-store.ts` (466), `test-hooks.ts` (360), `NOTES.md` (246), `room-state.ts` (169), `connectBoard.ts` (94), +15 more |
| 5 | 1 by the agent | 4087 / 302 | `App.tsx` (269), `SharePanel.tsx` (223), `BoardSurface.tsx` (211), `styles.css` (196), `BoardPage.tsx` (144), `board-store.ts` (135), +15 more |
| 7 | 1 by the agent | 3619 / 408 | `board-model.ts` (372), `StickyNote.tsx` (349), `useTransformGesture.ts` (333), `useSelection.ts` (223), `geometry.ts` (221), `SelectionOverlay.tsx` (159), +11 more |
| 8 | 1 by the agent, + harness snapshot | 3234 / 25 | `undo.ts` (187), `useUndo.ts` (99), `UndoButtons.tsx` (69), `NOTES.md` (65), `useBoardKeys.ts` (49), `StickyTextEditor.tsx` (46), +9 more |

### Earlier stories broken or fixed

- **Story 8 broke 0, fixed 1** earlier held-out tests (harness: PROGRESS.md for story 8 (all tasks done); story 8: undo and redo my own changes without undoing anyone else's). Source files it changed most: `undo.ts` (187), `useUndo.ts` (99), `UndoButtons.tsx` (69), `NOTES.md` (65), `useBoardKeys.ts` (49), `StickyTextEditor.tsx` (46), +9 more.
  - story 3: 6/7 → 7/7; fixed 1

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
