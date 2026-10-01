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

**New work** 31/32, **regressions** 0, **repairs** 0, **cumulative** 35/36.

| Story | Title | Status | Agent min | Requests | Prompt tok | Completion tok | TTFT med s | Decode tok/s med | Gate | Accept (cumulative) | Stalled | Resumes / nudges | Compactions | Max ctx | Conditions |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pan and zoom around an infinite board | DONE | 4.2 | None | None | None | — | — | green | 6/6 |  | 0 / 0 | 0 | — | throttled 0% |
| 2 | Capture ideas on sticky notes and rearrange them | DONE | 7.7 | None | None | None | — | — | green | 20/20 |  | 0 / 0 | 0 | — | throttled 0% |
| 3 | See other people's edits appear live on the same board | DONE | 15.7 | None | None | None | — | — | green | 26/27 |  | 0 / 0 | 0 | — | throttled 0% |
| 4 | Return to a board and find everything as it was left | DONE | 10.5 | None | None | None | — | — | red | 30/31 |  | 0 / 0 | 0 | — | throttled 0% |
| 5 | Share a board with others using a link | DONE | 23.9 | None | None | None | — | — | red | 35/36 |  | 0 / 0 | 0 | — | throttled 0% |

**Totals:** 5 stories, 62 agent-minutes, 0 requests, 0 prompt / 0 completion tokens, gate green 3/5, final acceptance 35/36, stalled 0, partial 0, 6943 lines in src+tests.

## How it happened

Each story's commits, and which story broke or fixed an earlier story's held-out tests. Attribution is per commit, so an agent that commits once per story is blamed per story.

| Story | Commits | + / − lines | Most-changed source files (lines; tests and lockfiles left out) |
|---|---|---|---|
| 1 | 1 by the agent | 5163 / 0 | `BoardViewport.tsx` (206), `useCamera.ts` (117), `styles.css` (101), `camera.ts` (77), `package.json` (32), `ZoomControls.tsx` (25), +13 more |
| 2 | 1 by the agent | 1747 / 9 | `StickyNote.tsx` (164), `styles.css` (147), `board-model.ts` (127), `App.tsx` (108), `StickyTextEditor.tsx` (90), `StickyText.ts` (73), +8 more |
| 3 | 1 by the agent | 18927 / 77 | `worker-configuration.d.ts` (16187), `board-room.ts` (101), `connectBoard.ts` (74), `protocol.ts` (36), `styles.css` (27), `useBoardDoc.ts` (24), +16 more |
| 4 | 1 by the agent | 1536 / 49 | `board-room.ts` (189), `board-store.ts` (147), `room-state.ts` (49), `connectBoard.ts` (19), `App.tsx` (17), `test-hooks.ts` (17), +12 more |
| 5 | 1 by the agent | 1062 / 31 | `SharePanel.tsx` (99), `styles.css` (86), `BoardPage.tsx` (59), `NewBoardButton.tsx` (41), `state.ts` (37), `index.ts` (33), +13 more |

### Earlier stories broken or fixed

No story changed an earlier story's held-out results.

### Interruptions and dead time

A gap in a story's agent events with a restart or a logged intervention inside it is dead time (the machine or the run was down), not agent time. *Active* is the story's event span minus that dead time, across every attempt. *Recorded* is the harness's agent time, which covers only the attempt after the last restart.

No interruptions inside a story.
