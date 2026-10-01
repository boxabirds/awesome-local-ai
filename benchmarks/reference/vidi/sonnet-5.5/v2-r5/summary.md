# Vidi run — reference/sonnet-5.5

Model `claude-sonnet-5-5`, scope `canvas`, effort `client default`, client claude 2.1.285 (Claude Code), host Apple M2 16GB.

## Per story

New work is the story's own held-out tests. Regressions are earlier stories' held-out tests that passed before this story and fail after it; repairs the reverse. Cumulative is every held-out test for the stories built so far ([evaluation policy](../../../../spec-bench/EVALUATION-POLICY.md)). Cumulative can grow by more than the new work: some earlier tests need a later story's feature and are skipped until it exists.

| Story | New work | Regressions | Repairs | Cumulative |
|---|---|---|---|---|
| 1 | 6/6 | 0 | 0 | 6/6 |
| 2 | 10/10 | 0 | 0 | 20/20 |
| 3 | 6/7 | 0 | 0 | 26/27 |

**New work** 22/23, **regressions** 0, **repairs** 0, **cumulative** 26/27.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 5.4 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 100% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 6.8 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | throttled 100% |
| 3 | See other people's edits appear live on the same board | DONE | 12.3 | None | None | None | — | — | red | 26/27 |  | 0 / 0 | 0 | — | throttled 54% |

**Totals:** 3 stories, 25 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 2/3, final acceptance 26/27, stalled 0, partial 0, 3850 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 6054 / 0 | `BoardViewport.tsx` (169), `useCamera.ts` (102), `camera.ts` (72), `styles.css` (70), `package.json` (31), `App.tsx` (24), +13 more |
| 2 | 1 by the agent | 1552 / 12 | `StickyNote.tsx` (163), `styles.css` (133), `board-model.ts` (119), `App.tsx` (73), `StickyTextEditor.tsx` (69), `StickyText.ts` (59), +8 more |
| 3 | 1 by the agent | 2785 / 16 | `board-room.ts` (108), `connectBoard.ts` (67), `protocol.ts` (37), `StickyTextEditor.tsx` (29), `App.tsx` (25), `tsconfig.worker.json` (25), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
