# Vidi run — reference/sonnet-5.5

Model `claude-sonnet-5-5`, scope `canvas`, effort `client default`, client claude 2.1.285 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |
| 4 | 4/4 | 0 | 0 | 30/31 |
| 5 | 5/5 | 0 | 0 | 35/36 |
| 7 | 8/8 | 0 | 0 | 43/44 |

**New work** 39/40, **regressions** 0, **repairs** 0, **cumulative** 43/44.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 5.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 100% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 6.8 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | throttled 100% |
| 3 | See other people's edits appear live on the same board | DONE | 12.3 | None | None | None | — | — | red | 26/27 |  | 0 / 0 | 0 | — | throttled 54% |
| 4 | Return to a board and find everything as it was left | DONE | 18.3 | None | None | None | — | — | red | 30/31 |  | 0 / 0 | 0 | — | throttled 0% |
| 5 | Share a board with others using a link | DONE | 10.4 | None | None | None | — | — | red | 35/36 |  | 0 / 0 | 0 | — | throttled 0% |
| 7 | Select, move, resize and delete several objects at once | DONE | 12.6 | None | None | None | — | — | red | 43/44 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 6 stories, 66 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/6, final acceptance 43/44, stalled 0, partial 0, 7948 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6054 / 0 | `BoardViewport.tsx` (169), `useCamera.ts` (102), `camera.ts` (72), `styles.css` (70), `package.json` (31), `App.tsx` (24), +13 more |
| 2 | 1 by the agent | 1552 / 12 | `StickyNote.tsx` (163), `styles.css` (133), `board-model.ts` (119), `App.tsx` (73), `StickyTextEditor.tsx` (69), `StickyText.ts` (59), +8 more |
| 3 | 1 by the agent | 2785 / 16 | `board-room.ts` (108), `connectBoard.ts` (67), `protocol.ts` (37), `StickyTextEditor.tsx` (29), `App.tsx` (25), `tsconfig.worker.json` (25), +13 more |
| 4 | 1 by the agent | 1535 / 55 | `board-room.ts` (160), `board-store.ts` (145), `room-state.ts` (45), `test-hooks.ts` (35), `connectBoard.ts` (20), `App.tsx` (19), +12 more |
| 5 | 1 by the agent | 1098 / 158 | `App.tsx` (134), `Board.tsx` (112), `SharePanel.tsx` (93), `BoardPage.tsx` (43), `state.ts` (31), `router.ts` (31), +13 more |
| 7 | 1 by the agent | 1989 / 237 | `useTransformGesture.ts` (199), `board-model.ts` (159), `Board.tsx` (125), `StickyNote.tsx` (114), `geometry.ts` (99), `useSelection.ts` (93), +12 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
