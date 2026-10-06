# Vidi run — qwen/3.8/flash-next/macos/128GB/mlxserve-pi

Model `mlxserve-flash-next-mixed-4-8bit`, scope `canvas`, effort `low`, client pi 0.87.1, host Apple M5 Max 128GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 9/10 | 0 | 0 | 19/20 |
| 3 | 7/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 4/5 | 0 | 0 | 34/36 |
| 7 | 8/8 | 0 | 0 | 42/44 |
| 8 | 7/7 | 0 | 0 | 49/51 |

**New work** 45/47, **regressions** 0, **repairs** 0, **cumulative** 49/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 34.6 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 93%, server peak 91 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 69.3 | None | None | None | — | — | green | 19/20 |  | 0 / 0 | 3 | — | throttled 99%, server peak 93 GB |
| 3 | See other people's edits appear live on the same board | PARTIAL (amber) | 240.0 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 7 | — | throttled 62%, server peak 94 GB |
| 4 | Return to a board and find everything as it was left | DONE, on partial 3 | 142.6 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 7 | — | throttled 86%, server peak 95 GB |
| 5 | Share a board with others using a link | DONE, on partial 3 | 100.6 | None | None | None | — | — | green | 34/36 |  | 0 / 1 | 4 | — | throttled 64%, server peak 95 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 3 | 193.1 | None | None | None | — | — | green | 42/44 |  | 0 / 1 | 9 | — | throttled 76%, server peak 95 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 3 | 81.7 | None | None | None | — | — | red | 49/51 |  | 0 / 1 | 4 | — | throttled 82%, server peak 95 GB |

**Totals:** 7 stories, 862 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/7, final acceptance 49/51, stalled 0, partial 1, 30341 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 3 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **amber**: gate green, tasks not verified [4, 7, 8, 9] (implementation: [4]), held-out 7/7 (floor 0.571).
- Story 4, built on partial 3: held-out tests on the partial base 11/11; partial story's tests fixed 0, regressed 0; 2 stub-like lines added to src/.
- Story 5, built on partial 3: held-out tests on the partial base 15/16; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 7, built on partial 3: held-out tests on the partial base 23/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 3: held-out tests on the partial base 30/31; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6329 / 7 | `BoardViewport.tsx` (224), `useCamera.ts` (210), `styles.css` (174), `NOTES.md` (140), `camera.ts` (113), `ZoomControls.tsx` (72), +15 more |
| 2 | 1 by the agent | 4409 / 26 | `StickyNote.tsx` (365), `styles.css` (207), `board-model.ts` (196), `StickyTextEditor.tsx` (167), `NOTES.md` (161), `App.tsx` (147), +9 more |
| 3 | 2 by the agent, + harness snapshot | 7866 / 91 | `connection.ts` (393), `board-room.ts` (192), `protocol.ts` (165), `styles.css` (128), `StickyText.ts` (116), `identity.ts` (111), +19 more |
| 4 | 1 by the agent | 5521 / 164 | `board-room.ts` (466), `board-store.ts` (364), `test-hooks.ts` (200), `room-state.ts` (155), `connection.ts` (83), `App.tsx` (57), +13 more |
| 5 | 1 by the agent | 4514 / 933 | `App.tsx` (323), `Board.tsx` (288), `styles.css` (254), `SharePanel.tsx` (252), `board-store.ts` (196), `router.ts` (144), +17 more |
| 7 | 1 by the agent | 6540 / 509 | `useTransformGesture.ts` (420), `StickyNote.tsx` (371), `board-model.ts` (299), `geometry.ts` (252), `useSelection.ts` (201), `registry.tsx` (197), +12 more |
| 8 | 1 by the agent | 2482 / 28 | `undo.ts` (202), `NOTES.md` (80), `UndoButtons.tsx` (75), `useUndo.ts` (72), `Board.tsx` (65), `StickyTextEditor.tsx` (62), +8 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
