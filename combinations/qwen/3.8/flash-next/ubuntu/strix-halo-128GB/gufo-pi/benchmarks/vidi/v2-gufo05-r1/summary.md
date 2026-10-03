# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../../../../../../../benchmarks/spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 7/10 | 0 | 0 | 17/20 |
| 3 | 4/7 | 0 | 0 | 21/27 |
| 4 | 4/4 | 0 | 0 | 25/31 |
| 5 | 5/5 | 0 | 0 | 30/36 |
| 7 | 7/8 | 0 | 0 | 37/44 |
| 8 | 7/7 | 0 | 0 | 44/51 |

**New work** 40/47, **regressions** 0, **repairs** 0, **cumulative** 44/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 52.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 1 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 82.1 | None | None | None | — | — | green | 17/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 168.1 | None | None | None | — | — | green | 21/27 |  | 2 / 1 | 4 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | PARTIAL (red) | 239.3 | None | None | None | — | — | red | 25/31 |  | 1 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE, on partial 4 | 218.6 | None | None | None | — | — | green | 30/36 |  | 2 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE, on partial 4 | 112.1 | None | None | None | — | — | green | 37/44 |  | 0 / 1 | 4 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE, on partial 4 | 94.5 | None | None | None | — | — | green | 44/51 |  | 0 / 1 | 3 | — | throttled 0%, server peak 0 GB |

**Totals:** 7 stories, 967 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/7, final acceptance 44/51, stalled 0, partial 1, 21570 lines in src+tests.

### Stories ended early (PARTIAL) and what was built on them

- **Story 4 PARTIAL**, ended by the operator (harness (cap)): story cap: 4.0 h of agent time (cap 4.0 h). Verdict **red**: gate red, tasks not verified [1, 2, 3, 4, 5, 6, 7, 8, 9] (implementation: [2, 4, 7]), held-out 4/4 (floor 0.25).
- Story 5, built on partial 4: held-out tests on the partial base 9/9; partial story's tests fixed 0, regressed 0; 2 stub-like lines added to src/.
- Story 7, built on partial 4: held-out tests on the partial base 16/17; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.
- Story 8, built on partial 4: held-out tests on the partial base 23/24; partial story's tests fixed 0, regressed 0; 0 stub-like lines added to src/.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 2 by the agent | 6372 / 53 | `BoardViewport.tsx` (272), `useCamera.ts` (270), `camera.ts` (188), `styles.css` (181), `NOTES.md` (114), `playwright.config.ts` (106), +17 more |
| 2 | 4 by the agent | 3690 / 118 | `StickyNote.tsx` (411), `board-model.ts` (280), `styles.css` (183), `StickyTextEditor.tsx` (154), `App.tsx` (140), `NOTES.md` (130), +9 more |
| 3 | 4 by the agent | 21140 / 137 | `worker-configuration.d.ts` (16189), `connectBoard.ts` (195), `board-room.ts` (173), `protocol.ts` (133), `NOTES.md` (132), `StickyTextEditor.tsx` (82), +19 more |
| 4 | 2 by the agent, + harness snapshot | 2930 / 212 | `board-room.ts` (546), `board-store.ts` (415), `room-state.ts` (136), `test-hooks.ts` (133), `NOTES.md` (38), `config.ts` (37), +7 more |
| 5 | 1 by the agent | 2805 / 114 | `styles.css` (182), `SharePanel.tsx` (175), `NOTES.md` (126), `BoardPage.tsx` (104), `board-store.ts` (94), `router.ts` (81), +14 more |
| 7 | 5 by the agent | 5192 / 493 | `useTransformGesture.ts` (393), `board-model.ts` (324), `StickyNote.tsx` (288), `geometry.ts` (265), `App.tsx` (248), `useSelection.ts` (237), +15 more |
| 8 | 1 by the agent | 2292 / 27 | `undo.ts` (229), `NOTES.md` (116), `useUndo.ts` (82), `UndoButtons.tsx` (68), `useBoardKeys.ts` (61), `StickyTextEditor.tsx` (38), +9 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
