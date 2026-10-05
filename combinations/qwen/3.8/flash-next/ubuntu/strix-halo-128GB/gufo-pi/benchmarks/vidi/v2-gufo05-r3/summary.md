# Vidi run — qwen/3.8/flash-next/ubuntu/strix-halo-128GB/gufo-pi

Model `qwen3.8-flash-next-gufo`, scope `canvas`, effort `low`, client pi 0.87.1, host AMD RYZEN AI MAX+ 395 w/ Radeon 8060S 122GB.

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
| 8 | 7/7 | 0 | 0 | 50/51 |

**New work** 46/47, **regressions** 0, **repairs** 0, **cumulative** 50/51.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 32.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0%, server peak 0 GB |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 80.0 | None | None | None | — | — | green | 20/20 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 3 | See other people's edits appear live on the same board | DONE | 160.1 | None | None | None | — | — | green | 26/27 |  | 2 / 0 | 3 | — | throttled 0%, server peak 0 GB |
| 4 | Return to a board and find everything as it was left | DONE | 158.8 | None | None | None | — | — | green | 30/31 |  | 0 / 0 | 5 | — | throttled 0%, server peak 0 GB |
| 5 | Share a board with others using a link | DONE | 61.6 | None | None | None | — | — | green | 35/36 |  | 0 / 1 | 2 | — | throttled 0%, server peak 0 GB |
| 7 | Select, move, resize and delete several objects at once | DONE | 108.9 | None | None | None | — | — | red | 43/44 |  | 0 / 0 | 4 | — | throttled 0%, server peak 0 GB |
| 8 | Undo and redo my own changes without undoing anyone else's | DONE | 105.1 | None | None | None | — | — | green | 50/51 |  | 0 / 0 | 3 | — | throttled 0%, server peak 0 GB |

**Totals:** 7 stories, 707 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 6/7, final acceptance 50/51, stalled 0, partial 0, 20781 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 4 by the agent | 7220 / 45 | `BoardViewport.tsx` (241), `camera.ts` (171), `useCamera.ts` (159), `styles.css` (140), `ZoomControls.tsx` (55), `playwright.config.ts` (49), +15 more |
| 2 | 6 by the agent | 4248 / 110 | `StickyNote.tsx` (328), `board-model.ts` (294), `StickyText.ts` (240), `styles.css` (230), `App.tsx` (144), `StickyTextEditor.tsx` (144), +10 more |
| 3 | 5 by the agent | 4187 / 56 | `board-room.ts` (198), `protocol.ts` (125), `NOTES.md` (113), `connectBoard.ts` (108), `App.tsx` (89), `index.ts` (54), +12 more |
| 4 | 1 by the agent | 3973 / 85 | `board-store.ts` (485), `board-room.ts` (465), `NOTES.md` (126), `room-state.ts` (111), `test-hooks.ts` (50), `connectBoard.ts` (43), +11 more |
| 5 | 1 by the agent | 1900 / 478 | `NOTES.md` (484), `SharePanel.tsx` (167), `styles.css` (145), `BoardPage.tsx` (87), `board-store.ts` (83), `HomePage.tsx` (78), +13 more |
| 7 | 2 by the agent | 4933 / 499 | `useTransformGesture.ts` (346), `board-model.ts` (266), `geometry.ts` (264), `StickyNote.tsx` (263), `NOTES.md` (251), `App.tsx` (216), +12 more |
| 8 | 4 by the agent | 2552 / 132 | `NOTES.md` (203), `useUndo.ts` (169), `undo.ts` (148), `StickyTextEditor.tsx` (54), `UndoButtons.tsx` (53), `useBoardKeys.ts` (45), +6 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
